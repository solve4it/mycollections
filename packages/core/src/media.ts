import { z } from "zod";

export const MEDIA_KINDS = ["image"] as const;

export const MediaKindSchema = z.enum(MEDIA_KINDS);

/**
 * Where an image came from (#37). `user-camera` is a photo taken through the
 * capture input, `user-attached` a file the user picked, and `lookup` one a
 * lookup provider supplied (#40) — a client may never claim that last one.
 */
export const MEDIA_SOURCES = ["user-attached", "user-camera", "lookup"] as const;

export const MediaSourceSchema = z.enum(MEDIA_SOURCES);

/**
 * An image attached to an item.
 *
 * There is no primary flag: the image at the lowest `position` is the item's
 * primary, and "make primary" moves an image to the front — the listing-site
 * convention, and one that cannot hold two primaries at once. There is no stored
 * path either: the files live at paths derived from `itemId` and `id` under the
 * server's media directory, so moving that directory breaks nothing.
 *
 * `width` and `height` are those of the stored display image, not the upload.
 */
export const MediaSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  kind: MediaKindSchema,
  source: MediaSourceSchema,
  mimeType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable().default(null),
});

export type Media = z.infer<typeof MediaSchema>;
export type MediaSource = z.infer<typeof MediaSourceSchema>;
