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

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Kept in sync with the boot script in index.html — see theme-boot.integration.test.ts. */
export const THEME_STORAGE_KEY = "theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** The stored choice, or "system" when nothing valid is stored. */
export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    // Storage can be denied outright (Safari private browsing, blocked cookies).
    return "system";
  }
}

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

/** Persists the choice and applies it immediately. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // A failed write costs persistence, not the switch — apply it regardless.
  }
  applyTheme(preference);
}
