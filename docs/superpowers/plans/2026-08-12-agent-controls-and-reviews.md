# Agent Controls and Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bloated Agent Access and placeholder Automations settings experiences with Today-owned Reviews plus Settings-owned Connected agents and Workspace access.

**Architecture:** Keep the existing cross-domain assistant work-item read model, but remove setup candidates and present it through a dedicated Today route. Split credential identity from workspace authority in Settings, with domain adapters owning allowed, approval-required, and unavailable capability statements. Remove every runtime routine lifecycle caller while preserving the independent daily brief and inert historical tables for rollback compatibility.

**Tech Stack:** React 19, React Router, TanStack Query, shadcn/Radix primitives, TypeScript, Hono, Drizzle/PostgreSQL, MCP SDK, Vitest, Testing Library, Playwright.

## Global Constraints

- Reviews contains only `review` and `attention`; setup and credential work stays in Settings.
- Settings must make connected-agent identity, exact scopes, workspace authority, approval boundaries, and unavailable behavior explicit.
- `automations:read` remains a compatibility scope labelled **Read daily brief**; `automations:write` is inert and unavailable for new credentials.
- Historical automation tables remain unchanged for rollback compatibility and receive no runtime reads or writes.
- Use only existing shadcn primitives and semantic tokens; no gradients, shadows, page-specific replacement primitives, or non-reicon icons.
- Preserve loading, empty, partial-error, unavailable, narrow-screen, keyboard, and focus behavior.
- Run focused tests during each red/green cycle and `pnpm verify` before handoff.

---

### Task 1: Retire the routine lifecycle and preserve daily brief

**Files:**
- Create: `apps/api/src/daily-brief-service.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Delete: `apps/api/src/automation-service.ts`
- Modify: `packages/domain/src/automation.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/activity.ts`
- Modify: `apps/mcp/src/tool-catalog.ts`
- Modify: `apps/mcp/src/server.ts`
- Modify: `apps/mcp/src/server.test.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Produces: `createDailyBriefService(options): { dailyBrief(userId, timeZone, scopes?): Promise<DailyBrief> }`.
- Preserves: `GET /v1/daily-brief`, API client `getDailyBrief()`, MCP `get_daily_brief`, and `personal-os://brief/daily`.
- Removes: public routine lifecycle schemas and methods, `/v1/automations*`, MCP `list_automations`/`run_automation`, and scheduled dispatch. Storage-only legacy table types may remain local to `packages/database` until the later contract migration.

- [ ] **Step 1: Write failing API, client, MCP, and web contract tests**

  Assert that `/v1/automations` is not registered, routine client methods and MCP tools are absent, `/settings?section=automations` redirects to Workspace access, and daily brief still returns events/reminders/tasks.

- [ ] **Step 2: Run focused tests and verify the expected failures**

  Run:
  `pnpm exec vitest run apps/api/src/app.integration.test.ts packages/api-client/src/client.test.ts apps/mcp/src/server.test.ts apps/web/src/app.test.tsx`

- [ ] **Step 3: Extract daily brief and remove routine runtime callers**

  Move the pure brief/capacity/recommendation logic into `daily-brief-service.ts`; wire only `dailyBrief` in `app.ts`; delete routine routes, scheduler callbacks, API-client methods, MCP tools, and Automations React composition. Do not modify `automation_routines`, `automation_runs`, migration SQL, or the migration journal.

- [ ] **Step 4: Run the focused tests and type checks**

  Run:
  `pnpm exec vitest run apps/api/src/app.integration.test.ts packages/api-client/src/client.test.ts apps/mcp/src/server.test.ts apps/web/src/app.test.tsx`

  Run:
  `pnpm --filter @personal-os/domain --filter @personal-os/api --filter @personal-os/api-client --filter @personal-os/mcp --filter @personal-os/web --if-present run typecheck`

- [ ] **Step 5: Commit the independently testable removal**

  Commit message: `refactor: retire placeholder routine lifecycle`

### Task 2: Make the assistant work-item contract operational-only

**Files:**
- Modify: `packages/domain/src/assistant.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `apps/api/src/agent-access-work-items.ts`
- Modify: `apps/api/src/agent-access-work-items.integration.test.ts`
- Modify: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Changes: `AgentAccessWorkItemKind` to `"review" | "attention"`.
- Preserves: cursor pagination, `domain` filter, `kind` filter, snapshot ordering, partial-source summaries, and `/v1/assistant/work-items`.
- Removes: credential source reader and every synthetic `setup:*` item.

- [ ] **Step 1: Write failing work-item tests**

  Assert that a person with no observed credential receives no synthetic setup row, summaries contain only review/attention counts, and Mail review actions deep-link to `section=workspace-access`.

- [ ] **Step 2: Run the work-item tests and verify failure**

  Run:
  `pnpm exec vitest run apps/api/src/agent-access-work-items.integration.test.ts packages/domain/src/domain.test.ts`

- [ ] **Step 3: Remove setup projection and update the contract**

  Delete the credential reader, `setup` cursor value, source impact, summary field, and candidate projection. Update review deep links without changing domain mutation ownership.

- [ ] **Step 4: Run work-item and API integration tests**

  Run:
  `pnpm exec vitest run apps/api/src/agent-access-work-items.integration.test.ts apps/api/src/app.integration.test.ts packages/domain/src/domain.test.ts`

- [ ] **Step 5: Commit**

  Commit message: `refactor: keep agent work queue operational`

### Task 3: Add the Today-owned Reviews destination

**Files:**
- Create: `apps/web/src/features/reviews/page.tsx`
- Create: `apps/web/src/features/reviews/page.test.tsx`
- Delete: `apps/web/src/features/settings/agent-access-queue.tsx`
- Delete: `apps/web/src/features/settings/agent-access-queue.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/navigation/manifest.ts`
- Modify: `apps/web/src/navigation/manifest.test.ts`
- Modify: `apps/web/src/navigation/mobile-workspace-dock.ts`
- Modify: `apps/web/src/navigation/mobile-workspace-dock.test.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: `<ReviewsPage />` at `/reviews`.
- Uses: `api.listAgentAccessWorkItems({ cursor?, domain?, kind?, limit: 10 })`.
- URL state: `kind=all|review|attention`, `workspace=all|mail|calendar|tasks|finances`.

- [ ] **Step 1: Write failing Reviews component and routing tests**

  Assert Today ownership, desktop/mobile navigation, URL-owned filters, filter focus reset, domain-aware pagination, partial failure, caught-up state, and accessible row actions.

- [ ] **Step 2: Run the Reviews and navigation tests and verify failure**

  Run:
  `pnpm exec vitest run apps/web/src/features/reviews/page.test.tsx apps/web/src/navigation/manifest.test.ts apps/web/src/navigation/mobile-workspace-dock.test.ts apps/web/src/app.test.tsx`

- [ ] **Step 3: Implement Reviews using the existing Card, ToggleGroup, ItemGroup, Alert, Empty, Skeleton, and Pagination primitives**

  Keep one primary Card, use framed workspace identities, reset cursor history on either filter, and use `replace` only for compatibility redirects—not normal filter navigation.

- [ ] **Step 4: Run focused React/navigation tests**

  Run the Step 2 command and confirm zero failures.

- [ ] **Step 5: Commit**

  Commit message: `feat: add Today reviews queue`

### Task 4: Split Settings into Connected agents and Workspace access

**Files:**
- Create: `apps/web/src/features/settings/agent-connections.tsx`
- Create: `apps/web/src/features/settings/agent-connections.test.tsx`
- Create: `apps/web/src/features/settings/workspace-access.tsx`
- Create: `apps/web/src/features/settings/workspace-access.test.tsx`
- Create: `apps/web/src/features/settings/agent-permissions.ts`
- Create: `apps/web/src/features/settings/agent-permissions.test.ts`
- Delete: `apps/web/src/features/settings/agent-access.tsx`
- Delete: `apps/web/src/features/settings/agent-access.test.tsx`
- Modify: `apps/web/src/features/agent-access/readiness.ts`
- Modify: `apps/web/src/features/mail/agent-access.ts`
- Modify: `apps/web/src/features/calendar/agent-access.ts`
- Modify: `apps/web/src/features/tasks/agent-access.ts`
- Modify: `apps/web/src/features/finances/agent-access.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: `<AgentConnectionsSettings />` for `section=agent-connections`.
- Produces: `<WorkspaceAccessSettings />` for `section=workspace-access` with optional `workspace` and `reviewRule` URL state.
- Produces: `workspaceAuthority(hosts, domain)` returning reader/writer host lists and honest loading/unavailable states.
- Extends: `DomainCapability` with `allowed: string[]`, `approvalRequired: string[]`, `notAvailable: string[]`, and `sourceScope: string`.

- [ ] **Step 1: Write failing pure permission and settings tests**

  Cover unused-token versus observed-host semantics, exact scope disclosure, workspace reader/writer counts, inert legacy `automations:write`, all-workspace comparison, explicit Allowed/Approval required/Not available sections, source-scope disclosure, readiness/setup behavior, Mail rule status, Reviews deep links, and compatibility redirects.

- [ ] **Step 2: Run focused settings tests and verify failure**

  Run:
  `pnpm exec vitest run apps/web/src/features/settings/agent-permissions.test.ts apps/web/src/features/settings/agent-connections.test.tsx apps/web/src/features/settings/workspace-access.test.tsx apps/web/src/app.test.tsx`

- [ ] **Step 3: Implement Connected agents**

  Compose connection instructions, observed OAuth hosts, active manual tokens, exact scope disclosure, revoke controls, advanced token creation, and revoked history. Rename `automations:read` to **Read daily brief** in copy and exclude `automations:write` from presets and selectable new scopes.

- [ ] **Step 4: Implement Workspace access**

  Compose the All comparison and selected workspace detail from existing authenticated queries. Keep the `ReadinessPanel`, connection/setup protocol, and Mail rule review dialog. Add domain-owned capability lists and pending Reviews links without duplicating approval mutations.

- [ ] **Step 5: Update Settings navigation and compatibility redirects**

  Replace the Automation group with an **Agents** group containing **Connected agents** and **Workspace access**. Redirect legacy `agents` and `automations` values to `workspace-access` with `replace` semantics.

- [ ] **Step 6: Run settings tests, app tests, and web typecheck**

  Run the Step 2 command, then:
  `pnpm --filter @personal-os/web typecheck`

- [ ] **Step 7: Commit**

  Commit message: `feat: split agent controls by responsibility`

### Task 5: Align documentation, fixtures, and acceptance coverage

**Files:**
- Modify: `docs/design/foundations.md`
- Modify: `docs/design/system.md`
- Replace: `docs/design/pages/agent-access.md`
- Create: `docs/design/pages/reviews.md`
- Modify: `docs/product/master-design.md`
- Modify: `docs/product/master-plan.md`
- Modify: `.agents/skills/personal-os-qa/references/shell-and-switching.md`
- Modify: `apps/api/src/qa-fixtures.ts`
- Modify: `e2e/product.spec.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Documents the canonical operational/control split and placeholder-routine removal.
- Preserves deterministic demo fixture coverage for more than ten mixed Review/Attention rows and multiple connected-agent authority states.

- [ ] **Step 1: Write or update failing Playwright assertions for the new routes and mobile navigation**

  Cover `/reviews`, both Settings pages, legacy redirects, workspace selection, permission disclosure, and 320 px document overflow.

- [ ] **Step 2: Run the narrow Playwright project and verify expected failures**

  Run:
  `pnpm exec playwright test e2e/product.spec.ts --project=chromium --grep "Reviews|Connected agents|Workspace access"`

- [ ] **Step 3: Update fixtures, page specifications, and shared UX invariants**

  Remove routine fixture rows and replace stale Agent Access terminology. Record that operational queues live outside Settings while Settings mirrors pending counts and owns durable authority/rules configuration.

- [ ] **Step 4: Run focused tests, lint, typecheck, and build**

  Run:
  `pnpm exec vitest run apps/api/src/agent-access-work-items.integration.test.ts apps/api/src/app.integration.test.ts packages/api-client/src/client.test.ts apps/mcp/src/server.test.ts apps/web/src/features/reviews/page.test.tsx apps/web/src/features/settings/agent-connections.test.tsx apps/web/src/features/settings/workspace-access.test.tsx apps/web/src/app.test.tsx`

  Run:
  `pnpm lint && pnpm typecheck && pnpm build`

- [ ] **Step 5: Run live QA and the complete repository verification**

  Load the demo fixture through the checked-in environment, inspect desktop and 390 px Reviews/Connected agents/Workspace access, exercise keyboard/filter/deep-link/revoke-safe paths, check console and document overflow, then run `pnpm verify`.

- [ ] **Step 6: Review the final diff against the web-interface and repository UX standards**

  Fetch the current Web Interface Guidelines, audit changed UI files, fix every Critical/Important finding, and rerun the affected focused tests.

- [ ] **Step 7: Request independent code review and resolve findings**

  Dispatch the required reviewer with the approved spec, base SHA, and head SHA. Fix every Critical/Important finding and rerun fresh verification.

- [ ] **Step 8: Commit and push**

  Commit message: `docs: align agent control guidance`

  Push `HEAD` to `cooper/workspace-shell-navigation`.
