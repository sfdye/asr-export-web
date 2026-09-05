import fs from 'node:fs';
import path from 'node:path';
import { jobsDir } from '../config.js';
import type { ExportJob, JobStatus } from './queue.js';

// Terminal job records persisted as JSON in DATA_DIR/jobs so completed
// exports stay downloadable for the full TTL across server restarts (the
// queue itself is in-memory). A 'running' marker is also written at job
// start so a restart can report the job as interrupted instead of 404ing.
// The Habitap session blob is never written.

export const INTERRUPTED_ERROR = 'interrupted by a server restart — please run the export again';

const SAVED: readonly JobStatus[] = ['done', 'failed', 'running'];

export function saveJobRecord(job: ExportJob): void {
  if (!SAVED.includes(job.status)) return;
  const { blob, ...rest } = job;
  const file = path.join(jobsDir, `${job.id}.json`);
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(rest));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.warn(`[jobs] failed to persist record ${job.id}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
  }
}

export function loadJobRecords(): ExportJob[] {
  const out: ExportJob[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(jobsDir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(jobsDir, name), 'utf8')) as Partial<ExportJob>;
      if (typeof rec.id !== 'string' || typeof rec.createdAt !== 'number' || !SAVED.includes(rec.status as JobStatus)) continue;
      if (rec.status === 'running') {
        // the process died mid-run: the zip (if any) is partial — drop it
        // and surface a clear failure instead of "not found or expired"
        if (rec.zipPath) {
          try {
            fs.rmSync(rec.zipPath, { force: true });
          } catch {}
        }
        out.push({ ...rec, status: 'failed', error: INTERRUPTED_ERROR, zipPath: undefined, zipSize: undefined, blob: undefined, finishedAt: Date.now() } as ExportJob);
      } else {
        out.push({ ...rec, blob: undefined } as ExportJob);
      }
    } catch {}
  }
  return out;
}

export function removeJobRecord(id: string): void {
  try {
    fs.rmSync(path.join(jobsDir, `${id}.json`), { force: true });
  } catch {}
}
