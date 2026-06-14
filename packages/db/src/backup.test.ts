import { EXPORT_VERSION, type FieldDefinition } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportBackup, importBackup } from "./backup.js";
import { type DatabaseHandle, openDatabase } from "./open-database.js";

const fields: FieldDefinition[] = [{ id: "title", type: "text", label: "Title", required: true }];

let handle: DatabaseHandle;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
});

afterEach(() => {
  handle.close();
});

async function seed() {
  const collection = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
  const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Kind of Blue" } });
  return { collection, item };
}

describe("exportBackup", () => {
  it("produces a versioned document with all collections and items", async () => {
    const { collection, item } = await seed();
    const doc = await exportBackup(handle);

    expect(doc.version).toBe(EXPORT_VERSION);
    expect(doc.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(doc.collections).toEqual([collection]);
    expect(doc.items).toEqual([item]);
  });

  it("includes soft-deleted records", async () => {
    const { collection, item } = await seed();
    await handle.items.softDelete(item.id);
    await handle.collections.softDelete(collection.id);

    const doc = await exportBackup(handle);
    expect(doc.collections).toHaveLength(1);
    expect(doc.collections[0]?.deletedAt).not.toBeNull();
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]?.deletedAt).not.toBeNull();
  });

  it("exports an empty database as empty arrays", async () => {
    const doc = await exportBackup(handle);
    expect(doc.collections).toEqual([]);
    expect(doc.items).toEqual([]);
  });
});

describe("importBackup", () => {
  it("round-trips: export then import into an empty database reproduces the data", async () => {
    const { collection, item } = await seed();
    const doc = await exportBackup(handle);

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      const summary = importBackup(fresh, doc);
      expect(summary).toEqual({
        collectionsImported: 1,
        collectionsSkipped: 0,
        itemsImported: 1,
        itemsSkipped: 0,
      });
      expect(await fresh.collections.list()).toEqual([collection]);
      expect(await fresh.items.listByCollection(collection.id)).toEqual([item]);
    } finally {
      fresh.close();
    }
  });

  it("is idempotent: re-importing skips existing rows without changing data", async () => {
    const { collection, item } = await seed();
    const doc = await exportBackup(handle);

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      importBackup(fresh, doc);
      const second = importBackup(fresh, doc);
      expect(second).toEqual({
        collectionsImported: 0,
        collectionsSkipped: 1,
        itemsImported: 0,
        itemsSkipped: 1,
      });
      expect(await fresh.collections.list()).toEqual([collection]);
      expect(await fresh.items.listByCollection(collection.id)).toEqual([item]);
    } finally {
      fresh.close();
    }
  });

  it("rejects an invalid document and writes nothing", async () => {
    expect(() => importBackup(handle, { version: 999, collections: [], items: [] })).toThrow();
    expect(await handle.collections.list()).toEqual([]);
  });

  it("rolls back entirely when an item references a missing collection", async () => {
    const { collection, item } = await seed();
    const doc = await exportBackup(handle);
    const orphanDoc = { ...doc, collections: [] };

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      expect(() => importBackup(fresh, orphanDoc)).toThrow();
      // The valid collection from the original DB is untouched; the orphan import
      // left no partial rows in the fresh DB.
      expect(await fresh.collections.list()).toEqual([]);
      expect(await fresh.items.getById(item.id)).toBeNull();
      expect(collection.id).toBeDefined();
    } finally {
      fresh.close();
    }
  });
});
