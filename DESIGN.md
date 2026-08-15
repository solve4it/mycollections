# MyCollections visual design — "Cabinet & Paper"

The design direction for the app (epic #199): the navigation is a dark museum **flat-file
cabinet**; everything the collector owns sits on light **archival paper**. Actions are
ink-stamp blue, progress is manila-tag gold, and item statuses are collectors' sticker dots.
One signature element — every collection gets a deterministic **generated cover** derived from
its id.

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
| `--danger` | `#B3261E` | `#F2857C` | Error text, and the border on an inline alert |
| `--danger-surface` | `#F7EAE7` | `#2B201E` | Tint behind an inline alert (decoration only) |

Rules the split tokens encode — don't collapse them:

- **Fill vs. text**: `--stamp` is a *fill* (with `--stamp-ink` text on it); it is too dim as
  dark-mode text. Anything accent-colored that is *read* uses `--accent-text`.
- **Manila never sits on paper**: as a fill on light surfaces it fails 3:1 — use `--progress`.
- **Danger is not hue-separable from wanted.** Every red that clears contrast against paper and
  card sits within 1.4:1 of `--wanted` under deuteranopia — red-vs-amber is the canonical
  red-green confusion, and no palette choice fixes it. Failures are therefore marked
  structurally (a border, and the words), never by color. Don't "fix" this by picking a
  different red.
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
lift, 150ms transitions, skeleton shimmer — all gated by `prefers-reduced-motion`.

That gate is a single `@media (prefers-reduced-motion: reduce)` block at the end of global.css
(landed with #223; #225 inherits it), never a per-rule opt-out. It sets near-zero durations
rather than `none` so `transitionend`/`animationend` handlers still fire, and it cancels the
card's hover *displacement* as well — zeroing the duration alone leaves a 2px jump under the
pointer, which is motion, just faster. The one orchestrated moment is reserved for set
completion (#42).

## Theming mechanics

Light is the `:root` default. Dark ships via `@media (prefers-color-scheme: dark)`, and
`:root[data-theme="dark"|"light"]` overrides win in both directions — that attribute is the
hook for the explicit theme switch (#25). `color-scheme` is declared so native form controls
and scrollbars follow. Only **base tokens** are redefined per theme; aliases are declared once.

## The shell (#222)

The sidebar and bottom nav are the **cabinet**: `--cabinet` ground, dark in both themes, with a
`--cabinet-line` seam against the paper (the mockup had no seam — in dark mode `--cabinet`
`#0E120F` and `--paper` `#141816` are near-identical and the edge disappeared). Nav labels rest
at `--cabinet-muted` and rise to `--cabinet-ink` on hover and when active; the pills are white
at 5 % / 8 % rather than a token, so they lighten whatever the cabinet currently is. The active
item carries a 3px `--manila` drawer-pull notch bleeding into the sidebar's padding, and the
bottom nav's active tab is manila with a matching notch — presence, not just hue, so it survives
forced-colors mode. Measured: `--cabinet-muted` 6.58/7.08, `--cabinet-ink` on the active pill
9.52/13.02, `--manila` 7.35/9.54 (light/dark).

Wordmark is `--font-display` at 700; the footer is `--font-mono`, letter-spaced, reading
`LOCAL-FIRST · v<version>` — the version injected at build time from the release-please
manifest, so the chrome always states what it is and what it is running.

**Focus rings** are `:focus-visible` only (a mouse click should not ring a button), 2px with a
2px offset: `--focus` on paper, `--focus-on-cabinet` on the sidebar and bottom nav. This split is not
cosmetic — `--stamp` on `--cabinet` is **2.02:1** in light mode, under the 3:1 non-text floor,
while `--focus-on-cabinet` gives 6.08:1.

## Failure surfaces (#264)

Error styling attaches to `[role="alert"]`, not to a class, so all eleven alert sites across
five routes pick it up at once and a new route cannot forget it. `role="status"` is deliberately
untouched — it carries loading and success messages, and danger styling there would be a lie.

Two shapes exist, and they are styled differently on purpose:

- **A standalone `<p role="alert">`** — the eight that appear beside working UI — gets a strip:
  danger text, a 3px `--danger` left border, and a `--danger-surface` tint. The **border** is the
  non-color cue that satisfies WCAG 1.4.1; the tint carries nothing (~1.05:1 against both
  surfaces, by design — a tint readable enough to clear 3:1 would no longer be a tint).
- **A `<div role="alert">`** — the three full-page states and the items region — gets no strip;
  it already owns the screen. Its **title** keeps the danger ink and its **explanation** drops to
  `--ink-muted` via `> p:last-of-type`, which picks the explanation out of both shapes (`<h1>` +
  `<p>`, and the region's `<p>` + `<p>`) without either route needing a class. This was decided
  by looking at the running app: the whole block in red made "Your collections are safe…" read
  as an alarm.

Measured: `--danger` 5.81:1 on paper / 6.25:1 on card (light), 7.19 / 6.41 (dark); on
`--danger-surface` 5.56 / 6.34. All enforced by `tokens.integration.test.ts`;
`alerts.integration.test.ts` pins the rules themselves.

## Forms, buttons and status (#224)

**Controls.** The text-like control rule is written as *exclusions*
(`input:not([type="checkbox"]):not([type="radio"]):not([type="file"])`), never as a list of
types. An enumerated list is what left `number`, `currency`, `date`, `url`, `image` and `email`
fields — half the built-in types — rendering as bare UA controls: the rule named only `text` and
`password`. Exclusions mean a new field type is styled by default rather than forgotten, and
`forms.integration.test.ts` renders one control of every `BUILT_IN_FIELD_TYPES` value and
resolves what the cascade actually paints for it. Everything sits on `--card` with a `--line`
border at the 44px target.

A `.checkbox-row` is a `<label>` wrapping its box, so the **row** carries the 44px target — a
checkbox stretched to 44px is a 44px-wide box, not a bigger place to click. It also needs an
explicit `display: flex`: a `<label>` is inline by default, so the `flex-direction` and `gap`
the rule had always declared did nothing until that landed. The native box is themed with
`accent-color`, not replaced; the platform control is already focusable, announced and
keyboard-operable.

**Buttons.** Two skins, both opted into by class: `.button-primary` (stamp fill, `--stamp-ink`
label) and `.button-quiet` (paper ground, `--line` border, body ink). A submit button keeps the
primary skin implicitly — in this app a submit button is always the primary action of its form.
The primary skin's border is `transparent` rather than `--line`, which was a dark hairline
around a bright fill in dark mode, and is kept only so the two variants share a box model and
line up side by side.

`.button-quiet` replaced three near-duplicate rules that styled secondary buttons by **where
they sat** (`.field-row button`, `.item-actions button`, `.settings-data button`). That is why
the Cancel button in item edit mode — which matched none of them — rendered as a bare UA button.
Style by role, never by position.

**Status** is a sticker tag: a `--font-mono` uppercase label with a dot in the status token.
Deliberately flat, with **no tint behind it** — `--wanted` on a 10% wanted tint over `--card`
measures 4.28:1, under the 4.5 floor for small text, so a chip would make one of the three
statuses illegible in light mode. The dot is drawn as a `border` in `currentColor` rather than a
`background` fill, so it survives forced-colors mode where background paint is dropped — the
same reasoning as the nav's active notch. It is `aria-hidden`: it repeats the label beside it,
and status is never conveyed by color alone.

Measured on `--card` / `--paper`: `--owned` 5.44 / 5.06, `--wanted` 4.87 / 4.53, `--ordered`
6.89 / 6.41 (light); 7.06 / 7.91, 7.22 / 8.09, 6.69 / 7.50 (dark). The markup has always emitted
`item-status-<status>`; until #224 no rule matched it, so all three rendered the same indigo.

## Class roles

One class, one concern. `.touch-target` is **sizing** (the 44px minimum, plus the flex
alignment that centers content inside it); `.button-primary` and `.button-quiet` are the
**skins** (fill, padding, radius, border, icon gap). Components own their own spacing — the bottom nav wants a 2px icon
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

## Signature: generated covers (#223)

Every collection gets a cover derived from its id alone — pure, deterministic, identical on
every device, no network request to make. `apps/web/src/lib/cover.ts` hashes the id and picks
one of six archetypes plus a hue; `GeneratedCover.tsx` draws it. When real imagery lands (#37)
the pattern becomes the fallback and empty-state texture.

- **Archetypes** (order is load-bearing — reordering the array repaints every existing cover):
  `rings`, `studs`, `fan`, `dials`, `coins`, `spines`. Pictures of the things people collect,
  not abstract hash art — which is why this is hand-rolled rather than an identicon dependency
  (jdenticon, minidenticons, boring-avatars, geopattern and dicebear all score clean on
  `depscore`; none of them produce these six). Same call as `Icon.tsx`.
- **Hash**: FNV-1a 32-bit, integer-only. `Math.imul` for the multiply (past 2³ the plain
  operator silently drops low bits) and `>>> 0` before every modulo (JS bitwise ops are signed,
  and `negative % 6` indexes the archetype array out of bounds). Ids are lowercased first:
  `z.uuid()` accepts uppercase, so a restored backup could otherwise repaint the whole
  dashboard. Nothing in the hash path may touch `Intl`, `toLocaleString` or `localeCompare`.
- **Hue** is a hand-picked ladder — 22, 40, 74, 150, 190, 214, 262, 344 — read from different
  bits than the archetype, so a "coins" cover is not always the same color. Muted archival
  hues, deliberately clear of the `--stamp` indigo (236) that paints every primary action.
- **Color** is not decided in the component: it sets `--cover-hue` and the shapes reference
  `--cover-bg` / `--cover-ink` / `--cover-accent`, which global.css derives per theme. Those
  three are the only non-hex tokens in the palette, and so the only ones the contrast test
  cannot see — deliberate, because cover art is decorative (`aria-hidden`) and exempt from
  contrast requirements. The card's `<h2>` is the accessible content.
- **`cover.test.ts` freezes the output**: eight hard-coded id → `{archetype, hue}` + catalog
  code rows, the archetype order, the hue band, and a distribution check. Updating that table
  is a decision to reshuffle every existing collection's cover, never a rubber stamp.

## The collection card (#223)

Cover at 5:3, then a `--font-mono` eyebrow (`C-DZ · 3 ITEMS`), the name, and a description
clamped to two lines. The eyebrow's **catalog code is derived from the same hash, not from list
position** — `CollectionsRepository.list()` issues no `ORDER BY`, so a sequence number would
renumber itself on every create, delete and re-query. Codes may collide; it is a label in the
typewritten voice, never an identifier.

Code and count are sibling elements with the separator drawn in CSS `::before`, and the
uppercase is a `text-transform`: the DOM keeps the real translated, correctly pluralized string,
so `getByText("3 items")` — the guard that the card shows item counts rather than field counts
(#191) — still matches. The grid is `minmax(260px, 1fr)`: at 240px the covers pack into a wall
of pattern on a wide screen.

The finite-set progress bar named in the original #223 scope was **moved to #42**, which owns
that widget verbatim. There is no target total in the model — `isFiniteSet` is a boolean and
nothing records how many items the set should have — and `status` defaults to `owned` on create,
so "owned of entered" would read 100% for essentially every collection. #42 adds the target
count first.
