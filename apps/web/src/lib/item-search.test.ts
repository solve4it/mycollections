import type { FieldDefinition } from "@mycollections/core";
import { describe, expect, it } from "vitest";
import { effectiveSort, validateItemSearch } from "./item-search.js";

describe("validateItemSearch (#41)", () => {
  it("keeps a search and a well-formed sort", () => {
    expect(validateItemSearch({ q: "dune", sort: "-field:year" })).toEqual({ q: "dune", sort: "-field:year" });
  });

  it("turns a value some other serializer parsed back into text", () => {
    expect(validateItemSearch({ q: 1984 })).toEqual({ q: "1984" });
  });

  it("drops what it cannot use rather than failing the page", () => {
    expect(validateItemSearch({ q: "", sort: "sideways" })).toEqual({});
    expect(validateItemSearch({ q: { nested: true }, sort: 3 })).toEqual({});
  });

  it("cuts search text to the length the API accepts", () => {
    expect(validateItemSearch({ q: "a".repeat(250) }).q).toHaveLength(200);
  });
});

describe("effectiveSort", () => {
  const fields: FieldDefinition[] = [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "tags", type: "tags", label: "Tags", required: false },
  ];

  it("passes a sort the collection can honour", () => {
    expect(effectiveSort("-name", fields)).toBe("-name");
    expect(effectiveSort("field:title", fields)).toBe("field:title");
  });

  it("drops a field sort the collection cannot honour, so the list still loads", () => {
    expect(effectiveSort("field:gone", fields)).toBeUndefined();
    expect(effectiveSort("field:tags", fields)).toBeUndefined();
    expect(effectiveSort(undefined, fields)).toBeUndefined();
  });
});
