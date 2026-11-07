import { z } from "zod";
import type { Collection } from "./collection.js";

const count = z.number().int().min(0);

/**
 * How many live (not trashed) items a collection holds, in total and per
 * status (#42). `total` is always `owned + wanted + ordered`.
 */
export const ItemCountsSchema = z.object({
  total: count,
  owned: count,
  wanted: count,
  ordered: count,
});

export type ItemCounts = z.infer<typeof ItemCountsSchema>;

/** Where a finite set with a target stands. */
export interface CollectionProgress {
  /** Owned items, uncapped — a set can hold more than its target (duplicates, variants). */
  owned: number;
  target: number;
  /** `owned / target`, capped at 1: the share of a progress bar to fill. */
  fraction: number;
  /** Owned has reached the target, whatever is still wanted or ordered. */
  complete: boolean;
}

/**
 * The progress of a finite set toward its target, or `null` when there is
 * nothing to measure: the collection is not a finite set, or its size is not
 * known yet (or is out of range). Only owned items count — wanted and ordered ones are what remains.
 */
export function collectionProgress(
  collection: Pick<Collection, "isFiniteSet" | "targetCount">,
  ownedCount: number,
): CollectionProgress | null {
  const target = collection.targetCount;
  // `!(target >= 1)` also refuses a target the schema forbids (0, negative), never a NaN fill.
  if (!collection.isFiniteSet || target === null || !(target >= 1)) return null;
  return {
    owned: ownedCount,
    target,
    fraction: Math.min(ownedCount / target, 1),
    complete: ownedCount >= target,
  };
}
