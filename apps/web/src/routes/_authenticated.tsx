import { createRoute, redirect } from "@tanstack/react-router";
import { getToken } from "../lib/api-client.js";
import { rootRoute } from "./__root.js";

/**
 * The token guard, once (#420): every screen that needs a token is a child of
 * this route, and `/setup` and the not-found splat are the only screens that
 * are not.
 *
 * Pathless — an `id` and no `path` — so it adds no URL segment and its children
 * keep the addresses they had. No component either, so it renders its child
 * through the router's default `<Outlet />` and adds nothing to the DOM: the
 * shell, the pathname-keyed screen wrapper and every match-derived value the
 * shell reads come from the root and the leaf route as before.
 *
 * It replaces a `beforeLoad` copied into each screen, which is how `/settings`
 * came to have none and render with every query unauthenticated (#371). A
 * screen is now guarded by where it sits in `routeTree.ts`; putting one outside
 * this route is a decision `routeTree.test.ts` makes someone write down.
 *
 * `getToken()` reads the session copy before storage (#279), the same check
 * each screen made, so what counts as connected has not changed.
 */
export const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: "/setup" });
  },
});
