import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { to: "/collections" as const, label: "Collections", icon: "⊞" },
  { to: "/settings" as const, label: "Settings", icon: "⚙" },
] as const;

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div className="shell">
        <nav className="shell-sidebar" aria-label="Main navigation">
          <div className="sidebar-logo">MyCollections</div>
          <div className="sidebar-nav">
            {NAV_ITEMS.map(({ to, label, icon }) => (
              <Link key={to} to={to} className="touch-target" activeProps={{ "data-status": "active" }}>
                <span aria-hidden="true">{icon}</span>
                {label}
              </Link>
            ))}
          </div>
        </nav>

        <main className="shell-main" id="main-content">
          {children}
        </main>

        <nav className="shell-bottom-nav" aria-label="Bottom navigation">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <Link key={to} to={to} className="bottom-nav-item touch-target" activeProps={{ "data-status": "active" }}>
              <span aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
