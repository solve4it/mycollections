import type { FieldDefinition, Item } from "@mycollections/core";
import { describe, expect, it } from "vitest";
import { CARD_FIELD_COUNT, cardFields } from "./item-card.js";

const FIELDS: FieldDefinition[] = [
  { id: "title", label: "Title", type: "text", required: true },
  { id: "artist", label: "Artist", type: "text", required: false },
  { id: "genres", label: "Genres", type: "tags", required: false },
  { id: "year", label: "Year", type: "number", required: false },
  { id: "sealed", label: "Sealed", type: "boolean", required: false },
  { id: "pressing", label: "Pressing", type: "text", required: false },
];

function item(fields: Item["fields"]): Item {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    collectionId: "11111111-1111-1111-1111-111111111111",
    status: "owned",
    fields,
    createdAt: "2024-01-02T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
    deletedAt: null,
  };
}

const ids = (fields: FieldDefinition[]) => fields.map((field) => field.id);

describe("cardFields (#38)", () => {
  it("shows three", () => {
    expect(CARD_FIELD_COUNT).toBe(3);
  });

  it("takes the first filled fields in schema order, leaving out the name", () => {
    const record = item({ title: "Kind of Blue", artist: "Miles Davis", genres: ["jazz"], year: 1959, pressing: "x" });
    expect(ids(cardFields(FIELDS, record, "title", undefined))).toEqual(["artist", "genres", "year"]);
  });

  it("skips empty values — null, empty text, an empty list — but keeps false and zero", () => {
    const record = item({ title: "T", artist: "", genres: [], year: 0, sealed: false, pressing: null });
    expect(ids(cardFields(FIELDS, record, "title", undefined))).toEqual(["year", "sealed"]);
  });

  it("puts the sort field first, even when it is empty", () => {
    const record = item({ title: "T", artist: "A", genres: ["g"], year: 1959 });
    expect(ids(cardFields(FIELDS, record, "title", "pressing"))).toEqual(["pressing", "artist", "genres"]);
    expect(ids(cardFields(FIELDS, record, "title", "year"))).toEqual(["year", "artist", "genres"]);
  });

  it("does not repeat the name when the list is sorted by it", () => {
    const record = item({ title: "T", artist: "A" });
    expect(ids(cardFields(FIELDS, record, "title", "title"))).toEqual(["artist"]);
  });

  it("names nothing out when the item has no name field, so every filled field is a candidate", () => {
    const record = item({ artist: "A", year: 1 });
    expect(ids(cardFields(FIELDS, record, null, undefined))).toEqual(["artist", "year"]);
  });
});
