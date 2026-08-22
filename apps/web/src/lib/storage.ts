/**
 * localStorage for *preferences*, with the failure mode the DOM actually has:
 * touching `localStorage` can throw a SecurityError before any method runs
 * (cookies blocked outright, a sandboxed frame, partitioned or policy-restricted
 * storage), and a write can throw QuotaExceededError. Unguarded, that took out
 * whatever was reading — the Settings render, and the error reporter
 * mid-report (#276).
 *
 * A denied preference costs persistence, never the session: reads fall back to
 * the caller's default and writes are dropped.
 *
 * The API token is not a preference and does not live here — see `token.js`.
 * Dropping a preference silently is the whole point; dropping a token silently
 * would leave the setup screen asking for it again after every reload with no
 * explanation, so that module keeps the token in memory and says so (#279).
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

/**
 * Whether this browser will store anything at all. It is *access* that throws
 * where storage is denied, so a read is enough to find out — no throwaway write,
 * which would fire a storage event in every other tab for nothing.
 *
 * Distinct from `readSetting`, which cannot answer this: it swallows the throw
 * and returns `null`, making "denied" and "never written" the same answer. The
 * setup screen needs the difference, to warn before a token is pasted that this
 * browser will not remember it (#279).
 */
export function isStorageAvailable(): boolean {
  try {
    localStorage.getItem("__storage_probe");
    return true;
  } catch {
    return false;
  }
}
