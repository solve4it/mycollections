# MyCollections - Claude Code Instructions

## Project
MyCollections is a personal collection management application with a plugin architecture.
- **Organization**: Solve4It (solve4it.com)
- **Repo**: solve4it/mycollections
- **License**: Apache 2.0
- **Plan**: The GitHub project board is the source of truth — issues are the plan items, in order, with live status. There is no separate plan file.
- **Project board**: https://github.com/orgs/solve4it/projects/1

## Bot Workflow (CRITICAL)

All commits and PRs MUST be made as the `solve4it-bot[bot]` GitHub App. The repo owner (`shusak`) reviews and approves PRs.

### Git config for every branch
```bash
git config user.name "solve4it-bot[bot]"
git config user.email "3274849+solve4it-bot[bot]@users.noreply.github.com"
git config commit.gpgsign false
```

### Get a bot token (expires after 1 hour, regenerate as needed)
```bash
BOT_TOKEN=$(~/.config/solve4it/get-bot-token.sh)
```

### Push using bot token
```bash
git push "https://x-access-token:${BOT_TOKEN}@github.com/solve4it/mycollections.git" <branch-name>
```

### Create PR using bot token
```bash
curl -s -X POST \
  -H "Authorization: token $BOT_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/solve4it/mycollections/pulls" \
  -d '{"title":"<title>","body":"<body>","head":"<branch>","base":"main"}'
```

## Issue Workflow

Every piece of work follows this process:
1. Verify a GitHub issue exists on the project board
2. Move the issue to `In Progress` on the project board
3. Create a feature branch: `<type>/issue-<number>-<short-description>`
4. Configure git for bot (see above)
5. All commits reference the issue number (e.g., `feat: add collection CRUD #42`)
6. Push and create PR as bot (see above). PR body must include `Closes #<number>`
7. Reply to any PR review comments explaining fixes or answering questions
8. After merge, move issue to `Done` on the project board and close it

### Project board IDs
- Project ID: `PVT_kwDOEDb4es4BTKDH`
- Status field ID: `PVTSSF_lADOEDb4es4BTKDHzhAer4Y`
- Status options: Todo=`f75ad846`, In Progress=`47fc9ee4`, Done=`98236657`

### Moving an issue on the board
```bash
ITEM_ID=$(gh project item-list 1 --owner solve4it --limit 100 --format json | jq -r '.items[] | select(.content.number == <ISSUE_NUM>) | .id')
gh project item-edit --project-id PVT_kwDOEDb4es4BTKDH --id "$ITEM_ID" --field-id PVTSSF_lADOEDb4es4BTKDHzhAer4Y --single-select-option-id <STATUS_OPTION_ID>
```

## Conventions

- **Commits**: Conventional format — `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`. Commit early and often — capture work at every logical boundary (e.g., after config, after tests, after implementation), not just at the end.
- **Branches**: `<type>/issue-<number>-<short-description>`
- **PRs**: One feature per PR, squash merged, must link to an issue, add labels. Keep PRs as small as possible — split into multiple PRs if an issue touches too many files.
- **PR Labels**: Include relevant type, area, phase, and `AI-assisted` labels
- **Testing**: TDD — write failing tests first, then implementation. Assert the actual displayed/returned values with discriminating fixtures, not just element presence — see "Assert behavior, not presence" in CONTRIBUTING.md.
- **Accessibility**: UI changes must keep `pnpm test:e2e` green — the Playwright + axe sweep over every route, at two viewports and both color schemes. It is intentionally outside `pnpm check` (it needs a browser); run it separately. A new route or a new interactive state gets a scan in `apps/web/e2e/a11y.spec.ts`. A new route also declares `staticData: { titleKey }` so it is named and announced, and a new live region is fed through the shell's announcer instead of being mounted with its text already inside — see "Page titles and route announcements" in DEVELOPMENT.md. One-time setup: `pnpm --filter @mycollections/web exec playwright install chromium`.
- **Dependencies**: Always use the latest stable version; run `depscore` before introducing any new dependency
- **Docs in every PR**: README, CONTRIBUTING, DEVELOPMENT, CLAUDE.md, and any package/feature docs affected by the change must be updated in the same PR. Docs are part of the Definition of Done, never a follow-up. If a change has no doc impact, state that explicitly in the PR body.
- **Linting**: Biome (spaces, indent 2, line width 120, built-in a11y rules — no ESLint needed)
- **Spell check**: cSpell
- **Node**: Version pinned in `.nvmrc`, use fnm

## Project skill

`.claude/skills/working-on-mycollections/SKILL.md` teaches the working method for this repo —
the task loop, runtime-verification discipline, known pitfalls, and output structure. Invoke it
at the start of any coding, review, or fix task. This file holds the mechanics (bot config,
tokens, board IDs); the skill holds the judgment. Keep both current together.

## Keeping this file current
Update CLAUDE.md whenever conventions, workflows, or project practices change. This file is the source of truth for all Claude Code sessions — if it's stale, new sessions will follow outdated instructions.

## When plan changes
If items are added to or removed from the plan, create or close the corresponding GitHub issues to keep the project board in sync.
