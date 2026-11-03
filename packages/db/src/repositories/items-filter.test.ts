import type { Collection, FieldDefinition, ItemFilter } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseHandle, openDatabase } from "../open-database.js";
import { InvalidItemQueryError } from "./items.js";

const fields: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "genre", type: "select", label: "Genre", required: false, options: ["Jazz", "Blues"] },
  { id: "styles", type: "multiselect", label: "Styles", required: false, options: ["Modal", "Hard bop", "Cool"] },
  { id: "tags", type: "tags", label: "Tags", required: false },
  { id: "year", type: "number", label: "Year", required: false },
  { id: "released", type: "date", label: "Released", required: false },
  { id: "boxed", type: "boolean", label: "Boxed", required: false },
  { id: "cover", type: "image", label: "Cover", required: false },
];

let handle: DatabaseHandle;
let records: Collection;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
  records = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
});

afterEach(() => {
  handle.close();
});

async function add(values: Record<string, unknown>, collection: Collection = records) {
  return handle.items.create({ collectionId: collection.id, fields: values });
}

async function titles(filters: ItemFilter[], extra: { q?: string } = {}): Promise<unknown[]> {
  const items = await handle.items.listByCollection(records.id, { filters, ...extra });
  return items.map((item) => item.fields.title);
}

describe("ItemsRepository filters (#41)", () => {
  beforeEach(async () => {
    await add({
      title: "Kind of Blue",
      genre: "Jazz",
      styles: ["Modal", "Cool"],
      tags: ["signed", "first press"],
      year: 1959,
      released: "1959-08-17",
      boxed: true,
    });
    await add({
      title: "Blue Train",
      genre: "Jazz",
      styles: ["Hard bop"],
      tags: ["Signed"],
      year: 1958,
      released: "1958-01-01",
      boxed: false,
    });
    await add({ title: "Texas Flood", genre: "Blues", styles: [], tags: [], year: null, released: "", boxed: false });
    // Shapes another client could have written: the API does not check fields
    // against the schema, so every op must hold up against the wrong type.
    await add({
      title: "Odd",
      genre: ["Jazz"],
      styles: "Modal",
      tags: "signed",
      year: "1999",
      released: "1999-12-31T23:00:00Z",
    });
  });

  it("in, on a select: any listed value, matched exactly", async () => {
    expect(await titles([{ field: "genre", op: "in", value: ["Blues"] }])).toEqual(["Texas Flood"]);
    expect(await titles([{ field: "genre", op: "in", value: ["Jazz", "Blues"] }])).toEqual([
      "Kind of Blue",
      "Blue Train",
      "Texas Flood",
    ]);
    // Options are the canonical spelling; a select is matched as stored.
    expect(await titles([{ field: "genre", op: "in", value: ["jazz"] }])).toEqual([]);
  });

  it("in, on tags: any listed tag, ignoring case, and only from a real list", async () => {
    expect(await titles([{ field: "tags", op: "in", value: ["SIGNED"] }])).toEqual(["Kind of Blue", "Blue Train"]);
    // "Odd" holds the bare string "signed", not a list — not a tag.
    expect(await titles([{ field: "tags", op: "in", value: ["signed"] }])).not.toContain("Odd");
  });

  it("all, on tags and multiselect: every listed value present", async () => {
    expect(await titles([{ field: "tags", op: "all", value: ["signed", "first press"] }])).toEqual(["Kind of Blue"]);
    expect(await titles([{ field: "styles", op: "all", value: ["Modal", "Cool"] }])).toEqual(["Kind of Blue"]);
    expect(await titles([{ field: "styles", op: "in", value: ["Hard bop", "Cool"] }])).toEqual([
      "Kind of Blue",
      "Blue Train",
    ]);
  });

  it("gte and lte, on a number: numeric and inclusive, never matching text that looks like a number", async () => {
    expect(await titles([{ field: "year", op: "gte", value: 1959 }])).toEqual(["Kind of Blue"]);
    expect(
      await titles([
        { field: "year", op: "gte", value: 1950 },
        { field: "year", op: "lte", value: 1958 },
      ]),
    ).toEqual(["Blue Train"]);
    expect(await titles([{ field: "year", op: "gte", value: 1990 }])).toEqual([]);
  });

  it("gte and lte, on a date: by calendar day, inclusive, a stored datetime read as its date", async () => {
    expect(await titles([{ field: "released", op: "gte", value: "1959-08-17" }])).toEqual(["Kind of Blue", "Odd"]);
    expect(await titles([{ field: "released", op: "lte", value: "1958-01-01" }])).toEqual(["Blue Train"]);
    expect(await titles([{ field: "released", op: "lte", value: "1999-12-31" }])).toContain("Odd");
  });

  it("eq, on a boolean: strictly true or strictly false, not 'not set'", async () => {
    expect(await titles([{ field: "boxed", op: "eq", value: true }])).toEqual(["Kind of Blue"]);
    expect(await titles([{ field: "boxed", op: "eq", value: false }])).toEqual(["Blue Train", "Texas Flood"]);
  });

  it("empty: missing, null, an empty string or an empty list", async () => {
    expect(await titles([{ field: "boxed", op: "empty" }])).toEqual(["Odd"]);
    expect(await titles([{ field: "year", op: "empty" }])).toEqual(["Texas Flood"]);
    expect(await titles([{ field: "released", op: "empty" }])).toEqual(["Texas Flood"]);
    expect(await titles([{ field: "tags", op: "empty" }])).toEqual(["Texas Flood"]);
  });

  it("ANDs filters together, and with search", async () => {
    expect(
      await titles([
        { field: "genre", op: "in", value: ["Jazz"] },
        { field: "boxed", op: "eq", value: false },
      ]),
    ).toEqual(["Blue Train"]);
    expect(await titles([{ field: "genre", op: "in", value: ["Jazz"] }], { q: "train" })).toEqual(["Blue Train"]);
  });

  it.each([
    [{ field: "missing", op: "empty" }, "an unknown field"],
    [{ field: "title", op: "empty" }, "a text field — search covers text"],
    [{ field: "cover", op: "empty" }, "an image field"],
    [{ field: "genre", op: "all", value: ["Jazz"] }, "all on a select"],
    [{ field: "genre", op: "gte", value: 1 }, "a bound on a select"],
    [{ field: "year", op: "in", value: ["1959"] }, "in on a number"],
    [{ field: "year", op: "gte", value: "1959-01-01" }, "a date bound on a number"],
    [{ field: "released", op: "gte", value: 1959 }, "a number bound on a date"],
    [{ field: "boxed", op: "in", value: ["true"] }, "in on a boolean"],
    [{ field: "tags", op: "eq", value: true }, "eq on tags"],
  ] as [ItemFilter, string][])("refuses %j (%s) with a fixed-text error", async (filter) => {
    const attempt = handle.items.listByCollection(records.id, { filters: [filter] });
    await expect(attempt).rejects.toBeInstanceOf(InvalidItemQueryError);
    await expect(attempt).rejects.toThrow(/^[A-Z][a-z ]+$/);
  });
});

describe("filters never reach past the collection and the trash (#41)", () => {
  /** One value that every filter below matches, held by a live item, an item in another collection and a trashed one. */
  const MATCHING = {
    title: "match",
    genre: "Jazz",
    styles: ["Modal"],
    tags: ["signed"],
    year: 1959,
    released: "1959-08-17",
    boxed: true,
  };
  const EVERY_OP: ItemFilter[] = [
    { field: "genre", op: "in", value: ["Jazz"] },
    { field: "styles", op: "all", value: ["Modal"] },
    { field: "tags", op: "in", value: ["signed"] },
    { field: "year", op: "gte", value: 1900 },
    { field: "year", op: "lte", value: 2000 },
    { field: "released", op: "gte", value: "1900-01-01" },
    { field: "boxed", op: "eq", value: true },
  ];
  const EMPTY_OPS: ItemFilter[] = ["genre", "styles", "tags", "year", "released", "boxed"].map((field) => ({
    field,
    op: "empty",
  }));

  it.each([...EVERY_OP, ...EMPTY_OPS].map((filter) => [filter.op, filter.field, filter] as const))(
    "%s on %s returns only this collection's live items, with or without search and sort",
    async (_op, _field, filter) => {
      const other = await handle.collections.create({ name: "Other", fields, isFiniteSet: false });
      // For `empty`, every spelling of "no value" — the OR branches a condition
      // without parentheses would let escape the collection and trash tests.
      const variants =
        filter.op === "empty" ? [null, "", []].map((blank) => ({ title: "match", [filter.field]: blank })) : [MATCHING];
      const mine = await add(filter.op === "empty" ? { title: "match" } : MATCHING);
      for (const values of variants) {
        await add(values, other);
        const trashed = await add(values);
        await handle.items.softDelete(trashed.id);
      }

      for (const options of [{}, { q: "match" }, { sort: { key: "name" as const, direction: "asc" as const } }]) {
        const found = await handle.items.listByCollection(records.id, { filters: [filter], ...options });
        expect(found.map((item) => item.id)).toEqual([mine.id]);
      }
    },
  );
});

describe("filters never throw, whatever is stored (#41)", () => {
  const SHAPES: unknown[] = ["text", "", 0, 1.5, true, false, null, [], ["a", 1, null], [["nested"]], { a: "b" }];

  /** Written straight to SQLite: the repository refuses some of these shapes, another client might not. */
  function insertRaw(collectionId: string, values: Record<string, unknown>) {
    const now = new Date().toISOString();
    handle.sqlite
      .prepare(
        "INSERT INTO items (id, collection_id, status, fields, created_at, updated_at) VALUES (?, ?, 'owned', ?, ?, ?)",
      )
      .run(crypto.randomUUID(), collectionId, JSON.stringify(values), now, now);
  }
  const FILTERS: ItemFilter[] = [
    { field: "genre", op: "in", value: ["a"] },
    { field: "styles", op: "all", value: ["a", "b"] },
    { field: "tags", op: "in", value: ["a"] },
    { field: "year", op: "gte", value: 0 },
    { field: "year", op: "lte", value: 0 },
    { field: "released", op: "gte", value: "2000-01-01" },
    { field: "boxed", op: "eq", value: false },
    ...["genre", "styles", "tags", "year", "released", "boxed"].map((field) => ({ field, op: "empty" }) as ItemFilter),
  ];

  it("runs every filter against every stored shape", async () => {
    for (const shape of SHAPES) {
      insertRaw(records.id, Object.fromEntries(fields.map((field) => [field.id, shape])));
    }
    for (const filter of FILTERS) {
      await expect(handle.items.listByCollection(records.id, { filters: [filter] })).resolves.toBeInstanceOf(Array);
    }
  });

  it("addresses field ids that hold JSON-path punctuation exactly", async () => {
    const tricky: FieldDefinition[] = ['a"b', "a.b", "a]b", "$", "a'b", "a\\b"].map((id) => ({
      id,
      type: "number",
      label: id,
      required: false,
    }));
    const odd = await handle.collections.create({ name: "Odd ids", fields: tricky, isFiniteSet: false });
    await add({ 'a"b': 1, "a.b": 2, "a]b": 3, $: 4, "a'b": 5, "a\\b": 6 }, odd);
    insertRaw(odd.id, { a: { b: 2 } });
    for (const [index, field] of tricky.entries()) {
      const found = await handle.items.listByCollection(odd.id, {
        filters: [
          { field: field.id, op: "gte", value: index + 1 },
          { field: field.id, op: "lte", value: index + 1 },
        ],
      });
      expect(found).toHaveLength(1);
    }
  });
});
