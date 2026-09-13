import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "../lib/page-title.js";

/**
 * The app's two failure screens (#319), sharing one surface and one set of
 * strings.
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
  children: ReactNode;
}

/**
 * The `<h1>` + explanation + controls block, with the focus half of its
 * announcement.
 *
 * `role="alert"` because that is how every failure in this app is written, the
 * danger treatment hangs off the role rather than a class (`global.css`,
 * `alerts.integration.test.ts`), and — the part that matters — an `alert` is
 * announced when it is *inserted*. A user agent fires an event on creation, so
 * unlike an `aria-live` region this one does not have to be persistent and
 * filled afterwards. #319 claimed it was an exception to that rule; it was never
 * subject to it (#347).
 *
 * So the role is the announcement, and the focus below is for two other things.
 * A crash destroys whatever was focused: focus falls to `<body>` and the tab
 * order restarts at the top of the document (WCAG 2.4.3), and where the crash
 * was a re-render rather than a navigation the shell's own recovery never runs,
 * because no pathname changed. And browsers suppress live-region events until
 * the document has loaded — which is exactly `AppErrorScreen` on a first paint,
 * the one case where the role alone would say nothing.
 *
 * Guarded on `document.activeElement` being `<body>` or nothing, the same guard
 * `Shell.tsx` uses: where focus survived — a nav link, the link that was clicked
 * — it is left where the user put it.
 *
 * Focus lands on the container, not the `<h1>`: the container is the alert, and
 * focusing something inside it makes VoiceOver read the title twice.
 */
function FailureSurface({ children }: FailureSurfaceProps) {
  const { t } = useTranslation("common");
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focused = document.activeElement;
    if (focused === null || focused === document.body) surfaceRef.current?.focus();
  }, []);

  return (
    <div className="failure-surface" role="alert" tabIndex={-1} ref={surfaceRef}>
      <h1>{t("error_title")}</h1>
      <p>{t("error_message")}</p>
      <div className="failure-actions">{children}</div>
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
    <FailureSurface>
      <Link to="/collections" className="touch-target">
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
      <FailureSurface>
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
