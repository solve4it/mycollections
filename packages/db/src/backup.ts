import { EXPORT_VERSION, type ExportDocument, ExportDocumentSchema, type Media } from "@mycollections/core";
import type { DatabaseHandle } from "./open-database.js";

/**
 * Import conflict strategy. Only "skip" is implemented today: rows whose id
 * already exists are left untouched, making imports idempotent and never
 * destructive. "replace" / "merge" are reserved for future use.
 */
export type ImportMode = "skip";

export interface ImportSummary {
  collectionsImported: number;
  collectionsSkipped: number;
  itemsImported: number;
  itemsSkipped: number;
  mediaImported: number;
  mediaSkipped: number;
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
  /** The image rows to import; the caller writes exactly these files before importing. */
  media: Media[];
  /** Image rows left out because their item is already here, or their id is taken. */
  mediaSkipped: number;
}

export interface PlanOptions {
  /** Most live images one item may hold; the upload route's limit. */
  maxImagesPerItem?: number;
}

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
 * @throws TooManyImagesError if an added item would hold more live images than allowed.
 */
export function planImport(handle: DatabaseHandle, document: ExportDocument, options: PlanOptions = {}): ImportPlan {
  const maxImagesPerItem = options.maxImagesPerItem ?? 50;
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
  return { media, mediaSkipped: document.media.length - media.length };
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
  if (mode !== "skip") {
    throw new Error(`Unsupported import mode: ${mode}`);
  }
  if (plan === undefined && doc.media.length > 0) {
    throw new Error("image rows cannot be imported without their files");
  }
  const planned = plan?.media ?? [];

  return handle.sqlite.transaction((): ImportSummary => {
    const summary: ImportSummary = {
      collectionsImported: 0,
      collectionsSkipped: 0,
      itemsImported: 0,
      itemsSkipped: 0,
      mediaImported: 0,
      mediaSkipped: doc.media.length - planned.length,
    };

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

    return summary;
  })();
}
