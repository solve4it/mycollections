import { type AnyRoute, createRouter, type RouterHistory } from "@tanstack/react-router";
import { onRouterCatch } from "./lib/error-reporter.js";
import { routeTree } from "./routeTree.js";

interface AppRouterOverrides {
  routeTree?: AnyRoute;
  history?: RouterHistory;
}

// The router wraps every route in its own catch boundary, so route render
// errors never reach a boundary around <RouterProvider>; defaultOnCatch is
// the hook that sees them.
export function createAppRouter({ routeTree: tree = routeTree, history }: AppRouterOverrides = {}) {
  return createRouter({ routeTree: tree, defaultOnCatch: onRouterCatch, ...(history ? { history } : {}) });
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
