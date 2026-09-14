import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CONTENT_LINK_ACTIVE_OPTIONS } from "../lib/links.js";
import { usePageTitle } from "../lib/page-title.js";

/**
 * The app's two crash screens (#319) and the surface all five of its failure
 * screens share (#349).
 *
 * `RouteError` replaces the screen inside the shell; `AppErrorScreen` replaces
 * everything, and is what both the root route's boundary and the top-level
 * `<ErrorBoundary>` fall back to. The difference is only what is left standing
 * around them, which is why the surface itself is written once.
 *
 * Neither shows `error.message` or the stack. A message may carry whatever the
 * user typed — the reason `SAFE_CONTEXT_KEYS` allowlists what a *report* may
 * hold (`packages/core/src/error-reporter.ts`) — and putting it on screen is the
 * same leak with an audience. TanStack's own `ErrorComponent`, which is what
 * rendered here before this landed, does exactly that: a red `<pre>` holding the
 * message, expanded in dev and one "Show Error" button away in production.
 */

interface FailureSurfaceProps {
  /** Names the failure. Already translated — see the note on the component. */
  title: string;
  /** The reassuring half, under the title. Already translated. */
  description: string;
  /**
   * Take focus on mount if the surface arrives to find none. True for a crash,
   * which orphans focus in the same tick; false for a load failure, which does
   * not. See the component's note.
   */
  claimFocus?: boolean;
  /** The controls under the copy. Omitted where the screen has nothing to offer. */
  children?: ReactNode;
}

/**
 * The `<h1>` + explanation + controls block behind every full-page failure in
 * the app: the two crash screens below, and the three route-level load failures
 * that each hand-rolled this markup until #349. Two of those three bugs fixed in
 * #347 were namespace mistakes at those call sites, which is why the copy is
 * taken as two already-translated strings rather than as keys — a wrong pair is
 * then visible as an argument, instead of hiding behind a bare `t("error_title")`
 * that reads identically in every namespace. It is also what keeps the `t()`
 * calls in the route files, where `locale-keys.integration.test.ts` can still
 * bind them to a namespace.
 *
 * `role="alert"` because that is how every failure in this app is written, the
 * danger treatment hangs off the role rather than a class (`global.css`,
 * `alerts.integration.test.ts`), and — the part that matters — an `alert` is
 * announced when it is *inserted*. A user agent fires an event on creation, so
 * unlike an `aria-live` region this one does not have to be persistent and
 * filled afterwards. #319 claimed it was an exception to that rule; it was never
 * subject to it (#347).
 *
 * So the role is the announcement, and `claimFocus` is for two other things. A
 * crash destroys whatever was focused: focus falls to `<body>` and the tab order
 * restarts at the top of the document (WCAG 2.4.3), and where the crash was a
 * re-render rather than a navigation the shell's own recovery never runs,
 * because no pathname changed. And browsers suppress live-region events until
 * the document has loaded — which is exactly `AppErrorScreen` on a first paint,
 * the one case where the role alone would say nothing.
 *
 * It is a prop, and off by default, because the load failures are the opposite
 * case: they arrive seconds after the navigation, once React Query's retries are
 * exhausted, with focus wherever the user left it. Moving it then is a hazard
 * rather than a help, and the role has already announced them. A screen that
 * forgets the prop therefore degrades to "announced but does not move focus",
 * which is the safe way round.
 *
 * The claim is guarded on `document.activeElement` being `<body>` or nothing,
 * the same guard `Shell.tsx` uses: where focus survived — a nav link, the link
 * that was clicked — it is left where the user put it. And it lands on the
 * container, not the `<h1>`: the container is the alert, and focusing something
 * inside it makes VoiceOver read the title twice.
 */
export function FailureSurface({ title, description, claimFocus = false, children }: FailureSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!claimFocus) return;
    const focused = document.activeElement;
    if (focused === null || focused === document.body) surfaceRef.current?.focus();
  }, [claimFocus]);

  return (
    <div
      className="failure-surface"
      role="alert"
      // Only focusable where focus is actually claimed: a screen nothing ever
      // focuses should not carry a programmatic focus target.
      tabIndex={claimFocus ? -1 : undefined}
      ref={surfaceRef}
    >
      <h1>{title}</h1>
      <p>{description}</p>
      {/* Omitted rather than rendered empty: the three load failures offer no
          controls, and an empty flex container is a node in the accessibility
          tree that says nothing. `EmptyState` renders its children the same way. */}
      {children && <div className="failure-actions">{children}</div>}
    </div>
  );
}

/**
 * The router's `defaultErrorComponent` — the screen a route render error leaves
 * behind, inside the shell that survived it.
 *
 * Takes no `reset`. The boundary's `reset` only clears its own state
 * (`CatchBoundary.js`), so the same match re-mounts, the same deterministic bug
 * throws again, and the only visible result is a second error report; and
 * `router.invalidate()` rebuilds every committed match, which resets the
 * boundary once per store update on the way through. Reload is the control that
 * actually clears the module state a crash may have left behind, and is what the
 * copy already promises. The link out is the cheaper half of the same offer.
 *
 * Publishes an *unnamed* page rather than a title of its own. The shell holds
 * the route-change announcement until a `dynamicTitle` route's screen has
 * published something (`Shell.tsx`), and a screen that threw never will — so
 * without this, arriving at a crashed `/collections/$id` announces nothing at
 * all. "unnamed" releases that hold and leaves the route's own `titleKey`
 * standing, which stays correct through the crash and after a recovery; a named
 * error title would outlive the error, since the shell only resets a published
 * name when the page changes.
 */
export function RouteError() {
  const { t } = useTranslation("common");
  usePageTitle({ status: "unnamed" });

  return (
    <FailureSurface title={t("error_title")} description={t("error_message")} claimFocus>
      {/* A way out is an action, not a statement about where the user is: a
          crash inside `/collections` made this link prefix-active, so it
          announced itself as the current page (#354). */}
      <Link to="/collections" className="touch-target" activeOptions={CONTENT_LINK_ACTIVE_OPTIONS}>
        {t("error_back_to_collections")}
      </Link>
      <ReloadButton />
    </FailureSurface>
  );
}

/**
 * The last resort: the root route's `errorComponent`, and the fallback of the
 * `<ErrorBoundary>` around `<RouterProvider>`.
 *
 * Both render with no shell — the root boundary wraps the root component, so a
 * throw in `Root` or `Shell` takes the nav, the `<main>` landmark and the
 * document title with it. This brings its own `<main id="main-content">`
 * (without which axe's `region` and `landmark-one-main` both fail, and the skip
 * link's target is gone) and titles the document itself, since the shell that
 * normally does that is what broke.
 *
 * No link to /collections: routing is not known to work from here.
 */
export function AppErrorScreen() {
  const { t } = useTranslation("common");
  const title = t("page_title", { page: t("error_title") });

  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <main className="shell-main" id="main-content">
      <FailureSurface title={t("error_title")} description={t("error_message")} claimFocus>
        <ReloadButton />
      </FailureSurface>
    </main>
  );
}

function ReloadButton() {
  const { t } = useTranslation("common");
  return (
    <button type="button" className="touch-target" onClick={() => window.location.reload()}>
      {t("error_reload")}
    </button>
  );
}
