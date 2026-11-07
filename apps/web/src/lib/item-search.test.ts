import type { FieldDefinition } from "@mycollections/core";
import { describe, expect, it } from "vitest";
import { effectiveFilters, effectiveSort, inStatusTab, statusTabOf, validateItemSearch } from "./item-search.js";

describe("validateItemSearch (#41)", () => {
  it("keeps a search and a well-formed sort", () => {
    expect(validateItemSearch({ q: "dune", sort: "-field:year" })).toEqual({ q: "dune", sort: "-field:year" });
  });

  it("keeps a status sort in either direction, and drops a misspelt one (#42)", () => {
    expect(validateItemSearch({ sort: "status" })).toEqual({ sort: "status" });
    expect(validateItemSearch({ sort: "-status" })).toEqual({ sort: "-status" });
    expect(validateItemSearch({ sort: "Status" })).toEqual({});
    expect(validateItemSearch({ sort: "--status" })).toEqual({});
    expect(validateItemSearch({ sort: "status:owned" })).toEqual({});
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

  it("passes a status sort on any collection — every item has a status (#42)", () => {
    expect(effectiveSort("status", fields)).toBe("status");
    expect(effectiveSort("-status", [])).toBe("-status");
  });

  it("drops a field sort the collection cannot honour, so the list still loads", () => {
    expect(effectiveSort("field:gone", fields)).toBeUndefined();
    expect(effectiveSort("field:tags", fields)).toBeUndefined();
    expect(effectiveSort(undefined, fields)).toBeUndefined();
  });
});

describe("filters in the URL (#41)", () => {
  const fields: FieldDefinition[] = [
    { id: "genre", type: "select", label: "Genre", required: false, options: ["Jazz", "Blues"] },
    { id: "year", type: "number", label: "Year", required: false },
    { id: "title", type: "text", label: "Title", required: true },
  ];

  it("keeps a valid filter list in its canonical spelling, and drops anything else", () => {
    const raw = '[ {"op":"gte", "field":"year", "value":1959} ]';
    expect(validateItemSearch({ filter: raw })).toEqual({ filter: '[{"field":"year","op":"gte","value":1959}]' });
    expect(validateItemSearch({ filter: "not json" })).toEqual({});
    expect(validateItemSearch({ filter: "[]" })).toEqual({});
  });

  it("applies only the filters this collection's fields can take", () => {
    const filter = JSON.stringify([
      { field: "genre", op: "in", value: ["Jazz"] },
      { field: "gone", op: "empty" },
      { field: "title", op: "empty" },
      { field: "year", op: "in", value: ["1959"] },
    ]);
    expect(effectiveFilters(filter, fields)).toEqual([{ field: "genre", op: "in", value: ["Jazz"] }]);
    expect(effectiveFilters(undefined, fields)).toEqual([]);
  });
});

describe("the status tab in the URL (#42)", () => {
  it("keeps collected and remaining, and spells All as no param at all", () => {
    expect(validateItemSearch({ show: "collected" })).toEqual({ show: "collected" });
    expect(validateItemSearch({ show: "remaining", q: "dune" })).toEqual({ q: "dune", show: "remaining" });
    // Canonical: `?show=all` and no param are one view, so they are one URL (R17).
    expect(validateItemSearch({ show: "all" })).toEqual({});
  });

  it("drops a tab it does not know rather than failing the page", () => {
    expect(validateItemSearch({ show: "owned" })).toEqual({});
    expect(validateItemSearch({ show: "Collected" })).toEqual({});
    expect(validateItemSearch({ show: "" })).toEqual({});
    expect(validateItemSearch({ show: ["collected"] })).toEqual({});
  });

  it("reads no param as the All tab", () => {
    expect(statusTabOf({})).toBe("all");
    expect(statusTabOf({ show: "collected" })).toBe("collected");
    expect(statusTabOf({ show: "remaining" })).toBe("remaining");
  });

  it("puts Owned under Collected, Wanted and Ordered under Remaining, and everything under All", () => {
    const table = (["owned", "wanted", "ordered"] as const).map((status) => [
      status,
      inStatusTab(status, "all"),
      inStatusTab(status, "collected"),
      inStatusTab(status, "remaining"),
    ]);
    expect(table).toEqual([
      ["owned", true, true, false],
      ["wanted", true, false, true],
      ["ordered", true, false, true],
    ]);
  });
});
