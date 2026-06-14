import { z } from "zod";
import { CollectionSchema } from "./collection.js";
import { ItemSchema } from "./item.js";

/**
 * Schema version of the export document format. Bump this when the shape of an
 * exported backup changes so importers can detect and migrate older backups.
 */
export const EXPORT_VERSION = 1;

/**
 * A portable backup of all collections and their items. Collections and items
 * are kept as flat arrays of full domain records (each item carries its own
 * `collectionId`), which keeps the file human-readable and round-trips losslessly
 * through {@link CollectionSchema} / {@link ItemSchema}. Soft-deleted records are
 * included so a backup can be restored without losing deletion history.
 */
export const ExportDocumentSchema = z
  .object({
    version: z.literal(EXPORT_VERSION),
    exportedAt: z.iso.datetime(),
    collections: z.array(CollectionSchema),
    items: z.array(ItemSchema),
  })
  .strict();

export type ExportDocument = z.infer<typeof ExportDocumentSchema>;
