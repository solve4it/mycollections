import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, PairingRejectedError, pair } from "./api-client.js";
import { pairingCodeFrom } from "./pairing.js";

const CODE = "correct-horse-battery-staple-fixture-tokens";

describe("pairingCodeFrom (#241)", () => {
  it.each([
    ["a router hash", `pair=${CODE}`],
    ["a location hash", `#pair=${CODE}`],
    ["the whole link the API printed", `http://localhost:5173/setup#pair=${CODE}`],
    ["the link with stray whitespace from a terminal copy", `  http://localhost:5173/setup#pair=${CODE}\n`],
  ])("finds the code in %s", (_label, text) => {
    expect(pairingCodeFrom(text)).toBe(CODE);
  });

  it.each([
    ["an empty string", ""],
    ["a pasted token", "6f1c0e0e-2b8f-4a54-9d0e-1c9b3f1a2d4e"],
    ["a code of the wrong length", `pair=${CODE.slice(1)}`],
    ["a code in the query string, which would have reached a server log", `http://localhost:5173/setup?pair=${CODE}`],
    ["a longer run that merely contains a code", `#pair=${CODE}x`],
  ])("finds nothing in %s", (_label, text) => {
    expect(pairingCodeFrom(text)).toBeNull();
  });
});

describe("pair", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stub(status: number, body: unknown) {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts the code as JSON with no bearer header, and returns the token", async () => {
    localStorage.setItem("api_token", "stale-token");
    const fetchMock = stub(200, { token: "device-token" });
    await expect(pair(CODE)).resolves.toBe("device-token");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/api\/pair$/);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ code: CODE }));
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    // A stale token must not ride along: this request is how a browser without a
    // working one gets in.
    expect(headers.get("authorization")).toBeNull();
    localStorage.clear();
  });

  it("throws PairingRejectedError on a 401 — not UnauthorizedError, which would send the app to /setup", async () => {
    stub(401, { error: "Unauthorized" });
    const error = await pair(CODE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PairingRejectedError);
    expect(error).not.toHaveProperty("name", "UnauthorizedError");
  });

  it("throws ApiError for any other failure", async () => {
    stub(404, {});
    const error = await pair(CODE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(PairingRejectedError);
  });

  it("refuses a success without a usable token rather than store nothing", async () => {
    stub(200, { token: "" });
    await expect(pair(CODE)).rejects.toBeInstanceOf(ApiError);
  });
});
