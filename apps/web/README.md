# @mycollections/web

React 19 web application for MyCollections. Uses Vite for bundling, TanStack Router for client-side routing, and CSS custom properties for the responsive layout system.

## Layout shell

The `Shell` component provides the full-height application frame:

- **Desktop (≥768 px)**: the cabinet sidebar on the left (216 px), main content on the right.
- **Mobile (<768 px)**: full-width main content, fixed bottom navigation bar (64 px) on the same cabinet surface.
- **The cabinet**: both navigation bars sit on `--cabinet`, which is dark in *both* themes — the nav is the only dark chrome in the app, so the eye always knows what is furniture and what is the collection. Nav rules are built from `--cabinet-*` / `--manila`, never the `--color-*` aliases, which flip with the palette.
- **Sidebar footer**: `LOCAL-FIRST · v<version>` in the mono face. The version is injected at build time by a `define` in `vite.config.ts`, read from `.release-please-manifest.json` (the root package is private and has no `version` field until the first release).
- **Touch targets**: all nav links and buttons carry the `touch-target` CSS class, enforcing `min-height` and `min-width` of 44 px per WCAG 2.5.5. It is **sizing only** — the primary-action fill lives on the separate `button-primary` class, so an element opts into the blue button look explicitly (a class that did both is what made the active tab invisible in #259).
- **Active nav item**: the router supplies `aria-current="page"`; the sidebar marks it with a white-8 % pill, a heavier label, and a 3 px `--manila` drawer-pull notch bleeding off the left edge; the bottom nav with a `--manila` label and a 2 px notch. The notch is deliberately a *presence* cue, not a hue one, so it satisfies WCAG 1.4.1 and survives forced-colors mode; its space is pre-reserved with a transparent border so navigating never shifts the layout.
- **Keyboard / screen readers**: a visually hidden skip-to-content link (`<a href="#main-content">`) appears on focus. The sidebar and bottom nav both have descriptive `aria-label` values. Focus rings are 2 px `:focus-visible` outlines in `--focus`, or `--focus-on-cabinet` on the sidebar and bottom nav — `--focus` on the cabinet measures 2.02:1, under the 3:1 floor for non-text UI.

## Routing

Code-based routing via TanStack Router. Routes are defined in `src/routes/`:

| Route | File | Description |
|---|---|---|
| `/` | `routes/index.tsx` | Redirects to `/collections` |
| `/setup` | `routes/setup/index.tsx` | First-run onboarding: API token entry. Redirects to `/collections` if a token is already stored |
| `/collections` | `routes/collections/index.tsx` | Dashboard: collection cards, loading/error/empty states. Redirects to `/setup` if no token |
| `/collections/new` | `routes/collections/new.tsx` | Create a collection with the field schema builder |
| `/collections/$id` | `routes/collections/$id.tsx` | Collection detail: item list + add/edit/delete with a dynamically generated form |
| `/settings` | `routes/settings/index.tsx` | Settings + language selector |

The root layout (`routes/__root.tsx`) wraps all routes with the `Shell` component. Routes that need a connected API guard against a missing token in `beforeLoad` and redirect to `/setup`.

## Data fetching & API client

The web app talks to the `@mycollections/api` server over HTTP.

- **`src/lib/api-client.ts`**: thin `fetch` wrapper. Adds `Authorization: Bearer <token>`, throws `UnauthorizedError` on 401 and `ApiError` on other failures. Base URL comes from `VITE_API_URL` (default `http://localhost:3001`). Exposes `listCollections`, `createCollection`, `getCollection`, and item operations (`listItems`, `createItem`, `updateItem`, `deleteItem`), and re-exports the token API below.
- **`src/lib/token.ts`**: `getToken` / `setToken` / `clearToken` / `isTokenSessionOnly`. The token is persisted to `localStorage` (`api_token`) and also held in memory for the session, because touching storage throws outright where it is denied — cookies blocked, a sandboxed frame, partitioned or policy-restricted storage — and every route's `beforeLoad` reads the token. A denied write costs the reload, not the session, and `isTokenSessionOnly()` is how the UI says so rather than letting the next reload look like a bug (#279).
- **`src/lib/queries.ts`**: TanStack Query hooks — `useCollections()`, `useCollection(id)`, `useItems(id)` (queries) and `useCreateCollection()`, `useCreateItem(id)`, `useUpdateItem(id)`, `useDeleteItem(id)` (mutations, each invalidating the relevant query on success). `QueryClientProvider` is mounted in `main.tsx`.

The API token is the random UUID the server prints to stdout on startup; the user pastes it into the `/setup` screen. Where the browser will not store anything, that screen says so before the token is pasted, and Settings → Connection repeats it — the app still works, it just cannot remember the token.

## Collection creation

`/collections/new` builds a `Collection` payload including a **field schema builder**. Each field row captures a label, a type (from `BUILT_IN_FIELD_TYPES` in `@mycollections/core`), and a required flag; `select`/`multiselect` types reveal a comma-separated options input. On submit the drafts are converted to validated `FieldDefinition` objects and posted via `createCollection`.

## Items & dynamic forms

`/collections/$id` lists the collection's items and lets you create, edit, and delete them. The `DynamicItemForm` component (`src/components/DynamicItemForm.tsx`) **generates form controls from the collection's `FieldDefinition[]`**:

| Field type | Control |
|---|---|
| `text` / `url` / `email` / `image` | `<input>` (`text` / `url` / `email` / `url`) |
| `number` / `currency` | `<input type="number">` (currency uses `step="0.01"`) |
| `boolean` | checkbox |
| `date` | `<input type="date">` |
| `select` / `rating` | `<select>` (rating is `0…max`) |
| `multiselect` | checkbox group |
| `tags` | comma-separated text → `string[]` |

Every item also has a **status** (`owned` / `wanted` / `ordered`, default `owned`) from `ITEM_STATUSES`. On submit the form emits an `ItemInput` (`{ status, fields }`) where `fields` is keyed by field id and coerced to the right runtime type (numbers parsed, tags split, etc.). The same component is reused for editing by passing `initialStatus` / `initialValues`.

**Failed mutations are never silent.** With `networkMode: "always"` a create, update or delete *fails* rather than pausing, so each one renders its own translated `role="alert"` naming the action that failed (`create_error` / `update_error` / `delete_error` in `locales/en/items.json`) — a shared "something went wrong" would leave the user guessing which attempt was lost. Save and delete messages belong to the row that failed, so `item-row` sits on a wrapper `<div>` inside each `<li>`: the class is a flex row, and an alert added beside the fields and actions would be squeezed into a third column. Retrying clears the message on its own (a mutation returns to `pending` before it runs again); cancelling an edit calls `updateItem.reset()`, otherwise reopening the editor would show an error for a save the user had not attempted.

> Not yet implemented (follow-ups on #32): tag autocomplete from existing tags, and a dedicated item detail view.

## Loading and empty states

Two components cover every wait and every "there is nothing here yet" on the collection routes
(#225); see [`DESIGN.md`](../../DESIGN.md#waiting-and-emptiness-225) for the reasoning.

- **`src/components/EmptyState.tsx`** — the open-drawer mark, a title, an explanation, and
  optional `children` for the action that fills it. `titleAs="h1"` when the empty state *is* the
  page (the empty dashboard); the default `"p"` inside a region that already sits under headings
  (the item list), where a third heading would claim an outline level it does not own.
- **`src/components/Skeleton.tsx`** — `CollectionGridSkeleton`, `ItemListSkeleton` and
  `CollectionDetailSkeleton`, drawn inside the real `.collection-grid` / `.item-list` containers
  so the boxes they reserve are the boxes the data will fill. The placeholder blocks are
  `aria-hidden`; each **screen** wraps exactly one `role="status"` holding a `.visually-hidden`
  label (`t("loading")`), which is what a screen reader hears and what the #228 "still loading,
  never empty" guards match on.

Anything that does not depend on the pending data renders beside the skeleton rather than after
it — the dashboard's `<h1>` and Create action, the detail route's back link — so a loading route
still has a heading to navigate to and nothing pops in when the data lands. A pending *action*
(Settings' import) keeps a plain `role="status"` line: there is no content shape to preview.

## Icons

`src/components/Icon.tsx` is the app's whole icon set: hand-rolled inline SVG on a 24px grid,
1.5px strokes, `currentColor`, sized in em via the `.icon` class. `<Icon name="edit" />` is
decorative and `aria-hidden`, so the button or link around it keeps its accessible name;
`<Icon name="check" label={t("value_yes")} />` becomes an accessible image for the cases where
the icon carries the value itself. The one drawing that lives outside this file is the
empty-state mark in `EmptyState.tsx`: it is an illustration on its own 72×64 canvas, not a
1.25em UI icon, and it keeps every other rule (`fill="none"`, `currentColor`, round caps,
`aria-hidden`). Unicode glyphs are not used as icons — a guard test
(`src/components/icons.integration.test.ts`) fails the build if one appears in `src/`. See
[`DESIGN.md`](../../DESIGN.md#iconography).

## Internationalization (i18n)

All UI strings use `react-i18next`. Translation files live in `src/locales/<lang>/<namespace>.json`:

| Namespace | File | Contents |
|---|---|---|
| `common` | `locales/en/common.json` | App name, nav labels, ARIA strings |
| `collections` | `locales/en/collections.json` | Dashboard, empty state, and collection-creation form strings |
| `items` | `locales/en/items.json` | Item list, status labels, and dynamic-form strings |
| `settings` | `locales/en/settings.json` | Settings page strings, language selector |
| `setup` | `locales/en/setup.json` | Onboarding / token entry strings |

**Adding a translation key:**

1. Add the key/value to the relevant `src/locales/en/<namespace>.json`.
2. In the component, call `const { t } = useTranslation("<namespace>")` then `t("key")`.

**Adding a new language:**

1. Create `src/locales/<lang>/<namespace>.json` files.
2. Register the resources in `src/i18n/index.ts`.
3. Add `{ code: "<lang>", labelKey: "language_<lang>" }` to `SUPPORTED_LANGUAGES` in `src/routes/settings/index.tsx`.

**Locale-aware formatting:**

Use the helpers from `src/lib/intl.ts` which wrap the browser's `Intl` API:

```ts
import { formatDate, formatNumber, formatCurrency } from "@/lib/intl.js";

formatDate(new Date(), i18n.language, { dateStyle: "medium" });
formatCurrency(42.50, i18n.language, "USD");
```

## Development

```bash
pnpm dev        # Vite dev server at http://localhost:5173
pnpm build      # Production build into dist/
pnpm test       # Unit tests (jsdom + @testing-library/react)
pnpm typecheck  # TypeScript check
pnpm lint       # Biome lint + format check
```

## CSS design tokens

`src/styles/global.css` defines the full "Cabinet & Paper" token system — palette (light +
dark), type roles (three self-hosted variable fonts in `src/styles/fonts/`), shape, elevation,
and spacing. The palette table, usage rules, and theming mechanics are documented in
[`DESIGN.md`](../../DESIGN.md) at the repo root; every contrast pair is enforced by
`src/styles/tokens.integration.test.ts`, so WCAG regressions fail CI.

Layout constants on `:root`:

| Variable | Default | Purpose |
|---|---|---|
| `--breakpoint-md` | `768px` | Mobile/desktop cutover |
| `--sidebar-width` | `240px` | Desktop sidebar width |
| `--bottom-nav-height` | `64px` | Mobile bottom nav height |
| `--touch-target-size` | `44px` | Minimum nav link hit area |
