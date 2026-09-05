import { describe, expect, it } from 'vitest';
import { JobQueue, newJobId, type ExportJob } from '../src/server/jobs/queue.js';
import { sleep } from '../src/server/habitap/client.js';
import type { SessionBlob } from '../src/server/habitap/types.js';

function fakeJob(createdAt = Date.now()): ExportJob {
  return {
    id: newJobId(),
    email: 'r@x.com',
    blob: {} as SessionBlob,
    categoryIds: [1],
    status: 'queued',
    progress: { done: 0, total: 0, failed: 0 },
    failedFiles: [],
    createdAt,
  };
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for condition');
    await sleep(5);
  }
}

describe('JobQueue', () => {
  it('runs jobs in FIFO order with bounded concurrency', async () => {
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const queue = new JobQueue(async (job) => {
      running++;
      peak = Math.max(peak, running);
      await sleep(20);
      order.push(job.id);
      job.status = 'done';
      running--;
    }, 2);

    const jobs = [fakeJob(), fakeJob(), fakeJob(), fakeJob(), fakeJob()];
    for (const j of jobs) queue.create(j);
    await waitFor(() => queue.all().every((j) => j.status === 'done'));
    expect(order).toEqual(jobs.map((j) => j.id)); // FIFO
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1); // and actually uses both slots
  });

  it('sweeps finished jobs past the TTL but keeps active ones', async () => {
    const queue = new JobQueue(async (job) => {
      job.status = 'done';
    }, 2);
    const old = fakeJob(Date.now() - 25 * 3600 * 1000);
    const fresh = fakeJob();
    const active = fakeJob(Date.now() - 48 * 3600 * 1000);
    active.status = 'running';
    queue.create(old);
    queue.create(fresh);
    queue.create(active);
    await waitFor(() => queue.all().every((j) => j.status !== 'queued'));

    const { ids } = queue.sweep(24 * 3600 * 1000);
    expect(ids).toContain(old.id);
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(active.id);
    expect(queue.get(old.id)).toBeUndefined();
    expect(queue.get(fresh.id)).toBeDefined();
  });

  it('lists jobs by email', async () => {
    const queue = new JobQueue(async (job) => {
      job.status = 'done';
    }, 2);
    const a = fakeJob();
    a.email = 'a@x.com';
    const b = fakeJob();
    b.email = 'b@x.com';
    queue.create(a);
    queue.create(b);
    await waitFor(() => queue.all().every((j) => j.status !== 'queued'));
    expect(queue.listByEmail('a@x.com').map((j) => j.id)).toEqual([a.id]);
  });
});
