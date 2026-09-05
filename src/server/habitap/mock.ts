import { Readable } from 'node:stream';
import type { IncomingHttpHeaders } from 'node:http';
import type { RawResponse, Transport, TransportRequestOpts } from './transport.js';
import type { AccountInfo } from './types.js';

// Fixture Habitap for MOCK_HABITAP=1 — same wire behavior as the real API
// (452/OTP, 409 on invented installationIds, deleteMe cookies, 401 JSON),
// so the whole app is drivable end-to-end without real credentials.
//
//   accepted password: anything except "wrong"
//   OTP for new devices: 111111
//   issued installationIds are remembered → next login skips OTP
//   /mock-cdn/fail.pdf always 500s (exercises FAILED.txt)
//   /mock-cdn/slow.pdf trickles slowly (exercises progress)

const OTP = '111111';
const BAD_PASSWORD = 'wrong';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function res(status: number, headers: IncomingHttpHeaders, body: Buffer | string): RawResponse {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  return { status, headers, stream: Readable.from([buf]), url: 'mock://' };
}

function jsonRes(status: number, body: unknown, setCookie?: string[]): RawResponse {
  const headers: IncomingHttpHeaders = { 'content-type': 'application/json' };
  if (setCookie) headers['set-cookie'] = setCookie;
  return res(status, headers, JSON.stringify(body));
}

function mockAccount(email: string): AccountInfo {
  return {
    username: email,
    fullName: 'Mock Resident',
    unitNo: '#12-34',
    blockCode: 'AVESOU11',
    condoName: 'Avenue South Residence',
    condoId: 32,
  };
}

const CATEGORIES = [
  { id: 1, name: 'Drawings', sequenceOrder: 1 },
  { id: 2, name: 'Operating Manuals & Warranties', sequenceOrder: 2 },
  { id: 3, name: 'Circulars', sequenceOrder: 3 },
];

const DOCS: Record<number, { id: number; caption: string; description?: string; filePath?: string; externalUrl?: string; fileType?: string }[]> = {
  1: [
    { id: 101, caption: 'Floor Plan 12-34', filePath: 'https://cdn.mock/doc-101.pdf', fileType: 'application/pdf' },
    { id: 102, caption: 'Ceiling Plan', filePath: 'https://cdn.mock/doc-102.pdf', fileType: 'application/pdf' },
    { id: 103, caption: 'M&E Layout', filePath: 'https://cdn.mock/slow.pdf', fileType: 'application/pdf' },
    { id: 104, caption: 'Window Schedule', filePath: 'https://cdn.mock/doc-104.pdf', fileType: 'application/pdf' },
    { id: 105, caption: 'Door Schedule', filePath: 'https://cdn.mock/doc-105.pdf', fileType: 'application/pdf' },
  ],
  2: [
    { id: 201, caption: 'Aircon Warranty', filePath: 'https://cdn.mock/doc-201.pdf', fileType: 'application/pdf' },
    { id: 202, caption: 'Novade Portal', externalUrl: 'https://novade.net/' },
    { id: 203, caption: 'Corrupted Scan', filePath: 'https://cdn.mock/fail.pdf', fileType: 'application/pdf' },
    { id: 204, caption: 'Water Heater Manual', filePath: 'https://cdn.mock/doc-204.pdf', fileType: 'application/pdf' },
  ],
  3: [
    { id: 301, caption: 'Move-in Notice', filePath: 'https://cdn.mock/doc-301.pdf', fileType: 'application/pdf' },
    { id: 302, caption: 'Renovation Rules', filePath: 'https://cdn.mock/doc-302.pdf', fileType: 'application/pdf' },
  ],
};

function fakePdf(seed: string, kb: number): Buffer {
  const unit = Buffer.from(`${seed} mock pdf content — `, 'utf8');
  const chunks = Math.ceil((kb * 1024) / unit.length);
  return Buffer.concat(Array.from({ length: chunks }, () => unit)).subarray(0, kb * 1024);
}

export class MockTransport implements Transport {
  private issuedInstallationIds = new Set<string>();
  private sessions = new Map<string, AccountInfo>();

  async request(url: string, opts: TransportRequestOpts = {}): Promise<RawResponse> {
    await delay(30 + Math.random() * 60);
    const u = new URL(url);
    const path = u.pathname.replace(/^.*\/api\//, 'api/');
    const method = (opts.method ?? 'GET').toUpperCase();

    // ---- CDN ----
    if (u.hostname === 'cdn.mock') {
      const isHead = method === 'HEAD';
      if (u.pathname === '/fail.pdf') return res(500, { 'content-type': 'text/plain' }, isHead ? '' : 'mock CDN failure');
      const buf =
        u.pathname === '/slow.pdf' ? fakePdf('slow', 900)
        : u.pathname === '/doc-101.pdf' ? fakePdf('doc-101', 120)
        : fakePdf(u.pathname.split('/')[1] ?? 'x', 40);
      if (isHead) return res(200, { 'content-type': 'application/pdf', 'content-length': String(buf.length) }, '');
      if (u.pathname === '/slow.pdf') return this.slowTrickle(buf, 40);
      return this.fileRes(buf);
    }

    // ---- login ----
    if (path === 'api/authentications' && method === 'POST') {
      const body = JSON.parse((opts.body ?? '{}').toString('utf8')) as { username: string; password: string; installationId: string; otp?: string };
      if (body.password === BAD_PASSWORD) {
        return jsonRes(401, { 'auth failed': 'The username or password you entered is incorrect or your account is disabled.' });
      }
      if (body.installationId && !this.issuedInstallationIds.has(body.installationId)) {
        return jsonRes(409, { message: 'Device is not recognized.' });
      }
      if (!body.installationId && body.otp !== OTP) {
        return jsonRes(452, { message: 'A one-time code has been sent to your email — please check.' });
      }
      // 200 — register the device + session cookie
      const iid = body.installationId || `mock-inst-${Math.random().toString(36).slice(2, 10)}`;
      this.issuedInstallationIds.add(iid);
      const token = `sess-${Math.random().toString(36).slice(2)}`;
      this.sessions.set(token, mockAccount(body.username));
      return jsonRes(200, { installationId: iid }, [`MOCKSESS=${token}; Path=/; HttpOnly`, `rememberMe=${token}-rm; Path=/`]);
    }

    // ---- session ----
    if (path === 'api/authentications/1') {
      const token = this.cookieValue(opts.headers?.Cookie ?? '', 'MOCKSESS');
      const account = token ? this.sessions.get(token) : undefined;
      if (!account) return jsonRes(401, { unauthenticated: 'You need to be authenticated to access this resource.' });
      return jsonRes(200, {
        authentication: { fullName: account.fullName },
        residentAccount: { userName: account.username },
        unit: { blockCode: account.blockCode, unitNo: account.unitNo, condoName: account.condoName, condoId: account.condoId },
      });
    }

    // ---- catalog (session required, like the real API) ----
    const token = this.cookieValue(opts.headers?.Cookie ?? '', 'MOCKSESS');
    if (!token || !this.sessions.has(token)) {
      return jsonRes(401, { unauthenticated: 'You need to be authenticated to access this resource.' });
    }
    if (path === 'api/condos/32/document-categories') return jsonRes(200, { entities: CATEGORIES });
    const mDocs = path.match(/^api\/condos\/32\/documents$/);
    if (mDocs) {
      const catId = Number(u.searchParams.get('categoryId'));
      return jsonRes(200, { entities: DOCS[catId] ?? [] });
    }

    return jsonRes(404, { error: `mock: no route for ${method} ${path}` });
  }

  private cookieValue(cookie: string, name: string): string | null {
    for (const kv of cookie.split(';')) {
      const i = kv.indexOf('=');
      if (i > 0 && kv.slice(0, i).trim() === name) return kv.slice(i + 1).trim();
    }
    return null;
  }

  private fileRes(buf: Buffer): RawResponse {
    return res(200, { 'content-type': 'application/pdf', 'content-length': String(buf.length) }, buf);
  }

  /** trickles a buffer in small chunks with pauses — for progress-bar testing */
  private slowTrickle(buf: Buffer, msPerChunk: number): RawResponse {
    const chunkSize = Math.max(1, Math.floor(buf.length / 20));
    let i = 0;
    const stream = new Readable({
      read() {
        if (i >= buf.length) {
          this.push(null);
          return;
        }
        const slice = buf.subarray(i, i + chunkSize);
        i += chunkSize;
        setTimeout(() => this.push(slice), msPerChunk);
      },
    });
    return { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(buf.length) }, stream, url: 'mock://' };
  }
}
