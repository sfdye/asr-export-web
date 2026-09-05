import { describe, expect, it } from 'vitest';
import { open, seal } from '../src/server/auth/crypto.js';

const key = Buffer.from('0123456789abcdef0123456789abcdef');

describe('session cookie crypto', () => {
  it('round-trips a blob', () => {
    const blob = { cookies: { JSESSIONID: 'abc' }, installationId: 'iid-1', email: 'r@x.com', account: { unitNo: '#1-2', condoId: 32 } };
    expect(open(key, seal(key, blob))).toEqual(blob);
  });

  it('rejects tampered ciphertext', () => {
    const s = seal(key, { a: 1 });
    const raw = Buffer.from(s, 'base64url');
    raw[raw.length - 3] ^= 0xff;
    expect(open(key, raw.toString('base64url'))).toBeNull();
  });

  it('rejects garbage and wrong key', () => {
    expect(open(key, 'nonsense')).toBeNull();
    const other = Buffer.from('ffffffffffffffffffffffffffffffff');
    expect(open(other, seal(key, { a: 1 }))).toBeNull();
  });
});
