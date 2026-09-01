# Tasks Workspace UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Tasks foundation into an ordered, context-preserving, human-recoverable workspace with web reachability matching MCP.

**Architecture:** Keep query semantics and pagination in the Tasks API service, shared input contracts in the domain package, and all page composition inside the Tasks web feature. Add only minimal app-shell wiring for the Tasks secondary app bar and route-backed Task inspector.

**Tech Stack:** TypeScript, Hono, Drizzle/PostgreSQL, React 19, React Router, TanStack Query, shadcn/Radix, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-tasks-workspace-ux-design.md`

## Global Constraints

- Views are derived queries and never own Task records.
- Deadline, reserved time, lifecycle, container availability, and deletion remain independent axes.
- MCP remains a stateless adapter over the authenticated public API.
- The web uses existing shadcn primitives and the reicon registry only.
- Every agent-visible archived or terminal record remains inspectable in the web.
- `pnpm verify` is required before handoff.

---

### Task 1: Correct planning queries and stable ordering

**Files:**
- Modify: `packages/domain/src/task.ts`
- Modify: `apps/api/src/task-service.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/api/src/utilities.test.ts`

**Interfaces:**
- Consumes: existing `TaskListQuery` and opaque `cursor` string.
- Produces: `includeUnavailableProject?: boolean` on `TaskListQuery`; view-specific opaque cursors internal to `task-service.ts`.

- [ ] **Step 1: Write failing API integration tests** proving Today includes overdue Tasks, Today/Upcoming/Scheduled are chronological across page boundaries, lifecycle history uses its event timestamp, and terminal Project reads require `includeUnavailableProject=true`.
- [ ] **Step 2: Run the named integration tests** with `pnpm exec vitest run apps/api/src/app.integration.test.ts -t "orders canonical task views"` and confirm failures describe the current created-at ordering and unavailable Project rejection.
- [ ] **Step 3: Extend `taskListQuerySchema`** with `includeUnavailableProject: z.coerce.boolean().optional()` and add an internal signed-shape Task cursor containing `orderGroup`, `orderAt`, `createdAt`, and `id` while keeping the value opaque to callers.
- [ ] **Step 4: Implement server ordering**: Today overdue then reserved then due; Upcoming earliest relevant time; Scheduled reserved time; Completed/Cancelled/Trash lifecycle event time; fallback container/Inbox queries created-at descending.
- [ ] **Step 5: Permit exact terminal Project reads** only when the owned Project exists and `includeUnavailableProject` is true; preserve active List ownership and deletion rules.
- [ ] **Step 6: Run focused API tests** and confirm the new tests and existing Task integration tests pass.

### Task 2: Restore Archive and conflict parity in the web

**Files:**
- Create: `apps/web/src/features/tasks/selection.ts`
- Create: `apps/web/src/features/tasks/archive-page.tsx`
- Create: `apps/web/src/features/tasks/selection.test.ts`
- Modify: `apps/web/src/features/tasks/page.tsx`
- Modify: `apps/web/src/features/tasks/task-list-dialog.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `docs/design/pages/commitments.md`

**Interfaces:**
- Consumes: loaded `TaskList[]`, `TaskProject[]`, and `URLSearchParams`.
- Produces: `parseTaskSelection`, `taskPath`, and canonical Archive URLs using `section=archive` plus optional `list` or `project`.

- [ ] **Step 1: Write failing selection and React tests** for Archive navigation, archived List/Project canonical URLs, archived content reads, and an `Archive contents together` conflict action.
- [ ] **Step 2: Run focused web tests** and confirm Archive controls and URLs are absent.
- [ ] **Step 3: Extract selection parsing/path creation** from `page.tsx` into pure helpers that preserve `q`, filter parameters, and `task` while enforcing View/List/Project/Archive exclusivity.
- [ ] **Step 4: Add the Archive sidebar destination and page** listing archived Lists and terminal or archived Projects as quiet Item groups with lifecycle/availability metadata and inspect links.
- [ ] **Step 5: Allow Archive selection queries** to request archived List contents by `listId`, and terminal Project contents by `projectId` plus `includeUnavailableProject: true`.
- [ ] **Step 6: Render every API-authored List conflict resolution** and send `resolution: "archive_contents_together"` with the conflict revision after explicit confirmation.
- [ ] **Step 7: Update the commitments page contract** and run focused tests until green.

### Task 3: Add persistent scope and useful queues

**Files:**
- Create: `apps/web/src/features/tasks/context-bar.tsx`
- Create: `apps/web/src/features/tasks/context-bar.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/features/tasks/page.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: canonical Task selection plus cached List/Project data.
- Produces: `TasksContextBar`; open working queue and closed History disclosure on container pages.

- [ ] **Step 1: Write failing tests** for persistent View/List/Project/Archive labels, scope-specific Manage actions, Project outcome metadata, no redundant Open label/edit glyph, and closed completed/cancelled History on List/Project pages.
- [ ] **Step 2: Run focused tests** and confirm the existing generic Tasks heading and mixed queue fail the expectations.
- [ ] **Step 3: Compose `TasksContextBar`** from `WorkspaceSecondaryAppBar` slots and existing Task List/Project dialogs; keep app-shell changes to route composition.
- [ ] **Step 4: Add the Project overview** using shared Item primitives with List, why, target date, and open count.
- [ ] **Step 5: Query open container work separately** and place completed/cancelled results in a labelled Collapsible History section with independent loading/error/empty handling.
- [ ] **Step 6: Simplify Task rows** by removing the Open label and duplicate edit button while keeping checkbox and named primary action separate; show non-medium priority compactly.
- [ ] **Step 7: Add responsive layout rules** preserving the scope label and actions at 390 px, then run focused tests.

### Task 4: Progressive capture, inspector, filters, and Task deep links

**Files:**
- Create: `apps/web/src/features/tasks/task-filters.tsx`
- Create: `apps/web/src/features/tasks/task-filters.test.tsx`
- Modify: `apps/web/src/features/tasks/task-dialog.tsx`
- Modify: `apps/web/src/features/tasks/page.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: URL parameters `task`, `lifecycle`, `dueAfter`, `dueBefore`, `scheduledAfter`, `scheduledBefore` and `api.getTask`.
- Produces: route-backed Task Sheet, progressive create form, and Task query filter popover.

- [ ] **Step 1: Write failing React tests** for the compact create surface, More details disclosure, full edit surface, canonical `task` deep links, close-preserves-scope behavior, metadata disclosure, and advanced filter query mapping.
- [ ] **Step 2: Run focused tests** and confirm current dialog and URL behavior fail.
- [ ] **Step 3: Convert Task detail to Sheet** with an accessible title and scrollable body; new Tasks default More details closed while existing Tasks show the full form.
- [ ] **Step 4: Bind editor state to `task`** so row activation updates the URL, direct navigation loads `api.getTask`, and close removes only `task`.
- [ ] **Step 5: Add labelled source metadata disclosure** containing revision, source, created, and updated timestamps.
- [ ] **Step 6: Add advanced filter controls** backed directly by `TaskListQuery`; preserve selection and search when filters change and provide one Clear filters action.
- [ ] **Step 7: Run focused React and API-client tests** until green.

### Task 5: End-to-end verification and documentation reconciliation

**Files:**
- Modify: `e2e/product.spec.ts`
- Modify: `.agents/skills/personal-os-qa/references/planning.md`
- Modify: `docs/product/tasks-ilo-charter.md`
- Modify: `docs/product/implementation-log.md`

**Interfaces:**
- Consumes: completed API and web contracts from Tasks 1-4.
- Produces: durable product/QA truth and desktop/mobile acceptance evidence.

- [ ] **Step 1: Write failing Playwright assertions** for overdue Today ordering, visible scope on mobile, Project overview, direct Task URL, Archive reachability, and progressive capture.
- [ ] **Step 2: Run the Tasks-focused Playwright project** and confirm each new assertion fails for the expected missing behavior before final implementation adjustments.
- [ ] **Step 3: Reconcile current docs and QA runbook** with the shipped behavior without claiming Tasks maintenance or health capabilities.
- [ ] **Step 4: Run focused Vitest and Playwright suites** and fix any regressions with a failing test first.
- [ ] **Step 5: Run `pnpm verify`** and require a zero exit status before handoff.
