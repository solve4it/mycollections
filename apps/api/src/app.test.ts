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
  { defaultHost = true }: { defaultHost?: boolean } = {},
): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server is not listening on a TCP port");
  }
  try {
    return await new Promise<string>((resolvePromise, reject) => {
      const socket = connect(address.port, "127.0.0.1", () => {
        const base = defaultHost ? { Host: `127.0.0.1:${address.port}`, Connection: "close" } : { Connection: "close" };
        const lines = Object.entries({ ...base, ...headers }).map(([name, value]) => `${name}: ${value}`);
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

  // RFC 7235 §2.1: an auth-scheme name is case-insensitive. The hand-rolled
  // `startsWith("Bearer ")` accepted exactly one spelling.
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

  it.each(["http://127.0.0.1:5173", "http://localhost:4173"])("reflects the dev origin %s", async (origin) => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: true });
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/collections",
      headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
  });

  // The old regex allowed http://localhost on ANY port. With credentials: true that
  // becomes a CSRF hole the moment a cookie session replaces the bearer header, and
  // any local process can bind a high port.
  it.each(["http://localhost:9999", "http://localhost", "https://localhost:5173", "http://evil.example.com"])(
    "does not reflect %s",
    async (origin) => {
      const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: true });
      const res = await app.inject({
        method: "OPTIONS",
        url: "/api/collections",
        headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
      });
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    },
  );

  it("sends no CORS headers outside development", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: false });
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/collections",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "GET" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

// The allowlist used to be a hardcoded constant, so a web dev server on any other port
// was silently blocked and parallel instances were impossible (#327). It is now an
// option — still an exact-match list of loopback origins, still dev-only.
describe("configurable dev origins", () => {
  async function preflight(origin: string, options: { isDev?: boolean; devOrigins?: string[] }) {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, ...options });
    return app.inject({
      method: "OPTIONS",
      url: "/api/collections",
      headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    });
  }

  it("reflects a configured non-default origin", async () => {
    const res = await preflight("http://localhost:5199", { isDev: true, devOrigins: ["http://localhost:5199"] });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5199");
  });

  // The configured list replaces the defaults rather than extending them, so the port
  // that is no longer named must stop being reflected — otherwise this test would pass
  // against an implementation that ignored the option entirely.
  it("stops reflecting a default origin the configured list drops", async () => {
    const res = await preflight("http://localhost:5173", { isDev: true, devOrigins: ["http://localhost:5199"] });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each([
    "http://localhost:5198",
    "http://127.0.0.1:5199",
    "https://localhost:5199",
    "http://localhost:5199.evil.example.com",
    "http://evil.example.com",
  ])("still refuses the unlisted origin %s", async (origin) => {
    const res = await preflight(origin, { isDev: true, devOrigins: ["http://localhost:5199"] });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reflects a configured origin on the request itself, not only the preflight", async () => {
    const app = await buildApp({
      db: handle,
      token: TEST_TOKEN,
      isDev: true,
      devOrigins: ["http://localhost:5199"],
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/collections",
      headers: { Origin: "http://localhost:5199", Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5199");
  });

  it.each(["PATCH", "DELETE"])("permits %s in the preflight for a configured origin", async (method) => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: true, devOrigins: ["http://localhost:5199"] });
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/collections/some-id",
      headers: { Origin: "http://localhost:5199", "Access-Control-Request-Method": method },
    });
    const allowed = (res.headers["access-control-allow-methods"] as string) ?? "";
    expect(allowed.split(",").map((m) => m.trim())).toContain(method);
  });

  // `Vary: Origin` is the canary for the one way this can go wrong silently: a single
  // "*" in the array makes @fastify/cors collapse the whole option to the wildcard
  // string, which reflects everything AND stops varying on Origin. It is only sent
  // while the option is still a list.
  it("varies on Origin with a configured allowlist", async () => {
    const res = await preflight("http://localhost:5199", { isDev: true, devOrigins: ["http://localhost:5199"] });
    expect(String(res.headers.vary)).toContain("Origin");
  });

  // The null origin (a sandboxed iframe, a data: URL) is a real origin value, and a
  // request with no Origin at all is not cross-origin. Neither may be reflected.
  it.each([["null"], [undefined]])("reflects nothing for the origin %s", async (origin) => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: true, devOrigins: ["http://localhost:5199"] });
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/collections",
      headers: {
        ...(origin === undefined ? {} : { Origin: origin }),
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // Host pinning runs in a root onRequest hook registered before CORS, and configuring
  // the allowlist must not reorder that: a DNS-rebinding request carries an allowlisted
  // Origin and an attacker Host, and is refused before CORS is consulted (#242).
  it("still refuses an allowlisted origin arriving with a non-loopback Host", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, isDev: true, devOrigins: ["http://localhost:5199"] });
    const res = await app.inject({
      method: "GET",
      url: "/api/collections",
      headers: {
        Origin: "http://localhost:5199",
        Host: "evil.example.com",
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // `origin: []` is truthy, so @fastify/cors takes it as an allowlist that matches
  // nothing: every call fails with no error anywhere. Refuse to build instead.
  it("refuses to build in development with an empty allowlist", async () => {
    await expect(buildApp({ db: handle, token: TEST_TOKEN, isDev: true, devOrigins: [] })).rejects.toThrow(
      /allowlist is empty/,
    );
  });

  // Production is unchanged by construction: `origin: false` outside development, so
  // even a populated — or a nonsensical — list cannot re-open CORS there.
  it.each([
    ["a configured origin", "http://localhost:5199"],
    ["a default origin", "http://localhost:5173"],
    ["a wildcard", "*"],
  ])("sends no CORS headers outside development with %s in the list", async (_name, origin) => {
    const res = await preflight(origin === "*" ? "http://localhost:5199" : origin, {
      isDev: false,
      devOrigins: ["http://localhost:5199", "http://localhost:5173", "*"],
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // Defense in depth: a programmatic caller cannot smuggle a wildcard, the null origin
  // or a remote host into the allowlist, even in development. The wildcard is the one
  // that matters most — @fastify/cors turns an array containing "*" into the wildcard
  // string, reflecting every origin and dropping Vary: Origin with it.
  it.each(["*", "null", "http://evil.example.com", "http://localhost:5173.evil.example.com", "not-a-url"])(
    "refuses to build in development with the invalid dev origin %s",
    async (origin) => {
      await expect(buildApp({ db: handle, token: TEST_TOKEN, isDev: true, devOrigins: [origin] })).rejects.toThrow(
        /dev origin/i,
      );
    },
  );

  // The option is typed `readonly string[]`, so these can only arrive from untyped
  // JavaScript — where @fastify/cors would honour both as "reflect everything".
  it.each([
    ["a regular expression", /.*/],
    ["true", true],
  ])("refuses to build in development with %s as a dev origin", async (_name, value) => {
    const devOrigins = [value] as unknown as string[];
    await expect(buildApp({ db: handle, token: TEST_TOKEN, isDev: true, devOrigins })).rejects.toThrow(/dev origin/i);
  });
});

// Defense against DNS rebinding: a page on an attacker domain whose name resolves to
// 127.0.0.1 reaches this server as a same-origin request, and CORS never sees it. The
// Host header still carries the attacker's name, so pin it to loopback.
describe("Host pinning", () => {
  async function get(host: string | undefined, overrides = {}) {
    const app = await buildApp({ db: handle, token: TEST_TOKEN, ...overrides });
    return app.inject({
      method: "GET",
      url: "/api/collections",
      headers: { Authorization: `Bearer ${TEST_TOKEN}`, ...(host === undefined ? {} : { Host: host }) },
    });
  }

  it.each(["localhost", "localhost:5173", "127.0.0.1:3001", "127.7.7.7:3001", "[::1]:3001", "[::1]"])(
    "accepts the loopback host %s",
    async (host) => {
      expect((await get(host)).statusCode).toBe(200);
    },
  );

  it.each(["evil.example.com", "evil.example.com:3001", "192.168.1.20:3001", "127.0.0.1.evil.example.com"])(
    "rejects the non-loopback host %s",
    async (host) => {
      const res = await get(host);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: "Forbidden" });
    },
  );

  // Sent raw: light-my-request always supplies a Host header, so inject cannot express
  // this. HTTP/1.0 clients may omit it, and there is then nothing to validate.
  it("rejects a request with no Host header", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN });
    const status = await rawRequest(app, "GET /api/health HTTP/1.0", {}, { defaultHost: false });
    expect(status).toContain("403");
  });

  it("accepts an explicitly configured extra host", async () => {
    expect((await get("mycollections.local:3001", { allowedHosts: ["mycollections.local"] })).statusCode).toBe(200);
  });

  it("still pins loopback when extra hosts are configured", async () => {
    expect((await get("evil.example.com", { allowedHosts: ["mycollections.local"] })).statusCode).toBe(403);
    expect((await get("127.0.0.1:3001", { allowedHosts: ["mycollections.local"] })).statusCode).toBe(200);
  });

  it("can be disabled for a deliberate non-loopback bind", async () => {
    expect((await get("192.168.1.20:3001", { allowedHosts: false })).statusCode).toBe(200);
  });

  // The guard runs before auth, so an unauthenticated probe cannot use it either.
  it("rejects a rebinding request to the public health route", async () => {
    const app = await buildApp({ db: handle, token: TEST_TOKEN });
    const res = await app.inject({ method: "GET", url: "/api/health", headers: { Host: "evil.example.com" } });
    expect(res.statusCode).toBe(403);
  });
});
