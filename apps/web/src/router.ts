import { createRouter } from "@tanstack/react-router";
import { onRouterCatch } from "./lib/error-reporter.js";
import { routeTree } from "./routeTree.js";

// The router wraps every route in its own catch boundary, so route render
// errors never reach a boundary around <RouterProvider>; defaultOnCatch is
// the hook that sees them.
export const router = createRouter({ routeTree, defaultOnCatch: onRouterCatch });

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
  }
}
