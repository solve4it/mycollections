import { describe, expect, it } from "vitest";
import {
  COLLECTION_DESCRIPTION_MAX,
  COLLECTION_NAME_MAX,
  CollectionSchema,
  ITEM_VIEWS,
  ItemViewSchema,
  TARGET_COUNT_MAX,
} from "./collection.js";

const baseCollection = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Records",
  fields: [{ id: "title", label: "Title", type: "text" }],
  isFiniteSet: false,
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
};

describe("CollectionSchema", () => {
  it("parses a valid collection", () => {
    const parsed = CollectionSchema.parse(baseCollection);
    expect(parsed.name).toBe("Records");
    expect(parsed.isFiniteSet).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(() => CollectionSchema.parse({ ...baseCollection, name: "" })).toThrow();
  });

  // Shared so the web forms cap their boxes at the server's own limits (#42).
  it("caps a name at COLLECTION_NAME_MAX characters", () => {
    expect(COLLECTION_NAME_MAX).toBe(120);
    expect(CollectionSchema.parse({ ...baseCollection, name: "n".repeat(COLLECTION_NAME_MAX) }).name).toHaveLength(120);
    expect(CollectionSchema.safeParse({ ...baseCollection, name: "n".repeat(COLLECTION_NAME_MAX + 1) }).success).toBe(
      false,
    );
  });

  it("caps a description at COLLECTION_DESCRIPTION_MAX characters", () => {
    expect(COLLECTION_DESCRIPTION_MAX).toBe(2000);
    const longest = "d".repeat(COLLECTION_DESCRIPTION_MAX);
    expect(CollectionSchema.parse({ ...baseCollection, description: longest }).description).toBe(longest);
    expect(CollectionSchema.safeParse({ ...baseCollection, description: `${longest}d` }).success).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    expect(() => CollectionSchema.parse({ ...baseCollection, id: "nope" })).toThrow();
  });

  it("rejects an empty fields array", () => {
    expect(() => CollectionSchema.parse({ ...baseCollection, fields: [] })).toThrow();
  });

  it("rejects duplicate field ids", () => {
    expect(() =>
      CollectionSchema.parse({
        ...baseCollection,
        fields: [
          { id: "x", label: "X", type: "text" },
          { id: "x", label: "Y", type: "number" },
        ],
      }),
    ).toThrow();
  });
});

describe("CollectionSchema targetCount (#42)", () => {
  const finite = { ...baseCollection, isFiniteSet: true };

  it("defaults targetCount to null when absent", () => {
    expect(CollectionSchema.parse(baseCollection).targetCount).toBeNull();
    expect(CollectionSchema.parse(finite).targetCount).toBeNull();
  });

  it.each([
    [1, 1],
    [52, 52],
    [TARGET_COUNT_MAX, 100_000],
    [null, null],
  ])("accepts targetCount %s on a finite set", (targetCount, expected) => {
    expect(CollectionSchema.parse({ ...finite, targetCount }).targetCount).toBe(expected);
  });

  it.each([
    ["zero", 0],
    ["a negative number", -3],
    ["a fraction", 2.5],
    ["more than the maximum", 100_001],
    ["a numeric string", "5"],
    ["an empty string", ""],
    ["a boolean", true],
    ["false", false],
    ["an array", [5]],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects %s as targetCount", (_label, targetCount) => {
    expect(CollectionSchema.safeParse({ ...finite, targetCount }).success).toBe(false);
  });

  it("rejects a target on a collection that is not a finite set, at the targetCount path", () => {
    const result = CollectionSchema.safeParse({ ...baseCollection, targetCount: 5 });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["targetCount"], "targetCount requires isFiniteSet"],
    ]);
  });

  it("allows an explicit null target on a collection that is not a finite set", () => {
    expect(CollectionSchema.parse({ ...baseCollection, targetCount: null }).targetCount).toBeNull();
  });

  it("caps the target at one hundred thousand", () => {
    expect(TARGET_COUNT_MAX).toBe(100_000);
  });
});

describe("CollectionSchema itemView (#38)", () => {
  it("defaults itemView to list when absent", () => {
    expect(CollectionSchema.parse(baseCollection).itemView).toBe("list");
  });

  it.each(["list", "grid"])("accepts %s", (itemView) => {
    expect(CollectionSchema.parse({ ...baseCollection, itemView }).itemView).toBe(itemView);
  });

  it.each([
    ["an unknown view", "table"],
    ["a different case", "Grid"],
    ["an empty string", ""],
    ["null", null],
    ["a boolean", true],
    ["a number", 1],
  ])("rejects %s", (_label, itemView) => {
    expect(CollectionSchema.safeParse({ ...baseCollection, itemView }).success).toBe(false);
  });

  it("lists exactly the two views, list first as the default", () => {
    expect(ITEM_VIEWS).toEqual(["list", "grid"]);
    expect(ItemViewSchema.options).toEqual(["list", "grid"]);
  });
});
