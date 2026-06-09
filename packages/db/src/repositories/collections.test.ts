import type { FieldDefinition } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("hard delete removes the row and cascades to items and media", async () => {
    const collection = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    await handle.media.create({ itemId: item.id, kind: "image", mimeType: "image/png", bytes: 10 });

    expect(await handle.collections.hardDelete(collection.id)).toBe(true);
    expect(await handle.collections.getById(collection.id, { includeDeleted: true })).toBeNull();
    expect(await handle.items.getById(item.id, { includeDeleted: true })).toBeNull();
    expect(await handle.media.listByItem(item.id, { includeDeleted: true })).toHaveLength(0);
  });
});
