import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExportDocument, FieldDefinition, Media } from "@mycollections/core";
import { type DatabaseHandle, exportBackup, openDatabase } from "@mycollections/db";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import { buildApp } from "../app.js";
import { createJobLimiter, type JobLimiter } from "../media/job-limiter.js";
import { MediaStore } from "../media/media-store.js";

const TOKEN = "test-token";
const auth = { Authorization: `Bearer ${TOKEN}` };
const fields: FieldDefinition[] = [{ id: "title", type: "text", label: "Title", required: true }];
const INVALID = { statusCode: 400, error: "Bad Request", message: "Invalid import file" };

let root: string;
let source: DatabaseHandle;
let target: DatabaseHandle;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "import-archive-"));
  source = await openDatabase({ path: ":memory:" });
  target = await openDatabase({ path: ":memory:" });
});

afterEach(() => {
  source.close();
  target.close();
  rmSync(root, { recursive: true, force: true });
});

async function webp(width = 8, height = 6): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .webp()
    .toBuffer();
}

/** A source collection with one item and `count` image rows, and the export document for it. */
async function sourceDocument(count = 1): Promise<{ document: ExportDocument; rows: Media[] }> {
  const collection = await source.collections.create({ name: "Records", fields, isFiniteSet: false });
  const item = await source.items.create({ collectionId: collection.id, fields: { title: "Kind of Blue" } });
  const rows: Media[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(
      await source.media.create({
        itemId: item.id,
        source: "user-attached",
        mimeType: "image/webp",
        bytes: 1,
        width: 1,
        height: 1,
      }),
    );
  }
  return { document: await exportBackup(source), rows };
}

async function archive(document: ExportDocument, images: Map<string, Buffer>, extra: [string, Buffer][] = []) {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(document)), "export.json");
  for (const row of document.media) {
    const bytes = images.get(row.id);
    if (bytes) zip.addBuffer(bytes, `media/${row.itemId}/${row.id}.webp`, { compress: false });
  }
  for (const [name, bytes] of extra) zip.addBuffer(bytes, name);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function targetApp(options: { limiter?: JobLimiter; maxArchiveBytes?: number } = {}) {
  const store = await MediaStore.open(join(root, "media"));
  const app = await buildApp({
    db: target,
    token: TOKEN,
    media: { store, limiter: options.limiter },
    importLimits: options.maxArchiveBytes === undefined ? undefined : { maxArchiveBytes: options.maxArchiveBytes },
  });
  return { app, store };
}

function postZip(app: Awaited<ReturnType<typeof buildApp>>, body: Buffer) {
  return app.inject({
    method: "POST",
    url: "/api/import",
    headers: { ...auth, "content-type": "application/zip" },
    payload: body,
  });
}

function mediaFiles(): string[] {
  const dir = join(root, "media");
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

describe("POST /api/import with an archive (#45)", () => {
  it("restores collections, items and images, re-processing each image and recomputing its size", async () => {
    const { document, rows } = await sourceDocument(2);
    const images = new Map([
      [rows[0]?.id as string, await webp(8, 6)],
      [rows[1]?.id as string, await webp(4, 4)],
    ]);
    const { app } = await targetApp();
    const res = await postZip(app, await archive(document, images));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      collectionsImported: 1,
      collectionsSkipped: 0,
      itemsImported: 1,
      itemsSkipped: 0,
      mediaImported: 2,
      mediaSkipped: 0,
    });

    const restored = await target.media.listByItem(rows[0]?.itemId as string);
    expect(restored.map((m) => m.id)).toEqual(rows.map((m) => m.id));
    // The manifest said 1×1; the stored image is what processing produced.
    expect(restored.map((m) => [m.width, m.height])).toEqual([
      [8, 6],
      [4, 4],
    ]);
    const display = await app.inject({
      method: "GET",
      url: `/api/collections/${document.collections[0]?.id}/items/${rows[0]?.itemId}/media/${rows[0]?.id}/display`,
      headers: auth,
    });
    expect(display.statusCode).toBe(200);
  });

  it("leaves nothing behind in the import folder", async () => {
    const { document, rows } = await sourceDocument(1);
    const { app } = await targetApp();
    await postZip(app, await archive(document, new Map([[rows[0]?.id as string, await webp()]])));
    expect(readdirSync(join(root, "media", ".import"))).toEqual([]);
  });

  it("removes every file it wrote and writes no row when a later image is refused", async () => {
    const { document, rows } = await sourceDocument(2);
    const images = new Map([
      [rows[0]?.id as string, await webp()],
      [rows[1]?.id as string, Buffer.from("plain text pretending to be an image")],
    ]);
    const { app } = await targetApp();
    const res = await postZip(app, await archive(document, images));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(INVALID);
    expect(mediaFiles()).toEqual([]);
    expect(await target.collections.list({ includeDeleted: true })).toEqual([]);
  });

  it("never touches an image already here: same document again skips it and keeps its file byte for byte", async () => {
    const { document, rows } = await sourceDocument(1);
    const row = rows[0] as Media;
    const { app } = await targetApp();
    expect((await postZip(app, await archive(document, new Map([[row.id, await webp(8, 6)]])))).statusCode).toBe(200);
    const path = join(root, "media", row.itemId, `${row.id}.webp`);
    const before = readFileSync(path);

    const again = await postZip(app, await archive(document, new Map([[row.id, await webp(30, 30)]])));
    expect(again.json()).toMatchObject({ mediaImported: 0, mediaSkipped: 1 });
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("answers an oversized upload with 413 and keeps nothing of it", async () => {
    const { document, rows } = await sourceDocument(1);
    const { app } = await targetApp({ maxArchiveBytes: 100 });
    const res = await postZip(app, await archive(document, new Map([[rows[0]?.id as string, await webp()]])));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ statusCode: 413, error: "Payload Too Large", message: "Import too large" });
    expect(readdirSync(join(root, "media", ".import"))).toEqual([]);
  });

  it("refuses a body that is not a zip at all", async () => {
    const { app } = await targetApp();
    const res = await postZip(app, Buffer.from("not an archive"));
    expect(res.json()).toEqual(INVALID);
  });

  it("refuses a second import while one is running, rather than interleave them", async () => {
    const { document, rows } = await sourceDocument(1);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = createJobLimiter({ concurrency: 1, maxWaiting: 2 });
    const limiter: JobLimiter = { run: (job, options) => held.then(() => base.run(job, options)) };
    const { app } = await targetApp({ limiter });
    const body = await archive(document, new Map([[rows[0]?.id as string, await webp()]]));

    const first = postZip(app, body);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await postZip(app, body);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ statusCode: 409, error: "Conflict", message: "Another import is in progress" });
    release();
    expect((await first).statusCode).toBe(200);
  });
});

describe("POST /api/import with JSON, alongside archives (#45)", () => {
  it("accepts a document larger than Fastify's default 1 MiB body limit", async () => {
    const collection = await source.collections.create({ name: "Records", fields, isFiniteSet: false });
    for (let i = 0; i < 1200; i++) {
      await source.items.create({ collectionId: collection.id, fields: { title: `Record ${i} ${"x".repeat(1000)}` } });
    }
    const document = await exportBackup(source);
    const body = JSON.stringify(document);
    expect(body.length).toBeGreaterThan(1024 * 1024);
    const { app } = await targetApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/import",
      headers: { ...auth, "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ itemsImported: 1200 });
  });

  it("refuses image rows in a JSON body, which cannot carry their files", async () => {
    const { document } = await sourceDocument(1);
    const { app } = await targetApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/import",
      headers: { ...auth, "content-type": "application/json" },
      payload: JSON.stringify(document),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(INVALID);
    expect(existsSync(join(root, "media", document.media[0]?.itemId as string))).toBe(false);
  });
});
