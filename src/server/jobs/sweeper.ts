import fs from 'node:fs';
import path from 'node:path';
import { zipsDir } from '../config.js';
import type { JobQueue } from './queue.js';

// TTL sweeper: hard-deletes finished job records and their zips after the
// TTL, plus any orphaned files in the zips dir (crash leftovers). Runs on
// boot and once an hour.

export function startSweeper(queue: JobQueue, ttlMs: number, intervalMs = 60 * 60 * 1000): void {
  const sweepOnce = () => {
    const { ids, freedBytes } = queue.sweep(ttlMs);
    for (const job of queue.all()) {
      if (job.zipPath && !job.zipSize) {
        // failed job whose zip was left behind by an older crash
        try {
          fs.rmSync(job.zipPath, { force: true });
        } catch {}
      }
    }
    // orphaned zip files with no job record (server restarted mid-job etc.)
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
  };
  sweepOnce();
  const timer = setInterval(sweepOnce, intervalMs);
  timer.unref?.();
}
