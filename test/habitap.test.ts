import { describe, expect, it } from 'vitest';
import { HabitapClient, HabitapError, clientFromSession } from '../src/server/habitap/client.js';
import { MockTransport } from '../src/server/habitap/mock.js';
import { collectStream } from '../src/server/habitap/transport.js';
import type { HabitapConfig } from '../src/server/habitap/client.js';

const cfg: HabitapConfig = {
  baseUrl: 'https://avenuesouth.habitap.app/avenuesouth',
  condoId: 32,
  condoCode: 'AVESOU',
  userAgent: 'okhttp/4.12.0',
  appId: 'com.habitap.residential.avesouth',
  apiVersion: 'V2',
};

describe('HabitapClient against the mock world', () => {
  it('full login flow: 401 bad password → 452 OTP → 200, session, catalog, download', async () => {
    const transport = new MockTransport();
    const client = new HabitapClient(cfg, transport);

    // wrong password
    const bad = await client.login('resident@example.com', 'wrong', '');
    expect(bad.status).toBe('invalid');
    expect(bad).toMatchObject({ status: 'invalid', message: expect.stringContaining('incorrect') });

    // new device → OTP required
    const otpNeeded = await client.login('resident@example.com', 'password1', '');
    expect(otpNeeded.status).toBe('otp_required');

    // wrong OTP is rejected (still 452)
    const badOtp = await client.login('resident@example.com', 'password1', '', '999999');
    expect(badOtp.status).toBe('otp_required');

    // correct OTP → logged in
    const ok = await client.login('resident@example.com', 'password1', '', '111111');
    expect(ok.status).toBe('ok');
    if (ok.status !== 'ok') throw new Error('unreachable');
    expect(ok.installationId).toMatch(/^mock-inst-/);
    expect(ok.account.blockCode).toBe('AVESOU11');
    expect(ok.account.unitNo).toBe('#12-34');
    expect(ok.cookies['MOCKSESS']).toBeTruthy();

    // session works
    const sessionClient = clientFromSession({ cookies: ok.cookies, installationId: ok.installationId, email: 'resident@example.com', account: ok.account }, cfg, transport);
    const account = await sessionClient.fetchAccount();
    expect(account?.fullName).toBe('Mock Resident');

    // no session → null
    expect(await new HabitapClient(cfg, transport).fetchAccount()).toBeNull();

    // catalog
    const catalog = await sessionClient.catalog('AVESOU11');
    expect(catalog.map((e) => e.category.name)).toEqual(['Drawings', 'Operating Manuals & Warranties', 'Circulars']);
    expect(catalog.map((e) => e.docs.length)).toEqual([5, 4, 2]);

    // CDN download
    const dl = await sessionClient.downloadFile('https://cdn.mock/doc-101.pdf');
    const { buffer } = await collectStream(dl.stream);
    expect(buffer.length).toBe(120 * 1024);
    expect(buffer.subarray(0, 20).toString()).toContain('doc-101');

    // CDN failure raises (worker retries)
    await expect(sessionClient.downloadFile('https://cdn.mock/fail.pdf')).rejects.toBeInstanceOf(HabitapError);
  });

  it('a registered installationId skips the OTP step', async () => {
    const transport = new MockTransport();
    const first = await new HabitapClient(cfg, transport).login('resident@example.com', 'password1', '', '111111');
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') throw new Error('unreachable');

    const second = await new HabitapClient(cfg, transport).login('resident@example.com', 'password1', first.installationId);
    expect(second.status).toBe('ok');
  });

  it('a client-invented installationId gets 409 then falls back to the OTP flow', async () => {
    const transport = new MockTransport();
    const res = await new HabitapClient(cfg, transport).login('resident@example.com', 'password1', 'totally-fake-iid');
    expect(res.status).toBe('otp_required'); // 409 handled internally, then 452
  });

  it('headFileLength reports sizes without downloading; failures yield null', async () => {
    const client = new HabitapClient(cfg, new MockTransport());
    expect(await client.headFileLength('https://cdn.mock/doc-101.pdf')).toBe(120 * 1024);
    expect(await client.headFileLength('https://cdn.mock/doc-102.pdf')).toBe(40 * 1024);
    expect(await client.headFileLength('https://cdn.mock/fail.pdf')).toBeNull();
    expect(await client.headFileLength('https://other.mock/file.pdf')).toBeNull();
  });
});
