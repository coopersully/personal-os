# Task Organization Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a clean Tasks workspace with protected Inbox organization, Lists, Projects, canonical Task lifecycle and timing, revision-safe mutations, and a complete truthful MCP surface without losing or silently reinterpreting any existing task.

**Architecture:** `packages/domain` owns the final List, Project, and Task contracts. PostgreSQL adds `task_lists` and `task_projects`, then expands the existing mixed `reminders` table with Task-only organization, lifecycle, revision, and idempotency columns plus kind-sensitive constraints. Migration `0054` creates one Inbox per user and upgrades every existing Task in place without changing its ID, timing, or audit timestamps. The API treats the canonical Task columns as authority and exposes the old mixed status only as bounded review metadata. Physical Task extraction happens later, in the Prompt/reminder compatibility plan, when the remaining reminder rows have an explicit destination and no dual-write period is required.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle/PostgreSQL, React, TanStack Query, React Router, MCP, Vitest, Playwright.

## Global Constraints

- The normative definitions and invariants remain in `docs/superpowers/specs/2026-08-12-tasks-tracking-ontology-classification-design.md`; this plan may not weaken them for implementation convenience.
- A List is persistent organization. A Project is a finite outcome. A Task is one independently completable action. Today, Upcoming, Scheduled, Completed, Cancelled, and Trash are Views, never containers.
- Every Task has exactly one `listId`; `projectId` is optional and, when present, must identify a Project owned by the same user in the same List.
- Every user has exactly one system Inbox List. It cannot be renamed, archived, soft-deleted, or directly deleted.
- List names are normalized with Unicode NFKC, trimmed, internal whitespace collapsed, and the plan's versioned locale-independent case normalization. Non-deleted List names are unique per user. `today`, `upcoming`, `scheduled`, `completed`, `cancelled`, and `trash` are reserved. Project names use the same normalization and are unique per non-deleted List.
- Task and Project lifecycle is only `open`, `completed`, or `cancelled`. Scheduling and deadlines are independent nullable timing axes. `archivedAt` and `deletedAt` are availability, not lifecycle.
- A Project move is atomic with all of its Tasks. A Task moved outside its Project's List is explicitly detached unless a destination Project in the destination List is supplied. Neither behavior may be hidden in a generic update.
- Completing a Project with open Tasks and archiving a List with active contents must return a structured conflict with exact resolution choices; no implicit cascade is permitted.
- Agent updates, transitions, moves, archives, trash, and restore require the current integer revision. The database compare-and-swap and audit write occur in the same transaction.
- Agent creates require an idempotency key. Reusing a key with the same canonical payload returns the original object; reusing it with a different payload returns a conflict.
- Existing Task IDs, titles, notes, timing, priority, estimates, tags, completion/cancellation, deletion state, and timestamps are preserved. `inbox`, `next`, and incomplete `scheduled` all migrate to lifecycle `open`; their old value is retained only in `legacyStatus`.
- The existing mixed row is transitional physical storage, not a mixed domain model. Task code always predicates on `kind = 'task'`, uses canonical Task columns, and never lets reminder behavior determine Task semantics.
- The natural-language capture classifier, recurring Task occurrences, Prompt persistence, and the Tracking workspace are out of scope for this plan. The golden corpus remains the acceptance contract for the later capture plan; this release supplies the strict material operations that classifier will call.
- MCP remains a stateless adapter over the public API. It contains no entity resolution, cascading, or database logic.
- No new UI icon may bypass `apps/web/src/components/icons.ts`.
- Strict red-green-refactor applies to every behavior. Run `pnpm verify` before handoff.

---

### Task 1: Encode the canonical List, Project, and Task contracts

**Files:**
- Create: `packages/domain/src/task-organization.ts`
- Modify: `packages/domain/src/task.ts`
- Modify: `packages/domain/src/feature-contracts.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/domain.test.ts`

**Interfaces:**
- Produces `TaskList`, `TaskProject`, and canonical `Task` response/input/query schemas.
- Produces structured move previews and conflict-resolution inputs.
- Replaces `Task.status` as authority with `Task.lifecycle`; retains nullable `legacyStatus` for review only.

- [ ] **Step 1: Write failing contract tests**

Add table-driven tests for:

- exact lifecycle values `open`, `completed`, and `cancelled`;
- exact List availability values `active` and `archived`;
- exact system View values `today`, `upcoming`, `scheduled`, `completed`, `cancelled`, and `trash`;
- create Task defaulting to no explicit List so the service can choose Inbox;
- accepting `scheduledAt` without any lifecycle change and representing the result as an open scheduled Task;
- rejecting a Project as a Task child and rejecting nested List/Project inputs;
- requiring at least one mutable field besides `expectedRevision` in update inputs;
- requiring a positive integer `expectedRevision` when supplied;
- the Project completion resolutions `complete_open_tasks`, `cancel_open_tasks`, `move_open_tasks`, and `keep_project_open`;
- Task move previews disclosing `detachedProjectId`;
- `materialSourceReferenceSchema` accepting `task_list` and `task_project` source types.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run packages/domain/src/domain.test.ts
```

Expected: FAIL because List/Project schemas and canonical lifecycle fields do not exist.

- [ ] **Step 3: Add exact shared enums and normalization**

In `task-organization.ts`, export:

```ts
export const taskLifecycleSchema = z.enum(["open", "completed", "cancelled"]);
export const taskContainerAvailabilitySchema = z.enum(["active", "archived"]);
export const taskListKindSchema = z.enum(["inbox", "standard"]);
export const taskSystemViewSchema = z.enum([
  "today",
  "upcoming",
  "scheduled",
  "completed",
  "cancelled",
  "trash",
]);

export const reservedTaskListNames = new Set(taskSystemViewSchema.options);

export function normalizeTaskContainerName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
```

Treat this function as the v1 normalization algorithm and cover non-ASCII fixtures in tests. A later Unicode-data upgrade must be versioned and collision-audited; it may not silently change stored normalized names.

List responses include `id`, `kind`, `name`, `description`, `color`, `availability`, `source`, `revision`, `archivedAt`, `createdAt`, and `updatedAt`. Project responses include `id`, `listId`, `name`, `notes`, `why`, `targetDate`, `lifecycle`, `availability`, `source`, `revision`, lifecycle timestamps, archive timestamp, and audit timestamps.

- [ ] **Step 4: Replace the mixed Task contract**

Make canonical Task responses include:

```ts
{
  id,
  listId,
  projectId,
  title,
  notes,
  why,
  dueAt,
  scheduledAt,
  timezone,
  priority,
  estimateMinutes,
  tags,
  lifecycle,
  legacyStatus,
  source,
  revision,
  completedAt,
  cancelledAt,
  createdAt,
  updatedAt,
}
```

`CreateTaskInput` accepts optional `listId`, optional `projectId`, and optional create `idempotencyKey`; defaults lifecycle to `open`. `UpdateTaskInput` accepts content/timing fields plus `expectedRevision` but does not accept lifecycle. Lifecycle changes use dedicated complete/cancel endpoints. `TaskListQuery` accepts `view`, `listId`, `projectId`, lifecycle, timing bounds, text query, and pagination; remove `completed` and `status` from the canonical query.

- [ ] **Step 5: Add exact aggregate-operation schemas**

Add schemas for:

- Task List create/update/archive inputs;
- Project create/update/complete/cancel/archive/move inputs;
- Task complete/cancel/trash/restore inputs;
- Task and Project move preview/commit inputs;
- structured conflict details with `code`, current revisions, open-content counts, and exact allowed resolutions.

Create inputs use UUID idempotency keys. Mutations accept `expectedRevision`. `move_open_tasks` requires a destination List and optional same-List destination Project.

- [ ] **Step 6: Run and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/task-organization.ts packages/domain/src/task.ts \
  packages/domain/src/feature-contracts.ts packages/domain/src/index.ts \
  packages/domain/src/domain.test.ts
git commit -m "feat: define task organization contracts"
```

### Task 2: Expand storage with enforced organization and migrate legacy Tasks in place

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/migrations/0054_task_organization.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `packages/database/src/schema.test.ts`
- Create: `apps/api/src/task-organization-migration.integration.test.ts`

**Interfaces:**
- Produces tables `task_lists` and `task_projects` plus canonical Task-only columns on `reminders`.
- Preserves one physical row and every existing Task ID.
- Produces one system Inbox for every existing and future user.

- [ ] **Step 1: Write failing schema and migration tests**

Require checks, indexes, and foreign keys for:

- one `kind = 'inbox'` List per user;
- non-deleted normalized List-name uniqueness per user;
- non-deleted normalized Project-name uniqueness per List;
- `(id, user_id)` List ownership keys;
- `(id, user_id, list_id)` Project ownership/location keys;
- Task-to-List and optional Task-to-Project composite foreign keys from the expanded mixed table;
- kind-sensitive checks requiring Task organization/lifecycle/revision fields only for `kind = 'task'` and requiring them null for ordinary reminders;
- legal lifecycle/availability/priority/legacy-status values;
- positive revisions and create-idempotency fingerprint pairing;
- Inbox immutability triggers;
- automatic Inbox creation after direct user insertion.

Build a `0053` fixture containing open Inbox/Next/Scheduled Tasks, completed and cancelled Tasks, a trashed Task, and ordinary reminders. Apply `0054` and assert every Task ID and material field is preserved, every upgraded Task points to that user's Inbox, lifecycle mapping is exact, legacy status is retained, and reminder rows receive no Task-only values.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run packages/database/src/schema.test.ts \
  apps/api/src/task-organization-migration.integration.test.ts
```

Expected: FAIL because migration `0054`, both organization tables, and the expanded Task columns are absent.

- [ ] **Step 3: Add exact Drizzle tables**

`taskLists` stores `id`, `userId`, `kind`, `name`, `normalizedName`, `description`, `color`, `availability`, `revision`, optional create idempotency key/fingerprint, `archivedAt`, `deletedAt`, and timestamps.

`taskProjects` stores `id`, `userId`, `listId`, `name`, `normalizedName`, `notes`, `why`, `targetDate`, `lifecycle`, `availability`, `revision`, optional create idempotency key/fingerprint, `completedAt`, `cancelledAt`, `archivedAt`, `deletedAt`, and timestamps.

Expand `reminders` with nullable `taskListId`, `taskProjectId`, `taskWhy`, `taskLifecycle`, `taskRevision`, `taskCancelledAt`, and optional Task-create idempotency key/fingerprint. Existing title/notes/timing/priority/estimate/tags/completion/deletion/timestamp columns remain physically shared. Existing `status` becomes `legacyStatus` only in Task serialization and compatibility projection; it is not renamed in this release.

Use composite foreign keys so a Project and Task cannot cross user or List boundaries. Kind-sensitive checks prevent ordinary reminders from acquiring Task organization or lifecycle. Use partial unique indexes that include archived records but exclude only soft-deleted records, matching the approved name-reuse rule.

- [ ] **Step 4: Implement migration `0054`**

The migration must:

1. create the two organization tables and add the Task-only columns, constraints, and indexes;
2. insert one `Inbox` List for every existing user;
3. install an `AFTER INSERT ON users` trigger that creates future Inboxes;
4. install Inbox update/delete guards while still allowing user-cascade deletion;
5. update every `reminders.kind = 'task'` row in place with its Inbox, canonical lifecycle, revision `1`, and cancellation timestamp where applicable;
6. map `completed` to completed, `cancelled` to cancelled, and all other old states to open;
7. preserve the old state in the existing `status` column and preserve all timing/deletion/audit timestamps;
8. validate that no Task lacks required canonical fields and no reminder contains them before committing.

Do not change any Task ID or ordinary reminder material field in this migration.

- [ ] **Step 5: Add a deployment-size preflight**

Document and run before production apply:

```sql
SELECT count(*) AS task_rows,
       pg_total_relation_size('reminders') AS reminders_bytes
FROM reminders
WHERE kind = 'task';
```

If `task_rows > 50000` or `reminders_bytes > 104857600`, stop this rollout and replace the single in-place backfill with a resumable batched expand/migrate release. This gate is a deployment stop condition, not permission to merge an unreviewed long-running migration.

- [ ] **Step 6: Run and verify GREEN**

Run the command from Step 2. Expected: PASS from both a fresh database and the `0053` upgrade fixture.

- [ ] **Step 7: Commit**

```bash
git add packages/database/src/schema.ts packages/database/src/schema.test.ts \
  packages/database/migrations/0054_task_organization.sql \
  packages/database/migrations/meta/_journal.json \
  apps/api/src/task-organization-migration.integration.test.ts
git commit -m "feat: persist task organization and lifecycle"
```

### Task 3: Implement List behavior and Inbox protection in the API

**Files:**
- Create: `apps/api/src/task-list-service.ts`
- Create: `apps/api/src/routes/task-lists.ts`
- Modify: `apps/api/src/serialization.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.integration.test.ts`

**Interfaces:**
- Produces `/v1/task-lists` list/create/get/update/archive routes.
- Returns structured archive conflicts rather than silently moving active content.

- [ ] **Step 1: Write failing API integration cases**

Cover Inbox retrieval, reserved-name rejection, Unicode/case/whitespace collisions, same-user uniqueness, cross-user isolation, create idempotency replay/mismatch, revision conflicts, standard List archive, Inbox mutation conflict choices, archive conflict counts, archive resolution by moving contents to another List, archive-with-contents resolution, cancellation without mutation, and audit records.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run apps/api/src/app.integration.test.ts -t "task lists"
```

Expected: FAIL with missing routes.

- [ ] **Step 3: Implement the List service**

All lookup predicates include `userId` and soft-deletion state. Create normalizes once, rejects reserved names, hashes the canonical create payload for idempotency, and returns the prior row only when key and fingerprint both match. Update and archive use `WHERE revision = expectedRevision`, increment revision exactly once, and append audit state in the same transaction.

Archive without active contents sets `availability = 'archived'` and `archivedAt`. Archive with contents throws `conflict` containing exact Task/Project counts and the choices `move_active_contents`, `archive_contents_together`, and `cancel`. A confirmed move locks source and destination Lists, moves Projects once and all Tasks once, then archives the List in one transaction. `archive_contents_together` archives only the List so its contained records remain intact and inherit hidden availability; `cancel` writes nothing. An Inbox archive attempt returns `keep_inbox` and `choose_another_list` choices and writes nothing.

- [ ] **Step 4: Register routes and serializers**

Use existing `tasks:read` and `tasks:write` feature access. Route bodies use only domain schemas. Return `{ taskList }`, `{ items, nextCursor }`, and structured `AppError` conflict details consistently with the rest of the API.

- [ ] **Step 5: Run and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/task-list-service.ts apps/api/src/routes/task-lists.ts \
  apps/api/src/serialization.ts apps/api/src/app.ts apps/api/src/app.integration.test.ts
git commit -m "feat: add protected task lists"
```

### Task 4: Implement Project lifecycle, conflicts, and atomic moves

**Files:**
- Create: `apps/api/src/task-project-service.ts`
- Create: `apps/api/src/routes/task-projects.ts`
- Modify: `apps/api/src/serialization.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.integration.test.ts`

**Interfaces:**
- Produces Project list/get/create/update/complete/cancel/archive routes.
- Produces Project move preview and commit routes.

- [ ] **Step 1: Write failing Project integration cases**

Cover List ownership, normalized uniqueness within a List, same name in different Lists, empty Project creation, revision-safe update/cancel/archive, open-Task completion conflict, each explicit completion resolution, move preview counts, atomic Project-plus-Task move, stale preview/revision conflict, cross-user destination rejection, and audit correlation across bulk writes.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run apps/api/src/app.integration.test.ts -t "task projects"
```

Expected: FAIL with missing Project routes.

- [ ] **Step 3: Implement ordinary Project operations**

Create validates the destination List is active and owned by the caller. Update never changes `listId` or lifecycle. Cancel and archive are dedicated compare-and-swap operations. Complete first counts locked open Tasks; without a resolution it returns a structured conflict. `keep_project_open` performs no mutation. Other resolutions update affected Tasks and Project in one transaction with one correlation ID and one audit row per entity.

- [ ] **Step 4: Implement previewed Project moves**

Preview returns source/destination List IDs and revisions, Project revision, affected Task count, and a deterministic preview token derived from those values. Commit re-locks the Project, both Lists, and affected Tasks, recomputes the token, rejects drift, then updates Project and every Task atomically. No compatibility field attempts to encode List or Project organization.

- [ ] **Step 5: Register routes and serializers**

Add:

- `GET/POST /v1/task-projects`;
- `GET/PATCH /v1/task-projects/:id`;
- `POST /v1/task-projects/:id/complete`;
- `POST /v1/task-projects/:id/cancel`;
- `POST /v1/task-projects/:id/archive`;
- `POST /v1/task-projects/:id/move/preview`;
- `POST /v1/task-projects/:id/move`.

- [ ] **Step 6: Run and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/task-project-service.ts apps/api/src/routes/task-projects.ts \
  apps/api/src/serialization.ts apps/api/src/app.ts apps/api/src/app.integration.test.ts
git commit -m "feat: add task project lifecycle"
```

### Task 5: Move Task behavior to canonical columns with bounded status compatibility

**Files:**
- Rewrite: `apps/api/src/task-service.ts`
- Modify: `apps/api/src/routes/tasks.ts`
- Modify: `apps/api/src/serialization.ts`
- Modify: `apps/api/src/app.integration.test.ts`

**Interfaces:**
- Canonical reads/writes use Task-only columns on `reminders(kind = 'task')`.
- Existing `status` is retained only as bounded compatibility metadata.
- Adds get, cancel, trash, restore, and move-preview safety parity.

- [ ] **Step 1: Rewrite existing Task tests against the canonical contract**

Replace status-based expectations with List/Project/lifecycle assertions. Add cases for default Inbox placement, explicit List and Project placement, same-List enforcement, open scheduled Tasks, completion/reopen/cancel transitions, independent due/scheduled edits, source/revision serialization, agent revision requirements, compare-and-swap races, trash/restore, Task move preview and detachment, idempotency replay/mismatch, user isolation, and audit snapshots.

For every mutation, inspect the stored row and assert canonical lifecycle/timing drives the response while legacy status is only the documented projection. Force a compare-and-swap miss and assert neither state nor audit changed.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run apps/api/src/app.integration.test.ts -t "tasks"
```

Expected: FAIL because Task service still treats mixed status as lifecycle and has no organization/revision fields.

- [ ] **Step 3: Implement canonical lookup and serialization**

`findActive`, `get`, and `list` always require `kind = 'task'`, scope by user, and use the canonical Task columns. Join List/Project only when response context needs their names. Serialize local source as:

```ts
source: {
  accountId: null,
  provider: "local",
  remoteId: row.id,
  revision: String(row.taskRevision),
  sourceType: "task",
}
```

Views are server queries: Inbox by system List ID; Scheduled by open lifecycle plus non-null `scheduledAt`; Completed/Cancelled/Trash by lifecycle or deletion state. Today and Upcoming use the user's planning timezone and the independent due/scheduled axes.

- [ ] **Step 4: Implement revision-safe canonical mutations**

All updates match `id`, `userId`, `kind = 'task'`, `taskRevision`, and deletion state. Increment revision exactly once. Require `expectedRevision` for agents and honor it when supplied by humans. Dedicated transitions own lifecycle timestamps. Reopening a completed/cancelled Task returns it to `open`; it does not invent a Next queue.

- [ ] **Step 5: Maintain bounded legacy-status compatibility**

Preserve migrated `legacyStatus` until a canonical timing/lifecycle edit requires a projection. The projection is `completed`, `cancelled`, `scheduled` for open Tasks with reserved time, otherwise `inbox`; never generate `next`. No query, transition, View, or UI decision may branch on this field. Audit includes canonical lifecycle and the compatibility projection so remaining `next` rows can be reviewed before physical extraction.

- [ ] **Step 6: Implement previewed Task moves**

Preview locks/reads the Task, destination List, and optional destination Project; it returns whether the current Project will detach and a token containing all relevant revisions. Commit rejects a stale token, changes `listId` and `projectId` atomically, increments Task revision once, and audits the disclosed detachment.

- [ ] **Step 7: Register the complete route surface**

Retain list/create/get/update. Replace generic complete input with revision-aware transition schemas. Add cancel, trash, restore, move preview, and move commit endpoints. Keep `DELETE /v1/tasks/:id` as a temporary alias to trash with deprecation headers, but make new clients use `POST /v1/tasks/:id/trash`.

- [ ] **Step 8: Run and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/task-service.ts apps/api/src/routes/tasks.ts \
  apps/api/src/serialization.ts apps/api/src/app.integration.test.ts
git commit -m "feat: canonicalize task lifecycle and safety"
```

### Task 6: Expose the complete typed API client

**Files:**
- Modify: `packages/api-client/src/features/tasks.ts`
- Modify: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Produces typed List, Project, Task, preview, transition, trash, and restore methods.
- Removes first-party use of legacy `status`, `completed`, and DELETE Task calls.

- [ ] **Step 1: Write failing client transport tests**

Assert exact paths, methods, query strings, and JSON bodies for all new operations. Require `getTask`, `getTaskList`, and `getTaskProject`. Assert mutation guards and idempotency keys are transmitted unchanged. Assert `trashTask` uses POST and no canonical method uses DELETE.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run packages/api-client/src/client.test.ts -t "task"
```

Expected: FAIL because the client exposes only the legacy Task subset.

- [ ] **Step 3: Implement the client methods**

Keep the feature in `features/tasks.ts`; Lists and Projects are part of the Tasks domain, not generic container modules. Use domain input/response types directly. Do not reproduce validation or move logic in the client.

- [ ] **Step 4: Run and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/features/tasks.ts packages/api-client/src/client.test.ts
git commit -m "feat: expose task organization client"
```

### Task 7: Replace the incomplete MCP Task surface with focused truthful tools

**Files:**
- Modify: `apps/mcp/src/tools/planning.ts`
- Modify: `apps/mcp/src/tool-catalog.ts`
- Modify: `apps/mcp/src/server.test.ts`
- Modify: `docs/mcp.md`

**Interfaces:**
- Produces focused List, Project, Task, preview, transition, trash, and restore tools.
- Keeps all behavior in the API client.

- [ ] **Step 1: Write failing MCP discovery and forwarding tests**

Require tools for:

- List list/get/create/update/archive;
- Project list/get/create/update/complete/cancel/archive plus move preview/commit;
- Task list/get/create/update/complete/cancel/trash/restore plus move preview/commit.

Assert read tools are read-only, previews are read-only/prepare, writes are approve-each, and trash/archive tools accurately declare destructive behavior. Reject blanket idempotent annotations. Assert agent mutations forward required revision/idempotency fields and structured API conflicts without rewriting them.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run apps/mcp/src/server.test.ts -t "task"
```

Expected: FAIL because get/restore/List/Project tools and truthful annotations are absent.

- [ ] **Step 3: Update the catalog first**

Register every tool under domain `tasks` and existing task scopes. Use `preview` policy for move previews. Mark archive/trash destructive. Do not set `idempotent: true` merely because a tool accepts an expected revision; only create replay with a matching idempotency key is safely replayable, and its mismatch behavior must remain visible.

- [ ] **Step 4: Implement thin MCP adapters**

Schemas mirror the public domain inputs and use descriptions that distinguish organization, finite outcomes, executable actions, lifecycle, timing, and Views. `complete_task` says reopen returns lifecycle to open. No tool calls another tool, queries the database, resolves a name, or performs a cascade locally.

- [ ] **Step 5: Update MCP documentation**

Document MCP protocol Tasks as unrelated long-running operation handles. Document source-by-ID reads before revision-safe mutation and the preview/commit sequence for material moves.

- [ ] **Step 6: Run and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mcp/src/tools/planning.ts apps/mcp/src/tool-catalog.ts \
  apps/mcp/src/server.test.ts docs/mcp.md
git commit -m "feat: complete task organization mcp tools"
```

### Task 8: Build the Tasks workspace around Views, Lists, and Projects

**Files:**
- Modify: `apps/web/src/features/tasks/page.tsx`
- Create: `apps/web/src/features/tasks/task-dialog.tsx`
- Create: `apps/web/src/features/tasks/task-list-dialog.tsx`
- Create: `apps/web/src/features/tasks/task-project-dialog.tsx`
- Create: `apps/web/src/features/tasks/project-conflict-dialog.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Produces one Tasks workspace at `/tasks` with system Views, Lists, Projects, and finite Tasks.
- Makes Inbox visually a List and never presents scheduled/next as Task status choices.

- [ ] **Step 1: Rewrite Tasks workspace tests to the approved information architecture**

Cover:

- View navigation for Today, Upcoming, Scheduled, Completed, Cancelled, and Trash;
- a separate Lists group with protected Inbox and created Lists;
- Projects filtered under their List;
- URL-stable List/Project selection;
- Task capture defaulting to Inbox and optional Project placement;
- no status selector and independent deadline/reserved-time controls;
- completed/cancelled/reopen/trash/restore actions;
- List/Project creation and reserved/duplicate-name errors;
- Task move detachment disclosure;
- Project move preview counts;
- Project completion conflict choices;
- loading, empty, conflict, and failure states accessible by name and role.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run apps/web/src/app.test.tsx -t "Tasks"
```

Expected: FAIL because the current sidebar treats Inbox/Next/Scheduled as peer statuses and has no organization.

- [ ] **Step 3: Refactor the sidebar and query model**

Use URL parameters `view`, `list`, and `project`; Project selection implies its List. The default URL selects Inbox without spelling its generated ID. Views and Lists render in separate labeled groups. Show archived containers only in their explicit management surface, not ordinary navigation.

- [ ] **Step 4: Extract and rebuild Task editing**

Move `TaskDialog` out of `app.tsx`. Add List and optional Project selectors, `why`, lifecycle actions outside the edit form, and independent deadline/reserved-time inputs. Include current `revision` in every mutation. A List change that detaches a Project must fetch preview and require explicit confirmation before commit.

- [ ] **Step 5: Add List and Project management dialogs**

Support create/edit/archive for Lists and create/edit/complete/cancel/archive/move for Projects. Render structured conflicts as exact choices from the API rather than inferring choices from local state. The UI must never offer Inbox archive/rename.

- [ ] **Step 6: Preserve compact Task scanning**

Task rows show Project/List context only when needed, plus scheduled time, due time, estimate, and tags. Lifecycle badges use human labels; do not display `legacyStatus`. Completion remains a one-click action using the visible revision.

- [ ] **Step 7: Run and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/tasks apps/web/src/app.tsx apps/web/src/app.test.tsx
git commit -m "feat: organize tasks with lists and projects"
```

### Task 9: Update Today, automations, fixtures, and compatibility consumers

**Files:**
- Modify: `apps/api/src/automation-service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/qa-fixtures.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/features/settings/agent-access.tsx`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Keeps Today and daily brief behavior working from canonical Task lifecycle/timing.
- Seeds realistic Inbox/List/Project test data.

- [ ] **Step 1: Add failing cross-consumer tests**

Assert daily briefs include open due/scheduled Tasks, exclude cancelled/trashed Tasks, retain completed summaries, and never depend on legacy status. Assert agent-access previews list canonical open Tasks. Assert QA reset creates exactly one Inbox plus non-system Lists and Projects without name collisions.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec vitest run apps/api/src/app.integration.test.ts apps/web/src/app.test.tsx \
  -t "daily brief|agent access|QA fixture"
```

Expected: FAIL because consumers still query `completed` and legacy status.

- [ ] **Step 3: Update canonical consumers**

Change automation and UI callers to lifecycle/View queries. Preserve the existing recommendation urgency vocabulary only as derived presentation; `inbox` and `next` must not re-enter Task lifecycle or storage.

- [ ] **Step 4: Add representative fixtures**

Seed Inbox, Personal, Work, and Shopping Lists; two same-named Projects in different Lists; open unscheduled, scheduled, due, completed, cancelled, and trashed Tasks; and a Task whose Project move exercises the same-List constraint. Let the database user trigger create Inbox rather than inserting a second one.

- [ ] **Step 5: Run and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/automation-service.ts apps/api/src/app.ts apps/api/src/qa-fixtures.ts \
  apps/api/src/app.integration.test.ts apps/web/src/app.tsx \
  apps/web/src/features/settings/agent-access.tsx apps/web/src/app.test.tsx
git commit -m "fix: move task consumers to canonical lifecycle"
```

### Task 10: Lock documentation, compatibility limits, and release evidence

**Files:**
- Modify: `docs/product/master-design.md`
- Modify: `docs/engineering/feature-ownership.md`
- Modify: `docs/superpowers/specs/2026-08-12-tasks-and-tracking-ledger-design.md`
- Modify: `docs/superpowers/specs/2026-08-12-tasks-tracking-ontology-classification-design.md`

**Interfaces:**
- Makes the implemented Task model authoritative in product/engineering documentation.
- Records bounded legacy-status compatibility and the physical-extraction gate.

- [ ] **Step 1: Update authoritative documentation**

Document the two-workspace direction, exact entity ownership, URL model, lifecycle/timing separation, database invariants, public API/MCP surface, and why the shared table is transitional storage rather than a shared domain. Mark implemented spec criteria accurately; do not mark classifier, recurrence, Prompt persistence, physical Task extraction, or Tracking criteria complete.

- [ ] **Step 2: Define the compatibility observation gate**

Record that physical Task extraction and removal of mixed status require:

- two successful production releases on canonical storage;
- zero first-party Task decisions based on the old `status` column;
- a reviewed disposition for every remaining `legacyStatus = 'next'` Task;
- a tested expand–migrate–contract procedure preserving IDs and rollback safety;
- the Prompt/reminder compatibility plan approved before old task rows are deleted.

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm exec vitest run packages/domain/src/domain.test.ts \
  packages/database/src/schema.test.ts \
  apps/api/src/task-organization-migration.integration.test.ts \
  apps/api/src/app.integration.test.ts \
  packages/api-client/src/client.test.ts \
  apps/mcp/src/server.test.ts \
  apps/web/src/app.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run repository verification**

Run:

```bash
pnpm verify
```

Expected: lint, type checking, coverage, production builds, and desktop/mobile E2E all pass.

- [ ] **Step 5: Inspect migration and working tree**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intended Task organization changes.

- [ ] **Step 6: Commit documentation**

```bash
git add docs/product/master-design.md docs/engineering/feature-ownership.md \
  docs/superpowers/specs/2026-08-12-tasks-and-tracking-ledger-design.md \
  docs/superpowers/specs/2026-08-12-tasks-tracking-ontology-classification-design.md
git commit -m "docs: make task organization contract authoritative"
```

- [ ] **Step 7: Prove production migration before physical extraction begins**

After deployment, verify one Inbox per user, no Task missing canonical lifecycle/List/revision, no cross-List Project references, API health, MCP discovery, and one human-session create/edit/complete/restore flow. Record any old-status decision reads. Do not schedule physical extraction until the observation gate in Step 2 is satisfied.
