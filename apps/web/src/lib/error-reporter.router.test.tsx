import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRouterCatch } from "./error-reporter.js";

/**
 * What the router actually hands `defaultOnCatch` (#317).
 *
 * Driven through a real `createRouter` + `<RouterProvider>` rather than by
 * calling `onRouterCatch` directly: the point is that the router passes a second
 * `ErrorInfo` argument at all, and a direct call would assert nothing about
 * that. TanStack Router wraps every route in its own catch boundary, so this
 * hook — not the `<ErrorBoundary>` around the provider — is what sees a route
 * render error.
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
function ExplodingPanel(): never {
  throw new Error("panel render boom");
}

/** Pulls the sanitized report out of the console noise React also writes there. */
function lastReport(): { context: Record<string, unknown> } {
  const call = consoleSpy.mock.calls.findLast((args) => args[0] === "[error-report]");
  if (!call) throw new Error("no error report was captured");
  return call[1] as { context: Record<string, unknown> };
}

/**
 * `defaultErrorComponent` is not decoration: the router only mounts a per-route
 * `CatchBoundary` when an error component is resolved for that route, and
 * `defaultOnCatch` is that boundary's `componentDidCatch`. Without one the throw
 * sails past every route to the router's global boundary, which in dev only
 * console.warns. See the note in DEVELOPMENT.md — the app itself configures no
 * error component today, which is tracked separately from #317.
 */
function renderThrowingRoute() {
  const rootRoute = createRootRoute({ component: Outlet });
  const boomRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: ExplodingPanel });
  const router = createRouter({
    routeTree: rootRoute.addChildren([boomRoute]),
    defaultOnCatch: onRouterCatch,
    defaultErrorComponent: () => <p>route error</p>,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("route render errors reported through the real router", () => {
  it("names the component that threw in the reported componentStack", async () => {
    renderThrowingRoute();
    await screen.findByText("route error");

    const { context } = lastReport();
    expect(context.source).toBe("router");
    expect(context.componentStack).toEqual(expect.stringContaining("ExplodingPanel"));
  });

  it("reports without a componentStack key when called with no errorInfo", () => {
    onRouterCatch(new Error("handler called bare"));

    const { context } = lastReport();
    expect(context.source).toBe("router");
    expect(Object.hasOwn(context, "componentStack")).toBe(false);
  });
});
