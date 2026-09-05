// Shared service container threaded through the routes.

import type { Transport } from './habitap/transport.js';
import type { HabitapConfig } from './habitap/client.js';
import type { RateLimiter } from './http/ratelimit.js';
import type { JobQueue } from './jobs/queue.js';

export interface Services {
  cfg: HabitapConfig;
  transport: Transport;
  limiter: RateLimiter;
  queue: JobQueue;
  cookieKey: Buffer;
  ttlMs: number;
}
