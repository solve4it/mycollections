# Development Guide

This guide takes you from a fresh clone to a running MyCollections dev environment. If you're here to contribute code, also read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow and Definition of Done. UI work should follow the visual direction in [`DESIGN.md`](./DESIGN.md).

## Prerequisites

- **Node.js 26** — the exact version is pinned in `.nvmrc`. We recommend [fnm](https://github.com/Schniz/fnm) for fast version switching:

  ```bash
  fnm install && fnm use
  ```
- **pnpm** — the version is pinned in `package.json` via `packageManager`, with its sha512, and run through
  [Corepack](https://github.com/nodejs/corepack). Node 25 stopped shipping Corepack, so install it from npm first:

  ```bash
  npm install -g corepack@latest
  corepack enable
  ```

  `pnpm -v` inside the repo should then print the pinned version. Corepack is the route that checks the
  hash: it refuses a pnpm download that does not match, where pnpm's own version switching runs it anyway.
  CI installs pnpm the same way, through the composite action in `.github/actions/setup-pnpm`, and its
  "Package manager integrity" job proves on every run that a tampered hash is refused. Corepack only checks
  a download, never its cache, so that action must never cache `COREPACK_HOME`.
  Global npm packages live inside each Node installation, so after fnm installs a new Node version, run
  both commands again — otherwise `pnpm` is missing, and the pre-commit hook fails with `pnpm: command not found`.
  No `sudo`: fnm's Node installations belong to you. If the install stops with `EEXIST` on `pnpm`, `pnpx` or
  `yarn`, that Node already has a copy installed with npm, which bypasses the hash check — remove it with
  `npm uninstall -g pnpm @pnpm/exe yarn` (`npm ls -g --depth=0` shows what is there) and install Corepack again.
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

The container is built on `mcr.microsoft.com/devcontainers/typescript-node:26`, with the Node feature pinned to the `.nvmrc` version (the image's own Node can lag behind it). It uninstalls the pnpm the image ships, installs Corepack from npm, and runs `corepack enable`, so `pnpm` and `pnpx` are Corepack's — the image's copy, and its `pn`/`pnx` aliases (gone from the container), skip the `packageManager` hash check, and the feature is told not to install another (`pnpmVersion: "none"`). It then runs `pnpm install` automatically, forwards the dev-server ports for the API/docs/web apps, and pre-installs the recommended VS Code extensions (Biome, cSpell, Vitest, Astro, GitHub Actions, etc.).

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

A workspace with nothing to build has **no `build` script**. Turbo skips a package that lacks the
script, whereas a no-op `"build": "echo …"` runs, emits nothing into the `dist/**` that the root
`turbo.json` declares as its output, and prints `no output files found` on every uncached build.
That warning has to stay meaningful, because it is how a real package whose build silently stopped
emitting gets noticed (#417). The placeholder packages (`lookup`, `sync`, `ui`, and both plugins)
add their `build` script when they get real code. Every workspace with real code declares
`"type": "module"` in its `package.json`. The web app needs it too, so that Vite loads `vite.config.ts`
as ESM instead of warning that it is ESM syntax in a CommonJS file.

## Common scripts

Run from the repo root:

| Script              | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `pnpm dev`          | Start all apps in dev mode (`turbo run dev`)                         |
| `pnpm build`        | Build every workspace (`turbo run build`)                            |
| `pnpm test`         | Run the full test suite (`turbo run test`)                           |
| `pnpm test:e2e`     | Run the accessibility sweep in a real browser (`turbo run test:e2e`) |
| `pnpm typecheck`    | Type-check every workspace (`turbo run typecheck`)                   |
| `pnpm lint`         | Biome lint and format check across the repo (a11y rules included)    |
| `pnpm lint:fix`     | Auto-fix lint issues where possible                                  |
| `pnpm format`       | Format with Biome                                                    |
| `pnpm format:check` | Check formatting without writing                                     |
| `pnpm spellcheck`   | Run cSpell over the repo                                             |
| `pnpm check`        | Full local CI: lint + spellcheck + typecheck + test + build          |

`pnpm lint` is `biome check .`, so it reports formatting alongside lint rules. `CHANGELOG.md` is the one file
exempt from the formatter: release-please owns its layout and writes `*` list bullets where Biome's Markdown
formatter wants `-`, so `biome.json` turns the formatter off for that path. The linter and cSpell still cover it.

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

> This placeholder is for loopback development only. The server refuses to bind a non-loopback `HOST` unless `API_TOKEN` is set explicitly _and_ is at least 32 characters, so a memorable token can never end up guarding a network-reachable API (#242).

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
3. `--port` on Vite _and_ that origin in `DEV_ORIGINS`.

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

- **Never log request bodies** — they contain collection data. The `req` serializer in `apps/api/src/logger.ts` logs method, path, host and remote address; don't extend it with headers or bodies.
- **Query strings are not logged either.** Item search (`?q=`) and sort keys naming fields (`?sort=field:<id>`) carry collection data, so the serializer cuts the URL at `?` (#41). Never put secrets in a query string regardless — it still reaches browser history and any proxy in between.

### Error reporting

`packages/core` exports the `ErrorReporter` interface plus `createErrorReporter` / `buildErrorReport`, which sanitize every capture: only allowlisted context keys (`SAFE_CONTEXT_KEYS` — route, method, statusCode, componentStack, source, reqId) survive, so collection data and credentials can't leak into a report. Error `message`/`stack` pass through (truncated) and may contain user data — any future sink that transmits reports off-device must scrub them first; today's sinks are local-only (pino on the server, browser console on the web).

Wiring:

- **API** — the Fastify error handler reports unhandled (5xx) errors and returns a generic `500` body so internal details never reach clients; 4xx errors pass through untouched.
- **Web** — route render errors are caught by TanStack Router (`defaultOnCatch` → `onRouterCatch`), everything else by the top-level `ErrorBoundary`, `window` `error`/`unhandledrejection` handlers, and the React Query cache `onError`. Users can opt out via Settings → Privacy (persisted in `localStorage`, checked on every capture).
- **Both React paths report a `componentStack`.** `defaultOnCatch` and `ErrorBoundary.componentDidCatch` each receive React's `ErrorInfo`, and its `componentStack` is the only part of a report that says _which_ component threw. Pass it; a handler typed without it silently loses that. It is optional on `onRouterCatch` so a bare call still reports — an absent stack leaves the key off rather than writing `undefined`, since `buildErrorReport` keeps only primitive context values.
- **`defaultOnCatch` only fires where an error component is configured.** The router mounts its per-route `CatchBoundary` only when `errorComponent` (or the router's `defaultErrorComponent`) resolves for that match, and `defaultOnCatch` _is_ that boundary's `componentDidCatch`. Configure only the handler and it can never be called — which is what #319 was: the throw passed every route to the router's _global_ boundary (`Matches.js`), which reports nothing in any environment and renders the library's own `ErrorComponent`, a red `<pre>` holding `error.message`, expanded in dev and one "Show Error" button away in production. So the missing error component was a privacy leak as well as a missing screen. `createAppRouter` (`apps/web/src/router.ts`) now sets both, and is the seam `router.test.tsx` uses to drive a throw through the app's real options.
- **The two crash screens, and why they are two** (`apps/web/src/components/ErrorScreen.tsx`). `RouteError` is the `defaultErrorComponent`: a route's boundary replaces the _screen_, so the shell is still standing and it can offer a link back to /collections. `AppErrorScreen` is the root route's own `errorComponent` and the `ErrorBoundary`'s fallback: the root's boundary wraps the root component, so a throw in `Root` or `Shell` renders with no nav, no `<main>` landmark and nothing left maintaining `document.title` — it brings all three, and offers only Reload, since routing is not known to work from there. Neither takes the boundary's `reset`: it only clears boundary state, so a deterministic render bug throws again and reports twice, and `router.invalidate()` rebuilds every committed match, resetting the boundary once per store update on the way through.
- **One surface, five screens, and focus is a prop** (#349). `FailureSurface` in that same file is the `<h1>` + explanation + optional actions block behind every full-page failure: the two crash screens above, and the three route-level load failures in `routes/collections/index.tsx`, `$id.tsx` and `edit.tsx` that each hand-rolled the markup until #349. It takes `title` and `description` as **already-translated strings**, not keys — both defects fixed in #347 were namespace mistakes at those call sites, and a string argument makes the wrong pair visible where a bare `t("error_title")` reads identically in every namespace. It also keeps the `t()` calls in the route files, which is the only reason `locale-keys.integration.test.ts` can still bind them to a namespace; pass keys through a prop instead and that scan goes silently vacuous. Taking focus is opt-in via `claimFocus`, for the reason in the next two bullets — the crash screens pass it, the load failures do not, and the default is the safe way round.
- **The crash screens carry `role="alert"` _and_ take focus, and the two are not the same mechanism.** The role is the announcement: `alert` is the one live region a user agent fires an event for **on creation**, so inserting one announces it — unlike `aria-live`/`role="status"`, where the "persistent and empty, filled afterwards" rule below genuinely applies. #319 originally claimed these screens were an exception to that rule; they are not, and #347 corrected it. The focus is for two other things: a crash destroys whatever was focused, so focus falls to `<body>` and the tab order restarts at the top of the document (WCAG 2.4.3) — and browsers suppress live-region events until the document has loaded, which is exactly `AppErrorScreen` on a first paint. It is guarded on `document.activeElement` being `<body>` or nothing, the same guard `Shell.tsx` uses, so it never takes focus away from something that survived.
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

A screen's search state lives in the URL (#41), and three rules come with it:

- **Search values are plain strings.** The router is built with `parseSearch`/`stringifySearch`
  from `lib/search-params.ts`, not TanStack's JSON default, which turned `?q=1984` into a number
  and wrote JSON-looking text back with quotes. A route checks only the shape in `validateSearch`
  and drops what it cannot use; anything that depends on loaded data — whether a `sort` names a
  field this collection can sort by — is decided once that data is there (`effectiveSort`).
- **Typing navigates with `replace: true` and `resetScroll: false`**, or each keystroke adds a
  history entry and scrolls the page to the top.
- **Each search is its own cache entry** under the `["collections", id, "items"]` prefix
  (`itemsQueryKey`), with `placeholderData: keepPreviousData` so the old list stays on screen while
  the next one loads. Check `isPlaceholderData` before treating `data` as the answer to the current
  search.

Two consequences for how a failure is verified, both learned the hard way (#347):

- **A failure surface arrives about seven seconds after the navigation, not with it.** Nothing overrides `retry`, so React Query's default three attempts run at 1s, 2s and 4s first. Any test or manual check that gives up sooner concludes the screen has no error state. It is also why those screens announce themselves with `role="alert"` rather than by taking focus — by the time they mount, focus has long since settled somewhere else.
- **You cannot reproduce a query failure by driving Chrome from a tool.** React Query pauses _retries_ while `document.visibilityState` is `"hidden"`, and a tab driven in the background always is: the query fetches once, fails, and then waits — no retries, no error state, indefinitely. The screen sits on its skeleton and looks like a bug in the app. Verify these states through `pnpm test:e2e`, where Playwright's page is visible, or by clicking through a browser you are actually looking at.

## Working on the docs site

The docs site at `apps/docs` is an [Astro Starlight](https://starlight.astro.build/) project that renders the shared markdown in `docs/` at the repo root, plus its own Starlight-native landing page.

- Shared user docs are copied from `docs/*.md` into `apps/docs/src/content/docs/user/` by `apps/docs/scripts/copy-shared-docs.mjs`, which runs automatically as a `predev` / `prebuild` hook.
- That copy is **top-level Markdown only**, and it now fails the build rather than skipping what it will not publish: a `.md`/`.mdx` file in any subdirectory other than `assets/` stops `predev` / `prebuild` with a message naming the file (#331). Nesting is unsupported deliberately — the sidebar in `apps/docs/astro.config.mjs` is hand-written, so a nested page would build to a real URL and be linked from nowhere. Adding hierarchy means changing the copy step, the `check-built-pages.mjs` copy audit and the sidebar together.
- The generated `user/` directory is gitignored — never edit files there; edit the source in `docs/` instead.
- Relative Markdown links between shared docs (`[Items](./items.md)`) are rewritten to real page URLs at build time by `apps/docs/scripts/satteri-relative-doc-links.mjs`. Keep writing them the relative way — that is the form GitHub needs, and the rewrite is what makes it work on the site too.
- `apps/docs/scripts/check-built-links.mjs` runs as a `postbuild` hook and fails the build if any in-site link still points at a `.md` file, or points at a page that was not built. A link that climbs out of `docs/` (`../../README.md`) is deliberately not rewritten and will fail this check — link to those on GitHub by absolute URL instead.
- `apps/docs/scripts/check-built-pages.mjs` runs alongside it and fails the build if a doc did not reach the site with its content: a shared doc the copy step missed, a doc that produced no page, or a page published with an empty body. That last one is the reason it exists — Starlight catches an error thrown while rendering a page, logs it, and finishes the build green, publishing a page with its navigation and footer intact and nothing in between (#294).
- Images referenced from the shared docs live in `docs/assets/`, and that directory is copied in alongside the Markdown by the same script (#295). Astro resolves `![Shelf view](./assets/shelf.png)` against the _copied_ file and runs it through its image pipeline, so the published `src` is an optimized, content-hashed `/mycollections/_astro/shelf.<hash>.webp` rather than the source path — write the relative reference and never a URL under `_astro/`. An image the pipeline cannot find fails the build with `[ImageNotFound]`. `apps/docs/test/docs-images.test.mjs` is the regression guard: it builds the real site from the real `docs/` plus a fixture page and image and asserts the emitted `src` resolves to a file the build actually wrote.
- `apps/docs/site.mjs` holds the `site` and `base` values shared by the Astro config and those two scripts.
- **`astro build` runs through `apps/docs/scripts/build.mjs`, which fails the build on any `[WARN]` it prints** (#339). The build's output is streamed through untouched; the script reads it on the way past. This package has produced four bugs of one shape — the build says something is wrong and carries on (#286, #294, #295, #331) — and two permanent `[WARN] [content]` lines had been training everyone to skim past the exact prefix a real problem arrives under. Clearing them only helps if something notices when the output stops being clean. If Astro or Starlight starts warning about something legitimate, this turns red on purpose: read it, then fix the cause or account for it deliberately. Filtering the line out is not the fix.
- The not-found page is `apps/docs/src/pages/404.astro`, not a content file, and Starlight's own `/404` route is turned off (`disable404Route`). Starlight renders `src/content/docs/404.md` from an injected route, but its `[...slug]` catch-all does not exclude that same entry, so the documented file makes two routes claim `/404` and every build warns (verified against Starlight 0.42.0). Astro emits `src/pages/404.astro` as `dist/404.html`, which is the file GitHub Pages serves for an unknown URL; `check-built-pages.mjs` asserts it exists with a title, since nothing links to it and the link check never reaches it.
- `apps/docs/src/content/i18n/en.json` is an empty, required file — see `src/content/i18n/_README.md`. Starlight warns on every build without the `i18n` collection, and the collection needs at least one entry.
- The Starlight splash page lives at `apps/docs/src/content/docs/index.mdx` and is Starlight-specific (not shared with in-app Help).
- Deployment to GitHub Pages happens automatically via `.github/workflows/deploy-docs.yml` on push to `main` when `apps/docs/**`, `docs/**`, the lockfile, the workflow itself or the `setup-pnpm` action it installs pnpm with changes.

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

### Tests are collected from `src/`, and never compiled

The `tsc`-built workspaces (`packages/auth`, `packages/core`, `packages/db`, `apps/api`) each have a
`vitest.config.ts` whose `include` is `src/**/*.test.ts`, and build through `tsconfig.build.json`,
which leaves test files out. Both halves matter (#396): Vitest 5 no longer excludes `dist/` by
default, and `tsc` was emitting every test into it, so each test ran twice — and after an edit the
`dist/` copy was stale, running the previous build against current non-TS assets such as
`packages/db/drizzle/*.sql` and failing for no reason the source could explain. `tsc` never deletes
outputs, so a checkout built before this change still holds old `dist/**/*.test.js` files; the
`include` is what keeps them from running. `pnpm typecheck` still uses the full `tsconfig.json`, so
tests stay type-checked.

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
`AsymmetricMatchersContaining` must _not_ also be augmented — it already extends `Matchers`,
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
rendered page. Two spec files drive the parts it cannot see.

- `a11y.spec.ts` holds the axe scans, plus a `keyboard access` block about focus **management** —
  the skip link, and where focus lands after a client-side navigation — and one spec that scans the
  app in a navigated-into state rather than after a page load.
- `keyboard.spec.ts` is the keyboard **traversal** sweep: for every screen, the whole tab sequence
  in order; that Shift+Tab retraces it and that no screen traps focus; that every action is
  operable by key, with Space as well as Enter where the control is a button; and — the two blocks
  at the end of the file — where focus is left by an action that takes the control holding it away,
  or marks it busy.

The tab-order expectations are lists of each stop's ARIA role and accessible name, exactly as
Playwright computes them — `button "Delete"`, `textbox "Collection name": Vinyl records` — so a
failure is a diff of the words a screen reader would say, not of CSS selectors. A control that
lost its label, gained a second one, or moved in the sequence all read as that diff. Two
consequences worth knowing before you add a control:

- **The nav's position is asserted once, not per screen.** `.shell-sidebar` is `display: none`
  below 768px and `.shell-bottom-nav` above it, and `display: none` removes an element from the
  tab order, so the sidebar precedes the content at desktop width and the bottom bar follows it on
  a phone. `wholeSequence()` says that; each screen declares only its own stops.
- **Renaming a user-visible control changes a tab-order expectation**, which is deliberate: the
  expectation is the announced name, and a rename is a change to what the user hears.

What no tool can check is whether a screen reader actually spoke: every assertion about
announcement is a check on the shape of the DOM. See
[#24](https://github.com/solve4it/mycollections/issues/24) for what is still outstanding, including
the manual screen-reader pass.

### Ids belong to the instance

A component that can be rendered more than once takes the DOM ids its labels and descriptions
point at from React's `useId()`, never from a literal and never from an array index
([#369](https://github.com/solve4it/mycollections/issues/369)). `<label for>` resolves to the
_first_ element in the document with that id, so two instances sharing one quietly label the first
instance twice and leave the second unnamed — the collection screen did exactly this with the
add-item form and a row's editor open at the same time. An index renumbers ids under rows that
survive a removal; key the suffix by the same thing React keys the row by.

Build the id with `scopedId(prefix, part, key?)` from `src/lib/dom-id.ts` rather than by
concatenating. A data key (a field id is any non-empty string) can contain whitespace, which an id
may not and which splits an `aria-describedby` list; it can contain a dash, so a dash-joined
`part`-`key` pair can spell another row's id; it can contain characters such as `:` that break a
`#id` selector, which the e2e specs build from these ids; and `encodeURIComponent` throws on an
unpaired surrogate. `scopedId` escapes the key totally into a plain CSS identifier and joins it
with a separator the escape never emits.

axe files duplicate ids under `incomplete` rather than `violations`, which
`expectNoAccessibilityViolations` fails on too, but only if a scan actually enters the state where
both instances are on screen.

### Focus has to survive the action

Two rules, both learned from the sweep above finding thirteen places that broke them.

**A control that is busy marks itself, it is not disabled.** Chrome drops `document.activeElement`
to `<body>` the moment the focused element becomes `disabled`, so a button that disables itself for
the duration of its own mutation throws a keyboard user out of the page by reporting progress —
nothing unmounts, and focus is gone anyway. Use `aria-disabled={pending || undefined}` and refuse
the second send with an early return in the handler. The control keeps its place in the tab order,
keeps its accessible name, and gains an announced busy state it did not have. The early return is
what stops a second send: the mutation hooks in `lib/queries.ts` do not guard against one, and a row's
Delete, which had neither, sent a second DELETE for a row already going (#42). While a mark or a
delete is in flight, an item row's Mark collected, Edit and Delete all refuse this way, so a mark
cannot race a delete for the same item and an editor opened mid-mark is not unmounted with its draft
when the tab drops the row. The
same applies to a control disabled for a _rule_ rather than a request — a locked field type in
`FieldSchemaBuilder` — where `disabled` also took the `aria-describedby` hint explaining the rule
out of the tab order, hiding it from exactly the user who cannot see the grey.

**An action that removes the control holding focus names where focus goes.** `useFocusHandoff()`
in `lib/focus-handoff.ts` is the one primitive for it: call the function it returns from the
handler that is about to remove the control, passing a function that resolves the destination (and,
when the removal lands later than the request, the control being removed; see below), and
call it from a component that _survives_ the removal — the effect completing the handoff runs after
that component's next commit, so a hook inside the thing being unmounted dies first. The
destination may return `null` while it is not in the document yet, which is not a failure: an Undo
restores a row that only reappears once the list has been fetched again, and the handoff waits for
it, bounded by both a commit count and a deadline.

The destinations are not this repo's invention — each follows an ARIA APG rule, and says which in
its comment:

| Action                                          | Destination                                                                    | Rule                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------- |
| A row's Edit (opens the editor)                 | the editor's first control                                                     | disclosure: enter what you opened |
| The editor's Cancel, or a successful Save       | the Edit that opened it                                                        | dialog: return to the invoker     |
| A row's Delete                                  | the row that takes its place, else the one before, else the tab panel          | successor element                 |
| The toast's Undo                                | the restored row's Edit, once it is back                                       | successor element                 |
| The toast's Dismiss                             | wherever the delete handed focus                                               | — same answer as the delete       |
| Remove field                                    | the next field's **label**, else Add field                                     | successor element                 |
| A confirmed trash purge                         | the next row in the **same** list, else the one before, else the trash section | successor element                 |
| Save, when a search or tab no longer shows it   | the row that takes its place — as for a Delete (#41, #42)                      | successor element                 |
| A row's Mark collected, while the row is listed | the row's own Edit, wherever the row now is (#42)                              | return to the row acted on        |
| Mark collected, when the tab no longer shows it | the row in its place, else the one before, else the tab panel (#42)            | successor element                 |
| Mark collected on the last remaining item       | the tab panel, now described by "All collected" or "N more to find" (#42, R19) | successor element                 |
| Undo, when a search or tab does not show it     | wherever the delete handed focus — as for Dismiss (#41, #42)                   | successor element                 |
| Clear search (in the no-match state)            | the search box                                                                 | return to where the input began   |
| Remove a filter chip                            | the chip now in its place, else the one before, else the Filters toggle        | successor element                 |
| Clear filters                                   | the Filters toggle                                                             | return to where the filters began |
| A tag's Rename (opens its box)                  | the rename box                                                                 | disclosure: enter what you opened |
| A tag rename's Save, Cancel or Escape           | the renamed tag's Rename — or, after a merge, the Rename of the tag it joined  | dialog: return to the invoker     |
| …when the new name is not in the list           | the tag search box — a search it no longer matches, or past the fifty shown    | where the tag can be found again  |
| A confirmed tag removal                         | the next tag's Rename, else the one before, else the section heading           | successor element                 |

Two things that look like details and are not. A destination has to be a control whose name says
where the user now is, which is why Remove field goes to the next field's label rather than to its
Remove button: "Field label, edit, Year" places you, "Remove field, button" does not, and parks you
on a destructive control. And when a list empties there is no control left worth landing on, so the
destination is a focusable container — the collection's tab panel, which is already a tab stop
(`tabIndex={0}`, see below) and now holds the empty state that replaced the list, or the trash
`<section>` with `tabIndex={-1}` and `aria-labelledby` pointing at its heading, which is the pattern
`ErrorScreen.tsx` already uses. Focus arriving there is the only thing that tells a screen-reader
user the list is now empty, because "The trash is empty." and "Nothing on your wanted list" are
plain paragraphs, not live regions. Before the tabs (#42) the item list's container was the Items
heading; the panel is better, because it is where the list was and it says what the list emptied into.
A screen reader does not reliably read a focused container's content, though, so while an empty
state shows the panel is `aria-describedby` its title and description (ids from `useId`, passed to
`EmptyState` as `titleId`/`descriptionId`), and the attribute is absent while rows show. Focus
landing on the emptied panel then announces "Remaining, tab panel, Nothing on your wanted list, Items
whose status is Wanted or Ordered appear here." Unit and e2e tests assert that accessible description.

A search (#41) can take a row off the list as a side effect of an edit — and a sort can move it,
which in a browser loses focus too: React moves a keyed row with `insertBefore`, which takes the
node out of the document for a moment, and focus inside it falls to `<body>`. That is why the Save
handoff is chosen by the **page**, not the row, and why it runs even when the row is still listed: the row's own `useFocusHandoff` would unmount with
it. The page asks whether the item is still listed once the list has been fetched again, and the
hidden cases also say why the item went, through the announcer. An add the search hides says so in
the add form's own region.

The status tab (#42) hides rows the same way, so `isListed` asks both questions: is the item in the
list fetched for the search on screen, **and** does its status belong to the tab on screen (read
through a ref, like the search, because the user may switch tabs while a mutation is in flight). An
owned item saved as Wanted under Collected, an add whose status the tab does not show, and an Undo
pressed after switching to another tab all take the hidden path: the successor's Edit (or the panel
when nothing is left) and a message that names "search, filters or tab" as the reasons. Deleting the
last row in a tab lands on the panel and its empty state. `detail.tabs.test.tsx` and the status-tabs
block in `keyboard.spec.ts` pin each case.

A row's **Mark collected** takes the same path through the same `isListed`. Under All, or a status
sort that only moves the row, focus goes to the row's own Edit and the announcer says "Marked “Blue
Train” as collected.", because the button that went is the only thing on screen that changed.
Under Remaining the row leaves: focus goes to the row in its place, or to the panel when the last
remaining item was marked (R19), and the message adds "It is no longer in this list." Only the tab
can hide a mark, because a status change touches no field a search or filter reads, so that message
names no other reason. When the list cannot be fetched again (the refetch fails after its retries),
`useSetItemStatus` writes the server's answer into the cached lists, so the row says Owned before
the page reads it. The announcement is then true and the destination exists. Until that point the
mutation is pending, so the button stays, marked busy, and keeps focus.

A row's failure alert (`mark_error`, `delete_error`) is about one attempt. Opening the editor
resets both mutations, and starting a mark resets the delete's error and the reverse. Otherwise the
error state outlived the editor, and the alert was inserted and announced again when it closed,
even when the save had made it false: "its status has not changed" over an Owned badge. `detail.mark.test.tsx` and the "marking an item collected" block in
`keyboard.spec.ts` pin each case.

**A row-owned mutation whose follow-up belongs to the page chains it on the promise:**
`mutateAsync(input).then(pageCallback, ignoreRejection)`, never a `mutate`-level `onSuccess` (#42).
A `mutate`-level callback belongs to the calling component's `MutationObserver`, and the observer
only notifies while it has listeners. If the list fetched again has already unmounted the row by the
time the mutation settles, the callback is silently dropped: no undo toast after a Delete, and no
focus handoff after a Save that a search hides. The promise is not tied to any component, and it
resolves after the hook-level `onSuccess`, which awaits the invalidation, so the list is still fresh
when the page reads it. The rejection handler is empty on purpose: the mutation's error state already
drives the row's alert, and the query client's mutation cache reports it. This applies to an item
row's Save (`onSaved`), Delete (`onDeleted`) and Mark collected (`onMarked`), and to any later row
action whose result the page acts on. A finite set's header made this visible. Its counts query is a second refetch under the
items prefix, and that gave the browser time to commit the new list first. Before it, the race was
there but always won. `keyboard.spec.ts` pins both cases on a finite set with a target.

A handoff can be asked for after focus has already fallen: in a browser, a mutation's re-fetched
data can commit before the follow-up runs, unmounting the control first. The hook never treats
`<body>` as "the control still holding focus". That read made it wait out its deadline and leave
focus on `<body>` (#41, found by the tag manager's keyboard spec; jsdom's timing hid it). Asking
for a handoff also **schedules a commit of the host**, because the effect that completes it only runs
after one. A page whose callback changes none of its own state, such as the Save a search hides,
which only asks for the handoff and speaks through the shell, would otherwise never commit again,
and focus stayed on `<body>` (#42).

**A request made before the removal names the control it removes:**
`handOffFocus(destination, { removing: event.currentTarget })`. The hook then waits while that
element is still in the document, wherever focus is, and asks for the destination only once it has
gone (#42). `document.activeElement` cannot tell the two cases apart. A mouse click in Safari or
Firefox on macOS, an iOS tap, a VoiceOver double-tap and a programmatic `click()` all press a button
without focusing it, so a request made before the removal also finds `<body>`. Read alone, that
looks like "focus already fell", so the request resolves on the next commit. "The row at this index"
is then still the row being deleted, and focus leaves the document with it. On a finite set the
header's counts query can supply that early commit even without the scheduled one.

The callers that need `removing` are the ones whose removal lands after the request:

- a row's Delete, which removes the row once the server answers;
- a trash row's confirmed Delete forever, where `ConfirmButton` passes its confirm button to
  `onConfirm`;
- a filter chip, which goes once the router has moved.

A request made in the same handler as a synchronous removal does not need it, because React commits
both together: Cancel, Dismiss, Remove field and Clear filters are examples. Nor does a request made
after the removal, such as the hidden Save, which is the case "already on `<body>`" is right for.
A row's Mark collected is another (#42 review). Its follow-up runs once the cache holds the marked
item, and the commit the request schedules renders from that cache, so the effect sees the button
already gone. Naming the button there added nothing. It was also harmful: when the list could not
be fetched again, the button never left, and the request waited on it.

**A wait for a named control is bounded too**, by `REMOVAL_DEADLINE_MS` (ten seconds), checked on
each commit (#42 review). It is longer than the three-second destination deadline because it spans
a server round trip, and it is not counted in commits because the page may not commit while the
request is out. Without a bound, a control that never left kept a request alive. That happened to a
delete whose list could not be fetched again: whatever refetch finally removed the row moved focus,
long after the user had moved on. Ten seconds is where a press that has not finished has, for the
user, failed. A delete slower than that still completes, and focus falls to `<body>` as it did before
#367. That is the lesser harm. `focus-handoff.test.tsx` pins both sides of the bound. The
tag manager's `successor()` waits by its own guard instead, returning `null` while the removed tag is
listed. `keyboard.spec.ts` presses each of the first three without focus ("focus when the removed
control never held it").

So: **a new control that disables itself, or an action that removes the control that triggered it,
owes a spec in one of those two blocks.** The deletion case also owes a destination before it owes
code — the issue it comes from should say which APG rule it follows.

The rest of the accessibility floor is asserted without a browser, by the integration tests in
`apps/web/src/styles`: contrast ratios in both themes (`tokens.integration.test.ts`), the
`prefers-reduced-motion` gating of every animation (`motion.integration.test.ts`), and where the
focus ring is and is not drawn (`focus.integration.test.ts`).

### Naming a control that acts on one row

A control that appears once per row has to say which row it acts on, or a screen-reader user hears
the same word once per item with nothing tying a press to a record — and a focus destination
arriving on it says nothing about what just happened. The five in the app are an item's Mark
collected, Edit and Delete, and a trash row's Restore and Delete forever.

The pattern, which every interpolated-name string in the app already follows (`deleted_toast`,
`editing_item`, `added_status`, the trash prompts): **the visible verb first, then the row's name in
curly quotes** — `Delete forever “Kind of Blue”` — carried on an `aria-label` from a locale key, not
built in a component.

The order is not a matter of taste. WCAG 2.5.3 Label in Name (Level A) requires the visible label to
appear in the accessible name, and axe reads that strictly: `label-content-name-mismatch` tokenizes
both strings and demands the visible label be a **contiguous** run of the name. So `Delete forever
“Kind of Blue”` passes and the natural-sounding `Delete Kind of Blue forever` fails, because it
splits "Delete forever". The rule is tagged `wcag21a`, which is in the tag set `e2e/fixtures.ts`
scans with, so getting this wrong turns `pnpm test:e2e` red rather than shipping.

The curly quotes are silent: NVDA, JAWS and VoiceOver all default to a punctuation level that does
not speak `“ ”`, so they read as a short pause between the verb and the name — while braille users
see them, which is what makes a verb-shaped item name parseable. A colon would be spoken by some
configurations; this is the reason the separator is quotes and not punctuation.

In the keyboard sweep these names are built by five helpers at the top of `keyboard.spec.ts`, said
once because each appears in both a selector and a tab-order expectation. The expectations carry one
more thing than the selectors: Playwright appends an element's text content to a stop when the
accessible name differs from it, so a stop reads `button "Edit “Kind of Blue”": Edit` — the 2.5.3
relationship written out, failing both if a row stops naming itself and if the visible label drifts
out of the name.

### Tabs over a list

The collection page's **All / Collected / Remaining** tabs (`components/StatusTabs.tsx`, #42) are the
WAI-ARIA APG tabs pattern, written in the repo rather than taken from a library: three fixed tabs
are a short component, and no dependency was worth adding for them. What the pattern asks, and
where each part lives:

- A `role="tablist"` with an `aria-label` ("Items by status"), holding `<button role="tab">`s. A
  real button answers Enter and Space and keeps the global focus ring without any handler.
- **Roving `tabIndex`**: the selected tab is `0`, the others `-1`, so the tablist is one stop and
  the arrow keys move inside it. Left/Right move and wrap, Home/End go to the first and last, and
  Left/Right swap when the nearest `[dir]` is `rtl` (R12) — Home and End stay logical.
- **Automatic activation**: an arrow key selects as it moves focus. APG allows that only when a
  panel appears without a wait, which is why the tabs never fetch: they narrow the one list the page
  already holds, on the client (R4). A tab that triggered a request per arrow would need manual
  activation instead.
- Each tab has `aria-selected` and `aria-controls` pointing at the one `role="tabpanel"`, which is
  `aria-labelledby` the selected tab and has `tabIndex={0}` because what it opens on is text, not a
  control. The panel wraps the **whole** list area — count line, rows, empty and failure states — so
  whatever is showing is named by the tab. Biome's `noNoninteractiveTabindex` is suppressed on that
  one attribute, with the reason.
- Ids come from `useId()` through `scopedId` (see "Ids belong to the instance").
- Labels use literal locale keys (`tab_all`, `tab_collected`, `tab_remaining`) from a lookup
  object, never a template built from the value, so the keys can be found by search. No counts in
  the labels: a tab renamed by every edit is noise, and the panel's count line says how many.

The selected tab lives in the URL as `?show=collected|remaining`; All is the bare URL. Switching
navigates with `replace: true` and `resetScroll: false`, like a search keystroke: the arrows select
as they move, so pushing would make Back step through every tab passed over.
`validateItemSearch` drops an unknown value and treats `show=all` as no param (R17). It
names every key it drops as `undefined` rather than leaving it out, because TanStack Router lays the
validated search over the raw URL's: a key left out lets the raw value show through, and
`?show=owned` reached the screen as a tab that was none of the three. Naming it also makes the
address canonical on arrival: the router sees that the validated search stringifies differently
from the address and replaces it, so `?show=all&q=x` becomes `?q=x` in the address bar at once, with
no extra history entry, and no redirect of our own is needed. That was checked in Chrome, and
`detail.tabs.test.tsx` pins it against `router.history`.

A switch is announced like a search that settles, after `RESULT_ANNOUNCE_DELAY_MS`. What is spoken
is what is shown:

- the count line, which names the tab once one narrows the list: "2 items collected", or "2
  remaining items match “e”" when a search narrows it too, even though four items match under All;
- for an empty view, its empty state's title: "All collected", "3 more to find".

A search or filter whose matches all sit in another tab gets its own empty state. It says "No
remaining items match “penny”" and "1 item matches under All.", and both are spoken. Its **Show
them under All** button selects All and hands focus to that tab, passing `removing`, because the
button only goes once the router has moved. "Try fewer or shorter words" is kept for a search that
matched nothing anywhere. No empty state is ever built from placeholder data. While the next view
loads, the kept result belongs to the previous search, so an empty one shows the list's loading
state rather than claiming this view is empty ("4 more to find" on a set whose wanted item is
arriving). Kept rows stay on screen, marked `aria-busy`.

The tab is part of what `isListed` checks (see "Focus has to survive the action"). Under Remaining
the add form starts on Wanted, through `DynamicItemForm`'s `initialStatus` (R16). The form follows a
change of that prop only until the user picks a status; a reset clears the pick. That stops a tab
switch from turning a half-typed Ordered item into an Owned one, and a refetch from overwriting a
row editor's draft. `keyboard.spec.ts` walks the stops and the arrow keys; `a11y.spec.ts` scans each
tab, the three empty Remaining states, and the "matches only under another tab" state.

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
  the same bug. A page speaks through it with `const announce = useAnnounce()` from
  `lib/announcer.tsx` (a no-op outside the shell, so a screen rendered alone in a test is fine).
- **Each message is a node of its own** (#41), the technique `@react-aria/live-announcer` uses,
  built in rather than adopted because that library mounts regions of its own on `<body>`. A new
  node is an _addition_, which a polite region always reports — so identical words said twice are
  spoken twice, where writing the same text over itself would change nothing — and a route
  announcement and a page's own message in one tick both survive instead of the last write
  winning. Each node is removed after `ANNOUNCEMENT_LIFETIME_MS`; a removal is never read. For the
  same reason the region is **not** `aria-atomic`, which would re-read every message still held.
  A test counts what was said by watching added nodes (`recordAnnouncements` in
  `Shell.navigation.test.tsx`), not by reading the region's text at the end.

The announcement is made once per **page**, where a page is the matched route's own interpolated
pathname (`/collections/<id>`) — not `location.pathname`, which the router updates a render before
the matches resolve, so a guard on it announces the page being _left_; and not the translated
title, which would announce the current page again on every language change.

#### The address that matches nothing

`routes/not-found.tsx` is a **route**, `path: "$"`, added last in `routeTree.ts` — not the
router's `defaultNotFoundComponent`. That is the same rule as above read backwards: only a route
carries `staticData`, so only a route can be named and announced, and a component-shaped 404
leaves the document title saying whatever the previous screen was called. It is also why the
router's development warning about "TanStack Router's overly generic defaultNotFoundComponent"
(`renderRouteNotFound.js`) is gone rather than suppressed — an unknown URL now _matches_ a route,
so no notFound error is raised at all.

A wildcard ranks below every static and dynamic path, so the catch-all takes only what nothing
else claims; `not-found.test.tsx` pins that, URL by URL, because a splat that outranked a real
route would replace a working screen with "Page not found" and no test of the 404 itself would
notice.

The splat is not the whole story, and the part that is easy to get wrong is the part that has no
route at all. A URL the matcher cannot **decode** — `/%`, or a link truncated mid-escape — throws
a `URIError` inside `findRouteMatch`, which returns null, so it never reaches ranking and becomes
a _global_ not-found. `router.ts` therefore also configures `defaultNotFoundComponent` with the
same screen, and `NotFoundScreen` publishes its own name through `usePageTitle` — because that
path has no `staticData` to be named from, and without it the document would be called
"MyCollections". A `notFound()` thrown from a loader lands on the same backstop.

How far that reaches today is worth being exact about: under the current static host a malformed
path never gets to the app at all — Vite answers `/%E0%A4%A` with a bare 404 rather than
index.html — so the backstop covers the router being handed such a location from inside the app,
and every future `notFound()`. It is not a URL you can visit. The splat route is what a user
actually arrives at, and is the only one of the two that is named by `staticData`.

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

### What says it is the current page

TanStack's `<Link>` decides it is active by **prefix** match, and an active link carries a
hardcoded `aria-current="page"` and `data-status="active"` — `STATIC_ACTIVE_PROPS` in `link.js`,
spread _after_ the caller's props, so no prop can take them back off. `activeOptions` is the only
lever there is.

That default is right for the nav and wrong for everything else, which is the whole of the rule:

- **The nav says where you are, and which of the two things it means.** ARIA has two values and
  they are not interchangeable: `aria-current="page"` is "the current page within a set of pages"
  and `aria-current="true"` is "the current item within a set". So the nav says `page` only where
  the link _is_ the page on screen (`/collections`, `/settings`) and `true` where it is the section
  that page sits in (`/collections/<id>`, `/collections/new`, the editor). Saying `page` for the
  section — which is what the app did until #355, and what most apps do — tells a screen-reader
  user they are on a page they are not on.

  This is why the nav is `NavLink` in `Shell.tsx` rather than `<Link>`: `STATIC_ACTIVE_PROPS`
  hardcodes `"aria-current": "page"` and is spread after the caller's props, so `<Link>`
  structurally cannot emit anything else. `NavLink` calls `useLinkProps` — the library's own
  documented hook, which `<Link>` is itself a thin wrapper around — and renders the anchor, which
  costs dropping `type` and `disabled` (they belong on a button; `Link` strips them for the same
  reason) and asking the hook twice: once with this page's active rule, once with `exact` to answer
  the narrower question `page` actually means.
- **A link in a screen's own content says where you can go.** Every back link and every way out of
  a failure points at an _ancestor_ of the current URL by nature, so it matches that prefix always —
  and announces "current page" about the one link the user is about to follow _away_. Give those
  `activeOptions={CONTENT_LINK_ACTIVE_OPTIONS}` (`src/lib/links.ts`, which is `{ exact: true }`:
  the specification's own reading, where a link is current only when it points at the page you are
  on). The detail screen's "All collections", the editor's two back links, and the recovery links
  on the 404 and the crash screen were all getting this wrong (#354).
- **A 404 is inside nothing.** The address matched no route, so `/collections` is not a section the
  user is in — it is a string their wrong address happens to start with. The splat route declares
  `staticData: { notFound: true }`, the shell reads it (`useIsNotFound`), and the nav switches to
  exact matching for that page only: no address the splat catches can _equal_ a nav destination, so
  there the nav links are simply never current. Declared on the route rather than recognized in the
  shell for the same reason as `dynamicTitle` — the shell has to know during the same render as the
  route change, and a component-shaped answer arrives a commit after the nav has already spoken.

`Shell.navigation.test.tsx` sweeps every route for links that claim to be the current page and
asserts the exact list — including the _value_, since a sweep that only listed the links would pass
against the bug #355 fixed — so a new screen with a back link fails there rather than shipping the
bug again; the two 404 URLs are pinned in `not-found.test.tsx` and the crash screen's way out in
`router.test.tsx`. Note what the axe sweep does **not** do here: `aria-current="page"` is valid
markup on any link, so no automated rule can tell that it is pointing at the wrong page. This one
is only ever caught by asserting the list.

### Live regions the announcer cannot carry

The announcer is hidden and holds no controls, so a message that has to be **seen**, or that comes
with something to **press**, needs a region of its own. There are five. Three are on a
collection's page (`routes/collections/$id.tsx`):

- the undo toast (`.undo-toast-live`), whose words "Deleted …" and Undo button have to stay
  together on screen;
- the celebration when an action completes a finite set (`.celebration-live`, #42), which is seen
  as well as heard;
- the add form's "Added …" confirmation (`.add-item-live`, #368).

Two are on Settings: the import's progress and result (`.import-live`), and the trash's emptied
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
  shell's announcer, and four share a collection's page with it: the toast's, the celebration's and
  the add form's. A bare `[aria-live="polite"]` locator is ambiguous in both Vitest (which renders
  the real root route) and Playwright. `.undo-toast-live`, `.celebration-live`, `.add-item-live`,
  `.import-live` and `.trash-live` exist to be named.
- **One event, one message.** Two regions changing in the same tick are two announcements, read in
  an order nothing controls. When an action completes a finite set, the celebration carries the
  action's own sentence ("Marked “Penny” as collected.") followed by the news, and the announcer
  message — or, for Add item, the `.add-item-live` confirmation — that the action would have sent
  is skipped. Focus is chosen exactly as it would have been; only the words move.
- **Siblings, not nesting.** `.celebration-live` sits beside `.undo-toast-live` inside
  `.undo-toast-region`, so a completion landing while a toast is open is a second region speaking
  its own addition rather than a change inside the toast's. Neither the region nor the message
  takes the pointer (`pointer-events: none`). The message holds no control, no Undo and no close, so
  anything it took the pointer from would be dead for its whole ten seconds. Screen readers get it
  from the live region, not from hit testing.
- **Celebrate only a completion the page watched happen.** `watchCompletion()` reads the cached
  counts before the change is sent and again after the hook has fetched them anew. "Before" counts
  only when it is fresh: status `success`, `fetchStatus` idle, not invalidated, and fetched since
  the page mounted. Otherwise it is unknown, and unknown never celebrates. React Query serves the
  previous visit's counts at once while the mount refetch runs. If the set was completed elsewhere
  in the meantime (a Settings restore, an import, another device), reading those counts as
  "incomplete before" turned an unrelated save into a completion. The check is also told whether
  the change itself turned an item owned, because two changes in flight together each see the
  counts the other moved. The price is that a change sent while another's refetch is still in
  flight is not celebrated. Missing a completion beats claiming a false one.
- **A message that cannot change is not a live region at all.** A notice decided once — the setup
  screen's "storage will not remember your token", Settings' session-only token hint, the trash's
  loading line, a finite set's "add how many items the set has" hint (#42) — is in its screen's first commit or in none of them, so `role="status"` on it buys
  no announcement and makes every page-level status query ambiguous. Demote it to a plain `<p>`
  (`.form-hint` where the styling applies). The test to write is that it carries _no_ role, found
  by its text: a `queryByRole("status")` assertion goes vacuous the moment the role is gone.
- **Only layout needs a wrapper.** `.undo-toast-region` exists because the toast is `position:
  fixed` with `pointer-events` juggling. A region in normal flow — the two on Settings — is one
  element; an empty one is zero-height and its child's margins collapse straight through it.
- **No `aria-atomic` unless the whole region is one string.** Nothing in the app is any more: the
  shell's announcer holds one node per message (above), so it is not atomic either. A region whose content is replaced in place — a second
  delete renaming the toast — would re-read the entire toast instead of the name that changed.
- **This is about `aria-live`, not about `role="alert"`.** An `alert` is announced when it is inserted — the user agent fires an event on creation — so a failure surface that appears with its message inside it is correct, and the app's error screens are written that way. Everything above applies to the announcer and to the five class-named regions, which are `aria-live` and are not.
- **Scan the open state.** An interactive state no route-level scan reaches gets its own scan in
  `apps/web/e2e/a11y.spec.ts`, with the region asserted empty before the action and filled after.
  This is the only place the mechanism is proven in a real browser — jsdom has no accessibility tree
  at all. If the state times out, hold it open rather than racing the scan: the undo toast's timer
  stops while the pointer is over it, and where a message has no such hold, `page.clock.install()`
  freezes time for the scan and `page.clock.fastForward()` then proves the self-clear as well. A
  message with `pointer-events: none` cannot have its contrast checked by axe, which finds a text's
  background through `elementsFromPoint`, and that skips the element. So the celebration's scan
  passes `contrastExclude: ".celebration"` to `expectNoAccessibilityViolations`. That takes the
  message out of `color-contrast` alone; every other rule still runs on it. Its contrast is
  computed in `toast.integration.test.ts` instead. The same spec proves the message gives the
  pointer away: it scrolls a control under it and checks that `elementFromPoint` and a real click
  reach the control.
- **Give a message a life span, and empty the region in place.** A message that describes a finished
  event has to go away on its own when nothing on the page can clear it — Settings' emptied-trash
  confirmation outlived its list for the whole mount because the only thing that could have cleared
  it, the button, was gone with the trash (#336). Clear the _message_, never the region: a region
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
right-to-left _languages_ goes stale). The unit test deletes both accessors to exercise that path,
because Node's Intl has them and would otherwise hide it.

`document-language.integration.test.ts` keeps `index.html`'s hardcoded values equal to the
configured `fallbackLng` and its direction — change one and it fails.

Adding a locale therefore needs nothing here, as long as its bundle is passed to `i18n.init()`
with the others. A locale fetched lazily would not be: it resolves to the fallback first and
arrives on i18next's `loaded` event, which nothing listens to yet.

Note that a correct `dir` is not a right-to-left _layout_: the CSS still uses physical properties
in places, and directional icons are not mirrored. Labelling the document is #277; making the
layout survive the flip is #322.

## Debugging tips

- **Turborepo caches aggressively.** If a change isn't taking effect, try `pnpm turbo run <task> --force` or delete `.turbo/` in the affected workspace.
- **Node version mismatches** cause confusing failures. Run `fnm use` after `git pull` if `.nvmrc` changed.
- **Husky pre-commit hook** runs Biome and cSpell on staged files via lint-staged. If a commit is blocked, fix the reported issue and re-stage — don't bypass with `--no-verify`.
- **Don't reformat `CHANGELOG.md`.** release-please regenerates it on every release PR with `*` bullets, which Biome's Markdown formatter would rewrite to `-`. `biome.json` disables the formatter for that path precisely so the pre-commit hook's `biome check --write` leaves it alone; reformatting it by hand only creates churn that the next release undoes (#380).
- **cSpell false positives**: add project-specific terms to the `words` array in `cspell.json` rather than inline-ignoring.
- **`pnpm test:e2e` fails to start a server**: something is already on port 3111 or 4173. The harness refuses to reuse an existing server on purpose — it would be one it did not configure, backed by a database it did not choose. Free the port (`lsof -ti tcp:3111 -sTCP:LISTEN | xargs kill`) and re-run.
- **VS Code**: install the Biome extension for inline lint/format feedback and disable ESLint/Prettier to avoid conflicts.

## Getting help

- **Project board**: https://github.com/orgs/solve4it/projects/1
- **Issues**: https://github.com/solve4it/mycollections/issues
- **Security**: `security@solve4it.com` (see [`SECURITY.md`](./SECURITY.md))
- **Code of Conduct**: `conduct@solve4it.com` (see [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md))
