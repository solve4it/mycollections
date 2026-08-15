import type { ReactNode } from "react";

/**
 * The "cabinet is empty" state (#225): the drawer mark with a drawer pulled
 * open, a plain-verb title, an explanation, and — where the screen has one — the
 * action that fills it.
 *
 * The illustration is a larger cousin of the `logo` icon rather than a member of
 * the icon set: it is drawn on its own canvas at an illustrative size, and
 * nothing else in the app wants it at 1.25em. It follows the same rules as the
 * icons otherwise — one stroke weight, round caps, `currentColor` only — so it
 * takes the empty state's muted ink and inverts with the theme for free.
 */

/**
 * A two-drawer cabinet with the bottom drawer pulled out and nothing in it. The
 * open drawer is drawn as a front face plus the top edge behind it, which is
 * what makes it read as open rather than as a third closed drawer.
 */
function EmptyMark() {
  return (
    <svg
      className="empty-mark"
      viewBox="0 0 72 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="12" y="6" width="44" height="30" rx="4" />
      <line x1="12" y1="21" x2="56" y2="21" />
      <line x1="28" y1="13.5" x2="40" y2="13.5" />
      <line x1="28" y1="28.5" x2="40" y2="28.5" />
      <path d="M6 42h56v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      <path d="M6 42l6-6h56l-6 6" />
      <line x1="26" y1="50" x2="42" y2="50" />
    </svg>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  /**
   * `"h1"` when the empty state *is* the page (the dashboard with no
   * collections, which then owns the page's only heading). Left at the default
   * `"p"` inside a region that already sits under headings — the items list —
   * where a third heading would claim an outline level it does not own.
   */
  titleAs?: "h1" | "p";
  /** The action that fills the cabinet, where the screen has one. */
  children?: ReactNode;
}

export function EmptyState({ title, description, titleAs: Title = "p", children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <EmptyMark />
      <Title className="empty-state-title">{title}</Title>
      <p>{description}</p>
      {children}
    </div>
  );
}
