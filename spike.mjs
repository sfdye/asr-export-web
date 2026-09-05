#!/usr/bin/env node
/**
 * asr-export-web — connectivity spike (throwaway; not part of the app)
 *
 * One run, ~8 requests, read-only except the login POST. Nothing written to disk;
 * credentials live only in this process.
 *
 *   [1] Node TLS handshake against Habitap (Python needed a strict-cert workaround)
 *   [2] email/password + OTP login from this machine's IP (the WAF question)
 *   [3] session check + account/block lookup
 *   [4] document categories + documents for your block (first 2 categories only)
 *   [5] one CDN file fetch: Content-Length availability + rough throughput
 *
 * v2: raw node:https transport. undici fetch injects sec-fetch-mode/accept/
 * accept-language headers that Habitap may reject — this version byte-matches
 * the Python CLI's urllib requests (Accept-Encoding: identity, Connection: close,
 * nothing else beyond what we set).
 *
 * Usage:
 *   node spike.mjs <email>                       # password via getpass (same as CLI)
 *   SPIKE_PASSWORD_FILE=~/.asrpw node spike.mjs <email>   # password from a file
 *   SPIKE_INSTALLATION_ID=<id> node spike.mjs <email>     # reuse the CLI's
 *     registered installationId (~/.asr/session.json) — trusted device, no OTP;
 *     use this only to bisect a persistent 401. Try any random UUID too.
 *
 * IMPORTANT: Habitap may lock the account after repeated failed logins — run at
 * most ONE login attempt per experiment, and always re-verify with the Python
 * CLI first (`asr-export.py login --force`) before blaming this script.
 *
 * Run from a datacenter IP for the real WAF verdict. Requires Node >= 20.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import readline from 'node:readline';
import { execFile } from 'node:child_process';

const BASE = 'https://avenuesouth.habitap.app/avenuesouth';
const UA = 'okhttp/4.12.0';
const CONDO_ID = 32;
const FILE_CAP = 12 * 1024 * 1024; // stop the throughput probe after 12 MB

const verdicts = [];
const pass = (k, v = 'ok') => verdicts.push([true, k, v]);
const fail = (k, v) => verdicts.push([false, k, v]);
const snippet = (s) => String(s).replace(/\s+/g, ' ').slice(0, 140);

// ---- raw transport (urllib-equivalent bytes) ----

function rawRequest(url, { method = 'GET', headers = {}, body }, redirects = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method,
        headers: {
          'Accept-Encoding': 'identity', // urllib default — no gzip to handle
          Connection: 'close', // urllib default
          ...headers,
        },
      },
      (res) => {
        const loc = res.headers.location;
        if (redirects > 0 && loc && [301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          const m2 = method === 'POST' && [301, 302, 303].includes(res.statusCode) ? 'GET' : method;
          rawRequest(new URL(loc, u).toString(), { method: m2, headers, body: m2 === 'GET' ? undefined : body }, redirects - 1).then(resolve, reject);
          return;
        }
        resolve({ status: res.statusCode, headers: res.headers, stream: res, url: u.toString() });
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error('timeout after 30s')));
    req.on('error', reject);
    req.end(body);
  });
}

async function collect(res, cap = Infinity) {
  const chunks = [];
  let bytes = 0;
  for await (const c of res.stream) {
    bytes += c.length;
    if (bytes <= cap) chunks.push(c);
    if (bytes >= cap) {
      res.stream.destroy();
      break;
    }
  }
  return { buffer: Buffer.concat(chunks), bytes };
}

// ---- cookie jar (mirrors the CLI's ~/.asr/cookies.json semantics) ----

const jar = new Map();
function absorbCookies(headers) {
  for (const c of headers['set-cookie'] || []) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    if (i < 1) continue;
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1).trim();
    if (v === 'deleteMe') jar.delete(k);
    else jar.set(k, v);
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function api(method, path, { body, apiVersion } = {}) {
  const headers = { 'User-Agent': UA };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (apiVersion) headers.apiVersion = 'V2';
  if (jar.size) headers.Cookie = cookieHeader();
  const res = await rawRequest(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
  });
  absorbCookies(res.headers);
  return res;
}

// ---- prompts ----

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt + ' ');
    // output:null + terminal:true → raw mode, no driver echo, no readline echo.
    // Type the password manually — pasting into raw mode can split on \r.
    const rl = readline.createInterface({ input: process.stdin, output: null, terminal: true });
    rl.once('line', (line) => {
      rl.close();
      process.stdout.write('\n');
      resolve(line.replace(/[\r\n]+$/, ''));
    });
    rl.once('close', () => resolve(''));
  });
}

// getpass parity: the exact input mechanism the working CLI uses (reads the tty
// directly, no paste/raw-mode/shell-quoting hazards). Prompt renders on the tty.
function askGetpass() {
  return new Promise((resolve, reject) => {
    execFile(
      'python3',
      ['-c', 'import getpass; print(getpass.getpass("  Password: "))'],
      { stdio: ['inherit', 'pipe', 'inherit'] },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.replace(/\r?\n$/, ''));
      },
    );
  });
}

async function getPassword() {
  if (process.env.SPIKE_PASSWORD !== undefined) return process.env.SPIKE_PASSWORD;
  if (process.env.SPIKE_PASSWORD_FILE) {
    return fs.readFileSync(process.env.SPIKE_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '');
  }
  try {
    return await askGetpass();
  } catch {
    return askHidden('  Password (hidden, node fallback):');
  }
}

// ---- Habitap calls (ported from asr-export.py) ----

function loginBody(username, password, otp, installationId) {
  const b = {
    username,
    password,
    devicePlatform: 'ANDROID',
    deviceToken: '',
    userTypeTag: 'RESIDENT',
    condoCode: 'AVESOU',
    rememberMe: 'true',
    installationId, // "" triggers the new-device OTP flow; a registered id skips it
    appId: 'com.habitap.residential.avesouth',
    modelName: 'Google',
    modelNumber: 'Pixel 7',
  };
  if (otp) b.otp = otp;
  return b;
}

// ---- main ----

const email = process.argv[2];
if (!email) {
  console.error('usage: node spike.mjs <email>   (env: SPIKE_PASSWORD, SPIKE_INSTALLATION_ID)');
  process.exit(2);
}

const installationId = process.env.SPIKE_INSTALLATION_ID ?? '';

async function main() {
  console.log(`\nspike → ${BASE}`);
  console.log(`installationId: ${installationId ? `reused from CLI session (${installationId.length} chars, trusted device)` : '"" (new-device flow)'}\n`);

  // [1][2] login (+TLS). A throw here is the TLS verdict.
  console.log(`[1] login as ${email}`);
  const password = await getPassword();
  // length check makes mangled input visible without ever printing the secret
  const instMode = installationId === '' ? '"" (new-device flow)' : `saved id, ${installationId.length} chars (trusted device)`;
  console.log(`  input check · username "${email}" (${email.length} chars) · password ${password.length} chars · installationId ${instMode}`);
  if (password.length === 0) {
    fail('login', 'empty password — input capture failed');
    return;
  }
  let otp = null;
  let res;
  let lastText = '';
  for (let attempt = 1; ; attempt++) {
    res = await api('POST', '/api/authentications', { body: loginBody(email, password, otp, installationId), apiVersion: true });
    lastText = (await collect(res)).buffer.toString('utf8');
    if (res.status !== 452 || attempt >= 3) break;
    console.log('  → 452: new-device verification. An OTP was emailed to you.');
    otp = await ask('  Email OTP: ');
  }
  if (res.status !== 200) {
    if (/<html/i.test(lastText)) fail('login', 'HTML/WAF interstitial instead of JSON — this IP is likely blocked');
    else fail('login', `HTTP ${res.status} — ${snippet(lastText)}`);
    return;
  }
  pass('login', `HTTP 200${otp ? ' (after OTP)' : ''} — TLS + auth OK from this IP`);

  // [3] session + account
  console.log('[2] session check');
  res = await api('GET', '/api/authentications/1');
  const meText = (await collect(res)).buffer.toString('utf8');
  if (res.status !== 200) {
    fail('session', `HTTP ${res.status} — cookies not accepted: ${snippet(meText)}`);
    return;
  }
  let me = {};
  try {
    me = JSON.parse(meText);
  } catch {
    fail('session', `non-JSON body: ${snippet(meText)}`);
    return;
  }
  const unit = me.unit || {};
  const block = unit.blockCode;
  if (!block) {
    fail('session', 'logged in but no blockCode on the account — cannot list documents');
    return;
  }
  pass('session', `${(me.authentication || {}).fullName ?? email} · unit ${unit.unitNo} · block ${block} · ${unit.condoName ?? ''}`);

  // [4] catalog (first 2 categories only — polite)
  console.log('[3] document catalog');
  res = await api('GET', `/api/condos/${CONDO_ID}/document-categories?viewFormat=PUB&condoBlockCode=${encodeURIComponent(block)}`);
  const catText = (await collect(res)).buffer.toString('utf8');
  if (res.status !== 200) {
    fail('catalog', `HTTP ${res.status} — ${snippet(catText)}`);
    return;
  }
  let cats = [];
  try {
    cats = (JSON.parse(catText).entities || []).sort((a, b) => (a.sequenceOrder || 0) - (b.sequenceOrder || 0));
  } catch {
    fail('catalog', `non-JSON body: ${snippet(catText)}`);
    return;
  }
  pass('catalog', `${cats.length} categories visible for block ${block}`);

  let firstFileDoc = null;
  let shown = 0;
  for (const c of cats) {
    if (shown >= 2) break;
    res = await api('GET', `/api/condos/${CONDO_ID}/documents?viewFormat=PUB&categoryId=${c.id}&condoBlockCode=${encodeURIComponent(block)}`);
    const docText = (await collect(res)).buffer.toString('utf8');
    if (res.status !== 200) {
      console.log(`  ! '${c.name}' failed: HTTP ${res.status}`);
      continue;
    }
    let docs = [];
    try {
      docs = JSON.parse(docText).entities || [];
    } catch {
      continue;
    }
    console.log(`  · ${c.name}: ${docs.length} docs`);
    shown++;
    if (!firstFileDoc) firstFileDoc = docs.find((d) => d.filePath) || null;
  }

  // [5] CDN file probe
  console.log('[4] CDN file probe');
  if (!firstFileDoc) {
    fail('file-fetch', 'no document with a filePath in the sampled categories');
    return;
  }
  const url = firstFileDoc.filePath;
  let headLen = null;
  let headOk = false;
  try {
    const head = await rawRequest(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
    await collect(head);
    headOk = head.status === 200;
    headLen = head.headers['content-length'];
  } catch {
    headOk = false;
  }

  const t0 = performance.now();
  const r = await rawRequest(url, { headers: { 'User-Agent': UA } });
  if (r.status !== 200) {
    fail('file-fetch', `HTTP ${r.status} on CDN url`);
    return;
  }
  const { bytes } = await collect(r, FILE_CAP);
  const dt = (performance.now() - t0) / 1000;
  const mbps = (bytes / 1024 / 1024 / dt).toFixed(2);
  pass('file-fetch', `"${(firstFileDoc.caption || '').trim().slice(0, 40)}" — ${(bytes / 1024 / 1024).toFixed(1)} MB in ${dt.toFixed(1)}s (~${mbps} MB/s)`);
  pass(
    'content-length',
    headOk ? `HEAD ok, content-length ${headLen ? `${(headLen / 1024 / 1024).toFixed(1)} MB — size estimates possible` : 'missing — count-only estimates'}` : 'HEAD not supported — count-only estimates',
  );
}

function summary() {
  console.log('\n──────── spike verdicts ────────');
  let ok = true;
  for (const [good, k, v] of verdicts) {
    if (!good) ok = false;
    console.log(` ${good ? '✓' : '✗'} ${k.padEnd(15)} ${v}`);
  }
  console.log(`──────── ${ok ? 'ALL GREEN — architecture is viable' : 'RED ITEMS — see above'} ────────`);
  console.log(` cookie names absorbed: ${[...jar.keys()].join(', ') || '(none)'}`);
  process.exit(ok ? 0 : 1);
}

try {
  await main();
} catch (e) {
  const msg = String(e?.cause?.code || e?.code || e?.cause || e);
  if (/cert|tls|ssl|X509|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(msg)) fail('tls', msg.slice(0, 160));
  else if (/timeout/i.test(msg)) fail('timeout', msg.slice(0, 160));
  else fail('network', msg.slice(0, 160));
}
summary();
