import type { AccountInfo, Category, HabitapDoc, SessionBlob } from './types.js';
import { collectStream, realTransportRequest, type RawResponse, type Transport } from './transport.js';

// Habitap API client. Login flow ported from asr-export.py (itself adapted
// from the community reverse-engineering at https://asrlife.vip):
//   - installationId "" → 452 + emailed OTP (new device)
//   - client-invented installationId → 409; a registered one logs in without OTP
//   - Set-Cookie "deleteMe" values mean "delete this cookie"

export class HabitapError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type LoginOutcome =
  | { status: 'ok'; account: AccountInfo; installationId: string; cookies: Record<string, string> }
  | { status: 'otp_required'; message: string }
  | { status: 'invalid'; message: string };

export interface HabitapConfig {
  baseUrl: string;
  condoId: number;
  condoCode: string;
  userAgent: string;
  appId: string;
  apiVersion: string;
}

const JSON_CAP = 2 * 1024 * 1024;

export class HabitapClient {
  private jar = new Map<string, string>();

  constructor(
    private cfg: HabitapConfig,
    private transport: Transport = { request: realTransportRequest },
    initialCookies: Record<string, string> = {},
  ) {
    for (const [k, v] of Object.entries(initialCookies)) this.jar.set(k, v);
  }

  // ---- cookie jar ----

  private absorbCookies(res: RawResponse) {
    for (const c of res.headers['set-cookie'] ?? []) {
      const [kv] = c.split(';');
      if (!kv) continue;
      const i = kv.indexOf('=');
      if (i < 1) continue;
      const k = kv.slice(0, i).trim();
      const v = kv.slice(i + 1).trim();
      if (v === 'deleteMe') this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }

  private cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  exportCookies(): Record<string, string> {
    return Object.fromEntries(this.jar);
  }

  // ---- request plumbing ----

  private async api(path: string, opts: { method?: string; body?: unknown; apiVersion?: boolean; retry?: boolean } = {}): Promise<RawResponse> {
    const headers: Record<string, string> = { 'User-Agent': this.cfg.userAgent };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.apiVersion) headers.apiVersion = this.cfg.apiVersion;
    if (this.jar.size) headers.Cookie = this.cookieHeader();
    const body = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));

    const tries = opts.retry === false ? 1 : 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        const res = await this.transport.request(this.cfg.baseUrl + path, { method: opts.method, headers, body });
        this.absorbCookies(res);
        return res;
      } catch (e) {
        lastErr = e;
        if (attempt === tries) break;
        await sleep(2000 * attempt);
      }
    }
    throw new HabitapError(`network error: ${String(lastErr).slice(0, 160)}`, 0);
  }

  private async json(res: RawResponse): Promise<Record<string, unknown>> {
    const { buffer } = await collectStream(res.stream, JSON_CAP);
    const raw = buffer.toString('utf8');
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { error: raw.slice(0, 200) };
    }
  }

  // ---- login ----

  private loginBody(email: string, password: string, installationId: string, otp?: string) {
    const b: Record<string, unknown> = {
      username: email,
      password,
      devicePlatform: 'ANDROID',
      deviceToken: '',
      userTypeTag: 'RESIDENT',
      condoCode: this.cfg.condoCode,
      rememberMe: 'true',
      installationId,
      appId: this.cfg.appId,
      modelName: 'Google',
      modelNumber: 'Pixel 7',
    };
    if (otp) b.otp = otp;
    return b;
  }

  async login(email: string, password: string, installationId: string, otp?: string): Promise<LoginOutcome> {
    let iid = installationId;
    let res = await this.api('/api/authentications', { method: 'POST', body: this.loginBody(email, password, iid, otp), apiVersion: true, retry: false });
    if (res.status === 409 && iid) {
      // server rejects client-invented installationIds — fall back to the OTP flow
      iid = '';
      res = await this.api('/api/authentications', { method: 'POST', body: this.loginBody(email, password, iid, otp), apiVersion: true, retry: false });
    }
    const j = await this.json(res);

    if (res.status === 452) {
      const message = typeof j['message'] === 'string' ? j['message'] : 'A one-time code has been sent to your email — please check.';
      return { status: 'otp_required', message };
    }
    if (res.status !== 200) {
      const msg = [j['auth failed'], j['message'], JSON.stringify(j)].find((v) => typeof v === 'string' && v) ?? `HTTP ${res.status}`;
      return { status: 'invalid', message: String(msg).slice(0, 160) };
    }

    // login ok — establish the session and read the account
    const account = await this.fetchAccount();
    if (!account) return { status: 'invalid', message: 'logged in, but the session could not be established — please retry' };

    // persist a server-issued installationId if the response carries one,
    // so the next login on this browser skips the OTP step (the CLI never did this)
    const issued = extractInstallationId(j);
    return {
      status: 'ok',
      account,
      installationId: issued ?? iid,
      cookies: this.exportCookies(),
    };
  }

  // ---- session ----

  async fetchAccount(): Promise<AccountInfo | null> {
    const res = await this.api('/api/authentications/1');
    if (res.status !== 200) return null;
    const me = (await this.json(res)) as {
      unit?: { id?: number; blockCode?: string; unitNo?: string; condoName?: string; condoId?: number };
      authentication?: { fullName?: string };
      residentAccount?: { id?: number; userName?: string };
    };
    return {
      username: me.residentAccount?.userName,
      fullName: me.authentication?.fullName,
      unitNo: me.unit?.unitNo,
      blockCode: me.unit?.blockCode,
      condoName: me.unit?.condoName,
      condoId: me.unit?.condoId ?? this.cfg.condoId,
    };
  }

  // ---- catalog ----

  async categories(blockCode: string): Promise<Category[]> {
    const res = await this.api(`/api/condos/${this.cfg.condoId}/document-categories?viewFormat=PUB&condoBlockCode=${encodeURIComponent(blockCode)}`);
    if (res.status !== 200) throw new HabitapError(`categories failed (HTTP ${res.status})`, res.status);
    const j = (await this.json(res)) as { entities?: Category[] };
    return (j.entities ?? []).slice().sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0) || a.id - b.id);
  }

  async documents(categoryId: number, blockCode: string): Promise<HabitapDoc[]> {
    const res = await this.api(
      `/api/condos/${this.cfg.condoId}/documents?viewFormat=PUB&categoryId=${categoryId}&condoBlockCode=${encodeURIComponent(blockCode)}`,
    );
    if (res.status !== 200) throw new HabitapError(`documents failed for category ${categoryId} (HTTP ${res.status})`, res.status);
    const j = (await this.json(res)) as { entities?: HabitapDoc[] };
    return j.entities ?? [];
  }

  /** Full deduped catalog for the account's block. */
  async catalog(blockCode: string) {
    const cats = await this.categories(blockCode);
    const entries: { category: Category; docs: HabitapDoc[] }[] = [];
    for (const c of cats) {
      const docs = await this.documents(c.id, blockCode);
      if (docs.length) entries.push({ category: c, docs });
    }
    return entries;
  }

  // ---- files ----

  /** Streams a document file from the CDN (redirects followed, okhttp UA). */
  async downloadFile(url: string): Promise<{ stream: RawResponse['stream']; length: number | null }> {
    const res = await this.transport.request(url, { headers: { 'User-Agent': this.cfg.userAgent }, timeoutMs: 60000 });
    if (res.status !== 200) throw new HabitapError(`CDN fetch failed (HTTP ${res.status})`, res.status);
    const len = res.headers['content-length'];
    return { stream: res.stream, length: len ? Number(len) : null };
  }

  /** Content-Length via HEAD — per-doc size without downloading (null on failure). */
  async headFileLength(url: string): Promise<number | null> {
    try {
      const res = await this.transport.request(url, { method: 'HEAD', headers: { 'User-Agent': this.cfg.userAgent }, timeoutMs: 15000 });
      if (res.status !== 200) return null;
      const len = res.headers['content-length'];
      return len ? Number(len) : null;
    } catch {
      return null;
    }
  }
}

function extractInstallationId(j: Record<string, unknown>): string | null {
  const candidates = [j['installationId'], (j['device'] as Record<string, unknown> | undefined)?.['installationId'], (j['authentication'] as Record<string, unknown> | undefined)?.['installationId']];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function clientFromSession(blob: SessionBlob, cfg: HabitapConfig, transport: Transport): HabitapClient {
  return new HabitapClient(cfg, transport, blob.cookies);
}
