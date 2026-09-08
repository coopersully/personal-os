# Shared Tasks Workspace Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent API work; the primary agent owns UI integration and verification. Preserve the existing dirty worktree; do not commit or publish.

**Goal:** One discoverable Tasks workspace for tasks and reminders, with visible navigation and useful, correctly paginated filtering and actions.

**Architecture:** Add a discriminated read projection over existing records. SQL owns filtering, ordering, grouping, counts, and cursor pagination. Existing domain-specific mutation APIs retain revision, authorization, audit, and recovery behavior. The web composes the existing shell, sidebar, responsive dialog, item and menu primitives.

**Tech Stack:** TypeScript, Zod, Drizzle/PostgreSQL, Hono, React Query, React Router, shadcn/Radix, Tailwind.

**Spec:** Approved conversation design and `docs/design/pages/commitments.md`; ontology in `docs/product/master-design.md` and `docs/product/tasks-ilo-charter.md`.

## Global Constraints

- Branding is always lowercase nohmi.
- All sidebar destinations and list/project links remain visible; no More views or navigation disclosure toggles.
- Task and reminder records remain distinct. Inbox is the protected Task list, not a reminder owner.
- No new persistence, external integration, autonomous maintenance, notification promise, or invented agent provenance.
- Server ordering precedes pagination. Mixed reads require both scopes; single-kind reads retain least privilege.
- Existing links, archived context, revision checks, move previews, and recovery remain available.
- Use existing semantic tokens, reicon registry, shadcn components, and shared secondary app bar.
- Batch actions operate only on explicitly selected records, preserve revision guards, and report failures individually.

### Task 1: Shared read query

**Owner/files:** API worker owns `packages/domain/src/task-workspace.ts`, its test and index export; `apps/api/src/task-workspace-service.ts`, route registration, OpenAPI and integration tests; typed client feature, MCP focused read tool/catalog/tests. No web edits.

**Interfaces:** Export `TaskWorkspaceQuery`, `TaskWorkspaceItem`, `TaskWorkspacePage`, `taskWorkspaceQuerySchema`. Typed client `listTaskWorkspace(query: Partial<TaskWorkspaceQuery>): Promise<TaskWorkspacePage>` calls `GET /v1/task-workspace`.

```ts
// Page projection: records are their existing canonical domain shapes.
type TaskWorkspaceItem = ({kind: 'task'; record: Task} | {kind: 'reminder'; record: Reminder}) & {
  deletedAt: string | null; readOnly: boolean; relevantAt: string | null; groupKey: string;
};
type TaskWorkspacePage = {items: TaskWorkspaceItem[]; nextCursor: string | null; total: number};
// Query: pagination + view(all/today/upcoming/history/trash), kind(all/task/reminder),
// status(all/open/completed/cancelled/archived), listId?, projectId?, query?, priority?, tag?,
// due(any/overdue/none/dated), reserved(any/none/scheduled), exact due/scheduled bounds,
// sort(default/date/reserved/priority/newest/oldest/title/estimate), group(none/date/list/project).
```

- [x] Add failing domain validation and real API integration tests: mixed kinds; Today planning timezone; scoped reads; history/archived read-only; trash; stable pagination with ties/nulls; global filter/sort/group/count; invalid cursor/bounds.
- [x] Run the focused tests to establish failures.
- [x] Implement SQL filtering, group/sort keyset pagination bound to query and user, canonical serialization, typed route/client, scoped read-only MCP adapter. No database migration or mutation endpoint.
- [x] Run domain/API/client/MCP tests and type checks; report exact commands and remaining failures.

### Task 2: Workspace composition

**Owner/files:** Primary owns `apps/web/src/features/tasks/*` navigation/page and focused new workspace controls/rows/query/batch helpers; minimal app wiring for reminder inspector; UI tests; `e2e/workspace-secondary-navigation.spec.ts`; page specification.

**Interfaces:** Consume `api.listTaskWorkspace`. Existing `TaskRow` for Today remains compatible. Mixed workspace rows use canonical records and existing task/reminder dialogs and guarded APIs.

- [x] Add failing tests for visible Inbox/Today/Upcoming/All/History/Trash, permanently visible projects, preserved old routes, query serialization, compatible selection actions and partial failures.
- [x] Replace collapsible navigation; retain list/project context menus and archived recovery links.
- [x] Render shared query results with compact kind-aware rows, Filter/Sort/Display controls, active chips, and scoped total. Grouping is server-side; optional row details are presentation-only.
- [x] Implement bounded explicit selection and compatible complete/reopen/trash/restore actions with per-record revisions and an honest failure summary. Keep move previews in the inspector.
- [x] Preserve deep-linked task/reminder inspectors and archive container browsing; add New reminder through create options.
- [x] Update the page specification and focused UI/E2E tests for desktop/mobile layout and keyboard interactions.

### Task 3: Integration and review

- [x] Review the API deliverable against Task 1, resolving concrete security/pagination defects before handoff.
- [x] Run focused integration/UI/E2E tests, type checking, formatting, theme/icon contracts, then `pnpm verify`.
- [ ] Inspect the live desktop and mobile screen without mutating user records; report unrelated baseline failures separately.
- [x] Review the integrated changes and report completed behavior and any remaining limitations without claiming unverified tests passed.

### Verification notes

- Final targeted run: 72 tests across 10 files passed, including real PostgreSQL, MCP/client,
  read-only inspectors, offset-aware filter dates, partial batch failures and deduplicated pagination.
- Independent reviews corrected Today ordering, legacy Scheduled chronology, read-only inspection,
  instant comparison and concurrent pagination deduplication; no unresolved review findings.
- Theme, icon and token contracts and E2E TypeScript check passed. Focused Biome/diff checks passed.
- Desktop Chromium acceptance passed at 320, 390 and 1100px. A broader mobile-browser run was
  interrupted by concurrent app/Finance edits and hot reload during login; do not treat it as a
  verified mobile-browser pass. See the integration follow-up below for any later rerun.
- `pnpm verify` was attempted and stopped at formatting errors in concurrent Finance changes
  (and an in-progress app-test edit, subsequently formatted). Latest web typecheck failures were
  Finance navigation test options only; API typecheck also encountered concurrent Finance errors.
  Neither repository-wide verification nor coverage is claimed green.
- App integration test adaptations and their exact results are in
  `2026-09-03-workspace-ui-test-report.md`; API checks are in
  `2026-09-03-task-workspace-api-report.md`. Unrelated Finance tests were not rewritten.

### Integration follow-up

- A fresh `app.test.tsx -t 'Task|task|Reminder|reminder'` run passed all 39 selected tests
  (141 unrelated tests skipped), bringing focused verification to 111 passing tests.
- The normal repository `env:restart` restored the local API; readiness returned HTTP 200.
  No fixtures or volumes were reset. The preview and mobile acceptance were subsequently blocked
  by unfinished concurrent Finance imports (`workspace-page`, then `period-review-page`), not a
  task query or action failure. Final live-screen/mobile acceptance remains unverified.
