import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  mock: boolean;
  cookieKey: Buffer;
  jobTtlMs: number;
  habitap: {
    baseUrl: string;
    condoId: number;
    condoCode: string;
    userAgent: string;
    appId: string;
    apiVersion: string;
  };
}

function loadCookieKey(dataDir: string): Buffer {
  const env = process.env.COOKIE_KEY;
  if (env) {
    const key = Buffer.from(env, 'base64');
    if (key.length !== 32) throw new Error('COOKIE_KEY must be 32 bytes of base64 (openssl rand -base64 32)');
    return key;
  }
  // dev convenience: persist a generated key so sessions survive restarts
  const file = path.join(dataDir, 'cookie.key');
  if (fs.existsSync(file)) {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length === 32) return key;
  }
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, Buffer.from(key).toString('base64'), { mode: 0o600 });
  return Buffer.from(key);
}

const dataDir = process.env.DATA_DIR ?? '.data';
export const config: Config = {
  port: Number(process.env.PORT ?? 3001),
  dataDir,
  mock: process.env.MOCK_HABITAP === '1',
  cookieKey: loadCookieKey(dataDir),
  jobTtlMs: 24 * 60 * 60 * 1000,
  habitap: {
    baseUrl: 'https://avenuesouth.habitap.app/avenuesouth',
    condoId: 32,
    condoCode: 'AVESOU',
    userAgent: 'okhttp/4.12.0',
    appId: 'com.habitap.residential.avesouth',
    apiVersion: 'V2',
  },
};

export const zipsDir = path.join(dataDir, 'zips');
fs.mkdirSync(zipsDir, { recursive: true });
