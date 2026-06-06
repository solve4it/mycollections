import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AuthProvider,
  AuthUser,
  ErrorReporter,
  FeatureFlagProvider,
  Session,
  SignInOptions,
} from "./providers.js";

describe("provider interfaces", () => {
  it("AuthProvider can be implemented", async () => {
    const user: AuthUser = { id: "sub-1", email: "a@b.c", displayName: "A" };
    const session: Session = {
      user,
      accountKey: "mock:sub-1",
      expiresAt: Date.now() + 3600_000,
      providerId: "mock",
    };

    const impl: AuthProvider = {
      signIn: async () => session,
      getAccessToken: async () => "access-tok",
      signOut: async () => {},
      getCurrentUser: async () => user,
    };

    expect((await impl.signIn()).user.id).toBe("sub-1");
    expect(await impl.getAccessToken()).toBe("access-tok");
    expect(await impl.getCurrentUser()).toEqual(user);
  });

  it("signIn accepts optional OIDC options without returning tokens", async () => {
    const user: AuthUser = { id: "sub-2", email: "c@d.e" };
    const session: Session = { user, accountKey: "mock:sub-2", expiresAt: 0, providerId: "mock" };
    const impl: AuthProvider = {
      signIn: async (_options?: SignInOptions) => session,
      getAccessToken: async () => null,
      signOut: async () => {},
      getCurrentUser: async () => null,
    };

    const result = await impl.signIn({ scopes: ["email"], prompt: "consent" });
    expect(result.providerId).toBe("mock");
    // Session metadata must not carry tokens.
    expect(result).not.toHaveProperty("token");
    expect(result).not.toHaveProperty("accessToken");
  });

  it("FeatureFlagProvider can be implemented", () => {
    const impl: FeatureFlagProvider = {
      isEnabled: (key) => key === "on",
    };
    expect(impl.isEnabled("on")).toBe(true);
    expect(impl.isEnabled("off")).toBe(false);
  });

  it("ErrorReporter can be implemented", () => {
    const seen: Error[] = [];
    const impl: ErrorReporter = {
      capture: (e) => seen.push(e),
    };
    impl.capture(new Error("boom"));
    expect(seen).toHaveLength(1);
  });

  it("AuthUser type has required fields", () => {
    expectTypeOf<AuthUser>().toHaveProperty("id");
    expectTypeOf<AuthUser>().toHaveProperty("email");
  });

  it("Session type carries non-secret metadata", () => {
    expectTypeOf<Session>().toHaveProperty("accountKey");
    expectTypeOf<Session>().toHaveProperty("expiresAt");
    expectTypeOf<Session>().toHaveProperty("providerId");
  });
});
