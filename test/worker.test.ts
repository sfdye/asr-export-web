import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HabitapClient, type HabitapConfig } from '../src/server/habitap/client.js';
import { MockTransport } from '../src/server/habitap/mock.js';
import { runExportJob } from '../src/server/jobs/worker.js';
import { newJobId, type ExportJob } from '../src/server/jobs/queue.js';
import { zipsDir, jobsDir } from '../src/server/config.js';
import { parseZip } from './zipread.js';
import type { SessionBlob } from '../src/server/habitap/types.js';

const cfg: HabitapConfig = {
  baseUrl: 'https://avenuesouth.habitap.app/avenuesouth',
  condoId: 32,
  condoCode: 'AVESOU',
  userAgent: 'okhttp/4.12.0',
  appId: 'com.habitap.residential.avesouth',
  apiVersion: 'V2',
};

const created: string[] = [];
const records: string[] = [];
afterAll(() => {
  for (const p of created) fs.rmSync(p, { force: true });
  for (const p of records) fs.rmSync(p, { force: true }); // job records persisted by the worker
});

async function loginBlob(transport: MockTransport): Promise<SessionBlob> {
  const res = await new HabitapClient(cfg, transport).login('resident@example.com', 'password1', '', '111111');
  if (res.status !== 'ok') throw new Error('mock login failed');
  return { cookies: res.cookies, installationId: res.installationId, email: 'resident@example.com', account: res.account };
}

function makeJob(blob: SessionBlob, categoryIds: number[]): ExportJob {
  return {
    id: newJobId(),
    email: blob.email,
    blob,
    categoryIds,
    status: 'queued',
    progress: { done: 0, total: 0, failed: 0 },
    failedFiles: [],
    createdAt: Date.now(),
  };
}

describe('export worker (end-to-end against mock Habitap)', () => {
  it('builds a valid zip: files, .url link; failing doc reported on the job', async () => {
    const transport = new MockTransport();
    const blob = await loginBlob(transport);
    const job = makeJob(blob, [1, 2, 3]);
    created.push(path.join(zipsDir, `${job.id}.zip`));
    records.push(path.join(jobsDir, `${job.id}.json`));

    await runExportJob(job, cfg, transport, { paceMs: 0, retryBaseMs: 1 });

    expect(job.status).toBe('done');
    expect(job.error).toBeUndefined();
    expect(job.progress.total).toBe(11);
    expect(job.progress.done).toBe(11);
    expect(job.progress.failed).toBe(1);
    expect(job.failedFiles.map((f) => f.path)).toEqual(['Operating Manuals & Warranties/Corrupted Scan.pdf']);
    expect(job.zipSize).toBeGreaterThan(0);

    const buf = fs.readFileSync(path.join(zipsDir, `${job.id}.zip`));
    const entries = parseZip(buf);
    const names = entries.map((e) => e.name);

    // 9 CDN files + 1 external link (.url)
    expect(names).toContain('Drawings/Floor Plan 12-34.pdf');
    expect(names).toContain('Drawings/M&E Layout.pdf'); // the slow-trickle doc
    expect(names).toContain('Operating Manuals & Warranties/Novade Portal.url');
    expect(names).not.toContain('FAILED.txt');
    expect(names.filter((n) => n.endsWith('.pdf')).length).toBe(9);
    expect(names.length).toBe(10);

    const urlEntry = entries.find((e) => e.name.endsWith('.url'))!;
    expect(urlEntry.data.toString()).toBe('https://novade.net/\n');
  }, 20000);

  it('selects only the requested categories', async () => {
    const transport = new MockTransport();
    const blob = await loginBlob(transport);
    const job = makeJob(blob, [3]); // Circulars only
    created.push(path.join(zipsDir, `${job.id}.zip`));
    records.push(path.join(jobsDir, `${job.id}.json`));

    await runExportJob(job, cfg, transport, { paceMs: 0, retryBaseMs: 1 });
    expect(job.status).toBe('done');
    expect(job.progress.total).toBe(2);
    const entries = parseZip(fs.readFileSync(path.join(zipsDir, `${job.id}.zip`)));
    expect(entries.map((e) => e.name)).toEqual(['Circulars/Move-in Notice.pdf', 'Circulars/Renovation Rules.pdf']);
  }, 10000);

  it('fails the job with a session-expired message when cookies are dead', async () => {
    const transport = new MockTransport();
    const blob: SessionBlob = {
      cookies: {}, // no session
      installationId: '',
      email: 'resident@example.com',
      account: { blockCode: 'AVESOU11', condoId: 32 },
    };
    const job = makeJob(blob, [1]);
    records.push(path.join(jobsDir, `${job.id}.json`));

    await runExportJob(job, cfg, transport, { paceMs: 0, retryBaseMs: 1 });
    expect(job.status).toBe('failed');
    expect(job.error).toContain('session expired');
    expect(job.zipPath).toBeUndefined(); // partial zip removed
  }, 10000);
});
