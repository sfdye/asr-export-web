import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/server/http/ratelimit.js';

describe('RateLimiter', () => {
  it('allows up to the limit within a window, then blocks', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.hit('ip')).toBe(true);
    expect(rl.hit('ip')).toBe(true);
    expect(rl.hit('ip')).toBe(true);
    expect(rl.hit('ip')).toBe(false);
    // other keys unaffected
    expect(rl.hit('other')).toBe(true);
  });

  it('resets after the window passes', () => {
    const rl = new RateLimiter(1, 50);
    expect(rl.hit('ip', 1000)).toBe(true);
    expect(rl.hit('ip', 1010)).toBe(false);
    expect(rl.hit('ip', 1100)).toBe(true); // window expired
  });

  it('prune drops expired windows', () => {
    const rl = new RateLimiter(1, 10);
    rl.hit('a', 0);
    rl.hit('b', 100);
    rl.prune(50);
    expect(rl.msUntilReset('a')).toBe(0);
  });
});
