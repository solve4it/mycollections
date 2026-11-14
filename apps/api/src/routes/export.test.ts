import { EXPORT_VERSION, type ExportDocument, type FieldDefinition } from "@mycollections/core";
import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const TOKEN = "test-token";
const auth = { Authorization: `Bearer ${TOKEN}` };
const jsonAuth = { ...auth, "Content-Type": "application/json" };

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

async function seed() {
  const collection = await handle.collections.create({ name: "Records", fields: baseFields, isFiniteSet: false });
  const item = await handle.items.create({ collectionId: collection.id, fields: { title: "Kind of Blue" } });
  return { collection, item };
}

describe("GET /api/export", () => {
  it("requires authentication", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/export" });
    expect(res.statusCode).toBe(401);
  });

  it("returns a versioned document with collections and items", async () => {
    const { collection, item } = await seed();
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/export", headers: auth });

    expect(res.statusCode).toBe(200);
    const doc = res.json<ExportDocument>();
    expect(doc.version).toBe(EXPORT_VERSION);
    expect(doc.collections).toEqual([collection]);
    expect(doc.items).toEqual([item]);
  });

  it("sets a download filename", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/export", headers: auth });
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="mycollections-export-\d{4}-\d{2}-\d{2}\.json"/,
    );
  });
});

describe("POST /api/import", () => {
  it("round-trips an exported document into an empty database", async () => {
    const { collection, item } = await seed();
    const sourceApp = await makeApp();
    const exported = (await sourceApp.inject({ method: "GET", url: "/api/export", headers: auth })).json();

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      const app = await buildApp({ db: fresh, token: TOKEN });
      const res = await app.inject({ method: "POST", url: "/api/import", headers: jsonAuth, payload: exported });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        collectionsImported: 1,
        collectionsSkipped: 0,
        itemsImported: 1,
        itemsSkipped: 0,
      });
      expect(await fresh.collections.list()).toEqual([collection]);
      expect(await fresh.items.listByCollection(collection.id)).toEqual([item]);
    } finally {
      fresh.close();
    }
  });

  it("is idempotent across repeated imports", async () => {
    await seed();
    const sourceApp = await makeApp();
    const exported = (await sourceApp.inject({ method: "GET", url: "/api/export", headers: auth })).json();

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      const app = await buildApp({ db: fresh, token: TOKEN });
      await app.inject({ method: "POST", url: "/api/import", headers: jsonAuth, payload: exported });
      const second = await app.inject({ method: "POST", url: "/api/import", headers: jsonAuth, payload: exported });
      expect(second.json()).toEqual({
        collectionsImported: 0,
        collectionsSkipped: 1,
        itemsImported: 0,
        itemsSkipped: 1,
      });
    } finally {
      fresh.close();
    }
  });

  it("rejects an invalid document with 400 and writes nothing", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/import",
      headers: jsonAuth,
      payload: { version: 999, collections: [], items: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(await handle.collections.list()).toEqual([]);
  });

  it("rejects an unknown import mode", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/import?mode=replace",
      headers: jsonAuth,
      payload: { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), collections: [], items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires authentication", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "POST", url: "/api/import", payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe("export and import of a finite set's target (#42)", () => {
  it("round-trips a target through export and import", async () => {
    const quarters = await handle.collections.create({
      name: "Quarters",
      fields: baseFields,
      isFiniteSet: true,
      targetCount: 50,
    });
    const sourceApp = await makeApp();
    const exported = (await sourceApp.inject({ method: "GET", url: "/api/export", headers: auth })).json();
    expect(exported.collections.map((c: { targetCount: unknown }) => c.targetCount)).toEqual([50]);

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      const app = await buildApp({ db: fresh, token: TOKEN });
      const res = await app.inject({ method: "POST", url: "/api/import", headers: jsonAuth, payload: exported });
      expect(res.statusCode).toBe(200);
      expect(await fresh.collections.getById(quarters.id)).toEqual(quarters);
    } finally {
      fresh.close();
    }
  });

  it("rejects the whole file when a collection has a target but is not a finite set", async () => {
    await handle.collections.create({ name: "Quarters", fields: baseFields, isFiniteSet: true, targetCount: 50 });
    const { collection } = await seed();
    const sourceApp = await makeApp();
    const exported = (await sourceApp.inject({ method: "GET", url: "/api/export", headers: auth })).json();
    const bad = exported.collections.find((c: { id: string }) => c.id === collection.id);
    bad.targetCount = 5;

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      const app = await buildApp({ db: fresh, token: TOKEN });
      const res = await app.inject({ method: "POST", url: "/api/import", headers: jsonAuth, payload: exported });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("targetCount requires isFiniteSet");
      expect(await fresh.collections.list({ includeDeleted: true })).toEqual([]);
    } finally {
      fresh.close();
    }
  });
});

describe("export and import of a collection's view (#38)", () => {
  it("round-trips a grid view through export and import", async () => {
    const records = await handle.collections.create({
      name: "Records",
      fields: baseFields,
      isFiniteSet: false,
      itemView: "grid",
    });
    const sourceApp = await makeApp();
    const exported = (await sourceApp.inject({ method: "GET", url: "/api/export", headers: auth })).json();
    expect(exported.collections.map((c: { itemView: unknown }) => c.itemView)).toEqual(["grid"]);

    const fresh = await openDatabase({ path: ":memory:" });
    try {
      const app = await buildApp({ db: fresh, token: TOKEN });
      const res = await app.inject({ method: "POST", url: "/api/import", headers: jsonAuth, payload: exported });
      expect(res.statusCode).toBe(200);
      expect(await fresh.collections.getById(records.id)).toEqual(records);
    } finally {
      fresh.close();
    }
  });
});
