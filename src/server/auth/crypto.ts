import crypto from 'node:crypto';

// AES-256-GCM seal/open for the session cookie: the Habitap cookies,
// installationId and account info live client-side, encrypted with the
// server's key. The server keeps zero account state on disk.

export function seal(key: Buffer, value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64url');
}

export function open<T>(key: Buffer, blob: string): T | null {
  try {
    const raw = Buffer.from(blob, 'base64url');
    if (raw.length < 12 + 16) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const ciphertext = raw.subarray(12, raw.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    return null;
  }
}
