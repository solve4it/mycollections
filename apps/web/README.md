# @mycollections/web

React 19 web application for MyCollections. Uses Vite for bundling, TanStack Router for client-side routing, and CSS custom properties for the responsive layout system.

## Layout shell

The `Shell` component provides the full-height application frame:

- **Desktop (≥768 px)**: the cabinet sidebar on the left (216 px), main content on the right.
- **Mobile (<768 px)**: full-width main content, fixed bottom navigation bar (64 px) on the same cabinet surface.
- **The cabinet**: both navigation bars sit on `--cabinet`, which is dark in _both_ themes — the nav is the only dark chrome in the app, so the eye always knows what is furniture and what is the collection. Nav rules are built from `--cabinet-*` / `--manila`, never the `--color-*` aliases, which flip with the palette.
- **Sidebar footer**: `LOCAL-FIRST · v<version>` in the mono face. The version is injected at build time by a `define` in `vite.config.ts`, read from `.release-please-manifest.json` (the root package is private and has no `version` field until the first release).
- **Touch targets**: all nav links and buttons carry the `touch-target` CSS class, enforcing `min-height` and `min-width` of 44 px per WCAG 2.5.5. It is **sizing only** — the primary-action fill lives on the separate `button-primary` class, so an element opts into the blue button look explicitly (a class that did both is what made the active tab invisible in #259).
- **Active nav item**: `NavLink` (`Shell.tsx`) marks it `aria-current="page"` where the link is the page on screen and `aria-current="true"` where it is only the section that page sits in (#355) — and neither on a 404, because an address that matched no route is inside nothing (#354), so there no nav item wears the pill or the notch. The sidebar marks an active item with a white-8 % pill, a heavier label, and a 3 px `--manila` drawer-pull notch bleeding off the left edge; the bottom nav with a `--manila` label and a 2 px notch. The notch is deliberately a _presence_ cue, not a hue one, so it satisfies WCAG 1.4.1 and survives forced-colors mode; its space is pre-reserved with a transparent border so navigating never shifts the layout.
- **Keyboard / screen readers**: a visually hidden skip-to-content link (`<a href="#main-content">`) appears on focus. The sidebar and bottom nav both have descriptive `aria-label` values. Focus rings are 2 px `:focus-visible` outlines in `--focus`, or `--focus-on-cabinet` on the sidebar and bottom nav — `--focus` on the cabinet measures 2.02:1, under the 3:1 floor for non-text UI.

## Routing

Code-based routing via TanStack Router. Routes are defined in `src/routes/`:

| Route                   | File                           | Description                                                                                                                                                      |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                     | `routes/index.tsx`             | Redirects to `/collections`                                                                                                                                      |
| `/setup`                | `routes/setup/index.tsx`       | First-run onboarding: pairs from a `#pair=` link, or takes a pasted token or link. Redirects to `/collections` if a token is already stored and there is no link |
| `/collections`          | `routes/collections/index.tsx` | Dashboard: collection cards, loading/error/empty states. Redirects to `/setup` if no token                                                                       |
| `/collections/new`      | `routes/collections/new.tsx`   | Create a collection with the field schema builder                                                                                                                |
| `/collections/$id`      | `routes/collections/$id.tsx`   | Collection detail: item list + add/edit/delete with a dynamically generated form                                                                                 |
| `/collections/$id/edit` | `routes/collections/edit.tsx`  | Edit a collection's name, description, finite set and target count, and fields; manage its tags                                                                  |
| `/settings`             | `routes/settings/index.tsx`    | Settings + language selector                                                                                                                                     |

The root layout (`routes/__root.tsx`) wraps all routes with the `Shell` component. Routes that need a connected API are children of one pathless layout route, `authenticatedRoute` (`routes/_authenticated.tsx`), whose `beforeLoad` redirects to `/setup` without a token (#420). Only `/setup` and the not-found splat sit outside it; `src/routeTree.test.ts` pins that, and checks the guard runs on fresh loads and when moving between guarded screens client-side.

## Data fetching & API client

The web app talks to the `@mycollections/api` server over HTTP.

- **`src/lib/api-client.ts`**: thin `fetch` wrapper. Adds `Authorization: Bearer <token>`, throws `UnauthorizedError` on 401 and `ApiError` on other failures. Base URL comes from `VITE_API_URL` (default `http://localhost:3001`). Exposes `listCollections`, `createCollection`, `getCollection`, `getCollectionCounts` (a collection's live items in total and per status, from `GET /api/collections/:id/counts`), and item operations (`listItems`, `createItem`, `updateItem`, `deleteItem`), and re-exports the token API below.
- **`src/lib/token.ts`**: `getToken` / `setToken` / `clearToken` / `isTokenSessionOnly`. The token is persisted to `localStorage` (`api_token`) and also held in memory for the session, because touching storage throws outright where it is denied — cookies blocked, a sandboxed frame, partitioned or policy-restricted storage — and the token guard (`routes/_authenticated.tsx`) reads it on every navigation. A denied write costs the reload, not the session, and `isTokenSessionOnly()` is how the UI says so rather than letting the next reload look like a bug (#279).
- **`src/lib/queries.ts`**: TanStack Query hooks — `useCollections()`, `useCollection(id)`, `useItems(id)` (queries) and `useCreateCollection()`, `useCreateItem(id)`, `useUpdateItem(id)`, `useDeleteItem(id)` (mutations, each invalidating the relevant query on success). `useCollectionCounts(id, enabled)` reads the counts under `["collections", id, "items", "counts"]`, inside the items prefix every item mutation invalidates. Item create, update, delete and restore, a collection edit, and Settings' restores and import also fetch the dashboard list `["collections"]` again with `refetchType: "all"`. That list is not on screen while those run, and a merely stale entry would paint the old owned count on return and then jump (#42). `QueryClientProvider` is mounted in `main.tsx`.

The API token comes from `API_TOKEN`, or in development from the `api-token` file the server keeps beside its database (it survives restarts; startup prints the file's path). A browser normally gets it by **pairing** (#241): it opens the one-time link the API prints (`/setup#pair=<code>`), which the API also opens by itself on a first run. `/setup` sends the code to `POST /api/pair` through `pair()` in `lib/api-client.ts`, stores the token it gets back and goes to `/collections`.

- **One send per code.** The code is single-use, so a ref guards against StrictMode's double effect, and the request is never cancelled.
- **The code leaves the address bar.** Success replaces the history entry that held it; a failure navigates to a bare `/setup`.
- **The hash is followed, not read once at mount.** A link opened in a tab already on `/setup` (after Unpair, say) changes only the fragment and remounts nothing.
- **A link wins over a stored token.** `beforeLoad` does not redirect away while a `#pair=` fragment is present, because that token may be the stale one.
- **Refusals don't trigger auth recovery.** A refused code raises `PairingRejectedError`, not `UnauthorizedError`, so it does not send the app through 401 recovery, and the screen explains it in an alert.

The token field also accepts a pasted pairing link, for a browser the link cannot be opened in (a DevContainer, a remote machine), and still accepts the token itself. Settings → Connection's **Unpair this browser** forgets the token here only; it does not revoke it. Where the browser will not store anything, that screen says so before the token is pasted, and Settings → Connection repeats it — the app still works, it just cannot remember the token.

## Collection creation

`/collections/new` builds a `Collection` payload including a **field schema builder**. Each field row captures a label, a type (from `BUILT_IN_FIELD_TYPES` in `@mycollections/core`), and a required flag; `select`/`multiselect` types reveal a comma-separated options input. On submit the drafts are converted to validated `FieldDefinition` objects and posted via `createCollection`.

Both collection forms refuse only what the server refuses, and never silently. The name and description boxes carry `maxLength` from core's `COLLECTION_NAME_MAX` / `COLLECTION_DESCRIPTION_MAX`. The name and every field label are `required`, and a value of only spaces sets a custom validity message, so the browser stops the submit at that box and says why. An empty row is refused rather than dropped, because the server needs a label on every field. A `select`/`multiselect` row's options box is `required` too, and is marked invalid whenever it parses to no option, so a box of only commas and spaces is refused as well. A submit refused for having no field also resets the mutation, so an earlier failure's alert does not stay up beside the new one. A submit with no field row left has no box to mark: the form passes `noFieldsError` to `FieldSchemaBuilder`, which renders a `role="alert"` after **Add field** that the button's `aria-describedby` points at, and focus moves to Add field.

`FiniteSetFields` (`src/components/FiniteSetFields.tsx`) is the finite-set checkbox, shared by the new-collection form and the editor at `/collections/$id/edit`. Checking it reveals a **target count** box — `<input type="number" inputMode="numeric">` with `min=1`, `max=TARGET_COUNT_MAX` (100,000, from `@mycollections/core`) and `step=1`, labelled "Number of items in the set" and described by a hint stating that rule. The box holds the text as typed, so unchecking finite only hides it and checking it again brings the draft back. Both forms always send `targetCount` — the number for a finite set with a filled box, `null` for an empty box or a collection that is not a finite set — so an edit that empties the box or unchecks finite clears the stored target. Out-of-range or fractional input is refused by the browser's constraint validation before submit, as the required name already is; a refusal from the server shows the form's usual alert. Ids come from `useId()`.

## Finite-set progress

`CollectionProgress` (`src/components/CollectionProgress.tsx`) shows how far a finite set is toward its target: a `<p class="collection-progress">` holding a mono "3 of 5 collected", a **Complete** badge once owned reaches the target, and an `aria-hidden` track and fill. The fill's width is an inline `inline-size`, never a `--progress` custom property, because `--progress` is the fill's color token. Core's `collectionProgress()` decides what to show, and the widget renders nothing for a collection that is not finite or has no target. The dashboard card renders it last, from the list's `ownedCount`. The collection page renders it under the title from `useCollectionCounts`, which is enabled only for a finite set with a target, and shows no bar while those counts load or if they fail. A finite set with no target gets a plain `.form-hint` on its page instead, and nothing on its card. See [`DESIGN.md`](../../DESIGN.md#finite-set-progress-42) for the measurements and why it is not a `<progress>` or `<meter>`.

Completing the set from its page is celebrated once (`routes/collections/$id.tsx`). Mark collected, a row's Save and Add item each call `watchCompletion()` before sending, which reads the cached counts. Once the mutation's promise resolves (the hook has fetched the counts again by then), the returned check says whether the set went from incomplete to complete. Only fresh counts count as "before": idle, not invalidated, and fetched since the page mounted. Anything else is unknown, as is a failed refetch after, and unknown means no. The check is also told whether the change turned an item owned. A `celebratedRef` makes it once per completion, and it resets when the counts drop below the target. The message replaces the action's usual one and goes in `.celebration-live`, beside the undo toast's region, for `CELEBRATION_MS`. Meanwhile `CollectionProgress` takes `celebrating` and the header's badge stamps. Undo, target edits and landing on the page never celebrate.

## Items & dynamic forms

`/collections/$id` lists the collection's items and lets you create, edit, and delete them. The `DynamicItemForm` component (`src/components/DynamicItemForm.tsx`) **generates form controls from the collection's `FieldDefinition[]`**:

| Field type                         | Control                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `text` / `url` / `email` / `image` | `<input>` (`text` / `url` / `email` / `url`)          |
| `number` / `currency`              | `<input type="number">` (currency uses `step="0.01"`) |
| `boolean`                          | checkbox                                              |
| `date`                             | `<input type="date">`                                 |
| `select` / `rating`                | `<select>` (rating is `0…max`)                        |
| `multiselect`                      | checkbox group                                        |
| `tags`                             | comma-separated text → `string[]`                     |

Every item also has a **status** (`owned` / `wanted` / `ordered`, default `owned`) from `ITEM_STATUSES`. On submit the form emits an `ItemInput` (`{ status, fields }`) where `fields` is keyed by field id and coerced to the right runtime type (numbers parsed, tags split, etc.). The same component is reused for editing by passing `initialStatus` / `initialValues`; the form follows a change of `initialStatus` until the user picks a status (a reset clears the pick), which the add form uses to start on Wanted under the Remaining tab.

**Status tabs** (`src/components/StatusTabs.tsx`, #42): All / Collected / Remaining above the list on every collection — Collected is `owned`, Remaining is `wanted` + `ordered` (`inStatusTab` in `src/lib/item-search.ts`). A bespoke WAI-ARIA APG tabs component with automatic activation, RTL-aware arrows and `useId` ids; one `tabpanel` wraps the count, the rows and every empty state, and is `aria-describedby` the empty state while one shows. The page decides the empty state (`EmptyView` in `routes/collections/$id.tsx`) — including "no remaining items match" with a Show them under All button when the matches are in another tab — and never from placeholder data. The tab is the `?show=collected|remaining` search param (absent is All) and filters the one list query on the client, so `itemsQueryKey` and the API are unchanged. See [`DEVELOPMENT.md`](../../DEVELOPMENT.md#tabs-over-a-list) for the pattern and the focus cases.

**Failed mutations are never silent.** With `networkMode: "always"` a create, update or delete _fails_ rather than pausing, so each one renders its own translated `role="alert"` naming the action that failed (`create_error` / `update_error` / `mark_error` / `delete_error` in `locales/en/items.json`) — a shared "something went wrong" would leave the user guessing which attempt was lost. Mark collected (#42) has its own mutation, `useSetItemStatus`, which sends only `{ status }` through the api-client's `setItemStatus`, so a failed mark and a failed save are told apart and a mark never sends stale fields back. Save, mark and delete messages belong to the row that failed, so `item-row` sits on a wrapper `<div>` inside each `<li>`: the class is a flex row, and an alert added beside the fields and actions would be squeezed into a third column. Retrying clears the message on its own (a mutation returns to `pending` before it runs again); cancelling an edit calls `updateItem.reset()`, otherwise reopening the editor would show an error for a save the user had not attempted.

> Not yet implemented (follow-ups on #32): tag autocomplete from existing tags, and a dedicated item detail view.

## Loading and empty states

Two components cover every wait and every "there is nothing here yet" on the collection routes
(#225); see [`DESIGN.md`](../../DESIGN.md#waiting-and-emptiness-225) for the reasoning.

- **`src/components/EmptyState.tsx`** — the open-drawer mark, a title, an explanation, and
  optional `children` for the action that fills it. `titleAs="h1"` when the empty state _is_ the
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
still has a heading to navigate to and nothing pops in when the data lands. A pending _action_
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

| Namespace     | File                          | Contents                                                     |
| ------------- | ----------------------------- | ------------------------------------------------------------ |
| `common`      | `locales/en/common.json`      | App name, nav labels, ARIA strings                           |
| `collections` | `locales/en/collections.json` | Dashboard, empty state, and collection-creation form strings |
| `items`       | `locales/en/items.json`       | Item list, status labels, and dynamic-form strings           |
| `settings`    | `locales/en/settings.json`    | Settings page strings, language selector                     |
| `setup`       | `locales/en/setup.json`       | Onboarding / token entry strings                             |

**Adding a translation key:**

1. Add the key/value to the relevant `src/locales/en/<namespace>.json`.
2. In the component, call `const { t } = useTranslation("<namespace>")` then `t("key")`.

**Adding a new language:**

1. Create `src/locales/<lang>/<namespace>.json` files.
2. Register the resources in `src/i18n/index.ts` — in the `init()` call, so the language is
   resolved with its bundle already present.
3. Add `{ code: "<lang>", labelKey: "language_<lang>" }` to `SUPPORTED_LANGUAGES` in `src/routes/settings/index.tsx`.

`<html lang>` and `<html dir>` need no step of their own: `syncDocumentLanguage`
(`src/lib/document-language.ts`) stamps both from the resolved language at startup and on every
change, so the page always declares the language it is actually rendered in (WCAG 3.1.1) and the
direction that language is written in. The direction comes from `Intl.Locale`'s CLDR data, so a
new locale needs no entry anywhere. See
[DEVELOPMENT.md](../../DEVELOPMENT.md#the-document-language-and-direction).

Adding a **right-to-left** locale needs more than this, though: the attribute flips, the layout
does not yet — the CSS still uses physical properties in places and directional icons are not
mirrored ([#322](https://github.com/solve4it/mycollections/issues/322)).

**Locale-aware formatting:**

Use the helpers from `src/lib/intl.ts` which wrap the browser's `Intl` API:

```ts
import { formatDate, formatNumber, formatCurrency } from "@/lib/intl.js";

formatDate(new Date(), i18n.language, { dateStyle: "medium" });
formatCurrency(42.5, i18n.language, "USD");
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

| Variable              | Default | Purpose                   |
| --------------------- | ------- | ------------------------- |
| `--breakpoint-md`     | `768px` | Mobile/desktop cutover    |
| `--sidebar-width`     | `240px` | Desktop sidebar width     |
| `--bottom-nav-height` | `64px`  | Mobile bottom nav height  |
| `--touch-target-size` | `44px`  | Minimum nav link hit area |
