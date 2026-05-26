import { describe, expect, it } from "vitest";
import { PLUGIN_API_VERSION } from "./plugin-api.js";

describe("PLUGIN_API_VERSION", () => {
  it("is a semver string", () => {
    expect(PLUGIN_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("starts at 1.x while the API is unstable", () => {
    expect(PLUGIN_API_VERSION.startsWith("1.")).toBe(true);
  });
});
