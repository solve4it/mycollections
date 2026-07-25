import { createStaticFeatureFlagProvider, FeatureFlagsSchema } from "@mycollections/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { appFeatureFlagProvider, type FeatureFlagKey } from "../config/flags.js";
import flagsJson from "../config/flags.json";
import { FeatureFlagsProvider, useFeatureFlag } from "./feature-flags.js";

function FlagProbe({ flag }: { flag: FeatureFlagKey }) {
  return <p>{`${flag}=${String(useFeatureFlag(flag))}`}</p>;
}

describe("useFeatureFlag", () => {
  it("returns each flag's own value, not a single shared answer", () => {
    const provider = createStaticFeatureFlagProvider({ trash: true, notifications: false });
    render(
      <FeatureFlagsProvider provider={provider}>
        <FlagProbe flag="trash" />
        <FlagProbe flag="notifications" />
      </FeatureFlagsProvider>,
    );
    expect(screen.getByText("trash=true")).toBeInTheDocument();
    expect(screen.getByText("notifications=false")).toBeInTheDocument();
  });

  it("returns false for a flag missing from the configuration", () => {
    const provider = createStaticFeatureFlagProvider({ trash: true });
    render(
      <FeatureFlagsProvider provider={provider}>
        <FlagProbe flag="notifications" />
      </FeatureFlagsProvider>,
    );
    expect(screen.getByText("notifications=false")).toBeInTheDocument();
  });

  it("falls back to the app's committed flags when no provider is injected", () => {
    render(
      <FeatureFlagsProvider>
        <FlagProbe flag="trash" />
      </FeatureFlagsProvider>,
    );
    expect(screen.getByText(`trash=${String(flagsJson.trash)}`)).toBeInTheDocument();
  });

  it("throws when used outside a FeatureFlagsProvider", () => {
    // A silent default would let a subtree read committed flags while tests
    // think they injected their own — fail loudly at the wiring mistake instead.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<FlagProbe flag="trash" />)).toThrow(/FeatureFlagsProvider/);
    consoleError.mockRestore();
  });
});

describe("committed flags.json", () => {
  it("matches the feature flag schema", () => {
    expect(FeatureFlagsSchema.safeParse(flagsJson).success).toBe(true);
  });

  it("is the source the app-wide provider reads", () => {
    expect(appFeatureFlagProvider.isEnabled("trash")).toBe(flagsJson.trash);
  });

  it("reports an undeclared flag as disabled", () => {
    expect(appFeatureFlagProvider.isEnabled("no-such-flag")).toBe(false);
  });
});
