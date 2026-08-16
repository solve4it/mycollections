import type { Collection, FieldDefinition } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyTrash } from "./empty-trash.js";
import { type DatabaseHandle, openDatabase } from "./open-database.js";

const fields: FieldDefinition[] = [{ id: "title", type: "text", label: "Title", required: true }];

let handle: DatabaseHandle;
let collection: Collection;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
  collection = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
});

afterEach(() => {
  handle.close();
});

describe("emptyTrash", () => {
  it("permanently removes every trashed item, and reports how many", async () => {
    const gone = await handle.items.create({ collectionId: collection.id, fields: { title: "Gone" } });
    const alsoGone = await handle.items.create({ collectionId: collection.id, fields: { title: "Also gone" } });
    await handle.items.softDelete(gone.id);
    await handle.items.softDelete(alsoGone.id);

    expect(await emptyTrash(handle)).toEqual({ items: 2, collections: 0 });
    expect(await handle.items.getById(gone.id, { includeDeleted: true })).toBeNull();
    expect(await handle.items.getById(alsoGone.id, { includeDeleted: true })).toBeNull();
  });

  it("leaves live items and live collections exactly where they were", async () => {
    const live = await handle.items.create({ collectionId: collection.id, fields: { title: "Kept" } });
    const trashed = await handle.items.create({ collectionId: collection.id, fields: { title: "Gone" } });
    await handle.items.softDelete(trashed.id);

    expect(await emptyTrash(handle)).toEqual({ items: 1, collections: 0 });
    expect(await handle.items.getById(live.id)).toEqual(live);
    expect(await handle.collections.getById(collection.id)).not.toBeNull();
  });

  it("removes trashed collections and everything inside them", async () => {
    const inside = await handle.items.create({ collectionId: collection.id, fields: { title: "Inside" } });
    await handle.collections.softDelete(collection.id);

    // The item is counted under its collection, not on its own: it goes by
    // foreign key cascade, as part of the collection being removed.
    expect(await emptyTrash(handle)).toEqual({ items: 0, collections: 1 });
    expect(await handle.collections.getById(collection.id, { includeDeleted: true })).toBeNull();
    expect(await handle.items.getById(inside.id, { includeDeleted: true })).toBeNull();
  });

  it("counts an individually-trashed item once, even when its collection is trashed too", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Both" } });
    await handle.items.softDelete(item.id);
    await handle.collections.softDelete(collection.id);

    // Collections go first, so the cascade takes the item with them; counting it
    // again as a trashed item would report two deletions for one row.
    expect(await emptyTrash(handle)).toEqual({ items: 0, collections: 1 });
    expect(await handle.items.getById(item.id, { includeDeleted: true })).toBeNull();
  });

  it("empties a mixed trash in a single call", async () => {
    const otherCollection = await handle.collections.create({ name: "Movies", fields, isFiniteSet: false });
    const looseItem = await handle.items.create({ collectionId: collection.id, fields: { title: "Loose" } });
    await handle.items.create({ collectionId: otherCollection.id, fields: { title: "Inside" } });
    await handle.items.softDelete(looseItem.id);
    await handle.collections.softDelete(otherCollection.id);

    expect(await emptyTrash(handle)).toEqual({ items: 1, collections: 1 });
    expect(await handle.collections.list()).toHaveLength(1);
    expect(await handle.items.listDeleted()).toEqual([]);
    expect(await handle.collections.listDeleted()).toEqual([]);
  });

  it("is a no-op on an empty trash, and safe to repeat", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Kept" } });

    expect(await emptyTrash(handle)).toEqual({ items: 0, collections: 0 });
    expect(await emptyTrash(handle)).toEqual({ items: 0, collections: 0 });
    expect(await handle.items.getById(item.id)).not.toBeNull();
  });
});
