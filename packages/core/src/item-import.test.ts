import { describe, expect, it } from "vitest";
import { type FieldDefinition, FieldDefinitionSchema } from "./field.js";
import {
  checkImportedFields,
  coerceCell,
  coerceStatus,
  emptyFieldValue,
  ITEM_IMPORT_MAX_CELL_LENGTH,
  ITEM_IMPORT_MAX_ROWS,
  ItemImportRequestSchema,
  MULTISELECT_SEPARATOR,
  validateFieldValue,
} from "./item-import.js";

const field = (input: Record<string, unknown>): FieldDefinition =>
  FieldDefinitionSchema.parse({ id: "f", label: "F", ...input });

const text = field({ type: "text" });
const number = field({ type: "number" });
const currency = field({ type: "currency" });
const boolean = field({ type: "boolean" });
const date = field({ type: "date" });
const url = field({ type: "url" });
const email = field({ type: "email" });
const select = field({ type: "select", options: ["Mint", "Good", "Fair"] });
const multiselect = field({ type: "multiselect", options: ["Red", "Green", "Blue, dark"] });
const rating = field({ type: "rating", max: 5 });
const tags = field({ type: "tags" });
const image = field({ type: "image" });

describe("emptyFieldValue", () => {
  it("is what the item form stores for an untouched field", () => {
    expect(emptyFieldValue(text)).toBe("");
    expect(emptyFieldValue(date)).toBe("");
    expect(emptyFieldValue(url)).toBe("");
    expect(emptyFieldValue(email)).toBe("");
    expect(emptyFieldValue(select)).toBe("");
    expect(emptyFieldValue(image)).toBe("");
    expect(emptyFieldValue(number)).toBeNull();
    expect(emptyFieldValue(currency)).toBeNull();
    expect(emptyFieldValue(rating)).toBeNull();
    expect(emptyFieldValue(boolean)).toBe(false);
    expect(emptyFieldValue(tags)).toEqual([]);
    expect(emptyFieldValue(multiselect)).toEqual([]);
  });
});

describe("coerceCell", () => {
  it("keeps text as written, trimmed of surrounding spaces only", () => {
    expect(coerceCell(text, "  Dune  ")).toEqual({ ok: true, value: "Dune" });
    expect(coerceCell(text, "007")).toEqual({ ok: true, value: "007" });
  });

  it("stores an empty cell as the field's empty value", () => {
    expect(coerceCell(text, "   ")).toEqual({ ok: true, value: "" });
    expect(coerceCell(number, "")).toEqual({ ok: true, value: null });
    expect(coerceCell(boolean, "")).toEqual({ ok: true, value: false });
    expect(coerceCell(tags, " ")).toEqual({ ok: true, value: [] });
  });

  it("refuses an empty cell in a required field", () => {
    expect(coerceCell(field({ type: "text", required: true }), " ")).toEqual({ ok: false, issue: "required" });
    expect(coerceCell(field({ type: "number", required: true }), "")).toEqual({ ok: false, issue: "required" });
  });

  it("refuses a cell longer than the cap", () => {
    expect(coerceCell(text, "a".repeat(ITEM_IMPORT_MAX_CELL_LENGTH + 1))).toEqual({ ok: false, issue: "too-long" });
    expect(coerceCell(text, "a".repeat(ITEM_IMPORT_MAX_CELL_LENGTH))).toEqual({
      ok: true,
      value: "a".repeat(ITEM_IMPORT_MAX_CELL_LENGTH),
    });
  });

  it("reads plain decimal numbers only", () => {
    expect(coerceCell(number, "42")).toEqual({ ok: true, value: 42 });
    expect(coerceCell(number, " -3.25 ")).toEqual({ ok: true, value: -3.25 });
    expect(coerceCell(number, ".5")).toEqual({ ok: true, value: 0.5 });
    for (const raw of ["0x10", "1e3", "Infinity", "NaN", "12abc", "1,234", "--1", "."]) {
      expect(coerceCell(number, raw)).toEqual({ ok: false, issue: "invalid" });
    }
  });

  it("reads currency with one symbol and thousands commas", () => {
    expect(coerceCell(currency, "$1,234.56")).toEqual({ ok: true, value: 1234.56 });
    expect(coerceCell(currency, "€12")).toEqual({ ok: true, value: 12 });
    expect(coerceCell(currency, "-$5.00")).toEqual({ ok: true, value: -5 });
    expect(coerceCell(currency, "1234.5")).toEqual({ ok: true, value: 1234.5 });
    for (const raw of ["1.234,56", "1,23", "$$5", "12,34,567", "five"]) {
      expect(coerceCell(currency, raw)).toEqual({ ok: false, issue: "invalid" });
    }
  });

  it("reads yes/no words case-insensitively", () => {
    for (const raw of ["true", "YES", "y", "1"]) expect(coerceCell(boolean, raw)).toEqual({ ok: true, value: true });
    for (const raw of ["False", "no", "N", "0"]) expect(coerceCell(boolean, raw)).toEqual({ ok: true, value: false });
    expect(coerceCell(boolean, "maybe")).toEqual({ ok: false, issue: "invalid" });
  });

  it("reads ISO calendar dates only", () => {
    expect(coerceCell(date, "2024-02-29")).toEqual({ ok: true, value: "2024-02-29" });
    for (const raw of ["2023-02-29", "2023-13-01", "03/04/2024", "2024-2-9", "2024-02-29T00:00:00Z"]) {
      expect(coerceCell(date, raw)).toEqual({ ok: false, issue: "invalid" });
    }
  });

  it("checks URLs and email addresses", () => {
    expect(coerceCell(url, "https://example.com/a")).toEqual({ ok: true, value: "https://example.com/a" });
    expect(coerceCell(url, "not a url")).toEqual({ ok: false, issue: "invalid" });
    expect(coerceCell(url, "javascript:alert(1)")).toEqual({ ok: false, issue: "invalid" });
    expect(coerceCell(email, "reader@example.com")).toEqual({ ok: true, value: "reader@example.com" });
    expect(coerceCell(email, "reader@")).toEqual({ ok: false, issue: "invalid" });
  });

  it("matches a select option exactly, then by case when that is unambiguous", () => {
    expect(coerceCell(select, "Good")).toEqual({ ok: true, value: "Good" });
    expect(coerceCell(select, "good")).toEqual({ ok: true, value: "Good" });
    expect(coerceCell(select, "Excellent")).toEqual({ ok: false, issue: "invalid" });
    const cased = field({ type: "select", options: ["Mint", "mint"] });
    expect(coerceCell(cased, "mint")).toEqual({ ok: true, value: "mint" });
    expect(coerceCell(cased, "MINT")).toEqual({ ok: false, issue: "invalid" });
  });

  it("splits multiselect cells on the one separator", () => {
    expect(MULTISELECT_SEPARATOR).toBe(";");
    expect(coerceCell(multiselect, "red; Blue, dark")).toEqual({ ok: true, value: ["Red", "Blue, dark"] });
    expect(coerceCell(multiselect, "Red;Red")).toEqual({ ok: true, value: ["Red"] });
    expect(coerceCell(multiselect, "Red; Purple")).toEqual({ ok: false, issue: "invalid" });
  });

  it("reads ratings as whole numbers within the field's range", () => {
    expect(coerceCell(rating, "4")).toEqual({ ok: true, value: 4 });
    expect(coerceCell(rating, "0")).toEqual({ ok: true, value: 0 });
    for (const raw of ["6", "-1", "3.5"]) expect(coerceCell(rating, raw)).toEqual({ ok: false, issue: "invalid" });
  });

  it("splits tags on commas as the form does", () => {
    expect(coerceCell(tags, "sci-fi, classic,, ")).toEqual({ ok: true, value: ["sci-fi", "classic"] });
  });

  it("never imports into an image field", () => {
    expect(coerceCell(image, "https://example.com/a.png")).toEqual({ ok: false, issue: "invalid" });
  });
});

describe("coerceStatus", () => {
  const labels = { owned: "Owned", wanted: "Wanted", ordered: "On its way" };

  it("reads a status key or the current language's label", () => {
    expect(coerceStatus("wanted", labels)).toEqual({ ok: true, value: "wanted" });
    expect(coerceStatus(" ON ITS WAY ", labels)).toEqual({ ok: true, value: "ordered" });
    expect(coerceStatus("Owned", labels)).toEqual({ ok: true, value: "owned" });
  });

  it("leaves an empty cell to the default and refuses anything else", () => {
    expect(coerceStatus("", labels)).toEqual({ ok: true, value: undefined });
    expect(coerceStatus("sold", labels)).toEqual({ ok: false, issue: "invalid" });
  });
});

describe("validateFieldValue", () => {
  it("accepts what coerceCell produces", () => {
    const cases: [FieldDefinition, string][] = [
      [text, "Dune"],
      [number, "4.5"],
      [currency, "$3"],
      [boolean, "yes"],
      [date, "2024-01-31"],
      [url, "https://example.com"],
      [email, "a@example.com"],
      [select, "mint"],
      [multiselect, "Red;Green"],
      [rating, "5"],
      [tags, "a, b"],
    ];
    for (const [f, raw] of cases) {
      const coerced = coerceCell(f, raw);
      if (!coerced.ok) throw new Error(`fixture ${raw} failed`);
      expect(validateFieldValue(f, coerced.value)).toBeNull();
      expect(validateFieldValue(f, emptyFieldValue(f))).toBeNull();
    }
  });

  it("refuses values of the wrong shape", () => {
    expect(validateFieldValue(number, "4")).toBe("invalid");
    expect(validateFieldValue(number, Number.POSITIVE_INFINITY)).toBe("invalid");
    expect(validateFieldValue(boolean, "true")).toBe("invalid");
    expect(validateFieldValue(date, "2023-02-30")).toBe("invalid");
    expect(validateFieldValue(select, "Excellent")).toBe("invalid");
    expect(validateFieldValue(select, "good")).toBe("invalid");
    expect(validateFieldValue(multiselect, ["Red", "Red"])).toBe("invalid");
    expect(validateFieldValue(multiselect, "Red")).toBe("invalid");
    expect(validateFieldValue(rating, 6)).toBe("invalid");
    expect(validateFieldValue(tags, ["a", ""])).toBe("invalid");
    expect(validateFieldValue(tags, [1])).toBe("invalid");
    expect(validateFieldValue(image, "x")).toBe("invalid");
    expect(validateFieldValue(text, "a".repeat(ITEM_IMPORT_MAX_CELL_LENGTH + 1))).toBe("too-long");
  });

  it("refuses an empty value in a required field", () => {
    expect(validateFieldValue(field({ type: "text", required: true }), "")).toBe("required");
    expect(validateFieldValue(field({ type: "tags", required: true }), [])).toBe("required");
    expect(validateFieldValue(field({ type: "number", required: true }), null)).toBe("required");
  });
});

describe("checkImportedFields", () => {
  const defs = [
    field({ id: "title", type: "text", required: true }),
    field({ id: "year", type: "number" }),
    field({ id: "cover", type: "image" }),
  ];

  it("fills unmapped fields with their empty values", () => {
    expect(checkImportedFields(defs, { title: "Dune" })).toEqual({
      ok: true,
      fields: { title: "Dune", year: null, cover: "" },
    });
  });

  it("refuses a key that is not one of the collection's fields", () => {
    expect(checkImportedFields(defs, { title: "Dune", rogue: "x" })).toEqual({ ok: false, issue: "unknown-field" });
    const polluted = JSON.parse('{"title":"Dune","__proto__":{"x":1}}');
    expect(checkImportedFields(defs, polluted)).toEqual({ ok: false, issue: "unknown-field" });
  });

  it("refuses a missing required field and names the field", () => {
    expect(checkImportedFields(defs, { year: 1965 })).toEqual({ ok: false, issue: "required", fieldId: "title" });
  });

  it("refuses a bad value and names the field", () => {
    expect(checkImportedFields(defs, { title: "Dune", year: "1965" })).toEqual({
      ok: false,
      issue: "invalid",
      fieldId: "year",
    });
  });
});

describe("ItemImportRequestSchema", () => {
  it("accepts rows of status and fields", () => {
    const parsed = ItemImportRequestSchema.parse({
      items: [{ fields: { title: "Dune" } }, { status: "wanted", fields: {} }],
    });
    expect(parsed.items).toEqual([{ fields: { title: "Dune" } }, { status: "wanted", fields: {} }]);
  });

  it("refuses no rows, too many rows, unknown keys and unknown statuses", () => {
    expect(ItemImportRequestSchema.safeParse({ items: [] }).success).toBe(false);
    const tooMany = Array.from({ length: ITEM_IMPORT_MAX_ROWS + 1 }, () => ({ fields: {} }));
    expect(ItemImportRequestSchema.safeParse({ items: tooMany }).success).toBe(false);
    expect(ItemImportRequestSchema.safeParse({ items: [{ fields: {}, id: "x" }] }).success).toBe(false);
    expect(ItemImportRequestSchema.safeParse({ items: [{ fields: {} }], extra: 1 }).success).toBe(false);
    expect(ItemImportRequestSchema.safeParse({ items: [{ status: "sold", fields: {} }] }).success).toBe(false);
  });
});
