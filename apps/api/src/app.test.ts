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
