import { z } from "zod";
import { FieldDefinitionSchema } from "./field.js";

/**
 * The largest target a finite set may declare. Generous for any real checklist
 * (a full trading-card base set runs to a few thousand) while keeping the number
 * a progress bar divides by sane.
 */
export const TARGET_COUNT_MAX = 100_000;

/**
 * The longest name and description a collection may have. Shared rather than
 * written out in each place so the API's body schema and the web forms' boxes
 * cap at the same length the model does — a box that let a longer name through
 * only met a generic "check your input" on save.
 */
export const COLLECTION_NAME_MAX = 120;
export const COLLECTION_DESCRIPTION_MAX = 2000;

/**
 * How a collection's items are laid out on its page (#38): compact rows, or
 * cards led by each item's cover. A property of the collection rather than of
 * one browser, so it is the same on every device and travels with a backup —
 * the owner's call. List is first and the default, the layout every collection
 * had before the choice existed.
 */
export const ITEM_VIEWS = ["list", "grid"] as const;

export const ItemViewSchema = z.enum(ITEM_VIEWS);

export type ItemView = z.infer<typeof ItemViewSchema>;

export const CollectionSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(COLLECTION_NAME_MAX),
    description: z.string().max(COLLECTION_DESCRIPTION_MAX).optional(),
    fields: z.array(FieldDefinitionSchema).min(1),
    isFiniteSet: z.boolean(),
    /**
     * How many items make the set complete (#42). Only a finite set has one;
     * `null` is "finite, but the size is not known yet". Defaulted so documents
     * written before the field existed — version 1 backups included — still parse.
     */
    targetCount: z.number().int().min(1).max(TARGET_COUNT_MAX).nullable().default(null),
    /** Defaulted, like `targetCount`, so documents written before views existed still parse (#38). */
    itemView: ItemViewSchema.default("list"),
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

/**
 * A collection as the dashboard lists it: with the number of non-deleted items
 * it contains, and how many of those are owned (#42) — the numerator of a
 * finite set's progress.
 */
export type CollectionWithItemCount = Collection & { itemCount: number; ownedCount: number };
