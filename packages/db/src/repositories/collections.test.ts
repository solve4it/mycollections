import type { FieldDefinition } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DatabaseHandle, openDatabase } from "../open-database.js";

const fields: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "pages", type: "number", label: "Pages", required: false },
];

let handle: DatabaseHandle;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
});

afterEach(() => {
  handle.close();
});

describe("CollectionsRepository", () => {
  it("creates a collection with generated id and timestamps", async () => {
    const collection = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    expect(collection.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(collection.name).toBe("Books");
    expect(collection.fields).toEqual(fields);
    expect(collection.deletedAt).toBeNull();
    expect(collection.createdAt).toBe(collection.updatedAt);
  });

  it("rejects invalid input", async () => {
    await expect(handle.collections.create({ name: "", fields, isFiniteSet: false })).rejects.toThrow();
    await expect(handle.collections.create({ name: "X", fields: [], isFiniteSet: false })).rejects.toThrow();
  });

  it("round-trips through getById", async () => {
    const created = await handle.collections.create({
      name: "Coins",
      description: "State quarters",
      fields,
      isFiniteSet: true,
    });
    const fetched = await handle.collections.getById(created.id);
    expect(fetched).toEqual(created);
  });

  it("returns null for unknown ids", async () => {
    expect(await handle.collections.getById("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("lists collections excluding soft-deleted by default", async () => {
    const a = await handle.collections.create({ name: "A", fields, isFiniteSet: false });
    await handle.collections.create({ name: "B", fields, isFiniteSet: false });
    await handle.collections.softDelete(a.id);

    const listed = await handle.collections.list();
    expect(listed.map((c) => c.name)).toEqual(["B"]);

    const all = await handle.collections.list({ includeDeleted: true });
    expect(all).toHaveLength(2);
  });

  it("updates fields and bumps updatedAt", async () => {
    const created = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    const updated = await handle.collections.update(created.id, { name: "Novels", isFiniteSet: true });
    expect(updated?.name).toBe("Novels");
    expect(updated?.isFiniteSet).toBe(true);
    expect(updated && updated.updatedAt >= created.updatedAt).toBe(true);
  });

  it("replaces the field schema without touching stored item values", async () => {
    const created = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    const item = await handle.items.create({ collectionId: created.id, fields: { title: "Dune", pages: 412 } });

    // "pages" leaves the schema, "year" joins it, "title" is relabelled in place.
    const nextFields: FieldDefinition[] = [
      { id: "title", type: "text", label: "Name", required: true },
      { id: "year", type: "number", label: "Year", required: false },
    ];
    const updated = await handle.collections.update(created.id, { fields: nextFields });

    expect(updated?.fields).toEqual(nextFields);
    expect((await handle.items.getById(item.id))?.fields).toEqual({ title: "Dune", pages: 412 });
  });

  it("update returns null for unknown ids", async () => {
    expect(await handle.collections.update("00000000-0000-4000-8000-000000000000", { name: "X" })).toBeNull();
  });

  it("soft delete hides, restore brings back", async () => {
    const created = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    expect(await handle.collections.softDelete(created.id)).toBe(true);
    expect(await handle.collections.getById(created.id)).toBeNull();
    expect(await handle.collections.getById(created.id, { includeDeleted: true })).not.toBeNull();

    expect(await handle.collections.restore(created.id)).toBe(true);
    expect((await handle.collections.getById(created.id))?.deletedAt).toBeNull();
  });

  it("soft delete is idempotent-safe and reports misses", async () => {
    const created = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    expect(await handle.collections.softDelete(created.id)).toBe(true);
    expect(await handle.collections.softDelete(created.id)).toBe(false);
    expect(await handle.collections.softDelete("00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("lists soft-deleted collections, most recently deleted first", async () => {
    const live = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    const first = await handle.collections.create({ name: "Movies", fields, isFiniteSet: false });
    const second = await handle.collections.create({ name: "Coins", fields, isFiniteSet: false });

    // Two deletes in the same millisecond would tie on deleted_at and leave the
    // order to the query planner, so fake the clock (Date only — real timers and
    // promises are untouched) and give them distinct, ordered timestamps.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-08-16T10:00:00.000Z"));
      await handle.collections.softDelete(first.id);
      vi.setSystemTime(new Date("2026-08-16T10:00:01.000Z"));
      await handle.collections.softDelete(second.id);
    } finally {
      vi.useRealTimers();
    }

    const deleted = await handle.collections.listDeleted();
    expect(deleted.map((c) => c.name)).toEqual(["Coins", "Movies"]);
    expect(deleted.map((c) => c.id)).not.toContain(live.id);
    expect(deleted.every((c) => c.deletedAt !== null)).toBe(true);
  });

  it("purges only trashed collections, taking their items with them", async () => {
    const live = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    const liveItem = await handle.items.create({ collectionId: live.id, fields: { title: "Kept" } });
    const trashed = await handle.collections.create({ name: "Movies", fields, isFiniteSet: false });
    const trashedItem = await handle.items.create({ collectionId: trashed.id, fields: { title: "Gone" } });
    await handle.collections.softDelete(trashed.id);

    expect(await handle.collections.purge(live.id)).toBe(false);
    expect(await handle.items.getById(liveItem.id)).not.toBeNull();

    expect(await handle.collections.purge(trashed.id)).toBe(true);
    expect(await handle.collections.getById(trashed.id, { includeDeleted: true })).toBeNull();
    expect(await handle.items.getById(trashedItem.id, { includeDeleted: true })).toBeNull();
    expect(await handle.collections.purge(trashed.id)).toBe(false);
  });

  it("hard delete removes the row and cascades to items and media", async () => {
    const collection = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    await handle.media.create({
      itemId: item.id,
      source: "user-attached",
      mimeType: "image/webp",
      bytes: 10,
      width: 1,
      height: 1,
    });

    expect(await handle.collections.hardDelete(collection.id)).toBe(true);
    expect(await handle.collections.getById(collection.id, { includeDeleted: true })).toBeNull();
    expect(await handle.items.getById(item.id, { includeDeleted: true })).toBeNull();
    expect(await handle.media.listByItem(item.id, { includeDeleted: true })).toHaveLength(0);
  });
});

describe("CollectionsRepository targetCount (#42)", () => {
  it("defaults a new collection's target to null", async () => {
    const created = await handle.collections.create({ name: "Coins", fields, isFiniteSet: true });
    expect(created.targetCount).toBeNull();
    expect((await handle.collections.getById(created.id))?.targetCount).toBeNull();
  });

  it("persists a finite set's target and reads it back", async () => {
    const created = await handle.collections.create({ name: "Quarters", fields, isFiniteSet: true, targetCount: 50 });
    expect(created.targetCount).toBe(50);
    expect(await handle.collections.getById(created.id)).toEqual(created);
    expect((await handle.collections.list()).map((c) => c.targetCount)).toEqual([50]);
  });

  it("refuses a target on a collection that is not a finite set", async () => {
    await expect(
      handle.collections.create({ name: "Books", fields, isFiniteSet: false, targetCount: 5 }),
    ).rejects.toThrow("targetCount requires isFiniteSet");
    expect(await handle.collections.list()).toEqual([]);
  });

  it("changes the target and leaves it alone when a patch omits it", async () => {
    const created = await handle.collections.create({ name: "Quarters", fields, isFiniteSet: true, targetCount: 50 });
    expect((await handle.collections.update(created.id, { targetCount: 56 }))?.targetCount).toBe(56);
    expect((await handle.collections.update(created.id, { name: "State quarters" }))?.targetCount).toBe(56);
    expect((await handle.collections.update(created.id, { isFiniteSet: true }))?.targetCount).toBe(56);
    expect((await handle.collections.getById(created.id))?.targetCount).toBe(56);
  });

  it("clears the target with an explicit null", async () => {
    const created = await handle.collections.create({ name: "Quarters", fields, isFiniteSet: true, targetCount: 50 });
    const updated = await handle.collections.update(created.id, { targetCount: null });
    expect(updated?.targetCount).toBeNull();
    expect(updated?.isFiniteSet).toBe(true);
    expect((await handle.collections.getById(created.id))?.targetCount).toBeNull();
  });

  it("clears the target when the collection stops being a finite set", async () => {
    const created = await handle.collections.create({ name: "Quarters", fields, isFiniteSet: true, targetCount: 50 });
    const updated = await handle.collections.update(created.id, { isFiniteSet: false });
    expect(updated?.isFiniteSet).toBe(false);
    expect(updated?.targetCount).toBeNull();
    expect((await handle.collections.getById(created.id))?.targetCount).toBeNull();
  });

  it("refuses a patch that ends a finite set but keeps a target, writing nothing", async () => {
    const created = await handle.collections.create({ name: "Quarters", fields, isFiniteSet: true, targetCount: 50 });
    await expect(handle.collections.update(created.id, { isFiniteSet: false, targetCount: 40 })).rejects.toThrow(
      "targetCount requires isFiniteSet",
    );
    expect(await handle.collections.getById(created.id)).toEqual(created);
  });

  it("refuses a target on a collection that is not a finite set, writing nothing", async () => {
    const created = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    await expect(handle.collections.update(created.id, { name: "Novels", targetCount: 10 })).rejects.toThrow(
      "targetCount requires isFiniteSet",
    );
    expect(await handle.collections.getById(created.id)).toEqual(created);
  });

  it("sets the flag and the target in one patch", async () => {
    const created = await handle.collections.create({ name: "Wave", fields, isFiniteSet: false });
    const updated = await handle.collections.update(created.id, { isFiniteSet: true, targetCount: 12 });
    expect(updated?.isFiniteSet).toBe(true);
    expect(updated?.targetCount).toBe(12);
  });

  it("keeps an imported collection's target", async () => {
    const created = await handle.collections.create({ name: "Quarters", fields, isFiniteSet: true, targetCount: 50 });
    const fresh = await openDatabase({ path: ":memory:" });
    try {
      expect(fresh.collections.insertImported(created)).toBe(true);
      expect(await fresh.collections.getById(created.id)).toEqual(created);
    } finally {
      fresh.close();
    }
  });

  // A row no current write path could produce — written by hand, by a future
  // version, or by a bug — must not turn every list and export into a 500.
  it.each([
    ["a target on a collection that is not a finite set", 0, 5],
    ["zero", 1, 0],
    ["a negative number", 1, -4],
    ["a fraction", 1, 2.5],
    ["more than the maximum", 1, 100_001],
    ["text", 1, "many"],
  ])("reads %s stored in the row as no target", async (_label, isFiniteSet, stored) => {
    const created = await handle.collections.create({ name: "Odd", fields, isFiniteSet: false });
    handle.sqlite
      .prepare("UPDATE collections SET is_finite_set = ?, target_count = ? WHERE id = ?")
      .run(isFiniteSet, stored, created.id);

    expect((await handle.collections.getById(created.id))?.targetCount).toBeNull();
    expect((await handle.collections.list()).map((c) => c.targetCount)).toEqual([null]);
    expect((await handle.collections.list({ includeDeleted: true })).map((c) => c.targetCount)).toEqual([null]);
  });
});
