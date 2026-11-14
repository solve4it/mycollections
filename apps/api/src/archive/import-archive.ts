import type { Media } from "@mycollections/core";
import { type DatabaseHandle, type ImportSummary, importBackup, planImport } from "@mycollections/db";
import type { JobLimiter } from "../media/job-limiter.js";
import type { MediaStore } from "../media/media-store.js";
import { processImage } from "../media/process-image.js";
import { type ArchiveLimits, openExportArchive } from "./read-export-archive.js";

export interface ImportArchiveInput {
  db: DatabaseHandle;
  store: MediaStore;
  limiter: JobLimiter;
  /** The archive, already on disk. */
  path: string;
  limits: ArchiveLimits;
  maxImagesPerItem: number;
  /** Polled between images, so a client that hung up stops the work. */
  isAborted: () => boolean;
}

/** The client went away mid-import; everything written so far is removed. */
export class ImportAbortedError extends Error {
  constructor() {
    super("import aborted");
    this.name = "ImportAbortedError";
  }
}

/**
 * Restores an export archive (#45), in the order that keeps "a row never names a
 * missing file" and "an import never touches an image it did not write":
 *
 * 1. Read and validate the archive (bounded; see `openExportArchive`).
 * 2. Plan, reading only, which image rows come in.
 * 3. For each planned image, one at a time: re-process it through the same
 *    pipeline an upload goes through — sniff, pixel cap, re-encode, metadata
 *    stripped — and write its files with `writeNew`, which refuses to replace
 *    anything. The manifest's width, height, size and type are replaced by what
 *    processing produced; the archive is not trusted for them.
 * 4. Insert collections, items and image rows in one transaction.
 *
 * Any failure removes exactly the files step 3 wrote.
 */
export async function importArchive(input: ImportArchiveInput): Promise<ImportSummary> {
  const archive = await openExportArchive(input.path, input.limits);
  const written: Media[] = [];
  try {
    const plan = planImport(input.db, archive.document, { maxImagesPerItem: input.maxImagesPerItem });
    const media: Media[] = [];
    for (const row of plan.media) {
      if (input.isAborted()) throw new ImportAbortedError();
      const bytes = await archive.readImage(row);
      const processed = await input.limiter.run(() => processImage(bytes), { wait: true });
      await input.store.writeNew(row.itemId, row.id, processed);
      written.push(row);
      media.push({
        ...row,
        mimeType: processed.mimeType,
        bytes: processed.display.length,
        width: processed.width,
        height: processed.height,
      });
    }
    return importBackup(input.db, archive.document, "skip", { media, mediaSkipped: plan.mediaSkipped });
  } catch (error) {
    await Promise.all(written.map((row) => input.store.remove(row.itemId, row.id).catch(() => {})));
    throw error;
  } finally {
    await archive.close();
  }
}
