export interface AuthUser {
  /** Stable identity key. For OIDC providers this is the `sub` claim, not email. */
  id: string;
  email: string;
  displayName?: string;
}

/**
 * Non-secret session metadata returned by an {@link AuthProvider}.
 *
 * Tokens are deliberately absent from this surface: access and refresh tokens
 * live only in a secure store (OS keychain on desktop, never in SQLite) and are
 * vended on demand through {@link AuthProvider.getAccessToken}.
 */
export interface Session {
  user: AuthUser;
  /** Key under which this account's tokens are stored, e.g. `${providerId}:${user.id}`. */
  accountKey: string;
  /** Access-token expiry, epoch milliseconds. */
  expiresAt: number;
  /** Identifier of the provider that issued the session, e.g. "google" | "github" | "mock". */
  providerId: string;
}

export interface SignInOptions {
  /** OIDC scopes to request in addition to the provider's defaults. */
  scopes?: readonly string[];
  /** OIDC `prompt` parameter controlling re-consent / account selection. */
  prompt?: "none" | "login" | "consent" | "select_account";
}

/**
 * Authentication abstraction. Implementations drive an interactive (OIDC)
 * sign-in and manage token lifecycle internally; callers never handle raw
 * tokens except via {@link getAccessToken}.
 */
export interface AuthProvider {
  /** Drives the interactive sign-in flow; resolves with non-secret session metadata. */
  signIn(options?: SignInOptions): Promise<Session>;
  /** Returns a valid access token, auto-refreshing when near expiry. Null if signed out. */
  getAccessToken(): Promise<string | null>;
  /** Revokes tokens at the identity provider where possible, then clears local state. */
  signOut(): Promise<void>;
  /** The current user from the live session, or null if signed out. */
  getCurrentUser(): Promise<AuthUser | null>;
}

export interface FeatureFlagProvider {
  isEnabled(key: string): boolean;
}

export interface ErrorReporter {
  capture(error: Error, context?: Record<string, unknown>): void;
}
