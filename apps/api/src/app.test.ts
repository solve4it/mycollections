import { connect } from "node:net";
import type { ErrorReporter } from "@mycollections/core";
import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

const TEST_TOKEN = "test-token-abc123";

let handle: DatabaseHandle;

/**
 * Sends a request over a raw socket so the path reaches Fastify exactly as written.
 * `app.inject` (light-my-request) builds its URL through Node's `URL` parser, which
 * resolves dot segments before the server ever sees them — so an inject test of
 * "/a/../b" asserts nothing about "/a/../b". Returns the status line.
 */
async function rawRequest(
  app: Awaited<ReturnType<typeof buildApp>>,
  requestLine: string,
  headers: Record<string, string> = {},
): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server is not listening on a TCP port");
  }
  try {
    return await new Promise<string>((resolvePromise, reject) => {
      const socket = connect(address.port, "127.0.0.1", () => {
        const lines = Object.entries({ Host: `127.0.0.1:${address.port}`, Connection: "close", ...headers }).map(
          ([name, value]) => `${name}: ${value}`,
        );
        socket.write(`${requestLine}\r\n${lines.join("\r\n")}\r\n\r\n`);
      });
      let response = "";
      socket.setTimeout(5000, () => reject(new Error("raw request timed out")));
      socket.on("data", (chunk) => {
        response += chunk.toString();
      });
      socket.on("error", reject);
      socket.on("close", () => resolvePromise(response.split("\r\n")[0] ?? ""));
    });
  } finally {
    await app.close();
  }
}

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
});

afterEach(() => {
  handle.close();
});

describe("health check", () => {
  it("GET /api/health returns 200 without auth", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  // The guard used to compare the raw url against "/api/health", so any probe
  // carrying a query string ("?probe=1", a cache buster) got a 401 instead.
  it("GET /api/health?probe=1 returns 200 without auth", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN });
    const res = await app.inject({ method: "GET", url: "/api/health?probe=1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("auth guard", () => {
  it("returns 401 when Authorization header is absent", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN });
    const res = await app.inject({ method: "GET", url: "/api/collections" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when bearer token is wrong", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN });
    const res = await app.inject({
      method: "GET",
      url: "/api/collections",
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("allows requests with the correct bearer token", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN });
    const res = await app.inject({
      method: "GET",
      url: "/api/collections",
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // RFC 6750 §2.1: the auth-scheme token is case-insensitive. Hand-rolled
  // `startsWith("Bearer ")` rejected every spelling but one.
  it.each(["bearer", "BEARER", "BeArEr"])("accepts the case-insensitive scheme %s", async (scheme) => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN });
    const res = await app.inject({
      method: "GET",
      url: "/api/collections",
      headers: { Authorization: `${scheme} ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // A comparison that rejects on length before comparing content leaks length, and
  // node's timingSafeEqual throws outright on unequal buffers — a 500, not a 401.
  it.each([
    ["shorter", TEST_TOKEN.slice(0, 4)],
    ["longer", `${TEST_TOKEN}-extra`],
    ["empty", ""],
  ])("returns 401, not 500, for a %s token", async (_name, presented) => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN });
    const res = await app.inject({
      method: "GET",
      url: "/api/collections",
      headers: { Authorization: `Bearer ${presented}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
  });

  it("exempts the Swagger UI from auth in development", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: true });
    const res = await app.inject({ method: "GET", url: "/api/docs/" });
    expect(res.statusCode).toBeLessThan(400);
  });

  // Swagger is only registered in development. The guard used to exempt anything
  // starting with "/api/docs" in every environment; now protection comes from where
  // a route is registered, so there is no prefix to exempt and nothing to serve.
  it("does not serve the docs prefix outside development", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: false });
    for (const url of ["/api/docs", "/api/docs/", "/api/docs/json"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    }
  });

  // The prefix cannot grant an exemption to a real route any more: every collection,
  // item and export route lives inside the authenticated scope regardless of path.
  it.each(["/api/collections", "/api/collections/some-id/items", "/api/export"])(
    "requires auth for the protected route %s",
    async (url) => {
      const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: true });
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    },
  );

  // Sent raw because inject and fetch both normalize dot segments away, which is
  // exactly what hid this: over a real socket find-my-way sees the path as written.
  it.each([
    "/api/docs/../collections",
    // Percent-encoded, which walks straight past a literal ".." check.
    "/api/docs/%2e%2e/collections",
  ])("does not serve %s", async (path) => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: true });
    const status = await rawRequest(app, `GET ${path} HTTP/1.1`);
    expect(status).toContain("404");
  });
});

describe("error handling", () => {
  function makeReporter() {
    return { capture: vi.fn() } satisfies ErrorReporter;
  }

  async function buildAppWithBoomRoute(errorReporter: ErrorReporter) {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, errorReporter });
    app.get("/api/boom", async () => {
      throw new Error("db password is hunter2");
    });
    return app;
  }

  it("returns a generic 500 body that leaks no internal error details", async () => {
    const app = await buildAppWithBoomRoute(makeReporter());
    const res = await app.inject({
      method: "GET",
      url: "/api/boom",
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
    expect(res.body).not.toContain("hunter2");
  });

  it("captures unhandled errors to the ErrorReporter with safe request context", async () => {
    const reporter = makeReporter();
    const app = await buildAppWithBoomRoute(reporter);
    await app.inject({
      method: "GET",
      url: "/api/boom",
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(reporter.capture).toHaveBeenCalledTimes(1);
    const [error, context] = reporter.capture.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("db password is hunter2");
    expect(context).toMatchObject({ method: "GET", route: "/api/boom", statusCode: 500 });
    expect(context).toHaveProperty("reqId");
  });

  it("passes 4xx errors through unchanged and does not report them", async () => {
    const reporter = makeReporter();
    const app = await buildApp({ db: handle, token: TEST_TOKEN, errorReporter: reporter });
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
    // Validation failures keep their message so clients can show what's wrong.
    expect(res.json()).toMatchObject({ statusCode: 400, error: "Bad Request" });
    expect(reporter.capture).not.toHaveBeenCalled();
  });

  it("does not report 404s for unknown routes", async () => {
    const reporter = makeReporter();
    const app = await buildApp({ db: handle, token: TEST_TOKEN, errorReporter: reporter });
    const res = await app.inject({
      method: "GET",
      url: "/api/collections/nope",
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
    expect(reporter.capture).not.toHaveBeenCalled();
  });

  it("works without an ErrorReporter (defaults still return a generic 500)", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN });
    app.get("/api/boom", async () => {
      throw new Error("kaboom");
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/boom",
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("kaboom");
  });
});

describe("CORS preflight (dev)", () => {
  async function preflight(method: string) {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: true });
    return app.inject({
      method: "OPTIONS",
      url: "/api/collections/some-id/items/item-id",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": method,
      },
    });
  }

  // The web app calls every CRUD method; the preflight must allow them all or the
  // browser blocks the request. @fastify/cors defaults to only GET,HEAD,POST.
  it.each(["GET", "POST", "PATCH", "DELETE"])("permits %s in the preflight response", async (method) => {
    const res = await preflight(method);
    expect(res.statusCode).toBeLessThan(400);
    const allowed = (res.headers["access-control-allow-methods"] as string) ?? "";
    expect(allowed.split(",").map((m) => m.trim())).toContain(method);
  });

  it("reflects the allowed dev origin", async () => {
    const res = await preflight("DELETE");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});
