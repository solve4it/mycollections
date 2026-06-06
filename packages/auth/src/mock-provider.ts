import type { AuthUser } from "@mycollections/core";
import { FakeAuthorizationFlow } from "./authorization-flow.js";
import type { TokenEndpoint, TokenEndpointResponse } from "./oidc-auth-provider.js";
import { OidcAuthProvider } from "./oidc-auth-provider.js";
import { InMemoryTokenStore } from "./secure-token-store.js";

const DEFAULT_USER: AuthUser = {
  id: "mock-user",
  email: "dev@example.com",
  displayName: "Dev User",
};

export interface MockAuthProviderOptions {
  /** User the mock signs in as. Defaults to a generic dev user. */
  user?: AuthUser;
  /** Access-token lifetime in seconds. Defaults to one hour. */
  expiresInSeconds?: number;
}

/** In-process token endpoint that mints predictable tokens for development. */
class MockTokenEndpoint implements TokenEndpoint {
  #counter = 0;
  constructor(private readonly expiresIn: number) {}

  async exchangeCode(): Promise<TokenEndpointResponse> {
    return this.#issue();
  }

  async refresh(): Promise<TokenEndpointResponse> {
    return this.#issue();
  }

  async revoke(): Promise<void> {
    // No-op for the mock.
  }

  #issue(): TokenEndpointResponse {
    this.#counter += 1;
    return {
      accessToken: `mock-access-${this.#counter}`,
      refreshToken: `mock-refresh-${this.#counter}`,
      idToken: `mock-id-${this.#counter}`,
      expiresIn: this.expiresIn,
    };
  }
}

/**
 * Builds a fully wired {@link OidcAuthProvider} backed by in-memory fakes — no
 * browser, network, or keychain. Intended for app-shell development and tests
 * before real OIDC providers are wired up.
 */
export function createMockAuthProvider(options: MockAuthProviderOptions = {}): OidcAuthProvider {
  const user = options.user ?? DEFAULT_USER;
  const expiresIn = options.expiresInSeconds ?? 3600;

  return new OidcAuthProvider({
    config: {
      providerId: "mock",
      clientId: "mock-client",
      authorizationEndpoint: "https://mock.invalid/authorize",
      redirectUri: "http://127.0.0.1:0/callback",
      defaultScopes: ["openid", "email", "profile"],
    },
    store: new InMemoryTokenStore(),
    flow: new FakeAuthorizationFlow({ code: "mock-auth-code" }),
    tokenEndpoint: new MockTokenEndpoint(expiresIn),
    identityResolver: { resolve: async () => user },
  });
}
