import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CONTENT_LINK_ACTIVE_OPTIONS } from "../lib/links.js";
import { usePageTitle } from "../lib/page-title.js";
import { Icon } from "./Icon.js";
import { Mark } from "./Mark.js";

/**
 * The screen for an address that is not in the cabinet (#344).
 *
 * Rendered from two places, which is why it is a component and not markup
 * inside the route: the splat route in `routes/not-found.tsx` handles every URL
 * the router can match, and `defaultNotFoundComponent` in `router.ts` catches
 * the few it cannot (see that file). Before this existed, both paths rendered
 * the library's own `jsx("p", { children: "Not Found" })` — inside the shell, so
 * the app did not look broken, it looked empty.
 *
 * Calm, not alarmed. This takes no `role="alert"` and none of the `--danger`
 * ink: in this app the role *is* the danger treatment (`global.css`, pinned by
 * `styles/alerts.integration.test.ts`), and a wrong address is not a failure of
 * the app — nothing crashed, no request failed, and the user's collections are
 * exactly where they left them. It is the same distinction `FailureSurface` is
 * on the other side of, and the reason this shares its layout with
 * `EmptyState` rather than with the failure screens.
 *
 * It claims no focus either. A crash orphans focus in the same tick, which is
 * what `FailureSurface`'s `claimFocus` exists for; arriving at a wrong address
 * does not. The shell already moves focus to `<main>` when a navigation
 * unmounted whatever held it, and leaves it alone when it did not
 * (`Shell.tsx`) — which is the correct behavior here, and not this screen's to
 * second-guess.
 */
export function NotFoundScreen() {
  const { t } = useTranslation("common");

  /**
   * The route form of this screen is named by `staticData.titleKey`, and does
   * not need this. The `defaultNotFoundComponent` form has no route and so no
   * `staticData` at all — the shell would fall back to the bare app name and
   * the page would go unnamed, which is the WCAG 2.4.2 gap this issue is about.
   * Publishing the same words covers both: a published name wins over the
   * route's key, and on the route path the two are the same string, so it is
   * not a second answer.
   */
  usePageTitle({ status: "named", name: t("not_found_title") });

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
        {/* `activeOptions` so the way out does not claim to be where the user
            already is: on `/collections/<id>/nope` this link prefix-matches the
            address that failed, and said "current page" about the button they
            were about to press (#354). */}
        <Link to="/collections" className="touch-target button-primary" activeOptions={CONTENT_LINK_ACTIVE_OPTIONS}>
          <Icon name="back" />
          {t("not_found_back_to_collections")}
        </Link>
        {/* `.button-quiet` is the app's secondary skin (DESIGN.md, "Forms,
            buttons and status"); `.touch-target` is sizing only, so a link
            wearing it alone renders as a bare UA link beside a filled button. */}
        <Link to="/settings" className="touch-target button-quiet" activeOptions={CONTENT_LINK_ACTIVE_OPTIONS}>
          {t("not_found_go_to_settings")}
        </Link>
      </div>
    </div>
  );
}

/**
 * The "not filed here" mark: the app's own signature object — the three-drawer
 * flat file of the `logo` icon — with the drawer that was asked for missing
 * from it, an outline in the gap where a drawer front and its pull should be.
 *
 * Deliberately not `EmptyState`'s mark, which is a drawer pulled open and
 * empty: that one says the user has nothing filed yet, which on a 404 would be
 * a lie about their data. Both sit on the shared `Mark` canvas.
 */
function NotFoundMark() {
  return (
    <Mark className="not-found-mark">
      <rect x="14" y="4" width="44" height="56" rx="4" />
      <line x1="14" y1="22" x2="58" y2="22" />
      <line x1="14" y1="42" x2="58" y2="42" />
      <line x1="30" y1="13" x2="42" y2="13" />
      <line x1="30" y1="51" x2="42" y2="51" />
      {/* The drawer that is not there. `butt` caps rather than the inherited
          round ones: a round cap extends each dash by half the stroke width at
          both ends, so at 2px the "4 4" pattern paints 6 on and 2 off and the
          gap closes up into a fourth, solid drawer front. This is the one place
          in the app where a cap other than round is doing real work. */}
      <rect x="20" y="26" width="32" height="12" rx="2" strokeLinecap="butt" strokeDasharray="4 4" />
    </Mark>
  );
}
