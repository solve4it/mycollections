import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import type { Collection, FieldDefinition, Item, Media } from "@mycollections/core";
import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppOptions, buildApp } from "../app.js";
import { createJobLimiter } from "../media/job-limiter.js";
import { MediaStore } from "../media/media-store.js";

const TOKEN = "test-token";
const auth = { Authorization: `Bearer ${TOKEN}` };
const fields: FieldDefinition[] = [{ id: "title", type: "text", label: "Title", required: true }];
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

let handle: DatabaseHandle;
let root: string;
let mediaDir: string;
let store: MediaStore;
let collection: Collection;
let item: Item;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
  root = mkdtempSync(join(tmpdir(), "mycollections-media-routes-"));
  mediaDir = join(root, "media");
  store = await MediaStore.open(mediaDir);
  collection = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
  item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
});

afterEach(() => {
  handle.close();
  rmSync(root, { recursive: true, force: true });
});

function makeApp(media: Partial<NonNullable<AppOptions["media"]>> = {}, extra: Partial<AppOptions> = {}) {
  return buildApp({ db: handle, token: TOKEN, media: { store, ...media }, ...extra });
}

const jpeg = (width = 640, height = 480) =>
  sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .jpeg()
    .toBuffer();

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');

/** A multipart/form-data body with the given file parts. */
function form(parts: { body: Buffer; filename?: string; contentType?: string; name?: string }[]) {
  const boundary = "----mycollections-test-boundary";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name ?? "file"}"; filename="${part.filename ?? "photo.jpg"}"\r\nContent-Type: ${part.contentType ?? "image/jpeg"}\r\n\r\n`,
      ),
      part.body,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { ...auth, "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

const base = (collectionId = collection.id, itemId = item.id) =>
  `/api/collections/${collectionId}/items/${itemId}/media`;

async function upload(
  app: Awaited<ReturnType<typeof makeApp>>,
  body: Buffer,
  { source = "user-attached", url = base(), filename }: { source?: string; url?: string; filename?: string } = {},
) {
  const { payload, headers } = form([{ body, filename }]);
  return app.inject({ method: "POST", url: `${url}?source=${source}`, payload, headers });
}

/** Every file under the media directory, relative to it. */
function filesOnDisk(): string[] {
  if (!existsSync(mediaDir)) return [];
  return readdirSync(mediaDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(mediaDir.length + 1))
    .sort();
}

describe("POST …/media (upload)", () => {
  it("stores a processed image and answers with its record", async () => {
    const app = await makeApp();
    const res = await upload(app, await jpeg(4000, 3000), { source: "user-camera" });
    expect(res.statusCode).toBe(201);
    const media = res.json<Media>();
    expect(media).toMatchObject({
      itemId: item.id,
      kind: "image",
      source: "user-camera",
      mimeType: "image/webp",
      width: 2560,
      height: 1920,
      position: 0,
      deletedAt: null,
    });
    expect(filesOnDisk()).toEqual([`${item.id}/${media.id}.thumb.webp`, `${item.id}/${media.id}.webp`]);
    expect((await handle.media.listByItem(item.id)).map((m) => m.id)).toEqual([media.id]);
  });

  it.each([
    [
      "through another collection",
      async () => base((await handle.collections.create({ name: "Films", fields, isFiniteSet: false })).id),
    ],
    ["to an unknown item", async () => base(collection.id, UNKNOWN)],
    [
      "to an item in the trash",
      async () => {
        await handle.items.softDelete(item.id);
        return base();
      },
    ],
  ])("refuses an upload %s with 404, writing nothing", async (_label, url) => {
    const app = await makeApp();
    const res = await upload(app, await jpeg(), { url: await url() });
    expect(res.statusCode).toBe(404);
    expect(filesOnDisk()).toEqual([]);
    expect(await handle.media.listFileRefs()).toEqual([]);
  });

  it.each([["lookup"], ["camera"], [""]])("refuses source=%s — a client cannot claim a lookup", async (source) => {
    const app = await makeApp();
    const res = await upload(app, await jpeg(), { source });
    expect(res.statusCode).toBe(400);
    expect(filesOnDisk()).toEqual([]);
  });

  it.each([
    ["an SVG", SVG],
    ["text", Buffer.from("not an image")],
  ])("refuses %s with 415 and a fixed message, writing nothing", async (_label, body) => {
    const app = await makeApp();
    const res = await upload(app, body);
    expect(res.statusCode).toBe(415);
    expect(res.json().message).toBe("Unsupported image");
    expect(filesOnDisk()).toEqual([]);
    expect(await handle.media.listFileRefs()).toEqual([]);
  });

  it("refuses an upload over the size limit with 413", async () => {
    const app = await makeApp({ maxUploadBytes: 1024 });
    const res = await upload(app, await jpeg(800, 800));
    expect(res.statusCode).toBe(413);
    expect(res.json().message).toBe("Image too large");
    expect(filesOnDisk()).toEqual([]);
  });

  it("refuses a second file in the same request", async () => {
    const app = await makeApp();
    const image = await jpeg();
    const { payload, headers } = form([{ body: image }, { body: image, filename: "second.jpg" }]);
    const res = await app.inject({ method: "POST", url: `${base()}?source=user-attached`, payload, headers });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await handle.media.listFileRefs()).toEqual([]);
  });

  it("refuses a request with no file", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "POST", url: `${base()}?source=user-attached`, headers: auth });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it("answers 503 when the server is already busy processing images", async () => {
    const app = await makeApp({ limiter: createJobLimiter({ concurrency: 0, maxWaiting: 0 }) });
    const res = await upload(app, await jpeg());
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(filesOnDisk()).toEqual([]);
  });

  it("refuses an image past the per-item cap with 409", async () => {
    const app = await makeApp({ maxImagesPerItem: 1 });
    expect((await upload(app, await jpeg())).statusCode).toBe(201);
    const res = await upload(app, await jpeg());
    expect(res.statusCode).toBe(409);
    expect(await handle.media.countLive(item.id)).toBe(1);
  });

  it("never writes the client's file name to the log", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const app = await makeApp({}, { logger: { level: "trace", stream } });
    await upload(app, await jpeg(), { filename: "do-not-log-this-name.jpg" });
    await upload(app, SVG, { filename: "do-not-log-this-name.svg" });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("")).not.toContain("do-not-log-this-name");
  });

  it("is not registered without a media store", async () => {
    const app = await buildApp({ db: handle, token: TOKEN });
    expect((await upload(app, await jpeg())).statusCode).toBe(404);
  });
});

describe("GET …/media/:mediaId/{display,thumb}", () => {
  it("serves each variant as WebP that cannot run as a document and is not kept in the disk cache", async () => {
    const app = await makeApp();
    const media = (await upload(app, await jpeg(1000, 500))).json<Media>();
    for (const [variant, width] of [
      ["display", 1000],
      ["thumb", 480],
    ] as const) {
      const res = await app.inject({ method: "GET", url: `${base()}/${media.id}/${variant}`, headers: auth });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("image/webp");
      expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-disposition"]).toBe("inline");
      expect((await sharp(res.rawPayload).metadata()).width).toBe(width);
    }
  });

  it("answers 404 through the wrong item, the wrong collection, and for a trashed image", async () => {
    const app = await makeApp();
    const media = (await upload(app, await jpeg())).json<Media>();
    const other = await handle.items.create({ collectionId: collection.id, fields: { title: "Emma" } });
    const films = await handle.collections.create({ name: "Films", fields, isFiniteSet: false });
    for (const url of [
      `${base(collection.id, other.id)}/${media.id}/display`,
      `${base(films.id)}/${media.id}/display`,
    ]) {
      expect((await app.inject({ method: "GET", url, headers: auth })).statusCode).toBe(404);
    }
    await handle.media.softDelete(item.id, media.id);
    expect((await app.inject({ method: "GET", url: `${base()}/${media.id}/display`, headers: auth })).statusCode).toBe(
      404,
    );
  });

  it("answers 404, not 500, when a row has outlived its file", async () => {
    const app = await makeApp();
    const media = (await upload(app, await jpeg())).json<Media>();
    await store.remove(item.id, media.id);
    expect((await app.inject({ method: "GET", url: `${base()}/${media.id}/thumb`, headers: auth })).statusCode).toBe(
      404,
    );
  });

  it("refuses an id that is not a UUID before anything touches the disk", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: `${base()}/${encodeURIComponent("../../app.db")}/display`,
      headers: auth,
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses an unknown variant", async () => {
    const app = await makeApp();
    const media = (await upload(app, await jpeg())).json<Media>();
    expect((await app.inject({ method: "GET", url: `${base()}/${media.id}/original`, headers: auth })).statusCode).toBe(
      404,
    );
  });
});

describe("listing, ordering and the primary", () => {
  async function three(app: Awaited<ReturnType<typeof makeApp>>) {
    const ids: string[] = [];
    for (const width of [300, 400, 500]) ids.push((await upload(app, await jpeg(width, 200))).json<Media>().id);
    return ids;
  }

  it("lists an item's images in order", async () => {
    const app = await makeApp();
    const ids = await three(app);
    const res = await app.inject({ method: "GET", url: base(), headers: auth });
    expect(res.json<Media[]>().map((m) => [m.id, m.width])).toEqual([
      [ids[0], 300],
      [ids[1], 400],
      [ids[2], 500],
    ]);
  });

  it("PUT …/media/order puts them in the order given", async () => {
    const app = await makeApp();
    const [a, b, c] = await three(app);
    const res = await app.inject({ method: "PUT", url: `${base()}/order`, headers: auth, payload: { ids: [c, a, b] } });
    expect(res.statusCode).toBe(200);
    expect(res.json<Media[]>().map((m) => m.id)).toEqual([c, a, b]);
  });

  it("refuses a stale order with 409 and changes nothing", async () => {
    const app = await makeApp();
    const [a, b, c] = await three(app);
    const res = await app.inject({ method: "PUT", url: `${base()}/order`, headers: auth, payload: { ids: [c, a] } });
    expect(res.statusCode).toBe(409);
    expect((await handle.media.listByItem(item.id)).map((m) => m.id)).toEqual([a, b, c]);
  });

  it("make-primary moves an image to the front, and refuses another item's image", async () => {
    const app = await makeApp();
    const [a, b, c] = await three(app);
    const res = await app.inject({ method: "POST", url: `${base()}/${c}/make-primary`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json<Media[]>().map((m) => m.id)).toEqual([c, a, b]);
    const other = await handle.items.create({ collectionId: collection.id, fields: { title: "Emma" } });
    const wrong = await app.inject({
      method: "POST",
      url: `${base(collection.id, other.id)}/${a}/make-primary`,
      headers: auth,
    });
    expect(wrong.statusCode).toBe(404);
  });

  it("DELETE trashes an image, keeping its files for an Undo, and restore puts it back in its slot", async () => {
    const app = await makeApp();
    const [a, b, c] = await three(app);
    const del = await app.inject({ method: "DELETE", url: `${base()}/${b}`, headers: auth });
    expect(del.statusCode).toBe(204);
    expect((await handle.media.listByItem(item.id)).map((m) => m.id)).toEqual([a, c]);
    expect(filesOnDisk()).toContain(`${item.id}/${b}.webp`);

    const restored = await app.inject({ method: "POST", url: `${base()}/${b}/restore`, headers: auth });
    expect(restored.statusCode).toBe(200);
    expect((await handle.media.listByItem(item.id)).map((m) => m.id)).toEqual([a, b, c]);
  });

  it("DELETE and restore through the wrong item answer 404 and change nothing", async () => {
    const app = await makeApp();
    const [a] = await three(app);
    const other = await handle.items.create({ collectionId: collection.id, fields: { title: "Emma" } });
    expect(
      (await app.inject({ method: "DELETE", url: `${base(collection.id, other.id)}/${a}`, headers: auth })).statusCode,
    ).toBe(404);
    expect(await handle.media.countLive(item.id)).toBe(3);
  });
});

describe("primaryMedia on item responses", () => {
  it("rides on every item response, so no response can drop a row's thumbnail", async () => {
    const app = await makeApp();
    const first = (await upload(app, await jpeg(300, 200))).json<Media>();
    const plain = await handle.items.create({ collectionId: collection.id, fields: { title: "Emma" } });
    const primary = { id: first.id, width: 300, height: 200 };

    const list = await app.inject({ method: "GET", url: `/api/collections/${collection.id}/items`, headers: auth });
    const byTitle = Object.fromEntries(
      list.json<(Item & { primaryMedia: unknown })[]>().map((i) => [i.fields.title, i.primaryMedia]),
    );
    expect(byTitle).toEqual({ Dune: primary, Emma: null });

    const one = await app.inject({
      method: "GET",
      url: `/api/collections/${collection.id}/items/${item.id}`,
      headers: auth,
    });
    expect(one.json().primaryMedia).toEqual(primary);

    // A status change answers with the item the list cache is patched from.
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/collections/${collection.id}/items/${item.id}`,
      headers: auth,
      payload: { status: "wanted" },
    });
    expect(patched.json().primaryMedia).toEqual(primary);

    const created = await app.inject({
      method: "POST",
      url: `/api/collections/${collection.id}/items`,
      headers: auth,
      payload: { fields: { title: "Persuasion" } },
    });
    expect(created.json().primaryMedia).toBeNull();

    await handle.items.softDelete(item.id);
    const restored = await app.inject({
      method: "POST",
      url: `/api/collections/${collection.id}/items/${item.id}/restore`,
      headers: auth,
    });
    expect(restored.json().primaryMedia).toEqual(primary);
    expect(plain.id).toBeDefined();
  });
});

describe("purging removes the files at once", () => {
  it("purging an item removes its images' files", async () => {
    const app = await makeApp();
    await upload(app, await jpeg());
    await handle.items.softDelete(item.id);
    const res = await app.inject({ method: "DELETE", url: `/api/trash/items/${item.id}`, headers: auth });
    expect(res.statusCode).toBe(204);
    expect(filesOnDisk()).toEqual([]);
    expect(existsSync(join(mediaDir, item.id))).toBe(false);
  });

  it("purging a collection removes the files of every item in it", async () => {
    const app = await makeApp();
    await upload(app, await jpeg());
    const other = await handle.items.create({ collectionId: collection.id, fields: { title: "Emma" } });
    await upload(app, await jpeg(), { url: base(collection.id, other.id) });
    await handle.collections.softDelete(collection.id);
    const res = await app.inject({ method: "DELETE", url: `/api/trash/collections/${collection.id}`, headers: auth });
    expect(res.statusCode).toBe(204);
    expect(filesOnDisk()).toEqual([]);
  });

  it("emptying the trash removes trashed images' files — even ones uploaded a moment ago — and keeps live ones", async () => {
    const app = await makeApp();
    const kept = (await upload(app, await jpeg())).json<Media>();
    const trashed = (await upload(app, await jpeg())).json<Media>();
    await app.inject({ method: "DELETE", url: `${base()}/${trashed.id}`, headers: auth });
    const res = await app.inject({ method: "DELETE", url: "/api/trash", headers: auth });
    expect(res.statusCode).toBe(200);
    // The counts the web shows are unchanged: images are not listed in the trash.
    expect(res.json()).toEqual({ items: 0, collections: 0 });
    expect(filesOnDisk()).toEqual([`${item.id}/${kept.id}.thumb.webp`, `${item.id}/${kept.id}.webp`]);
  });
});
