import type { Collection, FieldDefinition } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseHandle, openDatabase } from "../open-database.js";

const fields: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "pages", type: "number", label: "Pages", required: false },
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

describe("ItemsRepository", () => {
  it("creates an item defaulting status to owned", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune", pages: 412 } });
    expect(item.status).toBe("owned");
    expect(item.fields).toEqual({ title: "Dune", pages: 412 });
    expect(item.deletedAt).toBeNull();
  });

  it("accepts explicit wanted/ordered statuses and rejects unknown ones", async () => {
    const wanted = await handle.items.create({ collectionId: collection.id, status: "wanted", fields: {} });
    expect(wanted.status).toBe("wanted");
    await expect(
      // @ts-expect-error invalid status must be rejected at runtime too
      handle.items.create({ collectionId: collection.id, status: "lost", fields: {} }),
    ).rejects.toThrow();
  });

  it("rejects items pointing at a missing collection", async () => {
    await expect(
      handle.items.create({ collectionId: "00000000-0000-4000-8000-000000000000", fields: {} }),
    ).rejects.toThrow();
  });

  it("round-trips through getById", async () => {
    const created = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    expect(await handle.items.getById(created.id)).toEqual(created);
  });

  it("lists items by collection, filterable by status, excluding soft-deleted", async () => {
    const owned = await handle.items.create({ collectionId: collection.id, fields: { title: "A" } });
    await handle.items.create({ collectionId: collection.id, status: "wanted", fields: { title: "B" } });
    const deleted = await handle.items.create({ collectionId: collection.id, fields: { title: "C" } });
    await handle.items.softDelete(deleted.id);

    expect(await handle.items.listByCollection(collection.id)).toHaveLength(2);
    expect(await handle.items.listByCollection(collection.id, { status: "owned" })).toEqual([owned]);
    expect(await handle.items.listByCollection(collection.id, { includeDeleted: true })).toHaveLength(3);
  });

  it("finds items by custom field value via json_extract", async () => {
    await handle.items.create({ collectionId: collection.id, fields: { title: "Dune", pages: 412 } });
    const hobbit = await handle.items.create({ collectionId: collection.id, fields: { title: "Hobbit", pages: 310 } });

    expect(await handle.items.findByFieldValue(collection.id, "title", "Hobbit")).toEqual([hobbit]);
    expect(await handle.items.findByFieldValue(collection.id, "pages", 310)).toEqual([hobbit]);
    expect(await handle.items.findByFieldValue(collection.id, "title", "Missing")).toEqual([]);
  });

  it("findByFieldValue handles field ids containing quotes and backslashes", async () => {
    const weird = await handle.items.create({
      collectionId: collection.id,
      fields: { 'he"said': "yes", "back\\slash": 7 },
    });
    expect(await handle.items.findByFieldValue(collection.id, 'he"said', "yes")).toEqual([weird]);
    expect(await handle.items.findByFieldValue(collection.id, "back\\slash", 7)).toEqual([weird]);
  });

  it("updates status and fields, bumping updatedAt", async () => {
    const created = await handle.items.create({ collectionId: collection.id, status: "wanted", fields: {} });
    const updated = await handle.items.update(created.id, { status: "owned", fields: { title: "Dune" } });
    expect(updated?.status).toBe("owned");
    expect(updated?.fields).toEqual({ title: "Dune" });
    expect(updated && updated.updatedAt >= created.updatedAt).toBe(true);
  });

  it("soft delete, restore, and hard delete behave like collections", async () => {
    const created = await handle.items.create({ collectionId: collection.id, fields: {} });
    expect(await handle.items.softDelete(created.id)).toBe(true);
    expect(await handle.items.getById(created.id)).toBeNull();
    expect(await handle.items.restore(created.id)).toBe(true);
    expect(await handle.items.getById(created.id)).not.toBeNull();
    expect(await handle.items.hardDelete(created.id)).toBe(true);
    expect(await handle.items.getById(created.id, { includeDeleted: true })).toBeNull();
  });

  it("hard delete cascades to media", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: {} });
    const m = await handle.media.create({ itemId: item.id, kind: "image", mimeType: "image/png", bytes: 5 });
    await handle.items.hardDelete(item.id);
    expect(await handle.media.getById(m.id, { includeDeleted: true })).toBeNull();
  });

  describe("countByCollection", () => {
    it("counts non-deleted items grouped by collection, omitting empty ones", async () => {
      const other = await handle.collections.create({ name: "Movies", fields, isFiniteSet: false });
      const empty = await handle.collections.create({ name: "Coins", fields, isFiniteSet: false });

      await handle.items.create({ collectionId: collection.id, fields: {} });
      await handle.items.create({ collectionId: collection.id, fields: {} });
      const deleted = await handle.items.create({ collectionId: collection.id, fields: {} });
      await handle.items.softDelete(deleted.id);
      await handle.items.create({ collectionId: other.id, fields: {} });

      const counts = await handle.items.countByCollection();
      expect(counts[collection.id]).toBe(2);
      expect(counts[other.id]).toBe(1);
      expect(counts[empty.id]).toBeUndefined();
    });

    it("returns an empty map when there are no items", async () => {
      expect(await handle.items.countByCollection()).toEqual({});
    });
  });
});
