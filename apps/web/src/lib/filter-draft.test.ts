import type { FieldDefinition, ItemFilter } from "@mycollections/core";
import { describe, expect, it } from "vitest";
import { draftFromFilters, filtersFromDraft } from "./filter-draft.js";

const FIELDS: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "genre", type: "select", label: "Genre", required: false, options: ["Jazz", "Blues"] },
  { id: "tags", type: "tags", label: "Tags", required: false },
  { id: "year", type: "number", label: "Year", required: false },
  { id: "released", type: "date", label: "Released", required: false },
  { id: "boxed", type: "boolean", label: "Boxed", required: false },
];

describe("filter drafts (#41)", () => {
  it("round-trips every facet", () => {
    const filters: ItemFilter[] = [
      { field: "genre", op: "in", value: ["Jazz"] },
      { field: "tags", op: "all", value: ["signed", "mono"] },
      { field: "year", op: "gte", value: 1950 },
      { field: "year", op: "lte", value: 1960 },
      { field: "released", op: "gte", value: "1959-01-01" },
      { field: "boxed", op: "empty" },
    ];
    expect(filtersFromDraft(draftFromFilters(filters, FIELDS), FIELDS)).toEqual(filters);
  });

  it("starts every facet empty, and an empty draft is no filters", () => {
    const draft = draftFromFilters([], FIELDS);
    expect(draft.genre).toEqual({ kind: "choice", values: [], match: "in" });
    expect(draft.year).toEqual({ kind: "range", min: "", max: "" });
    expect(draft.boxed).toEqual({ kind: "boolean", value: "any" });
    expect(draft.title).toBeUndefined();
    expect(filtersFromDraft(draft, FIELDS)).toEqual([]);
  });

  it("reads typed bounds as numbers or dates, ignoring what is not one", () => {
    const draft = draftFromFilters([], FIELDS);
    draft.year = { kind: "range", min: "1959", max: "abc" };
    draft.released = { kind: "range", min: "", max: "2020-02-01" };
    draft.boxed = { kind: "boolean", value: "no" };
    expect(filtersFromDraft(draft, FIELDS)).toEqual([
      { field: "year", op: "gte", value: 1959 },
      { field: "released", op: "lte", value: "2020-02-01" },
      { field: "boxed", op: "eq", value: false },
    ]);
  });

  it("sends a single select or tag choice as 'in' whatever the match setting", () => {
    const draft = draftFromFilters([], FIELDS);
    draft.tags = { kind: "choice", values: ["signed"], match: "all" };
    expect(filtersFromDraft(draft, FIELDS)).toEqual([{ field: "tags", op: "in", value: ["signed"] }]);
  });
});
