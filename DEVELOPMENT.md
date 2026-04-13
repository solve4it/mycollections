# Development Guide

This guide takes you from a fresh clone to a running MyCollections dev environment. If you're here to contribute code, also read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow and Definition of Done.

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

> Note: the DevContainer setup is tracked in [#6](https://github.com/solve4it/mycollections/issues/6) and is not yet present. Once it lands, open the repo in VS Code and choose **"Reopen in Container"** (or run `Dev Containers: Reopen in Container` from the command palette).

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

> Note: the runtime apps (`api`, `web`) are scaffolded but not yet implemented — those commands below are placeholders. The docs site is live.

```bash
# API (Fastify) — placeholder
pnpm --filter @mycollections/api dev

# Web app — placeholder
pnpm --filter @mycollections/web dev

# Docs site (Astro Starlight) — http://localhost:4321/mycollections/
pnpm --filter @mycollections/docs dev
```

## Working on the docs site

The docs site at `apps/docs` is an [Astro Starlight](https://starlight.astro.build/) project that renders the shared markdown in `docs/` at the repo root, plus its own Starlight-native landing page.

- Shared user docs are copied from `docs/*.md` into `apps/docs/src/content/docs/user/` by `apps/docs/scripts/copy-shared-docs.mjs`, which runs automatically as a `predev` / `prebuild` hook.
- The generated `user/` directory is gitignored — never edit files there; edit the source in `docs/` instead.
- The Starlight splash page lives at `apps/docs/src/content/docs/index.mdx` and is Starlight-specific (not shared with in-app Help).
- Deployment to GitHub Pages happens automatically via `.github/workflows/deploy-docs.yml` on push to `main` when `apps/docs/**` or `docs/**` changes.

```bash
pnpm --filter @mycollections/docs dev      # local dev server
pnpm --filter @mycollections/docs build    # static build into apps/docs/dist
pnpm --filter @mycollections/docs preview  # preview the production build
```

See [`docs/README.md`](./docs/README.md) for the dual-rendering pattern that keeps Starlight and the planned in-app Help in sync.

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
