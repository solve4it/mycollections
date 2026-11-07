import { z } from "zod";
import { FieldDefinitionSchema } from "./field.js";

/**
 * The largest target a finite set may declare. Generous for any real checklist
 * (a full trading-card base set runs to a few thousand) while keeping the number
 * a progress bar divides by sane.
 */
export const TARGET_COUNT_MAX = 100_000;

export const CollectionSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    fields: z.array(FieldDefinitionSchema).min(1),
    isFiniteSet: z.boolean(),
    /**
     * How many items make the set complete (#42). Only a finite set has one;
     * `null` is "finite, but the size is not known yet". Defaulted so documents
     * written before the field existed — version 1 backups included — still parse.
     */
    targetCount: z.number().int().min(1).max(TARGET_COUNT_MAX).nullable().default(null),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable().default(null),
  })
  .refine((c) => new Set(c.fields.map((f) => f.id)).size === c.fields.length, {
    message: "field ids must be unique",
    path: ["fields"],
  })
  .refine((c) => c.targetCount === null || c.isFiniteSet, {
    message: "targetCount requires isFiniteSet",
    path: ["targetCount"],
  });

export type Collection = z.infer<typeof CollectionSchema>;

/** A collection augmented with the number of non-deleted items it contains. */
export type CollectionWithItemCount = Collection & { itemCount: number };
