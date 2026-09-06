import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
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

  // Every route is a page for WCAG 2.4.2, and index.html has one static <title>
  // for all of them. The keys are namespaced ("settings:title"), which i18next
  // resolves through any `t`. Depending on the built string rather than on the
  // key is what makes the title follow a language change.
  const pageTitle = titleKey ? t("page_title", { page: t(titleKey) }) : t("app_name");
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  return (
    <>
      <a href="#main-content" className="skip-link">
        {t("skip_to_main")}
      </a>
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
        <main className="shell-main" id="main-content" tabIndex={-1}>
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
