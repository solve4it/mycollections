import { type Collection, type FieldDefinition, ItemCountsSchema } from "@mycollections/core";
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

  it("includes each collection's live owned count beside its item count (#42)", async () => {
    const quarters = await handle.collections.create({
      name: "State quarters",
      fields: baseFields,
      isFiniteSet: true,
      targetCount: 50,
    });
    const records = await handle.collections.create({ name: "Records", fields: baseFields, isFiniteSet: false });
    const empty = await handle.collections.create({ name: "Coins", fields: baseFields, isFiniteSet: true });
    const allTrashed = await handle.collections.create({ name: "Stamps", fields: baseFields, isFiniteSet: false });
    // Quarters: 3 owned, 2 wanted, 1 ordered live; a trashed owned item must not count.
    for (const status of ["owned", "owned", "owned", "wanted", "wanted", "ordered"] as const) {
      await handle.items.create({ collectionId: quarters.id, status, fields: { title: status } });
    }
    const trashedOwned = await handle.items.create({ collectionId: quarters.id, status: "owned", fields: {} });
    await handle.items.softDelete(trashedOwned.id);
    // Records: a different split, so counts leaking between collections would show.
    for (const status of ["owned", "wanted", "wanted", "wanted"] as const) {
      await handle.items.create({ collectionId: records.id, status, fields: { title: status } });
    }
    const gone = await handle.items.create({ collectionId: allTrashed.id, status: "owned", fields: {} });
    await handle.items.softDelete(gone.id);

    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/collections", headers: auth });
    expect(res.statusCode).toBe(200);
    const byId = new Map(res.json().map((c: Collection & { itemCount: number }) => [c.id, c]));
    // The whole entry is pinned: the collection as stored plus exactly these two numbers.
    expect(byId.get(quarters.id)).toEqual({ ...quarters, itemCount: 6, ownedCount: 3 });
    expect(byId.get(records.id)).toEqual({ ...records, itemCount: 4, ownedCount: 1 });
    expect(byId.get(empty.id)).toEqual({ ...empty, itemCount: 0, ownedCount: 0 });
    expect(byId.get(allTrashed.id)).toEqual({ ...allTrashed, itemCount: 0, ownedCount: 0 });
  });
});

describe("GET /api/collections/:id/counts (#42)", () => {
  it("counts a collection's live items per status, ignoring trashed items and other collections", async () => {
    const quarters = await handle.collections.create({
      name: "State quarters",
      fields: baseFields,
      isFiniteSet: true,
      targetCount: 50,
    });
    const records = await handle.collections.create({ name: "Records", fields: baseFields, isFiniteSet: false });
    for (const status of ["owned", "owned", "owned", "wanted", "wanted", "ordered"] as const) {
      await handle.items.create({ collectionId: quarters.id, status, fields: { title: status } });
    }
    for (const status of ["owned", "ordered"] as const) {
      const trashed = await handle.items.create({ collectionId: quarters.id, status, fields: {} });
      await handle.items.softDelete(trashed.id);
    }
    for (const status of ["owned", "wanted", "wanted", "wanted", "ordered"] as const) {
      await handle.items.create({ collectionId: records.id, status, fields: { title: status } });
    }

    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${quarters.id}/counts`, headers: auth });
    expect(res.statusCode).toBe(200);
    // Exactly these four keys — the response shape is pinned.
    expect(res.json()).toEqual({ total: 6, owned: 3, wanted: 2, ordered: 1 });
    expect(ItemCountsSchema.strict().parse(res.json())).toEqual({ total: 6, owned: 3, wanted: 2, ordered: 1 });

    // Not a finite set: counted all the same — progress is the client's call.
    const other = await app.inject({ method: "GET", url: `/api/collections/${records.id}/counts`, headers: auth });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual({ total: 5, owned: 1, wanted: 3, ordered: 1 });
  });

  it("answers zeros for a live collection whose items are all trashed", async () => {
    const col = await handle.collections.create({ name: "Stamps", fields: baseFields, isFiniteSet: true });
    const trashed = await handle.items.create({ collectionId: col.id, status: "owned", fields: {} });
    await handle.items.softDelete(trashed.id);
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${col.id}/counts`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: 0, owned: 0, wanted: 0, ordered: 0 });
  });

  it.each([
    ["an unknown id", "00000000-0000-4000-8000-000000000000"],
    ["an id that is not a uuid", "not-a-collection"],
  ])("answers 404 for %s", async (_label, id) => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${id}/counts`, headers: auth });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("Collection not found");
  });

  it("answers 404 for a trashed collection, though its items are still stored", async () => {
    const col = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: true });
    await handle.items.create({ collectionId: col.id, status: "owned", fields: { title: "Dune" } });
    await handle.collections.softDelete(col.id);
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${col.id}/counts`, headers: auth });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("Collection not found");
  });

  it("requires the bearer token", async () => {
    const col = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: true });
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/collections/${col.id}/counts` });
    expect(res.statusCode).toBe(401);
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

  it("replaces the field schema, leaving values under a removed field on the item", async () => {
    const col = await handle.collections.create({
      name: "Books",
      fields: [
        { id: "title", type: "text", label: "Title", required: true },
        { id: "pages", type: "number", label: "Pages", required: false },
      ],
      isFiniteSet: false,
    });
    const item = await handle.items.create({ collectionId: col.id, fields: { title: "Dune", pages: 412 } });
    const app = await makeApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: {
        fields: [
          { id: "title", type: "text", label: "Name", required: true },
          { id: "year", type: "number", label: "Year", required: false },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<Collection>().fields).toEqual([
      { id: "title", type: "text", label: "Name", required: true },
      { id: "year", type: "number", label: "Year", required: false },
    ]);
    expect((await handle.items.getById(item.id))?.fields).toEqual({ title: "Dune", pages: 412 });
  });

  it("allows changing a field's type while the collection is empty", async () => {
    const col = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: false });
    const app = await makeApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { fields: [{ id: "title", type: "number", label: "Title", required: true }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<Collection>().fields).toEqual([{ id: "title", type: "number", label: "Title", required: true }]);
  });

  it("rejects a type change once the collection holds items, persisting nothing", async () => {
    const col = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: false });
    await handle.items.create({ collectionId: col.id, fields: { title: "Dune" } });
    const app = await makeApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: {
        name: "Renamed",
        fields: [{ id: "title", type: "number", label: "Title", required: true }],
      },
    });

    expect(res.statusCode).toBe(400);
    const unchanged = await handle.collections.getById(col.id);
    expect(unchanged?.fields).toEqual(baseFields);
    expect(unchanged?.name).toBe("Books");
  });

  it("counts trashed items when guarding a type change", async () => {
    const col = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: false });
    const item = await handle.items.create({ collectionId: col.id, fields: { title: "Dune" } });
    await handle.items.softDelete(item.id);
    const app = await makeApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { fields: [{ id: "title", type: "number", label: "Title", required: true }] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("accepts relabelling, reordering, and adding fields on a collection with items", async () => {
    const col = await handle.collections.create({
      name: "Books",
      fields: [
        { id: "title", type: "text", label: "Title", required: true },
        { id: "pages", type: "number", label: "Pages", required: false },
      ],
      isFiniteSet: false,
    });
    await handle.items.create({ collectionId: col.id, fields: { title: "Dune" } });
    const app = await makeApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: {
        fields: [
          { id: "pages", type: "number", label: "Page count", required: false },
          { id: "title", type: "text", label: "Title", required: true },
          { id: "year", type: "number", label: "Year", required: false },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<Collection>().fields.map((f) => f.id)).toEqual(["pages", "title", "year"]);
  });

  it("returns 400 rather than 500 for a malformed field definition", async () => {
    const col = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: false });
    const app = await makeApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { fields: [{ id: "title", type: "unsupported", label: "Title" }] },
    });

    expect(res.statusCode).toBe(400);
    expect((await handle.collections.getById(col.id))?.fields).toEqual(baseFields);
  });

  it("returns 400 for duplicate field ids", async () => {
    const col = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: false });
    const app = await makeApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: {
        fields: [
          { id: "title", type: "text", label: "Title", required: true },
          { id: "title", type: "text", label: "Duplicate", required: false },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an empty fields array", async () => {
    const col = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: false });
    const app = await makeApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: { ...auth, "Content-Type": "application/json" },
      payload: { fields: [] },
    });

    expect(res.statusCode).toBe(400);
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

describe("a finite set's target count (#42)", () => {
  const json = { ...auth, "Content-Type": "application/json" };

  // The body schema leaves targetCount to Zod (`{}`), so Ajv's type coercion never
  // turns "5" into 5 or false into 0 — each of these is a 400, nothing written.
  const rejectedTargets: [string, unknown][] = [
    ["true", true],
    ["false", false],
    ['"5"', "5"],
    ['""', ""],
    ["[5]", [5]],
    ["0", 0],
    ["-1", -1],
    ["2.5", 2.5],
    ["100001", 100_001],
    ["an object", { value: 5 }],
  ];

  it("creates a finite set with a target", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: json,
      payload: { name: "Quarters", fields: baseFields, isFiniteSet: true, targetCount: 50 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Collection>();
    expect(body.targetCount).toBe(50);
    expect((await handle.collections.getById(body.id))?.targetCount).toBe(50);
  });

  it("creates a collection with no target when none is sent", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: json,
      payload: { name: "Quarters", fields: baseFields, isFiniteSet: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<Collection>().targetCount).toBeNull();
  });

  it("accepts an explicit null target", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: json,
      payload: { name: "Books", fields: baseFields, isFiniteSet: false, targetCount: null },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<Collection>().targetCount).toBeNull();
  });

  it("refuses to create a collection that has a target but is not a finite set", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: json,
      payload: { name: "Books", fields: baseFields, isFiniteSet: false, targetCount: 5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("targetCount requires isFiniteSet");
    expect(await handle.collections.list()).toEqual([]);
  });

  it.each(rejectedTargets)("refuses to create with targetCount %s", async (_label, targetCount) => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: json,
      payload: { name: "Quarters", fields: baseFields, isFiniteSet: true, targetCount },
    });
    expect(res.statusCode).toBe(400);
    expect(await handle.collections.list()).toEqual([]);
  });

  it("lists and gets the target", async () => {
    const col = await handle.collections.create({
      name: "Quarters",
      fields: baseFields,
      isFiniteSet: true,
      targetCount: 50,
    });
    const app = await makeApp();
    const list = await app.inject({ method: "GET", url: "/api/collections", headers: auth });
    expect(list.json().map((c: Collection) => c.targetCount)).toEqual([50]);
    const one = await app.inject({ method: "GET", url: `/api/collections/${col.id}`, headers: auth });
    expect(one.json<Collection>().targetCount).toBe(50);
  });

  it("changes the target, and a patch without one keeps it", async () => {
    const col = await handle.collections.create({
      name: "Quarters",
      fields: baseFields,
      isFiniteSet: true,
      targetCount: 50,
    });
    const app = await makeApp();
    const changed = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: json,
      payload: { targetCount: 56 },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json<Collection>().targetCount).toBe(56);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: json,
      payload: { name: "State quarters" },
    });
    expect(renamed.json<Collection>().targetCount).toBe(56);
    expect((await handle.collections.getById(col.id))?.targetCount).toBe(56);
  });

  it("clears the target with null", async () => {
    const col = await handle.collections.create({
      name: "Quarters",
      fields: baseFields,
      isFiniteSet: true,
      targetCount: 50,
    });
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: json,
      payload: { targetCount: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Collection>().targetCount).toBeNull();
    expect((await handle.collections.getById(col.id))?.targetCount).toBeNull();
  });

  it("clears the target when the collection stops being a finite set", async () => {
    const col = await handle.collections.create({
      name: "Quarters",
      fields: baseFields,
      isFiniteSet: true,
      targetCount: 50,
    });
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: json,
      payload: { isFiniteSet: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Collection>()).toMatchObject({ isFiniteSet: false, targetCount: null });
    expect((await handle.collections.getById(col.id))?.targetCount).toBeNull();
  });

  it("refuses a target on a collection that is not a finite set, leaving the row unchanged", async () => {
    const col = await handle.collections.create({ name: "Books", fields: baseFields, isFiniteSet: false });
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: json,
      payload: { name: "Novels", targetCount: 5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("targetCount requires isFiniteSet");
    expect(await handle.collections.getById(col.id)).toEqual(col);
  });

  it("refuses ending a finite set while naming a target, leaving the row unchanged", async () => {
    const col = await handle.collections.create({
      name: "Quarters",
      fields: baseFields,
      isFiniteSet: true,
      targetCount: 50,
    });
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/${col.id}`,
      headers: json,
      payload: { isFiniteSet: false, targetCount: 40 },
    });
    expect(res.statusCode).toBe(400);
    expect(await handle.collections.getById(col.id)).toEqual(col);
  });

  it.each(rejectedTargets)(
    "refuses to patch targetCount %s, leaving the row unchanged",
    async (_label, targetCount) => {
      const col = await handle.collections.create({
        name: "Quarters",
        fields: baseFields,
        isFiniteSet: true,
        targetCount: 50,
      });
      const app = await makeApp();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/collections/${col.id}`,
        headers: json,
        payload: { name: "Renamed", targetCount },
      });
      expect(res.statusCode).toBe(400);
      expect(await handle.collections.getById(col.id)).toEqual(col);
    },
  );

  it("answers 404 for a target on an unknown collection", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/collections/00000000-0000-4000-8000-000000000000",
      headers: json,
      payload: { targetCount: 5 },
    });
    expect(res.statusCode).toBe(404);
  });
});
