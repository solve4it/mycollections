import type { ErrorReporter } from "@mycollections/core";
import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

const TEST_TOKEN = "test-token-abc123";

let handle: DatabaseHandle;

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
