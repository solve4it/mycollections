import { describe, expect, it, vi } from "vitest";
import { FakeAuthorizationFlow } from "./authorization-flow.js";
import type { OidcProviderConfig, TokenEndpoint, TokenEndpointResponse } from "./oidc-auth-provider.js";
import { OidcAuthProvider } from "./oidc-auth-provider.js";
import { InMemoryTokenStore } from "./secure-token-store.js";

const config: OidcProviderConfig = {
  providerId: "test",
  clientId: "client-1",
  authorizationEndpoint: "https://idp.example/authorize",
  redirectUri: "http://127.0.0.1:0/callback",
  defaultScopes: ["openid", "email"],
};

/** Configurable fake token endpoint that records calls. */
class FakeTokenEndpoint implements TokenEndpoint {
  exchangeCalls = 0;
  refreshCalls = 0;
  revokeCalls: string[] = [];
  exchangeResponse: TokenEndpointResponse = {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    idToken: "id-1",
    expiresIn: 3600,
  };
  refreshResponse: TokenEndpointResponse = {
    accessToken: "access-2",
    refreshToken: "refresh-2",
    idToken: "id-2",
    expiresIn: 3600,
  };
  refreshError?: Error;
  onRefresh?: () => Promise<void>;

  async exchangeCode(): Promise<TokenEndpointResponse> {
    this.exchangeCalls += 1;
    return this.exchangeResponse;
  }

  async refresh(): Promise<TokenEndpointResponse> {
    this.refreshCalls += 1;
    await this.onRefresh?.();
    if (this.refreshError) throw this.refreshError;
    return this.refreshResponse;
  }

  async revoke(token: string): Promise<void> {
    this.revokeCalls.push(token);
  }
}

function makeProvider(
  overrides: {
    flow?: FakeAuthorizationFlow;
    tokenEndpoint?: FakeTokenEndpoint;
    store?: InMemoryTokenStore;
    now?: () => number;
    refreshSkewSeconds?: number;
  } = {},
) {
  const store = overrides.store ?? new InMemoryTokenStore();
  const flow = overrides.flow ?? new FakeAuthorizationFlow({ code: "auth-code-1" });
  const tokenEndpoint = overrides.tokenEndpoint ?? new FakeTokenEndpoint();
  const nonces: string[] = [];
  const provider = new OidcAuthProvider({
    config,
    store,
    flow,
    tokenEndpoint,
    identityResolver: {
      resolve: async (_tokens, expectedNonce) => {
        nonces.push(expectedNonce);
        return { id: "sub-1", email: "user@example.com", displayName: "User" };
      },
    },
    now: overrides.now,
    refreshSkewSeconds: overrides.refreshSkewSeconds,
  });
  return { provider, store, flow, tokenEndpoint, nonces };
}

describe("OidcAuthProvider.signIn", () => {
  it("returns non-secret session metadata and stores tokens in the secure store", async () => {
    const now = () => 10_000;
    const { provider, store } = makeProvider({ now });
    const session = await provider.signIn();

    expect(session).toEqual({
      user: { id: "sub-1", email: "user@example.com", displayName: "User" },
      accountKey: "test:sub-1",
      expiresAt: 10_000 + 3600 * 1000,
      providerId: "test",
    });
    expect(session).not.toHaveProperty("accessToken");

    const stored = await store.get("test:sub-1");
    expect(stored).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      idToken: "id-1",
      expiresAt: 10_000 + 3600 * 1000,
    });
  });

  it("sends a PKCE S256 challenge, state and nonce to the authorization flow", async () => {
    const flow = new FakeAuthorizationFlow({ code: "auth-code-1" });
    const { provider, nonces } = makeProvider({ flow });
    await provider.signIn();

    const req = flow.requests[0];
    expect(req?.codeChallenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(req?.state).toBeTruthy();
    expect(req?.nonce).toBeTruthy();
    expect(req?.clientId).toBe("client-1");
    // The nonce sent to the IdP is the one the identity resolver must verify.
    expect(nonces[0]).toBe(req?.nonce);
  });

  it("requests default scopes plus any extras", async () => {
    const flow = new FakeAuthorizationFlow({ code: "auth-code-1" });
    const { provider } = makeProvider({ flow });
    await provider.signIn({ scopes: ["profile"] });
    expect(flow.requests[0]?.scopes).toEqual(["openid", "email", "profile"]);
  });

  it("rejects and stores nothing when the returned state does not match (CSRF)", async () => {
    const flow = new FakeAuthorizationFlow({ code: "auth-code-1", returnedState: "attacker" });
    const tokenEndpoint = new FakeTokenEndpoint();
    const { provider, store } = makeProvider({ flow, tokenEndpoint });

    await expect(provider.signIn()).rejects.toThrow(/state/i);
    expect(tokenEndpoint.exchangeCalls).toBe(0);
    expect(await store.get("test:sub-1")).toBeNull();
  });
});

describe("OidcAuthProvider.getAccessToken", () => {
  it("returns null when signed out", async () => {
    const { provider } = makeProvider();
    expect(await provider.getAccessToken()).toBeNull();
  });

  it("returns the stored access token when it is not near expiry", async () => {
    let clock = 10_000;
    const { provider, tokenEndpoint } = makeProvider({ now: () => clock });
    await provider.signIn();
    clock = 20_000; // well before the 1h expiry
    expect(await provider.getAccessToken()).toBe("access-1");
    expect(tokenEndpoint.refreshCalls).toBe(0);
  });

  it("refreshes when within the skew window and persists the new tokens", async () => {
    let clock = 0;
    const tokenEndpoint = new FakeTokenEndpoint();
    const { provider, store } = makeProvider({ now: () => clock, tokenEndpoint, refreshSkewSeconds: 60 });
    await provider.signIn(); // expiresAt = 3600_000
    clock = 3600_000 - 30_000; // inside the 60s skew window

    expect(await provider.getAccessToken()).toBe("access-2");
    expect(tokenEndpoint.refreshCalls).toBe(1);
    const stored = await store.get("test:sub-1");
    expect(stored?.accessToken).toBe("access-2");
    expect(stored?.refreshToken).toBe("refresh-2");
    expect(stored?.expiresAt).toBe(clock + 3600 * 1000);
  });

  it("coalesces concurrent refreshes into a single token-endpoint call (single-flight)", async () => {
    let clock = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const tokenEndpoint = new FakeTokenEndpoint();
    tokenEndpoint.onRefresh = () => gate;
    const { provider } = makeProvider({ now: () => clock, tokenEndpoint });
    await provider.signIn();
    clock = 3600_000; // expired

    const a = provider.getAccessToken();
    const b = provider.getAccessToken();
    release();
    const [ta, tb] = await Promise.all([a, b]);

    expect(ta).toBe("access-2");
    expect(tb).toBe("access-2");
    expect(tokenEndpoint.refreshCalls).toBe(1);
  });

  it("returns null when expired with no refresh token", async () => {
    let clock = 0;
    const tokenEndpoint = new FakeTokenEndpoint();
    tokenEndpoint.exchangeResponse = { accessToken: "access-1", expiresIn: 3600 };
    const { provider } = makeProvider({ now: () => clock, tokenEndpoint });
    await provider.signIn();
    clock = 3600_000;
    expect(await provider.getAccessToken()).toBeNull();
  });

  it("clears local state and rethrows when refresh fails (reuse detection)", async () => {
    let clock = 0;
    const tokenEndpoint = new FakeTokenEndpoint();
    tokenEndpoint.refreshError = new Error("invalid_grant");
    const { provider, store } = makeProvider({ now: () => clock, tokenEndpoint });
    await provider.signIn();
    clock = 3600_000;

    await expect(provider.getAccessToken()).rejects.toThrow("invalid_grant");
    expect(await store.get("test:sub-1")).toBeNull();
    expect(await provider.getCurrentUser()).toBeNull();
  });
});

describe("OidcAuthProvider session lifecycle", () => {
  it("getCurrentUser reflects sign-in and sign-out", async () => {
    const { provider } = makeProvider();
    expect(await provider.getCurrentUser()).toBeNull();
    await provider.signIn();
    expect(await provider.getCurrentUser()).toEqual({
      id: "sub-1",
      email: "user@example.com",
      displayName: "User",
    });
    await provider.signOut();
    expect(await provider.getCurrentUser()).toBeNull();
  });

  it("signOut revokes the refresh token, clears the store, and is a no-op when signed out", async () => {
    const tokenEndpoint = new FakeTokenEndpoint();
    const { provider, store } = makeProvider({ tokenEndpoint });
    await provider.signIn();
    await provider.signOut();

    expect(tokenEndpoint.revokeCalls).toContain("refresh-1");
    expect(await store.get("test:sub-1")).toBeNull();
    expect(await provider.getAccessToken()).toBeNull();
    await expect(provider.signOut()).resolves.toBeUndefined();
  });

  it("swallows revocation errors but still clears local state", async () => {
    const tokenEndpoint = new FakeTokenEndpoint();
    tokenEndpoint.revoke = vi.fn(async () => {
      throw new Error("idp down");
    });
    const { provider, store } = makeProvider({ tokenEndpoint });
    await provider.signIn();
    await expect(provider.signOut()).resolves.toBeUndefined();
    expect(await store.get("test:sub-1")).toBeNull();
    expect(await provider.getCurrentUser()).toBeNull();
  });
});
