import { describe, expect, it } from "vitest";
import { collectionProgress, ItemCountsSchema } from "./progress.js";

describe("collectionProgress (#42)", () => {
  it.each([
    ["a finite set with no target yet", { isFiniteSet: true, targetCount: null }, 3],
    ["a collection that is not a finite set", { isFiniteSet: false, targetCount: null }, 3],
    // Not a state the schema accepts, but a hand-built object must not get a bar either.
    ["a target on a collection that is not a finite set", { isFiniteSet: false, targetCount: 5 }, 3],
  ])("returns null for %s", (_label, collection, owned) => {
    expect(collectionProgress(collection, owned)).toBeNull();
  });

  it.each([
    ["0 of 5", 0, 5, { owned: 0, target: 5, fraction: 0, complete: false }],
    ["3 of 5", 3, 5, { owned: 3, target: 5, fraction: 0.6, complete: false }],
    ["5 of 5", 5, 5, { owned: 5, target: 5, fraction: 1, complete: true }],
    // Honest numbers past the target: the count says 6, only the fill is capped.
    ["6 of 5", 6, 5, { owned: 6, target: 5, fraction: 1, complete: true }],
    ["1 of 3", 1, 3, { owned: 1, target: 3, fraction: 1 / 3, complete: false }],
  ])("reports %s", (_label, owned, targetCount, expected) => {
    expect(collectionProgress({ isFiniteSet: true, targetCount }, owned)).toEqual(expected);
  });
});

describe("ItemCountsSchema (#42)", () => {
  it("parses a count for each status beside the total", () => {
    expect(ItemCountsSchema.parse({ total: 6, owned: 3, wanted: 2, ordered: 1 })).toEqual({
      total: 6,
      owned: 3,
      wanted: 2,
      ordered: 1,
    });
  });

  it.each([
    ["a negative count", { total: 1, owned: -1, wanted: 1, ordered: 1 }],
    ["a fractional count", { total: 1.5, owned: 1, wanted: 0, ordered: 0 }],
    ["a missing status", { total: 1, owned: 1, wanted: 0 }],
    ["a numeric string", { total: "1", owned: 1, wanted: 0, ordered: 0 }],
  ])("rejects %s", (_label, counts) => {
    expect(ItemCountsSchema.safeParse(counts).success).toBe(false);
  });
});
