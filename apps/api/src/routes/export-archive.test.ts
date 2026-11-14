import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FieldDefinition } from "@mycollections/core";
import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { DEFAULT_ARCHIVE_LIMITS, openExportArchive } from "../archive/read-export-archive.js";
import { MediaStore } from "../media/media-store.js";

const TOKEN = "test-token";
const auth = { Authorization: `Bearer ${TOKEN}` };
const fields: FieldDefinition[] = [{ id: "title", type: "text", label: "Title", required: true }];

let root: string;
let handle: DatabaseHandle;
let store: MediaStore;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "export-archive-"));
  handle = await openDatabase({ path: ":memory:" });
  store = await MediaStore.open(join(root, "media"));
});

afterEach(() => {
  handle.close();
  rmSync(root, { recursive: true, force: true });
});

async function webp(width = 8, height = 6): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .webp()
    .toBuffer();
}

async function seed(name = "Records") {
  const collection = await handle.collections.create({ name, fields, isFiniteSet: false });
  const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Kind of Blue" } });
  const display = await webp();
  const image = await handle.media.create({
    itemId: item.id,
    source: "user-attached",
    mimeType: "image/webp",
    bytes: display.length,
    width: 8,
    height: 6,
  });
  await store.write(item.id, image.id, { display, thumb: await webp(4, 3) });
  return { collection, item, image, display };
}

async function makeApp(db = handle, mediaStore = store) {
  return buildApp({ db, token: TOKEN, media: { store: mediaStore } });
}

/** Writes a response body to disk and opens it with the import's own reader. */
async function readArchive(body: Buffer) {
  const path = join(root, `got-${Math.random().toString(16).slice(2)}.zip`);
  writeFileSync(path, body);
  return openExportArchive(path, DEFAULT_ARCHIVE_LIMITS);
}

describe("GET /api/export as an archive (#45)", () => {
  it("is a zip holding the document with its image rows and each image's display file", async () => {
    const { image, display } = await seed();
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/export", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="mycollections-export-\d{4}-\d{2}-\d{2}\.zip"/,
    );

    const archive = await readArchive(res.rawPayload);
    try {
      expect(archive.document.media).toEqual([image]);
      expect((await archive.readImage(image)).equals(display)).toBe(true);
    } finally {
      await archive.close();
    }
  });

  it("leaves out a row whose file is missing, so the archive never names a file it does not hold", async () => {
    const { item, image } = await seed();
    await store.remove(item.id, image.id);
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/export", headers: auth });
    const archive = await readArchive(res.rawPayload);
    try {
      expect(archive.document.media).toEqual([]);
      expect(archive.document.items.map((i) => i.id)).toEqual([item.id]);
    } finally {
      await archive.close();
    }
  });

  it("round-trips through the import into an empty server, images and all", async () => {
    const { collection, item, image } = await seed();
    const exported = await (await makeApp()).inject({ method: "GET", url: "/api/export", headers: auth });

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      const freshStore = await MediaStore.open(join(root, "fresh-media"));
      const target = await makeApp(fresh, freshStore);
      const res = await target.inject({
        method: "POST",
        url: "/api/import",
        headers: { ...auth, "content-type": "application/zip" },
        payload: exported.rawPayload,
      });
      expect(res.json()).toMatchObject({ collectionsImported: 1, itemsImported: 1, mediaImported: 1 });
      expect(await fresh.media.listByItem(item.id)).toEqual([image]);
      const served = await target.inject({
        method: "GET",
        url: `/api/collections/${collection.id}/items/${item.id}/media/${image.id}/thumb`,
        headers: auth,
      });
      expect(served.statusCode).toBe(200);
    } finally {
      fresh.close();
    }
  });
});

describe("GET /api/collections/:id/export (#45)", () => {
  it("holds one collection, its items and their images, and nothing of any other", async () => {
    const { collection, image } = await seed();
    await seed("Books");
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${collection.id}/export`, headers: auth });
    expect(res.statusCode).toBe(200);
    const archive = await readArchive(res.rawPayload);
    try {
      expect(archive.document.collections.map((c) => c.id)).toEqual([collection.id]);
      expect(archive.document.media).toEqual([image]);
    } finally {
      await archive.close();
    }
  });

  it("names the file after the collection, safely: an ASCII fallback plus the UTF-8 name, nothing that breaks the header", async () => {
    const { collection } = await seed('Café "best"\r\nof/2026');
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${collection.id}/export`, headers: auth });
    const header = String(res.headers["content-disposition"]);
    expect(header).toMatch(
      /^attachment; filename="mycollections-caf-best-of-2026-\d{4}-\d{2}-\d{2}\.zip"; filename\*=UTF-8''/,
    );
    expect(header).not.toMatch(/[\r\n]/);
    const encoded = header.slice(header.indexOf("UTF-8''") + 7);
    expect(decodeURIComponent(encoded)).toMatch(/^mycollections-Café best of 2026-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  it("answers 404 for a collection in the trash, as its page does", async () => {
    const { collection } = await seed();
    await handle.collections.softDelete(collection.id);
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${collection.id}/export`, headers: auth });
    expect(res.statusCode).toBe(404);
  });

  it("refuses an id that is not a UUID before looking anything up", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/collections/not-an-id/export", headers: auth });
    expect(res.statusCode).toBe(400);
  });

  it("requires authentication", async () => {
    const { collection } = await seed();
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${collection.id}/export` });
    expect(res.statusCode).toBe(401);
  });
});
