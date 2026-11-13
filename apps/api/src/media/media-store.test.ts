import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MediaStore } from "./media-store.js";

const ITEM = "11111111-1111-4111-8111-111111111111";
const OTHER_ITEM = "22222222-2222-4222-8222-222222222222";
const MEDIA = "33333333-3333-4333-8333-333333333333";
const MEDIA_2 = "44444444-4444-4444-8444-444444444444";

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mycollections-media-"));
  dir = join(root, "media");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const files = (display = "display bytes", thumb = "thumb bytes") => ({
  display: Buffer.from(display),
  thumb: Buffer.from(thumb),
});

/** Ages a path past the sweep's grace period. */
function age(path: string) {
  const old = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(path, old, old);
}

describe("MediaStore", () => {
  it("creates its directory readable by the owner only", async () => {
    await MediaStore.open(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("writes both files under the item, owner-only, with nothing left behind", async () => {
    const store = await MediaStore.open(dir);
    await store.write(ITEM, MEDIA, files());
    expect(readdirSync(join(dir, ITEM)).sort()).toEqual([`${MEDIA}.thumb.webp`, `${MEDIA}.webp`]);
    expect(statSync(join(dir, ITEM)).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, ITEM, `${MEDIA}.webp`)).mode & 0o777).toBe(0o600);
  });

  it("reads back each variant, and answers null for one that is not there", async () => {
    const store = await MediaStore.open(dir);
    await store.write(ITEM, MEDIA, files("the display", "the thumb"));
    const display = await store.read(ITEM, MEDIA, "display");
    const thumb = await store.read(ITEM, MEDIA, "thumb");
    expect(display && (await text(display))).toBe("the display");
    expect(thumb && (await text(thumb))).toBe("the thumb");
    expect(await store.read(ITEM, MEDIA_2, "display")).toBeNull();
    expect(await store.read(OTHER_ITEM, MEDIA, "display")).toBeNull();
  });

  it.each([
    ["a traversal in the item id", "../../etc", MEDIA],
    ["a traversal in the media id", ITEM, "../secret"],
    ["an empty id", ITEM, ""],
  ])("refuses %s before touching the disk", async (_label, itemId, mediaId) => {
    const store = await MediaStore.open(dir);
    await expect(store.write(itemId, mediaId, files())).rejects.toThrow(TypeError);
    await expect(store.read(itemId, mediaId, "display")).rejects.toThrow(TypeError);
    await expect(store.remove(itemId, mediaId)).rejects.toThrow(TypeError);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("removes one image's files and leaves the item's others", async () => {
    const store = await MediaStore.open(dir);
    await store.write(ITEM, MEDIA, files());
    await store.write(ITEM, MEDIA_2, files());
    await store.remove(ITEM, MEDIA);
    expect(readdirSync(join(dir, ITEM)).sort()).toEqual([`${MEDIA_2}.thumb.webp`, `${MEDIA_2}.webp`]);
    // Removing what is already gone is not an error.
    await store.remove(ITEM, MEDIA);
  });
});

describe("MediaStore.sweep", () => {
  it("removes the files of rows that are gone and the folders of items that are gone, and keeps the rest", async () => {
    const store = await MediaStore.open(dir);
    await store.write(ITEM, MEDIA, files());
    await store.write(ITEM, MEDIA_2, files());
    await store.write(OTHER_ITEM, MEDIA, files());
    for (const name of [ITEM, OTHER_ITEM]) {
      for (const file of readdirSync(join(dir, name))) age(join(dir, name, file));
    }

    const removed = await store.sweep([{ itemId: ITEM, id: MEDIA }]);
    expect(removed).toBe(4);
    expect(readdirSync(join(dir, ITEM)).sort()).toEqual([`${MEDIA}.thumb.webp`, `${MEDIA}.webp`]);
    expect(existsSync(join(dir, OTHER_ITEM))).toBe(false);
  });

  it("removes a write that a crash left half done", async () => {
    const store = await MediaStore.open(dir);
    mkdirSync(join(dir, ITEM), { recursive: true });
    const temp = join(dir, ITEM, ".55555555-5555-4555-8555-555555555555.tmp");
    writeFileSync(temp, "partial");
    age(temp);
    expect(await store.sweep([])).toBe(1);
    expect(existsSync(join(dir, ITEM))).toBe(false);
  });

  it("leaves alone a write that may still be in flight", async () => {
    // An upload writes its files before it inserts its row; for that moment the
    // files are unreferenced, and a sweep then must not take them.
    const store = await MediaStore.open(dir);
    await store.write(ITEM, MEDIA, files());
    expect(await store.sweep([])).toBe(0);
    expect(readdirSync(join(dir, ITEM))).toHaveLength(2);
  });

  it("never deletes anything it did not create — a media directory pointed at the wrong place loses nothing", async () => {
    const store = await MediaStore.open(dir);
    const strangers = [join(dir, "notes.txt"), join(dir, "Photos")];
    writeFileSync(strangers[0] as string, "mine");
    mkdirSync(strangers[1] as string);
    mkdirSync(join(dir, ITEM));
    const holiday = join(dir, ITEM, "holiday.jpg");
    writeFileSync(holiday, "mine too");
    for (const path of [...strangers, holiday]) age(path);

    expect(await store.sweep([])).toBe(0);
    for (const path of [...strangers, holiday]) expect(existsSync(path)).toBe(true);
  });
});
