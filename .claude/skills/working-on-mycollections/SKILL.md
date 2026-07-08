---
name: working-on-mycollections
description: How to execute any development task in this repo — planning from the board, TDD, runtime verification, commit/PR mechanics, and the specific mistakes this project punishes. Use at the start of every coding, review, or fix task in MyCollections.
---

# Working on MyCollections

This is the method, learned the hard way. CLAUDE.md holds the commands (bot config, tokens,
board IDs); this file holds the judgment. When they overlap, CLAUDE.md wins on mechanics.

## The loop for every task

1. **Start from the board, not the ask.** `gh project item-list 1 --owner solve4it` is the
   plan. Verify an issue exists (file one if not), move it to In Progress, branch
   `<type>/issue-<n>-<slug>` off a fresh `main`, apply the bot git config from CLAUDE.md.
2. **Read the real code before planning.** Never design from memory of "how apps like this
   work." Read the files you will touch and one neighbor that already does something similar.
   Before writing any UI markup, grep for the existing idiom first (e.g. checkboxes are
   `<label className="checkbox-row">` wrapping the input — copying the idiom avoids restyling
   bugs). Before adding a route, read an existing route in the same file.
3. **Slice by layer, one concern per commit.** The dependency order is:
   `packages/core` (types/Zod) → `packages/db` (repository) → `apps/api` (route) →
   `apps/web` (lib → component → route → locale JSON). Commit at each layer boundary with a
   conventional message referencing the issue (`fix(api): … #216`). Small PRs; split rather
   than grow.
4. **TDD, and watch the test fail.** Write the test first, run it, and confirm it fails *for
   the right reason* (missing module ≠ wrong behavior). Only then implement. Assert displayed
   or returned values with discriminating fixtures — `expect(body.fields).toEqual({title:
   "Dune"})`, not `expect(el).toBeInTheDocument()`.
5. **Gate, then verify at the surface** (see next section), then push as the bot and open the
   PR with `Closes #<n>`. After merge: move the issue to Done, pull main, delete the branch
   (`-D`; squash merges mean `-d` refuses).

## Orchestrate — don't solo

Use multi-agent orchestration (subagents and workflows) for authoring and review; token cost
is not a constraint on this project — correctness is. Concretely:

- **At pickup**: spawn a design/security review agent on your proposed approach before
  finalizing it (the #21 design review caught two would-be bugs before a line was written).
- **For review tasks**: fan out independent review dimensions, then adversarially verify each
  finding — a finding that survives an agent prompted to refute it is worth ten from a single
  pass. Report only what survived, labeled confirmed vs. plausible.
- **For broad sweeps** (audits, migrations, multi-file refactors): use a workflow with a
  discover → transform → verify pipeline rather than one long solo context.

## Verify before you claim anything

Tests passing is CI's evidence, not yours. Before "done" or "fixed":

- **Run the full gate**: `pnpm check` (biome + cSpell + typecheck + tests + builds across the
  workspace). Zero failures AND zero new warnings.
- **Drive the changed surface.** API change → start the server and curl the actual route;
  web change → load it in the browser and click. Launch recipe:
  ```bash
  DB_PATH=<scratchpad>/app.db API_TOKEN=dev-token PORT=3111 pnpm --filter @mycollections/api dev
  VITE_API_URL=http://localhost:3111 pnpm --filter @mycollections/web dev   # → :5173
  ```
  Paste the token on the setup screen. NEVER use the default DB path when testing — the
  working-tree `data/app.db` holds real collections. Never delete it.
- **Reproduce bugs before and after.** A bug fix without a pre-fix reproduction is a guess.
  Reproduce at the public surface (curl, browser), apply the fix, rerun the exact same
  commands, paste both outputs.
- **Probe past the happy path.** After confirming the claim, try to break it: omit optional
  fields, hit the route through the wrong parent id, send an empty body, toggle the setting
  off and confirm the behavior actually stops. The cross-collection PATCH bug (#216) was
  invisible to every existing test and fell out of one wrong-URL probe.
- **Compute, don't assert.** Claims like "accessible" or "no data leaked" need a script or a
  grep over captured output (WCAG ratios computed from hex; `grep` the server log for the
  fixture value that must not appear).
- **Report with evidence.** Verdict first, then numbered steps of what you did to the running
  app and what it showed (response bodies, log lines, screenshots). Mark at least one step as
  an off-path probe. If a step was skipped, say so plainly.

## Mistakes this project punishes (all observed, all real)

- **Mutate-then-check.** Verify ownership/existence BEFORE any write; a 404 must never leave
  a persisted side effect. Model: the DELETE handler in `apps/api/src/routes/items.ts`.
- **Spreading optional inputs.** `{status: body.status}` creates an explicit-`undefined` key
  that clobbers stored values in `{...existing, ...patch}`. Route handlers must build patches
  from present keys only; repositories pass patches through `stripUndefined`.
- **Leaking internals.** 5xx responses are a fixed generic body; error `message`/`stack` may
  contain user data, so error-report context is allowlisted (`SAFE_CONTEXT_KEYS` in core) —
  never add request bodies, headers, or query strings to logs or reports.
- **Hardcoded UI strings.** Every user-visible string is a key in
  `apps/web/src/locales/en/*.json` via `useTranslation`. cSpell also rejects invented words
  anywhere, including test fixtures — use real dictionary words (`do-not-report`, not
  numeric-substitution spellings of "secret"), or the pre-commit hook rejects the commit.
- **Skipping the a11y floor.** Labels tied to inputs, `role="alert"`/`role="status"` for
  feedback, 44px touch targets, visible focus, text contrast ≥ 4.5:1, non-text UI ≥ 3:1,
  animations behind `prefers-reduced-motion`. Biome enforces some of this; the rest is on you.
- **Environment traps.** `source ~/.zshrc` before pnpm in scripted shells. If husky fails
  with `pnpm: command not found`, the fnm node version lacks corepack shims — run
  `corepack enable` from that version's bin. Kill dev servers by port
  (`lsof -ti tcp:3111 | xargs kill`), not by job id — background shells don't share state,
  and a surviving server causes an address-already-in-use error that looks like your bug.
- **Fastify v5 specifics.** `setErrorHandler` receives `unknown` (narrow it; use core's
  `toReportableError`); the matched route pattern is `request.routeOptions.url` (undefined on
  unmatched routes), not `routerPath`.
- **Trusting "pre-existing flake."** Intermittent failures get root-caused in-session or a P1
  filed immediately — never waved off.

## Output structure

- **Commits**: conventional type + scope, issue ref, and the trailer
  `Assisted by: Claude <model> <noreply@anthropic.com>` (never `Co-Authored-By`).
- **PR body**: `Closes #<n>` first; then **What** (bulleted, by package); **Tests** (what was
  written failing-first); **Verification** (the before/after evidence from the running app);
  **Docs** (which files updated — or an explicit "no doc impact because …"; docs are part of
  Definition of Done, never a follow-up). Labels: type + `area:*` + phase + `AI-assisted`.
- **Answers to the user**: outcome in the first sentence, evidence next, options last. When
  reviewing, separate confirmed-by-running from suspected-by-reading, and file issues for
  real bugs instead of leaving them in chat.
- **Board hygiene at the end of every task**: statuses moved, issues closed with a pointer to
  the PR, local main pulled, merged branches deleted, no dirty working tree left behind.
