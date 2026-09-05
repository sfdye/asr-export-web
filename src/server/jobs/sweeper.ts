import fs from 'node:fs';
import path from 'node:path';
import { zipsDir } from '../config.js';
import type { JobQueue } from './queue.js';

// TTL sweeper: drops finished job records past the TTL and deletes any
// orphaned zip files in the zips dir (crash leftovers; a done job's zip is
// deleted here once its mtime passes the TTL). Runs on boot and hourly.
// Running/queued jobs are never touched — their zip is being written.

export function sweepOnce(queue: JobQueue, ttlMs: number): void {
  const { ids, freedBytes } = queue.sweep(ttlMs);
  let orphans = 0;
  try {
    for (const f of fs.readdirSync(zipsDir)) {
      const p = path.join(zipsDir, f);
      try {
        const st = fs.statSync(p);
        if (Date.now() - st.mtimeMs > ttlMs) {
          fs.rmSync(p, { force: true });
          orphans++;
        }
      } catch {}
    }
  } catch {}
  const freedMb = (freedBytes / 1048576).toFixed(1);
  if (ids.length || orphans) console.info(`[sweeper] removed ${ids.length} job(s), ${orphans} orphan file(s), ${freedMb} MB freed`);
}

export function startSweeper(queue: JobQueue, ttlMs: number, intervalMs = 60 * 60 * 1000): void {
  sweepOnce(queue, ttlMs);
  const timer = setInterval(() => sweepOnce(queue, ttlMs), intervalMs);
  timer.unref?.();
}
