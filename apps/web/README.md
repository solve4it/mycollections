# @mycollections/web

React 19 web application for MyCollections. Uses Vite for bundling, TanStack Router for client-side routing, and CSS custom properties for the responsive layout system.

## Layout shell

The `Shell` component provides the full-height application frame:

- **Desktop (≥768 px)**: sidebar navigation on the left (240 px), main content on the right.
- **Mobile (<768 px)**: full-width main content, fixed bottom navigation bar (64 px).
- **Touch targets**: all nav links carry the `touch-target` CSS class, enforcing `min-height` and `min-width` of 44 px per WCAG 2.5.5.
- **Keyboard / screen readers**: a visually hidden skip-to-content link (`<a href="#main-content">`) appears on focus. The sidebar and bottom nav both have descriptive `aria-label` values.

## Routing

Code-based routing via TanStack Router. Routes are defined in `src/routes/`:

| Route | File | Description |
|---|---|---|
| `/` | `routes/index.tsx` | Redirects to `/collections` |
| `/setup` | `routes/setup/index.tsx` | First-run onboarding: API token entry. Redirects to `/collections` if a token is already stored |
| `/collections` | `routes/collections/index.tsx` | Dashboard: collection cards, loading/error/empty states. Redirects to `/setup` if no token |
| `/collections/new` | `routes/collections/new.tsx` | Create a collection with the field schema builder |
| `/settings` | `routes/settings/index.tsx` | Settings + language selector |

The root layout (`routes/__root.tsx`) wraps all routes with the `Shell` component. Routes that need a connected API guard against a missing token in `beforeLoad` and redirect to `/setup`.

## Data fetching & API client

The web app talks to the `@mycollections/api` server over HTTP.

- **`src/lib/api-client.ts`**: thin `fetch` wrapper. Adds `Authorization: Bearer <token>` from `localStorage` (`api_token`), throws `UnauthorizedError` on 401 and `ApiError` on other failures. Base URL comes from `VITE_API_URL` (default `http://localhost:3001`). Exposes `getToken` / `setToken` / `clearToken`, `listCollections`, and `createCollection`.
- **`src/lib/queries.ts`**: TanStack Query hooks — `useCollections()` (query) and `useCreateCollection()` (mutation, invalidates the `collections` query on success). `QueryClientProvider` is mounted in `main.tsx`.

The API token is the random UUID the server prints to stdout on startup; the user pastes it into the `/setup` screen.

## Collection creation

`/collections/new` builds a `Collection` payload including a **field schema builder**. Each field row captures a label, a type (from `BUILT_IN_FIELD_TYPES` in `@mycollections/core`), and a required flag; `select`/`multiselect` types reveal a comma-separated options input. On submit the drafts are converted to validated `FieldDefinition` objects and posted via `createCollection`.

## Internationalization (i18n)

All UI strings use `react-i18next`. Translation files live in `src/locales/<lang>/<namespace>.json`:

| Namespace | File | Contents |
|---|---|---|
| `common` | `locales/en/common.json` | App name, nav labels, ARIA strings |
| `collections` | `locales/en/collections.json` | Dashboard, empty state, and collection-creation form strings |
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

All breakpoints and spacing constants are CSS custom properties on `:root`:

| Variable | Default | Purpose |
|---|---|---|
| `--breakpoint-md` | `768px` | Mobile/desktop cutover |
| `--sidebar-width` | `240px` | Desktop sidebar width |
| `--bottom-nav-height` | `64px` | Mobile bottom nav height |
| `--touch-target-size` | `44px` | Minimum nav link hit area |
