import { EXPORT_VERSION, type ExportDocument, ExportDocumentSchema } from "@mycollections/core";
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
}

/**
 * Builds a portable backup of every collection and item, including soft-deleted
 * records, so restoring loses no data or deletion history.
 */
export async function exportBackup(handle: DatabaseHandle): Promise<ExportDocument> {
  const collections = await handle.collections.list({ includeDeleted: true });
  const items = (
    await Promise.all(collections.map((c) => handle.items.listByCollection(c.id, { includeDeleted: true })))
  ).flat();
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    collections,
    items,
  };
}

/**
 * Restores a backup document into the database. The whole import runs inside a
 * single transaction, so an invalid payload (e.g. an item referencing a missing
 * collection) rolls back entirely rather than leaving partial data behind.
 *
 * @throws if the document fails validation, or if any row cannot be inserted.
 */
export function importBackup(handle: DatabaseHandle, document: unknown, mode: ImportMode = "skip"): ImportSummary {
  if (mode !== "skip") {
    throw new Error(`Unsupported import mode: ${mode}`);
  }
  const doc = ExportDocumentSchema.parse(document);

  return handle.sqlite.transaction((): ImportSummary => {
    const summary: ImportSummary = {
      collectionsImported: 0,
      collectionsSkipped: 0,
      itemsImported: 0,
      itemsSkipped: 0,
    };

    // Collections first so items can satisfy the foreign key constraint.
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

    return summary;
  })();
}
