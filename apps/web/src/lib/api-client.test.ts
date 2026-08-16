import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createItem,
  deleteItem,
  emptyTrash,
  listCollections,
  listTrash,
  purgeCollection,
  purgeItem,
  restoreCollection,
  restoreItem,
} from "./api-client.js";

function mockFetch(status = 200, body: unknown = []) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function initOf(fetchMock: ReturnType<typeof mockFetch>): RequestInit {
  return (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
}

function headerOf(fetchMock: ReturnType<typeof mockFetch>, name: string): string | null {
  return new Headers(initOf(fetchMock).headers).get(name);
}

beforeEach(() => {
  localStorage.setItem("api_token", "tok");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("api-client request headers", () => {
  it("does not send a JSON Content-Type on a DELETE with no body", async () => {
    const fetchMock = mockFetch(204);
    await deleteItem("c1", "i1");
    const init = initOf(fetchMock);
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
    expect(headerOf(fetchMock, "Content-Type")).toBeNull();
  });

  it("does not send a JSON Content-Type on a GET with no body", async () => {
    const fetchMock = mockFetch(200, []);
    await listCollections();
    expect(headerOf(fetchMock, "Content-Type")).toBeNull();
  });

  it("sends a JSON Content-Type when the request has a body", async () => {
    const fetchMock = mockFetch(201, { id: "x" });
    await createItem("c1", { fields: { title: "Dune" } });
    expect(headerOf(fetchMock, "Content-Type")).toBe("application/json");
    expect(initOf(fetchMock).body).toBeTypeOf("string");
  });

  it("does not send a JSON Content-Type on a restore POST, which has no body", async () => {
    // Same trap as #202, on a POST: a Content-Type with no body makes the server
    // answer 400 "Body cannot be empty".
    const fetchMock = mockFetch(200, { id: "i1", deletedAt: null });
    await restoreItem("c1", "i1");
    const init = initOf(fetchMock);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(headerOf(fetchMock, "Content-Type")).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/collections/c1/items/i1/restore");
  });

  it("always sends the Authorization header when a token is stored", async () => {
    const fetchMock = mockFetch(204);
    await deleteItem("c1", "i1");
    expect(headerOf(fetchMock, "Authorization")).toBe("Bearer tok");
  });
});

describe("api-client trash", () => {
  it("reads the trash as two lists", async () => {
    const trash = {
      collections: [{ id: "c1", name: "Records" }],
      items: [{ id: "i1", collectionId: "c1", collectionName: "Records" }],
    };
    const fetchMock = mockFetch(200, trash);
    await expect(listTrash()).resolves.toEqual(trash);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/trash");
    expect(initOf(fetchMock).method).toBeUndefined();
  });

  it("restores a collection through its own restore route, with no body", async () => {
    const fetchMock = mockFetch(200, { id: "c1", name: "Records", deletedAt: null });
    await expect(restoreCollection("c1")).resolves.toEqual({ id: "c1", name: "Records", deletedAt: null });
    const init = initOf(fetchMock);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/collections/c1/restore");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(headerOf(fetchMock, "Content-Type")).toBeNull();
  });

  it("purges an item through the trash route, not the ordinary item DELETE", async () => {
    const fetchMock = mockFetch(204);
    await purgeItem("i1");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/trash/items/i1");
    expect(initOf(fetchMock).method).toBe("DELETE");
  });

  it("purges a collection through the trash route", async () => {
    const fetchMock = mockFetch(204);
    await purgeCollection("c1");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/trash/collections/c1");
    expect(initOf(fetchMock).method).toBe("DELETE");
  });

  it("empties the trash and returns what was removed", async () => {
    const fetchMock = mockFetch(200, { items: 4, collections: 2 });
    await expect(emptyTrash()).resolves.toEqual({ items: 4, collections: 2 });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/trash");
    expect(initOf(fetchMock).method).toBe("DELETE");
  });

  it("reports a failed purge rather than resolving quietly", async () => {
    mockFetch(404);
    await expect(purgeItem("gone")).rejects.toBeInstanceOf(ApiError);
  });
});
