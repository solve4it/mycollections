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
- **Web app (Vite + React)** on `http://localhost:5173`. The port is pinned with `strictPort`, so if something else holds 5173 Vite fails loudly instead of moving to 5174 — the API's dev CORS allowlist names these exact origins (#242).

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

## Observability

### Logging (API)

The API logs structured JSON via Fastify's built-in [pino](https://getpino.io/) logger — every request is logged automatically. `LOG_LEVEL` overrides the level (`fatal`–`trace`; defaults to `debug` in dev, `info` in production). `Authorization` and `Cookie` request headers are redacted. Two rules when touching logging:

- **Never log request bodies** — they contain collection data. The default `req` serializer only logs method/URL/host; don't add a custom serializer that includes headers or bodies.
- **Never put user data or secrets in query strings** — the request URL is logged as-is.

### Error reporting

`packages/core` exports the `ErrorReporter` interface plus `createErrorReporter` / `buildErrorReport`, which sanitize every capture: only allowlisted context keys (`SAFE_CONTEXT_KEYS` — route, method, statusCode, componentStack, source, reqId) survive, so collection data and credentials can't leak into a report. Error `message`/`stack` pass through (truncated) and may contain user data — any future sink that transmits reports off-device must scrub them first; today's sinks are local-only (pino on the server, browser console on the web).

Wiring:

- **API** — the Fastify error handler reports unhandled (5xx) errors and returns a generic `500` body so internal details never reach clients; 4xx errors pass through untouched.
- **Web** — route render errors are caught by TanStack Router (`defaultOnCatch`), everything else by the top-level `ErrorBoundary`, `window` `error`/`unhandledrejection` handlers, and the React Query cache `onError`. Users can opt out via Settings → Privacy (persisted in `localStorage`, checked on every capture).
- **Never render `error.message` to the user** — it is never sanitized and can carry internals or collection data (a malformed response makes `res.json()` throw a `SyntaxError` quoting the payload). Show a translated string; the reporter keeps the original.

### Query state on the web

The app-wide QueryClient is built by `createQueryClient` in `apps/web/src/lib/query-client.ts`, which sets `networkMode: "always"`. React Query decides connectivity from the window's `online`/`offline` events, but the API runs on the same machine and stays reachable while the internet is down — under the default mode an offline browser holds every request in `fetchStatus: "paused"`, so the query never fetches, never rejects, and never reaches `onError`.

That does not remove the paused state entirely (a hidden tab still pauses a retry), so when rendering a query, follow the rule the two collection routes use:

- Treat `data === undefined` as the only state that replaces the page — never `isLoading`, which is `isPending && isFetching` and is therefore `false` for a paused query.
- Keep "failed to load" and "loaded, and there is nothing" as separate outcomes. Falling back to `data ?? []` tells the user their collection is empty when the request actually failed.
- Once data has loaded, keep it on screen if a later reload fails and show a warning alongside it, rather than replacing it with an error page.

## Working on the docs site

The docs site at `apps/docs` is an [Astro Starlight](https://starlight.astro.build/) project that renders the shared markdown in `docs/` at the repo root, plus its own Starlight-native landing page.

- Shared user docs are copied from `docs/*.md` into `apps/docs/src/content/docs/user/` by `apps/docs/scripts/copy-shared-docs.mjs`, which runs automatically as a `predev` / `prebuild` hook.
- The generated `user/` directory is gitignored — never edit files there; edit the source in `docs/` instead.
- Relative Markdown links between shared docs (`[Items](./items.md)`) are rewritten to real page URLs at build time by `apps/docs/scripts/satteri-relative-doc-links.mjs`. Keep writing them the relative way — that is the form GitHub needs, and the rewrite is what makes it work on the site too.
- `apps/docs/scripts/check-built-links.mjs` runs as a `postbuild` hook and fails the build if any in-site link still points at a `.md` file, or points at a page that was not built. A link that climbs out of `docs/` (`../../README.md`) is deliberately not rewritten and will fail this check — link to those on GitHub by absolute URL instead.
- `apps/docs/scripts/check-built-pages.mjs` runs alongside it and fails the build if a doc did not reach the site with its content: a shared doc the copy step missed, a doc that produced no page, or a page published with an empty body. That last one is the reason it exists — Starlight catches an error thrown while rendering a page, logs it, and finishes the build green, publishing a page with its navigation and footer intact and nothing in between (#294).
- `apps/docs/site.mjs` holds the `site` and `base` values shared by the Astro config and those two scripts.
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

Integration and E2E test harnesses will be added as features land that need them (tracked in Phase 2+ issues).

## Debugging tips

- **Turborepo caches aggressively.** If a change isn't taking effect, try `pnpm turbo run <task> --force` or delete `.turbo/` in the affected workspace.
- **Node version mismatches** cause confusing failures. Run `fnm use` after `git pull` if `.nvmrc` changed.
- **Husky pre-commit hook** runs Biome and cSpell on staged files via lint-staged. If a commit is blocked, fix the reported issue and re-stage — don't bypass with `--no-verify`.
- **cSpell false positives**: add project-specific terms to the `words` array in `cspell.json` rather than inline-ignoring.
- **VS Code**: install the Biome extension for inline lint/format feedback and disable ESLint/Prettier to avoid conflicts.

## Getting help

- **Project board**: https://github.com/orgs/solve4it/projects/1
- **Issues**: https://github.com/solve4it/mycollections/issues
- **Security**: `security@solve4it.com` (see [`SECURITY.md`](./SECURITY.md))
- **Code of Conduct**: `conduct@solve4it.com` (see [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md))
