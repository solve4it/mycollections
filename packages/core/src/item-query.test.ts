import { describe, expect, it } from "vitest";
import { formatItemSort, ITEM_SEARCH_MAX_LENGTH, isSortableFieldType, parseItemSort } from "./item-query.js";

describe("parseItemSort", () => {
  it("reads the timestamp keys, ascending unless prefixed with '-'", () => {
    expect(parseItemSort("createdAt")).toEqual({ key: "createdAt", direction: "asc" });
    expect(parseItemSort("-updatedAt")).toEqual({ key: "updatedAt", direction: "desc" });
  });

  it("reads the item's name as a key of its own", () => {
    expect(parseItemSort("-name")).toEqual({ key: "name", direction: "desc" });
  });

  it("takes everything after 'field:' as the field id, colons included", () => {
    expect(parseItemSort("field:pages")).toEqual({ key: "field", fieldId: "pages", direction: "asc" });
    expect(parseItemSort("-field:a:b")).toEqual({ key: "field", fieldId: "a:b", direction: "desc" });
  });

  it.each(["", "-", "title", "field:", "-field:", "--name", "CreatedAt"])("rejects %j", (raw) => {
    expect(parseItemSort(raw)).toBeNull();
  });
});

describe("formatItemSort", () => {
  it.each(["createdAt", "-updatedAt", "name", "-field:a:b"])("round-trips %j", (raw) => {
    const sort = parseItemSort(raw);
    expect(sort).not.toBeNull();
    expect(formatItemSort(sort as NonNullable<typeof sort>)).toBe(raw);
  });
});

describe("ITEM_SEARCH_MAX_LENGTH", () => {
  it("is the cap the API and the search box share", () => {
    expect(ITEM_SEARCH_MAX_LENGTH).toBe(200);
  });
});

describe("isSortableFieldType", () => {
  it.each(["text", "number", "boolean", "date", "url", "email", "select", "rating", "currency"])("sorts %s", (type) => {
    expect(isSortableFieldType(type)).toBe(true);
  });

  it.each(["tags", "multiselect", "image", "unknown"])("does not sort %s", (type) => {
    expect(isSortableFieldType(type)).toBe(false);
  });
});
