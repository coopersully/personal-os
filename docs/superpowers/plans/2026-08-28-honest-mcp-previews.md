# Honest MCP Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop uncurated Ilo tools from opening a generic JSON panel and ship four compact, typed, user-facing Finance MCP presentations.

**Architecture:** Finance API results carry an optional discriminated presentation model whose values and disclosures come from authoritative Finance contracts. The MCP catalog advertises a specific `ui://` resource only for a tool whose API result supplies the matching model; the self-contained MCP Apps format that bounded model and never derive financial meaning. Context, setup, ordinary reads, and every uncurated preview retain text and structured output without UI metadata.

**Tech Stack:** TypeScript, Zod 4, Hono, MCP TypeScript v2, Vitest, JSDOM, pnpm, Biome.

**Spec:** `docs/superpowers/specs/2026-08-28-honest-mcp-previews-design.md`

## Global Constraints

- A tool without an explicit presentation kind never publishes `_meta.ui.resourceUri`.
- Context, setup, ordinary reads, and uncurated previews do not open a visual.
- Text and structured fallbacks remain useful when a host does not support MCP Apps.
- The API supplies financial values, evidence state, disclosures, and next actions; MCP performs presentation only.
- Missing or malformed presentation data fails closed with `This result is available in chat.` and no financial values.
- Raw structured content is never the default visual and any disclosed diagnostic facts are bounded to 50 scalar rows.
- Initial presentations are read-only: `finance_snapshot`, `finance_budget`, `finance_review`, and `finance_period_verification`.
- No new runtime dependency or external network boundary is introduced.
- The implementation must pass `pnpm verify` before PR handoff.

---

## File Structure

- Create `packages/domain/src/finance/presentation.ts`: discriminated Finance presentation contracts and bounded scalar detail rows.
- Modify `packages/domain/src/finance/common.ts`: add optional `presentation` to `FinanceToolResult`.
- Modify `packages/domain/src/finance/reporting.ts`: make the unused snapshot contract honest for unavailable position and budget values and include cash, debt, and investments.
- Modify `packages/domain/src/finance.ts`: export the Finance presentation contract from the stable barrel.
- Modify `packages/domain/src/finance.test.ts`: contract parsing and malformed-presentation coverage.
- Create `apps/api/src/finance/presentation-service.ts`: pure builders from Finance status, budget, inbox, and period-review contracts to `FinanceToolResult` presentations.
- Create `apps/api/src/finance/presentation-service.test.ts`: exhaustive builder fixtures for current, partial, stale, empty, negative, and long content.
- Modify `apps/api/src/finance/profile-budget-service.ts`: attach the budget presentation to budget reads/proposals without recalculating totals.
- Modify `apps/api/src/finance/inbox-service.ts`: attach the review presentation to the first open case.
- Modify `apps/api/src/routes/finances.ts`: add snapshot and period-review presentation endpoints.
- Modify `apps/api/src/routes/finances.test.ts`: authorization and response-shape coverage for the two endpoints.
- Modify `packages/api-client/src/features/finances.ts`: typed snapshot and period-review presentation methods.
- Modify `packages/api-client/src/client.test.ts`: exact URL and response forwarding coverage.
- Create `apps/mcp/src/presentation-resources.ts`: resource URI registry and four self-contained MCP App documents.
- Create `apps/mcp/src/presentation-resources.test.ts`: JSDOM protocol/rendering/accessibility/fallback coverage.
- Modify `apps/mcp/src/tool-catalog.ts`: replace `ui?: boolean` with `presentation?: FinancePresentationKind` and curate four tools.
- Modify `apps/mcp/src/tool-surface.ts`: attach only the resource URI declared for a presentation kind.
- Modify `apps/mcp/src/discovery.ts`: remove the generic work surface and register only scope-visible curated resources.
- Modify `apps/mcp/src/tools/finances.ts`: use the snapshot API result.
- Modify `apps/mcp/src/tools/finances-stewardship.ts`: use the period-review presentation API result.
- Modify `apps/mcp/src/server.test.ts`: discovery, resource, text fallback, kind/resource agreement, and no-JSON-wall coverage.
- Modify `docs/mcp.md`: document selective visual discovery and the four resources.
- Modify `docs/design/system.md`: record the cross-product visual-entrypoint truthfulness invariant.
- Modify `docs/product/implementation-log.md`: record the shipped slice and explicit non-goals.

---

### Task 1: Define the Finance presentation contract

**Files:**
- Create: `packages/domain/src/finance/presentation.ts`
- Modify: `packages/domain/src/finance/common.ts`
- Modify: `packages/domain/src/finance/reporting.ts`
- Modify: `packages/domain/src/finance.ts`
- Test: `packages/domain/src/finance.test.ts`

**Interfaces:**
- Consumes: existing `FinanceCommunication`, `FinanceBudgetVersion`, `FinanceInboxCase`, `FinancePeriodReview`, and `FinanceStatus` values.
- Produces: `FinancePresentationKind`, `FinancePresentation`, `financePresentationSchema`, `financePresentationKindSchema`, `financePresentationResourceKinds`, and optional `FinanceToolResult.presentation`.

- [ ] **Step 1: Write failing schema tests**

Add tests that parse every presentation kind and reject unbounded content. Define `basePresentation`
and `validPresentations` as local fixtures before the assertions:

```ts
const basePresentation = {
  destination: null,
  diagnosticFacts: [],
  disclosures: [],
  eyebrow: "Finance",
  summary: "Grounded summary.",
  title: "Finance result",
};
const validPresentations = [
  {
    ...basePresentation,
    asOf: "2026-08-28T12:00:00.000Z",
    kind: "finance_snapshot",
    position: { cash: 100, debt: 20, investments: 50, netWorth: 130 },
    trust: { gaps: [], state: "current", trustworthy: true },
  },
  {
    ...basePresentation,
    allocations: [],
    assumptions: [],
    balance: 0,
    expectedResources: 100,
    kind: "finance_budget",
    status: "proposed",
    totalAllocated: 100,
  },
  {
    ...basePresentation,
    evidenceCount: 1,
    impactAmount: 12,
    kind: "finance_review",
    prompt: "What was this purchase?",
    reason: "The merchant is ambiguous.",
  },
  {
    ...basePresentation,
    cutoff: "2026-08-28T12:00:00.000Z",
    kind: "finance_period_verification",
    period: { end: "2026-08-28", start: "2026-08-01" },
    recommendations: [],
    status: "completed",
    work: { approvals: 0, exceptions: 0, questions: 0, rulesAndActions: 1 },
  },
] as const;

it("parses the four bounded Finance presentation kinds", () => {
  expect(validPresentations.map((value) => financePresentationSchema.parse(value).kind)).toEqual([
    "finance_snapshot",
    "finance_budget",
    "finance_review",
    "finance_period_verification",
  ]);
});

it("rejects more than fifty diagnostic facts", () => {
  expect(() =>
    financePresentationSchema.parse({
      ...validPresentations[0],
      diagnosticFacts: Array.from({ length: 51 }, (_, index) => ({
        label: `Fact ${index}`,
        value: index,
      })),
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run the domain test and confirm the contract is absent**

Run: `pnpm exec vitest run packages/domain/src/finance.test.ts`

Expected: FAIL because `financePresentationSchema` and its types do not exist.

- [ ] **Step 3: Implement the discriminated contract**

Create a strict union with a shared base and typed payload per presentation:

```ts
const scalarSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);
const diagnosticFactSchema = z.object({
  label: z.string().trim().min(1).max(160),
  value: scalarSchema,
});
const destinationSchema = z.object({
  href: z.string().startsWith("/").max(2_000),
  label: z.string().trim().min(1).max(120),
});
const base = z.object({
  destination: destinationSchema.nullable(),
  diagnosticFacts: z.array(diagnosticFactSchema).max(50).default([]),
  disclosures: z.array(z.object({
    importance: z.enum(["critical", "important"]),
    message: z.string().trim().min(1).max(2_000),
  })).max(20),
  eyebrow: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1_000),
  title: z.string().trim().min(1).max(240),
});

export const financePresentationSchema = z.discriminatedUnion("kind", [
  base.extend({
    asOf: isoDateTimeSchema,
    kind: z.literal("finance_snapshot"),
    position: z.object({
      cash: z.number().finite().nullable(),
      debt: z.number().finite().nullable(),
      investments: z.number().finite().nullable(),
      netWorth: z.number().finite().nullable(),
    }),
    trust: z.object({
      gaps: z.array(z.string().trim().min(1).max(500)).max(50),
      state: z.enum(["current", "partial", "stale", "unavailable"]),
      trustworthy: z.boolean(),
    }),
  }).strict(),
  base.extend({
    allocations: z.array(z.object({
      amount: z.number().finite().nonnegative(),
      description: z.string().trim().min(1).max(500).nullable(),
      key: z.string().trim().min(1).max(120),
      kind: z.enum(["buffer", "debt", "goal", "savings", "spending"]),
    })).max(500),
    assumptions: z.array(z.string().trim().min(1).max(1_000)).max(100),
    balance: z.number().finite(),
    expectedResources: z.number().finite().nonnegative(),
    kind: z.literal("finance_budget"),
    status: z.enum(["incomplete", "proposed", "active", "retired"]),
    totalAllocated: z.number().finite().nonnegative(),
  }).strict(),
  base.extend({
    evidenceCount: z.number().int().nonnegative(),
    impactAmount: z.number().finite().nonnegative().nullable(),
    kind: z.literal("finance_review"),
    prompt: z.string().trim().min(1).max(1_000),
    reason: z.string().trim().min(1).max(500),
  }).strict(),
  base.extend({
    cutoff: isoDateTimeSchema,
    kind: z.literal("finance_period_verification"),
    period: z.object({ end: z.iso.date(), start: z.iso.date() }),
    recommendations: z.array(z.object({
      disposition: z.enum(["monitor", "needs_input", "ready"]),
      recommendation: z.string().trim().min(1).max(1_000),
    })).max(25),
    status: z.enum(["completed", "completed_with_questions"]),
    work: z.object({
      approvals: z.number().int().nonnegative(),
      exceptions: z.number().int().nonnegative(),
      questions: z.number().int().nonnegative(),
      rulesAndActions: z.number().int().nonnegative(),
    }),
  }).strict(),
]);
```

Export the inferred types and add `presentation: financePresentationSchema.optional()` to
`financeToolResultSchema`. Update `FinanceToolResult<T>` through the inferred base rather than a
parallel hand-written field. Change the unused `financeSnapshotSchema` position fields and budget
`allocated`/`spent` fields to nullable, rename its unsupported `inbox.critical` field to the
accurate `inbox.awaitingInput`, and include `cash`, `debt`, and `investments` so unavailable data
cannot become zero.

- [ ] **Step 4: Run focused domain tests**

Run: `pnpm exec vitest run packages/domain/src/finance.test.ts packages/domain/src/domain.test.ts`

Expected: PASS with all four kinds, strict branches, bounded facts, relative destinations, and the optional result field covered.

- [ ] **Step 5: Commit the domain contract**

```bash
git add packages/domain/src/finance/presentation.ts packages/domain/src/finance/common.ts packages/domain/src/finance/reporting.ts packages/domain/src/finance.ts packages/domain/src/finance.test.ts
git commit -m "feat: define Finance presentation contracts"
```

---

### Task 2: Build authoritative API presentations

**Files:**
- Create: `apps/api/src/finance/presentation-service.ts`
- Create: `apps/api/src/finance/presentation-service.test.ts`
- Modify: `apps/api/src/finance/profile-budget-service.ts`
- Modify: `apps/api/src/finance/inbox-service.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Modify: `apps/api/src/routes/finances.test.ts`

**Interfaces:**
- Consumes: `FinanceStatus`, `FinanceBudgetVersion`, `FinanceInboxCase[]`, `FinancePeriodReview`, and `FinanceToolResult<T>`.
- Produces: `buildFinanceSnapshotResult(status, budget)`, `withFinanceBudgetPresentation(result)`, `withFinanceInboxPresentation(result)`, and `buildFinancePeriodReviewResult(review)`.

- [ ] **Step 1: Write failing pure-builder tests**

Cover current and unavailable values without duplicating financial calculations. Define local
typed fixture builders with these exact signatures at the top of the test:

```ts
function statusFixture(overrides: {
  freshnessState?: FinanceStatus["freshness"]["state"];
  wealth?: FinanceStatus["details"]["wealth"];
} = {}): FinanceStatus;
function budgetResultFixture(
  data: FinanceBudgetVersion | null,
): FinanceToolResult<FinanceBudgetVersion | null>;
function budgetFixture(
  changes?: Partial<FinanceBudgetVersion>,
): FinanceBudgetVersion;
```

Build `statusFixture` with `financeStatusSchema.parse` and explicit zero/open/null values for every
required status field; merge only `freshness.state` and `details.wealth` from the overrides. Build
the budget helpers with `financeBudgetVersionSchema.parse` and `financeToolResultSchemaFor` so a
fixture cannot drift from the public contract.

```ts
it("builds a snapshot without replacing unavailable wealth with zero", () => {
  const result = buildFinanceSnapshotResult(
    statusFixture({
      freshnessState: "partial",
      wealth: { cash: null, debt: 2_300, investments: null, netWorth: null },
    }),
    budgetResultFixture(null),
  );
  expect(result.data).toMatchObject({ cash: null, investments: null, netWorth: null });
  expect(result.presentation).toMatchObject({
    kind: "finance_snapshot",
    position: { cash: null, debt: 2_300, investments: null, netWorth: null },
    trust: { state: "partial", trustworthy: false },
  });
});

it("uses the balanced budget values already accepted by the API", () => {
  const input = budgetResultFixture(budgetFixture({ balanceDelta: 0 }));
  expect(withFinanceBudgetPresentation(input).presentation).toMatchObject({
    balance: 0,
    expectedResources: input.data?.expectedResources,
    kind: "finance_budget",
    totalAllocated: input.data?.allocatedTotal,
  });
});
```

Also test an empty inbox (no review presentation), one review with a question and impact, a period
with unresolved questions, negative net worth, stale evidence, 500 allocations, 25
recommendations, and long valid copy.

- [ ] **Step 2: Run the builder tests and confirm the functions are absent**

Run: `pnpm exec vitest run apps/api/src/finance/presentation-service.test.ts`

Expected: FAIL because the presentation service does not exist.

- [ ] **Step 3: Implement pure presentation builders**

Use only source contract values. The snapshot builder derives `trustworthy` from current evidence
plus zero missing provenance, possible duplicates, unmatched transfers, and uncategorized rows;
its `gaps` names every failed assertion. It uses `status.freshness.observedAt` as `asOf` and never
uses `Date.now()`.

```ts
export function buildFinanceSnapshotResult(
  status: FinanceStatus,
  budget: FinanceToolResult<FinanceBudgetVersion | null>,
): FinanceToolResult<FinanceSnapshot> {
  const close = status.details.closeReadiness;
  const trustworthy =
    status.freshness.state === "current" &&
    close.missingProvenance === 0 &&
    close.possibleDuplicates === 0 &&
    close.unmatchedTransfers === 0 &&
    close.uncategorized === 0;
  const data = {
    accounts: {
      current: status.details.accounts.current,
      needingAttention:
        status.details.accounts.blocked +
        status.details.accounts.retrying +
        status.details.accounts.stale,
    },
    asOf: status.freshness.observedAt,
    budget: {
      activeVersionId: budget.data?.status === "active" ? budget.data.id : null,
      allocated: budget.data?.allocatedTotal ?? null,
      remaining: status.details.plan.capacity,
      spent: status.details.month.spending,
    },
    cash: status.details.wealth.cash,
    debt: status.details.wealth.debt,
    inbox: {
      awaitingInput: status.work.awaitingInput,
      open: status.details.review.total,
    },
    investments: status.details.wealth.investments,
    ledger: { reconciledThrough: close.reconciledThrough, trustworthy },
    netWorth: status.details.wealth.netWorth,
  } satisfies FinanceSnapshot;
  return financeSnapshotResultFromStatus(data, status, trustworthy);
}
```

`withFinanceBudgetPresentation` returns an unchanged result when `data` is null.
`withFinanceInboxPresentation` presents only the same first case named by
`communication.nextQuestion`; it exposes evidence count, reason, and impact but not private
payloads. `buildFinancePeriodReviewResult` copies period, cutoff, work counts, status, and the
existing recommendation/disposition pairs.

- [ ] **Step 4: Attach presentations at existing API-owned result builders**

Wrap `getFinanceBudget`, budget proposal/revision responses, and `getFinanceInbox` after their
authoritative `FinanceToolResult` is built. Do not alter approval, mutation, audit, or accounting
paths.

Add:

```ts
app.get("/v1/finances/snapshot", async (context) => {
  const userId = context.get("principal").userId;
  const [status, budget] = await Promise.all([
    financeStatus.getFinanceStatus(userId, { type: "all_outstanding" }),
    finances.getFinanceBudget(userId),
  ]);
  return context.json(buildFinanceSnapshotResult(status, budget));
});

app.get("/v1/finances/period-reviews/:id/presentation", async (context) => {
  if (!financePeriodReviews) throw new Error("Finance period reviews are unavailable.");
  const review = await financePeriodReviews.getOwned(
    context.get("principal").userId,
    idSchema.parse(context.req.param("id")),
  );
  return context.json(buildFinancePeriodReviewResult(review));
});
```

Place the presentation route beside the existing `:id` route and cover exact route selection in
the route test.

- [ ] **Step 5: Add route tests and run API coverage**

Assert `finances:read` is required, foreign reviews still return not found, snapshot uses the same
status and budget calls, and the old raw period-review endpoint remains backward compatible.

Run: `pnpm exec vitest run apps/api/src/finance/presentation-service.test.ts apps/api/src/routes/finances.test.ts apps/api/src/finance/profile-budget-service.integration.test.ts apps/api/src/finance/inbox-service.integration.test.ts`

Expected: PASS with no database mutation from either new read endpoint.

- [ ] **Step 6: Commit the API presentation layer**

```bash
git add apps/api/src/finance/presentation-service.ts apps/api/src/finance/presentation-service.test.ts apps/api/src/finance/profile-budget-service.ts apps/api/src/finance/inbox-service.ts apps/api/src/routes/finances.ts apps/api/src/routes/finances.test.ts
git commit -m "feat: build authoritative Finance presentations"
```

---

### Task 3: Expose typed presentation reads through the API client

**Files:**
- Modify: `packages/api-client/src/features/finances.ts`
- Modify: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes: `FinanceSnapshot`, `FinancePeriodReview`, and `FinanceToolResult<T>` from the domain package.
- Produces: `getFinanceSnapshot(): Promise<FinanceToolResult<FinanceSnapshot>>` and `getFinancePeriodReviewPresentation(id: string): Promise<FinanceToolResult<FinancePeriodReview>>`.

- [ ] **Step 1: Write failing client contract tests**

```ts
await expect(api.getFinanceSnapshot()).resolves.toMatchObject({
  presentation: { kind: "finance_snapshot" },
});
await expect(api.getFinancePeriodReviewPresentation(id)).resolves.toMatchObject({
  presentation: { kind: "finance_period_verification" },
});
expect(fetchMock).toHaveBeenCalledWith(
  expect.stringContaining(`/v1/finances/period-reviews/${id}/presentation`),
  expect.anything(),
);
```

- [ ] **Step 2: Run the client test and verify missing methods fail**

Run: `pnpm exec vitest run packages/api-client/src/client.test.ts`

Expected: FAIL because both methods are absent.

- [ ] **Step 3: Implement the two exact reads**

Add imports for `FinanceSnapshot` and keep the existing raw `getFinancePeriodReview` method. The
new methods call only their exact endpoints and return the API result unchanged so MCP receives
the authoritative presentation.

- [ ] **Step 4: Run client tests and typecheck**

Run: `pnpm exec vitest run packages/api-client/src/client.test.ts && pnpm --filter @personal-os/api-client typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the typed client surface**

```bash
git add packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts
git commit -m "feat: expose Finance presentation reads"
```

---

### Task 4: Make MCP visual discovery explicit and selective

**Files:**
- Create: `apps/mcp/src/presentation-resources.ts`
- Modify: `apps/mcp/src/tool-catalog.ts`
- Modify: `apps/mcp/src/tool-surface.ts`
- Modify: `apps/mcp/src/discovery.ts`
- Modify: `apps/mcp/src/tools/finances.ts`
- Modify: `apps/mcp/src/tools/finances-stewardship.ts`
- Test: `apps/mcp/src/server.test.ts`

**Interfaces:**
- Consumes: `FinancePresentationKind`, `PersonalOsApiClient.getFinanceSnapshot`, and `getFinancePeriodReviewPresentation`.
- Produces: `financePresentationResourceUris`, `registerFinancePresentationResources`, and catalog field `presentation?: FinancePresentationKind`.

- [ ] **Step 1: Replace existing UI expectations with failing selective-discovery tests**

Assert context and uncurated previews have no UI metadata while exactly four Finance reads do.
Define the local lookup immediately after `client.listTools()`:

```ts
const byName = new Map(tools.tools.map((candidate) => [candidate.name, candidate]));
const tool = (name: string) => {
  const value = byName.get(name);
  if (!value) throw new Error(`Missing MCP tool ${name}.`);
  return value;
};

expect(tool("get_ilo_context")._meta).not.toHaveProperty("ui");
expect(tool("get_ilo_setup")._meta).not.toHaveProperty("ui");
expect(tool("preview_mail_rule")._meta).not.toHaveProperty("ui");
expect(tool("preview_calendar_commitment")._meta).not.toHaveProperty("ui");
expect(tool("get_finance_snapshot")._meta).toMatchObject({
  ui: { resourceUri: "ui://ilo/finances/snapshot" },
});
expect(tool("get_finance_budget")._meta).toMatchObject({
  ui: { resourceUri: "ui://ilo/finances/budget" },
});
expect(tool("get_finance_inbox")._meta).toMatchObject({
  ui: { resourceUri: "ui://ilo/finances/review" },
});
expect(tool("get_finance_period_review")._meta).toMatchObject({
  ui: { resourceUri: "ui://ilo/finances/period-verification" },
});
```

Also assert a token without `finances:read` cannot list or read the Finance presentation
resources.

- [ ] **Step 2: Run MCP server tests and verify they fail against the generic resource**

Run: `pnpm exec vitest run apps/mcp/src/server.test.ts`

Expected: FAIL because `get_ilo_context` still advertises `ui://ilo/work-surface` and the curated
URIs are absent.

- [ ] **Step 3: Replace boolean UI catalog metadata**

Change `IloToolDefinition` and helper option types from `ui?: boolean` to:

```ts
presentation?: FinancePresentationKind;
```

Remove the field from every current entry, then set it only on:

```ts
get_finance_snapshot: read("finances", ["finances:read"], "context", {
  presentation: "finance_snapshot",
}),
get_finance_budget: read("finances", ["finances:read"], "inspect", {
  presentation: "finance_budget",
}),
get_finance_inbox: read("finances", ["finances:read"], "inspect", {
  presentation: "finance_review",
}),
get_finance_period_review: read("finances", ["finances:read"], "inspect", {
  presentation: "finance_period_verification",
}),
```

Export an exhaustive URI map from `presentation-resources.ts`. `tool-surface.ts` reads only this
map when attaching `_meta.ui.resourceUri`; an unknown kind is a TypeScript error and a startup
assertion failure.

- [ ] **Step 4: Register only authorized presentation resources**

Delete `iloWorkSurfaceHtml` and the unconditional `ui://ilo/work-surface` registration from
`discovery.ts`. Call `registerFinancePresentationResources(server)` only when the discovered scope
set contains `finances:read`. Each registered resource uses
`text/html;profile=mcp-app`, `prefersBorder: true`, and one exact URI/title.

- [ ] **Step 5: Wire curated tools to presentation-aware API reads**

Change `get_finance_snapshot` to `financeApiResult(() => api.getFinanceSnapshot())` and
`get_finance_period_review` to
`financeApiResult(() => api.getFinancePeriodReviewPresentation(input.reviewId))`. Keep budget and
inbox on their existing reads because Task 2 attached the presentations there. Do not add UI
metadata to mutations returned after an answer or approval.

- [ ] **Step 6: Run MCP discovery and type tests**

Run: `pnpm exec vitest run apps/mcp/src/server.test.ts && pnpm --filter @personal-os/mcp typecheck`

Expected: PASS with four Finance resources for Finance-readable connections, zero visual resources
for non-Finance connections, and unchanged `_ilo` policy/stage metadata.

- [ ] **Step 7: Commit selective discovery**

```bash
git add apps/mcp/src/presentation-resources.ts apps/mcp/src/tool-catalog.ts apps/mcp/src/tool-surface.ts apps/mcp/src/discovery.ts apps/mcp/src/tools/finances.ts apps/mcp/src/tools/finances-stewardship.ts apps/mcp/src/server.test.ts
git commit -m "feat: make MCP visual discovery selective"
```

---

### Task 5: Render useful, accessible Finance MCP Apps

**Files:**
- Modify: `apps/mcp/src/presentation-resources.ts`
- Create: `apps/mcp/src/presentation-resources.test.ts`
- Modify: `apps/mcp/src/server.test.ts`

**Interfaces:**
- Consumes: a tool result whose top-level `presentation.kind` matches the resource's expected `FinancePresentationKind`.
- Produces: four self-contained HTML documents supporting MCP App initialize, tool-result, host-context, size-change, and teardown messages.

- [ ] **Step 1: Write a JSDOM host harness and failing behavior tests**

The harness constructs each document with scripts enabled, stubs `ResizeObserver`, captures
`parent.postMessage`, acknowledges `ui/initialize`, and dispatches
`ui/notifications/tool-result`. Define these local helpers in the test file:

```ts
type OpenPresentation = {
  document: Document;
  messages: unknown[];
  sendHostContext(theme: "dark" | "light"): void;
  sendResult(presentation: FinancePresentation): void;
};
function openPresentation(kind: FinancePresentationKind): OpenPresentation;
function snapshotPresentationFixture(): Extract<
  FinancePresentation,
  { kind: "finance_snapshot" }
>;
```

`openPresentation` creates `new JSDOM(financePresentationDocuments[kind], {
runScripts: "dangerously" })`, installs a synchronous `ResizeObserver` and a `parent.postMessage`
collector in `beforeParse`, then sends the initialize acknowledgement whose ID was captured from
the document's first JSON-RPC message. `sendResult` dispatches a `MessageEvent` with
`params.structuredContent.presentation` and first-party `_ilo.links`; `sendHostContext` dispatches
`ui/notifications/host-context-changed`.

```ts
it("renders snapshot metrics and trust gaps instead of JSON", () => {
  const view = openPresentation("finance_snapshot");
  view.sendResult(snapshotPresentationFixture());
  expect(view.document.querySelector("h1")?.textContent).toBe("Financial snapshot");
  expect(view.document.body.textContent).toContain("Net worth");
  expect(view.document.body.textContent).toContain("Unresolved account ownership");
  expect(view.document.body.textContent).not.toContain('"kind":"finance_snapshot"');
});

it("fails closed when the result kind does not match the resource", () => {
  const view = openPresentation("finance_budget");
  view.sendResult(snapshotPresentationFixture());
  expect(view.document.body.textContent).toContain("This result is available in chat.");
  expect(view.document.body.textContent).not.toContain("$12,000");
});
```

Add tests for currency signs, null shown as `Unavailable`, negative net worth, 500 allocations,
25 recommendations, critical disclosures before details, closed `<details>`, keyboard-focusable
destination link, light/dark host context, long text, resize notification, and teardown response.

- [ ] **Step 2: Run renderer tests and verify the initial resource documents fail**

Run: `pnpm exec vitest run apps/mcp/src/presentation-resources.test.ts`

Expected: FAIL because the resource documents do not yet render typed presentations.

- [ ] **Step 3: Implement the shared MCP App shell and four renderers**

The shell must:

```js
function toolPresentation(payload) {
  return payload?.structuredContent?.presentation
    ?? payload?.params?.structuredContent?.presentation
    ?? payload?.params?.result?.structuredContent?.presentation
    ?? null;
}

function render(payload) {
  clearMain();
  const presentation = toolPresentation(payload);
  if (!presentation || presentation.kind !== EXPECTED_KIND) {
    renderFallback("This result is available in chat.");
    reportSize();
    return;
  }
  RENDERERS[EXPECTED_KIND](presentation);
  reportSize();
}
```

Build DOM nodes with `textContent`; never use result-controlled `innerHTML`. Format money with
`Intl.NumberFormat("en-US", { currency: "USD", style: "currency" })`, retain an explicit minus
sign for negative values, and render null as `Unavailable`. Use one `<main>`, one `<h1>`, semantic
`<dl>` facts, `<ul>` allocations/recommendations, `<aside>` disclosures, one optional `<a>`, and a
closed `<details>` for bounded diagnostic facts.

Resolve `presentation.destination.href` against the origin of `_ilo.links.approvals`, require the
resolved URL to keep that exact origin, and send `ui/open-link` for the resolved HTTPS URL when the
link is activated. Never navigate directly to a result-controlled URL.

The CSS uses host `color-scheme`, system fonts, semantic foreground/background/border custom
properties, a single-column layout below 480px, no animation, and visible native focus. It avoids
fixed heights; the host receives measured content height.

- [ ] **Step 4: Re-run renderer and MCP integration tests**

Run: `pnpm exec vitest run apps/mcp/src/presentation-resources.test.ts apps/mcp/src/server.test.ts`

Expected: PASS with no default raw JSON, no mismatched-kind leakage, and correct MCP App protocol
messages.

- [ ] **Step 5: Commit the renderers**

```bash
git add apps/mcp/src/presentation-resources.ts apps/mcp/src/presentation-resources.test.ts apps/mcp/src/server.test.ts
git commit -m "feat: render useful Finance MCP previews"
```

---

### Task 6: Document the invariant and verify the release

**Files:**
- Modify: `docs/mcp.md`
- Modify: `docs/design/system.md`
- Modify: `docs/product/implementation-log.md`

**Interfaces:**
- Consumes: the final tool/resource catalog and four presentation contracts.
- Produces: current product documentation and complete local verification evidence.

- [ ] **Step 1: Update current documentation**

In `docs/mcp.md`, replace the single generic work-surface description with the four exact URIs,
state that `_meta.ui.resourceUri` is absent for uncurated tools, and document text/structured
fallbacks plus the malformed-result fallback.

In `docs/design/system.md`, add this invariant:

> Advertising a visual entrypoint promises a designed, task-specific view. Ordinary reads stay in
> chat; raw structured output is never the default user-facing visual.

In `docs/product/implementation-log.md`, record the shipped four-view slice and state that
interactive approval, universal dashboards, budget buckets, the Finance playbook, and receipt
lookup remain separate approved work.

- [ ] **Step 2: Run formatting, contract tests, and typechecks**

Run:

```bash
pnpm exec biome check packages/domain/src/finance/presentation.ts packages/domain/src/finance/common.ts packages/domain/src/finance/reporting.ts apps/api/src/finance/presentation-service.ts apps/api/src/routes/finances.ts packages/api-client/src/features/finances.ts apps/mcp/src/presentation-resources.ts apps/mcp/src/tool-catalog.ts apps/mcp/src/tool-surface.ts apps/mcp/src/discovery.ts apps/mcp/src/tools/finances.ts apps/mcp/src/tools/finances-stewardship.ts
pnpm exec vitest run packages/domain/src/finance.test.ts packages/api-client/src/client.test.ts apps/api/src/finance/presentation-service.test.ts apps/api/src/routes/finances.test.ts apps/api/src/finance/profile-budget-service.integration.test.ts apps/api/src/finance/inbox-service.integration.test.ts apps/mcp/src/presentation-resources.test.ts apps/mcp/src/server.test.ts
pnpm typecheck
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Run deterministic repository verification**

Run: `pnpm verify`

Expected: repository checks, lint, type checking, coverage thresholds, production builds, and
desktop/mobile Playwright acceptance all pass.

- [ ] **Step 4: Inspect the final branch and commit documentation**

Run: `git status --short && git diff --stat origin/main...HEAD && git log --oneline origin/main..HEAD`

Expected: only the approved MCP preview slice is present; no generated secrets, runtime state, or
unrelated files appear.

```bash
git add docs/mcp.md docs/design/system.md docs/product/implementation-log.md
git commit -m "docs: document selective MCP previews"
```

- [ ] **Step 5: Re-run the post-commit cleanliness check**

Run: `git status --short --branch && git diff --check origin/main...HEAD`

Expected: a clean worktree on `cooper/honest-mcp-previews` and no whitespace errors.
