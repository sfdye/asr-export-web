import fs from 'node:fs';

// Minimal store-only (no compression) ZIP writer. PDFs/images don't compress
// anyway, and store mode lets us write entries in a single sequential pass.
// Layout: local file headers + raw data, then central directory + EOCD.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface EntryMeta {
  nameBuf: Buffer;
  crc: number;
  size: number;
  offset: number;
}

function dosDateTime(d = new Date()): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const MAX32 = 0xffffffff;

export class StoreZipWriter {
  private fd: number;
  private entries: EntryMeta[] = [];
  private offset = 0;
  private readonly dos: { time: number; date: number };

  constructor(filePath: string, now = new Date()) {
    this.fd = fs.openSync(filePath, 'w');
    this.dos = dosDateTime(now);
  }

  private write(buf: Buffer) {
    let written = 0;
    while (written < buf.length) {
      written += fs.writeSync(this.fd, buf, written, buf.length - written);
    }
    this.offset += buf.length;
  }

  addBuffer(name: string, buf: Buffer): void {
    const nameBuf = Buffer.from(name, 'utf8');
    if (nameBuf.length > 0xffff) throw new Error(`zip entry name too long: ${name.slice(0, 80)}`);
    if (this.offset + 30 + nameBuf.length + buf.length > MAX32) throw new Error('zip exceeds 4 GB limit');
    const crc = crc32(buf);
    const offset = this.offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // general purpose flags: UTF-8 names
    local.writeUInt16LE(0, 8); // compression method: store
    local.writeUInt16LE(this.dos.time, 10);
    local.writeUInt16LE(this.dos.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(buf.length, 18); // compressed size
    local.writeUInt32LE(buf.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    this.write(local);
    this.write(nameBuf);
    this.write(buf);

    this.entries.push({ nameBuf, crc, size: buf.length, offset });
  }

  /** Writes the central directory and EOCD, closes the file. */
  finish(): { size: number; entries: number } {
    if (this.entries.length > 0xffff) throw new Error('zip exceeds 65535 entries');
    const cdStart = this.offset;
    for (const e of this.entries) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0); // central directory header signature
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed to extract
      cd.writeUInt16LE(0x0800, 8); // flags: UTF-8
      cd.writeUInt16LE(0, 10); // method: store
      cd.writeUInt16LE(this.dos.time, 12);
      cd.writeUInt16LE(this.dos.date, 14);
      cd.writeUInt32LE(e.crc, 16);
      cd.writeUInt32LE(e.size, 20);
      cd.writeUInt32LE(e.size, 24);
      cd.writeUInt16LE(e.nameBuf.length, 28);
      cd.writeUInt16LE(0, 30); // extra
      cd.writeUInt16LE(0, 32); // comment
      cd.writeUInt16LE(0, 34); // disk number start
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(0, 38); // external attrs
      cd.writeUInt32LE(e.offset, 42); // local header offset
      this.write(cd);
      this.write(e.nameBuf);
    }
    const cdSize = this.offset - cdStart;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // central dir disk
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20); // comment length
    this.write(eocd);

    fs.closeSync(this.fd);
    return { size: this.offset, entries: this.entries.length };
  }

  /** Abort: close and leave the partial file for the caller to delete. */
  abort(): void {
    fs.closeSync(this.fd);
  }
}
