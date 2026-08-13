# Task 9 report: canonical integration consumers and QA fixtures

## Scope delivered

- Migrated daily-brief Task reads from a boolean completed bucket to canonical `lifecycle`
  queries for open and completed Tasks.
- Removed every Task decision in the automation service that depended on legacy status. Daily-brief
  inclusion now uses lifecycle and deletion, capacity uses reserved time, and the existing
  `overdue` / `due_today` / `next` / `inbox` recommendation vocabulary is derived from timing.
- Migrated Agent Access Task previews to the canonical open-lifecycle query.
- Kept the already-canonical Today and workspace consumers in `apps/web/src/app.tsx` unchanged.
- Rebuilt populated QA Task fixtures around the database-created Inbox plus deterministic Personal,
  Work, and Shopping Lists; three Projects; and representative open, due, scheduled, completed,
  cancelled, and trashed Tasks.
- Added two `Quarterly reset` Projects in different Lists and two Work Projects with a Task assigned
  to one, providing realistic same-List Task Project-move coverage.
- Preserved ordinary local accounts during fixture reset and verified a second load produces no
  List or Project name collisions.

## TDD evidence

### RED

The required focused command was run before production changes:

```bash
pnpm exec vitest run apps/api/src/app.integration.test.ts apps/web/src/app.test.tsx \
  -t "daily brief|agent access|QA fixture" --reporter=verbose
```

It failed for the intended product reasons:

- legacy fixture Tasks violated `reminders_task_fields_check` because they had no canonical List,
  lifecycle, or revision;
- the daily brief passed booleans to its Task reader and returned no lifecycle-selected Tasks;
- Agent Access did not issue the required `{ lifecycle: "open", limit: 100 }` preview query.

The Agent Access test selector was tightened before production work so its RED observed the
canonical preview contract rather than an incorrect accessibility-role assumption.

### GREEN

Final required command:

```bash
pnpm exec vitest run apps/api/src/app.integration.test.ts apps/web/src/app.test.tsx \
  -t "daily brief|agent access|QA fixture" --reporter=dot
```

Result: 4 passed, 134 skipped.

The daily-brief regression deliberately gives open Tasks contradictory legacy metadata and proves
that open due and reserved-time Tasks remain included, cancelled and trashed Tasks remain excluded,
completed Tasks remain in the summary, capacity distinguishes reserved and flexible work, and
recommendation urgency comes from timing.

## Verification

- Full API integration file: 40/40 passed.
- Full web app file: 98/98 passed. Existing jsdom navigation diagnostics and the existing zero-size
  chart diagnostic remained non-failing.
- API typecheck: passed.
- Web typecheck: passed.
- API production build: passed.
- Web production build: passed. Existing Tauri mixed-import and large-chunk warnings remained
  informational.
- Owned-file Biome check: passed.
- `git diff --check`: passed.
- `pnpm fixtures:load`: loaded all 9 named QA accounts successfully against the isolated worktree
  PostgreSQL service.
- `pnpm env:status`: PostgreSQL was ready; web, API, and MCP application processes were down, so the
  lifecycle command returned its expected non-zero unhealthy-runtime status. No ad hoc server was
  started for this fixture-only task.

The first serial full-API attempt hit a transient Testcontainers port-binding timeout while other
container work was active. A later serial retry reached the suite and passed 40/40.

## Self-review

- Confirmed no Task query, inclusion rule, recommendation, capacity calculation, Agent Access
  preview, Today consumer, or fixture decision branches on `legacyStatus` or a Task `status` field.
- Confirmed `inbox` and `next` remain only recommendation urgency presentation values for Tasks;
  fixture Task storage never generates `next`.
- Confirmed Reminder `completed` and Reminder `next` uses are unchanged and remain Reminder-domain
  behavior rather than Task compatibility leakage.
- Confirmed the user trigger creates the sole Inbox. The loader queries that generated ID before
  inserting Inbox-assigned Tasks and never inserts, renames, updates, or deletes the protected Inbox
  directly.
- Confirmed deterministic standard List, Project, and Task IDs are user-scoped and that Project
  duplicate names occur only across different Lists.
- Confirmed all Task fixture rows satisfy lifecycle timestamp, deletion, List ownership, Project
  same-List, and positive revision constraints.
- Confirmed only assigned Task 9 files changed; `apps/web/src/app.tsx` required no diff because Task 8
  had already migrated its consumers.

## Deferred documentation drift

Task 10 still owns the prose update. `docs/engineering/qa-fixtures.md` and the planning QA runbook
still describe the legacy Inbox/Next/Scheduled route model and do not yet name Lists, Projects,
canonical Views, or the trigger-created Inbox behavior.

## Blockers

None.
