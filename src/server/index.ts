import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config } from './config.js';
import { RateLimiter } from './http/ratelimit.js';
import { realTransportRequest } from './habitap/transport.js';
import { MockTransport } from './habitap/mock.js';
import { JobQueue } from './jobs/queue.js';
import { runExportJob } from './jobs/worker.js';
import { startSweeper } from './jobs/sweeper.js';
import { loadJobRecords } from './jobs/store.js';
import { authRoutes } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { exportRoutes } from './routes/export.js';
import type { Services } from './services.js';

const transport = config.mock ? new MockTransport() : { request: realTransportRequest };
const queue = new JobQueue((job) => runExportJob(job, config.habitap, transport), 2);
const restoredJobs = loadJobRecords();
if (restoredJobs.length) {
  queue.restore(restoredJobs);
  console.info(`[jobs] restored ${restoredJobs.length} job record(s) from disk`);
}
const limiter = new RateLimiter(10, 10 * 60 * 1000); // 10 login attempts / 10 min / IP

const svc: Services = {
  cfg: config.habitap,
  transport,
  limiter,
  queue,
  cookieKey: config.cookieKey,
  ttlMs: config.jobTtlMs,
};

const app = new Hono();

// cap API request bodies (login/selection payloads are tiny)
app.use('/api/*', async (c, next) => {
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > 100 * 1024) return c.json({ error: 'request too large' }, 413);
  await next();
});

app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}: ${String(err).slice(0, 200)}`);
  return c.json({ error: 'internal error' }, 500);
});

app.route('/api/auth', authRoutes(svc));
app.route('/api/catalog', catalogRoutes(svc));
app.route('/api/export', exportRoutes(svc));

// prune expired rate-limit windows occasionally
setInterval(() => limiter.prune(), 15 * 60 * 1000).unref?.();

startSweeper(queue, config.jobTtlMs);

// static SPA (prod: `npm run build` writes dist-web/; paths relative to cwd)
if (fs.existsSync('dist-web')) {
  app.use('*', serveStatic({ root: './dist-web' }));
  app.get('*', serveStatic({ path: './dist-web/index.html' }));
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.info(`asr-export-web listening on :${info.port}${config.mock ? ' (MOCK_HABITAP)' : ''}`);
});
