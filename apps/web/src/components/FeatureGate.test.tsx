import { createStaticFeatureFlagProvider } from "@mycollections/core";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FeatureFlagKey } from "../config/flags.js";
import { FeatureFlagsProvider } from "../lib/feature-flags.js";
import { FeatureGate } from "./FeatureGate.js";

function renderWithFlags(ui: ReactNode, flags: Record<string, boolean>) {
  return render(<FeatureFlagsProvider provider={createStaticFeatureFlagProvider(flags)}>{ui}</FeatureFlagsProvider>);
}

describe("FeatureGate", () => {
  it("renders its children when the flag is enabled", () => {
    renderWithFlags(
      <FeatureGate flag="trash" fallback={<p>trash is hidden</p>}>
        <p>trash is here</p>
      </FeatureGate>,
      { trash: true },
    );
    expect(screen.getByText("trash is here")).toBeInTheDocument();
    expect(screen.queryByText("trash is hidden")).toBeNull();
  });

  it("renders the fallback and never mounts its children when the flag is disabled", () => {
    const Child = vi.fn(() => <p>trash is here</p>);
    renderWithFlags(
      <FeatureGate flag="trash" fallback={<p>trash is hidden</p>}>
        <Child />
      </FeatureGate>,
      { trash: false },
    );
    expect(screen.getByText("trash is hidden")).toBeInTheDocument();
    expect(screen.queryByText("trash is here")).toBeNull();
    expect(Child).not.toHaveBeenCalled();
  });

  it("renders the fallback when the flag is missing from the configuration", () => {
    renderWithFlags(
      <FeatureGate flag="trash" fallback={<p>trash is hidden</p>}>
        <p>trash is here</p>
      </FeatureGate>,
      {},
    );
    expect(screen.getByText("trash is hidden")).toBeInTheDocument();
  });

  it("renders nothing when a disabled flag has no fallback", () => {
    const { container } = renderWithFlags(
      <FeatureGate flag="trash">
        <p>trash is here</p>
      </FeatureGate>,
      { trash: false },
    );
    expect(container.textContent).toBe("");
  });

  it("adds no wrapper element around its children", () => {
    // A wrapper div would break flex/grid layouts and produce invalid nesting
    // inside lists and tables, so the gate must render a fragment.
    const { container } = renderWithFlags(
      <ul>
        <FeatureGate flag="trash">
          <li>trash is here</li>
        </FeatureGate>
      </ul>,
      { trash: true },
    );
    expect(container.querySelector("ul")?.children).toHaveLength(1);
    expect(container.querySelector("ul > li")?.textContent).toBe("trash is here");
  });

  it("keeps an undeclared flag's feature hidden", () => {
    // Cast past the key union to prove the runtime is fail-closed too, not just
    // the types: an unknown flag name never opens a gate.
    renderWithFlags(
      <FeatureGate flag={"no-such-flag" as FeatureFlagKey} fallback={<p>trash is hidden</p>}>
        <p>trash is here</p>
      </FeatureGate>,
      { trash: true },
    );
    expect(screen.getByText("trash is hidden")).toBeInTheDocument();
    expect(screen.queryByText("trash is here")).toBeNull();
  });
});
