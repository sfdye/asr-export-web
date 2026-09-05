import fs from 'node:fs';
import path from 'node:path';
import { dedupCatalog, docFilename, docKind, sanitize, type CatalogEntry } from '../habitap/catalog.js';
import { HabitapError, clientFromSession, sleep, type HabitapClient, type HabitapConfig } from '../habitap/client.js';
import { collectStream, type Transport } from '../habitap/transport.js';
import type { SessionBlob } from '../habitap/types.js';
import type { ExportJob } from './queue.js';
import { zipsDir } from '../config.js';
import { StoreZipWriter } from './zip.js';

// The export worker: walks the selected categories, fetches each document
// from the Habitap CDN (paced, retried — CLI parity: 0.4 s pacing, 3 tries,
// 1.5 s × attempt backoff), and writes everything into a store-only zip.
// Files that could not be fetched are reported on the job (shown in the UI).

export interface WorkerOpts {
  paceMs?: number; // pause between documents (default 400, CLI parity)
  retryBaseMs?: number; // backoff base (default 1500, CLI parity)
  fileCapBytes?: number; // refuse to buffer absurdly large single files
}

const DEFAULTS = { paceMs: 400, retryBaseMs: 1500, fileCapBytes: 192 * 1024 * 1024 };

export async function runExportJob(
  job: ExportJob,
  cfg: HabitapConfig,
  transport: Transport,
  opts: WorkerOpts = {},
): Promise<void> {
  const { paceMs, retryBaseMs, fileCapBytes } = { ...DEFAULTS, ...opts };
  const client = clientFromSession(job.blob, cfg, transport);
  const zipPath = path.join(zipsDir, `${job.id}.zip`);
  job.zipPath = zipPath;
  job.zipName = exportZipName(job.blob.account.unitNo);

  let writer: StoreZipWriter | null = null;
  try {
    const block = job.blob.account.blockCode ?? '';
    const catalog: CatalogEntry[] = await client.catalog(block);
    const selected = dedupCatalog(catalog.filter((e) => job.categoryIds.includes(e.category.id)));
    const docs = selected.flatMap((e) => e.docs);
    job.progress.total = docs.length;

    if (docs.length === 0) throw new HabitapError('no documents found for the selected categories', 0);

    writer = new StoreZipWriter(zipPath);
    const usedNames = new Set<string>();

    const addEntry = (name: string, buf: Buffer) => {
      let final = name;
      while (usedNames.has(final)) {
        const i = final.lastIndexOf('.');
        const stem = i > 0 ? final.slice(0, i) : final;
        const ext = i > 0 ? final.slice(i) : '';
        final = `${stem} [${usedNames.size + 1}]${ext}`;
      }
      usedNames.add(final);
      writer!.addBuffer(final, buf);
    };

    let n = 0;
    for (const { category, docs: catDocs } of selected) {
      const dir = sanitize(category.name, 60);
      for (const doc of catDocs) {
        job.progress.currentFile = doc.caption?.trim() || `doc ${doc.id}`;
        const kind = docKind(doc);
        const entryName = `${dir}/${docFilename(doc)}`;

        if (kind === 'link') {
          addEntry(`${dir}/${sanitize(doc.caption)}.url`, Buffer.from(`${doc.externalUrl}\n`, 'utf8'));
          job.progress.done = ++n;
        } else if (kind === 'none') {
          job.failedFiles.push({ path: entryName, reason: 'no file or link on this document' });
          job.progress.failed++;
          job.progress.done = ++n;
        } else {
          const result = await fetchIntoZip(client, entryName, doc.filePath!, { retryBaseMs, fileCapBytes }, (buf) => addEntry(entryName, buf));
          if (result !== 'ok') {
            job.failedFiles.push({
              path: entryName,
              reason: result === 'cap' ? 'file exceeds the single-file size cap' : 'download failed after retries',
            });
            job.progress.failed++;
          }
          job.progress.done = ++n;
        }

        if (n < job.progress.total) await sleep(paceMs); // polite pacing
      }
    }

    const { size } = writer.finish();
    writer = null;
    job.zipSize = size;
    job.status = 'done';
    job.finishedAt = Date.now();
    job.progress.currentFile = undefined;
  } catch (e) {
    if (writer) writer.abort();
    job.status = 'failed';
    job.error =
      e instanceof HabitapError && (e.status === 401 || e.status === 403)
        ? 'your Habitap session expired during the export — log in again and retry'
        : String(e instanceof Error ? e.message : e).slice(0, 200);
    job.finishedAt = Date.now();
    job.progress.currentFile = undefined;
    try {
      fs.rmSync(zipPath, { force: true }); // partial zips of failed jobs are useless
    } catch {}
    job.zipPath = undefined;
  }
}

type FetchResult = 'ok' | 'retries' | 'cap';

async function fetchIntoZip(
  client: HabitapClient,
  entryName: string,
  url: string,
  opts: { retryBaseMs: number; fileCapBytes: number },
  write: (buf: Buffer) => void,
): Promise<FetchResult> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { stream } = await client.downloadFile(url);
      const { buffer, bytes } = await collectStream(stream, opts.fileCapBytes);
      if (bytes > opts.fileCapBytes) {
        console.warn(`[job] ${entryName}: ${(bytes / 1048576).toFixed(0)} MB exceeds the single-file cap, skipping`);
        return 'cap';
      }
      write(buffer);
      return 'ok';
    } catch (e) {
      if (attempt === 3) {
        console.warn(`[job] ${entryName}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
        return 'retries';
      }
      await sleep(opts.retryBaseMs * attempt);
    }
  }
  return 'retries';
}

function exportZipName(unitNo?: string): string {
  const unit = (unitNo ?? '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'unit';
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `ASR-documents-${unit}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}
