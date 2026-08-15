import type { CSSProperties, ReactElement } from "react";
import { type CoverArchetype, coverFor } from "../lib/cover.js";

/**
 * The generated cover for a collection (#223) — the signature element of the
 * "Cabinet & Paper" direction. Six flat SVG patterns of the things people
 * collect, picked and tinted by `coverFor(collection.id)`.
 *
 * Color is deliberately not decided here: the component only sets `--cover-hue`
 * and the shapes reference `--cover-bg` / `--cover-ink` / `--cover-accent`, which
 * global.css derives per theme. So a cover is the same pattern in light and dark
 * and the palette stays in the stylesheet with every other color decision.
 *
 * Covers are decorative (`aria-hidden`) and, per DESIGN.md, exempt from contrast
 * requirements — the card's <h2> is the accessible content. When real imagery
 * lands (#37) the pattern becomes the fallback.
 */

/** The pattern canvas. 5:3, matching the aspect-ratio the card reserves. */
const WIDTH = 300;
const HEIGHT = 180;

const BACKGROUND = <rect width={WIDTH} height={HEIGHT} fill="var(--cover-bg)" />;

/** Vinyl: concentric grooves around a spindle. */
function rings(): ReactElement {
  return (
    <g stroke="var(--cover-ink)" fill="none" strokeWidth="2.5">
      {[18, 30, 42, 54, 66, 78].map((r) => (
        <circle key={r} cx={150} cy={90} r={r} />
      ))}
      <circle cx={150} cy={90} r={7} fill="var(--cover-ink)" stroke="none" />
    </g>
  );
}

/** Brick studs: the grid you see looking straight down at a plate. */
function studs(): ReactElement {
  const columns = [40, 84, 128, 172, 216, 260];
  const rows = [42, 90, 138];
  return (
    <g>
      {rows.flatMap((cy) =>
        columns.map((cx) => (
          <g key={`${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r={17} fill="var(--cover-accent)" />
            <circle cx={cx} cy={cy} r={8} fill="none" stroke="var(--cover-ink)" strokeWidth="2" />
          </g>
        )),
      )}
    </g>
  );
}

/** A fanned hand of cards, pivoting off the bottom edge. */
function fan(): ReactElement {
  return (
    <g fill="var(--cover-accent)" stroke="var(--cover-ink)" strokeWidth="2">
      {[-54, -36, -18, 0, 18, 36, 54].map((angle) => (
        <rect key={angle} x={132} y={34} width={36} height={130} rx={4} transform={`rotate(${angle} 150 186)`} />
      ))}
    </g>
  );
}

/** Watch dials: three faces, each hand at its own angle. */
function dials(): ReactElement {
  const faces: Array<[number, number]> = [
    [70, -40],
    [150, 65],
    [230, 160],
  ];
  return (
    <g stroke="var(--cover-ink)" fill="none" strokeWidth="2.5">
      {faces.map(([cx, angle]) => (
        <g key={cx}>
          <circle cx={cx} cy={90} r={44} fill="var(--cover-accent)" />
          <circle cx={cx} cy={90} r={34} />
          <line x1={cx} y1={90} x2={cx} y2={62} transform={`rotate(${angle} ${cx} 90)`} strokeLinecap="round" />
          <circle cx={cx} cy={90} r={3.5} fill="var(--cover-ink)" stroke="none" />
        </g>
      ))}
    </g>
  );
}

/** A row of coins, each overlapping the one before it. */
function coins(): ReactElement {
  return (
    <g stroke="var(--cover-ink)" strokeWidth="2.5">
      {[42, 90, 138, 186, 234, 282].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={90} r={40} fill="var(--cover-accent)" />
          <circle cx={cx} cy={90} r={22} fill="none" />
        </g>
      ))}
    </g>
  );
}

/** Book spines on a shelf: varied widths and heights, one shelf line under them. */
function spines(): ReactElement {
  const books: Array<[number, number, number]> = [
    // [x, width, height]
    [20, 26, 118],
    [50, 18, 136],
    [72, 32, 104],
    [108, 22, 128],
    [134, 28, 114],
    [166, 16, 140],
    [186, 30, 122],
    [220, 20, 132],
    [244, 26, 110],
    [274, 18, 126],
  ];
  return (
    <g stroke="var(--cover-ink)" strokeWidth="2">
      {books.map(([x, width, height]) => (
        <rect key={x} x={x} y={152 - height} width={width} height={height} rx={3} fill="var(--cover-accent)" />
      ))}
      <line x1={8} y1={152} x2={292} y2={152} stroke="var(--cover-ink)" strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}

const PATTERNS: Record<CoverArchetype, () => ReactElement> = { rings, studs, fan, dials, coins, spines };

interface GeneratedCoverProps {
  collectionId: string;
  className?: string;
}

export function GeneratedCover({ collectionId, className }: GeneratedCoverProps) {
  const { archetype, hue } = coverFor(collectionId);

  return (
    <svg
      className={className ? `collection-cover ${className}` : "collection-cover"}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      style={{ "--cover-hue": hue } as CSSProperties}
      data-archetype={archetype}
      aria-hidden="true"
      focusable="false"
    >
      {BACKGROUND}
      {PATTERNS[archetype]()}
    </svg>
  );
}
