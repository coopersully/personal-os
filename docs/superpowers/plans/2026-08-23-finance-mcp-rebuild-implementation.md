# Finance MCP Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Rebuild ilo Finance so a fully scoped agent can set up, budget, maintain, reconcile, and audit the user's finances entirely through an understandable MCP surface.

**Architecture:** Finance domain schemas define the capability manifest, durable protocols, and shared response envelope. PostgreSQL stores versioned plans, transaction relationships, review lineage, provenance, and caller-driven runs; focused API services enforce those invariants, and MCP tools remain thin, discoverable adapters over the typed API client. Existing web projections keep compiling, but this plan contains no Finance web UI work and no automation scheduler.

**Tech Stack:** TypeScript, Zod, PostgreSQL 17, Drizzle ORM and migrations, Hono, MCP TypeScript SDK, Vitest, Testcontainers, pnpm.

**Spec:** docs/superpowers/plans/2026-08-23-finance-mcp-rebuild-design.md

## Global Constraints

- Do not design or implement Finance web UI.
- Do not create, configure, schedule, inspect, or persist external automations.
- No Finance operation may depend on an internal queue or hidden worker.
- With finances:read, finances:write, and enabled bypass, every ilo-owned Finance capability must be executable through MCP.
- External-provider authentication may return a secure handoff; ilo web-app handoffs are forbidden.
- Interactive review asks one question at a time and applies each answer before returning the next question.
- Unattended maintenance settles after creating deduplicated review cases; unanswered questions never block a run.
- Imported evidence retains stable transaction identity and attributed revisions.
- Agent mutations must never be recorded as user-confirmed.
- Every mutation is idempotent and audited; versioned aggregates reject stale expected versions.
- Preserve unrelated dirty-worktree changes.
- Use expand-migrate-contract and keep every migration, Drizzle schema change, and journal entry consistent.
- Run focused tests after each task and pnpm verify before final handoff.

## File Structure

The implementation introduces focused modules while preserving existing public barrels:

- packages/domain/src/finance.ts remains the public Finance barrel.
- packages/domain/src/finance/common.ts owns shared outcomes, communication, diagnostics, provenance, and mutation metadata.
- packages/domain/src/finance/capabilities.ts owns the complete domain-to-API-to-MCP parity manifest.
- packages/domain/src/finance/profile.ts owns structured profile and bypass-setting schemas.
- packages/domain/src/finance/budget.ts owns versioned budget, allocation, goal, approval, and balance-proof schemas.
- packages/domain/src/finance/ledger.ts owns account, transaction, revision, event, relationship, classification, import, and export schemas.
- packages/domain/src/finance/inbox.ts owns review identity, lineage, question, and answer schemas.
- packages/domain/src/finance/maintenance.ts owns setup and maintenance protocol unions.
- packages/domain/src/finance/reporting.ts owns snapshot, cashflow, wealth, budget-status, and ledger-health projections.
- packages/database/src/schema.ts remains the single Drizzle schema.
- packages/database/migrations/0037_finance_plan_versions.sql adds agent settings, setup sessions, profile versions, budget plans and versions, allocations, and financial goals.
- packages/database/migrations/0038_finance_ledger_protocol.sql adds events, relationships, revisions, review identity/lineage, maintenance runs, judgments, findings, and provenance.
- apps/api/src/finance-service.ts remains the compatibility façade and composes focused services.
- apps/api/src/finance/context.ts owns trusted actor, idempotency, approval, and bypass context.
- apps/api/src/finance/profile-budget-service.ts owns profile, setup-state primitives, budgets, approvals, and goals.
- apps/api/src/finance/account-service.ts owns provider connections, freshness, sync, account mutation, and disconnection.
- apps/api/src/finance/ledger-service.ts owns transaction search, revisions, splits, classifications, relationships, imports, and exports.
- apps/api/src/finance/inbox-service.ts owns stable review upsert, answer application, deduplication, resolution, and reopening.
- apps/api/src/finance/maintenance-service.ts owns deterministic stages, reasoning batches, reconciliation, audit stages, and settlement.
- apps/api/src/finance/setup-service.ts owns the one-question setup protocol and its transition into maintenance.
- apps/api/src/finance/organization-service.ts owns merchants, rules, recurring items, and financial goals.
- apps/api/src/finance/reporting-service.ts owns snapshot and focused report calculations.
- apps/api/src/routes/finances.ts exposes the complete typed HTTP surface with Finance scopes and no Finance requireHuman guards.
- packages/api-client/src/features/finances.ts exposes one typed client method for every API operation.
- apps/mcp/src/tools/finances/index.ts registers the complete Finance surface.
- apps/mcp/src/tools/finances/common.ts converts typed API values to the shared MCP result and hosts common schema fragments.
- apps/mcp/src/tools/finances/workflows.ts registers setup, maintenance, snapshot, and maintenance-history tools.
- apps/mcp/src/tools/finances/planning.ts registers profile, budget, and goal tools.
- apps/mcp/src/tools/finances/accounts.ts registers account and provider-connection tools.
- apps/mcp/src/tools/finances/ledger.ts registers transaction, category, relationship, import, export, and health tools.
- apps/mcp/src/tools/finances/inbox.ts registers Inbox and answer tools.
- apps/mcp/src/tools/finances/organization.ts registers merchant, rule, and recurring tools.
- apps/mcp/src/tools/finances/reports.ts registers cashflow and wealth reports.
- apps/mcp/src/tools/finances.ts is deleted after apps/mcp/src/server.ts imports the new registration module explicitly.

---

### Task 1: Canonical Finance domain contracts and capability manifest

**Files:**
- Create: packages/domain/src/finance/common.ts
- Create: packages/domain/src/finance/capabilities.ts
- Create: packages/domain/src/finance/profile.ts
- Create: packages/domain/src/finance/budget.ts
- Create: packages/domain/src/finance/ledger.ts
- Create: packages/domain/src/finance/inbox.ts
- Create: packages/domain/src/finance/maintenance.ts
- Create: packages/domain/src/finance/reporting.ts
- Modify: packages/domain/src/finance.ts
- Create: packages/domain/src/finance.test.ts

**Interfaces:**
- Produces: FinanceToolResult<T>, FinanceMutationMeta, FinanceProfileVersion, FinanceBudgetVersion, FinanceInboxCase, FinanceSetupInput, FinanceMaintenanceInput, FinanceMaintenancePayload, financeCapabilityManifest. The existing legacy FinanceReviewCase export remains available until API callers migrate.
- FinanceToolResult<T> always carries outcome, communication, changes, remainingWork, optional nextAction, optional diagnostics, and data.
- financeCapabilityManifest maps every domain capability to exactly one API operation and one MCP tool.

- [ ] **Step 1: Write failing schema and manifest tests**

~~~ts
import {
  financeBudgetVersionSchema,
  financeCapabilityManifest,
  financeMaintenanceInputSchema,
  financeInboxCaseSchema,
  financeToolResultSchema,
} from "./finance.js";

it("defines balanced plan, review identity, protocol, and parity contracts", () => {
  expect(financeCapabilityManifest.map((item) => item.mcpTool)).toContain("setup_finances");
  expect(new Set(financeCapabilityManifest.map((item) => item.capability)).size).toBe(
    financeCapabilityManifest.length,
  );
  expect(
    financeMaintenanceInputSchema.parse({ operation: "start", scope: { type: "all_outstanding" } }),
  ).toMatchObject({ operation: "start" });
  expect(() =>
    financeBudgetVersionSchema.parse({
      id: crypto.randomUUID(),
      planId: crypto.randomUUID(),
      version: 1,
      status: "proposed",
      effectiveFrom: "2026-08",
      expectedResources: 5000,
      allocatedTotal: 4900,
      balanceDelta: 100,
      allocations: [],
      assumptions: [],
      rationale: "Initial plan",
      createdAt: new Date().toISOString(),
      approvedAt: null,
    }),
  ).toThrow();
  expect(
    financeInboxCaseSchema.parse({
      id: crypto.randomUUID(),
      economicEventId: crypto.randomUUID(),
      stableKey: "event:merchant_identity",
      reason: "merchant_identity",
      status: "open",
      evidence: {},
      proposedResolution: null,
      impactAmount: 12,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      resolvedAt: null,
      reopenedFromId: null,
    }).stableKey,
  ).toBe("event:merchant_identity");
  expect(
    financeToolResultSchema.parse({
      schemaVersion: 1,
      outcome: "user_input_required",
      communication: {
        headline: "One item needs your answer.",
        requiredDisclosures: [],
        optionalDetails: [],
        nextQuestion: { id: "profile:household_size", prompt: "How many people?", answerType: "integer" },
      },
      changes: [],
      remainingWork: { count: 1, categories: ["profile"] },
      data: {},
    }).outcome,
  ).toBe("user_input_required");
});
~~~

- [ ] **Step 2: Run the domain test and confirm the missing exports fail**

Run: pnpm vitest run packages/domain/src/finance.test.ts

Expected: FAIL because the canonical Finance modules and exports do not exist.

- [ ] **Step 3: Implement the focused Zod modules and public barrel**

Define the common result envelope as a generic factory plus inferred base type:

~~~ts
export const financeOutcomeSchema = z.enum([
  "completed",
  "work_remaining",
  "user_input_required",
  "external_action_required",
  "failed",
]);

export function financeToolResultSchemaFor<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    schemaVersion: z.literal(1),
    outcome: financeOutcomeSchema,
    communication: financeCommunicationSchema,
    changes: z.array(financeChangeSchema),
    remainingWork: financeRemainingWorkSchema,
    nextAction: financeNextActionSchema.optional(),
    diagnostics: financeDiagnosticsSchema.optional(),
    data,
  });
}
~~~

Define discriminated setup and maintenance inputs:

~~~ts
export const financeSetupInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("start") }),
  z.object({
    operation: z.literal("answer"),
    sessionId: idSchema,
    questionId: z.string().min(1),
    answer: z.string().min(1).max(10_000),
    idempotencyKey: z.string().min(1).max(200),
  }),
  z.object({
    operation: z.literal("approve_budget"),
    sessionId: idSchema,
    budgetVersionId: idSchema,
    approvalSource: z.enum(["user_instruction", "agent_self_approval"]),
    idempotencyKey: z.string().min(1).max(200),
  }),
  z.object({ operation: z.literal("resume"), sessionId: idSchema }),
]);

export const financeMaintenanceInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("start"), scope: financeMaintenanceScopeSchema }),
  z.object({
    operation: z.literal("submit_judgments"),
    runId: idSchema,
    expectedVersion: z.number().int().positive(),
    judgments: z.array(financeMaintenanceJudgmentSchema).min(1).max(100),
    idempotencyKey: z.string().min(1).max(200),
  }),
  z.object({
    operation: z.literal("submit_audit"),
    runId: idSchema,
    expectedVersion: z.number().int().positive(),
    findings: z.array(financeAuditFindingInputSchema).max(100),
    idempotencyKey: z.string().min(1).max(200),
  }),
  z.object({ operation: z.literal("resume"), runId: idSchema }),
]);
~~~

Make financeCapabilityManifest an exhaustive readonly array whose entries contain capability, apiOperation, mcpTool, mode, and requiredScope. Include every tool approved in the design spec and reject duplicate capabilities in the test.

Keep packages/domain/src/finance.ts as a re-export barrel so existing imports remain valid while legacy schemas are temporarily re-exported during migration.

- [ ] **Step 4: Run focused domain tests and type checking**

Run: pnpm vitest run packages/domain/src/finance.test.ts packages/domain/src/domain.test.ts && pnpm --filter @personal-os/domain typecheck

Expected: PASS.

- [ ] **Step 5: Commit the domain contract**

~~~bash
git add packages/domain/src/finance.ts packages/domain/src/finance packages/domain/src/finance.test.ts
git commit -m "feat(finance): define canonical agent contracts"
~~~

### Task 2: Versioned profile, setup, budget, goal, and bypass persistence

**Files:**
- Modify: packages/database/src/schema.ts
- Create: packages/database/migrations/0037_finance_plan_versions.sql
- Modify: packages/database/migrations/meta/_journal.json
- Create: packages/database/src/finance-schema.integration.test.ts

**Interfaces:**
- Produces Drizzle tables: financeAgentSettings, financeSetupSessions, financeProfileVersions, financeBudgetPlans, financeBudgetVersions, financeBudgetAllocations, financeGoals.
- Enforces one current profile version per user, monotonically increasing budget versions per plan, and unique allocation keys per budget version.

- [ ] **Step 1: Add a failing fresh-migration persistence test**

~~~ts
it("persists versioned Finance plans and bypass settings", async () => {
  const [settings] = await client.db
    .insert(financeAgentSettings)
    .values({ userId, reviewBypassEnabled: true })
    .returning();
  const [plan] = await client.db
    .insert(financeBudgetPlans)
    .values({ userId, name: "Monthly plan" })
    .returning();
  const [version] = await client.db
    .insert(financeBudgetVersions)
    .values({
      planId: plan!.id,
      userId,
      version: 1,
      status: "proposed",
      effectiveFrom: "2026-08",
      expectedResources: "5000.00",
      allocatedTotal: "5000.00",
      balanceDelta: "0.00",
      rationale: "Initial plan",
      assumptions: [],
    })
    .returning();
  expect(settings?.reviewBypassEnabled).toBe(true);
  expect(version?.version).toBe(1);
});
~~~

- [ ] **Step 2: Run the database test and confirm missing tables fail**

Run: pnpm vitest run packages/database/src/finance-schema.integration.test.ts

Expected: FAIL because the new Drizzle exports do not exist.

- [ ] **Step 3: Add schema tables and generate the named migration**

Use UUID primary keys, user foreign keys with cascade deletion, timestamptz audit fields, integer versions, integer-cent money columns consistent with the existing Finance schema, and jsonb assumptions/provenance where structure is already validated by the domain boundary. This repository stopped producing Drizzle snapshots after `0009`; follow the established manual SQL plus journal-entry convention rather than generating a misleading snapshot from stale metadata.

Generate the migration:

~~~bash
pnpm --filter @personal-os/database db:generate -- --name finance_plan_versions
~~~

Review the generated SQL and ensure it includes:

~~~sql
CREATE UNIQUE INDEX "finance_profile_versions_user_version_unique"
  ON "finance_profile_versions" ("user_id", "version");
CREATE UNIQUE INDEX "finance_budget_versions_plan_version_unique"
  ON "finance_budget_versions" ("plan_id", "version");
CREATE UNIQUE INDEX "finance_budget_allocations_version_key_unique"
  ON "finance_budget_allocations" ("budget_version_id", "allocation_key");
~~~

Backfill existing finance_profiles into version 1 profile rows. Convert each user's legacy budget rows into an inactive incomplete historical plan unless the rows contain both expected resources and a zero balance delta. Do not activate an inferred balanced plan.

- [ ] **Step 4: Run migration, database tests, and schema type checking**

Run: pnpm vitest run packages/database/src/finance-schema.integration.test.ts && pnpm --filter @personal-os/database typecheck

Expected: PASS against a database initialized exclusively from repository migrations.

- [ ] **Step 5: Commit the planning persistence transition**

~~~bash
git add packages/database/src/schema.ts packages/database/src/finance-schema.integration.test.ts packages/database/migrations
git commit -m "feat(finance): add versioned planning persistence"
~~~

### Task 3: Economic events, review lineage, maintenance, and provenance persistence

**Files:**
- Modify: packages/database/src/schema.ts
- Create: packages/database/migrations/0038_finance_ledger_protocol.sql
- Modify: packages/database/migrations/meta/_journal.json
- Create: packages/database/migrations/meta/0038_snapshot.json
- Modify: packages/database/src/client.test.ts

**Interfaces:**
- Produces Drizzle tables: financeEconomicEvents, financeEventTransactions, financeTransactionRevisions, financeTransactionRelationships, financeMaintenanceRuns, financeMaintenanceJudgments, financeAuditFindings, financeMutationRecords.
- Extends financeReviewCases with stableKey, reasonCode, economicEventId, evidence, proposedResolution, impactAmount, firstSeenAt, lastSeenAt, reopenedFromId, resolution, and resolution provenance.
- Exactly one active review exists per user and stable key.

- [ ] **Step 1: Add failing constraints tests**

~~~ts
it("deduplicates active reviews while retaining resolved lineage", async () => {
  const [event] = await client.db
    .insert(financeEconomicEvents)
    .values({ userId, kind: "purchase", stableKey: "fixture:event-1" })
    .returning();
  if (!event) throw new Error("Economic-event fixture was not created.");
  await client.db.insert(financeReviewCases).values({
    userId,
    economicEventId: event.id,
    stableKey: "event-1:possible_duplicate",
    reasonCode: "possible_duplicate",
    status: "open",
    evidence: {},
    firstSeenAt: now,
    lastSeenAt: now,
  });
  await expect(
    client.db.insert(financeReviewCases).values({
      userId,
      economicEventId: event.id,
      stableKey: "event-1:possible_duplicate",
      reasonCode: "possible_duplicate",
      status: "open",
      evidence: {},
      firstSeenAt: now,
      lastSeenAt: now,
    }),
  ).rejects.toThrow();
});
~~~

- [ ] **Step 2: Run the database test and confirm missing storage fails**

Run: pnpm vitest run packages/database/src/client.test.ts

Expected: FAIL because economic-event and protocol tables are absent.

- [ ] **Step 3: Add schema changes and generate the named migration**

Generate:

~~~bash
pnpm --filter @personal-os/database db:generate -- --name finance_ledger_protocol
~~~

Ensure the generated migration replaces the old transaction/status uniqueness rule with a partial active-case constraint:

~~~sql
CREATE UNIQUE INDEX "finance_review_cases_active_stable_key_unique"
  ON "finance_review_cases" ("user_id", "stable_key")
  WHERE "status" IN ('open', 'deferred');
~~~

Edit the branch-local generated SQL into an expand/backfill/constrain sequence: add stable_key and reason_code as nullable, backfill them from existing transaction ID and reason, verify no nulls remain, then set both columns NOT NULL and create the partial unique index. Preserve existing resolved rows. Do not copy the transaction ledger into a new table; add events and relationships lazily so transaction IDs remain stable and deployment does not perform an unbounded ledger backfill.

- [ ] **Step 4: Run fresh migration tests and inspect SQL**

Run: pnpm vitest run packages/database/src/client.test.ts && pnpm --filter @personal-os/database typecheck

Expected: PASS. Confirm foreign keys are created after referenced tables and no unbounded UPDATE scans transaction history.

- [ ] **Step 5: Commit the ledger protocol persistence**

~~~bash
git add packages/database/src/schema.ts packages/database/src/client.test.ts packages/database/migrations
git commit -m "feat(finance): persist ledger protocol and review lineage"
~~~

### Task 4: Trusted Finance mutation context, bypass, and idempotency

**Files:**
- Create: apps/api/src/finance/context.ts
- Create: apps/api/src/finance/context.test.ts
- Modify: apps/api/src/routes/support.ts
- Modify: apps/api/src/routes/support.test.ts
- Modify: apps/api/src/routes/finances.ts

**Interfaces:**
- Produces: FinanceMutationContext, loadFinanceAuthorization(), requireFinanceMutation(), executeFinanceIdempotently().
- FinanceMutationContext derives actor identity and scopes from Principal, requestId from the server, and bypass from financeAgentSettings.
- Agent self-approval requires finances:write and reviewBypassEnabled. User-instruction approval is audited distinctly.

- [ ] **Step 1: Write failing authorization and retry tests**

~~~ts
it("allows a fully scoped bypass agent and distinguishes its provenance", async () => {
  const context = await loadFinanceAuthorization({
    db,
    principal: {
      actorId: "finance-agent",
      actorType: "agent",
      scopes: new Set(["finances:read", "finances:write"]),
      userId,
    },
    requestId: "request-1",
  });
  expect(context).toMatchObject({
    actorType: "agent",
    bypassEnabled: true,
    canMutate: true,
    canSelfApprove: true,
  });
});

it("returns the first mutation result for a repeated idempotency key", async () => {
  const mutate = vi.fn(async () => ({ id: "created-once" }));
  expect(await executeFinanceIdempotently(db, context, "key-1", mutate)).toEqual({
    id: "created-once",
  });
  expect(await executeFinanceIdempotently(db, context, "key-1", mutate)).toEqual({
    id: "created-once",
  });
  expect(mutate).toHaveBeenCalledTimes(1);
});
~~~

- [ ] **Step 2: Run focused tests and confirm missing helpers fail**

Run: pnpm vitest run apps/api/src/finance/context.test.ts apps/api/src/routes/support.test.ts

Expected: FAIL because the trusted Finance context does not exist.

- [ ] **Step 3: Implement trusted context and remove Finance human-only gates**

Implement the context shape:

~~~ts
export type FinanceMutationContext = {
  actorId: string;
  actorType: Principal["actorType"];
  userId: string;
  requestId: string;
  bypassEnabled: boolean;
  canMutate: boolean;
  canSelfApprove: boolean;
};
~~~

Persist idempotency results in financeMutationRecords using userId plus idempotencyKey uniqueness. A repeated key with a different operation hash returns invalid_request instead of replaying unrelated data.

Remove requireHuman from Finance profile, income, insight-refresh, connection, import, and account lifecycle routes. Keep requireHuman available for other domains. Finance routes continue to use requireFeatureAccess("finances"), which returns the exact missing scope.

- [ ] **Step 4: Run authorization, route-support, and type tests**

Run: pnpm vitest run apps/api/src/finance/context.test.ts apps/api/src/routes/support.test.ts && pnpm --filter @personal-os/api typecheck

Expected: PASS.

- [ ] **Step 5: Commit the Finance authorization contract**

~~~bash
git add apps/api/src/finance/context.ts apps/api/src/finance/context.test.ts apps/api/src/routes/support.ts apps/api/src/routes/support.test.ts apps/api/src/routes/finances.ts
git commit -m "feat(finance): enforce scoped bypass and idempotency"
~~~

### Task 5: Structured profile, versioned budgets, approvals, and goals vertical slice

**Files:**
- Create: apps/api/src/finance/profile-budget-service.ts
- Create: apps/api/src/finance/profile-budget-service.integration.test.ts
- Modify: apps/api/src/finance-service.ts
- Modify: apps/api/src/routes/finances.ts
- Modify: packages/api-client/src/features/finances.ts
- Modify: packages/api-client/src/client.test.ts

**Interfaces:**
- Produces service methods: getFinancialProfile, updateFinancialProfile, getFinanceBudget, createFinanceBudget, reviseFinanceBudget, approveFinanceBudget, getFinanceBudgetStatus, listFinanceGoals, manageFinanceGoal.
- All writes accept FinanceMutationContext plus idempotencyKey and expectedVersion where an aggregate already exists.
- create and revise reject any budget whose resources minus allocations is not exactly zero.

- [ ] **Step 1: Write failing profile and budget lifecycle integration tests**

~~~ts
it("persists each profile answer and activates a balanced successor budget", async () => {
  const profile = await service.updateFinancialProfile(
    {
      expectedVersion: 0,
      idempotencyKey: "profile-1",
      changes: { householdSize: 1, expectedMonthlyTakeHome: 8000 },
    },
    context,
  );
  const proposed = await service.createFinanceBudget(
    {
      idempotencyKey: "budget-1",
      effectiveFrom: "2026-09",
      expectedResources: 8000,
      rationale: "Initial plan",
      assumptions: [],
      allocations: [
        { key: "housing", kind: "spending", categoryId: housingId, amount: 2300 },
        { key: "living", kind: "spending", categoryId: livingId, amount: 3700 },
        { key: "goal", kind: "goal", goalId, amount: 1800 },
        { key: "buffer", kind: "buffer", amount: 200 },
      ],
    },
    context,
  );
  const active = await service.approveFinanceBudget(
    {
      budgetVersionId: proposed.id,
      expectedVersion: proposed.version,
      approvalSource: "agent_self_approval",
      idempotencyKey: "approve-1",
    },
    context,
  );
  expect(profile.version).toBe(1);
  expect(active.status).toBe("active");
  expect(active.balanceDelta).toBe(0);
});
~~~

Also assert self-approval fails when bypass is false and succeeds for explicit user-instruction approval.

- [ ] **Step 2: Run the integration test and confirm service methods fail**

Run: pnpm vitest run apps/api/src/finance/profile-budget-service.integration.test.ts

Expected: FAIL because the focused service and canonical routes do not exist.

- [ ] **Step 3: Implement transactional profile and budget operations**

Use a database transaction for version allocation, complete allocation insertion, balance validation, and activation:

~~~ts
if (roundMoney(input.expectedResources - allocatedTotal) !== 0) {
  throw new AppError(
    "invalid_request",
    "A complete budget must assign every expected resource or show an explicit funding source.",
  );
}
~~~

Activating a version retires the previous active version in the same transaction. Reporting stores the governing version ID. Return FinanceToolResult values whose required disclosures include expected resources, total allocation, buffer or deficit, and material assumptions.

Add typed routes under:

- GET and PATCH /v1/finances/profile
- GET and POST /v1/finances/budgets
- POST /v1/finances/budgets/:id/revisions
- POST /v1/finances/budgets/:id/approve
- GET /v1/finances/budget-status
- GET and POST /v1/finances/goals
- PATCH and DELETE /v1/finances/goals/:id

Add matching API-client methods with canonical domain input and output types.

- [ ] **Step 4: Run integration, client, and type tests**

Run: pnpm vitest run apps/api/src/finance/profile-budget-service.integration.test.ts packages/api-client/src/client.test.ts && pnpm --filter @personal-os/api typecheck && pnpm --filter @personal-os/api-client typecheck

Expected: PASS.

- [ ] **Step 5: Commit the planning vertical slice**

~~~bash
git add apps/api/src/finance/profile-budget-service.ts apps/api/src/finance/profile-budget-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/routes/finances.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts
git commit -m "feat(finance): add profile and budget lifecycle"
~~~

### Task 6: Complete account and provider lifecycle

**Files:**
- Create: apps/api/src/finance/account-service.ts
- Create: apps/api/src/finance/account-service.integration.test.ts
- Modify: apps/api/src/finance-service.ts
- Modify: apps/api/src/routes/finances.ts
- Modify: packages/api-client/src/features/finances.ts
- Modify: packages/api-client/src/client.test.ts

**Interfaces:**
- Produces: listFinanceAccounts, startFinanceAccountConnection, getFinanceAccountConnection, syncFinanceAccounts, updateFinanceAccount, disconnectFinanceAccount.
- A provider failure returns an account-scoped issue with affectedWork, unaffectedWork, remedy, retryable, and secure handoff when applicable.

- [ ] **Step 1: Write failing source-scoping and lifecycle tests**

~~~ts
it("reports a failed source without blocking healthy accounts", async () => {
  const result = await service.syncFinanceAccounts(
    { accountIds: [failedDiscoverId, healthyAmexId], idempotencyKey: "sync-1" },
    context,
  );
  expect(result.outcome).toBe("completed");
  expect(result.data.syncedAccountIds).toContain(healthyAmexId);
  expect(result.diagnostics?.issues).toContainEqual(
    expect.objectContaining({
      scope: "account",
      affectedWork: [failedDiscoverId],
      unaffectedWork: expect.arrayContaining([healthyAmexId]),
    }),
  );
});
~~~

Also test that disconnect preserves imported history by default and requires an explicit historyDisposition to exclude it.

- [ ] **Step 2: Run the account integration test and confirm failure**

Run: pnpm vitest run apps/api/src/finance/account-service.integration.test.ts

Expected: FAIL because the complete account service does not exist.

- [ ] **Step 3: Extract and complete account behavior**

Move Plaid connection, exchange, sync, and account lifecycle code from finance-service.ts into account-service.ts without changing encryption boundaries. Add update and connection-status projections. Translate provider failures into Finance diagnostics and continue each independent requested account.

Expose:

- GET /v1/finances/accounts
- POST /v1/finances/accounts/connect
- GET /v1/finances/accounts/connections/:id
- POST /v1/finances/accounts/sync
- PATCH /v1/finances/accounts/:id
- DELETE /v1/finances/accounts/:id

Return the provider authorization URL or token in data.externalHandoff and never an ilo web URL.

- [ ] **Step 4: Run account, legacy Finance integration, and client tests**

Run: pnpm vitest run apps/api/src/finance/account-service.integration.test.ts apps/api/src/finance-service.integration.test.ts packages/api-client/src/client.test.ts

Expected: PASS.

- [ ] **Step 5: Commit account lifecycle completeness**

~~~bash
git add apps/api/src/finance/account-service.ts apps/api/src/finance/account-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/routes/finances.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts
git commit -m "feat(finance): expose complete account lifecycle"
~~~

### Task 7: Canonical ledger mutations, economic relationships, import, and export

**Files:**
- Create: apps/api/src/finance/ledger-service.ts
- Create: apps/api/src/finance/ledger-service.integration.test.ts
- Modify: apps/api/src/finance-service.ts
- Modify: apps/api/src/routes/finances.ts
- Modify: packages/api-client/src/features/finances.ts
- Modify: packages/api-client/src/client.test.ts

**Interfaces:**
- Produces: listFinanceTransactions, getFinanceTransaction, addFinanceTransaction, updateFinanceTransaction, removeFinanceTransaction, splitFinanceTransaction, classifyFinanceTransactions, linkFinanceTransactions, getFinanceCategories, getFinanceLedgerHealth, importFinanceTransactions, exportFinanceData.
- listFinanceTransactions uses one opaque base64url cursor contract through domain, API, client, and MCP.
- update, split, classify, link, remove, and import record trusted actor provenance.

- [ ] **Step 1: Write failing ledger integrity tests**

~~~ts
it("revises, classifies, and links transactions without losing source evidence", async () => {
  const revised = await service.updateFinanceTransaction(
    transactionId,
    {
      expectedVersion: 1,
      idempotencyKey: "revise-1",
      changes: { notes: "Shared expense" },
    },
    agentContext,
  );
  const linked = await service.linkFinanceTransactions(
    {
      idempotencyKey: "link-1",
      relationship: "reimbursement",
      transactionIds: [transactionId, reimbursementId],
      rationale: "The deposit reimburses the shared expense.",
    },
    agentContext,
  );
  expect(revised.revisions.at(-1)).toMatchObject({ actorType: "agent" });
  expect(linked.relationship).toBe("reimbursement");
  expect((await service.getFinanceTransaction(transactionId, userId)).sourceAmount).toBe(100);
});
~~~

Add tests for balanced splits, idempotent CSV retries, manual-row removal, imported-row exclusion, and opaque cursor round trips.

- [ ] **Step 2: Run the ledger integration test and confirm failure**

Run: pnpm vitest run apps/api/src/finance/ledger-service.integration.test.ts

Expected: FAIL because revision and economic-relationship operations are missing.

- [ ] **Step 3: Implement ledger operations transactionally**

Create an economic event lazily when a relationship or review requires it. A split must satisfy:

~~~ts
const splitTotal = input.parts.reduce((total, part) => total + part.amount, 0);
if (roundMoney(splitTotal) !== roundMoney(source.amount)) {
  throw new AppError("invalid_request", "Split parts must equal the source transaction amount.");
}
~~~

Store classification meaning separately from category. Replace client-supplied actor source with FinanceMutationContext. Preserve legacy list and overview projections during the transition.

Expose canonical transaction detail, revision, split, classification, relationship, import, export, category, and health routes and matching typed client methods.

- [ ] **Step 4: Run ledger, CSV, legacy integration, and client tests**

Run: pnpm vitest run apps/api/src/finance/ledger-service.integration.test.ts apps/api/src/finance-csv.test.ts apps/api/src/finance-service.integration.test.ts packages/api-client/src/client.test.ts

Expected: PASS.

- [ ] **Step 5: Commit the canonical ledger slice**

~~~bash
git add apps/api/src/finance/ledger-service.ts apps/api/src/finance/ledger-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/routes/finances.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts
git commit -m "feat(finance): add canonical ledger operations"
~~~

### Task 8: Transaction-backed Inbox and atomic one-question answering

**Files:**
- Create: apps/api/src/finance/inbox-service.ts
- Create: apps/api/src/finance/inbox-service.integration.test.ts
- Modify: apps/api/src/finance-service.ts
- Modify: apps/api/src/routes/finances.ts
- Modify: packages/api-client/src/features/finances.ts
- Modify: packages/api-client/src/client.test.ts

**Interfaces:**
- Produces: upsertFinanceReview, getFinanceInbox, answerFinanceReview, reopenFinanceReviewForContradictoryEvidence.
- Stable identity is userId plus economic-event identity plus reason.
- answerFinanceReview applies the financial mutation and resolves the case in one database transaction, then returns at most one nextQuestion.

- [ ] **Step 1: Write failing deduplication and answer-loop tests**

~~~ts
it("applies one answer and returns exactly one next question", async () => {
  const first = await service.getFinanceInbox(userId);
  expect(first.communication.nextQuestion?.id).toBe(firstCaseId);
  const answered = await service.answerFinanceReview(
    firstCaseId,
    {
      answer: "This was a reimbursement from my partner.",
      resolution: {
        type: "link_transactions",
        relationship: "reimbursement",
        relatedTransactionId: reimbursementId,
      },
      idempotencyKey: "answer-1",
    },
    agentContext,
  );
  expect(answered.changes).toHaveLength(1);
  expect(answered.communication.nextQuestion?.id).toBe(secondCaseId);
  expect(answered.remainingWork.count).toBe(3);
});
~~~

Add tests that a second maintenance pass updates lastSeenAt instead of inserting a duplicate, and contradictory evidence creates a reopened case linked to the resolved predecessor.

- [ ] **Step 2: Run the Inbox integration test and confirm failure**

Run: pnpm vitest run apps/api/src/finance/inbox-service.integration.test.ts

Expected: FAIL because stable review upsert and atomic answering are missing.

- [ ] **Step 3: Implement Inbox ordering and answer transactions**

Order open review by material impact descending, then firstSeenAt ascending. Render one concise domain question from reason code and evidence. Keep question wording out of the identity key.

Inside answerFinanceReview, lock the review row, reject a stale/resolved case, invoke the required ledger/profile mutation, write resolution provenance, commit, recalculate affected projections, and query the next case. An ambiguous answer result leaves the same case open and returns one clarification.

Expose:

- GET /v1/finances/inbox
- POST /v1/finances/inbox/:id/answer

- [ ] **Step 4: Run Inbox, ledger, and client tests**

Run: pnpm vitest run apps/api/src/finance/inbox-service.integration.test.ts apps/api/src/finance/ledger-service.integration.test.ts packages/api-client/src/client.test.ts

Expected: PASS.

- [ ] **Step 5: Commit the Finance Inbox**

~~~bash
git add apps/api/src/finance/inbox-service.ts apps/api/src/finance/inbox-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/routes/finances.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts
git commit -m "feat(finance): add transaction-backed Inbox"
~~~

### Task 9: Caller-driven maintenance, reconciliation, and red-team audit

**Files:**
- Create: apps/api/src/finance/maintenance-service.ts
- Create: apps/api/src/finance/maintenance-service.integration.test.ts
- Modify: apps/api/src/finance-service.ts
- Modify: apps/api/src/routes/finances.ts
- Modify: packages/api-client/src/features/finances.ts
- Modify: packages/api-client/src/client.test.ts

**Interfaces:**
- Produces: maintainFinances(input, context), getFinanceMaintenanceHistory(userId, query).
- Stages are deterministic_processing, agent_reasoning, reconciliation, agent_audit, settled, and failed.
- No method enqueues work. Every call commits progress and returns the next bounded action.

- [ ] **Step 1: Write failing complete and partial-source protocol tests**

~~~ts
it("advances synchronously through reasoning and audit to settlement", async () => {
  const started = await service.maintainFinances(
    { operation: "start", scope: { type: "all_outstanding" } },
    agentContext,
  );
  expect(started.data.stage).toBe("agent_reasoning");
  expect(started.nextAction?.tool).toBe("maintain_finances");

  const reasoned = await service.maintainFinances(
    {
      operation: "submit_judgments",
      runId: started.data.runId,
      expectedVersion: started.data.version,
      judgments: started.data.reasoningBatch.map((item) => ({
        type: "classify_transaction" as const,
        transactionId: item.transactionId,
        meaning: "Routine grocery purchase",
        categoryId: groceriesCategoryId,
        confidence: 0.99,
        rationale: "Merchant history and transaction evidence agree.",
      })),
      idempotencyKey: "judgments-1",
    },
    agentContext,
  );
  expect(reasoned.data.stage).toBe("agent_audit");

  const settled = await service.maintainFinances(
    {
      operation: "submit_audit",
      runId: started.data.runId,
      expectedVersion: reasoned.data.version,
      findings: [],
      idempotencyKey: "audit-1",
    },
    agentContext,
  );
  expect(settled.outcome).toBe("completed");
  expect(settled.data.stage).toBe("settled");
});
~~~

Add a test where one connection fails, healthy-account transactions are still categorized, review cases are persisted, and the run settles with an account-scoped diagnostic.

- [ ] **Step 2: Run the maintenance integration test and confirm failure**

Run: pnpm vitest run apps/api/src/finance/maintenance-service.integration.test.ts

Expected: FAIL because maintainFinances does not exist.

- [ ] **Step 3: Implement the durable synchronous stage machine**

Use SELECT FOR UPDATE on the run row and expectedVersion on continuation. Start performs source sync and deterministic rules before returning. Deterministic rules may create relationships and high-confidence classifications but must record source rule provenance.

Reasoning batches include complete transaction evidence, existing preferences, candidate relationships, category choices, budget context, and allowed judgment variants. Persist submitted judgments before advancing.

Reconciliation verifies relationship totals, split balance, posted/pending separation, budget governing version, and provenance. The audit batch includes recent baselines, outliers, reimbursements, category ambiguity, and budget variance. Audit findings create or update Inbox cases. Settlement records counts, material changes, source issues, and remaining review.

Expose:

- POST /v1/finances/maintenance
- GET /v1/finances/maintenance
- GET /v1/finances/maintenance/:id

- [ ] **Step 4: Run maintenance, Inbox, ledger, and client tests**

Run: pnpm vitest run apps/api/src/finance/maintenance-service.integration.test.ts apps/api/src/finance/inbox-service.integration.test.ts apps/api/src/finance/ledger-service.integration.test.ts packages/api-client/src/client.test.ts

Expected: PASS with no timer, polling loop, queue record, or automation dependency.

- [ ] **Step 5: Commit maintenance protocol**

~~~bash
git add apps/api/src/finance/maintenance-service.ts apps/api/src/finance/maintenance-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/routes/finances.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts
git commit -m "feat(finance): add caller-driven maintenance protocol"
~~~

### Task 10: Guided financial setup protocol

**Files:**
- Create: apps/api/src/finance/setup-service.ts
- Create: apps/api/src/finance/setup-service.integration.test.ts
- Modify: apps/api/src/finance-service.ts
- Modify: apps/api/src/routes/finances.ts
- Modify: packages/api-client/src/features/finances.ts
- Modify: packages/api-client/src/client.test.ts

**Interfaces:**
- Produces: setupFinances(input, context).
- setupFinances persists one answer, returns at most one nextQuestion, creates a proposed balanced budget, supports user or authorized agent approval, and transitions to maintain_finances.

- [ ] **Step 1: Write the failing one-question setup acceptance test**

~~~ts
it("persists each answer before returning the next setup question", async () => {
  const started = await service.setupFinances({ operation: "start" }, agentContext);
  expect(started.communication.nextQuestion?.id).toBe("profile:location");

  const answered = await service.setupFinances(
    {
      operation: "answer",
      sessionId: started.data.sessionId,
      questionId: "profile:location",
      answer: "Brooklyn, New York",
      idempotencyKey: "setup-answer-1",
    },
    agentContext,
  );
  expect((await service.getFinancialProfile(userId))?.jurisdiction).toBe("US-NY");
  expect(answered.communication.nextQuestion?.id).not.toBe("profile:location");
  expect(answered.communication.nextQuestion).toEqual(
    expect.objectContaining({ id: expect.any(String), prompt: expect.any(String) }),
  );
});
~~~

Add a full-path test that uses observed ledger facts, asks only missing material questions, proposes a balanced budget, self-approves only with bypass, and returns nextAction tool maintain_finances.

- [ ] **Step 2: Run the setup integration test and confirm failure**

Run: pnpm vitest run apps/api/src/finance/setup-service.integration.test.ts

Expected: FAIL because the guided setup protocol does not exist.

- [ ] **Step 3: Implement deterministic setup question selection**

Question priority is:

1. jurisdiction and household facts required for the plan;
2. reliable expected take-home;
3. fixed obligations and debt minimums not supported by ledger evidence;
4. emergency liquidity and near-term goals;
5. material insurance and risk constraints;
6. preference questions only when two viable plans differ materially.

Infer observed values with provenance and confidence; do not ask the user to repeat reliable connected evidence. Each answer calls the profile or goal service inside the same transaction that advances financeSetupSessions.currentQuestionKey.

When inputs are sufficient, create one complete proposal using conservative recent posted activity and explicit assumptions. Return the proposal disclosures. Approval activates the budget and returns maintain_finances as the next action. A resumed completed session returns the settled snapshot rather than duplicating work.

Expose POST /v1/finances/setup and the matching typed client method.

- [ ] **Step 4: Run setup, planning, maintenance, and client tests**

Run: pnpm vitest run apps/api/src/finance/setup-service.integration.test.ts apps/api/src/finance/profile-budget-service.integration.test.ts apps/api/src/finance/maintenance-service.integration.test.ts packages/api-client/src/client.test.ts

Expected: PASS.

- [ ] **Step 5: Commit guided setup**

~~~bash
git add apps/api/src/finance/setup-service.ts apps/api/src/finance/setup-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/routes/finances.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts
git commit -m "feat(finance): add guided financial setup"
~~~

### Task 11: Merchants, rules, recurring items, and complete reporting

**Files:**
- Create: apps/api/src/finance/organization-service.ts
- Create: apps/api/src/finance/reporting-service.ts
- Create: apps/api/src/finance/organization-service.integration.test.ts
- Create: apps/api/src/finance/reporting-service.integration.test.ts
- Modify: apps/api/src/finance-service.ts
- Modify: apps/api/src/routes/finances.ts
- Modify: apps/api/src/finance-cashflow.ts
- Modify: apps/api/src/finance-cashflow.test.ts
- Modify: packages/api-client/src/features/finances.ts
- Modify: packages/api-client/src/client.test.ts

**Interfaces:**
- Produces: listFinanceMerchants, updateFinanceMerchant, mergeFinanceMerchants, listFinanceRules, manageFinanceRule, listFinanceRecurringItems, manageFinanceRecurringItem.
- Produces: getFinanceSnapshot, getFinanceCashflow, getFinanceWealthSummary, getFinanceBudgetStatus, getFinanceLedgerHealth.
- All report projections state source freshness, pending treatment, governing budget version, and material uncertainty.

- [ ] **Step 1: Write failing organization and reporting tests**

~~~ts
it("returns material facts before optional report detail", async () => {
  const snapshot = await reporting.getFinanceSnapshot(userId);
  expect(snapshot.communication.requiredDisclosures[0]?.message).toContain("budget");
  expect(snapshot.data).toMatchObject({
    accounts: expect.any(Object),
    budget: expect.any(Object),
    inbox: expect.any(Object),
    ledger: expect.any(Object),
  });
});

it("merges merchants idempotently and keeps rule provenance", async () => {
  const first = await organization.mergeFinanceMerchants(
    { sourceMerchantId, targetMerchantId, idempotencyKey: "merge-1" },
    context,
  );
  const repeated = await organization.mergeFinanceMerchants(
    { sourceMerchantId, targetMerchantId, idempotencyKey: "merge-1" },
    context,
  );
  expect(repeated).toEqual(first);
});
~~~

- [ ] **Step 2: Run focused tests and confirm missing services fail**

Run: pnpm vitest run apps/api/src/finance/organization-service.integration.test.ts apps/api/src/finance/reporting-service.integration.test.ts

Expected: FAIL because the focused organization and reporting services are absent.

- [ ] **Step 3: Implement organization operations and canonical projections**

Extract existing merchant, category-rule, recurring-income, obligation, forecast, budget-status, wealth, and ledger-health logic. Add search and opaque pagination to merchant listing. Make rule create/update/enable/disable/remove one discriminated manage operation. Make recurring management distinguish income, obligation, subscription, and reimbursement.

Compute snapshot from the same canonical services rather than truncating to 200 transactions. Required disclosures include only critical or important facts. Keep the existing web-facing overview and budget-pace methods as compatibility projections over canonical results.

Expose canonical merchant, rule, recurring, snapshot, cashflow, wealth, status, and health routes and matching client methods.

- [ ] **Step 4: Run organization, reporting, cashflow, legacy integration, and client tests**

Run: pnpm vitest run apps/api/src/finance/organization-service.integration.test.ts apps/api/src/finance/reporting-service.integration.test.ts apps/api/src/finance-cashflow.test.ts apps/api/src/finance-service.integration.test.ts packages/api-client/src/client.test.ts

Expected: PASS.

- [ ] **Step 5: Commit organization and reporting completeness**

~~~bash
git add apps/api/src/finance/organization-service.ts apps/api/src/finance/reporting-service.ts apps/api/src/finance/organization-service.integration.test.ts apps/api/src/finance/reporting-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/routes/finances.ts apps/api/src/finance-cashflow.ts apps/api/src/finance-cashflow.test.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts
git commit -m "feat(finance): complete organization and reporting services"
~~~

### Task 12: MCP result adapter, workflow, profile, and budget tools

**Files:**
- Create: apps/mcp/src/tools/finances/common.ts
- Create: apps/mcp/src/tools/finances/workflows.ts
- Create: apps/mcp/src/tools/finances/planning.ts
- Create: apps/mcp/src/tools/finances/index.ts
- Create: apps/mcp/src/tools/finances/test-support.ts
- Create: apps/mcp/src/tools/finances/workflows.test.ts

**Interfaces:**
- Produces registerFinanceTools(server, api), registerFinanceWorkflowTools(), registerFinancePlanningTools(), financeResult().
- Test support produces createFinanceMcpTestHarness(api, register) and readFinanceStructuredContent(result), shared by focused Finance MCP tests without changing the production server until the full replacement surface is ready.
- Registers setup_finances, maintain_finances, get_finance_snapshot, get_finance_maintenance_history, get_financial_profile, update_financial_profile, get_finance_budget, create_finance_budget, revise_finance_budget, approve_finance_budget, get_finance_budget_status, list_finance_goals, manage_finance_goal.

- [ ] **Step 1: Write failing tool-description and workflow tests**

~~~ts
it("makes setup and one-question continuation discoverable", async () => {
  const { client } = await createFinanceMcpTestHarness(api, (server, clientApi) => {
    registerFinanceWorkflowTools(server, clientApi);
    registerFinancePlanningTools(server, clientApi);
  });
  const tools = await client.listTools();
  const setup = tools.tools.find((tool) => tool.name === "setup_finances");
  expect(setup?.description).toContain("Use this when the user asks to set up");
  expect(setup?.description).toContain("Do not ask the user to name a tool");

  const result = await client.callTool({
    name: "setup_finances",
    arguments: { operation: "start" },
  });
  expect(readFinanceStructuredContent(result)).toMatchObject({
    outcome: "user_input_required",
    communication: { nextQuestion: { id: "profile:location" } },
  });
});
~~~

Add a maintenance test that the first call returns immediate reasoning work rather than queued status and a budget test that bypass self-approval is callable.

- [ ] **Step 2: Run MCP workflow tests and confirm missing tools fail**

Run: pnpm vitest run apps/mcp/src/tools/finances/workflows.test.ts apps/mcp/src/server.test.ts

Expected: FAIL because the new registration modules and tool names do not exist.

- [ ] **Step 3: Implement thin discoverable MCP adapters**

Use financeResult to preserve structuredContent and supply a concise text fallback from communication.headline plus the one next question. Do not transform accounting values or duplicate domain policy.

Implement createFinanceMcpTestHarness with McpServer, a registration callback typed as (server: McpServer, api: PersonalOsApiClient) => void, the existing linked InMemoryTransport pair, and a Client. The helper invokes the callback with both values before connecting the transports. Implement readFinanceStructuredContent by asserting result.structuredContent is an object and parsing it with the shared Finance result schema.

Each description uses this structure:

~~~ts
const setupDescription =
  "Use this when the user asks to set up their finances, create or finish a financial profile, or make their first budget. The tool inspects existing state, returns one question at a time, persists each answer, and guides the caller through budget approval and initial maintenance. Do not ask the user to name a tool or visit the ilo web app.";
~~~

Annotations must accurately distinguish reads, idempotent writes, external-provider access, and destructive operations. Keep the production server on the complete legacy registration until Task 14 can replace it atomically.

- [ ] **Step 4: Run MCP workflow, server, security, and type tests**

Run: pnpm vitest run apps/mcp/src/tools/finances/workflows.test.ts apps/mcp/src/security.test.ts && pnpm --filter @personal-os/mcp typecheck

Expected: PASS for the isolated new registration modules while the production server remains unchanged.

- [ ] **Step 5: Commit workflow and planning MCP tools**

~~~bash
git add apps/mcp/src/tools/finances
git commit -m "feat(finance): add workflow and planning MCP tools"
~~~

### Task 13: MCP account, ledger, and Inbox tools

**Files:**
- Create: apps/mcp/src/tools/finances/accounts.ts
- Create: apps/mcp/src/tools/finances/ledger.ts
- Create: apps/mcp/src/tools/finances/inbox.ts
- Create: apps/mcp/src/tools/finances/ledger.test.ts
- Modify: apps/mcp/src/tools/finances/index.ts

**Interfaces:**
- Registers all approved account, transaction, category, relationship, import, export, health, Inbox, and answer tool names.
- answer_finance_review returns the applied change and at most one next question.

- [ ] **Step 1: Write failing inventory and four-answer loop tests**

~~~ts
it("applies four review answers before completing the Inbox", async () => {
  const { client } = await createFinanceMcpTestHarness(api, registerFinanceTools);
  const reviewIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ];
  const answers = reviewIds.map((reviewId, index) => ({
    text: "Answer " + (index + 1),
    resolution: { type: "confirm_classification" as const, categoryId, reviewId },
  }));
  for (const [index, answer] of answers.entries()) {
    const result = await client.callTool({
      name: "answer_finance_review",
      arguments: {
        reviewId: reviewIds[index],
        answer: answer.text,
        resolution: answer.resolution,
        idempotencyKey: "answer-" + index,
      },
    });
    const content = readFinanceStructuredContent(result);
    expect(content.changes).toHaveLength(1);
    expect(content.remainingWork.count).toBe(3 - index);
    expect(content.communication.nextQuestion).toEqual(
      index === 3 ? undefined : expect.objectContaining({ id: reviewIds[index + 1] }),
    );
  }
});
~~~

Assert the inventory contains list_finance_accounts, start_finance_account_connection, get_finance_account_connection, sync_finance_accounts, update_finance_account, disconnect_finance_account, every approved ledger tool, get_finance_inbox, and answer_finance_review.

- [ ] **Step 2: Run the MCP ledger test and confirm missing registrations fail**

Run: pnpm vitest run apps/mcp/src/tools/finances/ledger.test.ts

Expected: FAIL because account, ledger, and Inbox modules are not registered.

- [ ] **Step 3: Register exact schemas and intent-first descriptions**

Reuse domain input schemas wherever the MCP SDK accepts their Zod shapes. Give each mutation an idempotencyKey. Preserve the opaque transaction cursor as an opaque string; do not describe or parse it as a datetime.

The get_finance_inbox description must tell the agent to ask only communication.nextQuestion.prompt. The answer_finance_review description must tell it to call the tool immediately after the user's answer, briefly acknowledge changes, and then ask only the returned next question.

Connection tools return provider handoffs directly in structured content. Their descriptions prohibit sending the user to the ilo web application.

- [ ] **Step 4: Run MCP ledger, server, security, and type tests**

Run: pnpm vitest run apps/mcp/src/tools/finances/ledger.test.ts apps/mcp/src/security.test.ts && pnpm --filter @personal-os/mcp typecheck

Expected: PASS.

- [ ] **Step 5: Commit account, ledger, and Inbox MCP tools**

~~~bash
git add apps/mcp/src/tools/finances
git commit -m "feat(finance): add ledger and Inbox MCP tools"
~~~

### Task 14: MCP organization and reporting tools, parity enforcement, and legacy retirement

**Files:**
- Create: apps/mcp/src/tools/finances/organization.ts
- Create: apps/mcp/src/tools/finances/reports.ts
- Create: apps/mcp/src/tools/finances/parity.test.ts
- Modify: apps/mcp/src/tools/finances/index.ts
- Modify: apps/mcp/src/server.ts
- Modify: apps/mcp/src/server.test.ts
- Delete: apps/mcp/src/tools/finances.ts
- Modify: packages/api-client/src/features/finances.ts

**Interfaces:**
- Registers list_finance_merchants, update_finance_merchant, merge_finance_merchants, list_finance_rules, manage_finance_rule, list_finance_recurring_items, manage_finance_recurring_item, get_finance_cashflow, and get_finance_wealth_summary.
- Parity test proves every financeCapabilityManifest entry has a typed API-client operation and registered MCP tool.
- Removes conflicting legacy MCP names listed as replace or remove in the design.

- [ ] **Step 1: Write the failing parity and legacy-removal test**

~~~ts
it("matches the domain capability manifest exactly", async () => {
  const { client } = await createFinanceMcpTestHarness(api, registerFinanceTools);
  const registered = new Set(
    (await client.listTools()).tools
      .map((tool) => tool.name)
      .filter((name) => name.includes("finance") || name === "setup_finances" || name === "maintain_finances"),
  );
  const expected = new Set(financeCapabilityManifest.map((item) => item.mcpTool));
  expect(registered).toEqual(expected);
  expect(registered).not.toContain("get_finance_review_queue");
  expect(registered).not.toContain("propose_finance_categorizations");
  expect(registered).not.toContain("apply_finance_categorizations");
  expect(registered).not.toContain("categorize_finance_transaction");
});
~~~

Also assert every manifest apiOperation is a function on createFinanceApi(mockRequest).

- [ ] **Step 2: Run parity and server tests and confirm failure**

Run: pnpm vitest run apps/mcp/src/tools/finances/parity.test.ts apps/mcp/src/server.test.ts packages/api-client/src/client.test.ts

Expected: FAIL until the final tools are registered and old names are removed.

- [ ] **Step 3: Register final tools and remove the legacy file**

Move retained wealth, cashflow, merchant, merge, category, status, health, list-transaction, and add-transaction names onto their canonical API methods. Register replacement names from the manifest. Change server.ts to import apps/mcp/src/tools/finances/index.js, then delete the legacy registration file so agents cannot select obsolete proposal/apply or direct-categorization paths.

Update the server inventory assertion to compare Finance names with the manifest while continuing to assert the exact non-Finance tools independently.

- [ ] **Step 4: Run all MCP, API-client, and type tests**

Run: pnpm vitest run apps/mcp/src apps/api/src/finance-service.integration.test.ts packages/api-client/src/client.test.ts && pnpm --filter @personal-os/mcp typecheck && pnpm --filter @personal-os/api-client typecheck

Expected: PASS with exact domain/API/MCP capability parity.

- [ ] **Step 5: Commit MCP completeness and legacy retirement**

~~~bash
git add apps/mcp/src/tools/finances apps/mcp/src/server.ts apps/mcp/src/server.test.ts packages/api-client/src/features/finances.ts
git rm apps/mcp/src/tools/finances.ts
git commit -m "feat(finance): complete and simplify MCP surface"
~~~

### Task 15: Conversation acceptance, migration preservation, and full verification

**Files:**
- Create: apps/mcp/src/tools/finances/conversation-acceptance.test.ts
- Create: apps/api/src/finance-migration-preservation.integration.test.ts
- Modify: apps/api/src/finance-service.integration.test.ts
- Modify: apps/mcp/src/server.test.ts
- Modify: docs/mcp.md

**Interfaces:**
- Verifies natural-language routing metadata and deterministic tool-call/result sequences without depending on one model vendor.
- Verifies representative legacy profile, budget, review, and transaction records survive migrations with correct canonical state.

- [ ] **Step 1: Add failing end-to-end acceptance fixtures**

Create table-driven cases:

~~~ts
const cases = [
  {
    intent: "Let's set up my finances",
    expectedTool: "setup_finances",
    forbiddenText: ["tool name", "Finance app"],
  },
  {
    intent: "Yes",
    priorState: { offeredReviewCount: 4 },
    expectedNextQuestionCount: 1,
    forbiddenText: ["queued", "checkpoint", "run id"],
  },
  {
    intent: "How am I doing?",
    expectedTool: "get_finance_snapshot",
    requiredFirstFactImportance: ["critical", "important"],
  },
] as const;
~~~

The acceptance harness should validate tool descriptions, response envelopes, continuation instructions, and simulated caller behavior. It must prove four answers create four mutations, bypass self-approval avoids ilo web handoff, a stale source permits unrelated settlement, and a provider error supplies a precise external remedy.

Seed legacy rows before applying migrations in the preservation test. Assert transaction IDs remain unchanged, existing resolved reviews remain resolved, active duplicate review cases collapse to one stable identity, and legacy budget rows become inactive incomplete history rather than an active balanced plan.

- [ ] **Step 2: Run acceptance and migration tests and confirm any uncovered gaps**

Run: pnpm vitest run apps/mcp/src/tools/finances/conversation-acceptance.test.ts apps/api/src/finance-migration-preservation.integration.test.ts

Expected: FAIL on any missing conversational contract or unsafe migration behavior.

- [ ] **Step 3: Fix only the uncovered contract gaps and document the final MCP surface**

Update docs/mcp.md with:

- natural-language entry intents;
- the setup and maintenance continuation model;
- one-question Inbox behavior;
- bypass and required Finance scopes;
- external-provider handoff behavior;
- the generated capability inventory;
- the absence of ilo automation and queue semantics.

Do not add web UI documentation or instructions telling users to visit the web application.

- [ ] **Step 4: Run focused suites, then repository verification**

Run:

~~~bash
pnpm vitest run packages/domain/src/finance.test.ts packages/database/src/client.test.ts apps/api/src/finance apps/api/src/finance-service.integration.test.ts apps/mcp/src/tools/finances apps/mcp/src/server.test.ts packages/api-client/src/client.test.ts
pnpm verify
~~~

Expected: all focused suites pass; pnpm verify completes lint, type checking, coverage thresholds, builds, and desktop/mobile acceptance tests successfully.

- [ ] **Step 5: Review the final diff and commit verification/docs**

Run:

~~~bash
git diff --check
git status --short
git diff --stat HEAD~14..HEAD
~~~

Confirm no unrelated dirty-worktree files are staged, no Finance route retains requireHuman, no MCP response contains an ilo web-app handoff, and no automation code was added.

Commit:

~~~bash
git add apps/mcp/src/tools/finances/conversation-acceptance.test.ts apps/api/src/finance-migration-preservation.integration.test.ts apps/api/src/finance-service.integration.test.ts apps/mcp/src/server.test.ts docs/mcp.md
git commit -m "test(finance): verify autonomous agent workflows"
~~~
