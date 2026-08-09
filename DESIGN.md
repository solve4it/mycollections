# MyCollections visual design — "Cabinet & Paper"

The design direction for the app (epic #199): the navigation is a dark museum **flat-file
cabinet**; everything the collector owns sits on light **archival paper**. Actions are
ink-stamp blue, progress is manila-tag gold, and item statuses are collectors' sticker dots.
One signature element — every collection gets a deterministic **generated cover** derived from
its id (lands with #223).

Tokens live in `apps/web/src/styles/global.css` as CSS custom properties. Every contrast pair
below is enforced by `apps/web/src/styles/tokens.integration.test.ts` — changing a value that
breaks WCAG AA fails CI.

## Palette

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--paper` | `#F1F2EE` | `#141816` | Page background |
| `--card` | `#FAFAF7` | `#1D2320` | Cards, inputs, raised surfaces |
| `--ink` | `#1D231F` | `#E7EAE5` | Body text |
| `--ink-muted` | `#5C645E` | `#9AA39C` | Secondary text |
| `--line` | `#DDE0D9` | `#2C332E` | Borders, dividers, progress tracks |
| `--cabinet` | `#232B26` | `#0E120F` | Nav chrome (dark in both themes) |
| `--cabinet-ink` / `--cabinet-muted` | `#E9ECE7` / `#A7B1A9` | `#E9ECE7` / `#97A199` | Nav text, active / inactive |
| `--stamp` / `--stamp-hover` | `#3E46C8` / `#333BB2` | `#4A52D6` / `#5A62E6` | Primary action fills |
| `--stamp-ink` | `#FFFFFF` | `#FFFFFF` | Text on stamp fills |
| `--accent-text` | `#3E46C8` | `#97A0FF` | Accent-colored **text** (active nav, badges) |
| `--focus` | `#3E46C8` | `#97A0FF` | Focus rings on paper/card |
| `--focus-on-cabinet` | `#97A0FF` | `#97A0FF` | Focus rings on the cabinet |
| `--manila` | `#D9B36C` | `#D9B36C` | Active notch and accents **on the cabinet only** |
| `--progress` | `#9A7420` | `#D9B36C` | Progress-bar fills (manila-ink on light surfaces) |
| `--owned` / `--wanted` / `--ordered` | `#2A7448` / `#9A6208` / `#3E46C8` | `#5CBF8A` / `#E0A33E` / `#97A0FF` | Status dots + labels |

Rules the split tokens encode — don't collapse them:

- **Fill vs. text**: `--stamp` is a *fill* (with `--stamp-ink` text on it); it is too dim as
  dark-mode text. Anything accent-colored that is *read* uses `--accent-text`.
- **Manila never sits on paper**: as a fill on light surfaces it fails 3:1 — use `--progress`.
- Legacy `--color-*` names are aliases onto these tokens; #221–#225 migrate consumers to the
  semantic names, then the aliases are removed.

## Typography

Three self-hosted variable fonts (latin subsets, ~108 KB total, `apps/web/src/styles/fonts/`,
OFL-licensed — see the LICENSE file there). No CDN: offline-safe, no host sees user traffic.

| Token | Face | Role |
| --- | --- | --- |
| `--font-display` | Bricolage Grotesque | Wordmark and `h1`/`h2` only — restraint keeps it special |
| `--font-body` | Instrument Sans | Everything readable (16px base) |
| `--font-mono` | Spline Sans Mono | Catalog codes, counts, status labels — the "typewritten label" voice |

Only upright styles ship; italics are browser-synthesized (deliberate — italics have no role
in the direction). Non-Latin locales need matching subsets plus `unicode-range` declarations.
When the PWA service worker lands (#34/#64), the precache glob must include `**/*.woff2`.

## Iconography

Hand-rolled inline SVG in `apps/web/src/components/Icon.tsx` — no dependency, no sprite, no
request to make offline. One 24px grid, 1.5px strokes, round caps and joins, `currentColor`
only, so an icon takes the color of whatever text it sits in and inverts with the theme for
free. Eleven icons: `collections`, `settings`, `add`, `back`, `edit`, `delete`, `import`,
`export`, `logo` (the three-drawer mark), `check`, `cross`.

Sizing is em-based (`.icon` = 1.25em), so icons track the type scale; a context that needs a
different optical size sets `font-size` on the icon rather than a pixel width, keeping the
relationship relative. Icons are `aria-hidden` by default — the surrounding link, button, or
label owns the accessible name. Pass `label` only when the icon *is* the value (the boolean
check/cross in an item row), never to restate adjacent text.

Directional icons follow the file, not the data: `export` writes a backup **down** onto the
device, `import` lifts a chosen file **up** off it — the same direction the browser's own
download UI uses, and the direction the button copy promises ("Download all your collections
as a JSON backup file"). `Icon.test.tsx` asserts both arrowheads so the pair cannot silently
invert.

No unicode glyphs are used as icons: they render in whatever face the platform supplies,
ignore the stroke weight, land in accessible names uninvited, and get announced under names
nobody chose. `icons.integration.test.ts` fails the build if one reappears in `apps/web/src`.

## Shape, elevation, rhythm

`--radius` 10px (cards) / `--radius-sm` 8px (controls); `--shadow` resting, `--shadow-lift`
hover; spacing scale `--space-1..6` = 4/8/12/16/24/32px. Motion is one gesture: 2px card
lift, 150ms transitions, skeleton shimmer — all gated by `prefers-reduced-motion` (#225).
The one orchestrated moment is reserved for set completion (#42).

## Theming mechanics

Light is the `:root` default. Dark ships via `@media (prefers-color-scheme: dark)`, and
`:root[data-theme="dark"|"light"]` overrides win in both directions — that attribute is the
hook for the explicit theme switch (#25). `color-scheme` is declared so native form controls
and scrollbars follow. Only **base tokens** are redefined per theme; aliases are declared once.

## Class roles

One class, one concern. `.touch-target` is **sizing** (the 44px minimum, plus the flex
alignment that centers content inside it); `.button-primary` is the **skin** (fill, padding,
radius, border, icon gap). Components own their own spacing — the bottom nav wants a 2px icon
gap where a button wants 8px, so neither may inherit it from a utility. #259 is what this rule
is for: `.touch-target` also painting a background made the active nav item resolve to
`--color-primary` on `--color-primary`, an invisible tab that every palette test still passed.

## Accessibility floor

Text pairs ≥ 4.5:1 (status labels are small text — held to the strict bar), meaningful
non-text UI ≥ 3:1, both themes, enforced by `tokens.integration.test.ts` for the palette and
`nav-cascade.integration.test.ts` for what the cascade actually resolves to. Status and
progress are never color-only: dots always carry text labels, bars always carry mono count
labels, and the active nav tab carries a notch as well as a hue — a presence cue keeps working
in forced-colors mode, where a background tint does not. Touch targets stay 44px; focus rings
are 2px `--focus`/`--focus-on-cabinet`.

## Signature: generated covers (spec for #223)

`hash(collection.id)` → one of six SVG pattern archetypes (rings, studs, fan, dials, coins,
spines) + a hue. Pure and deterministic: same collection, same cover, every device, zero
network. When real imagery lands (#37) the pattern becomes the fallback and empty-state
texture. Cover art is decorative (`aria-hidden`) and exempt from contrast requirements.
