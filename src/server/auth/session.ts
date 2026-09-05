import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { open, seal } from './crypto.js';
import type { SessionBlob } from '../habitap/types.js';

const COOKIE_NAME = 'asr_sess';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days; re-validated against Habitap on use

export function getSession(c: Context, key: Buffer): SessionBlob | null {
  const raw = getCookie(c, COOKIE_NAME);
  if (!raw) return null;
  return open<SessionBlob>(key, raw);
}

export function setSession(c: Context, key: Buffer, blob: SessionBlob): void {
  const raw = seal(key, blob);
  if (raw.length > 3800) console.warn(`[session] sealed cookie is ${raw.length}B — near/over the ~4KB browser limit`);
  setCookie(c, COOKIE_NAME, raw, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}
