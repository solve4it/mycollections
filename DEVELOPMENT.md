# Development Guide

This guide takes you from a fresh clone to a running MyCollections dev environment. If you're here to contribute code, also read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow and Definition of Done. UI work should follow the visual direction in [`DESIGN.md`](./DESIGN.md).

## Prerequisites

- **Node.js 24 LTS** (currently `24.14.1`, pinned in `.nvmrc`). We recommend [fnm](https://github.com/Schniz/fnm) for fast version switching:
  ```bash
  fnm install && fnm use
  ```
- **pnpm** — the version is pinned in `package.json` via `packageManager` and managed automatically by Corepack:
  ```bash
  corepack enable
  ```
- **Git** (any recent version)
- **Docker Desktop** (or compatible runtime) — only required if you want to use the DevContainer

## Clone and install

```bash
git clone https://github.com/solve4it/mycollections.git
cd mycollections
pnpm install
```

That's it. The monorepo installs all workspaces in one step.

## DevContainer (optional)

MyCollections ships with a [Dev Container](https://containers.dev/) definition so you can work in a consistent, preconfigured environment without installing Node, pnpm, or other toolchain pieces on your host.

**Requirements:** A running container runtime — typically [Docker Desktop](https://www.docker.com/products/docker-desktop/), but any OCI-compatible runtime supported by the VS Code Dev Containers extension works (Podman, OrbStack, Rancher Desktop, Colima, GitHub Codespaces, etc.). The runtime must be running before you reopen in container.

The container is built on `mcr.microsoft.com/devcontainers/typescript-node:24` and configures Corepack, runs `pnpm install` automatically, forwards the dev-server ports for the API/docs/web apps, and pre-installs the recommended VS Code extensions (Biome, cSpell, Vitest, Astro, GitHub Actions, etc.).

To use it, open the repo in VS Code and choose **"Reopen in Container"** (or run `Dev Containers: Reopen in Container` from the command palette). The first build downloads the image; subsequent opens are instant. The DevContainer config lives in [`.devcontainer/devcontainer.json`](./.devcontainer/devcontainer.json).

## Monorepo structure

```
mycollections/
├── apps/
│   ├── api/          # Backend API (Fastify)
│   ├── docs/         # Documentation site (Astro Starlight)
│   └── web/          # Web app frontend
├── docs/             # Shared user-facing docs (rendered by Starlight and in-app Help)
├── packages/
│   ├── auth/         # Authentication utilities
│   ├── core/         # Core domain types and plugin contracts
│   ├── db/           # Database layer
│   ├── lookup/       # External metadata lookup
│   ├── sync/         # Cloud sync
│   └── ui/           # Shared UI components
├── plugins/
│   ├── plugin-audio/ # Audio gear collection plugin
│   └── plugin-lego/  # LEGO sets collection plugin
└── package.json      # Root workspace config
```

User-facing documentation lives in `docs/` at the repo root, not in `apps/docs`. The `apps/docs` workspace is the Starlight renderer; `docs/` is the markdown source it reads from. See [`docs/README.md`](./docs/README.md) for the dual-rendering pattern (Starlight + in-app Help).

Each workspace is a pnpm package and a Turborepo target. The monorepo uses [Turborepo](https://turbo.build/) to orchestrate build/test/lint across workspaces with caching.

## Common scripts

Run from the repo root:

| Script | What it does |
|---|---|
| `pnpm dev` | Start all apps in dev mode (`turbo run dev`) |
| `pnpm build` | Build every workspace (`turbo run build`) |
| `pnpm test` | Run the full test suite (`turbo run test`) |
| `pnpm test:e2e` | Run the accessibility sweep in a real browser (`turbo run test:e2e`) |
| `pnpm typecheck` | Type-check every workspace (`turbo run typecheck`) |
| `pnpm lint` | Biome lint across the repo (includes a11y rules) |
| `pnpm lint:fix` | Auto-fix lint issues where possible |
| `pnpm format` | Format with Biome |
| `pnpm format:check` | Check formatting without writing |
| `pnpm spellcheck` | Run cSpell over the repo |
| `pnpm check` | Full local CI: lint + spellcheck + typecheck + test + build |

Run `pnpm check` before opening a PR — it's the closest local approximation of what CI will run.

You can target a single workspace by using Turborepo filters:

```bash
pnpm --filter @mycollections/core test
pnpm --filter @mycollections/web dev
```

## Running the API and web app locally

Run everything at once from the repo root:

```bash
pnpm dev
```

This starts all apps via Turborepo. `dev` depends on `^build`, so the workspace
packages are compiled before any server starts, and the buildable packages
(`core`, `db`, `auth`) run `tsc --watch` alongside the apps to keep their `dist/`
fresh. The two apps you'll usually want:

- **API (Fastify)** on `http://127.0.0.1:3001` — runs from TypeScript source via `tsx watch` and restarts on change. Note it imports the workspace packages from their compiled `dist/`, which is why `pnpm dev` builds and watches them; running `tsx` against `apps/api` alone with a stale `dist` will serve old code.
- **Web app (Vite + React)** on `http://localhost:5173`. The port is pinned with `strictPort`, so if something else holds 5173 Vite fails loudly instead of moving to 5174 — the API's dev CORS allowlist names these exact origins (#242). To run on another port, name it in `DEV_ORIGINS` as well; see [Running a second instance](#running-a-second-instance-side-by-side).

Or start them individually — but a single app's `dev` won't rebuild its workspace
dependencies, so build them first (`pnpm build`) or run the full `pnpm dev`:

```bash
pnpm --filter @mycollections/api dev   # API → http://127.0.0.1:3001
pnpm --filter @mycollections/web dev   # web → http://localhost:5173
pnpm --filter @mycollections/docs dev  # docs → http://localhost:4321/mycollections/
```

### The theme boot script and CSP

`apps/web/index.html` carries a small **inline** `<script>` that applies the saved theme before
the first paint (#25) — it has to be inline and render-blocking, because a module script cannot
run before the stylesheet is discovered and the page would flash the wrong theme. Nothing serves
this HTML today (`@fastify/helmet` guards the API's own routes only), but the moment the API — or
any other server — starts serving the built `index.html` under a Content-Security-Policy, that
script needs a `'sha256-…'` entry in `scriptSrc`. Adding static serving without it produces a
white flash on every load and no error anywhere obvious. Do not "fix" it with `'unsafe-inline'`.

Verifying the no-flash behavior needs a **build**, not the dev server: in dev, `global.css`
arrives through the module graph, so the page is unstyled until the bundle runs regardless.

```bash
pnpm --filter @mycollections/web build && pnpm --filter @mycollections/web exec vite preview
```

### Connecting the web app to the API (the API token)

The API protects every route (except `GET /api/health`) with a bearer token. On startup in dev mode it **prints the token to stdout**:

```
API token: 0789678b-8fe9-4794-9ff4-c1fe5092ad84
Swagger UI: http://127.0.0.1:3001/api/docs
```

> Running `pnpm dev`? Turborepo prefixes each line, so look for `@mycollections/api:dev: API token: …`.

On first load the web app shows a setup screen — paste that token to connect. It's stored in `localStorage` (key `api_token`), and also kept in memory for the session so that a browser which refuses storage still works; there the setup screen warns up front that the token cannot be remembered.

By default the token is a **random UUID regenerated on every restart**, so after a server restart (including the auto-restart on file changes) you'd have to paste a fresh one. To keep a **stable token** across restarts, set it yourself:

```bash
API_TOKEN=dev-local-token pnpm --filter @mycollections/api dev
```

> This placeholder is for loopback development only. The server refuses to bind a non-loopback `HOST` unless `API_TOKEN` is set explicitly *and* is at least 32 characters, so a memorable token can never end up guarding a network-reachable API (#242).

The SQLite database is created automatically at `apps/api/data/app.db` on first run (override with `DB_PATH`). This location is anchored to the app directory, so it's the same file no matter which directory you launch from, and the resolved path is printed on startup (`Database: …`). The `data/` directory is gitignored.

### Running a second instance side by side

Two checkouts at once — a second worktree, or two branches being verified in parallel — means two web dev servers, and only one of them can have port 5173. The API's dev CORS allowlist is an **exact-origin** list, so a web server on any other port is blocked by the browser: the page loads, every API call fails, and neither side says why. `DEV_ORIGINS` names the origins the second instance uses (#327):

```bash
# instance two: API on 3141, web on 5199
DB_PATH=/tmp/second.db API_TOKEN=dev-local-token PORT=3141 \
  DEV_ORIGINS=http://localhost:5199,http://127.0.0.1:5199 \
  pnpm --filter @mycollections/api dev

VITE_API_URL=http://localhost:3141 pnpm --filter @mycollections/web dev --port 5199
```

A second instance needs **three** changes, not one — `DEV_ORIGINS` alone is not enough:

1. a free API `PORT`,
2. `VITE_API_URL` pointing the web app at that port (it defaults to `http://localhost:3001`),
3. `--port` on Vite *and* that origin in `DEV_ORIGINS`.

Point `DB_PATH` somewhere scratch too, or both instances write to the same database. Turbo runs tasks in strict env mode, so these variables reach the servers through `pnpm dev` only because `turbo.json` lists them in the `dev` task's `passThroughEnv`; a variable missing from that list is silently dropped before the server ever sees it.

Overriding the allowlist is reported at startup (`WARNING: DEV_ORIGINS replaces the default dev CORS allowlist…`), so the reason 5173 stopped working is on screen rather than in a browser console.

Rules `DEV_ORIGINS` follows, all of them deliberate:

- **Development only.** It is read only when `NODE_ENV` is not `production`. Outside development the API sends no CORS headers at all (`origin: false`), and no value of this variable changes that.
- **It replaces the default list**, it does not extend it — name every origin the instance needs, including the `127.0.0.1` spelling if you use it.
- **Loopback origins only.** Each entry is parsed as a URL and checked structurally: `http`/`https`, a loopback host, and no credentials, path, query or fragment. `http://localhost:5173.evil.example.com` and `http://evil.example.com#localhost:5173` are remote origins and are rejected, not matched.
- **It fails closed.** Unset or empty falls back to today's 5173/4173 list; anything malformed or non-loopback refuses to start, naming the offending entry. There is no value that widens CORS, and the allowlist never contains a wildcard — `credentials: true` is on, so a wildcard or a reflected origin would be a CSRF hole.
- **`strictPort` still applies**, so pass `--port` to Vite explicitly rather than letting it drift onto a port the allowlist does not name.
- **An empty allowlist is refused too.** `origin: []` would accept nothing while looking configured, which is the same silent breakage from the other side, so the server refuses to start.

If your browser is not on the same machine as the API — a VM, WSL, a devcontainer, a forwarded Codespace — the browser's origin is not loopback and `DEV_ORIGINS` will refuse it. Forward the port instead (`ssh -L`, or your container tool's port forwarding) so the page really is served from `localhost`; do not widen the allowlist or the API's `origin` option to reach it.

## Observability

### Logging (API)

The API logs structured JSON via Fastify's built-in [pino](https://getpino.io/) logger — every request is logged automatically. `LOG_LEVEL` overrides the level (`fatal`–`trace`; defaults to `debug` in dev, `info` in production). `Authorization` and `Cookie` request headers are redacted. Two rules when touching logging:

- **Never log request bodies** — they contain collection data. The default `req` serializer only logs method/URL/host; don't add a custom serializer that includes headers or bodies.
- **Never put user data or secrets in query strings** — the request URL is logged as-is.

### Error reporting

`packages/core` exports the `ErrorReporter` interface plus `createErrorReporter` / `buildErrorReport`, which sanitize every capture: only allowlisted context keys (`SAFE_CONTEXT_KEYS` — route, method, statusCode, componentStack, source, reqId) survive, so collection data and credentials can't leak into a report. Error `message`/`stack` pass through (truncated) and may contain user data — any future sink that transmits reports off-device must scrub them first; today's sinks are local-only (pino on the server, browser console on the web).

Wiring:

- **API** — the Fastify error handler reports unhandled (5xx) errors and returns a generic `500` body so internal details never reach clients; 4xx errors pass through untouched.
- **Web** — route render errors are caught by TanStack Router (`defaultOnCatch` → `onRouterCatch`), everything else by the top-level `ErrorBoundary`, `window` `error`/`unhandledrejection` handlers, and the React Query cache `onError`. Users can opt out via Settings → Privacy (persisted in `localStorage`, checked on every capture).
- **Both React paths report a `componentStack`.** `defaultOnCatch` and `ErrorBoundary.componentDidCatch` each receive React's `ErrorInfo`, and its `componentStack` is the only part of a report that says *which* component threw. Pass it; a handler typed without it silently loses that. It is optional on `onRouterCatch` so a bare call still reports — an absent stack leaves the key off rather than writing `undefined`, since `buildErrorReport` keeps only primitive context values.
- **`defaultOnCatch` only fires where an error component is configured.** The router mounts its per-route `CatchBoundary` only when `errorComponent` (or the router's `defaultErrorComponent`) resolves for that match, and `defaultOnCatch` *is* that boundary's `componentDidCatch`. Configure only the handler and it can never be called — which is what #319 was: the throw passed every route to the router's *global* boundary (`Matches.js`), which reports nothing in any environment and renders the library's own `ErrorComponent`, a red `<pre>` holding `error.message`, expanded in dev and one "Show Error" button away in production. So the missing error component was a privacy leak as well as a missing screen. `createAppRouter` (`apps/web/src/router.ts`) now sets both, and is the seam `router.test.tsx` uses to drive a throw through the app's real options.
- **The two crash screens, and why they are two** (`apps/web/src/components/ErrorScreen.tsx`). `RouteError` is the `defaultErrorComponent`: a route's boundary replaces the *screen*, so the shell is still standing and it can offer a link back to /collections. `AppErrorScreen` is the root route's own `errorComponent` and the `ErrorBoundary`'s fallback: the root's boundary wraps the root component, so a throw in `Root` or `Shell` renders with no nav, no `<main>` landmark and nothing left maintaining `document.title` — it brings all three, and offers only Reload, since routing is not known to work from there. Neither takes the boundary's `reset`: it only clears boundary state, so a deterministic render bug throws again and reports twice, and `router.invalidate()` rebuilds every committed match, resetting the boundary once per store update on the way through.
- **One surface, five screens, and focus is a prop** (#349). `FailureSurface` in that same file is the `<h1>` + explanation + optional actions block behind every full-page failure: the two crash screens above, and the three route-level load failures in `routes/collections/index.tsx`, `$id.tsx` and `edit.tsx` that each hand-rolled the markup until #349. It takes `title` and `description` as **already-translated strings**, not keys — both defects fixed in #347 were namespace mistakes at those call sites, and a string argument makes the wrong pair visible where a bare `t("error_title")` reads identically in every namespace. It also keeps the `t()` calls in the route files, which is the only reason `locale-keys.integration.test.ts` can still bind them to a namespace; pass keys through a prop instead and that scan goes silently vacuous. Taking focus is opt-in via `claimFocus`, for the reason in the next two bullets — the crash screens pass it, the load failures do not, and the default is the safe way round.
- **The crash screens carry `role="alert"` *and* take focus, and the two are not the same mechanism.** The role is the announcement: `alert` is the one live region a user agent fires an event for **on creation**, so inserting one announces it — unlike `aria-live`/`role="status"`, where the "persistent and empty, filled afterwards" rule below genuinely applies. #319 originally claimed these screens were an exception to that rule; they are not, and #347 corrected it. The focus is for two other things: a crash destroys whatever was focused, so focus falls to `<body>` and the tab order restarts at the top of the document (WCAG 2.4.3) — and browsers suppress live-region events until the document has loaded, which is exactly `AppErrorScreen` on a first paint. It is guarded on `document.activeElement` being `<body>` or nothing, the same guard `Shell.tsx` uses, so it never takes focus away from something that survived.
- **The route-level failure screens keep the role for a different reason again, and decline the focus.** `routes/collections/index.tsx`, `$id.tsx` and `edit.tsx` replace the screen when their query fails — which, with React Query's default three retries and no `retry` override in `lib/query-client.ts`, is about **seven seconds after the navigation**, not with it. By then focus has settled: on the nav (which lives outside the pathname-keyed wrapper and survives) or on `<main>` (where the shell put it), and moving it that long after a user action is a hazard rather than a help. Focus management cannot announce these; the role is the only thing that does. #346 proposed removing the role and was closed for exactly this. Since #349 the declining is explicit — they omit `claimFocus` — rather than implicit in not using the shared component, and `ErrorScreen.test.tsx` pins the default, which nothing else would.
- **`disableGlobalCatchBoundary` exists** (`Matches.js`) if the app's own `<ErrorBoundary>` should ever be the true last resort rather than the router's. It is not set today: the root route's `errorComponent` catches everything the global boundary would have.
- **Every web entry point takes `unknown` and normalizes with `toReportableError`.** A `throw` in a render, a rejected promise and an `ErrorEvent` all carry whatever value was thrown, not necessarily an `Error`. `buildErrorReport` reads `.message`, so handing it a raw string threw inside `capture`, which swallows failures by design — the report was dropped silently. Type a handler's parameter as `Error` and that hole reopens.
- **Never render `error.message` to the user** — it is never sanitized and can carry internals or collection data (a malformed response makes `res.json()` throw a `SyntaxError` quoting the payload). Show a translated string; the reporter keeps the original.

### Query state on the web

The app-wide QueryClient is built by `createQueryClient` in `apps/web/src/lib/query-client.ts`, which sets `networkMode: "always"`. React Query decides connectivity from the window's `online`/`offline` events, but the API runs on the same machine and stays reachable while the internet is down — under the default mode an offline browser holds every request in `fetchStatus: "paused"`, so the query never fetches, never rejects, and never reaches `onError`.

That does not remove the paused state entirely (a hidden tab still pauses a retry), so when rendering a query, follow the rule the two collection routes use:

- Treat `data === undefined` as the only state that replaces the page — never `isLoading`, which is `isPending && isFetching` and is therefore `false` for a paused query.
- Keep "failed to load" and "loaded, and there is nothing" as separate outcomes. Falling back to `data ?? []` tells the user their collection is empty when the request actually failed.
- Once data has loaded, keep it on screen if a later reload fails and show a warning alongside it, rather than replacing it with an error page.

Two consequences for how a failure is verified, both learned the hard way (#347):

- **A failure surface arrives about seven seconds after the navigation, not with it.** Nothing overrides `retry`, so React Query's default three attempts run at 1s, 2s and 4s first. Any test or manual check that gives up sooner concludes the screen has no error state. It is also why those screens announce themselves with `role="alert"` rather than by taking focus — by the time they mount, focus has long since settled somewhere else.
- **You cannot reproduce a query failure by driving Chrome from a tool.** React Query pauses *retries* while `document.visibilityState` is `"hidden"`, and a tab driven in the background always is: the query fetches once, fails, and then waits — no retries, no error state, indefinitely. The screen sits on its skeleton and looks like a bug in the app. Verify these states through `pnpm test:e2e`, where Playwright's page is visible, or by clicking through a browser you are actually looking at.

## Working on the docs site

The docs site at `apps/docs` is an [Astro Starlight](https://starlight.astro.build/) project that renders the shared markdown in `docs/` at the repo root, plus its own Starlight-native landing page.

- Shared user docs are copied from `docs/*.md` into `apps/docs/src/content/docs/user/` by `apps/docs/scripts/copy-shared-docs.mjs`, which runs automatically as a `predev` / `prebuild` hook.
- That copy is **top-level Markdown only**, and it now fails the build rather than skipping what it will not publish: a `.md`/`.mdx` file in any subdirectory other than `assets/` stops `predev` / `prebuild` with a message naming the file (#331). Nesting is unsupported deliberately — the sidebar in `apps/docs/astro.config.mjs` is hand-written, so a nested page would build to a real URL and be linked from nowhere. Adding hierarchy means changing the copy step, the `check-built-pages.mjs` copy audit and the sidebar together.
- The generated `user/` directory is gitignored — never edit files there; edit the source in `docs/` instead.
- Relative Markdown links between shared docs (`[Items](./items.md)`) are rewritten to real page URLs at build time by `apps/docs/scripts/satteri-relative-doc-links.mjs`. Keep writing them the relative way — that is the form GitHub needs, and the rewrite is what makes it work on the site too.
- `apps/docs/scripts/check-built-links.mjs` runs as a `postbuild` hook and fails the build if any in-site link still points at a `.md` file, or points at a page that was not built. A link that climbs out of `docs/` (`../../README.md`) is deliberately not rewritten and will fail this check — link to those on GitHub by absolute URL instead.
- `apps/docs/scripts/check-built-pages.mjs` runs alongside it and fails the build if a doc did not reach the site with its content: a shared doc the copy step missed, a doc that produced no page, or a page published with an empty body. That last one is the reason it exists — Starlight catches an error thrown while rendering a page, logs it, and finishes the build green, publishing a page with its navigation and footer intact and nothing in between (#294).
- Images referenced from the shared docs live in `docs/assets/`, and that directory is copied in alongside the Markdown by the same script (#295). Astro resolves `![Shelf view](./assets/shelf.png)` against the *copied* file and runs it through its image pipeline, so the published `src` is an optimized, content-hashed `/mycollections/_astro/shelf.<hash>.webp` rather than the source path — write the relative reference and never a URL under `_astro/`. An image the pipeline cannot find fails the build with `[ImageNotFound]`. `apps/docs/test/docs-images.test.mjs` is the regression guard: it builds the real site from the real `docs/` plus a fixture page and image and asserts the emitted `src` resolves to a file the build actually wrote.
- `apps/docs/site.mjs` holds the `site` and `base` values shared by the Astro config and those two scripts.
- **`astro build` runs through `apps/docs/scripts/build.mjs`, which fails the build on any `[WARN]` it prints** (#339). The build's output is streamed through untouched; the script reads it on the way past. This package has produced four bugs of one shape — the build says something is wrong and carries on (#286, #294, #295, #331) — and two permanent `[WARN] [content]` lines had been training everyone to skim past the exact prefix a real problem arrives under. Clearing them only helps if something notices when the output stops being clean. If Astro or Starlight starts warning about something legitimate, this turns red on purpose: read it, then fix the cause or account for it deliberately. Filtering the line out is not the fix.
- The not-found page is `apps/docs/src/pages/404.astro`, not a content file, and Starlight's own `/404` route is turned off (`disable404Route`). Starlight renders `src/content/docs/404.md` from an injected route, but its `[...slug]` catch-all does not exclude that same entry, so the documented file makes two routes claim `/404` and every build warns (verified against Starlight 0.42.0). Astro emits `src/pages/404.astro` as `dist/404.html`, which is the file GitHub Pages serves for an unknown URL; `check-built-pages.mjs` asserts it exists with a title, since nothing links to it and the link check never reaches it.
- `apps/docs/src/content/i18n/en.json` is an empty, required file — see `src/content/i18n/_README.md`. Starlight warns on every build without the `i18n` collection, and the collection needs at least one entry.
- The Starlight splash page lives at `apps/docs/src/content/docs/index.mdx` and is Starlight-specific (not shared with in-app Help).
- Deployment to GitHub Pages happens automatically via `.github/workflows/deploy-docs.yml` on push to `main` when `apps/docs/**` or `docs/**` changes.

```bash
pnpm --filter @mycollections/docs dev      # local dev server
pnpm --filter @mycollections/docs build    # static build into apps/docs/dist
pnpm --filter @mycollections/docs preview  # preview the production build
```

See [`docs/README.md`](./docs/README.md) for the dual-rendering pattern that keeps Starlight and the planned in-app Help in sync.

### Why apps/docs pins TypeScript 6

`apps/docs` declares its own `typescript: ^6.0.3` devDependency while the rest of the workspace tracks the latest major. This is deliberate and load-bearing.

`astro check` (via `@astrojs/language-server`) is built on TypeScript's **programmatic** compiler API — `ts.sys`, `ts.findConfigFile`, `LanguageServiceHost`. TypeScript 7 is the Go-native port and no longer ships that API; `require('typescript')` exposes only `{ version, versionMajorMinor }`. Running `astro check` against it fails with `Cannot read properties of undefined (reading 'fileExists')`. `@astrojs/check` confirms this in its peer range (`typescript: "^5.0.0 || ^6.0.0"`).

Every other workspace type checks with the plain `tsc` CLI, which the native compiler provides — so only the docs site is affected. pnpm keys `@astrojs/language-server` by TypeScript version, letting `apps/docs` resolve TS 6 while the rest of the monorepo uses the newer major. A `renovate.json` package rule keeps the pin from being bumped automatically.

Remove the pin, the Renovate rule, and this section once Astro supports the native compiler — tracked upstream at [withastro/roadmap#1321](https://github.com/withastro/roadmap/discussions/1321).

## Running tests

MyCollections uses [Vitest](https://vitest.dev/) across all packages. Tests are written **TDD-first** — see [`CONTRIBUTING.md`](./CONTRIBUTING.md#development-workflow-tdd).

```bash
# All tests
pnpm test

# One workspace
pnpm --filter @mycollections/core test

# Watch mode (inside a single workspace)
pnpm --filter @mycollections/core test --watch

# Coverage
pnpm --filter @mycollections/core test --coverage
```

### jest-dom matcher types under Vitest 5

`apps/web/src/vitest.d.ts` re-declares jest-dom's matchers on Vitest's `Matchers` interface.
It is a workaround, not a design choice.

`@testing-library/jest-dom` augments `interface Assertion<T = any>`. Vitest 5 changed that
interface to take two type parameters — `Assertion<R, T>`, return type first — and TypeScript
only merges interface declarations whose type parameter lists are identical. So the
augmentation is dropped, every matcher vanishes from the assertion type, and the tests fail to
compile with hundreds of `Property 'toBeInTheDocument' does not exist on type
'Assertion<void, HTMLElement>'`. The underlying mismatch (TS2428) is reported inside
`node_modules`, where `skipLibCheck` hides it. Runtime is unaffected — `expect.extend` still
registers the matchers and the tests pass.

Augmenting `Matchers` instead is Vitest's supported extension point and reaches `Assertion`,
`ExpectStatic` and `AsymmetricMatchersContaining` alike, so it merges cleanly. Note that
`AsymmetricMatchersContaining` must *not* also be augmented — it already extends `Matchers`,
and a second `TestingLibraryMatchers` base makes it unsatisfiable (TS2320).

Delete the file once jest-dom ships Vitest 5 types — tracked upstream at
[testing-library/jest-dom#738](https://github.com/testing-library/jest-dom/issues/738).

### Accessibility sweep (Playwright + axe)

`pnpm test:e2e` builds the web app, starts the API against an in-memory database, and runs
[axe-core](https://github.com/dequelabs/axe-core) over every route in a real Chromium — at two
viewports and both color schemes, because the sidebar, the bottom nav, and the dark palette are
each invisible to the other combination.

It is deliberately **not** part of `pnpm test` or `pnpm check`, which stay runnable without a
browser download. Install the browser once before the first run:

```bash
pnpm --filter @mycollections/web exec playwright install chromium
```

Then, from the repo root:

```bash
pnpm test:e2e                                             # everything
pnpm --filter @mycollections/web exec playwright test --project desktop-light   # one project
pnpm --filter @mycollections/web exec playwright show-trace apps/web/test-results/<dir>/trace.zip
```

The suite needs no local setup beyond that: it starts both servers itself, on ports 3111 (API)
and 4173 (web preview), with a token generated per run and `DB_PATH=:memory:`. It never opens the
database in your working tree.

What it covers, and what it does not: axe finds violations that are machine-decidable from the
rendered page. On top of that, the `keyboard access` specs drive the parts axe cannot see — the
skip link, and where focus lands after a client-side navigation — and one spec scans the app in a
navigated-into state rather than after a page load. What no tool can check is whether a screen
reader actually spoke: every assertion about announcement is a check on the shape of the DOM. See
[#24](https://github.com/solve4it/mycollections/issues/24) for what is still outstanding, including
the manual screen-reader pass.

The rest of the accessibility floor is asserted without a browser, by the integration tests in
`apps/web/src/styles`: contrast ratios in both themes (`tokens.integration.test.ts`), the
`prefers-reduced-motion` gating of every animation (`motion.integration.test.ts`), and where the
focus ring is and is not drawn (`focus.integration.test.ts`).

### Page titles and route announcements

A client-side navigation replaces the content with no page load, so nothing reaches a screen
reader unless the app arranges it. Two pieces of the shell do that, and both need a line from any
new route:

- **Every route names itself.** Add `staticData: { titleKey: "<namespace>:<key>" }` beside the
  route's `path`. `Shell.tsx` turns it into `"<page> · MyCollections"` for `document.title` and
  for the announcement. A translation key rather than a string, because `staticData` is read
  outside React where `useTranslation` is unavailable. `Shell.navigation.test.tsx` walks the real
  route tree and fails if a route with a component has no key.
- **New live regions go through the shell's announcer**, not into the page. A live region that is
  inserted with its text already inside is announced by VoiceOver but usually not by NVDA or JAWS.
  The shell's region (`aria-live="polite"`, `visually-hidden`, no role) is in the document from
  first paint and empty, and receives text afterwards. It sits outside the pathname-keyed wrapper
  in `routes/__root.tsx` on purpose: inside it, it would be rebuilt on every navigation and have
  the same bug.

The announcement is made once per **page**, where a page is the matched route's own interpolated
pathname (`/collections/<id>`) — not `location.pathname`, which the router updates a render before
the matches resolve, so a guard on it announces the page being *left*; and not the translated
title, which would announce the current page again on every language change.

#### A page whose name is in the data

Some pages cannot be named by their route: `/collections/$id` is "Collection" until the query says
which collection it is. Such a screen publishes its own name (#309):

- The route declares **`staticData: { titleKey, dynamicTitle: true }`**. The key stays as the
  stand-in — what the page is called while the query is in flight, and for good if it fails.
- The screen calls **`usePageTitle`** (`src/lib/page-title.tsx`) with a `PageName`: `{ status:
  "named", name }`, `{ status: "pending" }` while it does not know yet, or `{ status: "unnamed" }`
  when it never will. A union rather than nullish values, because "no name yet" and "no name,
  ever" decide whether the announcement waits, and two nullish values swap places silently.
- The shell holds the route-change announcement until the screen reports something other than
  `pending`, so the page is announced once, by the name it ends up with. Both halves are load
  bearing: **without `dynamicTitle`** the shell cannot tell a screen that has not rendered yet
  from one with nothing to add, announces the stand-in, and latches — so the collection's own name
  is never announced; **without the wait being scoped to that flag**, a page that never publishes
  would wait forever.

A query that never settles therefore means no announcement rather than a wrong one (see
[Query state on the web](#query-state-on-the-web) for what can stay pending). Renames do not
announce either — the title follows the data, the announcement follows the navigation.

Counting announcements is the assertion for any change here. `waitFor(toHaveTextContent(...))`
polls, so it can step straight over a wrong intermediate value; `Shell.navigation.test.tsx`
records the region's text through a `MutationObserver` instead.

Focus is recovered in the same place. That keyed wrapper unmounts the whole content subtree on
every navigation, so anything focused inside it takes focus to `<body>` with it; the shell moves
focus to `<main>` when — and only when — that has happened.

### Live regions the announcer cannot carry

The announcer is hidden and holds no controls, so a message that has to be **seen**, or that comes
with something to **press**, needs a region of its own. There are three: the undo toast, whose
words "Deleted …" and Undo button have to stay together on screen (`routes/collections/$id.tsx`);
the import's progress and result on Settings (`.import-live`); and the trash's emptied
confirmation (`.trash-live`). The rule such a region has to follow is the same one, met
differently — persistent and empty, never conditional:

- **Render the region unconditionally, and put the message inside it later.** `routes/collections/$id.tsx`
  keeps `.undo-toast-region` in the tree whether or not a toast is open; only the toast inside it is
  conditional. A region that appears together with its message is the bug, and `{condition && <div
  aria-live>…}` is exactly that shape.
- **Split layout from semantics.** The outer element positions; the inner `.undo-toast-live` carries
  `aria-live="polite"` and holds the announced content alone. Errors that are live regions in their
  own right (`role="alert"`) stay outside it — a live region nested in a live region owns its own
  subtree, so the outer one never speaks for it.
- **No role on the region, and none on the thing that arrives in it.** `role="status"` implies
  `aria-live="polite"`, so a role on the toast would make the toast the nearest live region for its
  own insertion — the announcement would be lost, not doubled. Leaving the role off also keeps
  page-level `getByRole("status")` queries pointed at the loading skeletons, which are now the only
  thing in the app carrying that role (`components/Skeleton.tsx`).
- **Give the region a class, and query it by that.** Three polite regions share `/settings` with the
  shell's announcer, so a bare `[aria-live="polite"]` locator is ambiguous in both Vitest (which
  renders the real root route) and Playwright. `.undo-toast-live`, `.import-live` and `.trash-live`
  exist to be named.
- **A message that cannot change is not a live region at all.** A notice decided once — the setup
  screen's "storage will not remember your token", Settings' session-only token hint, the trash's
  loading line — is in its screen's first commit or in none of them, so `role="status"` on it buys
  no announcement and makes every page-level status query ambiguous. Demote it to a plain `<p>`
  (`.form-hint` where the styling applies). The test to write is that it carries *no* role, found
  by its text: a `queryByRole("status")` assertion goes vacuous the moment the role is gone.
- **Only layout needs a wrapper.** `.undo-toast-region` exists because the toast is `position:
  fixed` with `pointer-events` juggling. A region in normal flow — the two on Settings — is one
  element; an empty one is zero-height and its child's margins collapse straight through it.
- **No `aria-atomic` unless the whole region is one string.** The shell's announcer replaces one
  string wholesale, so atomic is right there. A region whose content is replaced in place — a second
  delete renaming the toast — would re-read the entire toast instead of the name that changed.
- **This is about `aria-live`, not about `role="alert"`.** An `alert` is announced when it is inserted — the user agent fires an event on creation — so a failure surface that appears with its message inside it is correct, and the app's error screens are written that way. Everything above applies to the announcer and to the three class-named regions, which are `aria-live` and are not.
- **Scan the open state.** An interactive state no route-level scan reaches gets its own scan in
  `apps/web/e2e/a11y.spec.ts`, with the region asserted empty before the action and filled after.
  This is the only place the mechanism is proven in a real browser — jsdom has no accessibility tree
  at all. If the state times out, hold it open rather than racing the scan: the undo toast's timer
  stops while the pointer is over it, and where a message has no such hold, `page.clock.install()`
  freezes time for the scan and `page.clock.fastForward()` then proves the self-clear as well.
- **Give a message a life span, and empty the region in place.** A message that describes a finished
  event has to go away on its own when nothing on the page can clear it — Settings' emptied-trash
  confirmation outlived its list for the whole mount because the only thing that could have cleared
  it, the button, was gone with the trash (#336). Clear the *message*, never the region: a region
  torn down when it has nothing to say is one that arrives with its text already inside it next
  time. Emptying it announces nothing, because `aria-relevant` defaults to `additions text` and a
  removal is neither. Hold the message in local state rather than deriving it from a mutation's
  `isSuccess`: a second run that resolves before React re-renders commits no pending state in
  between, so a timer keyed on the flag survives into the next message — and a `reset()` firing
  mid-flight detaches the observer from the running mutation, whose result then never arrives.
- **Assert the sequence, by node identity.** `expect(region()).toBe(before)` is what fails when a
  region is torn down and rebuilt with its text inside; every assertion about the final DOM passes
  against exactly the bug this rule exists to prevent.

### The document language and direction

`<html lang>` has to name the language the page is actually rendered in (WCAG 3.1.1), `<html dir>`
has to say which way that language is written, and a language switch never reloads the page — so,
exactly like the theme, both attributes are the app's to maintain. `index.html` ships
`lang="en" dir="ltr"` for the window before any script runs, and `main.tsx` then hands the i18next
singleton to `syncDocumentLanguage` (`src/lib/document-language.ts`) beside the `applyTheme` call;
it stamps both at startup and on every `languageChanged`.

Both follow i18next's **resolved** language, not the requested one: selecting a locale that has no
bundle leaves every string English, and `lang="de"` over English text fails the same criterion
from the other side. For `dir` the stake is higher still — a requested-but-unbundled Arabic would
otherwise reverse a page that is still rendering English.

Direction itself comes from the platform: `Intl.Locale`'s `getTextInfo()` (or the older `textInfo`
accessor), which is CLDR's own data, so there is no language table to maintain. Neither accessor is
in this app's build target — `chrome111, edge111, firefox114, safari16.4, ios16.4`, and Chrome has
since dropped `textInfo` again — so `directionForLanguage` has one fallback: `maximize()` supplies
the locale's script, still from CLDR, and only the step from script to direction is ours (a short
set of right-to-left ISO 15924 codes; a script's direction is intrinsic, whereas a list of
right-to-left *languages* goes stale). The unit test deletes both accessors to exercise that path,
because Node's Intl has them and would otherwise hide it.

`document-language.integration.test.ts` keeps `index.html`'s hardcoded values equal to the
configured `fallbackLng` and its direction — change one and it fails.

Adding a locale therefore needs nothing here, as long as its bundle is passed to `i18n.init()`
with the others. A locale fetched lazily would not be: it resolves to the fallback first and
arrives on i18next's `loaded` event, which nothing listens to yet.

Note that a correct `dir` is not a right-to-left *layout*: the CSS still uses physical properties
in places, and directional icons are not mirrored. Labelling the document is #277; making the
layout survive the flip is #322.

## Debugging tips

- **Turborepo caches aggressively.** If a change isn't taking effect, try `pnpm turbo run <task> --force` or delete `.turbo/` in the affected workspace.
- **Node version mismatches** cause confusing failures. Run `fnm use` after `git pull` if `.nvmrc` changed.
- **Husky pre-commit hook** runs Biome and cSpell on staged files via lint-staged. If a commit is blocked, fix the reported issue and re-stage — don't bypass with `--no-verify`.
- **cSpell false positives**: add project-specific terms to the `words` array in `cspell.json` rather than inline-ignoring.
- **`pnpm test:e2e` fails to start a server**: something is already on port 3111 or 4173. The harness refuses to reuse an existing server on purpose — it would be one it did not configure, backed by a database it did not choose. Free the port (`lsof -ti tcp:3111 -sTCP:LISTEN | xargs kill`) and re-run.
- **VS Code**: install the Biome extension for inline lint/format feedback and disable ESLint/Prettier to avoid conflicts.

## Getting help

- **Project board**: https://github.com/orgs/solve4it/projects/1
- **Issues**: https://github.com/solve4it/mycollections/issues
- **Security**: `security@solve4it.com` (see [`SECURITY.md`](./SECURITY.md))
- **Code of Conduct**: `conduct@solve4it.com` (see [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md))
