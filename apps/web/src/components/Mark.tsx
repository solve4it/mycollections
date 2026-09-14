import type { ReactNode } from "react";

/**
 * The canvas the app's illustrations are drawn on (#344).
 *
 * The two marks — the empty state's open, empty drawer and the not-found
 * screen's missing one — are the app's exceptions to the icon rules in
 * `Icon.tsx`: they live on their own 72×64 canvas at 2px strokes, because
 * nothing else wants them at 1.25em. Everything *else* about them is the same
 * rule, so the wrapper is written once rather than copied: `fill="none"`,
 * `currentColor` only, round caps, `aria-hidden`.
 *
 * That is not tidiness for its own sake. The attributes are what make an
 * illustration take its surroundings' ink and invert with the theme for free,
 * and a second copy is a second place for one of them to go missing.
 *
 * `className` rather than a fixed class, because the marks are sized by the
 * surface they sit on; `stroke-linecap` and the rest inherit, so a shape that
 * needs different ones (the dashed drawer in `NotFoundScreen`) overrides them
 * on itself.
 */
export function Mark({ className, children }: { className: string; children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 72 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
