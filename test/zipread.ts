// Shared minimal ZIP reader for tests.

export interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
}

export function parseZip(buf: Buffer): ZipEntry[] {
  const sig = buf.readUInt32LE(buf.length - 22);
  if (sig !== 0x06054b50) throw new Error(`not an EOCD: 0x${sig.toString(16)}`);
  const eocd = buf.subarray(buf.length - 22);
  const count = eocd.readUInt16LE(10);
  let p = eocd.readUInt32LE(16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory signature');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (method !== 0) throw new Error(`entry ${name} is not store method`);
    if (csize !== usize) throw new Error(`entry ${name} size mismatch`);
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    entries.push({ name, data: buf.subarray(dataStart, dataStart + usize), crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
