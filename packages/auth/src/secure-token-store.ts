/**
 * A set of OIDC tokens for a single account.
 *
 * These are secrets. They must only ever be persisted through a
 * {@link SecureTokenStore} backend (OS keychain on desktop) and never written
 * to SQLite, logs, or error-reporter context.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Access-token expiry, epoch milliseconds. */
  expiresAt: number;
}

/**
 * Platform-abstracted secure storage for {@link TokenSet}s, keyed by an opaque
 * account key (e.g. `${providerId}:${sub}`).
 *
 * Implementations:
 * - {@link InMemoryTokenStore} — tests and ephemeral fallback (this package).
 * - `KeyringTokenStore` — OS keychain backend (follow-up; lazily imports the
 *   native module so importing this package never loads a `.node` binary).
 * - A cookie/BFF-backed store for the web target (follow-up).
 */
export interface SecureTokenStore {
  /** Returns the stored tokens for an account, or null if none are stored. */
  get(accountKey: string): Promise<TokenSet | null>;
  /** Stores (replacing any existing) the tokens for an account. */
  set(accountKey: string, tokens: TokenSet): Promise<void>;
  /** Removes any stored tokens for an account. Idempotent. */
  delete(accountKey: string): Promise<void>;
}

/**
 * In-memory {@link SecureTokenStore}. Holds tokens only for the lifetime of the
 * process; intended for tests and as a non-persistent fallback. Stored values
 * are copied on read and write so callers cannot mutate internal state.
 */
export class InMemoryTokenStore implements SecureTokenStore {
  readonly #tokens = new Map<string, TokenSet>();

  async get(accountKey: string): Promise<TokenSet | null> {
    const stored = this.#tokens.get(accountKey);
    return stored ? { ...stored } : null;
  }

  async set(accountKey: string, tokens: TokenSet): Promise<void> {
    this.#tokens.set(accountKey, { ...tokens });
  }

  async delete(accountKey: string): Promise<void> {
    this.#tokens.delete(accountKey);
  }
}
