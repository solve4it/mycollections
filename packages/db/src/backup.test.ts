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

describe("backups and a finite set's target (#42)", () => {
  it("round-trips a target and a finite set without one", async () => {
    const quarters = await handle.collections.create({ name: "Quarters", fields, isFiniteSet: true, targetCount: 50 });
    const unsized = await handle.collections.create({ name: "Wave", fields, isFiniteSet: true });
    const doc = await exportBackup(handle);
    expect(doc.collections.map((c) => [c.name, c.targetCount])).toEqual([
      ["Quarters", 50],
      ["Wave", null],
    ]);

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      importBackup(fresh, JSON.parse(JSON.stringify(doc)));
      expect(await fresh.collections.getById(quarters.id)).toEqual(quarters);
      expect(await fresh.collections.getById(unsized.id)).toEqual(unsized);
    } finally {
      fresh.close();
    }
  });

  it("imports a backup written before targets existed with no target", async () => {
    const { collection, item } = await seed();
    const doc = JSON.parse(JSON.stringify(await exportBackup(handle)));
    for (const c of doc.collections) {
      delete c.targetCount;
      c.isFiniteSet = true;
    }

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      importBackup(fresh, doc);
      const imported = await fresh.collections.getById(collection.id);
      expect(imported?.isFiniteSet).toBe(true);
      expect(imported?.targetCount).toBeNull();
      expect(await fresh.items.listByCollection(collection.id)).toEqual([item]);
    } finally {
      fresh.close();
    }
  });

  it("rejects the whole file when one collection has a target but is not a finite set", async () => {
    await handle.collections.create({ name: "Quarters", fields, isFiniteSet: true, targetCount: 50 });
    const { collection } = await seed();
    const doc = JSON.parse(JSON.stringify(await exportBackup(handle)));
    const bad = doc.collections.find((c: { id: string }) => c.id === collection.id);
    bad.targetCount = 5;

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      expect(() => importBackup(fresh, doc)).toThrow("targetCount requires isFiniteSet");
      expect(await fresh.collections.list({ includeDeleted: true })).toEqual([]);
    } finally {
      fresh.close();
    }
  });
});
