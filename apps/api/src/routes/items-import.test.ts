import {
  type Collection,
  type FieldDefinition,
  ITEM_IMPORT_MAX_CELL_LENGTH,
  ITEM_IMPORT_MAX_ROWS,
} from "@mycollections/core";
import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const TOKEN = "test-token";
const auth = { Authorization: `Bearer ${TOKEN}` };

const fields: FieldDefinition[] = [
  { id: "title", type: "text", label: "Title", required: true },
  { id: "pages", type: "number", label: "Pages", required: false },
];

let handle: DatabaseHandle;
let collection: Collection;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
  collection = await handle.collections.create({ name: "Books", fields, isFiniteSet: false });
});

afterEach(() => {
  handle.close();
});

async function post(body: unknown, id = collection.id, logs?: string[]) {
  const app = await buildApp({
    db: handle,
    token: TOKEN,
    logger: logs ? { level: "trace", stream: { write: (line: string) => logs.push(line) } } : false,
  });
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return app.inject({
    method: "POST",
    url: `/api/collections/${id}/items/import`,
    headers: { ...auth, "content-type": "application/json" },
    payload,
  });
}

const titles = async () => (await handle.items.listByCollection(collection.id)).map((item) => item.fields.title);

describe("POST /api/collections/:id/items/import (#44)", () => {
  it("adds every row and answers with the count", async () => {
    const res = await post({
      items: [{ fields: { title: "Dune", pages: 412 } }, { status: "wanted", fields: { title: "Emma" } }],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ created: 2 });
    const items = await handle.items.listByCollection(collection.id);
    expect(items.map((item) => [item.status, item.fields])).toEqual([
      ["owned", { title: "Dune", pages: 412 }],
      ["wanted", { title: "Emma", pages: null }],
    ]);
  });

  it("adds nothing for an invalid row and names only its index and a fixed word", async () => {
    const logs: string[] = [];
    const res = await post(
      { items: [{ fields: { title: "Dune" } }, { fields: { title: "Emma", pages: "do-not-echo" } }] },
      collection.id,
      logs,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: "Invalid row",
      row: 1,
      issue: "invalid",
    });
    expect(await titles()).toEqual([]);
    expect(logs.join("\n")).not.toContain("do-not-echo");
    expect(logs.join("\n")).not.toContain("Emma");
  });

  it("refuses a key the collection does not have", async () => {
    const res = await post({ items: [{ fields: { title: "Dune", author: "Herbert" } }] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ message: "Invalid row", row: 0, issue: "unknown-field" });
    expect(res.body).not.toContain("author");
  });

  it("refuses a malformed body with fixed text that quotes none of it", async () => {
    for (const body of [
      {},
      { items: [] },
      { items: [{ fields: { title: "Dune" }, id: "do-not-echo" }] },
      { items: [{ status: "do-not-echo", fields: {} }] },
      { items: [], "do-not-echo": 1 },
    ]) {
      const res = await post(body);
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("Invalid import");
      expect(res.body).not.toContain("do-not-echo");
    }
  });

  it("refuses a __proto__ key before it reaches anything", async () => {
    const res = await post('{"items":[{"fields":{"title":"Dune","__proto__":{"polluted":true}}}]}');
    expect(res.statusCode).toBe(400);
    // Fastify's parser (secure-json-parse) refuses it before the route runs.
    expect(res.json().message).toBe("Body is not valid JSON but content-type is set to 'application/json'");
    expect(await titles()).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("answers 413 past the row cap, and writes nothing", async () => {
    const items = Array.from({ length: ITEM_IMPORT_MAX_ROWS + 1 }, () => ({ fields: { title: "x" } }));
    const res = await post({ items });
    expect(res.statusCode).toBe(413);
    expect(res.json().message).toBe("Import too large");
    expect(await titles()).toEqual([]);
  });

  it("takes a body well past Fastify's default 1 MiB limit", async () => {
    // Few rows of the longest text a cell may hold: past the default limit in bytes
    // without 10,000 rows of work, whose time depends on how busy the machine is
    // (5.6 s against a 5 s timeout on a shared CI runner). The row cap has its own
    // tests: core's schema at exactly the cap, and the 413 one past it here.
    const title = "t".repeat(ITEM_IMPORT_MAX_CELL_LENGTH);
    const items = Array.from({ length: 150 }, () => ({ fields: { title } }));
    const body = JSON.stringify({ items });
    expect(body.length).toBeGreaterThan(1024 * 1024);
    const res = await post(body);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ created: 150 });
  });

  it("answers 404 for a missing or trashed collection without writing", async () => {
    const missing = await post({ items: [{ fields: { title: "Dune" } }] }, "00000000-0000-4000-8000-000000000000");
    expect(missing.statusCode).toBe(404);
    await handle.collections.softDelete(collection.id);
    const trashed = await post({ items: [{ fields: { title: "Dune" } }] });
    expect(trashed.statusCode).toBe(404);
    expect(await handle.items.listByCollection(collection.id, { includeDeleted: true })).toEqual([]);
  });

  it("requires the token", async () => {
    const app = await buildApp({ db: handle, token: TOKEN });
    const res = await app.inject({
      method: "POST",
      url: `/api/collections/${collection.id}/items/import`,
      payload: { items: [{ fields: { title: "Dune" } }] },
    });
    expect(res.statusCode).toBe(401);
    expect(await titles()).toEqual([]);
  });
});
