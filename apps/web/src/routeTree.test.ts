import type { AnyRoute } from "@tanstack/react-router";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import { clearToken, setToken } from "./lib/api-client.js";
import { authenticatedRoute } from "./routes/_authenticated.js";
import { routeTree } from "./routeTree.js";

/**
 * Where the token guard is (#420). One guard, on a pathless layout route, and
 * every screen that needs a token is under it — so a screen is guarded or not by
 * where it sits in the tree, and leaving one unguarded is a decision someone
 * has to make by putting it outside, which these tests then name.
 *
 * #371 is what this replaces: five copies of the same `beforeLoad`, and
 * `/settings`, which had none, rendered with every query unauthenticated.
 */

/** Every route in the tree, depth first, with the ancestors it sits under. */
function walk(route: AnyRoute, ancestors: AnyRoute[] = []): Array<{ route: AnyRoute; ancestors: AnyRoute[] }> {
  const children = (route.children ?? []) as AnyRoute[];
  return children.flatMap((child) => [{ route: child, ancestors }, ...walk(child, [...ancestors, child])]);
}

// `fullPath` is filled in when a router is built from the tree, not before.
createRouter({ routeTree });

/**
 * A route that renders or fetches anything: a component, a loader, or a lazy
 * module. A future screen that only declares a loader or `lazy` is still a
 * screen, and must not slip past the coverage check below.
 */
const screens = walk(routeTree).filter(
  ({ route }) =>
    route.options.component !== undefined ||
    route.options.loader !== undefined ||
    (route as { lazyFn?: unknown }).lazyFn !== undefined,
);
const guarded = (ancestors: AnyRoute[]) => ancestors.includes(authenticatedRoute);

afterEach(() => {
  clearToken();
  localStorage.clear();
});

describe("the token guard (#420)", () => {
  it("covers every screen except the two that must work without a token", () => {
    expect(screens.length, "the walk should reach nested screens").toBeGreaterThan(5);
    const outside = screens.filter(({ ancestors }) => !guarded(ancestors)).map(({ route }) => route.fullPath);
    // /setup is where a visitor without a token is sent, and the 404 has to
    // render for any address at all. Adding a third here is a deliberate edit.
    expect(outside.sort()).toEqual(["/$", "/setup"]);
  });

  it("is the only token check: no screen under it carries a guard of its own", () => {
    const ownGuards = screens
      .filter(({ ancestors, route }) => guarded(ancestors) && route.options.beforeLoad !== undefined)
      .map(({ route }) => route.fullPath);
    expect(ownGuards).toEqual([]);
  });

  /**
   * The behavior, through the real router rather than by calling the guard: a
   * pathless parent's `beforeLoad` has to run for every child on a fresh load,
   * which is the property the whole refactor rests on.
   */
  const GUARDED_PATHS = ["/collections", "/collections/new", "/collections/abc", "/collections/abc/edit", "/settings"];

  for (const path of GUARDED_PATHS) {
    it(`sends ${path} to /setup without a token, and lets it through with one`, async () => {
      const without = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
      await without.load();
      expect(without.state.location.pathname).toBe("/setup");

      setToken("test-token");
      const withToken = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
      await withToken.load();
      expect(withToken.state.location.pathname).toBe(path);
    });
  }

  /**
   * The property a layout guard is usually assumed not to have: it runs again
   * on a client navigation between two of its own children, rather than only
   * when the layout is first entered. A token cleared mid-session — another
   * tab's Disconnect, or storage evicted — must stop the next navigation.
   */
  it("runs again on a client navigation between two guarded screens, after the token is gone", async () => {
    setToken("test-token");
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/collections"] }) });
    await router.load();
    expect(router.state.location.pathname).toBe("/collections");

    clearToken();
    localStorage.clear();
    await router.navigate({ to: "/settings" });
    await router.load();
    expect(router.state.location.pathname).toBe("/setup");
  });

  it("leaves the screens outside it reachable without a token", async () => {
    for (const path of ["/setup", "/no/such/page"]) {
      const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
      await router.load();
      expect(router.state.location.pathname).toBe(path);
    }
  });
});
