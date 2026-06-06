import { describe, expect, it } from "vitest";
import type { TokenSet } from "./secure-token-store.js";
import { InMemoryTokenStore } from "./secure-token-store.js";

const tokens: TokenSet = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  idToken: "id-1",
  expiresAt: 1_000,
};

describe("InMemoryTokenStore", () => {
  it("returns null for an unknown account", async () => {
    const store = new InMemoryTokenStore();
    expect(await store.get("missing")).toBeNull();
  });

  it("round-trips a token set", async () => {
    const store = new InMemoryTokenStore();
    await store.set("google:sub-1", tokens);
    expect(await store.get("google:sub-1")).toEqual(tokens);
  });

  it("isolates accounts by key", async () => {
    const store = new InMemoryTokenStore();
    await store.set("a", tokens);
    await store.set("b", { accessToken: "access-2", expiresAt: 2_000 });
    expect((await store.get("a"))?.accessToken).toBe("access-1");
    expect((await store.get("b"))?.accessToken).toBe("access-2");
  });

  it("overwrites tokens on repeated set", async () => {
    const store = new InMemoryTokenStore();
    await store.set("a", tokens);
    await store.set("a", { accessToken: "access-new", expiresAt: 9_000 });
    expect(await store.get("a")).toEqual({ accessToken: "access-new", expiresAt: 9_000 });
  });

  it("deletes tokens", async () => {
    const store = new InMemoryTokenStore();
    await store.set("a", tokens);
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
  });

  it("delete is idempotent for unknown accounts", async () => {
    const store = new InMemoryTokenStore();
    await expect(store.delete("missing")).resolves.toBeUndefined();
  });

  it("returns an independent copy so callers cannot mutate stored state", async () => {
    const store = new InMemoryTokenStore();
    await store.set("a", tokens);
    const read = await store.get("a");
    // biome-ignore lint/style/noNonNullAssertion: guaranteed present by prior set
    read!.accessToken = "tampered";
    expect((await store.get("a"))?.accessToken).toBe("access-1");
  });
});
