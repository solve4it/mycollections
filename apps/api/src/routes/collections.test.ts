import type { Collection, FieldDefinition } from "@mycollections/core";
import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const TOKEN = "test-token";
const auth = { Authorization: `Bearer ${TOKEN}` };

const baseFields: FieldDefinition[] = [{ id: "title", type: "text", label: "Title", required: true }];

let handle: DatabaseHandle;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
});

afterEach(() => {
  handle.close();
});

async function makeApp() {
  return buildApp({ db: handle, token: TOKEN });
}

describe("GET /api/collections", () => {
  it("returns an empty array initially", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/collections", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns existing collections", async () => {
    await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: false });
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/collections", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].name).toBe("Books");
  });

  it("includes a non-deleted item count per collection", async () => {
    const books = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: false });
    const empty = await handle.collections.create({ name: "Coins", fields: baseFields, isFiniteSet: false });
    await handle.items.create({ collectionId: books.id, fields: { title: "Dune" } });
    const deleted = await handle.items.create({ collectionId: books.id, fields: { title: "Old" } });
    await handle.items.softDelete(deleted.id);

    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/collections", headers: auth });
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries(res.json().map((c: { id: string; itemCount: number }) => [c.id, c.itemCount]));
    expect(byId[books.id]).toBe(1);
    expect(byId[empty.id]).toBe(0);
  });
});

describe("POST /api/collections", () => {
  it("creates a collection and returns 201", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { name: "Books", fields: baseFields, isFiniteSet: false },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Collection>();
    expect(body.name).toBe("Books");
    expect(body.id).toBeDefined();
    expect(body.deletedAt).toBeNull();
  });

  it("returns 400 for missing required fields", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { name: "Books" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when name is empty string", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { name: "", fields: baseFields, isFiniteSet: false },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/collections/:id", () => {
  it("returns 404 for unknown id", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/collections/00000000-0000-4000-8000-000000000000",
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns the collection by id", async () => {
    const col = await handle.collections.create({ name: "Movies", fields: baseFields, isFiniteSet: true });
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${col.id}`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json<Collection>().id).toBe(col.id);
  });
});

describe("PATCH /api/collections/:id", () => {
  it("updates name and returns the updated collection", async () => {
    const col = await handle.collections.create({ name: "Original", fields: baseFields, isFiniteSet: false });
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Collection>().name).toBe("Renamed");
  });

  it("returns 404 for unknown id", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/collections/00000000-0000-4000-8000-000000000000",
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/collections/:id", () => {
  it("soft-deletes a collection and returns 204", async () => {
    const col = await handle.collections.create({ name: "To Delete", fields: baseFields, isFiniteSet: false });
    const app = await makeApp();
    const res = await app.inject({ method: "DELETE", url: `/api/collections/${col.id}`, headers: auth });
    expect(res.statusCode).toBe(204);
    expect(await handle.collections.getById(col.id)).toBeNull();
  });

  it("returns 404 for unknown id", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/collections/00000000-0000-4000-8000-000000000000",
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/collections/:id/restore", () => {
  it("restores a soft-deleted collection and returns 200", async () => {
    const col = await handle.collections.create({ name: "Deleted", fields: baseFields, isFiniteSet: false });
    await handle.collections.softDelete(col.id);
    const app = await makeApp();
    const res = await app.inject({ method: "POST", url: `/api/collections/${col.id}/restore`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(await handle.collections.getById(col.id)).not.toBeNull();
  });

  it("returns 404 when not deleted", async () => {
    const col = await handle.collections.create({ name: "Live", fields: baseFields, isFiniteSet: false });
    const app = await makeApp();
    const res = await app.inject({ method: "POST", url: `/api/collections/${col.id}/restore`, headers: auth });
    expect(res.statusCode).toBe(404);
  });
});
