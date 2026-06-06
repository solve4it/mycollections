import type { AuthProvider, AuthUser, Session, SignInOptions } from "@mycollections/core";
import type { AuthorizationFlow } from "./authorization-flow.js";
import { createPkcePair, randomUrlSafe } from "./pkce.js";
import type { SecureTokenStore } from "./secure-token-store.js";

/** Raw token response from an OIDC token endpoint. */
export interface TokenEndpointResponse {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export interface CodeExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

/**
 * Talks to an OIDC token endpoint. Real implementations (follow-up) wrap a
 * library such as `openid-client`; tests provide a fake. Kept as a seam so the
 * provider's protocol logic has no network dependency.
 */
export interface TokenEndpoint {
  exchangeCode(request: CodeExchangeRequest): Promise<TokenEndpointResponse>;
  refresh(request: RefreshRequest): Promise<TokenEndpointResponse>;
  /** Best-effort RFC 7009 revocation. Optional: not every provider supports it. */
  revoke?(token: string): Promise<void>;
}

/**
 * Validates the ID token and derives the authenticated user. Real
 * implementations (follow-up) verify the signature against the provider JWKS and
 * check `iss`/`aud`/`exp`/`nonce` (e.g. via `jose`); the provider passes the
 * expected nonce it generated so the resolver can enforce replay protection.
 */
export interface IdentityResolver {
  resolve(tokens: TokenEndpointResponse, expectedNonce: string): Promise<AuthUser>;
}

export interface OidcProviderConfig {
  providerId: string;
  clientId: string;
  authorizationEndpoint: string;
  /** Redirect URI to register in the authorization request (loopback on desktop). */
  redirectUri: string;
  defaultScopes: readonly string[];
}

export interface OidcAuthProviderDeps {
  config: OidcProviderConfig;
  store: SecureTokenStore;
  flow: AuthorizationFlow;
  tokenEndpoint: TokenEndpoint;
  identityResolver: IdentityResolver;
  /** Injectable clock (epoch ms) for deterministic expiry tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Refresh proactively when fewer than this many seconds remain. Defaults to 60. */
  refreshSkewSeconds?: number;
}

const DEFAULT_REFRESH_SKEW_SECONDS = 60;

/**
 * Provider-agnostic OIDC Authorization Code + PKCE implementation of the core
 * {@link AuthProvider}. Holds no platform dependencies: storage and the redirect
 * are injected as seams, so it is fully unit-testable and shared across desktop
 * and web.
 *
 * Tokens are written only to the injected {@link SecureTokenStore} and never
 * returned to callers except via {@link getAccessToken}. Refreshes are
 * single-flighted so concurrent callers never trigger overlapping refreshes
 * (which, with refresh-token rotation, would cause false reuse detection).
 *
 * Note: this provider keeps the active session in memory; restoring a session
 * across process restarts is the responsibility of a future SessionManager.
 */
export class OidcAuthProvider implements AuthProvider {
  readonly #deps: OidcAuthProviderDeps;
  readonly #now: () => number;
  readonly #refreshSkewMs: number;
  #session: Session | null = null;
  #refreshInFlight: Promise<string | null> | null = null;

  constructor(deps: OidcAuthProviderDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.#refreshSkewMs = (deps.refreshSkewSeconds ?? DEFAULT_REFRESH_SKEW_SECONDS) * 1000;
  }

  async signIn(options?: SignInOptions): Promise<Session> {
    const { config, flow, tokenEndpoint, identityResolver, store } = this.#deps;
    const pkce = await createPkcePair();
    const state = randomUrlSafe(32);
    const nonce = randomUrlSafe(32);
    const scopes = [...config.defaultScopes, ...(options?.scopes ?? [])];

    const response = await flow.authorize({
      authorizationEndpoint: config.authorizationEndpoint,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes,
      codeChallenge: pkce.codeChallenge,
      state,
      nonce,
    });

    if (response.state !== state) {
      throw new Error("OIDC authorization state mismatch; possible CSRF — aborting sign-in.");
    }

    const tokens = await tokenEndpoint.exchangeCode({
      code: response.code,
      codeVerifier: pkce.codeVerifier,
      redirectUri: response.redirectUri,
    });

    const user = await identityResolver.resolve(tokens, nonce);
    const accountKey = `${config.providerId}:${user.id}`;
    const expiresAt = this.#now() + tokens.expiresIn * 1000;

    await store.set(accountKey, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      expiresAt,
    });

    this.#session = { user, accountKey, expiresAt, providerId: config.providerId };
    return this.#session;
  }

  async getAccessToken(): Promise<string | null> {
    const session = this.#session;
    if (!session) return null;

    const stored = await this.#deps.store.get(session.accountKey);
    if (!stored) {
      this.#session = null;
      return null;
    }

    if (this.#now() < stored.expiresAt - this.#refreshSkewMs) {
      return stored.accessToken;
    }

    // Near or past expiry: refresh, coalescing concurrent callers into one call.
    if (this.#refreshInFlight) return this.#refreshInFlight;
    this.#refreshInFlight = this.#refresh(session.accountKey, stored.refreshToken);
    try {
      return await this.#refreshInFlight;
    } finally {
      this.#refreshInFlight = null;
    }
  }

  async signOut(): Promise<void> {
    const session = this.#session;
    if (!session) return;

    const { store, tokenEndpoint } = this.#deps;
    const stored = await store.get(session.accountKey);
    const tokenToRevoke = stored?.refreshToken ?? stored?.accessToken;
    if (tokenToRevoke && tokenEndpoint.revoke) {
      // Best-effort: a revocation failure must not block local sign-out.
      try {
        await tokenEndpoint.revoke(tokenToRevoke);
      } catch {
        // Intentionally ignored; local state is cleared regardless.
      }
    }

    await store.delete(session.accountKey);
    this.#session = null;
    this.#refreshInFlight = null;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.#session?.user ?? null;
  }

  async #refresh(accountKey: string, refreshToken: string | undefined): Promise<string | null> {
    if (!refreshToken) {
      // Cannot refresh without a refresh token; caller must sign in again.
      return null;
    }

    let tokens: TokenEndpointResponse;
    try {
      tokens = await this.#deps.tokenEndpoint.refresh({ refreshToken });
    } catch (error) {
      // Treat a failed refresh (e.g. rotation reuse detection) as a compromised
      // session: purge local state and surface the error.
      await this.#deps.store.delete(accountKey);
      this.#session = null;
      throw error;
    }

    const expiresAt = this.#now() + tokens.expiresIn * 1000;
    await this.#deps.store.set(accountKey, {
      accessToken: tokens.accessToken,
      // Some providers omit a new refresh token; keep the prior one in that case.
      refreshToken: tokens.refreshToken ?? refreshToken,
      idToken: tokens.idToken,
      expiresAt,
    });
    if (this.#session) {
      this.#session = { ...this.#session, expiresAt };
    }
    return tokens.accessToken;
  }
}
