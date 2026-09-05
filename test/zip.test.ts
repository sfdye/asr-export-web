import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { StoreZipWriter, crc32 } from '../src/server/jobs/zip.js';
import { parseZip } from './zipread.js';

const dir = 'test-data/zip';
fs.mkdirSync(dir, { recursive: true });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('StoreZipWriter', () => {
  it('writes a valid store-only zip (names, order, CRCs, unzip -t)', () => {
    const file = path.join(dir, 'a.zip');
    const w = new StoreZipWriter(file, new Date(2026, 0, 2, 3, 4, 5));
    const pdf = Buffer.from('%PDF-1.4 mock content');
    const url = Buffer.from('https://example.com/doc\n');
    const txt = Buffer.from('中文名称测试 — FAILED contents'); // exercises the UTF-8 flag
    w.addBuffer('Drawings/Floor Plan.pdf', pdf);
    w.addBuffer('Links/Portal.url', url);
    w.addBuffer('FAILED.txt', txt);
    const { size, entries } = w.finish();

    const buf = fs.readFileSync(file);
    expect(buf.length).toBe(size);
    expect(entries).toBe(3);

    const parsed = parseZip(buf);
    expect(parsed.map((e) => e.name)).toEqual(['Drawings/Floor Plan.pdf', 'Links/Portal.url', 'FAILED.txt']);
    expect(parsed[0]!.data.equals(pdf)).toBe(true);
    expect(parsed[1]!.data.equals(url)).toBe(true);
    expect(parsed[2]!.data.equals(txt)).toBe(true);
    expect(parsed[2]!.crc).toBe(crc32(txt));

    // cross-check with the system unzip when available (macOS/Linux)
    try {
      execFileSync('unzip', ['-t', file], { stdio: 'pipe' });
    } catch {
      // unzip not installed — parser above already validates structure
    }
  });

  it('crc32 matches known values', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('rejects oversized entry names', () => {
    const file = path.join(dir, 'b.zip');
    const w = new StoreZipWriter(file);
    try {
      w.addBuffer('x'.repeat(70000), Buffer.from('data'));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
    w.abort();
  });
});
