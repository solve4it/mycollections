/**
 * Theme preference (#25). The palettes themselves live in global.css: light is
 * the `:root` default, dark ships via `prefers-color-scheme`, and
 * `:root[data-theme="dark"|"light"]` overrides both directions. This module only
 * decides which of those wins, by stamping (or clearing) the attribute.
 *
 * "system" removes the attribute rather than resolving the OS preference here,
 * so the media query stays in charge and the app follows an OS switch live
 * without a `matchMedia` listener.
 */

import { readSetting, removeSetting, writeSetting } from "./storage.js";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Kept in sync with the boot script in index.html — see theme-boot.integration.test.ts. */
export const THEME_STORAGE_KEY = "theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** The stored choice, or "system" when nothing valid is stored (or storage is denied). */
export function getThemePreference(): ThemePreference {
  const stored = readSetting(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : "system";
}

/**
 * Browser-chrome tint per theme — `--paper`, the color the page itself paints.
 * Duplicated from global.css because a `<meta>` takes a literal; the copies are
 * held together by theme-boot.integration.test.ts.
 */
export const THEME_COLORS = { light: "#f1f2ee", dark: "#141816" } as const;

/**
 * index.html declares one theme-color meta per `prefers-color-scheme`, and a UA
 * uses the FIRST one whose media matches — so an extra media-less meta would
 * never be reached. An explicit choice is applied by overwriting both meta tags
 * with the chosen color, and "system" restores each to its own.
 */
function applyThemeColor(preference: ThemePreference): void {
  for (const meta of document.querySelectorAll<HTMLMetaElement>("meta[data-theme-color]")) {
    const own = meta.dataset.themeColor;
    if (own !== "light" && own !== "dark") continue;
    meta.content = THEME_COLORS[preference === "system" ? own : preference];
  }
}

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
  applyThemeColor(preference);
}

/** Persists the choice and applies it immediately — a failed write costs persistence, not the switch. */
export function setThemePreference(preference: ThemePreference): void {
  if (preference === "system") {
    removeSetting(THEME_STORAGE_KEY);
  } else {
    writeSetting(THEME_STORAGE_KEY, preference);
  }
  applyTheme(preference);
}
