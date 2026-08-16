import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  getThemePreference,
  isThemePreference,
  setThemePreference,
  THEME_COLORS,
  THEME_STORAGE_KEY,
} from "./theme.js";

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

describe("applyTheme and the browser-chrome tint", () => {
  /** jsdom loads no index.html, so stand the two meta tags up exactly as it declares them. */
  function declareMetaTags(): void {
    document.head.innerHTML = "";
    for (const own of ["light", "dark"] as const) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.dataset.themeColor = own;
      meta.media = `(prefers-color-scheme: ${own})`;
      meta.content = THEME_COLORS[own];
      document.head.append(meta);
    }
  }

  const tints = () =>
    [...document.querySelectorAll<HTMLMetaElement>("meta[data-theme-color]")].map((meta) => meta.content);

  beforeEach(declareMetaTags);

  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("starts with one tint per OS preference", () => {
    expect(tints()).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
  });

  it("overrides both meta tags when dark is forced, so the OS preference cannot win", () => {
    applyTheme("dark");
    expect(tints()).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
  });

  it("overrides both meta tags when light is forced", () => {
    applyTheme("light");
    expect(tints()).toEqual([THEME_COLORS.light, THEME_COLORS.light]);
  });

  it("restores each meta to its own color for system", () => {
    applyTheme("dark");
    applyTheme("system");
    expect(tints()).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
  });

  it("does nothing when the meta tags are absent", () => {
    document.head.innerHTML = "";
    expect(() => applyTheme("dark")).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
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
