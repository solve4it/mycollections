import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Integration smoke test for the API↔web seam: the real api-client talking to a
 * real Fastify server over real `fetch`. This is the layer unit tests miss — API
 * tests use `app.inject` (no HTTP) and web tests mock the api-client (no fetch).
 * It guards real HTTP contract bugs like #202 (a JSON Content-Type on a DELETE
 * with no body that the server rejects).
 *
 * The server runs as its own Node subprocess (its real entrypoint), so the test
 * exercises exactly what ships and avoids loading the node-only db package into
 * vite-node. CORS (#200) is NOT covered here — it is browser-enforced and Node's
 * fetch ignores it; the OPTIONS preflight unit test in apps/api covers that.
 */

const TOKEN = "integration-token";

let server: ChildProcess;
let client: typeof import("./api-client.js");

function serverEntrypoint(): string {
  // `pnpm --filter @mycollections/web test` runs with cwd = apps/web; the turbo
  // build (test dependsOn build, web devDepends on @mycollections/api) ensures
  // the compiled server exists.
  for (const candidate of ["../api/dist/server.js", "apps/api/dist/server.js"]) {
    const full = resolve(process.cwd(), candidate);
    if (existsSync(full)) return full;
  }
  throw new Error("apps/api/dist/server.js not found — build @mycollections/api first");
}

function startServer(): Promise<{ proc: ChildProcess; port: number }> {
  const proc = spawn(process.execPath, [serverEntrypoint()], {
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      API_TOKEN: TOKEN,
      DB_PATH: ":memory:",
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolvePort, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not start in time:\n${out}`)), 15000);
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      const match = out.match(/Server listening at https?:\/\/[^:]+:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolvePort({ proc, port: Number(match[1]) });
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}):\n${out}`));
    });
  });
}

beforeAll(async () => {
  const started = await startServer();
  server = started.proc;

  // Point the real api-client at the live server, then import it fresh so its
  // module-level BASE_URL picks up the stubbed env.
  vi.stubEnv("VITE_API_URL", `http://127.0.0.1:${started.port}`);
  vi.resetModules();
  client = await import("./api-client.js");
  localStorage.setItem("api_token", TOKEN);
}, 20000);

afterAll(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  server?.kill();
});

describe("api-client ↔ Fastify (real HTTP)", () => {
  it("round-trips a collection and item through POST/GET/PATCH/DELETE", async () => {
    const collection = await client.createCollection({
      name: "Books",
      fields: [{ id: "title", label: "Title", type: "text", required: true }],
      isFiniteSet: false,
    });
    expect(collection.id).toMatch(/[0-9a-f-]{36}/);

    // GET collections — includes the new one with a real item count of 0.
    const collections = await client.listCollections();
    const listed = collections.find((c) => c.id === collection.id);
    expect(listed?.name).toBe("Books");
    expect(listed?.itemCount).toBe(0);

    // POST item, then GET items.
    const item = await client.createItem(collection.id, { fields: { title: "Dune" } });
    expect(item.fields.title).toBe("Dune");
    expect(await client.listItems(collection.id)).toEqual([item]);

    // PATCH item.
    const updated = await client.updateItem(collection.id, item.id, {
      status: "wanted",
      fields: { title: "Dune Messiah" },
    });
    expect(updated.status).toBe("wanted");
    expect(updated.fields.title).toBe("Dune Messiah");

    // DELETE — the #202 regression guard: a DELETE with no body must not be
    // rejected by the server. It resolves (no throw) and the item is gone.
    await expect(client.deleteItem(collection.id, item.id)).resolves.toBeUndefined();
    expect(await client.listItems(collection.id)).toEqual([]);

    // Undo: restore is a POST with no body, so it hits the same #202 trap as the
    // DELETE above — a JSON Content-Type here would be rejected by the server.
    const restored = await client.restoreItem(collection.id, item.id);
    expect(restored.id).toBe(item.id);
    expect(restored.deletedAt).toBeNull();
    expect(restored.fields.title).toBe("Dune Messiah");
    expect(await client.listItems(collection.id)).toEqual([restored]);
  });

  it("edits a collection's field schema over real HTTP, keeping values under a removed field", async () => {
    const collection = await client.createCollection({
      name: "Vinyl",
      fields: [
        { id: "title", label: "Title", type: "text", required: true },
        { id: "pressing", label: "Pressing", type: "text", required: false },
      ],
      isFiniteSet: false,
    });
    const item = await client.createItem(collection.id, {
      fields: { title: "Kind of Blue", pressing: "1959 mono" },
    });

    // What the editor sends: an existing field relabelled under its own id, a
    // removed field simply absent, and a new field carrying a fresh id.
    const edited = await client.updateCollection(collection.id, {
      name: "Records",
      fields: [
        { id: "title", label: "Album", type: "text", required: true },
        { id: "year", label: "Year", type: "number", required: false },
      ],
    });
    expect(edited.name).toBe("Records");
    expect(edited.fields).toEqual([
      { id: "title", label: "Album", type: "text", required: true },
      { id: "year", label: "Year", type: "number", required: false },
    ]);

    // The value filed under the removed field is still on the item.
    const [stored] = await client.listItems(collection.id);
    expect(stored?.fields).toEqual({ title: "Kind of Blue", pressing: "1959 mono" });

    // The guard the editor's disabled type control mirrors: the server refuses a
    // retype while the collection holds items, and nothing else in the body lands.
    await expect(
      client.updateCollection(collection.id, {
        name: "Should not stick",
        fields: [{ id: "title", label: "Album", type: "number", required: true }],
      }),
    ).rejects.toBeInstanceOf(client.ApiError);
    const unchanged = await client.getCollection(collection.id);
    expect(unchanged.name).toBe("Records");
    expect(unchanged.fields[0]).toEqual({ id: "title", label: "Album", type: "text", required: true });

    await client.deleteItem(collection.id, item.id);
  });

  it("surfaces a 401 as UnauthorizedError when the token is wrong", async () => {
    localStorage.setItem("api_token", "wrong");
    await expect(client.listCollections()).rejects.toBeInstanceOf(client.UnauthorizedError);
    localStorage.setItem("api_token", TOKEN);
  });
});
