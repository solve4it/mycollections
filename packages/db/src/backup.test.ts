import { EXPORT_VERSION, ExportDocumentSchema, type FieldDefinition } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportBackup, exportCollection, importBackup, planImport, TooManyImagesError } from "./backup.js";
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
        mediaImported: 0,
        mediaSkipped: 0,
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
        mediaImported: 0,
        mediaSkipped: 0,
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

describe("backups and a collection's view (#38)", () => {
  it("round-trips a grid collection beside a list one", async () => {
    const records = await handle.collections.create({ name: "Records", fields, isFiniteSet: false, itemView: "grid" });
    const books = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    const doc = await exportBackup(handle);
    expect(doc.collections.map((c) => [c.name, c.itemView])).toEqual([
      ["Records", "grid"],
      ["Books", "list"],
    ]);

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      importBackup(fresh, JSON.parse(JSON.stringify(doc)));
      expect(await fresh.collections.getById(records.id)).toEqual(records);
      expect(await fresh.collections.getById(books.id)).toEqual(books);
    } finally {
      fresh.close();
    }
  });

  it("imports a backup written before views existed in the list view", async () => {
    const { collection, item } = await seed();
    const doc = JSON.parse(JSON.stringify(await exportBackup(handle)));
    for (const c of doc.collections) delete c.itemView;

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      importBackup(fresh, doc);
      expect((await fresh.collections.getById(collection.id))?.itemView).toBe("list");
      expect(await fresh.items.listByCollection(collection.id)).toEqual([item]);
    } finally {
      fresh.close();
    }
  });

  it("rejects the whole file when one collection names a view that does not exist", async () => {
    await handle.collections.create({ name: "Records", fields, isFiniteSet: false, itemView: "grid" });
    const { collection } = await seed();
    const doc = JSON.parse(JSON.stringify(await exportBackup(handle)));
    doc.collections.find((c: { id: string }) => c.id === collection.id).itemView = "table";

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      expect(() => importBackup(fresh, doc)).toThrow();
      expect(await fresh.collections.list({ includeDeleted: true })).toEqual([]);
    } finally {
      fresh.close();
    }
  });
});

describe("backups and images (#45)", () => {
  async function addImage(itemId: string, overrides: { width?: number } = {}) {
    return handle.media.create({
      itemId,
      source: "user-attached",
      mimeType: "image/webp",
      bytes: 1000,
      width: overrides.width ?? 640,
      height: 480,
    });
  }

  it("exports every image row, trashed ones and those of trashed items included", async () => {
    const { collection, item } = await seed();
    const first = await addImage(item.id);
    const second = await addImage(item.id);
    await handle.media.softDelete(item.id, second.id);
    const other = await handle.items.create({ collectionId: collection.id, fields: { title: "Blue Train" } });
    const ofTrashedItem = await addImage(other.id);
    await handle.items.softDelete(other.id);

    const doc = await exportBackup(handle);
    expect(doc.media.map((m) => m.id).sort()).toEqual([first.id, second.id, ofTrashedItem.id].sort());
    expect(doc.media.find((m) => m.id === second.id)?.deletedAt).not.toBeNull();
  });

  describe("exportCollection", () => {
    it("holds one collection with all its items and their images, and nothing of any other", async () => {
      const { collection, item } = await seed();
      const image = await addImage(item.id);
      const trashedItem = await handle.items.create({ collectionId: collection.id, fields: { title: "Blue Train" } });
      await handle.items.softDelete(trashedItem.id);
      const elsewhere = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
      const otherItem = await handle.items.create({ collectionId: elsewhere.id, fields: { title: "Dune" } });
      await addImage(otherItem.id);

      const doc = await exportCollection(handle, collection.id);
      expect(doc?.version).toBe(EXPORT_VERSION);
      expect(doc?.collections).toEqual([collection]);
      expect(doc?.items.map((i) => i.id).sort()).toEqual([item.id, trashedItem.id].sort());
      expect(doc?.media).toEqual([image]);
    });

    it("is null for a collection in the trash, which is not on its page to export", async () => {
      const { collection } = await seed();
      await handle.collections.softDelete(collection.id);
      expect(await exportCollection(handle, collection.id)).toBeNull();
    });

    it("is null for a collection that does not exist", async () => {
      expect(await exportCollection(handle, "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9")).toBeNull();
    });
  });

  describe("planImport", () => {
    it("plans the images of items the import will add, and skips those of items already here", async () => {
      const { item } = await seed();
      const image = await addImage(item.id);
      const doc = await exportBackup(handle);

      const fresh = await openDatabase({ path: ":memory:" });
      try {
        expect(planImport(fresh, doc)).toEqual({ media: [image], mediaSkipped: 0 });
      } finally {
        fresh.close();
      }
      // The same document against the database it came from: every item exists,
      // so no image is touched — existing rows are left as they are.
      expect(planImport(handle, doc)).toEqual({ media: [], mediaSkipped: 1 });
    });

    it("skips an image whose id is already in use, even under an item the import adds", async () => {
      const { collection, item } = await seed();
      const image = await addImage(item.id);
      const doc = await exportBackup(handle);
      const newItem = { ...item, id: "8d3f4c0e-6a3b-4f7e-9b2a-1c5d7e9f0a1b" };
      const moved = { ...image, itemId: newItem.id };
      const crafted = { ...doc, collections: [collection], items: [newItem], media: [moved] };
      expect(planImport(handle, ExportDocumentSchema.parse(crafted))).toEqual({ media: [], mediaSkipped: 1 });
    });

    it("refuses an item with more live images than one item may hold, trashed ones not counted", async () => {
      const { item } = await seed();
      await addImage(item.id);
      await addImage(item.id);
      const trashed = await addImage(item.id);
      await handle.media.softDelete(item.id, trashed.id);
      const doc = await exportBackup(handle);

      const fresh = await openDatabase({ path: ":memory:" });
      try {
        expect(planImport(fresh, doc, { maxImagesPerItem: 2 }).media).toHaveLength(3);
        expect(() => planImport(fresh, doc, { maxImagesPerItem: 1 })).toThrow(TooManyImagesError);
      } finally {
        fresh.close();
      }
    });
  });

  describe("importBackup with images", () => {
    it("round-trips image rows exactly, positions and trash included", async () => {
      const { item } = await seed();
      const first = await addImage(item.id);
      const second = await addImage(item.id, { width: 800 });
      await handle.media.softDelete(item.id, first.id);
      const doc = await exportBackup(handle);

      const fresh = await openDatabase({ path: ":memory:" });
      try {
        const plan = planImport(fresh, doc);
        const summary = importBackup(fresh, doc, "skip", plan);
        expect(summary).toMatchObject({ mediaImported: 2, mediaSkipped: 0 });
        expect(await fresh.media.listByItem(item.id, { includeDeleted: true })).toEqual(
          await handle.media.listByItem(item.id, { includeDeleted: true }),
        );
        expect((await fresh.media.listByItem(item.id))[0]?.id).toBe(second.id);
      } finally {
        fresh.close();
      }
    });

    it("counts skipped images in the summary", async () => {
      const { item } = await seed();
      await addImage(item.id);
      const doc = await exportBackup(handle);
      const summary = importBackup(handle, doc, "skip", planImport(handle, doc));
      expect(summary).toEqual({
        collectionsImported: 0,
        collectionsSkipped: 1,
        itemsImported: 0,
        itemsSkipped: 1,
        mediaImported: 0,
        mediaSkipped: 1,
      });
    });

    it("refuses image rows without a plan, since nothing has put their files on disk", async () => {
      const { item } = await seed();
      await addImage(item.id);
      const doc = await exportBackup(handle);
      const fresh = await openDatabase({ path: ":memory:" });
      try {
        expect(() => importBackup(fresh, doc)).toThrow(/without their files/);
        expect(await fresh.collections.list({ includeDeleted: true })).toEqual([]);
      } finally {
        fresh.close();
      }
    });

    it("rolls everything back when a planned image cannot be inserted, so its file is the only thing to clean up", async () => {
      const { item } = await seed();
      const image = await addImage(item.id);
      const doc = await exportBackup(handle);
      const fresh = await openDatabase({ path: ":memory:" });
      try {
        const plan = planImport(fresh, doc);
        // Something claimed the id between planning and importing.
        const squatter = await fresh.collections.create({ name: "Other", fields, isFiniteSet: false });
        const squatterItem = await fresh.items.create({ collectionId: squatter.id, fields: { title: "x" } });
        fresh.media.insertImported({ ...image, itemId: squatterItem.id });
        expect(() => importBackup(fresh, doc, "skip", plan)).toThrow();
        expect((await fresh.collections.list()).map((c) => c.name)).toEqual(["Other"]);
      } finally {
        fresh.close();
      }
    });
  });
});
