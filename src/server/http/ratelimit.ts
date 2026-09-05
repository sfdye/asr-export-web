// In-memory fixed-window rate limiter (single process; login only).
// Failed logins can lock Habitap accounts, so keep this conservative.

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  /** returns true when the hit is allowed; false when the limit is exceeded */
  hit(key: string, now = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (w.count >= this.limit) return false;
    w.count++;
    return true;
  }

  msUntilReset(key: string, now = Date.now()): number {
    const w = this.windows.get(key);
    return w ? Math.max(0, w.resetAt - now) : 0;
  }

  /** drop expired windows (call occasionally to bound memory) */
  prune(now = Date.now()) {
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }
}
