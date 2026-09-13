import { createRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon.js";
import { rootRoute } from "./__root.js";

/**
 * The page for an address that is not in the cabinet (#344).
 *
 * A **route**, not `defaultNotFoundComponent`, and the difference is the whole
 * point. Only a route carries `staticData`, and `staticData.titleKey` is what
 * `Shell.tsx` turns into the document title and into the route-change
 * announcement — so a component-shaped 404 leaves the title saying whatever the
 * previous screen was called (WCAG 2.4.2) and tells a screen-reader user who
 * mistyped a URL nothing at all.
 *
 * It is also why the router's development warning about "TanStack Router's
 * overly generic defaultNotFoundComponent" (`renderRouteNotFound.js:21`) is
 * gone rather than merely silenced: an unknown URL now *matches* a route, so no
 * notFound error is raised and that code path is never entered. Before this,
 * what rendered here was the library's own `jsx("p", { children: "Not Found" })`
 * — inside the shell, so the app looked not broken but empty.
 *
 * `path: "$"` ranks below every static and dynamic route, so it catches only
 * what nothing else claims: `/collections`, `/collections/new`,
 * `/collections/<id>` and `/collections/<id>/edit` all still reach their own
 * screens, and `/collections/<id>/nope` reaches this one
 * (`not-found.test.tsx`).
 *
 * No `beforeLoad` token guard, unlike `/collections`. A wrong address is wrong
 * whether or not the app has been connected yet, and redirecting it to `/setup`
 * would answer a question the user did not ask. The way out still works: the
 * link below lands on `/collections`, which is where the guard sends an
 * unconnected user to `/setup`.
 */
export const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  staticData: { titleKey: "common:not_found_title" },
  component: NotFoundPage,
});

/**
 * The "not filed here" mark: the cabinet, with the drawer that was asked for
 * missing from it — a dashed outline in the gap where a drawer front and its
 * pull would be. Deliberately not `EmptyState`'s mark, which is a drawer pulled
 * open and empty: that one says the user has nothing in this collection yet,
 * which on a 404 would be a lie about their data.
 *
 * The second illustration in the app, and it follows the same rules as the
 * first (DESIGN.md, "Waiting and emptiness"): its own 72×64 canvas at 2px
 * strokes rather than a member of `ICON_NAMES`, `fill="none"`, `currentColor`
 * only, round caps, `aria-hidden` — so it takes the screen's muted ink, inverts
 * with the theme for free, and survives forced-colors mode.
 */
function NotFoundMark() {
  return (
    <svg
      className="not-found-mark"
      viewBox="0 0 72 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="14" y="4" width="44" height="56" rx="4" />
      <line x1="14" y1="22" x2="58" y2="22" />
      <line x1="14" y1="42" x2="58" y2="42" />
      <line x1="30" y1="13" x2="42" y2="13" />
      <line x1="30" y1="51" x2="42" y2="51" />
      {/* The drawer that is not there. Dashes are the non-color cue: the gap
          has to read as missing in forced-colors mode and without color too. */}
      <rect x="20" y="26" width="32" height="12" rx="2" strokeDasharray="4 4" />
    </svg>
  );
}

/**
 * Calm, not alarmed. This screen takes no `role="alert"` and none of the
 * `--danger` ink: in this app the role *is* the danger treatment
 * (`styles/alerts.integration.test.ts`), and a wrong address is not a failure
 * of the app — nothing crashed, no request failed, and the user's collections
 * are exactly where they left them. It is the same distinction `FailureSurface`
 * is on the other side of.
 *
 * Nothing here announces itself either. The shell's announcer already speaks
 * for every route from `titleKey`, so a live region of this screen's own would
 * say the same words twice.
 */
function NotFoundPage() {
  const { t } = useTranslation("common");

  return (
    <div className="not-found">
      <NotFoundMark />
      <h1>{t("not_found_title")}</h1>
      <p>{t("not_found_description")}</p>
      <div className="not-found-actions">
        {/* The dashboard and "collections" are one route in this app: `/`
            redirects to `/collections`, so a second link to it would be the
            same link twice. Settings is the other place worth reaching from
            here — it is where a wrong address most often follows a wrong
            server or a stale token. */}
        <Link to="/collections" className="touch-target button-primary">
          <Icon name="collections" />
          {t("not_found_back_to_collections")}
        </Link>
        <Link to="/settings" className="touch-target">
          {t("not_found_go_to_settings")}
        </Link>
      </div>
    </div>
  );
}
