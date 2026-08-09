import type { ReactElement } from "react";

/**
 * Hand-rolled inline SVG icon set for the "Cabinet & Paper" direction (#221):
 * one 24px grid, 1.5px strokes, round caps, `currentColor` only. Inline rather
 * than a sprite or a dependency so icons inherit color and font size wherever
 * they land, and offline/PWA never has an icon request to make.
 *
 * Icons are decorative by default and hidden from assistive technology — the
 * surrounding link, button, or label carries the accessible name. Pass `label`
 * only when the icon IS the information (a boolean cell, say), never to
 * duplicate adjacent text.
 */
export const ICON_NAMES = [
  "collections",
  "settings",
  "add",
  "back",
  "edit",
  "delete",
  "import",
  "export",
  "logo",
  "check",
  "cross",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** The drawer/tray base shared by import and export. */
const TRAY = <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />;

const SHAPES: Record<IconName, ReactElement> = {
  // Four drawer fronts: the catalog, seen head-on.
  collections: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  // Sliders, not a gear: reads at 16px, where gear teeth turn to mud.
  settings: (
    <>
      <line x1="4" y1="8" x2="20" y2="8" />
      <circle cx="14.5" cy="8" r="2.25" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9.5" cy="16" r="2.25" />
    </>
  ),
  add: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  back: (
    <>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="11 6 5 12 11 18" />
    </>
  ),
  edit: <path d="M16.5 4.5a2.12 2.12 0 0 1 3 3L7 20l-4 1 1-4 12.5-12.5z" />,
  delete: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <path d="M9.5 7V5A1.5 1.5 0 0 1 11 3.5h2A1.5 1.5 0 0 1 14.5 5v2" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  ),
  // The arrow follows the file, not the data: import lifts a chosen file up out
  // of the device, export writes a backup down onto it. Matches the copy on both
  // controls ("Download all your collections…") and the browser's own download UI.
  import: (
    <>
      <line x1="12" y1="15" x2="12" y2="4" />
      <polyline points="8 8 12 4 16 8" />
      {TRAY}
    </>
  ),
  export: (
    <>
      <line x1="12" y1="3" x2="12" y2="14" />
      <polyline points="8 10 12 14 16 10" />
      {TRAY}
    </>
  ),
  // The drawer mark: a three-drawer flat file, the app's signature object.
  logo: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="9.3" x2="21" y2="9.3" />
      <line x1="3" y1="14.7" x2="21" y2="14.7" />
      <line x1="10" y1="6.7" x2="14" y2="6.7" />
      <line x1="10" y1="12" x2="14" y2="12" />
      <line x1="10" y1="17.3" x2="14" y2="17.3" />
    </>
  ),
  check: <polyline points="5 12.5 10 17.5 19 7" />,
  cross: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  /** Accessible name. Omit (the default) for decorative icons next to text. */
  label?: string;
  className?: string;
}

export function Icon({ name, label, className }: IconProps) {
  // The two roles are written out rather than spread so the a11y lint can see
  // that a labelled icon really does carry role="img" + aria-label.
  const shared = {
    className: className ? `icon ${className}` : "icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    focusable: "false",
  } as const;

  if (label === undefined) {
    return (
      <svg {...shared} aria-hidden="true">
        {SHAPES[name]}
      </svg>
    );
  }

  return (
    <svg {...shared} role="img" aria-label={label}>
      {SHAPES[name]}
    </svg>
  );
}
