import type { Item } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyTrash } from "../empty-trash.js";
import { type DatabaseHandle, openDatabase } from "../open-database.js";
import type { CreateMediaInput } from "./media.js";

let handle: DatabaseHandle;
let item: Item;
let other: Item;

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
  const collection = await handle.collections.create({
    name: "Books",
    fields: [{ id: "title", type: "text", label: "Title", required: true }],
    isFiniteSet: false,
  });
  item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
  other = await handle.items.create({ collectionId: collection.id, fields: { title: "Emma" } });
});

afterEach(() => {
  handle.close();
});

function image(itemId: string, overrides: Partial<CreateMediaInput> = {}): CreateMediaInput {
  return {
    itemId,
    source: "user-attached",
    mimeType: "image/webp",
    bytes: 2048,
    width: 640,
    height: 480,
    ...overrides,
  };
}

const order = async (itemId: string) => (await handle.media.listByItem(itemId)).map((m) => m.bytes);

describe("MediaRepository.create", () => {
  it("stores what it was given, with a generated id, timestamp and the first position", async () => {
    const media = await handle.media.create(image(item.id, { source: "user-camera", width: 2560, height: 1920 }));
    expect(media).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      itemId: item.id,
      kind: "image",
      source: "user-camera",
      mimeType: "image/webp",
      bytes: 2048,
      width: 2560,
      height: 1920,
      position: 0,
      createdAt: expect.any(String),
      deletedAt: null,
    });
    expect(await handle.media.getForItem(item.id, media.id)).toEqual(media);
  });

  it("takes a caller-chosen id, so the files can be written under it before the row exists", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    expect((await handle.media.create({ ...image(item.id), id })).id).toBe(id);
  });

  it("appends: each new image goes after every other, a trashed one included", async () => {
    const a = await handle.media.create(image(item.id, { bytes: 1 }));
    await handle.media.create(image(item.id, { bytes: 2 }));
    await handle.media.softDelete(item.id, a.id);
    const c = await handle.media.create(image(item.id, { bytes: 3 }));
    // After the trashed one's slot too, so restoring it cannot land on c.
    expect(c.position).toBe(2);
    expect(await order(item.id)).toEqual([2, 3]);
  });

  it("numbers each item on its own", async () => {
    await handle.media.create(image(item.id));
    expect((await handle.media.create(image(other.id))).position).toBe(0);
  });

  it("rejects media pointing at a missing item", async () => {
    await expect(handle.media.create(image(UNKNOWN))).rejects.toThrow();
  });
});

describe("MediaRepository reads are scoped to the item", () => {
  it("getForItem refuses a media id that belongs to another item", async () => {
    const media = await handle.media.create(image(other.id));
    expect(await handle.media.getForItem(item.id, media.id)).toBeNull();
    expect(await handle.media.getForItem(other.id, media.id)).not.toBeNull();
  });

  it("lists in position order, leaving out trashed images unless asked", async () => {
    await handle.media.create(image(item.id, { bytes: 1 }));
    const b = await handle.media.create(image(item.id, { bytes: 2 }));
    await handle.media.create(image(item.id, { bytes: 3 }));
    await handle.media.softDelete(item.id, b.id);
    expect(await order(item.id)).toEqual([1, 3]);
    expect((await handle.media.listByItem(item.id, { includeDeleted: true })).map((m) => m.bytes)).toEqual([1, 2, 3]);
    expect(await handle.media.countLive(item.id)).toBe(2);
  });
});

describe("MediaRepository.reorder", () => {
  it("renumbers the live images in the order given", async () => {
    const a = await handle.media.create(image(item.id, { bytes: 1 }));
    const b = await handle.media.create(image(item.id, { bytes: 2 }));
    const c = await handle.media.create(image(item.id, { bytes: 3 }));
    expect(await handle.media.reorder(item.id, [c.id, a.id, b.id])).toBe(true);
    expect(await order(item.id)).toEqual([3, 1, 2]);
    expect((await handle.media.listByItem(item.id)).map((m) => m.position)).toEqual([0, 1, 2]);
  });

  it.each([
    ["a missing image", (ids: string[]) => ids.slice(1)],
    ["a repeated image", (ids: string[]) => [ids[0], ids[0], ids[1]]],
    ["an unknown id", (ids: string[]) => [...ids.slice(1), UNKNOWN]],
  ])("refuses a list with %s, writing nothing", async (_label, mangle) => {
    const ids = [];
    for (const bytes of [1, 2, 3]) ids.push((await handle.media.create(image(item.id, { bytes }))).id);
    expect(await handle.media.reorder(item.id, mangle(ids) as string[])).toBe(false);
    expect(await order(item.id)).toEqual([1, 2, 3]);
  });

  it("refuses another item's image and a trashed one", async () => {
    const a = await handle.media.create(image(item.id, { bytes: 1 }));
    const b = await handle.media.create(image(item.id, { bytes: 2 }));
    const foreign = await handle.media.create(image(other.id));
    expect(await handle.media.reorder(item.id, [b.id, foreign.id])).toBe(false);
    await handle.media.softDelete(item.id, b.id);
    expect(await handle.media.reorder(item.id, [b.id, a.id])).toBe(false);
    expect(await order(item.id)).toEqual([1]);
  });

  it("moveToFront makes an image the primary and keeps the rest in their order", async () => {
    await handle.media.create(image(item.id, { bytes: 1 }));
    await handle.media.create(image(item.id, { bytes: 2 }));
    const c = await handle.media.create(image(item.id, { bytes: 3 }));
    expect(await handle.media.moveToFront(item.id, c.id)).toBe(true);
    expect(await order(item.id)).toEqual([3, 1, 2]);
    expect(await handle.media.moveToFront(other.id, c.id)).toBe(false);
  });
});

describe("MediaRepository delete and restore", () => {
  it("restore puts an image back where it was, ahead of those that were after it", async () => {
    await handle.media.create(image(item.id, { bytes: 1 }));
    const b = await handle.media.create(image(item.id, { bytes: 2 }));
    await handle.media.create(image(item.id, { bytes: 3 }));
    expect(await handle.media.softDelete(item.id, b.id)).toBe(true);
    expect(await handle.media.restore(item.id, b.id)).toBe(true);
    expect(await order(item.id)).toEqual([1, 2, 3]);
  });

  it("restore after a reorder still lands in a slot of its own, never on top of another", async () => {
    const a = await handle.media.create(image(item.id, { bytes: 1 }));
    const b = await handle.media.create(image(item.id, { bytes: 2 }));
    const c = await handle.media.create(image(item.id, { bytes: 3 }));
    await handle.media.softDelete(item.id, a.id);
    await handle.media.reorder(item.id, [c.id, b.id]);
    await handle.media.restore(item.id, a.id);
    expect(await order(item.id)).toEqual([1, 3, 2]);
    const positions = (await handle.media.listByItem(item.id)).map((m) => m.position);
    expect(new Set(positions).size).toBe(3);
  });

  it("deleting the primary makes the next one primary", async () => {
    const a = await handle.media.create(image(item.id, { bytes: 1 }));
    await handle.media.create(image(item.id, { bytes: 2 }));
    await handle.media.softDelete(item.id, a.id);
    const primary = (await handle.media.primaryForItems([item.id])).get(item.id);
    expect(primary?.bytes).toBe(2);
  });

  it("refuses through the wrong item, and changes nothing", async () => {
    const media = await handle.media.create(image(item.id));
    expect(await handle.media.softDelete(other.id, media.id)).toBe(false);
    expect(await handle.media.getForItem(item.id, media.id)).not.toBeNull();
    await handle.media.softDelete(item.id, media.id);
    expect(await handle.media.restore(other.id, media.id)).toBe(false);
    expect(await handle.media.getForItem(item.id, media.id)).toBeNull();
  });

  it("soft delete and restore each act once", async () => {
    const media = await handle.media.create(image(item.id));
    expect(await handle.media.softDelete(item.id, media.id)).toBe(true);
    expect(await handle.media.softDelete(item.id, media.id)).toBe(false);
    expect(await handle.media.restore(item.id, media.id)).toBe(true);
    expect(await handle.media.restore(item.id, media.id)).toBe(false);
  });
});

describe("MediaRepository.primaryForItems", () => {
  it("maps each item to its first live image, and leaves out items with none", async () => {
    await handle.media.create(image(item.id, { bytes: 1 }));
    const b = await handle.media.create(image(item.id, { bytes: 2 }));
    await handle.media.moveToFront(item.id, b.id);
    const primaries = await handle.media.primaryForItems([item.id, other.id]);
    expect([...primaries.keys()]).toEqual([item.id]);
    expect(primaries.get(item.id)?.id).toBe(b.id);
  });

  it("answers an empty list without a query", async () => {
    expect((await handle.media.primaryForItems([])).size).toBe(0);
  });
});

describe("media and the trash", () => {
  it("an item's images stay with it in the trash and come back with it", async () => {
    await handle.media.create(image(item.id));
    await handle.items.softDelete(item.id);
    await handle.items.restore(item.id);
    expect(await handle.media.countLive(item.id)).toBe(1);
  });

  it("emptying the trash removes trashed images of live items, and leaves live images alone", async () => {
    const kept = await handle.media.create(image(item.id, { bytes: 1 }));
    const trashed = await handle.media.create(image(item.id, { bytes: 2 }));
    await handle.media.softDelete(item.id, trashed.id);
    await emptyTrash(handle);
    expect((await handle.media.listByItem(item.id, { includeDeleted: true })).map((m) => m.id)).toEqual([kept.id]);
  });

  it("listFileRefs names every row whose files must stay on disk, trashed ones included", async () => {
    const a = await handle.media.create(image(item.id));
    const b = await handle.media.create(image(other.id));
    await handle.media.softDelete(other.id, b.id);
    const refs = await handle.media.listFileRefs();
    expect(refs).toEqual(
      expect.arrayContaining([
        { itemId: item.id, id: a.id },
        { itemId: other.id, id: b.id },
      ]),
    );
    expect(refs).toHaveLength(2);
    // Purging the item cascades its rows away, and the refs follow.
    await handle.items.softDelete(item.id);
    await handle.items.purge(item.id);
    expect(await handle.media.listFileRefs()).toEqual([{ itemId: other.id, id: b.id }]);
  });
});
