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

### Assert behavior, not presence

The most common defect a passing test still lets through is a **semantically-wrong but type-valid value** — a number or string that compiles and renders fine but means the wrong thing (e.g. showing a collection's _field count_ where the _item count_ was intended). Guard against it:

1. **Assert the rendered value, not just that an element exists.** `findByText("Books")` proves the card rendered; it says nothing about whether the count next to it is right. Assert the actual text/number the user sees.
2. **Make fixtures discriminating.** Every plausible-but-wrong source should produce a _different_ value than the right one. If a collection in your fixture has 1 field and 1 item, a `fields.length`-vs-`itemCount` mix-up is invisible — give it 1 field and 3 items so only the correct source yields "3". The same applies to id-vs-label-vs-value lookups: keep all three distinct (id `title`, label `Title`, value `Zelda`) so a wrong mapping fails.
3. **Prefer adding the correct data primitive over improvising.** When a view needs a value the model doesn't carry, add it to the API/model (e.g. `itemCount`) rather than reaching for a nearby number that happens to be in scope. Missing data is what makes wrong substitutes attractive.
4. **Run the app on representative data before calling it done.** Types and unit tests miss semantic mistakes that are obvious on screen. View the happy path with data where the right answer is known ("this collection has 3 items"). See the `verify` / `run` helpers.

`apps/web/src/components/DynamicItemForm.test.tsx` is the reference example: distinct id/label/value fixtures, and it asserts the exact submitted object keyed by field id.

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
- [ ] Tests assert the actual displayed/returned values (not just element presence) using discriminating fixtures — see "Assert behavior, not presence"
- [ ] All tests pass locally (`pnpm test`)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] Lint passes with no new warnings (`pnpm lint`)
- [ ] Spellcheck passes (`pnpm spellcheck`)
- [ ] **Docs are updated in the same PR** — README, CONTRIBUTING, DEVELOPMENT, CLAUDE.md, the docs site, and any package-level docs affected by the change. Docs are part of Done, never a follow-up. If the change has no doc impact, state that explicitly in the PR body.
- [ ] User-facing strings are extracted for i18n (once the i18n pipeline is in place)
- [ ] A11y rules pass (Biome's built-in a11y rules must be green; screen-reader and keyboard flows considered for UI work)
- [ ] For UI changes, `pnpm test:e2e` is green — the axe sweep over every route, at both viewports and both color schemes. New routes and new interactive states get a scan in `apps/web/e2e/a11y.spec.ts`; see DEVELOPMENT.md for the one-time browser install.
- [ ] For new dependencies: `depscore` was checked (see CLAUDE.md)
- [ ] CI is green on the PR

## Reporting bugs and requesting features

- **Bugs**: open an issue with reproduction steps, expected vs. actual behavior, and environment info (OS, Node version, browser if applicable).
- **Features**: open an issue describing the use case, not just the mechanism. Explain *why* the feature matters before proposing *how* to build it.
- **Security issues**: do NOT open a public issue. Email `security@solve4it.com` — see [`SECURITY.md`](./SECURITY.md).

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Report violations to `conduct@solve4it.com`.
