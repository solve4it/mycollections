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

describe("GET /api/collections/:id/items — search and sort (#41)", () => {
  const fields: FieldDefinition[] = [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "pages", type: "number", label: "Pages", required: false },
    { id: "tags", type: "tags", label: "Tags", required: false },
  ];
  let books: Collection;

  beforeEach(async () => {
    books = await handle.collections.create({ name: "Library", fields, isFiniteSet: false });
    await handle.items.create({ collectionId: books.id, fields: { title: "Dune", pages: 412, tags: ["desert"] } });
    await handle.items.create({ collectionId: books.id, fields: { title: "Emma", pages: 300 } });
    await handle.items.create({
      collectionId: books.id,
      status: "wanted",
      fields: { title: "Dune Messiah", pages: 256 },
    });
  });

  async function list(query: string) {
    const app = await makeApp();
    return app.inject({ method: "GET", url: `/api/collections/${books.id}/items?${query}`, headers: auth });
  }

  const titlesOf = (res: { json: <T>() => T }) => res.json<Item[]>().map((item) => item.fields.title);

  it("returns only the items matching q", async () => {
    const res = await list("q=dun");
    expect(res.statusCode).toBe(200);
    expect(titlesOf(res)).toEqual(["Dune", "Dune Messiah"]);
  });

  it("combines q with the status filter", async () => {
    expect(titlesOf(await list("q=dune&status=wanted"))).toEqual(["Dune Messiah"]);
  });

  it("sorts by a field, descending with a '-' prefix", async () => {
    expect(titlesOf(await list("sort=-field:pages"))).toEqual(["Dune", "Emma", "Dune Messiah"]);
    expect(titlesOf(await list("sort=name"))).toEqual(["Dune", "Dune Messiah", "Emma"]);
  });

  it("treats hostile search text as words, not a server error", async () => {
    const res = await list(`q=${encodeURIComponent('"NEAR( title:\u0000 ^*')}`);
    expect(res.statusCode).toBe(200);
  });

  it("rejects q longer than 200 characters", async () => {
    expect((await list(`q=${"a".repeat(200)}`)).statusCode).toBe(200);
    expect((await list(`q=${"a".repeat(201)}`)).statusCode).toBe(400);
  });

  it("rejects a repeated q rather than picking one", async () => {
    expect((await list("q=dune&q=emma")).statusCode).toBe(400);
  });

  it.each([
    ["sort=title", "a sort key that is not one"],
    ["sort=field:missing", "an unknown field"],
    ["sort=field:tags", "an unsortable field type"],
  ])("rejects %s (%s) with a 400 that does not echo the query", async (query) => {
    const res = await list(query);
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("missing");
    expect(res.body).not.toContain("field:");
  });
});

describe("GET /api/collections/:id/items — filters (#41)", () => {
  const fields: FieldDefinition[] = [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "year", type: "number", label: "Year", required: false },
    { id: "tags", type: "tags", label: "Tags", required: false },
  ];
  let records: Collection;

  beforeEach(async () => {
    records = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
    await handle.items.create({
      collectionId: records.id,
      fields: { title: "Kind of Blue", year: 1959, tags: ["signed"] },
    });
    await handle.items.create({
      collectionId: records.id,
      fields: { title: "Blue Train", year: 1958, tags: ["mono"] },
    });
  });

  async function list(filter: unknown, extra = "") {
    const app = await makeApp();
    const raw = typeof filter === "string" ? filter : JSON.stringify(filter);
    return app.inject({
      method: "GET",
      url: `/api/collections/${records.id}/items?filter=${encodeURIComponent(raw)}${extra}`,
      headers: auth,
    });
  }

  it("applies the filters", async () => {
    const res = await list([{ field: "year", op: "gte", value: 1959 }]);
    expect(res.statusCode).toBe(200);
    expect(res.json<Item[]>().map((item) => item.fields.title)).toEqual(["Kind of Blue"]);
    const tagged = await list([{ field: "tags", op: "in", value: ["MONO"] }], "&q=blue");
    expect(tagged.json<Item[]>().map((item) => item.fields.title)).toEqual(["Blue Train"]);
  });

  it.each([
    ["not JSON", "[{"],
    ["the wrong shape", [{ field: "year", op: "between", value: [1, 2] }]],
    ["an extra key", [{ field: "year", op: "empty", leak: "do-not-report" }]],
    ["an unknown field", [{ field: "do-not-report", op: "empty" }]],
    ["an op the field cannot take", [{ field: "title", op: "empty" }]],
    ["more than the raw cap", "x".repeat(2049)],
  ])("rejects %s with a 400 that echoes nothing", async (_why, filter) => {
    const res = await list(filter);
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("do-not-report");
    expect(res.body).not.toContain("leak");
  });

  it("rejects a repeated filter param rather than picking one", async () => {
    const raw = encodeURIComponent(JSON.stringify([{ field: "year", op: "empty" }]));
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/collections/${records.id}/items?filter=${raw}&filter=${raw}`,
      headers: auth,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/collections/:id/tag-values (#41)", () => {
  const fields: FieldDefinition[] = [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "tags", type: "tags", label: "Tags", required: false },
  ];

  it("lists the tags in use with their counts", async () => {
    const records = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
    await handle.items.create({ collectionId: records.id, fields: { title: "a", tags: ["signed", "mono"] } });
    await handle.items.create({ collectionId: records.id, fields: { title: "b", tags: ["Signed"] } });
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/collections/${records.id}/tag-values?field=tags`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      values: [
        { value: "Signed", count: 2 },
        { value: "mono", count: 1 },
      ],
      truncated: false,
    });
  });

  it("answers 400 for a field that is not a tags field, and 404 for a trashed collection", async () => {
    const records = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
    const app = await makeApp();
    const bad = await app.inject({
      method: "GET",
      url: `/api/collections/${records.id}/tag-values?field=title`,
      headers: auth,
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: "GET",
      url: `/api/collections/${records.id}/tag-values`,
      headers: auth,
    });
    expect(missing.statusCode).toBe(400);
    await handle.collections.softDelete(records.id);
    const gone = await app.inject({
      method: "GET",
      url: `/api/collections/${records.id}/tag-values?field=tags`,
      headers: auth,
    });
    expect(gone.statusCode).toBe(404);
  });
});

describe("tag management routes (#41)", () => {
  const fields: FieldDefinition[] = [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "tags", type: "tags", label: "Tags", required: false },
  ];

  async function post(collectionId: string, action: string, body: unknown) {
    const app = await makeApp();
    return app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/tags/${action}`,
      headers: { ...auth, "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
  }

  it("renames a tag and says how many items changed", async () => {
    const records = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
    const item = await handle.items.create({ collectionId: records.id, fields: { title: "a", tags: ["signed"] } });
    const res = await post(records.id, "rename", { field: "tags", from: "Signed", to: "autographed" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 1 });
    expect((await handle.items.getById(item.id))?.fields.tags).toEqual(["autographed"]);
  });

  it("removes a tag", async () => {
    const records = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
    const item = await handle.items.create({
      collectionId: records.id,
      fields: { title: "a", tags: ["signed", "mono"] },
    });
    const res = await post(records.id, "remove", { field: "tags", value: "signed" });
    expect(res.json()).toEqual({ updated: 1 });
    expect((await handle.items.getById(item.id))?.fields.tags).toEqual(["mono"]);
  });

  it.each([
    ["rename", { field: "title", from: "a", to: "b" }, 400],
    ["rename", { field: "tags", from: "a", to: "rock, pop" }, 400],
    ["rename", { field: "tags", from: "a" }, 400],
    // Fastify's Ajv strips an unknown key (removeAdditional) rather than failing
    // the request — so it has no effect, and is never quoted back.
    ["rename", { field: "tags", from: "a", to: "b", extra: "do-not-report" }, 200],
    ["remove", { field: "tags", value: "" }, 400],
    ["remove", { field: "tags", value: "x".repeat(201) }, 400],
  ])("%s with %j answers %i, quoting nothing", async (action, body, status) => {
    const records = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
    const res = await post(records.id, action, body);
    expect(res.statusCode).toBe(status);
    expect(res.body).not.toContain("do-not-report");
    expect(res.body).not.toContain("rock");
  });

  it("answers 404 for a trashed collection and changes nothing", async () => {
    const records = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
    const item = await handle.items.create({ collectionId: records.id, fields: { title: "a", tags: ["signed"] } });
    await handle.collections.softDelete(records.id);
    const res = await post(records.id, "remove", { field: "tags", value: "signed" });
    expect(res.statusCode).toBe(404);
    expect((await handle.items.getById(item.id, { includeDeleted: true }))?.fields.tags).toEqual(["signed"]);
  });

  it("finds tags by part of their name through tag-values", async () => {
    const records = await handle.collections.create({ name: "Records", fields, isFiniteSet: false });
    await handle.items.create({ collectionId: records.id, fields: { title: "a", tags: ["rare find", "common"] } });
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/collections/${records.id}/tag-values?field=tags&q=rare`,
      headers: auth,
    });
    expect(res.json()).toEqual({ values: [{ value: "rare find", count: 1 }], truncated: false });
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
