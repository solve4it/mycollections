import type { Collection, FieldDefinition } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseHandle, openDatabase } from "../open-database.js";

const fields: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "pages", type: "number", label: "Pages", required: false },
  { id: "genres", type: "tags", label: "Genres", required: false },
];

let handle: DatabaseHandle;
let collection: Collection;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
  collection = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
});

afterEach(() => {
  handle.close();
});

const titles = async (id: string) => (await handle.items.listByCollection(id)).map((item) => item.fields.title);

describe("ItemsRepository.importRows (#44)", () => {
  it("adds every row in order, filling unmapped fields and defaulting the status", async () => {
    const result = handle.items.importRows(collection.id, [
      { fields: { title: "Dune", pages: 412 } },
      { status: "wanted", fields: { title: "Emma", genres: ["classic"] } },
    ]);
    expect(result).toEqual({ ok: true, created: 2 });
    const items = await handle.items.listByCollection(collection.id);
    expect(items.map((item) => [item.status, item.fields])).toEqual([
      ["owned", { title: "Dune", pages: 412, genres: [] }],
      ["wanted", { title: "Emma", pages: null, genres: ["classic"] }],
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it("finds imported items through search, as hand-made ones are", async () => {
    handle.items.importRows(collection.id, [{ fields: { title: "Moonstone" } }]);
    expect((await handle.items.listByCollection(collection.id, { q: "moon" })).map((i) => i.fields.title)).toEqual([
      "Moonstone",
    ]);
  });

  it("adds nothing when any row is invalid, and says which row and why", async () => {
    await handle.items.create({ collectionId: collection.id, fields: { title: "Kept" } });
    const result = handle.items.importRows(collection.id, [
      { fields: { title: "Dune" } },
      { fields: { title: "Emma" } },
      { fields: { title: "Persuasion", pages: "many" } },
    ]);
    expect(result).toEqual({ ok: false, reason: "invalid", row: 2, issue: "invalid" });
    expect(await titles(collection.id)).toEqual(["Kept"]);
  });

  it("refuses a missing required field and a key the collection does not have", () => {
    expect(handle.items.importRows(collection.id, [{ fields: { pages: 3 } }])).toEqual({
      ok: false,
      reason: "invalid",
      row: 0,
      issue: "required",
    });
    expect(handle.items.importRows(collection.id, [{ fields: { title: "A", author: "B" } }])).toEqual({
      ok: false,
      reason: "invalid",
      row: 0,
      issue: "unknown-field",
    });
  });

  it("refuses a trashed or missing collection without writing", async () => {
    await handle.collections.softDelete(collection.id);
    expect(handle.items.importRows(collection.id, [{ fields: { title: "Dune" } }])).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await handle.items.listByCollection(collection.id, { includeDeleted: true })).toEqual([]);
    expect(handle.items.importRows("00000000-0000-4000-8000-000000000000", [{ fields: { title: "Dune" } }])).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});
