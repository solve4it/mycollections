import { describe, expect, expectTypeOf, it } from "vitest";
import type { AuthProvider, AuthResult, AuthUser, ErrorReporter, FeatureFlagProvider } from "./providers.js";

describe("provider interfaces", () => {
  it("AuthProvider can be implemented", async () => {
    const user: AuthUser = { id: "u1", email: "a@b.c", displayName: "A" };
    const result: AuthResult = { user, token: "tok" };

    const impl: AuthProvider = {
      signIn: async () => result,
      signOut: async () => {},
      getCurrentUser: async () => user,
    };

    expect((await impl.signIn({ email: "a@b.c", password: "x" })).user.id).toBe("u1");
    expect(await impl.getCurrentUser()).toEqual(user);
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
});
