import type { SessionBlob } from '../habitap/types.js';

// Export job model + in-process FIFO queue. No DB: jobs live in memory,
// zips on disk; both are swept after the TTL (24 h).

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobProgress {
  done: number;
  total: number;
  failed: number;
  currentFile?: string;
}

export interface FailedFile {
  path: string;
  reason: string;
}

export interface ExportJob {
  id: string;
  email: string;
  blob: SessionBlob;
  categoryIds: number[];
  status: JobStatus;
  progress: JobProgress;
  failedFiles: FailedFile[];
  zipPath?: string;
  zipName?: string;
  zipSize?: number;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

export class JobQueue {
  private jobs = new Map<string, ExportJob>();
  private running = 0;

  constructor(
    private readonly run: (job: ExportJob) => Promise<void>,
    private readonly concurrency = 2,
  ) {}

  create(job: ExportJob): void {
    this.jobs.set(job.id, job);
    void this.pump();
  }

  get(id: string): ExportJob | undefined {
    return this.jobs.get(id);
  }

  listByEmail(email: string): ExportJob[] {
    return [...this.jobs.values()].filter((j) => j.email === email);
  }

  activeCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.status === 'queued' || j.status === 'running') n++;
    return n;
  }

  /** jobs past their TTL — zips deleted, records dropped */
  sweep(ttlMs: number, now = Date.now()): { ids: string[]; freedBytes: number } {
    const ids: string[] = [];
    let freedBytes = 0;
    for (const [id, job] of this.jobs) {
      if (now - job.createdAt > ttlMs && job.status !== 'running' && job.status !== 'queued') {
        ids.push(id);
        freedBytes += job.zipSize ?? 0;
        this.jobs.delete(id);
      }
    }
    return { ids, freedBytes };
  }

  all(): ExportJob[] {
    return [...this.jobs.values()];
  }

  private async pump(): Promise<void> {
    while (this.running < this.concurrency) {
      const next = [...this.jobs.values()].find((j) => j.status === 'queued');
      if (!next) return;
      next.status = 'running';
      this.running++;
      void this.run(next)
        .catch(() => {}) // run() sets job.status itself on failure
        .finally(() => {
          this.running--;
          void this.pump();
        });
    }
  }
}

export function newJobId(): string {
  return crypto.randomUUID();
}
