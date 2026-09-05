// Shared catalog helpers, ported from asr-export.py (dedup, sanitize, naming).

import type { Category, HabitapDoc } from './types.js';

export interface CatalogEntry {
  category: Category;
  docs: HabitapDoc[];
}

/** Assigns each doc id to the first category that contains it (drops later duplicates). */
export function dedupCatalog(entries: CatalogEntry[]): CatalogEntry[] {
  const seen = new Set<number>();
  const result: CatalogEntry[] = [];
  for (const { category, docs } of entries) {
    const kept = docs.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
    if (kept.length) result.push({ category, docs: kept });
  }
  return result;
}

export function sanitize(name: unknown, maxlen = 120): string {
  let s = String(name ?? '').trim().replace(/\t/g, ' ');
  s = s.replace(/[/\\:*?"<>|]/g, '-');
  s = s.split(/\s+/).filter(Boolean).join(' ');
  s = s.slice(0, maxlen) || 'untitled';
  return s.replace(/[. ]+$/, '');
}

const MIME_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'text/plain': '.txt',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

const PATH_EXTS = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.txt', '.doc', '.docx', '.xls', '.xlsx'];

export function docFilename(doc: HabitapDoc): string {
  const url = doc.filePath ?? '';
  const bare = url.toLowerCase().split('?')[0] ?? '';
  for (const ext of PATH_EXTS) {
    if (bare.endsWith(ext)) return sanitize(doc.caption) + ext;
  }
  return sanitize(doc.caption) + (MIME_EXT[doc.fileType ?? ''] ?? '.bin');
}

export type DocKind = 'file' | 'link' | 'none';

export function docKind(doc: HabitapDoc): DocKind {
  if (doc.filePath) return 'file';
  if ((doc.externalUrl ?? '').startsWith('http')) return 'link';
  return 'none';
}

export function docUrl(doc: HabitapDoc): string | null {
  const kind = docKind(doc);
  if (kind === 'file') return doc.filePath ?? null;
  if (kind === 'link') return doc.externalUrl ?? null;
  return null;
}
