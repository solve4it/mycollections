import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSetting, removeSetting, writeSetting } from "./storage.js";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readSetting", () => {
  it("returns the stored value", () => {
    localStorage.setItem("greeting", "hello");
    expect(readSetting("greeting")).toBe("hello");
  });

  it("returns null for a key that was never written", () => {
    expect(readSetting("greeting")).toBeNull();
  });

  it("returns null instead of throwing when storage is denied", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readSetting("greeting")).toBeNull();
  });
});

describe("writeSetting", () => {
  it("stores the value", () => {
    writeSetting("greeting", "hello");
    expect(localStorage.getItem("greeting")).toBe("hello");
  });

  it("swallows a rejected write so the caller keeps working", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => writeSetting("greeting", "hello")).not.toThrow();
  });
});

describe("removeSetting", () => {
  it("drops the value", () => {
    localStorage.setItem("greeting", "hello");
    removeSetting("greeting");
    expect(localStorage.getItem("greeting")).toBeNull();
  });

  it("swallows a rejected removal", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => removeSetting("greeting")).not.toThrow();
  });
});
