import { Hono } from 'hono';
import { HabitapClient } from '../habitap/client.js';
import { getSession, setSession, clearSession } from '../auth/session.js';
import type { Services } from '../services.js';

export function authRoutes(svc: Services): Hono {
  const app = new Hono();

  app.post('/login', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    if (!svc.limiter.hit(`login:${ip}`)) {
      const retryInMin = Math.ceil(svc.limiter.msUntilReset(`login:${ip}`) / 60000);
      return c.json({ error: `too many attempts — try again in ~${retryInMin} minute(s)` }, 429);
    }

    const body = await c.req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const otp = typeof body?.otp === 'string' ? body.otp.trim() : undefined;
    if (!email || !password || email.length > 200 || password.length > 200 || (otp !== undefined && !/^\d{4,8}$/.test(otp))) {
      return c.json({ error: 'invalid input' }, 400);
    }

    // reuse this browser's registered installationId → skips the OTP step
    const prior = getSession(c, svc.cookieKey);
    const installationId = prior?.installationId ?? '';

    // fresh client: the CLI clears cookies before login; same here
    const client = new HabitapClient(svc.cfg, svc.transport);
    let outcome;
    try {
      outcome = await client.login(email, password, installationId, otp);
    } catch (e) {
      console.warn(`[login] network error (${String(e).slice(0, 120)})`);
      return c.json({ error: 'could not reach Habitap — check your connection and retry' }, 502);
    }

    if (outcome.status === 'otp_required') {
      return c.json({ status: 'otp_required', message: outcome.message });
    }
    if (outcome.status === 'invalid') {
      console.info(`[login] invalid credentials (${email})`);
      return c.json({ error: outcome.message }, 401);
    }

    // Habitap's rememberMe token is large and redundant here (we persist the
    // session in our own sealed cookie and re-login when it expires) — dropping
    // it keeps the sealed cookie under the browser's ~4 KB per-cookie limit
    // (larger cookies are silently discarded → "no session" on the next call).
    const { rememberMe: _rm, ...cookies } = outcome.cookies;
    const blob = {
      cookies,
      installationId: outcome.installationId,
      email,
      account: outcome.account,
    };
    setSession(c, svc.cookieKey, blob);
    console.info(`[login] ok (${email}) unit ${outcome.account.unitNo ?? '?'} · kept cookies: ${Object.keys(cookies).join(', ') || '(none)'}`);
    return c.json({ status: 'ok', account: outcome.account });
  });

  app.post('/logout', (c) => {
    clearSession(c);
    return c.json({ status: 'ok' });
  });

  app.get('/me', async (c) => {
    const blob = getSession(c, svc.cookieKey);
    if (!blob) return c.json({ error: 'no session' }, 401);
    const client = new HabitapClient(svc.cfg, svc.transport, blob.cookies);
    try {
      const account = await client.fetchAccount();
      if (!account) return c.json({ error: 'session expired — log in again' }, 401);
      return c.json({ account });
    } catch {
      return c.json({ error: 'could not reach Habitap — retry' }, 502);
    }
  });

  return app;
}
