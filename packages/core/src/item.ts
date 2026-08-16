import { z } from "zod";
import { ItemStatusSchema } from "./status.js";

export const ItemFieldValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(ItemFieldValueSchema)]),
);

export const ItemSchema = z.object({
  id: z.uuid(),
  collectionId: z.uuid(),
  status: ItemStatusSchema,
  fields: z.record(z.string(), ItemFieldValueSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable().default(null),
});

export type Item = z.infer<typeof ItemSchema>;

/**
 * A soft-deleted item as the trash presents it. The collection name travels with
 * the row so a trash listing can say what each item belonged to without the
 * caller fetching every collection back.
 */
export type DeletedItem = Item & { collectionName: string };
