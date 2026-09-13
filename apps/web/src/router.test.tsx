import { createMemoryHistory, createRootRoute, createRoute, Outlet, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "./router.js";

/**
 * The app's own error handling, exercised through the app's own router options
 * (#319).
 *
 * `error-reporter.router.test.tsx` proves the *handler* is given an `ErrorInfo`,
 * but it builds a router of its own and hands it a `defaultErrorComponent`
 * inline — so it passed for as long as the app configured none, which is exactly
 * the bug. Here only the route tree is substituted: everything that decides what
 * happens to a throw comes from `createAppRouter`.
 *
 * That substitution is the point. TanStack Router mounts a route's catch
 * boundary only where an error component resolves for that match
 * (`Match.js:39,44`), and `defaultOnCatch` is that boundary's `componentDidCatch`
 * — so an app with no error component reports nothing, shows nothing, and fails
 * only this test.
 */

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The component whose name the report must be able to point at. */
function ExplodingScreen(): never {
  throw new Error("screen render boom");
}

/** Pulls the sanitized report out of the console noise React also writes there. */
function lastReport(): { context: Record<string, unknown> } {
  const calls = consoleSpy.mock.calls as unknown[][];
  const call = calls.filter((args) => args[0] === "[error-report]").at(-1);
  if (!call) throw new Error("no error report was captured");
  return call[1] as { context: Record<string, unknown> };
}

function renderThrowingRoute() {
  const rootRoute = createRootRoute({ component: Outlet });
  const boomRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    staticData: { titleKey: "collections:title" },
    component: ExplodingScreen,
  });
  const router = createAppRouter({
    routeTree: rootRoute.addChildren([boomRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("the app router's handling of a route render error", () => {
  it("reports the error, naming the component that threw", () => {
    renderThrowingRoute();

    const { context } = lastReport();
    expect(context.source).toBe("router");
    expect(context.componentStack).toEqual(expect.stringContaining("ExplodingScreen"));
  });

  /**
   * The state the app is in without this: the throw reaches the router's own
   * global boundary (`Matches.js:43`), which passes no `errorComponent` and so
   * renders the library's built-in one — a red `<pre>` holding `error.message`,
   * open in dev and one "Show Error" button away in production
   * (`CatchBoundary.js`, `ErrorComponent`). A message may carry whatever the user
   * typed, which is why `SAFE_CONTEXT_KEYS` allowlists what a *report* may hold;
   * putting it on screen is the same leak with an audience.
   */
  it("puts nothing about what threw on screen", async () => {
    renderThrowingRoute();
    await screen.findByRole("alert");

    expect(document.body).not.toHaveTextContent("screen render boom");
    expect(screen.queryByRole("button", { name: /show error/i })).toBeNull();
  });
});
