import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./components/Shell.js";
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
 * (`Match.js` — `routeErrorComponent ? CatchBoundary : SafeFragment`), and
 * `defaultOnCatch` is that boundary's `componentDidCatch` — so an app with no
 * error component reports nothing, shows nothing of its own, and fails only this
 * file.
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

/**
 * The shell around the screen, as `routes/__root.tsx` arranges it. Mirrored
 * rather than imported: `rootRoute.addChildren` mutates the route it is called
 * on, and the app's own root is a module singleton the rest of the suite
 * renders.
 *
 * `dynamicTitle` because that is the case with something to prove — the shell
 * holds the route-change announcement until such a screen publishes a name, and
 * a screen that threw never will.
 */
function renderThrowingRoute({ arriveFromAnotherPage = false } = {}) {
  const rootRoute = createRootRoute({
    component: () => (
      <Shell>
        <div className="screen">
          <Outlet />
        </div>
      </Shell>
    ),
  });
  const startRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    staticData: { titleKey: "settings:title" },
    component: () => <Link to="/boom">go</Link>,
  });
  const boomRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/boom",
    staticData: { titleKey: "collections:title", dynamicTitle: true },
    component: ExplodingScreen,
  });
  const router = createAppRouter({
    routeTree: rootRoute.addChildren([startRoute, boomRoute]),
    history: createMemoryHistory({ initialEntries: [arriveFromAnotherPage ? "/" : "/boom"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("the app router's handling of a route render error", () => {
  it("reports the error, naming the component that threw", async () => {
    renderThrowingRoute();
    // Awaited, not asserted: the router resolves its matches in a microtask, so
    // nothing has rendered — and nothing has been reported — on the tick
    // `render` returns.
    await screen.findByRole("alert");

    const { context } = lastReport();
    expect(context.source).toBe("router");
    expect(context.componentStack).toEqual(expect.stringContaining("ExplodingScreen"));
  });

  it("tells the user what happened, in their own language", async () => {
    renderThrowingRoute();
    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("Your data is safe.");
  });

  /**
   * The state the app was in without this: the throw reached the router's own
   * global boundary (`Matches.js`), which passes no `errorComponent` and so
   * renders the library's built-in one — a red `<pre>` holding `error.message`,
   * open in dev and one "Show Error" button away in production
   * (`CatchBoundary.js`). A message may carry whatever the user typed, which is
   * why `SAFE_CONTEXT_KEYS` allowlists what a *report* may hold; putting it on
   * screen is the same leak with an audience.
   */
  it("puts nothing about what threw on screen", async () => {
    renderThrowingRoute();
    await screen.findByRole("alert");

    expect(document.body).not.toHaveTextContent("screen render boom");
    expect(screen.queryByRole("button", { name: /show error/i })).toBeNull();
  });

  /**
   * Both ways off the screen, and the shell still standing behind them — the
   * route's boundary replaces the screen, not the app.
   */
  it("leaves the user a way out, with the shell still around them", async () => {
    renderThrowingRoute();
    await screen.findByRole("alert");

    expect(screen.getByRole("link", { name: "Back to collections" })).toHaveAttribute("href", "/collections");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
  });

  /**
   * Focus, because the alert cannot follow this app's live-region rule: the whole
   * match subtree is replaced, so there is no persistent host to fill afterwards.
   * A crash also destroys whatever was focused — focus falls to <body> and the
   * tab order restarts at the top of the document (WCAG 2.4.3).
   */
  it("takes the focus the crash orphaned", async () => {
    renderThrowingRoute();
    const alert = await screen.findByRole("alert");

    expect(document.activeElement).toBe(alert);
  });

  /**
   * The shell holds the route-change announcement until a `dynamicTitle` route's
   * screen publishes a name (#309), and a screen that threw never publishes one.
   * `RouteError` publishes "unnamed" on its behalf, which releases the hold and
   * leaves the route's own title standing — so the page is announced, by the name
   * it still has, rather than silently.
   */
  it("does not leave a dynamically named page unannounced", async () => {
    renderThrowingRoute({ arriveFromAnotherPage: true });
    // A navigation, because that is the only thing the shell announces — it
    // deliberately says nothing about the page the user arrived on.
    fireEvent.click(await screen.findByRole("link", { name: "go" }));
    await screen.findByRole("alert");

    expect(document.title).toBe("Collections · MyCollections");
    await expect
      .poll(() => document.querySelector('.visually-hidden[aria-live="polite"]')?.textContent)
      .toBe("Collections · MyCollections");
  });
});
