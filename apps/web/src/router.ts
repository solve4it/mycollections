import { type AnyRoute, createRouter, type RouterHistory } from "@tanstack/react-router";
import { RouteError } from "./components/ErrorScreen.js";
import { onRouterCatch } from "./lib/error-reporter.js";
import { routeTree } from "./routeTree.js";

interface AppRouterOverrides {
  routeTree?: AnyRoute;
  history?: RouterHistory;
}

/**
 * The router, and the seam that lets a test substitute the route tree while
 * keeping every option that decides what happens to a throw (#319).
 *
 * `defaultErrorComponent` is not decoration, and pairing it with
 * `defaultOnCatch` is not belt-and-braces: TanStack mounts a route's catch
 * boundary only where an error component resolves for that match
 * (`Match.js` — `routeErrorComponent ? CatchBoundary : SafeFragment`), and
 * `defaultOnCatch` *is* that boundary's `componentDidCatch`. Configure only the
 * handler, as this app did until #319, and it can never be called: the throw
 * passes every route to the router's own global boundary, which reports nothing
 * and renders the library's built-in error UI — `error.message` in a red `<pre>`.
 *
 * Route render errors therefore never reach the `<ErrorBoundary>` around
 * `<RouterProvider>`; the root route's own `errorComponent` (routes/__root.tsx)
 * is what catches a throw in the shell itself.
 */
export function createAppRouter({ routeTree: tree = routeTree, history }: AppRouterOverrides = {}) {
  return createRouter({
    routeTree: tree,
    defaultOnCatch: onRouterCatch,
    defaultErrorComponent: RouteError,
    ...(history ? { history } : {}),
  });
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }

  /**
   * What a route calls itself (#24). Every SPA view is a page for WCAG 2.4.2, so
   * each route names itself here and the Shell turns that into the document
   * title and the route-change announcement.
   *
   * A translation key rather than a string: titles are user-visible copy, and
   * `staticData` is read outside React, where `useTranslation` is unavailable.
   * Optional in the type because the redirect-only index route renders nothing;
   * `Shell.navigation.test.tsx` requires one of every route that has a component.
   */
  interface StaticDataRouteOption {
    titleKey?: string;
    /**
     * This route's screen publishes a better title of its own through
     * `usePageTitle` — the collection's name rather than "Collection" (#309) —
     * and `titleKey` is the stand-in until it arrives.
     *
     * Declared on the route rather than inferred from the screen because the
     * shell has to know it in the same commit as the route change: a screen can
     * only report upward from an effect, and by then the shell has already
     * decided whether to announce. Silence from a screen that has not rendered
     * yet is indistinguishable from a screen with nothing to add, so this flag
     * is what says which of the two it is.
     */
    dynamicTitle?: boolean;
  }
}
