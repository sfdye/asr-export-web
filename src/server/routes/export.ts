import fs from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { getSession } from '../auth/session.js';
import { newJobId, type ExportJob } from '../jobs/queue.js';
import type { Services } from '../services.js';

const MAX_ACTIVE_JOBS_PER_EMAIL = 2;

// Job id is a random UUID used as a bearer capability: status checks and
// downloads need no login (so a session expiring mid-download never breaks
// the browser's pause/resume). TTL 24 h.

export function exportRoutes(svc: Services): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const blob = getSession(c, svc.cookieKey);
    if (!blob) return c.json({ error: 'no session' }, 401);

    const body = await c.req.json().catch(() => null);
    const categoryIds = body?.categoryIds;
    if (!Array.isArray(categoryIds) || categoryIds.length === 0 || categoryIds.length > 200 || !categoryIds.every((v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0)) {
      return c.json({ error: 'invalid selection' }, 400);
    }

    const active = svc.queue.listByEmail(blob.email).filter((j) => j.status === 'queued' || j.status === 'running');
    if (active.length >= MAX_ACTIVE_JOBS_PER_EMAIL) {
      return c.json({ error: 'you already have an export in progress — wait for it to finish first' }, 429);
    }

    const job: ExportJob = {
      id: newJobId(),
      email: blob.email,
      blob,
      categoryIds: [...new Set(categoryIds)] as number[],
      status: 'queued',
      progress: { done: 0, total: 0, failed: 0 },
      failedFiles: [],
      createdAt: Date.now(),
    };
    svc.queue.create(job);
    console.info(`[export] queued job ${job.id} (${job.categoryIds.length} categories, ${blob.email})`);
    return c.json({ id: job.id });
  });

  app.get('/jobs/:id', (c) => {
    const job = svc.queue.get(c.req.param('id'));
    if (!job) return c.json({ error: 'not found or expired' }, 404);
    return c.json(jobView(job, svc.ttlMs));
  });

  app.get('/jobs/:id/download', (c) => {
    const job = svc.queue.get(c.req.param('id'));
    if (!job || job.status !== 'done' || !job.zipPath || job.zipSize === undefined) {
      return c.json({ error: job ? 'export not finished' : 'not found or expired' }, job ? 409 : 404);
    }
    let stat;
    try {
      stat = fs.statSync(job.zipPath);
    } catch {
      return c.json({ error: 'file already removed (exports are kept 24 h)' }, 410);
    }
    const size = stat.size;

    c.header('content-type', 'application/zip');
    c.header('accept-ranges', 'bytes');
    c.header('content-disposition', `attachment; filename="${job.zipName ?? 'asr-export.zip'}"`);

    const rangeHeader = c.req.header('range');
    let start = 0;
    let end = size - 1;
    let status: 200 | 206 = 200;

    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (m && !(m[1] === '' && m[2] === '')) {
        if (m[1] === '') {
          const suffix = Number(m[2]);
          start = suffix === 0 || suffix > size ? -1 : size - suffix;
        } else {
          start = Number(m[1]);
          end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
        }
        if (start < 0 || start >= size || start > end) {
          c.header('content-range', `bytes */${size}`);
          return c.body(null, 416);
        }
        status = 206;
        c.header('content-range', `bytes ${start}-${end}/${size}`);
      }
      // unparseable range is ignored → full 200 response (RFC 7233)
    }

    c.header('content-length', String(end - start + 1));
    // Readable.toWeb's stream generic differs slightly from Hono's BodyInit;
    // the bytes come from fs.createReadStream either way.
    const stream = Readable.toWeb(fs.createReadStream(job.zipPath, { start, end })) as unknown as ReadableStream<Uint8Array>;
    return c.body(stream, status);
  });

  return app;
}

export function jobView(job: ExportJob, ttlMs: number) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    failedCount: job.failedFiles.length,
    failedFiles: job.status === 'done' ? job.failedFiles : undefined,
    zipName: job.zipName,
    zipSize: job.zipSize,
    error: job.error,
    createdAt: job.createdAt,
    expiresAt: job.createdAt + ttlMs,
  };
}
