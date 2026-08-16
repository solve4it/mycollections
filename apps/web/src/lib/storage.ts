/**
 * localStorage for *preferences*, with the failure mode the DOM actually has:
 * touching `localStorage` can throw a SecurityError before any method runs
 * (Safari private browsing, blocked cookies, partitioned storage), and a write
 * can throw QuotaExceededError. Unguarded, that took out whatever was reading —
 * the Settings render, and the error reporter mid-report (#276).
 *
 * A denied preference costs persistence, never the session: reads fall back to
 * the caller's default and writes are dropped.
 *
 * Deliberately NOT for the API token. A token that silently fails to persist
 * leaves the setup screen asking for it again after every reload, which needs a
 * UX answer rather than a swallowed exception (#279).
 */

export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Denied or full — the in-session choice still stands.
  }
}

export function removeSetting(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same: nothing to recover, and nothing worth crashing for.
  }
}
