/**
 * The API token, which has to survive a browser that will not store anything.
 *
 * Touching `localStorage` can throw before any method runs — cookies blocked
 * outright, a sandboxed frame, partitioned or policy-restricted storage — and
 * every route's `beforeLoad` calls `getToken()`. Unguarded, that took out the
 * whole app rather than just its persistence: the setup screen rendered blank,
 * so there was no way in at all (#279).
 *
 * So the token lives in memory for the session and is persisted when it can be.
 * A denied write costs the reload, never the session — but unlike a preference
 * (see `storage.js`) that is worth saying out loud, because the user is the one
 * who has to paste the token again. `isTokenSessionOnly` is what the UI asks.
 */

const TOKEN_KEY = "api_token";

/**
 * Set only by `setToken`, and never populated from a storage read: several tests
 * and the 401 recovery path change the stored token behind this module's back,
 * and a cached copy would keep serving a token that is no longer the one on
 * disk. Memory is the fallback for a token that could not be written, not a
 * cache of one that could.
 */
let sessionToken: string | null = null;

function readStored(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return sessionToken ?? readStored();
}

export function setToken(token: string): void {
  // Trim once, into both places: a memory copy that differs from the stored one
  // by whitespace would report itself as session-only forever.
  const trimmed = token.trim();
  sessionToken = trimmed;
  try {
    localStorage.setItem(TOKEN_KEY, trimmed);
  } catch {
    // Session-only from here. `isTokenSessionOnly` reports it; nothing is lost
    // that the user cannot re-enter.
  }
}

export function clearToken(): void {
  sessionToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored to remove, or storage is denied. Either way the in-memory
    // token is gone, which is what signing out has to guarantee.
  }
}

/**
 * Whether a reload would lose the token the app is currently using.
 *
 * Deliberately a live comparison rather than a remembered outcome of the last
 * write: storage can be cleared from another tab or evicted by the browser long
 * after the write succeeded. It reports the fact, never a cause — "your token
 * is not saved" is knowable, "you are in a private window" is not.
 */
export function isTokenSessionOnly(): boolean {
  return sessionToken !== null && readStored() !== sessionToken;
}

/**
 * Signing out in one tab has to sign out in all of them. Persisted tokens used
 * to get that for free, because every tab read the same key; a token held in
 * memory would otherwise outlive the Disconnect that removed it. Fires only
 * where storage works — denied storage dispatches no storage events, and there
 * is nothing to stay in sync with there anyway.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== TOKEN_KEY && event.key !== null) return;
    // `key === null` is a whole-storage clear; either way, follow what is there.
    sessionToken = event.key === null ? null : event.newValue;
  });
}
