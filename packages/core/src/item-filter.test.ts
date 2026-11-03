import { describe, expect, it } from "vitest";
import {
  filterSuitsField,
  ITEM_FILTER_MAX,
  type ItemFilter,
  ItemFilterListSchema,
  isFilterableFieldType,
  parseItemFilters,
} from "./item-filter.js";

describe("ItemFilterListSchema (#41)", () => {
  it("accepts one of each operator", () => {
    const filters = [
      { field: "genre", op: "in", value: ["Jazz", "Blues"] },
      { field: "tags", op: "all", value: ["signed", "first press"] },
      { field: "year", op: "gte", value: 1960 },
      { field: "released", op: "lte", value: "2020-05-01" },
      { field: "boxed", op: "eq", value: true },
      { field: "notes", op: "empty" },
    ];
    expect(ItemFilterListSchema.parse(filters)).toEqual(filters);
  });

  it("removes repeated values from a list, so 'all' cannot be asked for one tag twice", () => {
    expect(ItemFilterListSchema.parse([{ field: "tags", op: "all", value: ["a", "a", "b"] }])).toEqual([
      { field: "tags", op: "all", value: ["a", "b"] },
    ]);
  });

  it.each([
    ["an unknown operator", [{ field: "x", op: "like", value: "a" }]],
    ["an empty field id", [{ field: "", op: "empty" }]],
    ["a field id with a control character", [{ field: "a\u0000b", op: "empty" }]],
    ["an empty value list", [{ field: "x", op: "in", value: [] }]],
    ["more than 20 values", [{ field: "x", op: "in", value: Array.from({ length: 21 }, (_, i) => `v${i}`) }]],
    ["a value over 200 characters", [{ field: "x", op: "in", value: ["v".repeat(201)] }]],
    ["a bound that is neither a number nor a date", [{ field: "x", op: "gte", value: "soon" }]],
    ["a datetime where a date is meant", [{ field: "x", op: "gte", value: "2020-05-01T00:00:00Z" }]],
    ["an infinite bound", [{ field: "x", op: "lte", value: Number.POSITIVE_INFINITY }]],
    ["a non-boolean eq", [{ field: "x", op: "eq", value: "true" }]],
    ["too many filters", Array.from({ length: ITEM_FILTER_MAX + 1 }, () => ({ field: "x", op: "empty" }))],
    ["something that is not a list", { field: "x", op: "empty" }],
  ])("rejects %s", (_why, filters) => {
    expect(ItemFilterListSchema.safeParse(filters).success).toBe(false);
  });

  it("refuses extra keys rather than carrying them, prototype-shaped ones included", () => {
    expect(ItemFilterListSchema.safeParse([{ field: "x", op: "empty", extra: 2 }]).success).toBe(false);
    const raw = JSON.parse('[{"field":"x","op":"empty","__proto__":{"polluted":1}}]');
    const result = ItemFilterListSchema.safeParse(raw);
    if (result.success) expect(Object.getPrototypeOf(result.data[0])).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("parseItemFilters", () => {
  it("reads the JSON the URL and the API carry", () => {
    expect(parseItemFilters('[{"field":"year","op":"gte","value":1960}]')).toEqual([
      { field: "year", op: "gte", value: 1960 },
    ]);
  });

  it.each([
    "",
    "not json",
    "{}",
    '[{"field":"x"}]',
    "[".repeat(10_000),
    `[${'{"field":"x","op":"empty"},'.repeat(80)}]`,
  ])("returns null for %j", (raw) => {
    expect(parseItemFilters(raw)).toBeNull();
  });
});

describe("filterSuitsField", () => {
  it.each([
    ["in", "select", true],
    ["in", "multiselect", true],
    ["in", "tags", true],
    ["all", "tags", true],
    ["all", "select", false],
    ["gte", "number", true],
    ["lte", "rating", true],
    ["gte", "currency", true],
    ["gte", "date", true],
    ["gte", "select", false],
    ["eq", "boolean", true],
    ["eq", "tags", false],
    ["empty", "date", true],
    ["empty", "text", false],
    ["in", "image", false],
  ] as const)("%s on %s: %s", (op, type, expected) => {
    expect(isFilterableFieldType(type) || !expected).toBe(true);
    const filter =
      op === "in" || op === "all"
        ? { field: "f", op, value: ["a"] }
        : op === "gte" || op === "lte"
          ? { field: "f", op, value: type === "date" ? "2020-01-01" : 1 }
          : op === "eq"
            ? { field: "f", op, value: true }
            : { field: "f", op };
    expect(filterSuitsField(filter as ItemFilter, type)).toBe(expected);
  });

  it("refuses a bound of the wrong kind for the field", () => {
    expect(filterSuitsField({ field: "f", op: "gte", value: "2020-01-01" }, "number")).toBe(false);
    expect(filterSuitsField({ field: "f", op: "gte", value: 1 }, "date")).toBe(false);
  });
});
