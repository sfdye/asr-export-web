import http from 'node:http';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';

// Raw transport. CRITICAL: do not switch this to fetch/undici — undici injects
// sec-fetch-mode/accept/accept-language headers that Habitap rejects (proven
// during the spike). This byte-matches the Python CLI's urllib requests:
// Accept-Encoding: identity, Connection: close, nothing beyond what we set.

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  stream: Readable;
  url: string;
}

export interface TransportRequestOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer;
  timeoutMs?: number;
}

export interface Transport {
  request(url: string, opts?: TransportRequestOpts): Promise<RawResponse>;
}

export function realTransportRequest(url: string, opts: TransportRequestOpts = {}, redirects = 5): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method: opts.method ?? 'GET',
        headers: {
          'Accept-Encoding': 'identity',
          Connection: 'close',
          ...opts.headers,
        },
      },
      (res) => {
        const loc = res.headers.location;
        if (redirects > 0 && loc && [301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          res.resume();
          const m2 = (opts.method ?? 'GET') === 'POST' && [301, 302, 303].includes(res.statusCode ?? 0) ? 'GET' : opts.method ?? 'GET';
          realTransportRequest(new URL(loc, u).toString(), { ...opts, method: m2, body: m2 === 'GET' ? undefined : opts.body }, redirects - 1).then(resolve, reject);
          return;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res, url: u.toString() });
      },
    );
    req.setTimeout(opts.timeoutMs ?? 30000, () => req.destroy(new Error(`timeout after ${opts.timeoutMs ?? 30000}s`)));
    req.on('error', reject);
    req.end(opts.body);
  });
}

export const realTransport: Transport = { request: realTransportRequest };

/** Drain a stream into a buffer. `cap` bounds memory; the stream is destroyed
 *  once the cap is crossed (bytes keeps the true count). */
export async function collectStream(stream: Readable, cap = Infinity): Promise<{ buffer: Buffer; bytes: number }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const c of stream) {
    const chunk = c as Buffer;
    bytes += chunk.length;
    if (bytes <= cap) chunks.push(chunk);
    if (bytes >= cap) {
      stream.destroy();
      break;
    }
  }
  return { buffer: Buffer.concat(chunks), bytes };
}
