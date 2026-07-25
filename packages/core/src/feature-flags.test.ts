import { describe, expect, it } from "vitest";
import { createStaticFeatureFlagProvider, FeatureFlagsSchema, parseFeatureFlags } from "./feature-flags.js";

describe("FeatureFlagsSchema", () => {
  it("accepts a map of flag names to booleans", () => {
    const parsed = FeatureFlagsSchema.parse({ trash: true, notifications: false });
    expect(parsed).toEqual({ trash: true, notifications: false });
  });

  it("accepts an empty flag map", () => {
    expect(FeatureFlagsSchema.parse({})).toEqual({});
  });

  it.each([
    ["a string value", { trash: "true" }],
    ["a numeric value", { trash: 1 }],
    ["a null value", { trash: null }],
    ["a nested object", { trash: { enabled: true } }],
    ["an array", ["trash"]],
    ["null", null],
    ["a bare string", "trash"],
  ])("rejects %s", (_label, input) => {
    expect(FeatureFlagsSchema.safeParse(input).success).toBe(false);
  });
});

describe("parseFeatureFlags", () => {
  it("returns the validated flag map", () => {
    expect(parseFeatureFlags({ trash: true, notifications: false })).toEqual({ trash: true, notifications: false });
  });

  it("throws on malformed input rather than silently returning no flags", () => {
    // A silent {} would turn a fat-fingered flags file into "every feature off"
    // with no signal at all — callers must see the failure.
    expect(() => parseFeatureFlags({ trash: "yes" })).toThrow();
  });
});

describe("createStaticFeatureFlagProvider", () => {
  it("reports an explicitly enabled flag as enabled", () => {
    const provider = createStaticFeatureFlagProvider({ trash: true, notifications: false });
    expect(provider.isEnabled("trash")).toBe(true);
  });

  it("reports an explicitly disabled flag as disabled", () => {
    const provider = createStaticFeatureFlagProvider({ trash: true, notifications: false });
    expect(provider.isEnabled("notifications")).toBe(false);
  });

  it("reports an unknown flag as disabled", () => {
    const provider = createStaticFeatureFlagProvider({ trash: true });
    expect(provider.isEnabled("no-such-flag")).toBe(false);
  });

  it("reports every flag as disabled when no flags are configured", () => {
    const provider = createStaticFeatureFlagProvider({});
    expect(provider.isEnabled("trash")).toBe(false);
  });

  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "reports the inherited object property %s as disabled",
    (key) => {
      // A plain object lookup returns Object.prototype members here, and a
      // truthy function would render a gated feature as if it were enabled.
      const provider = createStaticFeatureFlagProvider({ trash: true });
      expect(provider.isEnabled(key)).toBe(false);
    },
  );

  it("snapshots the flags so later mutation of the caller's object has no effect", () => {
    const flags = { trash: false };
    const provider = createStaticFeatureFlagProvider(flags);
    flags.trash = true;
    expect(provider.isEnabled("trash")).toBe(false);
  });

  it("does not freeze the caller's object", () => {
    const flags = { trash: false };
    createStaticFeatureFlagProvider(flags);
    expect(Object.isFrozen(flags)).toBe(false);
  });
});
