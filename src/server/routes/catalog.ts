import { Hono } from 'hono';
import { clientFromSession } from '../habitap/client.js';
import { dedupCatalog, docKind, type CatalogEntry } from '../habitap/catalog.js';
import { getSession } from '../auth/session.js';
import type { Services } from '../services.js';
import type { AccountInfo, SessionBlob } from '../habitap/types.js';

// GET /api/catalog — the user's deduped document catalog, grouped by category.
// GET /api/catalog/sizes?categoryId=N — per-doc file sizes via CDN HEADs,
// fetched lazily (4 at a time) when a category is expanded in the UI.
// Both cached in memory for 5 min per account so wizard re-renders are free.

interface CacheEntry {
  at: number;
  categories: CatalogEntry[];
  sizes: Map<number, Record<number, number>>;
  inflight: Map<number, Promise<Record<number, number>>>;
}

const CACHE_TTL = 5 * 60 * 1000;
const HEAD_CONCURRENCY = 4;
const cache = new Map<string, CacheEntry>();

export function invalidateCatalog(email: string): void {
  cache.delete(email);
}

type EntriesResult = { ok: true; entries: CatalogEntry[] } | { ok: false; status: 401 | 409 | 502; error: string };

async function entriesFor(blob: SessionBlob, svc: Services): Promise<EntriesResult> {
  const block = blob.account.blockCode ?? '';
  if (!block) return { ok: false, status: 409, error: 'account has no unit/block — cannot list documents' };
  const hit = cache.get(blob.email);
  if (hit && Date.now() - hit.at < CACHE_TTL) return { ok: true, entries: hit.categories };
  const client = clientFromSession(blob, svc.cfg, svc.transport);
  try {
    const entries = dedupCatalog(await client.catalog(block));
    cache.set(blob.email, { at: Date.now(), categories: entries, sizes: new Map(), inflight: new Map() });
    return { ok: true, entries };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) return { ok: false, status: 401, error: 'session expired — log in again' };
    console.warn(`[catalog] ${String(e instanceof Error ? e.message : e).slice(0, 140)}`);
    return { ok: false, status: 502, error: 'could not fetch the document list — retry in a minute' };
  }
}

export function catalogRoutes(svc: Services): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const blob = getSession(c, svc.cookieKey);
    if (!blob) {
      const cookieHeader = c.req.header('cookie') ?? '';
      console.info(`[catalog] no session · cookie header ${cookieHeader.length}B${cookieHeader.includes('asr_sess') ? ' (asr_sess present but undecryptable!)' : ' (no asr_sess — browser did not send it)'}`);
      return c.json({ error: 'no session' }, 401);
    }

    const r = await entriesFor(blob, svc);
    if (!r.ok) return c.json({ error: r.error }, r.status);

    const account: AccountInfo = blob.account;
    return c.json({
      account,
      categories: r.entries.map(({ category, docs }) => ({
        id: category.id,
        name: category.name,
        count: docs.length,
        docs: docs.map((d) => ({ id: d.id, caption: (d.caption ?? '').trim(), kind: docKind(d) })),
      })),
    });
  });

  app.get('/sizes', async (c) => {
    const blob = getSession(c, svc.cookieKey);
    if (!blob) return c.json({ error: 'no session' }, 401);
    const categoryId = Number(c.req.query('categoryId'));
    if (!Number.isInteger(categoryId) || categoryId <= 0) return c.json({ error: 'categoryId is required' }, 400);

    const r = await entriesFor(blob, svc);
    if (!r.ok) return c.json({ error: r.error }, r.status);
    const entry = r.entries.find((e) => e.category.id === categoryId);
    if (!entry) return c.json({ error: 'unknown category' }, 404);

    const cell = cache.get(blob.email);
    const cached = cell?.sizes.get(categoryId);
    if (cached) return c.json({ sizes: cached });
    const running = cell?.inflight.get(categoryId);
    if (running) return c.json({ sizes: await running });

    const client = clientFromSession(blob, svc.cfg, svc.transport);
    const files = entry.docs
      .filter((d) => docKind(d) === 'file' && d.filePath)
      .map((d) => ({ id: d.id, url: d.filePath as string }));
    const job = (async () => {
      const sizes: Record<number, number> = {};
      for (let i = 0; i < files.length; i += HEAD_CONCURRENCY) {
        await Promise.all(files.slice(i, i + HEAD_CONCURRENCY).map(async (f) => {
          const len = await client.headFileLength(f.url);
          if (len != null) sizes[f.id] = len;
        }));
      }
      return sizes;
    })();
    cell?.inflight.set(categoryId, job);
    try {
      const sizes = await job;
      cell?.sizes.set(categoryId, sizes);
      return c.json({ sizes });
    } finally {
      cell?.inflight.delete(categoryId);
    }
  });

  return app;
}
