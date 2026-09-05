import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobQueue, newJobId, type ExportJob } from '../src/server/jobs/queue.js';
import { sweepOnce } from '../src/server/jobs/sweeper.js';
import { jobsDir, zipsDir } from '../src/server/config.js';
import { INTERRUPTED_ERROR, loadJobRecords, removeJobRecord, saveJobRecord } from '../src/server/jobs/store.js';
import type { SessionBlob } from '../src/server/habitap/types.js';

const blob: SessionBlob = { cookies: { JSESSIONID: 'secret' }, installationId: '', email: 't@example.com', account: { blockCode: 'AVESOU11', condoId: 32 } };
const TTL = 24 * 60 * 60 * 1000;

function makeJob(status: ExportJob['status'], createdAt = Date.now()): ExportJob {
  return {
    id: newJobId(),
    email: blob.email,
    blob,
    categoryIds: [1],
    status,
    progress: { done: 0, total: 0, failed: 0 },
    failedFiles: [],
    createdAt,
  };
}

function recordPath(id: string): string {
  return path.join(jobsDir, `${id}.json`);
}

describe('job record store', () => {
  it('persists terminal jobs without the session blob and loads them back', () => {
    const job = makeJob('done');
    job.zipPath = path.join(zipsDir, `${job.id}.zip`);
    job.zipName = 'x.zip';
    job.zipSize = 123;
    saveJobRecord(job);

    const raw = JSON.parse(fs.readFileSync(recordPath(job.id), 'utf8')) as Record<string, unknown>;
    expect('blob' in raw).toBe(false); // session cookies never hit disk

    const rec = loadJobRecords().find((j) => j.id === job.id);
    expect(rec?.status).toBe('done');
    expect(rec?.zipSize).toBe(123);
    expect(rec?.blob).toBeUndefined();
    expect(rec?.email).toBe(blob.email);

    removeJobRecord(job.id);
    expect(fs.existsSync(recordPath(job.id))).toBe(false);
    expect(loadJobRecords().some((j) => j.id === job.id)).toBe(false);
  });

  it('queued and running markers both load back as interrupted', () => {
    // the route saves this shape at creation, the worker at start
    for (const status of ['queued', 'running'] as const) {
      const job = makeJob(status);
      if (status === 'running') {
        job.zipPath = path.join(zipsDir, `${job.id}.zip`);
        fs.writeFileSync(job.zipPath!, 'partial-zip');
      }
      saveJobRecord(job);
      expect(JSON.parse(fs.readFileSync(recordPath(job.id), 'utf8')).blob).toBeUndefined();

      // restart: loadJobRecords coerces it to a clear failure and drops the partial zip
      const rec = loadJobRecords().find((j) => j.id === job.id);
      expect(rec?.status).toBe('failed');
      expect(rec?.error).toBe(INTERRUPTED_ERROR);
      expect(rec?.zipPath).toBeUndefined();
      if (status === 'running') expect(fs.existsSync(job.zipPath!)).toBe(false);
      removeJobRecord(job.id);
    }
  });

  it('skips broken record files without throwing', () => {
    fs.writeFileSync(path.join(jobsDir, 'garbage.json'), '{not json');
    expect(() => loadJobRecords()).not.toThrow();
    expect(loadJobRecords().every((j) => typeof j.id === 'string')).toBe(true);
    fs.rmSync(path.join(jobsDir, 'garbage.json'), { force: true });
  });
});

describe('restore across restarts', () => {
  it('restored done jobs stay queryable and downloadable until swept', () => {
    const job = makeJob('done');
    job.zipPath = path.join(zipsDir, `${job.id}.zip`);
    job.zipSize = 10;
    saveJobRecord(job);
    fs.writeFileSync(job.zipPath, 'zip-bytes');

    // simulate a restart: fresh queue, records reloaded from disk
    const queue = new JobQueue(() => Promise.resolve());
    queue.restore(loadJobRecords());
    const restored = queue.get(job.id);
    expect(restored?.status).toBe('done');
    expect(restored?.zipPath).toBe(job.zipPath);
    expect(queue.listByEmail(blob.email).map((j) => j.id)).toContain(job.id);

    // not swept before the TTL
    sweepOnce(queue, TTL);
    expect(queue.get(job.id)).toBeDefined();

    // past the TTL: record + zip + persisted record file all go
    restored!.createdAt = Date.now() - TTL - 60 * 1000;
    sweepOnce(queue, TTL);
    expect(queue.get(job.id)).toBeUndefined();
    expect(fs.existsSync(job.zipPath)).toBe(false);
    expect(fs.existsSync(recordPath(job.id))).toBe(false);
  });

  it('the boot sweep cleans restored records that were already expired', () => {
    const job = makeJob('done', Date.now() - TTL - 60 * 1000);
    saveJobRecord(job);
    fs.writeFileSync(path.join(zipsDir, `${job.id}.zip`), 'x');

    const queue = new JobQueue(() => Promise.resolve());
    queue.restore(loadJobRecords());
    sweepOnce(queue, TTL); // runs on boot via startSweeper
    expect(queue.get(job.id)).toBeUndefined();
    expect(fs.existsSync(recordPath(job.id))).toBe(false);
  });
});
