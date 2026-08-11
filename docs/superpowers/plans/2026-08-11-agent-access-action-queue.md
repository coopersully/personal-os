# Agent Access Action Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workspace-by-workspace Agent Access scan with one deterministic, paginated action queue, compact workspace status, contextual setup, and preserved access management.

**Architecture:** Add a canonical cross-domain work-item contract in `packages/domain`, an Integration-owned read service in `apps/api`, and one typed API-client method. The web feature consumes that read model through a focused queue component while existing domain services remain authoritative for every mutation and readiness check.

**Tech Stack:** TypeScript, Zod, Drizzle/PostgreSQL, Hono, React 19, TanStack Query, React Router, Testing Library/Vitest, shadcn/ui, Playwright.

## Global Constraints

- Queue pages contain exactly 10 items at every breakpoint.
- Queue kinds are exactly `review`, `attention`, and `setup`.
- Only Mail, Finances, Calendar, and Tasks are agent workspaces; an account-level connection item has `domain: null`.
- The queue is a read model. Mail, Finance, profile, attention, source, and access mutations remain domain-owned.
- Cursor values are opaque to the client and bind the snapshot, ordering tuple, and active filters.
- A successful empty result says **You're caught up**; partial availability never becomes an authoritative zero.
- Agent-owned setup work is not presented as a human action.
- Existing readiness evidence stays inside the selected workspace detail.
- Use existing semantic tokens and reicon glyphs from `@/components/icons`; do not add raw colors or another icon package.
- Run `pnpm verify` before handoff.

---

## File structure

- `packages/domain/src/assistant.ts`: canonical query, work-item, summary, cursor-page schemas and types.
- `packages/domain/src/domain.test.ts`: schema acceptance/rejection coverage.
- `apps/api/src/agent-access-work-items.ts`: cross-domain read projection, ordering, cursor codec, partial-source handling, and pagination.
- `apps/api/src/agent-access-work-items.integration.test.ts`: real database projection and cursor behavior.
- `apps/api/src/routes/assistant.ts`: `/v1/assistant/work-items` transport.
- `apps/api/src/routes/assistant.test.ts`: route parsing and response coverage.
- `apps/api/src/app.ts`: thin Integration-owned service construction/wiring.
- `packages/api-client/src/features/assistant.ts`: typed browser/API consumer.
- `packages/api-client/src/client.test.ts`: request serialization and response parsing coverage.
- `apps/web/src/features/settings/agent-access-queue.tsx`: queue query state, filters, rows, loading/empty/errors, and cursor navigation.
- `apps/web/src/features/settings/agent-access-queue.test.tsx`: focused queue behavior.
- `apps/web/src/features/settings/agent-access.tsx`: page hierarchy, URL-owned workspace/review state, contextual setup, and access-management anchor.
- `apps/web/src/features/settings/agent-access.test.tsx`: integration composition and Mail review deep-link coverage.
- `apps/web/src/styles.css`: page and responsive composition only.
- `apps/web/src/components/ui/empty.tsx`, `apps/web/src/components/ui/pagination.tsx`: official shadcn primitives added through the CLI.
- `docs/design/pages/agent-access.md`, `docs/design/system.md`, `docs/superpowers/specs/2026-08-11-agent-access-action-queue-design.md`: durable design contract.

---

### Task 1: Canonical work-item contract and typed client

**Files:**
- Modify: `packages/domain/src/assistant.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/api-client/src/features/assistant.ts`
- Modify: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Produces: `agentAccessWorkItemQuerySchema`, `AgentAccessWorkItemQuery`, `agentAccessWorkItemSchema`, `AgentAccessWorkItem`, `agentAccessWorkItemPageSchema`, and `AgentAccessWorkItemPage`.
- Produces: `api.listAgentAccessWorkItems(query): Promise<AgentAccessWorkItemPage>`.

- [ ] **Step 1: Write failing domain tests**

Add schema tests that accept an account-level setup item with `domain: null`, a workspace review item with a `MaterialSourceReference`, and a page with exact per-kind/per-domain counts. Reject `limit: 11`, unknown kinds, external action URLs, and malformed cursors.

```ts
const page = agentAccessWorkItemPageSchema.parse({
  items: [{
    action: { label: "Connect an agent", to: "/settings?section=agents&setup=connect" },
    actionAt: null,
    domain: null,
    id: "setup:connect-agent",
    kind: "setup",
    priority: "blocked",
    source: null,
    summary: "Authorize one compatible host.",
    title: "Connect an agent",
    updatedAt: now,
  }],
  nextCursor: null,
  snapshotAt: now,
  summary: {
    byDomain: { calendar: 0, finances: 0, mail: 0, tasks: 0 },
    byKind: { attention: 0, review: 0, setup: 1 },
    total: 1,
  },
  unavailableDomains: [],
});
expect(page.summary.total).toBe(1);
```

- [ ] **Step 2: Run the domain test and confirm the missing exports fail**

Run: `pnpm exec vitest run packages/domain/src/domain.test.ts`

- [ ] **Step 3: Add the Zod schemas and types**

Define the query as `limit` fixed to a maximum of 10 with defaults `{ limit: 10 }`, optional `cursor`, optional workspace `domain`, and optional `kind`. Define action URLs as trimmed strings beginning with `/` so the server cannot project an external destination.

- [ ] **Step 4: Add the failing API-client request test**

Assert that `{ kind: "review", cursor: "opaque" }` requests:

```text
/v1/assistant/work-items?kind=review&cursor=opaque
```

and returns the parsed page without inventing a client-side page shape.

- [ ] **Step 5: Implement `listAgentAccessWorkItems` in the assistant client module**

Use the shared `toQuery` helper and return `agentAccessWorkItemPageSchema.parse(response)`.

- [ ] **Step 6: Run focused domain and client tests**

Run: `pnpm exec vitest run packages/domain/src/domain.test.ts packages/api-client/src/client.test.ts`

- [ ] **Step 7: Commit the contract**

```bash
git add packages/domain/src/assistant.ts packages/domain/src/domain.test.ts packages/api-client/src/features/assistant.ts packages/api-client/src/client.test.ts
git commit -m "Add the Agent Access work-item contract"
```

---

### Task 2: Cross-domain read projection and cursor pagination

**Files:**
- Create: `apps/api/src/agent-access-work-items.ts`
- Create: `apps/api/src/agent-access-work-items.integration.test.ts`

**Interfaces:**
- Consumes: `AgentAccessWorkItem`, `AgentAccessWorkItemPage`, `AgentAccessWorkItemQuery`, `AgentConnectionGuide`, `Principal`, and `Database`.
- Produces: `createAgentAccessWorkItemService({ db, now, sourceReaders? }).list(principal, query, domains): Promise<AgentAccessWorkItemPage>`. The optional reader overrides are a test seam; production uses the database-backed defaults.

- [ ] **Step 1: Write failing projection tests against PostgreSQL**

Cover these fixtures in one owned user and a second-user isolation fixture:

```text
disabled Mail rule       -> review / person_review
open Finance review      -> review / person_review
draft Finance profile    -> review / person_review
critical Mail attention  -> attention / critical
normal Task attention    -> attention / normal
reconnect Calendar source-> attention / blocked
no observed credential   -> one account-level setup / blocked
observed partial scopes   -> one setup blocker per affected published workspace
```

Assert priority ordering, user isolation, scope redaction, kind/domain filters, ten-item pages, forward cursor continuity, invalid/filter-mismatched cursor rejection, summary counts, and `unavailableDomains` behavior through injected failing projection readers.

- [ ] **Step 2: Run the new integration test and confirm the module is missing**

Run: `pnpm exec vitest run apps/api/src/agent-access-work-items.integration.test.ts`

- [ ] **Step 3: Implement the cursor codec and comparator**

Use a Zod-validated base64url JSON payload:

```ts
type AgentAccessCursor = {
  domain: Exclude<AgentAccessWorkItem["domain"], null> | null;
  effectiveAt: string;
  id: string;
  kind: AgentAccessWorkItem["kind"] | null;
  priority: AgentAccessWorkItem["priority"];
  snapshotAt: string;
  updatedAt: string;
};
```

Bind `domain` and `kind` to the query, rank priorities as `person_review`, `blocked`, `critical`, `high`, `normal`, `low`, then sort by earliest effective action time, oldest update time, and stable ID. A mutation-triggered refresh starts a new snapshot.

- [ ] **Step 4: Implement the source projections**

Read only rows owned by `principal.userId` and no later than `snapshotAt`:

- open `attentionItems` for the four workspaces;
- disabled structured `mailRules`;
- open/deferred `financeReviewCases` with deliberately non-sensitive summaries;
- draft `domainProfiles` that require signed-in review;
- `calendarAccounts` with `syncRecovery === "reconnect"`, projected separately for enabled Mail and Calendar capability;
- active, unexpired, observed `accessTokens` for connection and combined scope evidence.

Use allowlisted routes only: `/mail`, `/finances/review`, `/calendar`, `/tasks`, `/settings?section=connections`, and Agent Access query/anchor URLs.

- [ ] **Step 5: Implement partial-source behavior and exact summaries**

Use settled source reads. Successful sources still contribute items; failed sources add their affected workspace to `unavailableDomains`. Set `summary.total` and per-kind/per-domain counts to `null` when a failed source could change that count; otherwise return exact values. Never turn a failed read into zero.

- [ ] **Step 6: Apply filters, cursor, and page slicing**

Filter inaccessible domains by `featureAccessPolicies[domain].readScope`, apply optional query filters, apply the decoded cursor tuple, return at most `limit` items, and emit `nextCursor` only when another ordered candidate remains.

- [ ] **Step 7: Run the integration test**

Run: `pnpm exec vitest run apps/api/src/agent-access-work-items.integration.test.ts`

- [ ] **Step 8: Commit the projection**

```bash
git add apps/api/src/agent-access-work-items.ts apps/api/src/agent-access-work-items.integration.test.ts
git commit -m "Project paginated Agent Access work"
```

---

### Task 3: HTTP route and composition wiring

**Files:**
- Modify: `apps/api/src/routes/assistant.ts`
- Modify: `apps/api/src/routes/assistant.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `createAgentAccessWorkItemService` from Task 2 and `agentAccessWorkItemQuerySchema` from Task 1.
- Produces: authenticated `GET /v1/assistant/work-items`.

- [ ] **Step 1: Write the failing route test**

Pass `kind=review&limit=10`, assert the parsed query reaches `workItems.list` with the current principal and published connection-guide domains, and assert malformed cursor/limit values return the established validation response.

- [ ] **Step 2: Run the focused route test and confirm failure**

Run: `pnpm exec vitest run apps/api/src/routes/assistant.test.ts`

- [ ] **Step 3: Register the route and wire the service**

Extend `AssistantRouteOptions` with:

```ts
workItems: ReturnType<typeof createAgentAccessWorkItemService>;
```

Construct the service beside `createAssistantService` in `app.ts` and pass it to `registerAssistantRoutes`. Keep `app.ts` limited to construction and dependency wiring.

- [ ] **Step 4: Run route, service, and client tests**

Run: `pnpm exec vitest run apps/api/src/routes/assistant.test.ts apps/api/src/agent-access-work-items.integration.test.ts packages/api-client/src/client.test.ts`

- [ ] **Step 5: Commit the route**

```bash
git add apps/api/src/app.ts apps/api/src/routes/assistant.ts apps/api/src/routes/assistant.test.ts
git commit -m "Expose Agent Access work items"
```

---

### Task 4: Queue UI composition

**Files:**
- Create: `apps/web/src/features/settings/agent-access-queue.tsx`
- Create: `apps/web/src/features/settings/agent-access-queue.test.tsx`
- Create through shadcn CLI: `apps/web/src/components/ui/empty.tsx`
- Create through shadcn CLI: `apps/web/src/components/ui/pagination.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `api.listAgentAccessWorkItems`, `AgentAccessWorkItemPage`, `WorkspaceIcon`, and `onSelectWorkspace(domain)`.
- Produces: `<AgentAccessQueue onSelectWorkspace />` with URL-safe links, exact ten-row paging, and query invalidation compatibility.

- [ ] **Step 1: Inspect official shadcn APIs before use**

Run:

```bash
pnpm dlx shadcn@latest docs empty pagination
pnpm dlx shadcn@latest add @shadcn/empty @shadcn/pagination --dry-run
```

Fetch the returned docs URLs, inspect the dry-run diff, then add the two official primitives without overwriting existing components.

- [ ] **Step 2: Write failing queue tests**

Render with mocked pages and assert:

- loading skeleton geometry;
- **You're caught up** on a successful empty page;
- partial availability names unavailable workspaces without showing a false zero;
- `All`, `Review`, `Attention`, and `Setup` reset cursor state;
- Next requests `nextCursor`, Previous returns to the saved cursor, and page one uses no cursor;
- each row exposes text kind/workspace identity and one action;
- account-level setup uses the functional access icon rather than a fake workspace;
- the footer reports `1–10 of 12` only for an exact total.

- [ ] **Step 3: Run the queue test and confirm failure**

Run: `pnpm exec vitest run apps/web/src/features/settings/agent-access-queue.test.tsx`

- [ ] **Step 4: Implement queue state and rendering**

Keep `kind`, `cursor`, and previous-cursor stack local to the queue. Use one TanStack query key:

```ts
["agent-access-work-items", { cursor, kind }]
```

Compose `Card`, labelled `ToggleGroup`, `ItemGroup`, `Item`, `Badge`, `Button`, `Pagination`, `Skeleton`, `Empty`, and `Alert`. Use `WorkspaceIcon` for workspace items and `KeyIcon` for `domain: null`.

- [ ] **Step 5: Add responsive composition styles**

Keep the queue one column, allow metadata to wrap, preserve a persistent action button, forbid horizontal overflow, and use only existing semantic tokens.

- [ ] **Step 6: Run focused queue tests and lint**

Run: `pnpm exec vitest run apps/web/src/features/settings/agent-access-queue.test.tsx && pnpm lint`

- [ ] **Step 7: Commit the queue**

```bash
git add apps/web/src/components/ui/empty.tsx apps/web/src/components/ui/pagination.tsx apps/web/src/features/settings/agent-access-queue.tsx apps/web/src/features/settings/agent-access-queue.test.tsx apps/web/src/styles.css
git commit -m "Build the Agent Access action queue"
```

---

### Task 5: Recompose Agent Access around actions and contextual setup

**Files:**
- Modify: `apps/web/src/features/settings/agent-access.tsx`
- Modify: `apps/web/src/features/settings/agent-access.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `<AgentAccessQueue />` from Task 4 and the existing readiness/setup/access components.
- Produces: URL parameters `workspace=mail|finances|calendar|tasks`, `setup=connect`, and `reviewRule=<uuid>`.

- [ ] **Step 1: Rewrite the failing page-composition expectations**

Assert this scan order:

```text
Agent access
Your action queue
Agent workspaces
selected readiness/setup detail
Access management
```

Also assert workspace selection is URL-owned, `setup=connect` opens the connection disclosure, `reviewRule=<id>` opens the bounded Mail rule dialog and activation path, active Mail rules do not render as default-page rows, and credential/token behavior remains intact.

- [ ] **Step 2: Run the page test and confirm the old hierarchy fails**

Run: `pnpm exec vitest run apps/web/src/features/settings/agent-access.test.tsx`

- [ ] **Step 3: Make workspace selection URL-owned**

Use `useSearchParams`; preserve `section=agents`, validate workspace values against `setupDomainOptions`, and default to `mail`. Queue workspace actions and workspace choices update the same parameter.

- [ ] **Step 4: Recompose the page hierarchy**

Replace the hero title with **Agent access**, put `AgentAccessQueue` first, rename the selector group **Agent workspaces**, and place one selected detail region beneath it. Move setup disclosures into that region. Add `id="access-management"` around hosts/tokens and keep revoked history collapsed.

- [ ] **Step 5: Move Mail review into a labelled dialog**

Convert `MailRuleReview` into a bounded dialog driven by `reviewRule`. Load the exact saved-rule preview on open, retain the active-profile prerequisite and fingerprint/version checks, close by removing only `reviewRule`, and invalidate Mail rules, setup context, work items, and setup status after activation.

- [ ] **Step 6: Preserve loading/error/readiness behavior**

Keep `ReadinessPanel` evidence, provider failure truth, setup-plan polling, copy feedback, OAuth revoke, local-token creation, and token history tests passing. Do not render the generic readiness error twice.

- [ ] **Step 7: Run focused web tests and typecheck**

Run:

```bash
pnpm exec vitest run apps/web/src/features/settings/agent-access.test.tsx apps/web/src/features/settings/agent-access-queue.test.tsx apps/web/src/components/readiness-panel.test.tsx
pnpm typecheck
```

- [ ] **Step 8: Commit the page composition**

```bash
git add apps/web/src/features/settings/agent-access.tsx apps/web/src/features/settings/agent-access.test.tsx apps/web/src/styles.css
git commit -m "Make Agent Access action first"
```

---

### Task 6: Durable docs, acceptance coverage, and full verification

**Files:**
- Modify: `docs/design/pages/agent-access.md`
- Modify: `docs/design/system.md`
- Modify: `docs/superpowers/specs/2026-08-11-agent-access-action-queue-design.md`
- Modify when acceptance coverage belongs there: `e2e/product.spec.ts`

**Interfaces:**
- Consumes: the completed HTTP and web behavior.
- Produces: aligned product contract and end-to-end evidence.

- [ ] **Step 1: Update the durable design sources**

Replace the old readiness-first information hierarchy with the action-first queue contract. Record `domain: null` for account-level work, exact queue ordering, cursor/filter behavior, workspace detail ownership, and the reusable system rule: a cross-domain supervision surface prioritizes actionable work over diagnostic status.

- [ ] **Step 2: Add or extend Playwright acceptance coverage**

Cover disconnected desktop and connected mobile fixtures, more than ten mixed work items, kind filter reset, Next/Previous, workspace selection, a Mail review deep link, and the caught-up state. Keep fixtures deterministic and provider-free.

- [ ] **Step 3: Run focused acceptance tests**

Run the narrowest supported Playwright command for the changed spec in both desktop and mobile projects.

- [ ] **Step 4: Run formatting and whitespace checks**

Run: `git diff --check && pnpm lint`

- [ ] **Step 5: Run complete repository verification**

Run: `pnpm verify`

Expected: environment checks, lint, type checking, coverage thresholds, production builds, and desktop/mobile Playwright all pass.

- [ ] **Step 6: Inspect the final worktree and commit**

```bash
git status --short
git add docs/design/pages/agent-access.md docs/design/system.md docs/superpowers/specs/2026-08-11-agent-access-action-queue-design.md e2e/product.spec.ts
git commit -m "Document and verify the Agent Access queue"
```

- [ ] **Step 7: Report evidence and remaining external risks**

Report focused test results, `pnpm verify`, cursor/page behavior, responsive QA, and the fact that mocked/local checks do not prove a third-party agent host can complete production OAuth or provider reconnection.
