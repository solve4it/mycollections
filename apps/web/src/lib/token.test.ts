import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearToken, getToken, isTokenSessionOnly, setToken } from "./token.js";

/**
 * The API token, where storage is denied — Safari private
 * browsing, blocked cookies, partitioned storage. Touching `localStorage` throws
 * there, and every route's `beforeLoad` calls `getToken()`, so an unguarded read
 * takes out the whole app rather than just its persistence (#279).
 */

function denyStorage(...methods: ("getItem" | "setItem" | "removeItem")[]): void {
  for (const method of methods) {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  clearToken();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  clearToken();
});

describe("getToken", () => {
  it("returns the persisted token", () => {
    localStorage.setItem("api_token", "stored-token");
    expect(getToken()).toBe("stored-token");
  });

  it("returns null rather than throwing when storage is denied", () => {
    denyStorage("getItem");
    expect(getToken()).toBeNull();
  });
});

describe("setToken", () => {
  it("persists the trimmed token", () => {
    setToken("  spaced-token  ");
    expect(localStorage.getItem("api_token")).toBe("spaced-token");
    expect(getToken()).toBe("spaced-token");
  });

  it("keeps the token usable for the session when it cannot be persisted", () => {
    denyStorage("getItem", "setItem");
    expect(() => setToken("session-token")).not.toThrow();
    expect(getToken()).toBe("session-token");
  });
});

describe("clearToken", () => {
  it("drops a persisted token", () => {
    setToken("stored-token");
    clearToken();
    expect(getToken()).toBeNull();
    expect(localStorage.getItem("api_token")).toBeNull();
  });

  it("drops a session-only token, so a 401 still signs the user out", () => {
    denyStorage("getItem", "setItem", "removeItem");
    setToken("session-token");
    expect(() => clearToken()).not.toThrow();
    expect(getToken()).toBeNull();
  });
});

describe("isTokenSessionOnly", () => {
  it("is false with no token at all", () => {
    expect(isTokenSessionOnly()).toBe(false);
  });

  it("is false when the token was persisted", () => {
    setToken("stored-token");
    expect(isTokenSessionOnly()).toBe(false);
  });

  it("is true when the token is held only in memory", () => {
    denyStorage("getItem", "setItem");
    setToken("session-token");
    expect(isTokenSessionOnly()).toBe(true);
  });

  it("is false again once the token is cleared", () => {
    denyStorage("getItem", "setItem");
    setToken("session-token");
    clearToken();
    expect(isTokenSessionOnly()).toBe(false);
  });
});

describe("another tab", () => {
  /**
   * A storage event fires *because* storage already changed, so the simulation
   * has to change it too — otherwise the fallback read finds the old value and
   * the test proves nothing.
   */
  function dispatchStorage(key: string | null, newValue: string | null): void {
    if (key === null) localStorage.clear();
    else if (newValue === null) localStorage.removeItem(key);
    else localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  }

  it("signs this tab out when another one disconnects", () => {
    setToken("shared-token");
    dispatchStorage("api_token", null);
    expect(getToken()).toBeNull();
  });

  it("adopts a token another tab connected with", () => {
    setToken("old-token");
    dispatchStorage("api_token", "new-token");
    expect(getToken()).toBe("new-token");
  });

  it("signs this tab out when another one clears all storage", () => {
    setToken("shared-token");
    dispatchStorage(null, null);
    expect(getToken()).toBeNull();
  });

  it("ignores an unrelated key", () => {
    setToken("shared-token");
    dispatchStorage("i18nextLng", "fr");
    expect(getToken()).toBe("shared-token");
  });
});
