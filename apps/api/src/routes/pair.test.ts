import { Writable } from "node:stream";
import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { buildLoggerOptions } from "../logger.js";
import { PairingCodes } from "../pairing.js";

const TOKEN = "device-token-for-pairing-tests";

let handle: DatabaseHandle;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
});

afterEach(() => {
  handle.close();
});

async function appWithPairing(onPaired = vi.fn()) {
  const codes = new PairingCodes();
  const code = codes.mint();
  const app = await buildApp({ db: handle, token: TOKEN, pairing: { codes, onPaired } });
  return { app, code, codes, onPaired };
}

function pair(app: Awaited<ReturnType<typeof buildApp>>, payload: unknown, contentType = "application/json") {
  return app.inject({
    method: "POST",
    url: "/api/pair",
    headers: { "content-type": contentType },
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

describe("POST /api/pair (#241)", () => {
  it("trades the current code for the device token, with no bearer header", async () => {
    const { app, code } = await appWithPairing();
    const res = await pair(app, { code });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: TOKEN });
    // A token in a cached response would outlive the pairing.
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("hands back a token that the authenticated routes accept", async () => {
    const { app, code } = await appWithPairing();
    const { token } = (await pair(app, { code })).json() as { token: string };
    const res = await app.inject({
      method: "GET",
      url: "/api/collections",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("refuses a replayed code with the same body as any other failure", async () => {
    const { app, code } = await appWithPairing();
    expect((await pair(app, { code })).statusCode).toBe(200);
    const replay = await pair(app, { code });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ error: "Unauthorized" });
  });

  it("refuses a wrong code with that same body, and leaves the real one usable", async () => {
    const { app, code } = await appWithPairing();
    const wrong = await pair(app, { code: "w".repeat(43) });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: "Unauthorized" });
    expect((await pair(app, { code })).statusCode).toBe(200);
  });

  it("tells the server a browser paired, so it can offer a fresh link for the next one", async () => {
    const { app, code, onPaired } = await appWithPairing();
    await pair(app, { code: "w".repeat(43) });
    expect(onPaired).not.toHaveBeenCalled();
    await pair(app, { code });
    expect(onPaired).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no code", {}],
    ["a short code", { code: "abc" }],
    ["a code outside the alphabet", { code: `${"a".repeat(42)}!` }],
    ["a number", { code: 42 }],
  ])("rejects %s as a bad request, before comparing anything", async (_label, body) => {
    const { app } = await appWithPairing();
    expect((await pair(app, body)).statusCode).toBe(400);
  });

  it("ignores an extra property, as every route does (Fastify strips it), so it cannot stand in for the code", async () => {
    const { app } = await appWithPairing();
    const res = await pair(app, { code: "w".repeat(43), token: TOKEN });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects a text/plain body, the only kind a page on another origin can send without a preflight", async () => {
    const { app, code } = await appWithPairing();
    const res = await pair(app, JSON.stringify({ code }), "text/plain");
    expect(res.statusCode).toBe(400);
  });

  it("is not registered at all without pairing, which is how production and non-loopback binds run", async () => {
    const app = await buildApp({ db: handle, token: TOKEN });
    expect((await pair(app, { code: "a".repeat(43) })).statusCode).toBe(404);
  });

  it("keeps the code and the token out of the log", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const codes = new PairingCodes();
    const code = codes.mint();
    const app = await buildApp({
      db: handle,
      token: TOKEN,
      pairing: { codes, onPaired: () => {} },
      logger: { ...buildLoggerOptions(), stream },
    });
    await pair(app, { code: "w".repeat(43) });
    await pair(app, { code });
    await app.close();
    const log = lines.join("");
    expect(lines.length).toBeGreaterThan(0);
    expect(log).not.toContain(code);
    expect(log).not.toContain(TOKEN);
  });
});
