import { Hono } from 'hono';
import { clientFromSession } from '../habitap/client.js';
import { dedupCatalog, docKind, type CatalogEntry } from '../habitap/catalog.js';
import { getSession } from '../auth/session.js';
import type { Services } from '../services.js';
import type { AccountInfo } from '../habitap/types.js';

// GET /api/catalog — the user's deduped document catalog, grouped by category.
// Cached in memory for 5 min per account so wizard re-renders are free.

interface CacheEntry {
  at: number;
  categories: CatalogEntry[];
}

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export function invalidateCatalog(email: string): void {
  cache.delete(email);
}

export function catalogRoutes(svc: Services): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const blob = getSession(c, svc.cookieKey);
    if (!blob) {
      const cookieHeader = c.req.header('cookie') ?? '';
      console.info(`[catalog] no session · cookie header ${cookieHeader.length}B${cookieHeader.includes('asr_sess') ? ' (asr_sess present but undecryptable!)' : ' (no asr_sess — browser did not send it)'}`);
      return c.json({ error: 'no session' }, 401);
    }
    const block = blob.account.blockCode ?? '';
    if (!block) return c.json({ error: 'account has no unit/block — cannot list documents' }, 409);

    const hit = cache.get(blob.email);
    let entries: CatalogEntry[];
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      entries = hit.categories;
    } else {
      const client = clientFromSession(blob, svc.cfg, svc.transport);
      try {
        entries = dedupCatalog(await client.catalog(block));
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 403) return c.json({ error: 'session expired — log in again' }, 401);
        console.warn(`[catalog] ${String(e instanceof Error ? e.message : e).slice(0, 140)}`);
        return c.json({ error: 'could not fetch the document list — retry in a minute' }, 502);
      }
      cache.set(blob.email, { at: Date.now(), categories: entries });
    }

    const account: AccountInfo = blob.account;
    return c.json({
      account,
      categories: entries.map(({ category, docs }) => ({
        id: category.id,
        name: category.name,
        count: docs.length,
        docs: docs.map((d) => ({ id: d.id, caption: (d.caption ?? '').trim(), kind: docKind(d) })),
      })),
    });
  });

  return app;
}
