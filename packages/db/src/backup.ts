import { EXPORT_VERSION, type ExportDocument, ExportDocumentSchema, type Media } from "@mycollections/core";
import type { DatabaseHandle } from "./open-database.js";

/**
 * Import conflict strategy. In both, a collection or item row whose id already
 * exists is left untouched, so imports are idempotent and never destructive.
 *
 * - "skip": an existing item's images are skipped along with it.
 * - "attach-media" (#453): an existing item also gets the archive's live images
 *   whose ids are free, appended after its own, up to the per-item cap.
 */
export type ImportMode = "skip" | "attach-media";

export const IMPORT_MODES: readonly ImportMode[] = ["skip", "attach-media"];

/**
 * What an import did. Every image row in the document is counted exactly once,
 * in one of the four media counts.
 */
export interface ImportSummary {
  collectionsImported: number;
  collectionsSkipped: number;
  itemsImported: number;
  itemsSkipped: number;
  /** Images that came in with an item the import added. */
  mediaImported: number;
  /** Images added to an item that was already here ("attach-media" only). */
  mediaAttached: number;
  /** Images left out because their item was already here, their id was taken, or (attaching) they were trashed. */
  mediaSkipped: number;
  /** Images left out because their existing item already held as many as it may ("attach-media" only). */
  mediaOverLimit: number;
}

/**
 * Builds a portable backup of every collection, item and image row, including
 * soft-deleted records, so restoring loses no data or deletion history. The image
 * files are the caller's to add beside it (#45).
 */
export async function exportBackup(handle: DatabaseHandle): Promise<ExportDocument> {
  const collections = await handle.collections.list({ includeDeleted: true });
  const items = (
    await Promise.all(collections.map((c) => handle.items.listByCollection(c.id, { includeDeleted: true })))
  ).flat();
  const media = await handle.media.listForItems(items.map((item) => item.id));
  return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), collections, items, media };
}

/**
 * One live collection, in the same format as a full backup (#45): its items,
 * trashed ones included, and every image row of those items. Null for a
 * collection that is missing or in the trash — the same answer the collection's
 * own page gets.
 */
export async function exportCollection(handle: DatabaseHandle, collectionId: string): Promise<ExportDocument | null> {
  const collection = await handle.collections.getById(collectionId);
  if (collection === null) return null;
  const items = await handle.items.listByCollection(collection.id, { includeDeleted: true });
  const media = await handle.media.listForItems(items.map((item) => item.id));
  return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), collections: [collection], items, media };
}

/** An item in the import would hold more live images than one item may. */
export class TooManyImagesError extends Error {
  constructor() {
    super("an item in the import holds more images than one item may");
    this.name = "TooManyImagesError";
  }
}

export interface ImportPlan {
  /** Image rows of items the import adds; the caller writes exactly these files before importing. */
  media: Media[];
  /** Image rows to append to items already here ("attach-media"); their files are written first too. */
  attach: Media[];
  /** Image rows left out; see `ImportSummary.mediaSkipped`. */
  mediaSkipped: number;
  /** Image rows left out over an existing item's cap; see `ImportSummary.mediaOverLimit`. */
  mediaOverLimit: number;
}

export interface PlanOptions {
  mode?: ImportMode;
  /** Most live images one item may hold; the upload route's limit. */
  maxImagesPerItem?: number;
}

const DEFAULT_MAX_IMAGES_PER_ITEM = 50;

/**
 * Decides which image rows an import will add, reading only (#45). It runs
 * before any file is written, so the import can never write a file over an
 * image that is already here.
 *
 * An image comes in only with an item the import adds: the images of an item
 * already in the database are skipped, as the item itself is, so an import
 * never changes what an existing item looks like. An image whose id is already
 * taken is skipped too.
 *
 * In "attach-media" mode (#453) an existing item's live images with free ids are
 * planned to be appended instead, in archive order, counting the item's own live
 * images against the cap; the excess is left out and counted, not refused —
 * attaching to an item that already has photos reaching the cap is an ordinary
 * outcome. Trashed archive images are not attached: the point is to bring back
 * photos, not to fill the trash.
 *
 * @throws TooManyImagesError if an added item would hold more live images than allowed.
 */
export function planImport(handle: DatabaseHandle, document: ExportDocument, options: PlanOptions = {}): ImportPlan {
  const mode = options.mode ?? "skip";
  const maxImagesPerItem = options.maxImagesPerItem ?? DEFAULT_MAX_IMAGES_PER_ITEM;
  const existingItems = handle.items.existingIds(document.items.map((item) => item.id));
  const takenMedia = handle.media.existingIds(document.media.map((row) => row.id));

  const media = document.media.filter((row) => !existingItems.has(row.itemId) && !takenMedia.has(row.id));
  const live = new Map<string, number>();
  for (const row of media) {
    if (row.deletedAt !== null) continue;
    const count = (live.get(row.itemId) ?? 0) + 1;
    if (count > maxImagesPerItem) throw new TooManyImagesError();
    live.set(row.itemId, count);
  }

  const attach: Media[] = [];
  let mediaOverLimit = 0;
  if (mode === "attach-media") {
    const candidates = document.media
      .filter((row) => existingItems.has(row.itemId) && !takenMedia.has(row.id) && row.deletedAt === null)
      .sort((a, b) => a.position - b.position);
    const counts = handle.media.liveCounts([...new Set(candidates.map((row) => row.itemId))]);
    for (const row of candidates) {
      const count = counts.get(row.itemId) ?? 0;
      if (count >= maxImagesPerItem) {
        mediaOverLimit += 1;
        continue;
      }
      counts.set(row.itemId, count + 1);
      attach.push(row);
    }
  }
  return {
    media,
    attach,
    mediaSkipped: document.media.length - media.length - attach.length - mediaOverLimit,
    mediaOverLimit,
  };
}

/**
 * Restores a backup document into the database. The whole import runs inside a
 * single transaction, so an invalid payload (e.g. an item referencing a missing
 * collection) rolls back entirely rather than leaving partial data behind.
 *
 * Image rows are inserted only from `plan` — the rows whose files the caller has
 * already written. A document carrying image rows with no plan is refused: a row
 * must never name a file that is not on disk. A planned row that cannot be
 * inserted rolls the whole import back, so the caller's cleanup of the files it
 * wrote is the only thing left to do.
 *
 * @throws if the document fails validation, or if any row cannot be inserted.
 */
export function importBackup(
  handle: DatabaseHandle,
  document: unknown,
  mode: ImportMode = "skip",
  plan?: ImportPlan,
): ImportSummary {
  return importDocument(handle, ExportDocumentSchema.parse(document), mode, plan);
}

/**
 * `importBackup` for a document the caller has already validated — an archive's,
 * which can hold tens of thousands of records and is not worth parsing twice.
 */
export function importDocument(
  handle: DatabaseHandle,
  doc: ExportDocument,
  mode: ImportMode = "skip",
  plan?: ImportPlan,
): ImportSummary {
  return importPlanned(handle, doc, mode, plan).summary;
}

export interface ImportOutcome {
  summary: ImportSummary;
  /**
   * Attach rows that no longer fit when the transaction ran (an upload landed
   * while the files were being written). They have no row, so the caller removes
   * the files it wrote for them.
   */
  notAttached: Media[];
}

/**
 * `importDocument`, also handing back the planned attach rows it could not insert
 * (#453). The cap is checked again inside the transaction, because a background
 * import (#452) writes its files over minutes while the item stays editable.
 */
export function importPlanned(
  handle: DatabaseHandle,
  doc: ExportDocument,
  mode: ImportMode = "skip",
  plan?: ImportPlan,
  options: { maxImagesPerItem?: number } = {},
): ImportOutcome {
  if (!IMPORT_MODES.includes(mode)) {
    throw new Error(`Unsupported import mode: ${mode}`);
  }
  if (plan === undefined && doc.media.length > 0) {
    throw new Error("image rows cannot be imported without their files");
  }
  const planned = plan?.media ?? [];
  const attach = plan?.attach ?? [];
  const maxImagesPerItem = options.maxImagesPerItem ?? DEFAULT_MAX_IMAGES_PER_ITEM;

  return handle.sqlite.transaction((): ImportOutcome => {
    const summary: ImportSummary = {
      collectionsImported: 0,
      collectionsSkipped: 0,
      itemsImported: 0,
      itemsSkipped: 0,
      mediaImported: 0,
      mediaAttached: 0,
      mediaSkipped: plan?.mediaSkipped ?? doc.media.length,
      mediaOverLimit: plan?.mediaOverLimit ?? 0,
    };
    const notAttached: Media[] = [];

    // Collections first so items can satisfy the foreign key constraint, and
    // items before the images that reference them.
    for (const collection of doc.collections) {
      if (handle.collections.insertImported(collection)) {
        summary.collectionsImported += 1;
      } else {
        summary.collectionsSkipped += 1;
      }
    }
    for (const item of doc.items) {
      if (handle.items.insertImported(item)) {
        summary.itemsImported += 1;
      } else {
        summary.itemsSkipped += 1;
      }
    }
    for (const row of planned) {
      if (!handle.media.insertImported(row)) {
        throw new Error("a planned image could not be imported");
      }
      summary.mediaImported += 1;
    }
    // Empty unless the plan was made in "attach-media" mode.
    for (const row of attach) {
      if (handle.media.insertAttached(row, maxImagesPerItem)) {
        summary.mediaAttached += 1;
      } else {
        summary.mediaOverLimit += 1;
        notAttached.push(row);
      }
    }

    return { summary, notAttached };
  })();
}
