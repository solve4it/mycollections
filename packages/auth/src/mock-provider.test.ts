import type { AuthUser } from "@mycollections/core";
import { describe, expect, it } from "vitest";
import { createMockAuthProvider } from "./mock-provider.js";

describe("createMockAuthProvider", () => {
  it("signs in to a default mock user and vends an access token", async () => {
    const provider = createMockAuthProvider();
    const session = await provider.signIn();
    expect(session.providerId).toBe("mock");
    expect(session.user.email).toBe("dev@example.com");
    expect(await provider.getAccessToken()).toBeTruthy();
  });

  it("uses a supplied user", async () => {
    const user: AuthUser = { id: "sub-42", email: "ada@example.com", displayName: "Ada" };
    const provider = createMockAuthProvider({ user });
    const session = await provider.signIn();
    expect(session.user).toEqual(user);
    expect(session.accountKey).toBe("mock:sub-42");
  });

  it("clears the session on sign-out", async () => {
    const provider = createMockAuthProvider();
    await provider.signIn();
    await provider.signOut();
    expect(await provider.getCurrentUser()).toBeNull();
    expect(await provider.getAccessToken()).toBeNull();
  });
});
