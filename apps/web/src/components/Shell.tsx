import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "./Icon.js";

const NAV_ITEM_DEFS: Array<{ to: "/collections" | "/settings"; labelKey: string; icon: IconName }> = [
  { to: "/collections", labelKey: "nav_collections", icon: "collections" },
  { to: "/settings", labelKey: "nav_settings", icon: "settings" },
];

interface ShellProps {
  children: ReactNode;
}

/**
 * The title key of the deepest matched route that declares one (#24).
 *
 * `select` returns a string rather than the match array so the subscription
 * compares by value: returning `state.matches` would re-render the whole shell
 * on every router state change, title or no title.
 *
 * Searched from the deepest match outwards, so a future child route can name
 * itself more precisely than its parent. `findLast` would say this in one line
 * but is ES2023, and this package targets ES2022 (tsconfig.json).
 */
function usePageTitleKey(): string | undefined {
  return useRouterState({
    select: (state) => {
      for (let index = state.matches.length - 1; index >= 0; index--) {
        const titleKey = state.matches[index]?.staticData.titleKey;
        if (titleKey) return titleKey;
      }
      return undefined;
    },
  });
}

export function Shell({ children }: ShellProps) {
  const { t } = useTranslation("common");
  const titleKey = usePageTitleKey();
  const [announcement, setAnnouncement] = useState("");

  // Every route is a page for WCAG 2.4.2, and index.html has one static <title>
  // for all of them. The keys are namespaced ("settings:title"), which i18next
  // resolves through any `t`. Depending on the built string rather than on the
  // key is what makes the title follow a language change.
  const pageTitle = titleKey ? t("page_title", { page: t(titleKey) }) : t("app_name");
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  /**
   * Nothing tells a screen reader that a client-side navigation happened: the
   * content is replaced with no page load to announce, so the user is left on a
   * page they have no reason to think has changed.
   *
   * The region below is in the document from the start and empty; this fills it
   * afterwards, which is the part that matters. A live region inserted with its
   * text already inside is announced by VoiceOver but usually not by NVDA or
   * JAWS.
   *
   * Guarded on the previous key rather than an `isFirstRender` ref, which would
   * not survive StrictMode: the simulated remount preserves refs, so the second
   * pass would see `false` and announce the page the user just loaded. Comparing
   * values is idempotent — the replay finds them equal and returns.
   *
   * The key, not the pathname: `location.pathname` updates a render before the
   * matches resolve, so a pathname guard announces the page being left. And not
   * the translated title either, which would announce the current page again
   * every time the language changes.
   *
   * The cost is that moving between two routes that share a key — one collection
   * to another — announces nothing. It would have announced the same words
   * either way, and an unchanged live region does not re-fire; the fix is a
   * title carrying the collection's own name, which is a follow-up on #24.
   */
  const previousTitleKey = useRef(titleKey);
  useEffect(() => {
    if (previousTitleKey.current === titleKey) return;
    previousTitleKey.current = titleKey;
    setAnnouncement(pageTitle);
  }, [titleKey, pageTitle]);

  /**
   * __root.tsx keys the screen wrapper by pathname so the entrance animation
   * replays, which means every navigation unmounts the whole content subtree.
   * Whatever was focused inside it — a collection card, the back link, a form
   * control — goes with it, and focus falls to <body>: the tab sequence restarts
   * at the top of the document and a screen reader's virtual cursor drops to the
   * start of the page (WCAG 2.4.3).
   *
   * Guarded twice, and both guards matter. The nav sits outside that wrapper, so
   * a user moving through it keeps focus across the navigation; pulling focus to
   * <main> anyway would cost them their place in the nav on every click, and
   * would land them on a container that at that moment usually holds a skeleton.
   * And on first load nothing has been focused yet — activeElement is <body>
   * without anything having been taken away — so the pathname guard is what
   * stops the app opening with focus already inside the content, which would put
   * the skip link and the nav behind the user's first Tab.
   */
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const mainRef = useRef<HTMLElement>(null);
  const focusedPathname = useRef(pathname);
  useEffect(() => {
    if (focusedPathname.current === pathname) return;
    focusedPathname.current = pathname;
    const focused = document.activeElement;
    if (focused === null || focused === document.body) mainRef.current?.focus();
  }, [pathname]);

  return (
    <>
      <a href="#main-content" className="skip-link">
        {t("skip_to_main")}
      </a>
      {/* Outside the shell and outside the pathname-keyed wrapper in __root.tsx:
          a region that is torn down and rebuilt on every navigation is a region
          inserted with its text already in it, which is the bug above. No
          role="status" — `aria-live` alone is the whole contract here, and the
          role would make every page-level getByRole("status") in the suite
          ambiguous with a region that is not about the page's status. */}
      <div aria-live="polite" aria-atomic="true" className="visually-hidden">
        {announcement}
      </div>
      <div className="shell">
        <nav className="shell-sidebar" aria-label={t("aria_main_nav")}>
          <div className="sidebar-logo">
            <Icon name="logo" className="logo-mark" />
            {t("app_name")}
          </div>
          <div className="sidebar-nav">
            {NAV_ITEM_DEFS.map(({ to, labelKey, icon }) => (
              <Link key={to} to={to} className="touch-target" activeProps={{ "data-status": "active" }}>
                <Icon name={icon} />
                {t(labelKey)}
              </Link>
            ))}
          </div>
          {/* The version is build-time injected (see vite.config.ts), so it is
              interpolated rather than translated; only the label is a key. */}
          <div className="sidebar-foot">{t("local_first_footer", { version: __APP_VERSION__ })}</div>
        </nav>

        {/* tabIndex={-1} is what makes the skip link work: Safari and Firefox
            scroll to a fragment target but leave focus behind unless the target
            can hold it, so without this the link moves the viewport and nothing
            else (WCAG 2.4.1). -1 keeps it out of the tab order. */}
        <main className="shell-main" id="main-content" tabIndex={-1} ref={mainRef}>
          {children}
        </main>

        <nav className="shell-bottom-nav" aria-label={t("aria_bottom_nav")}>
          {NAV_ITEM_DEFS.map(({ to, labelKey, icon }) => (
            <Link key={to} to={to} className="bottom-nav-item touch-target" activeProps={{ "data-status": "active" }}>
              <Icon name={icon} />
              <span>{t(labelKey)}</span>
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
