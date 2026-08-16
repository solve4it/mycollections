import type { Collection, DeletedItem, FieldDefinition } from "@mycollections/core";
import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const TOKEN = "test-token";
const auth = { Authorization: `Bearer ${TOKEN}` };
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

const baseFields: FieldDefinition[] = [{ id: "title", type: "text", label: "Title", required: true }];

let handle: DatabaseHandle;
let collection: Collection;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
  collection = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: false });
});

afterEach(() => {
  handle.close();
});

async function makeApp() {
  return buildApp({ db: handle, token: TOKEN });
}

interface TrashBody {
  collections: Collection[];
  items: DeletedItem[];
}

describe("GET /api/trash", () => {
  it("returns empty lists when nothing is deleted", async () => {
    await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    const app = await makeApp();

    const res = await app.inject({ method: "GET", url: "/api/trash", headers: auth });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ collections: [], items: [] });
  });

  it("returns deleted items with their collection name, and deleted collections", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    await handle.items.softDelete(item.id);
    const movies = await handle.collections.create({ name: "Movies", fields: baseFields, isFiniteSet: false });
    await handle.collections.softDelete(movies.id);
    const app = await makeApp();

    const res = await app.inject({ method: "GET", url: "/api/trash", headers: auth });

    expect(res.statusCode).toBe(200);
    const body = res.json() as TrashBody;
    expect(body.collections.map((c) => c.name)).toEqual(["Movies"]);
    expect(body.items.map((i) => [i.fields.title, i.collectionName])).toEqual([["Dune", "Books"]]);
  });

  it("hides items whose collection is in the trash — the collection restores them", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    await handle.items.softDelete(item.id);
    await handle.collections.softDelete(collection.id);
    const app = await makeApp();

    const res = await app.inject({ method: "GET", url: "/api/trash", headers: auth });

    const body = res.json() as TrashBody;
    expect(body.items).toEqual([]);
    expect(body.collections.map((c) => c.name)).toEqual(["Books"]);
  });

  it("requires authentication", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/trash" });
    expect(res.statusCode).toBe(401);
  });
});

describe("DELETE /api/trash/items/:itemId", () => {
  it("permanently removes a soft-deleted item and returns 204", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    await handle.items.softDelete(item.id);
    const app = await makeApp();

    const res = await app.inject({ method: "DELETE", url: `/api/trash/items/${item.id}`, headers: auth });

    expect(res.statusCode).toBe(204);
    expect(await handle.items.getById(item.id, { includeDeleted: true })).toBeNull();
  });

  it("refuses to purge a live item and leaves it untouched", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    const app = await makeApp();

    const res = await app.inject({ method: "DELETE", url: `/api/trash/items/${item.id}`, headers: auth });

    expect(res.statusCode).toBe(404);
    expect(await handle.items.getById(item.id)).not.toBeNull();
  });

  it("returns 404 for an unknown item", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "DELETE", url: `/api/trash/items/${UNKNOWN_ID}`, headers: auth });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/trash/collections/:id", () => {
  it("permanently removes a soft-deleted collection and its items", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    await handle.collections.softDelete(collection.id);
    const app = await makeApp();

    const res = await app.inject({ method: "DELETE", url: `/api/trash/collections/${collection.id}`, headers: auth });

    expect(res.statusCode).toBe(204);
    expect(await handle.collections.getById(collection.id, { includeDeleted: true })).toBeNull();
    expect(await handle.items.getById(item.id, { includeDeleted: true })).toBeNull();
  });

  it("refuses to purge a live collection and leaves it and its items untouched", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    const app = await makeApp();

    const res = await app.inject({ method: "DELETE", url: `/api/trash/collections/${collection.id}`, headers: auth });

    expect(res.statusCode).toBe(404);
    expect(await handle.collections.getById(collection.id)).not.toBeNull();
    expect(await handle.items.getById(item.id)).not.toBeNull();
  });

  it("returns 404 for an unknown collection", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "DELETE", url: `/api/trash/collections/${UNKNOWN_ID}`, headers: auth });
    expect(res.statusCode).toBe(404);
  });
});
