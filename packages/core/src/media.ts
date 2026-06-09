import { z } from "zod";

export const MEDIA_KINDS = ["image"] as const;

export const MediaKindSchema = z.enum(MEDIA_KINDS);

export const MediaSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  kind: MediaKindSchema,
  mimeType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  isPrimary: z.boolean(),
  storagePath: z.string().optional(),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable().default(null),
});

export type Media = z.infer<typeof MediaSchema>;
