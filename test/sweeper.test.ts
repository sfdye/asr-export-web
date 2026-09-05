import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobQueue, newJobId, type ExportJob } from '../src/server/jobs/queue.js';
import { sweepOnce } from '../src/server/jobs/sweeper.js';
import { zipsDir } from '../src/server/config.js';
import type { SessionBlob } from '../src/server/habitap/types.js';

const blob: SessionBlob = { cookies: {}, installationId: '', email: 't@example.com', account: { blockCode: 'AVESOU11', condoId: 32 } };
const TTL = 24 * 60 * 60 * 1000;

function makeJob(status: ExportJob['status']): ExportJob {
  return {
    id: newJobId(),
    email: blob.email,
    blob,
    categoryIds: [1],
    status,
    progress: { done: 0, total: 0, failed: 0 },
    failedFiles: [],
    createdAt: Date.now(),
  };
}

describe('sweeper', () => {
  it('never touches the zip of a running job (regression: the hourly sweep once deleted in-progress zips)', () => {
    const queue = new JobQueue(() => new Promise<void>(() => {})); // a worker that never finishes
    const job = makeJob('queued');
    queue.create(job); // pump flips it to running
    expect(job.status).toBe('running');
    job.zipPath = path.join(zipsDir, `${job.id}.zip`); // the worker sets this before finishing
    fs.writeFileSync(job.zipPath, 'partial');

    sweepOnce(queue, TTL);
    expect(fs.existsSync(job.zipPath)).toBe(true);
    fs.rmSync(job.zipPath, { force: true });
  });

  it('drops expired done jobs and deletes orphaned files past the TTL', () => {
    const queue = new JobQueue(async () => {});
    const job = makeJob('done');
    job.createdAt = Date.now() - TTL - 60 * 1000;
    queue.create(job);

    const orphan = path.join(zipsDir, `${newJobId()}.zip`);
    fs.writeFileSync(orphan, 'x');
    const old = new Date(Date.now() - TTL - 60 * 1000);
    fs.utimesSync(orphan, old, old);

    sweepOnce(queue, TTL);
    expect(queue.get(job.id)).toBeUndefined();
    expect(fs.existsSync(orphan)).toBe(false);
  });
});
