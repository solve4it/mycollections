import type { Item } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseHandle, openDatabase } from "../open-database.js";

let handle: DatabaseHandle;
let item: Item;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
  const collection = await handle.collections.create({
    name: "Books",
    fields: [{ id: "title", type: "text", label: "Title", required: true }],
    isFiniteSet: false,
  });
  item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
});

afterEach(() => {
  handle.close();
});

describe("MediaRepository", () => {
  it("creates media with generated id and timestamp", async () => {
    const media = await handle.media.create({
      itemId: item.id,
      kind: "image",
      mimeType: "image/jpeg",
      bytes: 1024,
      storagePath: "media/abc.jpg",
    });
    expect(media.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(media.isPrimary).toBe(false);
    expect(media.storagePath).toBe("media/abc.jpg");
    expect(media.deletedAt).toBeNull();
  });

  it("rejects media pointing at a missing item", async () => {
    await expect(
      handle.media.create({
        itemId: "00000000-0000-4000-8000-000000000000",
        kind: "image",
        mimeType: "image/png",
        bytes: 1,
      }),
    ).rejects.toThrow();
  });

  it("first media created as primary demotes nothing; later setPrimary swaps", async () => {
    const a = await handle.media.create({
      itemId: item.id,
      kind: "image",
      mimeType: "image/png",
      bytes: 1,
      isPrimary: true,
    });
    const b = await handle.media.create({
      itemId: item.id,
      kind: "image",
      mimeType: "image/png",
      bytes: 2,
      isPrimary: true,
    });

    let listed = await handle.media.listByItem(item.id);
    expect(listed.filter((m) => m.isPrimary).map((m) => m.id)).toEqual([b.id]);

    expect(await handle.media.setPrimary(a.id)).toBe(true);
    listed = await handle.media.listByItem(item.id);
    expect(listed.filter((m) => m.isPrimary).map((m) => m.id)).toEqual([a.id]);
  });

  it("setPrimary returns false for unknown ids", async () => {
    expect(await handle.media.setPrimary("00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("lists media for an item excluding soft-deleted by default", async () => {
    const a = await handle.media.create({ itemId: item.id, kind: "image", mimeType: "image/png", bytes: 1 });
    await handle.media.create({ itemId: item.id, kind: "image", mimeType: "image/png", bytes: 2 });
    await handle.media.softDelete(a.id);

    expect(await handle.media.listByItem(item.id)).toHaveLength(1);
    expect(await handle.media.listByItem(item.id, { includeDeleted: true })).toHaveLength(2);
  });

  it("soft delete, restore, and hard delete", async () => {
    const media = await handle.media.create({ itemId: item.id, kind: "image", mimeType: "image/png", bytes: 1 });
    expect(await handle.media.softDelete(media.id)).toBe(true);
    expect(await handle.media.getById(media.id)).toBeNull();
    expect(await handle.media.restore(media.id)).toBe(true);
    expect(await handle.media.getById(media.id)).not.toBeNull();
    expect(await handle.media.hardDelete(media.id)).toBe(true);
    expect(await handle.media.getById(media.id, { includeDeleted: true })).toBeNull();
  });
});
