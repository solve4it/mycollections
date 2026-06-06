# @mycollections/auth

Authentication for MyCollections: a provider-agnostic OIDC (Authorization Code + PKCE) implementation of the core [`AuthProvider`](../core/) contract, with a platform-abstracted secure token store.

This package is **desktop-first** and contains no platform I/O of its own. The OIDC protocol logic depends only on two injected seams — a secure token store and an authorization (redirect) flow — so it is fully unit-testable with no browser, network, or keychain, and can be shared between the desktop and (future) web targets.

## Design

The protocol core (`OidcAuthProvider`) is pure. Everything platform-specific is an injected seam:

| Seam | Responsibility | Implementations |
|---|---|---|
| `SecureTokenStore` | Persist `TokenSet`s by account key | `InMemoryTokenStore` (here); `KeyringTokenStore` (OS keychain, follow-up #169); BFF/cookie store for web (follow-up #174) |
| `AuthorizationFlow` | Perform the redirect, capture the auth code | `FakeAuthorizationFlow` (here); loopback flow for desktop (follow-up #170); web redirect flow (follow-up #174) |
| `TokenEndpoint` | Exchange/refresh/revoke tokens at the IdP | Wired per real provider (follow-ups #171, #172, #173) |
| `IdentityResolver` | Validate the ID token, derive the user | Wired per real provider (validates signature/`iss`/`aud`/`exp`/`nonce`) |

### Security properties

- **Authorization Code + PKCE (S256)** only — no implicit/hybrid; public client, no secret on desktop.
- **`state`** (CSRF) and **`nonce`** (replay) are generated per sign-in, sent to the IdP, and verified: `state` against the redirect response, `nonce` by the `IdentityResolver`.
- **Tokens never leave the secure store** except as an access token via `getAccessToken()`. They are never returned from `signIn`, never placed in `Session`, and must never be written to SQLite or logs.
- **Refresh-before-expiry** with a configurable skew window, and **single-flight refresh** so concurrent callers never trigger overlapping refreshes (which, with refresh-token rotation, would cause false reuse detection).
- **Failed refresh purges local state** (treats rotation reuse detection as a compromised session).
- **Sign-out** best-effort revokes the token at the IdP (RFC 7009), then clears the store and in-memory session.

## What's exported

| Export | Purpose |
|---|---|
| `OidcAuthProvider` | The OIDC Authorization Code + PKCE provider (implements core `AuthProvider`) |
| `SecureTokenStore` / `TokenSet` | Secure storage seam and the secret payload it holds |
| `InMemoryTokenStore` | Non-persistent store for tests and ephemeral fallback |
| `AuthorizationFlow` / `AuthorizationRequest` / `AuthorizationResponse` | Redirect transport seam |
| `FakeAuthorizationFlow` | Test authorization flow returning a canned code |
| `TokenEndpoint` / `IdentityResolver` | Per-provider seams for token exchange and ID-token validation |
| `createMockAuthProvider` | Fully wired in-memory provider for app-shell development |
| `createPkcePair` / `sha256Base64Url` / `randomUrlSafe` | PKCE (RFC 7636) helpers (Web Crypto, runs on Node ≥ 24 and browsers) |

## Usage

```ts
import { createMockAuthProvider } from "@mycollections/auth";

// App-shell development: no browser, network, or keychain.
const auth = createMockAuthProvider();
const session = await auth.signIn();        // non-secret Session metadata
const token = await auth.getAccessToken();  // access token, auto-refreshed near expiry
await auth.signOut();
```

Wiring a real provider means supplying a `TokenEndpoint`, an `IdentityResolver`, a concrete `SecureTokenStore`, and an `AuthorizationFlow` to `new OidcAuthProvider({ ... })`. Those concrete backends are deferred to the follow-up issues above.

## Scope

In this package today: the abstraction, the in-memory store, the fake flow, the OIDC protocol logic, and a mock provider — all TDD-tested. **Out of scope** (tracked as follow-ups): the native keychain backend, the desktop loopback and web redirect flows, real provider wiring (Google, GitHub, Apple), web/BFF token storage, and a timer-based background `SessionManager`.

## Testing

```bash
pnpm --filter @mycollections/auth test
```

Tests live alongside source as `*.test.ts` and cover the PKCE vectors, store round-trips, the full sign-in/refresh/sign-out lifecycle, single-flight refresh, and the CSRF (state-mismatch) and reuse-detection paths.
