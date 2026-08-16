import type { Collection, FieldDefinition, Item } from "@mycollections/core";
import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const TOKEN = "test-token";
const auth = { Authorization: `Bearer ${TOKEN}` };

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

describe("GET /api/collections/:id/items", () => {
  it("returns empty array when no items", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${collection.id}/items`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns items for a collection", async () => {
    await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${collection.id}/items`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("returns 404 for unknown collection", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/collections/00000000-0000-4000-8000-000000000000/items",
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
  });

  it("filters by status query param", async () => {
    await handle.items.create({ collectionId: collection.id, status: "owned", fields: { title: "A" } });
    await handle.items.create({ collectionId: collection.id, status: "wanted", fields: { title: "B" } });
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/collections/${collection.id}/items?status=owned`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json<Item[]>()[0]?.status).toBe("owned");
  });
});

describe("POST /api/collections/:id/items", () => {
  it("creates an item with default status and returns 201", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/collections/${collection.id}/items`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { fields: { title: "Dune" } },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Item>();
    expect(body.status).toBe("owned");
    expect(body.fields).toEqual({ title: "Dune" });
  });

  it("creates an item with explicit status", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/collections/${collection.id}/items`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { status: "wanted", fields: {} },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<Item>().status).toBe("wanted");
  });

  it("returns 400 for missing fields property", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/collections/${collection.id}/items`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { status: "owned" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for unknown collection", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/collections/00000000-0000-4000-8000-000000000000/items",
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { fields: {} },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/collections/:id/items/:itemId", () => {
  it("returns 404 for unknown item", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/collections/${collection.id}/items/00000000-0000-4000-8000-000000000000`,
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns the item by id", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/collections/${collection.id}/items/${item.id}`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Item>().id).toBe(item.id);
  });
});

describe("PATCH /api/collections/:id/items/:itemId", () => {
  it("updates status and fields", async () => {
    const item = await handle.items.create({ collectionId: collection.id, status: "wanted", fields: {} });
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${collection.id}/items/${item.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { status: "owned", fields: { title: "Foundation" } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Item>();
    expect(body.status).toBe("owned");
    expect(body.fields).toEqual({ title: "Foundation" });
  });

  it("returns 404 for unknown item", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${collection.id}/items/00000000-0000-4000-8000-000000000000`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { status: "owned" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("updates only the status when fields is omitted", async () => {
    const item = await handle.items.create({
      collectionId: collection.id,
      status: "wanted",
      fields: { title: "Dune" },
    });
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${collection.id}/items/${item.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { status: "ordered" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Item>();
    expect(body.status).toBe("ordered");
    expect(body.fields).toEqual({ title: "Dune" });
  });

  it("updates only fields when status is omitted", async () => {
    const item = await handle.items.create({
      collectionId: collection.id,
      status: "wanted",
      fields: { title: "Dune" },
    });
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${collection.id}/items/${item.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { fields: { title: "Foundation" } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Item>();
    expect(body.status).toBe("wanted");
    expect(body.fields).toEqual({ title: "Foundation" });
  });

  it("returns 404 and leaves the item untouched when addressed via a different collection", async () => {
    const other = await handle.collections.create({ name: "Other", fields: baseFields, isFiniteSet: false });
    const item = await handle.items.create({
      collectionId: collection.id,
      status: "wanted",
      fields: { title: "Dune" },
    });
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${other.id}/items/${item.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { status: "owned", fields: { title: "MUTATED" } },
    });
    expect(res.statusCode).toBe(404);
    // The 404 must be side-effect free: the item keeps its original state.
    const after = await handle.items.getById(item.id);
    expect(after?.status).toBe("wanted");
    expect(after?.fields).toEqual({ title: "Dune" });
  });
});

describe("DELETE /api/collections/:id/items/:itemId", () => {
  it("soft-deletes an item and returns 204", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: {} });
    const app = await makeApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/collections/${collection.id}/items/${item.id}`,
      headers: auth,
    });
    expect(res.statusCode).toBe(204);
    expect(await handle.items.getById(item.id)).toBeNull();
  });

  it("returns 404 for unknown item", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/collections/${collection.id}/items/00000000-0000-4000-8000-000000000000`,
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/collections/:id/items/:itemId/restore", () => {
  it("restores a soft-deleted item and returns it", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    await handle.items.softDelete(item.id);
    const app = await makeApp();

    const res = await app.inject({
      method: "POST",
      url: `/api/collections/${collection.id}/items/${item.id}/restore`,
      headers: auth,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Item;
    expect(body.id).toBe(item.id);
    expect(body.fields).toEqual({ title: "Dune" });
    expect(body.deletedAt).toBeNull();
    expect(await handle.items.getById(item.id)).not.toBeNull();
  });

  it("returns 404 for an item that is not deleted", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: {} });
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/collections/${collection.id}/items/${item.id}/restore`,
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 and leaves the item deleted when addressed via a different collection", async () => {
    const other = await handle.collections.create({ name: "Movies", fields: baseFields, isFiniteSet: false });
    const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Dune" } });
    await handle.items.softDelete(item.id);
    const app = await makeApp();

    const res = await app.inject({
      method: "POST",
      url: `/api/collections/${other.id}/items/${item.id}/restore`,
      headers: auth,
    });

    expect(res.statusCode).toBe(404);
    expect(await handle.items.getById(item.id)).toBeNull();
  });

  it("returns 404 while the parent collection is itself in the trash", async () => {
    const item = await handle.items.create({ collectionId: collection.id, fields: {} });
    await handle.items.softDelete(item.id);
    await handle.collections.softDelete(collection.id);
    const app = await makeApp();

    const res = await app.inject({
      method: "POST",
      url: `/api/collections/${collection.id}/items/${item.id}/restore`,
      headers: auth,
    });

    expect(res.statusCode).toBe(404);
    expect(await handle.items.getById(item.id, { includeDeleted: true })).not.toBeNull();
  });
});
