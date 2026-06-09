import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DatabaseHandle, openDatabase } from "../open-database.js";

let handle: DatabaseHandle;

beforeEach(async () => {
  handle = await openDatabase({ path: ":memory:" });
});

afterEach(() => {
  handle.close();
});

describe("UserProfileRepository", () => {
  it("returns null when no profile is stored", async () => {
    expect(await handle.userProfile.get("oidc:sub-1")).toBeNull();
  });

  it("creates a profile on first upsert", async () => {
    const profile = await handle.userProfile.upsert({
      id: "oidc:sub-1",
      displayName: "Sam",
      email: "sam@example.com",
      provider: "oidc",
      settings: { theme: "dark", locale: "en-US" },
    });
    expect(profile.createdAt).toBe(profile.updatedAt);
    expect(await handle.userProfile.get("oidc:sub-1")).toEqual(profile);
  });

  it("updates in place on subsequent upserts, preserving createdAt", async () => {
    const first = await handle.userProfile.upsert({
      id: "oidc:sub-1",
      displayName: "Sam",
      provider: "oidc",
      settings: {},
    });
    const second = await handle.userProfile.upsert({
      id: "oidc:sub-1",
      displayName: "Samantha",
      provider: "oidc",
      settings: { theme: "light" },
    });
    expect(second.displayName).toBe("Samantha");
    expect(second.settings).toEqual({ theme: "light" });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt >= first.updatedAt).toBe(true);
  });

  it("stores email as null when omitted", async () => {
    const profile = await handle.userProfile.upsert({
      id: "oidc:sub-2",
      displayName: "NoMail",
      provider: "oidc",
      settings: {},
    });
    expect(profile.email).toBeNull();
  });
});
