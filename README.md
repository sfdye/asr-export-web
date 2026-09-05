# asr-export-web

Web app for Avenue South Residence residents to bulk-download their Habitap
documents as a single zip, ahead of the Habitap → iCondo property-management
migration. Built for non-technical users: sign in, pick categories, download
everything.

Sister project: [asr-export](https://github.com/sfdye/asr-export) — the
zero-server Python CLI for the same job.

Live at **https://asr.sfdye.com**.

## How it works

- **One small server** (Node 22 + TypeScript + [Hono](https://hono.dev), two
  runtime dependencies): serves the web app, proxies the Habitap API, and
  builds the zip — no database, no user accounts, no cloud services.
- **Habitap client parity with the CLI**: the upstream transport is raw
  `node:https` (never `fetch`/undici — it injects headers Habitap's WAF
  rejects), with the same login flows (email/password, one-time email code,
  remembered devices), cookie semantics, 0.4 s pacing, and retry policy as
  the Python CLI.
- **No stored credentials**: your Habitap session is sealed with AES-256-GCM
  into an HttpOnly cookie on your own browser. The server keeps no account
  state; passwords are never stored or logged.
- **Export**: documents are fetched from the Habitap CDN (paced and retried)
  into a store-only zip on the server. Progress is live; the download
  supports pause/resume (HTTP Range) and keeps working for 24 hours — the
  export page can be bookmarked and revisited without logging in.
- **Hygiene**: zips and job records are hard-deleted after 24 h; logins are
  rate-limited; jobs queue fairly (2 concurrent, max 2 active per user).

## Try it locally

```bash
npm install
MOCK_HABITAP=1 npm run dev        # http://localhost:5173
```

Mock mode runs the whole app against a fixture Habitap: any password except
`wrong`, one-time code `111111`. No real credentials needed.

To run against the real thing: `npm run dev`, then sign in with your Habitap
account (first login per browser sends a one-time code to your email).

## Env vars

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | server port (dev only; the Vite dev server proxies `/api` to it) |
| `DATA_DIR` | `.data` | zips, sweeper state, dev cookie key |
| `COOKIE_KEY` | auto-generated in `DATA_DIR` | 32-byte base64 key sealing the session cookie — set explicitly in production (`openssl rand -base64 32`) |
| `MOCK_HABITAP` | off | `1` = fixture Habitap (tests and local dev) |
| `NODE_ENV` | — | `production` makes the session cookie `Secure` |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | server (tsx watch) + web (Vite) concurrently |
| `npm run build` | compile server to `dist/`, bundle web to `dist-web/` |
| `npm start` | run the built server (serves the SPA + API on one port) |
| `npm test` | vitest suite (login flows, zip format, worker, queue, sweeper, rate limiter) |
| `npm run typecheck` | tsc over server and web |

## Deployment

Runs anywhere Node 22 runs: `npm ci && npm run build && npm start`, with
`COOKIE_KEY` set and `DATA_DIR` on persistent storage.

Current production: a DigitalOcean droplet (Ubuntu 24.04) behind
[Caddy](https://caddyserver.com) at `asr.sfdye.com` (auto-HTTPS, reverse
proxying to `localhost:3000`). The app runs as a systemd service
(`asr-export`, enabled so it starts on boot) with its environment —
`PORT=3000`, `NODE_ENV=production`, `COOKIE_KEY`,
`DATA_DIR=/var/lib/asr-export` — in `/etc/asr-export/env`.

Redeploy:

```bash
cd ~/asr-export-web
git pull --ff-only && npm ci && npm run build && npm prune --omit=dev
sudo systemctl restart asr-export   # drains first: waits for in-flight exports
```

Restarts and reboots never kill a running export: the service's `ExecStop`
hook (`deploy/drain.sh`, unit reference in `deploy/asr-export.service`)
polls `/api/health` until no job is queued or running (up to 30 min, then
it gives up and stops anyway). Hard crashes (OOM, panic) can't drain —
those jobs surface as failed with a re-run hint on the next boot.

The login rate limit keys on the last `x-forwarded-for` entry, so the app
must see the real client address there. Production sits behind Cloudflare
(which would otherwise leave a CF edge IP as the last entry), so Caddy
rewrites the header from `cf-connecting-ip` (see `deploy/Caddyfile`) and the
droplet firewall restricts 80/443 to Cloudflare's IP ranges, so the header
can't be forged by hitting the droplet IP directly.

## License

[MIT](LICENSE)
