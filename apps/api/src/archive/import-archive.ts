import { setImmediate as nextTurn } from "node:timers/promises";
import type { Media } from "@mycollections/core";
import {
  type DatabaseHandle,
  type ImportMode,
  type ImportPlan,
  type ImportSummary,
  importPlanned,
  planImport,
} from "@mycollections/db";
import type { JobLimiter } from "../media/job-limiter.js";
import type { MediaStore } from "../media/media-store.js";
import { processImage } from "../media/process-image.js";
import { type ArchiveLimits, type ExportArchive, openExportArchive } from "./read-export-archive.js";

/** The client went away, or the server is closing, mid-import; everything written so far is removed. */
export class ImportAbortedError extends Error {
  constructor() {
    super("import aborted");
    this.name = "ImportAbortedError";
  }
}

export interface PrepareArchiveInput {
  db: DatabaseHandle;
  /** The archive, already on disk. */
  path: string;
  limits: ArchiveLimits;
  maxImagesPerItem: number;
  mode: ImportMode;
}

/** An archive that has been read, validated and planned, and is ready to import. */
export interface PreparedArchive {
  archive: ExportArchive;
  plan: ImportPlan;
  mode: ImportMode;
  maxImagesPerItem: number;
  /** How many images the import will process: the planned rows of new items and those to attach. */
  imagesTotal: number;
}

/**
 * Steps 1 and 2 of an archive import (#45): read and validate the archive
 * (bounded; see `openExportArchive`), then plan, reading only, which image rows
 * come in. Cheap next to processing the images, so the route does it inside the
 * request and a bad file is refused there and then, before any job exists (#452).
 * The archive stays open for `runArchiveImport`, which closes it.
 */
export async function prepareArchiveImport(input: PrepareArchiveInput): Promise<PreparedArchive> {
  const archive = await openExportArchive(input.path, input.limits);
  try {
    const plan = planImport(input.db, archive.document, {
      mode: input.mode,
      maxImagesPerItem: input.maxImagesPerItem,
    });
    return {
      archive,
      plan,
      mode: input.mode,
      maxImagesPerItem: input.maxImagesPerItem,
      imagesTotal: plan.media.length + plan.attach.length,
    };
  } catch (error) {
    await archive.close();
    throw error;
  }
}

export interface RunArchiveInput {
  db: DatabaseHandle;
  store: MediaStore;
  limiter: JobLimiter;
  prepared: PreparedArchive;
  /** Polled between images and before saving, so a closing server stops the work. */
  isAborted: () => boolean;
  /** Called after each image's files are written, with how many are done so far. */
  onImage?: (done: number) => void;
  /** Called once every image is written, just before the database transaction. */
  onSaving?: () => void;
}

/**
 * Steps 3 and 4 of an archive import (#45), in the order that keeps "a row never
 * names a missing file" and "an import never touches an image it did not write":
 *
 * 3. For each planned image, one at a time: re-process it through the same
 *    pipeline an upload goes through — sniff, pixel cap, re-encode, metadata
 *    stripped — and write its files with `writeNew`, which refuses to replace
 *    anything. The manifest's width, height, size and type are replaced by what
 *    processing produced; the archive is not trusted for them.
 * 4. Insert collections, items and image rows in one transaction.
 *
 * Any failure removes exactly the files step 3 wrote, and an image the
 * transaction could no longer attach (its item filled up meanwhile, #453) has its
 * files removed too. The archive is closed either way.
 */
export async function runArchiveImport(input: RunArchiveInput): Promise<ImportSummary> {
  const { archive, plan, mode, maxImagesPerItem } = input.prepared;
  const written: Media[] = [];
  // Past the commit, rows name the written files: a later failure must not remove them.
  let committed = false;
  try {
    const processRow = async (row: Media): Promise<Media> => {
      if (input.isAborted()) throw new ImportAbortedError();
      const bytes = await archive.readImage(row);
      const processed = await input.limiter.run(() => processImage(bytes), { wait: true });
      // The plan found no row with this id, so files under it are strays a failed
      // purge left for the sweep; they would otherwise make writeNew refuse.
      if (
        (await input.store.has(row.itemId, row.id, "display")) ||
        (await input.store.has(row.itemId, row.id, "thumb"))
      ) {
        await input.store.removeOrphan(row.itemId, row.id);
      }
      await input.store.writeNew(row.itemId, row.id, processed);
      written.push(row);
      input.onImage?.(written.length);
      return {
        ...row,
        mimeType: processed.mimeType,
        bytes: processed.display.length,
        width: processed.width,
        height: processed.height,
      };
    };
    const media: Media[] = [];
    for (const row of plan.media) media.push(await processRow(row));
    const attach: Media[] = [];
    for (const row of plan.attach) attach.push(await processRow(row));

    if (input.isAborted()) throw new ImportAbortedError();
    input.onSaving?.();
    // The transaction is synchronous; yielding once lets a poll see "saving".
    await nextTurn();
    // Already validated by the reader: importPlanned skips a second parse of what
    // can be tens of thousands of records (review of #449).
    const { summary, notAttached } = importPlanned(
      input.db,
      archive.document,
      mode,
      { ...plan, media, attach },
      { maxImagesPerItem },
    );
    committed = true;
    await Promise.all(notAttached.map((row) => input.store.remove(row.itemId, row.id).catch(() => {})));
    return summary;
  } catch (error) {
    if (!committed) {
      await Promise.all(written.map((row) => input.store.remove(row.itemId, row.id).catch(() => {})));
    }
    throw error;
  } finally {
    await archive.close();
  }
}

export interface ImportArchiveInput extends Omit<RunArchiveInput, "prepared"> {
  /** The archive, already on disk. */
  path: string;
  limits: ArchiveLimits;
  maxImagesPerItem: number;
  mode?: ImportMode;
}

/** Prepares and runs an archive import in one go. */
export async function importArchive(input: ImportArchiveInput): Promise<ImportSummary> {
  const prepared = await prepareArchiveImport({
    db: input.db,
    path: input.path,
    limits: input.limits,
    maxImagesPerItem: input.maxImagesPerItem,
    mode: input.mode ?? "skip",
  });
  return runArchiveImport({ ...input, prepared });
}
