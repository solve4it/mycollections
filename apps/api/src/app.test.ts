import { type DatabaseHandle, openDatabase } from "@mycollections/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
