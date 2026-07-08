import type { ErrorReporter } from "@mycollections/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.js";

afterEach(cleanup);

function Bomb(): never {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary reporter={{ capture: vi.fn() }}>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("shows a fallback with a reload button when a child throws", () => {
    // React logs caught render errors; keep test output clean.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary reporter={{ capture: vi.fn() }}>
        <Bomb />
      </ErrorBoundary>,
    );
    consoleSpy.mockRestore();
    expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i);
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });

  it("reports the error with the component stack as context", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reporter: ErrorReporter = { capture: vi.fn() };
    render(
      <ErrorBoundary reporter={reporter}>
        <Bomb />
      </ErrorBoundary>,
    );
    consoleSpy.mockRestore();
    expect(reporter.capture).toHaveBeenCalledTimes(1);
    const [error, context] = vi.mocked(reporter.capture).mock.calls[0] ?? [];
    expect((error as Error).message).toBe("render exploded");
    expect(context).toMatchObject({ source: "error-boundary" });
    expect(String((context as Record<string, unknown>).componentStack)).toContain("Bomb");
  });
});
