import { createRoute } from "@tanstack/react-router";
import { NotFoundScreen } from "../components/NotFoundScreen.js";
import { rootRoute } from "./__root.js";

/**
 * The route for an address that is not in the cabinet (#344).
 *
 * A **route**, not only `defaultNotFoundComponent`, and the difference is the
 * whole point. Only a route carries `staticData`, and `staticData.titleKey` is
 * what `Shell.tsx` turns into the document title and into the route-change
 * announcement. A component-shaped 404 has neither, so the page is named by the
 * bare app name and announced as that — which is the WCAG 2.4.2 gap this issue
 * is about. (The screen publishes its own name through `usePageTitle` as well,
 * which is what rescues the `defaultNotFoundComponent` path in `router.ts`; the
 * route's key is what names this one before any of that runs, and if i18n has
 * not loaded.)
 *
 * `path: "$"` ranks below every static and dynamic route, so it catches only
 * what nothing else claims: `/collections`, `/collections/new`,
 * `/collections/<id>` and `/collections/<id>/edit` all still reach their own
 * screens, and `/collections/<id>/nope` reaches this one. Pinned URL by URL in
 * `not-found.test.tsx`, because a splat that outranked a real route would
 * replace a working screen and no test of the 404 itself would notice.
 *
 * It does not catch everything, which is why `router.ts` also configures
 * `defaultNotFoundComponent`: a URL the matcher cannot decode (`/%`) throws a
 * `URIError` inside `findRouteMatch` and never reaches ranking at all.
 *
 * No `beforeLoad` token guard, unlike `/collections`. A wrong address is wrong
 * whether or not the app has been connected yet, and redirecting it to `/setup`
 * would answer a question the user did not ask. The way out still works: the
 * link on the screen lands on `/collections`, which is where the guard sends an
 * unconnected user on to `/setup`.
 */
export const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  staticData: { titleKey: "common:not_found_title", notFound: true },
  component: NotFoundScreen,
});
