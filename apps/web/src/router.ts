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
}
