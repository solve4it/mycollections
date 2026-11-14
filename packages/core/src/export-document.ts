import { z } from "zod";
import { CollectionSchema } from "./collection.js";
import { ItemSchema } from "./item.js";
import { MediaSchema } from "./media.js";

/**
 * Schema version of the export document format. Bump this when the shape of an
 * exported backup changes so importers can detect and migrate older backups.
 *
 * An additive field with a default does not bump it: a backup written before the
 * field existed still parses, the default filling the gap — `targetCount` (#42)
 * joined version 1 this way, defaulting to `null`, and so did `itemView` (#38),
 * defaulting to `"list"`. The reverse direction loses only
 * the new field: an older app reading a newer backup strips the key it does not
 * know (Zod objects are not strict below the top level), so its collections import
 * without their targets. Removing or retyping a field, or making one required, does
 * bump the version — and so does any new *top-level* key, because the document
 * itself is `.strict()`: an older app refuses an unknown top-level key rather than
 * stripping it. That is why images (#45) are version 2, not an additive field.
 */
export const EXPORT_VERSION = 2;

/**
 * Version 1 (#189): collections and items only. Still read, so every backup
 * written before images existed keeps importing.
 */
const ExportDocumentV1Schema = z
  .object({
    version: z.literal(1),
    exportedAt: z.iso.datetime(),
    collections: z.array(CollectionSchema),
    items: z.array(ItemSchema),
  })
  .strict();

/**
 * Version 2 (#45): adds every image row, soft-deleted ones included. The image
 * files themselves travel beside this document in the export archive, at
 * `media/<itemId>/<mediaId>.webp`; a document never embeds them.
 *
 * A version bump rather than an additive field, because the top level is
 * `.strict()`: an older app reading a `media` key would refuse the whole file
 * rather than ignore it.
 */
const ExportDocumentV2Schema = z
  .object({
    version: z.literal(2),
    exportedAt: z.iso.datetime(),
    collections: z.array(CollectionSchema),
    items: z.array(ItemSchema),
    media: z.array(MediaSchema),
  })
  .strict()
  .superRefine((document, context) => {
    // Each image row names exactly one file; a repeated id would leave the
    // import unable to say which file belongs to which row.
    const seen = new Set<string>();
    const itemIds = new Set(document.items.map((item) => item.id));
    document.media.forEach((row, index) => {
      if (seen.has(row.id)) {
        context.addIssue({ code: "custom", path: ["media", index, "id"], message: "duplicate media id" });
      }
      seen.add(row.id);
      if (!itemIds.has(row.itemId)) {
        context.addIssue({ code: "custom", path: ["media", index, "itemId"], message: "media item not in document" });
      }
    });
  });

/**
 * A portable backup of collections, their items and their images. Collections,
 * items and images are kept as flat arrays of full domain records (each item
 * carries its `collectionId`, each image its `itemId`), which keeps the file
 * human-readable and round-trips losslessly through {@link CollectionSchema},
 * {@link ItemSchema} and {@link MediaSchema}. Soft-deleted records are included
 * so a backup can be restored without losing deletion history.
 *
 * Either version is accepted; a version 1 document comes out as version 2 with
 * no images, so every caller handles one shape.
 */
export const ExportDocumentSchema = z
  .discriminatedUnion("version", [ExportDocumentV1Schema, ExportDocumentV2Schema])
  .transform((document) => (document.version === 1 ? { ...document, version: 2 as const, media: [] } : document));

export type ExportDocument = z.output<typeof ExportDocumentSchema>;
