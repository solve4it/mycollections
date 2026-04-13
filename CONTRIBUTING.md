# Contributing to MyCollections

Thanks for your interest in contributing. This document is the source of truth for how changes get into this repo. Please read it in full before opening your first PR — contributions that don't follow the process will be asked to rework.

By participating, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Traceability: every change starts with an issue

All work — features, fixes, refactors, chores, docs — must be tied to a GitHub issue before any code is written.

1. **Find or open an issue** on the [project board](https://github.com/orgs/solve4it/projects/1). If one doesn't exist for what you want to do, open one and wait for triage.
2. **Move the issue to `In Progress`** when you start work, so others know it's claimed.
3. **Reference the issue number** in your branch name, every commit, and the PR body.
4. **Link the PR to the issue** using `Closes #<number>` in the PR body so the issue closes automatically on merge.

This traceability is not optional. It's how we keep scope tight, avoid duplicate work, and connect code changes back to the reasoning that motivated them.

## Branch naming

Use the form:

```
<type>/issue-<number>-<short-description>
```

Examples:

```
feat/issue-42-add-collection-crud
fix/issue-108-renovate-grouping
docs/issue-15-contributing
chore/issue-112-tighten-package-json
```

`<type>` matches the conventional-commit type (see below). `<short-description>` is kebab-case, ~3–5 words.

## Conventional commits

All commits use the [Conventional Commits](https://www.conventionalcommits.org/) format. This is enforced by commitlint on every commit.

```
<type>(<optional-scope>): <short summary> #<issue-number>

<optional longer body>
```

**Types:**
- `feat` — new feature
- `fix` — bug fix
- `chore` — tooling, config, dependencies, build system
- `refactor` — code change that neither fixes a bug nor adds a feature
- `test` — adding or updating tests
- `docs` — documentation only
- `perf` — performance improvement
- `style` — formatting, whitespace, no semantic change
- `ci` — CI/CD configuration

**Examples:**

```
feat: add collection CRUD #42
fix: drop Renovate vuln-alert rule clobbering groupName #108
docs: write contributing guide #15
chore: tighten package.json ranges to match lockfile #112
```

Commit early and often — capture work at every logical boundary (after config, after tests, after implementation) rather than a single giant end-of-task commit. Atomic commits make reviews faster and bisects possible.

## Development workflow: TDD

MyCollections uses **test-driven development** across all packages. The loop is:

1. **Red** — write a failing test that describes the behavior you want
2. **Green** — write the minimum code to make the test pass
3. **Refactor** — clean up the code and tests while keeping them green
4. Commit at each step (`test:` for red, `feat:`/`fix:` for green, `refactor:` for the cleanup)

Don't open a PR with production code that has no tests. Don't open a PR where tests were written after the fact to pad coverage — the point of TDD is that tests drive design, not that they exist.

## Pull request process

- **One feature per PR.** If your issue touches many unrelated files, split it into multiple PRs, each with its own issue if needed.
- **Keep PRs small.** A reviewer should be able to understand the whole change in one sitting. Prefer a series of small PRs over one large one.
- **Squash merge.** Every PR is squashed into a single commit on `main`. The squash commit message is the PR title, so write PR titles in conventional-commit form.
- **Link the issue** with `Closes #<number>` in the PR body.
- **Add labels.** At minimum: the change type (`feature`, `bug`, `chore`, etc.), the area (`area-core`, `area-ui`, etc.), the phase (`phase-0` during bootstrap), and `AI-assisted` if applicable.
- **Update docs as part of the PR** (see Definition of Done).
- **Reply to review comments** explaining how each one was addressed.

## Definition of Done

Before marking a PR ready for review, tick every item:

- [ ] The PR is linked to an issue via `Closes #<number>`
- [ ] Commits follow conventional-commit format and reference the issue number
- [ ] Tests were written TDD-style (red first, then green)
- [ ] All tests pass locally (`pnpm test`)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] Lint passes with no new warnings (`pnpm lint`)
- [ ] Spellcheck passes (`pnpm spellcheck`)
- [ ] **Docs are updated in the same PR** — README, CONTRIBUTING, DEVELOPMENT, CLAUDE.md, the docs site, and any package-level docs affected by the change. Docs are part of Done, never a follow-up. If the change has no doc impact, state that explicitly in the PR body.
- [ ] User-facing strings are extracted for i18n (once the i18n pipeline is in place)
- [ ] A11y rules pass (Biome's built-in a11y rules must be green; screen-reader and keyboard flows considered for UI work)
- [ ] For new dependencies: `depscore` was checked (see CLAUDE.md)
- [ ] CI is green on the PR

## Reporting bugs and requesting features

- **Bugs**: open an issue with reproduction steps, expected vs. actual behavior, and environment info (OS, Node version, browser if applicable).
- **Features**: open an issue describing the use case, not just the mechanism. Explain *why* the feature matters before proposing *how* to build it.
- **Security issues**: do NOT open a public issue. Email `security@solve4it.com` — see [`SECURITY.md`](./SECURITY.md).

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Report violations to `conduct@solve4it.com`.
