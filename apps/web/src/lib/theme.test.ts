import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getThemePreference, isThemePreference, setThemePreference, THEME_STORAGE_KEY } from "./theme.js";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getThemePreference", () => {
  it("defaults to system when nothing is stored", () => {
    expect(getThemePreference()).toBe("system");
  });

  it("returns the stored preference", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(getThemePreference()).toBe("dark");
  });

  it("falls back to system when the stored value is not a preference", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "midnight");
    expect(getThemePreference()).toBe("system");
  });

  it("falls back to system when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(getThemePreference()).toBe("system");
  });
});

describe("applyTheme", () => {
  it("stamps data-theme=dark on the document element", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("stamps data-theme=light on the document element", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("removes data-theme for system so prefers-color-scheme decides", () => {
    applyTheme("dark");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("setThemePreference", () => {
  it("persists the choice", () => {
    setThemePreference("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(getThemePreference()).toBe("light");
  });

  it("applies the choice to the document immediately", () => {
    setThemePreference("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("clears the stored value for system rather than storing a sentinel", () => {
    setThemePreference("dark");
    setThemePreference("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("still applies the theme when storage rejects the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => setThemePreference("dark")).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("isThemePreference", () => {
  it.each(["light", "dark", "system"])("accepts %s", (value) => {
    expect(isThemePreference(value)).toBe(true);
  });

  it.each(["", "Dark", "auto", null])("rejects %s", (value) => {
    expect(isThemePreference(value)).toBe(false);
  });
});
