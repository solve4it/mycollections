import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "./Icon.js";

const NAV_ITEM_DEFS: Array<{ to: "/collections" | "/settings"; labelKey: string; icon: IconName }> = [
  { to: "/collections", labelKey: "nav_collections", icon: "collections" },
  { to: "/settings", labelKey: "nav_settings", icon: "settings" },
];

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const { t } = useTranslation("common");

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
