# Task workspace API handoff

## Delivered

- Canonical domain contract and validation in `packages/domain/src/task-workspace.ts`, exported through the domain index. Items preserve the `task`/`reminder` discriminant and existing canonical records, revisions, and source references.
- Authenticated read-only `GET /v1/task-workspace`, its dedicated service/route, generated canonical page schema in OpenAPI, and typed `api.listTaskWorkspace(query)` client.
- SQL filtering, ordering, grouping, total count, and keyset pagination over the existing shared physical table. No migration or mutation API was introduced; existing task/reminder APIs are unchanged.
- Read-only MCP `list_task_workspace`, full annotations/shared output envelope, and catalog discovery requiring both read scopes. Existing single-kind MCP tools retain their existing least-privilege discovery.

## Interface and semantics

- Query axes match Task 1: view, kind, status, List/Project IDs, literal text query, priority, exact tag, due/reserved state, inclusive exact ISO bounds, sort, group, cursor, and bounded limit.
- Omitted status resolves to `open` in All/Today/Upcoming, and `all` in History/Trash. History membership is terminal records or unavailable task containers. Explicit container filters permit archived/terminal context; active unscoped collections exclude unavailable containers.
- Mixed HTTP reads require `tasks:read` **and** `reminders:read`. `kind=task` requires only `tasks:read`; `kind=reminder` requires only `reminders:read`. Actual application authentication and least-privilege routing have integration coverage.
- Today uses the persisted user's planning timezone and includes overdue due dates plus reservations within the local day. Upcoming begins at the next local midnight. A past reservation never overrides a qualifying future due date in Upcoming's `relevantAt`.
- `groupKey` is `YYYY-MM-DD` in the planning timezone for date groups, the actual container ID for List/Project groups, or `none` for absent/ungrouped values. Group order precedes the selected item sort. Null sort values follow dated/estimated records; ID is the final stable tie-breaker.
- Default/date sort uses the relevant date ascending, with two default-sort exceptions: Today ranks overdue deadlines → reserved work → remaining due-today work before the timestamp; History/Trash default to recency descending. Explicit date sort remains chronological. `sort=reserved` uses Task `scheduledAt` ascending independently of deadlines, with missing reservations last; the legacy Scheduled alias can select this sort. Priority is high → medium → low, estimate is ascending, title is case-insensitive ascending, and newest/oldest use creation time.
- `readOnly=true` identifies unavailable container context outside Trash. Trash always permits guarded restore: the existing Task restore service falls back to Inbox and detaches unavailable Projects. A PostgreSQL regression proves both archived-list and terminal-project recovery with the expected revision increment.
- HMAC-signed cursors bind the user, normalized query, and planning timezone, retaining a fixed clock reference across midnight. Counts and each page share a read-only repeatable-read database snapshot.

## Verification

Passed:

```bash
pnpm exec vitest run packages/domain/src/task-workspace.test.ts packages/api-client/src/task-workspace.test.ts packages/api-client/src/client.test.ts apps/api/src/task-workspace-service.integration.test.ts apps/api/src/openapi.test.ts apps/mcp/src/task-workspace.test.ts apps/mcp/src/server.test.ts apps/mcp/src/tool-catalog.test.ts
# 8 files, 81 tests passed; includes 17 real PostgreSQL projection/recovery tests.

pnpm exec vitest run apps/api/src/app.integration.test.ts -t 'task workspace authenticates'
# 1 passed, 60 intentionally skipped by the focused name filter.

pnpm --filter @personal-os/api --filter @personal-os/domain --filter @personal-os/api-client --filter @personal-os/mcp typecheck
# All four packages passed.

pnpm exec biome check packages/domain/src/task-workspace.ts packages/domain/src/task-workspace.test.ts packages/domain/src/index.ts apps/api/src/task-workspace-service.ts apps/api/src/task-workspace-service.integration.test.ts apps/api/src/routes/task-workspace.ts packages/api-client/src/features/task-workspace.ts packages/api-client/src/task-workspace.test.ts packages/api-client/src/client.ts apps/api/src/app.ts apps/api/src/app.integration.test.ts apps/api/src/openapi.ts apps/api/src/openapi.test.ts apps/mcp/src/tools/task-workspace.ts apps/mcp/src/task-workspace.test.ts apps/mcp/src/tool-catalog.ts apps/mcp/src/server.ts
# 17 files checked; no fixes or warnings.

git diff --check -- apps/api/src apps/mcp/src packages/api-client/src packages/domain/src
# Passed.
```

The domain, projection, MCP, and OpenAPI checks were introduced before their corresponding implementation; initial failures were observed. The final Trash behavior was additionally verified with a specific failing recovery-projection regression before correction. A setup issue was corrected to use the migration-created protected Inbox rather than duplicate it. Client transport verification remains in its own package to respect API TypeScript package boundaries.

## Independent review correction: Today default tiers

The P2 review finding was reproduced with six mixed Task/Reminder records paginated one at a time: due-only morning work incorrectly preceded reserved afternoon work. The corrected SQL sorts by display group, Today default tier, missing-value rank, timestamp/sort value, and ID. Every cursor comparison includes the tier, so crossing from the reserved tier to earlier due-only timestamps neither skips nor duplicates records. Explicit `sort=date` retains chronological order. Cursor envelopes are now version 2; previously loaded version-1 cursors are safely rejected and require refreshing the view.

Latest correction verification:

```bash
pnpm exec vitest run apps/api/src/task-workspace-service.integration.test.ts
# Passed: all 18 real PostgreSQL integration tests, including the new limit=1 mixed Today regression.

pnpm exec biome check apps/api/src/task-workspace-service.ts apps/api/src/task-workspace-service.integration.test.ts
# Passed: no fixes applied.

git diff --check -- apps/api/src/task-workspace-service.ts apps/api/src/task-workspace-service.integration.test.ts
# Passed.

pnpm --filter @personal-os/api typecheck
# Blocked only by concurrent, unrelated Finance test errors:
# src/finance-service.integration.test.ts:2534 and :2539
# TransactionListQuery does not accept the property search.
# No task-workspace errors were reported; Finance files were left untouched.
```

## Scheduled compatibility correction: reserved-time sort

Added the explicit `reserved` sort to the canonical query and OpenAPI enum. The SQL sort value uses reserved time (`scheduledAt`), not the least of due/reserved dates. The existing keyset cursor and null-ranking logic retain stable paging. The typed client and MCP input inherit this canonical addition; web alias/label wiring remains owned by the integration agent.

A domain validation test and PostgreSQL regression were observed failing before implementation. The regression proves that a reservation tomorrow precedes a reservation next week even when the latter was due yesterday, traverses the result with `limit=1`, and verifies that unreserved Tasks and Reminders sort last.

```bash
pnpm exec vitest run packages/domain/src/task-workspace.test.ts apps/api/src/task-workspace-service.integration.test.ts apps/api/src/openapi.test.ts apps/mcp/src/task-workspace.test.ts packages/api-client/src/task-workspace.test.ts
# Passed: 5 files, 47 tests (19 PostgreSQL integration tests).

pnpm exec biome check --write packages/domain/src/task-workspace.ts packages/domain/src/task-workspace.test.ts apps/api/src/task-workspace-service.ts apps/api/src/task-workspace-service.integration.test.ts apps/api/src/openapi.ts
# Passed: formatting applied to the two changed layouts; no warnings.

git diff --check -- packages/domain/src/task-workspace.ts packages/domain/src/task-workspace.test.ts apps/api/src/task-workspace-service.ts apps/api/src/task-workspace-service.integration.test.ts apps/api/src/openapi.ts
# Passed.

pnpm --filter @personal-os/api --filter @personal-os/domain --filter @personal-os/api-client --filter @personal-os/mcp typecheck
# Domain and client passed. API reported only a concurrent unrelated Finance error:
# src/finance-service.ts:2505 references financeTransactions.rawMerchant, which does not exist.
# No task-workspace errors were reported; Finance files were left untouched.

pnpm --filter @personal-os/mcp typecheck
# Passed independently after the recursive run stopped at the unrelated API error.
```

## Remaining integration work and limitations

- The integration owner owns full `pnpm verify`, web/E2E verification, and final combined review; this worker did not run the repository-wide gate or touch web files.
- Cursor stability does not promise a historical snapshot across requests. Concurrent edits can change later pages and totals; the cursor freezes time-dependent membership, not the underlying records. Changing filters/timezone or rotating the signing key rejects the old cursor rather than silently reusing it.
- Exact totals and expression sorts operate over matching database rows, without a new materialized projection or index migration. Production-scale query-plan/performance evidence remains unmeasured.
- No notifications, autonomous maintenance, provider integration, live-fixture mutation, commits, or publishing were added/performed. Existing dirty work was preserved.
