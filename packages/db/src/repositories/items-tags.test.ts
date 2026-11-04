import type { Collection, FieldDefinition, Item } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseHandle, openDatabase } from "../open-database.js";
import { InvalidItemQueryError } from "./items.js";

const fields: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "tags", type: "tags", label: "Tags", required: false },
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

async function add(tags: unknown, collection: Collection = records, title = "x"): Promise<Item> {
  return handle.items.create({ collectionId: collection.id, fields: { title, tags } as Record<string, unknown> });
}

async function tagsOf(item: Item): Promise<unknown> {
  return (await handle.items.getById(item.id, { includeDeleted: true }))?.fields.tags;
}

describe("ItemsRepository.renameTag (#41)", () => {
  it("renames a tag on every item that carries it, in place, ignoring ASCII case and spaces as filters do", async () => {
    const a = await add(["first press", "signed", "mono"]);
    const b = await add([" Signed "]);
    const c = await add(["mono"]);

    expect(await handle.items.renameTag(records.id, "tags", "SIGNED", "autographed")).toMatchObject({ updated: 2 });
    expect(await tagsOf(a)).toEqual(["first press", "autographed", "mono"]);
    expect(await tagsOf(b)).toEqual(["autographed"]);
    expect(await tagsOf(c)).toEqual(["mono"]);
  });

  it("merges into an existing tag, leaving one spelling where the first match was", async () => {
    const both = await add(["Signed", "mono", "signed", "autographed"]);
    expect(await handle.items.renameTag(records.id, "tags", "signed", "Autographed")).toMatchObject({
      updated: 1,
      merged: true,
    });
    expect(await tagsOf(both)).toEqual(["Autographed", "mono"]);
  });

  it("can change only the case, and skips items already spelled that way", async () => {
    const lower = await add(["signed"]);
    const right = await add(["Signed"]);
    const before = (await handle.items.getById(right.id))?.updatedAt;
    expect(await handle.items.renameTag(records.id, "tags", "signed", "Signed")).toMatchObject({ updated: 1 });
    expect(await tagsOf(lower)).toEqual(["Signed"]);
    expect((await handle.items.getById(right.id))?.updatedAt).toBe(before);
  });

  it("matches as SQLite does, not as JavaScript would: no Unicode case folding, no non-space trimming", async () => {
    const accented = await add(["CAFÉ"]);
    const nbsp = await add(["café "]);
    const exact = await add(["café"]);
    expect(await handle.items.renameTag(records.id, "tags", "café", "coffee")).toMatchObject({ updated: 1 });
    expect(await tagsOf(accented)).toEqual(["CAFÉ"]);
    expect(await tagsOf(nbsp)).toEqual(["café "]);
    expect(await tagsOf(exact)).toEqual(["coffee"]);
  });

  it("includes trashed items, so a restore brings back consistent tags, and never touches another collection", async () => {
    const trashed = await add(["signed"]);
    await handle.items.softDelete(trashed.id);
    const other = await handle.collections.create({ name: "Other", fields, isFiniteSet: false });
    const elsewhere = await add(["signed"], other);

    expect(await handle.items.renameTag(records.id, "tags", "signed", "autographed")).toMatchObject({
      updated: 0,
      trashed: 1,
    });
    expect(await tagsOf(trashed)).toEqual(["autographed"]);
    expect(await tagsOf(elsewhere)).toEqual(["signed"]);
  });

  it("leaves non-text elements and non-list values alone, and keeps the search index current", async () => {
    const mixed = handle.sqlite;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    mixed
      .prepare(
        "INSERT INTO items (id, collection_id, status, fields, created_at, updated_at) VALUES (?, ?, 'owned', ?, ?, ?)",
      )
      .run(id, records.id, JSON.stringify({ title: "mixed", tags: [1, "signed", null, ["signed"]] }), now, now);
    const scalar = await add("signed");

    expect(await handle.items.renameTag(records.id, "tags", "signed", "autographed")).toMatchObject({ updated: 1 });
    const row = mixed.prepare("SELECT fields FROM items WHERE id = ?").get(id) as { fields: string };
    expect(JSON.parse(row.fields).tags).toEqual([1, "autographed", null, ["signed"]]);
    expect(await tagsOf(scalar)).toBe("signed");
    const found = await handle.items.listByCollection(records.id, { q: "autographed" });
    expect(found.map((item) => item.id)).toEqual([id]);
  });

  it("saving the spelling shown tidies the other spellings into it, and touches nothing already right", async () => {
    const lower = await add(["signed"]);
    const spaced = await add([" Signed "]);
    const right = await add(["Signed"]);
    const before = (await handle.items.getById(right.id))?.updatedAt;
    expect(await handle.items.renameTag(records.id, "tags", "Signed", "Signed")).toEqual({
      updated: 2,
      trashed: 0,
      merged: false,
    });
    expect(await tagsOf(lower)).toEqual(["Signed"]);
    expect(await tagsOf(spaced)).toEqual(["Signed"]);
    expect((await handle.items.getById(right.id))?.updatedAt).toBe(before);
  });

  it("says whether a rename merged into a tag already in use", async () => {
    await add(["signed"]);
    await add(["promo", "Autographed"]);
    expect(await handle.items.renameTag(records.id, "tags", "promo", "autographed")).toMatchObject({ merged: true });
    expect(await handle.items.renameTag(records.id, "tags", "signed", "rare")).toMatchObject({ merged: false });
  });

  it("counts live and trashed items apart, as the screen asks about live ones", async () => {
    await add(["signed"]);
    const trashed = await add(["signed"]);
    await handle.items.softDelete(trashed.id);
    expect(await handle.items.removeTag(records.id, "tags", "signed")).toEqual({ updated: 1, trashed: 1 });
  });

  it.each([
    ["title", "signed", "x", "a field that is not tags"],
    ["tags", "signed", "rock, pop", "a new name with a comma, which the item form would split"],
    ["tags", "", "x", "an empty tag"],
    ["tags", "signed", "x".repeat(201), "a new name past the length cap"],
    ["tags", "signed", "a\nb", "a control character"],
  ])("refuses field %j from %j to %j (%s)", async (field, from, to) => {
    await expect(handle.items.renameTag(records.id, field, from, to)).rejects.toBeInstanceOf(InvalidItemQueryError);
  });
});

describe("ItemsRepository.removeTag (#41)", () => {
  it("takes the tag off every item, trashed ones included, and nothing else", async () => {
    const a = await add(["signed", "mono", "Signed"]);
    const trashed = await add(["signed"]);
    await handle.items.softDelete(trashed.id);
    const untouched = await add(["mono"]);

    expect(await handle.items.removeTag(records.id, "tags", "SIGNED")).toEqual({ updated: 1, trashed: 1 });
    expect(await tagsOf(a)).toEqual(["mono"]);
    expect(await tagsOf(trashed)).toEqual([]);
    expect(await tagsOf(untouched)).toEqual(["mono"]);
  });
});

describe("ItemsRepository.tagValues with a search (#41)", () => {
  it("finds tags beyond the most used fifty by a part of their name", async () => {
    await add(Array.from({ length: 60 }, (_, i) => `common ${String(i).padStart(2, "0")}`));
    await add(["rare find"]);
    const { values } = await handle.items.tagValues(records.id, "tags", { q: "RARE" });
    expect(values).toEqual([{ value: "rare find", count: 1 }]);
  });
});
