import type { Collection, FieldDefinition } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("ignores explicitly-undefined patch keys instead of clobbering stored values", async () => {
    const created = await handle.items.create({
      collectionId: collection.id,
      status: "wanted",
      fields: { title: "Dune" },
    });
    // Callers building a patch from optional inputs pass explicit undefined
    // (e.g. { status: body.status }); that must behave like an absent key.
    const statusOnly = await handle.items.update(created.id, { status: "ordered", fields: undefined });
    expect(statusOnly?.status).toBe("ordered");
    expect(statusOnly?.fields).toEqual({ title: "Dune" });

    const fieldsOnly = await handle.items.update(created.id, { status: undefined, fields: { title: "Foundation" } });
    expect(fieldsOnly?.status).toBe("ordered");
    expect(fieldsOnly?.fields).toEqual({ title: "Foundation" });
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

  describe("listDeleted", () => {
    it("returns soft-deleted items with their collection name, most recently deleted first", async () => {
      await handle.items.create({ collectionId: collection.id, fields: { title: "Live" } });
      const first = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
      const second = await handle.items.create({ collectionId: collection.id, fields: { title: "Emma" } });

      // Same-millisecond deletes would tie on deleted_at and leave the order to the
      // query planner. Fake Date only — real timers and promises stay untouched.
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-08-16T10:00:00.000Z"));
        await handle.items.softDelete(first.id);
        vi.setSystemTime(new Date("2026-08-16T10:00:01.000Z"));
        await handle.items.softDelete(second.id);
      } finally {
        vi.useRealTimers();
      }

      const deleted = await handle.items.listDeleted();
      expect(deleted.map((i) => i.fields.title)).toEqual(["Emma", "Dune"]);
      expect(deleted.map((i) => i.collectionName)).toEqual(["Books", "Books"]);
      expect(deleted[0]?.deletedAt).toBe("2026-08-16T10:00:01.000Z");
    });

    it("omits items whose collection is itself deleted — they are restored with their parent", async () => {
      const orphan = await handle.items.create({ collectionId: collection.id, fields: { title: "Hidden" } });
      await handle.items.softDelete(orphan.id);
      const other = await handle.collections.create({ name: "Movies", fields, isFiniteSet: false });
      const visible = await handle.items.create({ collectionId: other.id, fields: { title: "Shown" } });
      await handle.items.softDelete(visible.id);

      await handle.collections.softDelete(collection.id);

      const deleted = await handle.items.listDeleted();
      expect(deleted.map((i) => i.id)).toEqual([visible.id]);
    });

    it("purges only trashed items, in a single conditional statement", async () => {
      const live = await handle.items.create({ collectionId: collection.id, fields: { title: "Live" } });
      const trashed = await handle.items.create({ collectionId: collection.id, fields: { title: "Gone" } });
      await handle.items.softDelete(trashed.id);

      expect(await handle.items.purge(live.id)).toBe(false);
      expect(await handle.items.getById(live.id)).not.toBeNull();

      expect(await handle.items.purge(trashed.id)).toBe(true);
      expect(await handle.items.getById(trashed.id, { includeDeleted: true })).toBeNull();
      expect(await handle.items.purge(trashed.id)).toBe(false);
    });

    it("returns an empty list when nothing is deleted", async () => {
      await handle.items.create({ collectionId: collection.id, fields: { title: "Live" } });
      expect(await handle.items.listDeleted()).toEqual([]);
    });
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
