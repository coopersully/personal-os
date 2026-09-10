# Workspace Maintenance and Finance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a client-agnostic `get_finance_status` / `maintain_finances` workflow that repairs the Plaid production boundary, safely maintains the production ledger under approved rules, queues uncertainty, proposes a one-click monthly budget, and reports evidence-backed financial health.

**Architecture:** Shared maintenance contracts and durable run storage live in the domain/database layers; the API owns Finance coordination, leases, policy, approvals, audit, and recovery. MCP remains a stateless typed API adapter, while the web app presents freshness, questions, health, and human approvals. The hosted API and every local production-connected runtime coordinate through PostgreSQL claims.

**Tech Stack:** TypeScript 5.8, Zod 4, PostgreSQL, Drizzle ORM, Hono, React 19, TanStack Query, MCP TypeScript SDK, Vitest, Testing Library, Playwright, Terraform, AWS ECS/CloudWatch, Plaid HTTPS API.

## Global Constraints

- Keep MCP stateless: it may call only `@personal-os/api-client`, never PostgreSQL, Plaid, or domain business logic.
- `get_finance_status` requires `finances:read`; `maintain_finances` requires separately consented `finances:maintain` and has static policy `approved_rule`.
- `maintain_finances` cannot answer a human question, approve a budget, create an unapproved permanent rule, move money, or trade investments.
- The no-argument maintenance scope is `all_outstanding`; windowed and target scopes are optional.
- Budgets are complete proposals committed atomically through one explicit signed-in human approval.
- Missing or stale source evidence is never converted to zero spending, a healthy status, or a negative financial score.
- Production and local production-backed runtimes must use the same database claims, idempotency keys, optimistic concurrency, and audit records.
- Provider credentials, access tokens, raw Plaid payloads, and unnecessary account identifiers must not appear in logs, audit payloads, MCP output, or documentation.
- Use expand–migrate–contract. Never edit an existing migration; generate and review new migration SQL and journal entries.
- Use only reicon glyphs through `@/components/icons`; do not add direct `reicon-react` imports.
- Run `pnpm verify` before handoff and perform live production validation only after the reviewed release is deployed.

---

## File and responsibility map

### New focused files

- `packages/domain/src/maintenance.ts` — shared workspace scopes, status envelope, run states, and operation schemas.
- `packages/domain/src/finance-maintenance.ts` — Finance status, health, maintenance result, and budget-proposal schemas.
- `packages/connectors/src/plaid.ts` — Plaid HTTP transport and normalized `ConnectorError` failures.
- `packages/connectors/src/plaid.test.ts` — Plaid request, redaction, error-classification, and readiness tests.
- `apps/api/src/finance-health.ts` — pure Finance confidence/month/profile assessment.
- `apps/api/src/finance-health.test.ts` — deterministic rubric boundary tests.
- `apps/api/src/finance-status-service.ts` — authoritative Finance status aggregation at one evidence boundary.
- `apps/api/src/finance-status-service.integration.test.ts` — current, stale, partial, blocked, and scoped status tests.
- `apps/api/src/workspace-maintenance-service.ts` — generic durable run creation, claims, checkpoints, and terminal settlement.
- `apps/api/src/workspace-maintenance-service.integration.test.ts` — run idempotency, claim, expiry, and recovery tests.
- `apps/api/src/finance-maintenance-service.ts` — Finance preflight, synchronization, reconciliation, categorization, question, budget, health, and verification pipeline.
- `apps/api/src/finance-maintenance-service.integration.test.ts` — end-to-end Finance run tests.
- `apps/web/src/features/finances/status-panel.tsx` — current/partial/blocked Finance status and maintenance summary.
- `apps/web/src/features/finances/status-panel.test.tsx` — status presentation and accessibility tests.
- `apps/web/src/features/finances/budget-proposal.tsx` — one-click budget proposal review and approval.
- `apps/web/src/features/finances/budget-proposal.test.tsx` — approval, stale-conflict, and focus tests.
- `scripts/check-plaid-production-contract.mjs` — deterministic Terraform/task-definition Plaid production guard.

### Existing files modified by the vertical change

- `packages/domain/src/finance.ts`, `packages/domain/src/index.ts`, `packages/domain/src/domain.test.ts`
- `packages/database/src/schema.ts`, `packages/database/src/schema.test.ts`, new append-only migrations and journal entries
- `packages/connectors/src/index.ts`, `packages/connectors/src/failures.ts`
- `apps/api/src/finance-service.ts`, `apps/api/src/connector-sync-health.ts`, `apps/api/src/routes/finances.ts`, `apps/api/src/openapi.ts`, `apps/api/src/app.ts`, `apps/api/src/main.ts`, `apps/api/src/types.ts`
- `apps/api/src/finance-service.integration.test.ts`, `apps/api/src/routes/finances.test.ts`, `apps/api/src/app.integration.test.ts`
- `packages/api-client/src/features/finances.ts`, `packages/api-client/src/client.test.ts`
- `apps/mcp/src/tools/finances.ts`, `apps/mcp/src/tool-catalog.ts`, `apps/mcp/src/discovery.ts`, `apps/mcp/src/server.test.ts`
- `apps/web/src/features/finances/page.tsx`, `apps/web/src/features/finances/agent-access.ts`, `apps/web/src/app.test.tsx`, `apps/web/src/styles.css`
- `apps/api/src/qa-fixtures.ts`, `e2e/finances.spec.ts`
- `infra/variables.tf`, `infra/compute.tf`, `infra/terraform.tfvars.example`, `infra/operations.tf`, `infra/README.md`
- `.github/scripts/check-runtime-task-definition.mjs`, `.github/scripts/check-connector-observability.mjs`, `.github/scripts/deploy-api.sh`, `.github/workflows/production-health.yml`
- `scripts/check-deployment-drain-contract.mjs`, `scripts/check-connector-observability-contract.mjs`, `package.json`
- `docs/architecture/0003-finance-intelligence.md`, `docs/mcp.md`, `docs/design/pages/finances.md`, `docs/deployment.md`, `docs/product/implementation-log.md`

---

### Task 1: Restore and fail closed on the Plaid production environment

**Files:**
- Create: `scripts/check-plaid-production-contract.mjs`
- Modify: `infra/variables.tf`
- Modify: `infra/compute.tf`
- Modify: `infra/terraform.tfvars.example`
- Modify: `.github/scripts/check-runtime-task-definition.mjs`
- Modify: `scripts/check-deployment-drain-contract.mjs`
- Modify: `package.json`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: the existing ECS `api` container definition and SSM secret references.
- Produces: a static production invariant: when Plaid secrets are injected, `PLAID_ENV` is exactly `production`, both Plaid values are SSM references, and deployment registration fails before draining tasks if the invariant is false.

- [ ] **Step 1: Write the failing production-contract fixture check**

Create `scripts/check-plaid-production-contract.mjs` so it executes `.github/scripts/check-runtime-task-definition.mjs` with three in-memory task definitions: valid production, sandbox with production-shaped secrets, and a missing secret. Assert only the first exits zero and both failures contain the safe text `Plaid production runtime configuration is not ready`.

```js
const validPlaid = {
  containerDefinitions: [{
    name: "api",
    environment: [{ name: "PLAID_ENV", value: "production" }],
    secrets: [
      { name: "PLAID_CLIENT_ID", valueFrom: "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/PLAID_CLIENT_ID" },
      { name: "PLAID_SECRET", valueFrom: "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/PLAID_SECRET" },
    ],
  }],
};
```

- [ ] **Step 2: Run the contract check and verify it fails**

Run: `node scripts/check-plaid-production-contract.mjs`

Expected: FAIL because the runtime checker currently accepts `PLAID_ENV=sandbox` and has no paired Plaid-secret validation.

- [ ] **Step 3: Add the Terraform and task-definition guards**

Set `plaid_environment` default to `production`. Add this precondition to `aws_ecs_task_definition.api`:

```hcl
lifecycle {
  precondition {
    condition     = !var.plaid_enabled || var.plaid_environment == "production"
    error_message = "Production Plaid credentials require plaid_environment=production."
  }
}
```

Update the task-definition checker to validate exactly one `PLAID_ENV=production` entry whenever either Plaid secret is present and to require exactly one SSM reference for each secret. Preserve the existing Google checks and emit provider-specific safe errors.

- [ ] **Step 4: Put the guard in deterministic validation**

Add `node scripts/check-plaid-production-contract.mjs` to `pnpm lint`, change `infra/terraform.tfvars.example` to `plaid_environment = "production"`, and document that the production stack must not use sandbox credentials or endpoints.

- [ ] **Step 5: Run focused infrastructure validation**

Run:

```bash
node scripts/check-plaid-production-contract.mjs
node scripts/check-deployment-drain-contract.mjs
terraform fmt -check -recursive infra
terraform -chdir=infra init -backend=false -input=false
terraform -chdir=infra validate
```

Expected: every command exits zero; invalid task fixtures fail closed before any drain behavior.

- [ ] **Step 6: Commit the production guard**

```bash
git add infra .github/scripts/check-runtime-task-definition.mjs scripts/check-plaid-production-contract.mjs scripts/check-deployment-drain-contract.mjs package.json
git commit -m "fix: guard the Plaid production environment"
```

### Task 2: Move Plaid transport behind the connector boundary

**Files:**
- Create: `packages/connectors/src/plaid.ts`
- Create: `packages/connectors/src/plaid.test.ts`
- Modify: `packages/connectors/src/index.ts`
- Modify: `packages/connectors/src/failures.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/finance-service.integration.test.ts`

**Interfaces:**
- Consumes: `ConnectorError`, the configured Plaid environment/client ID/secret, injected `fetch`, and encrypted access tokens owned by Finance.
- Produces: `createPlaidConnector(options): PlaidConnector`, where the connector exposes `validateCredentials`, `createLinkToken`, `exchangePublicToken`, `getAccounts`, and `syncTransactions`; it never stores access tokens.

- [ ] **Step 1: Write failing connector tests**

Add tests for request URL selection, successful response parsing, `INVALID_API_KEYS → configuration/operator`, `ITEM_LOGIN_REQUIRED → authorization/reconnect`, `RATE_LIMIT_EXCEEDED → rate_limited/automatic`, 5xx/transport failures, `Retry-After`, and secret redaction.

```ts
it("classifies invalid Plaid credentials as operator configuration", async () => {
  const plaid = createPlaidConnector({
    clientId: "client",
    environment: "production",
    fetch: async () => Response.json({ error_code: "INVALID_API_KEYS", error_message: "bad secret" }, { status: 400 }),
    secret: "secret",
  });
  await expect(plaid.validateCredentials()).rejects.toMatchObject({
    category: "configuration",
    disposition: "operator",
  });
});
```

- [ ] **Step 2: Run the connector test and verify it fails**

Run: `pnpm vitest run packages/connectors/src/plaid.test.ts`

Expected: FAIL because `createPlaidConnector` is not exported.

- [ ] **Step 3: Implement the typed Plaid connector**

Move provider request/response types and the HTTPS request function out of `finance-service.ts`. Use this public shape:

```ts
export type PlaidConnector = {
  validateCredentials(): Promise<void>;
  createLinkToken(input: PlaidLinkTokenInput): Promise<string>;
  exchangePublicToken(publicToken: string): Promise<string>;
  getAccounts(accessToken: string): Promise<PlaidAccountSnapshot[]>;
  syncTransactions(input: { accessToken: string; cursor: string | null }): Promise<PlaidTransactionPage>;
};
```

`validateCredentials` calls `/institutions/get` with `count: 1`, `country_codes: ["US"]`, and `offset: 0`. Convert provider failures to `ConnectorError` using safe codes and messages; never include Plaid's raw message in the safe error.

- [ ] **Step 4: Inject the connector into Finance**

Add `plaid?: PlaidConnector` to `AppDependencies`, construct it in `createApp` from config only when both credentials exist, and replace `PlaidOptions` plus `plaidRequest` in `finance-service.ts` with connector calls. Preserve encrypted access-token ownership in Finance.

- [ ] **Step 5: Run focused connector and Finance tests**

Run:

```bash
pnpm vitest run packages/connectors/src/plaid.test.ts
pnpm vitest run apps/api/src/finance-service.integration.test.ts -t "Plaid"
pnpm --filter @personal-os/connectors typecheck
pnpm --filter @personal-os/api typecheck
```

Expected: all pass, and no test output contains a client ID, secret, or access token.

- [ ] **Step 6: Commit the boundary extraction**

```bash
git add packages/connectors apps/api/src/types.ts apps/api/src/app.ts apps/api/src/finance-service.ts apps/api/src/finance-service.integration.test.ts
git commit -m "refactor: isolate Plaid behind the connector boundary"
```

### Task 3: Persist honest Finance synchronization health and claims

**Files:**
- Modify: `packages/domain/src/finance.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0055_finance_sync_health.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `apps/api/src/connector-sync-health.ts`
- Modify: `apps/api/src/connector-sync-health.test.ts`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/finance-service.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/types.ts`

**Interfaces:**
- Consumes: `PlaidConnector`, the existing connected/manual account status, and PostgreSQL time.
- Produces: `FinanceAccount.synchronization`, atomic expiring sync claims, classified safe failures/backoff, and `syncDuePlaidAccounts(): Promise<{ attempted; failed; recovered; skipped; succeeded }>`.

- [ ] **Step 1: Write failing domain and migration tests**

Extend the account fixture expectation with:

```ts
synchronization: {
  failureCode: null,
  failureCount: 0,
  lastAttemptAt: null,
  lastSuccessAt: null,
  message: null,
  nextRetryAt: null,
  recovery: null,
  state: "stale",
}
```

Add integration tests proving one worker claims an account, a second worker skips it, an expired claim recovers, configuration failures become `blocked`, rate limits become `retrying`, genuine authorization failures set connection status `needs_reauth`, and a later success clears failure evidence.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm vitest run packages/domain/src/domain.test.ts -t "finance account"
pnpm vitest run apps/api/src/connector-sync-health.test.ts
pnpm vitest run apps/api/src/finance-service.integration.test.ts -t "Plaid"
```

Expected: FAIL because Finance accounts have no synchronization object or database claim fields.

- [ ] **Step 3: Expand the Finance account schema**

Add nullable/safe columns to `finance_accounts`:

```ts
syncState: text("sync_state").$type<"current" | "stale" | "retrying" | "blocked">().notNull().default("stale"),
syncClaimId: uuid("sync_claim_id"),
syncClaimExpiresAt: timestamp("sync_claim_expires_at", { withTimezone: true }),
lastSyncAttemptAt: timestamp("last_sync_attempt_at", { withTimezone: true }),
nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
syncError: text("sync_error"),
syncErrorCode: text("sync_error_code"),
syncErrorCategory: text("sync_error_category"),
syncRecovery: text("sync_recovery").$type<"automatic" | "operator" | "reconnect">(),
syncFailureCount: integer("sync_failure_count").notNull().default(0),
```

Run `pnpm --filter @personal-os/database db:generate -- --name finance_sync_health`, verify the generated tag is `0055_finance_sync_health`, and review the SQL and journal entry. Backfill manual accounts as `current`; backfill connected Plaid accounts newer than 24 hours as `current` and older accounts as `stale` with `next_sync_at=NOW()`. Add claim-pair, nonnegative-count, safe-failure tuple, and due-work indexes. Do not put a provider request or unbounded transaction backfill in the migration.

- [ ] **Step 4: Generalize safe sync failure classification for Plaid**

Extend `classifyConnectorSyncFailure` and the `RequestLog.provider` union to include `plaid`. Preserve the current retry schedule and stable jitter. Map operator configuration to one safe system message, not an account reconnect instruction.

- [ ] **Step 5: Replace age-only scheduling with database claims**

Implement a 5-minute expiring claim through one conditional statement:

```sql
UPDATE finance_accounts
SET sync_claim_id = $claim_id,
    sync_claim_expires_at = $claim_expires_at,
    last_sync_attempt_at = $attempted_at
WHERE id = $account_id
  AND (sync_claim_id IS NULL OR sync_claim_expires_at <= $attempted_at)
RETURNING id;
```

On settlement require both account ID and claim ID. On failure persist classification and `connectorRetryAt`; on success set `syncState=current`, `lastSyncedAt`, clear the failure tuple, and emit recovery only when a prior failure existed.

```ts
type FinanceSyncBatchResult = {
  attempted: number;
  failed: number;
  recovered: number;
  skipped: number;
  succeeded: number;
};
```

- [ ] **Step 6: Replace raw scheduler errors with structured events**

Return only aggregate counts from `syncDuePlaidAccounts`. Emit `connector_sync_failed`, `connector_sync_completed`, `connector_sync_recovered`, and `connector_sync_freshness_observed` through the existing JSON logger with `provider: "plaid"`; do not join raw provider messages into stderr.

- [ ] **Step 7: Run migration and sync verification**

Run:

```bash
pnpm vitest run packages/domain/src/domain.test.ts -t "finance account"
pnpm vitest run packages/database/src/schema.test.ts
pnpm vitest run apps/api/src/connector-sync-health.test.ts
pnpm vitest run apps/api/src/finance-service.integration.test.ts -t "Plaid"
pnpm --filter @personal-os/database typecheck
pnpm --filter @personal-os/api typecheck
```

Expected: all pass; concurrent sync changes one account once, and every error result is classified and redacted.

- [ ] **Step 8: Commit synchronization health**

```bash
git add packages/domain packages/database apps/api/src
git commit -m "feat: persist Finance synchronization health"
```

### Task 4: Add shared maintenance contracts and durable run storage

**Files:**
- Create: `packages/domain/src/maintenance.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0056_workspace_maintenance_runs.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Create: `apps/api/src/workspace-maintenance-service.ts`
- Create: `apps/api/src/workspace-maintenance-service.integration.test.ts`

**Interfaces:**
- Consumes: `AssistantDomain`, a user ID, clock, and PostgreSQL transaction support.
- Produces: `MaintenanceScope`, `WorkspaceStatus<T>`, `MaintenanceRun`, and `createWorkspaceMaintenanceService({ db, now })` with `createOrResume`, `claim`, `completeStep`, `failStep`, and `settle`.

- [ ] **Step 1: Write failing shared-contract tests**

Test exact defaults and invalid combinations:

```ts
expect(maintenanceRequestSchema.parse({})).toEqual({
  scope: { type: "all_outstanding" },
});
expect(() => maintenanceScopeSchema.parse({ type: "window", start: "2026-08-10", end: "2026-08-01" })).toThrow();
```

Require the run states `queued`, `running`, `completed`, `completed_with_questions`, `awaiting_approval`, `blocked`, `failed_recoverable`, and `failed_terminal`.

- [ ] **Step 2: Run the domain test and verify it fails**

Run: `pnpm vitest run packages/domain/src/domain.test.ts -t "workspace maintenance"`

Expected: FAIL because `maintenanceRequestSchema` does not exist.

- [ ] **Step 3: Implement the shared Zod contracts**

Create schemas for scope, blocker, freshness, work counts, valid next operation, run summary, step result, verification, and generic status. Export `maintenanceScopeSchema`, `maintenanceScopeQuerySchema`, `maintenanceRequestSchema`, `maintenanceSettlementStatusSchema`, `MaintenanceScope`, `MaintenanceSettlementStatus`, `MaintenanceRun`, `FinanceMaintenanceRun`, and `FinanceMaintenanceDispatchResult`. Use discriminated unions for scopes and run states. Enforce inclusive valid date windows and UUID target IDs. The query schema accepts `scope=all_outstanding`, paired `start`/`end`, or paired `entityType`/`targetId`, rejects mixed or half-specified forms, and normalizes the last form to `{ type: "target", entityType, id: targetId }`.

- [ ] **Step 4: Write failing durable-run integration tests**

Cover one active run per user/domain, compatible no-argument resume, 2-minute run leases, claim exclusion, stale-lease recovery, unique run/step idempotency keys, terminal settlement, and a rulebook-version conflict.

```ts
const first = await service.createOrResume(userId, "finances", { type: "all_outstanding" }, "rules:v1");
const second = await service.createOrResume(userId, "finances", { type: "all_outstanding" }, "rules:v1");
expect(second.id).toBe(first.id);
```

- [ ] **Step 5: Add the run and step tables**

Add `workspace_maintenance_runs` with domain, normalized scope JSON, status, rulebook version, source snapshot, checkpoint, lease pair, last safe error, settled result JSON, and timestamps. Add `workspace_maintenance_steps` with run, stable step name, status, attempt count, idempotency key, safe result JSON, safe error, and timestamps. Add unique `(run_id, step_name)` and `(run_id, idempotency_key)` constraints plus a partial unique index allowing one open run per user/domain, where open means `queued`, `running`, `awaiting_approval`, `blocked`, or `failed_recoverable`. Only `queued`, `running`, and due `failed_recoverable` runs are worker-claimable. `awaiting_approval` and `blocked` keep the compatible run stable without holding a lease; an approval or authoritative recovery transition requeues that same run. `completed`, `completed_with_questions`, and `failed_terminal` retain durable history outside the open-run slot. `createOrResume` resumes or reports a compatible open run with the same normalized scope and rulebook version; otherwise it returns a typed conflict or creates a new run when the slot is free.

Run `pnpm --filter @personal-os/database db:generate -- --name workspace_maintenance_runs`, verify the generated tag is `0056_workspace_maintenance_runs`, and review its SQL and journal entry. The migration only creates empty tables and indexes; it does not scan user data.

- [ ] **Step 6: Implement the generic run service**

Use this public interface:

```ts
type WorkspaceMaintenanceService = {
  createOrResume(userId: string, domain: AssistantDomain, scope: MaintenanceScope, rulebookVersion: string): Promise<MaintenanceRun>;
  claim(runId: string): Promise<{ claimId: string; run: MaintenanceRun } | null>;
  completeStep(input: { claimId: string; idempotencyKey: string; result: unknown; runId: string; step: string }): Promise<void>;
  failStep(input: { claimId: string; code: string; recoverable: boolean; runId: string; safeMessage: string; step: string }): Promise<void>;
  settle(input: { claimId: string; result: unknown; runId: string; status: MaintenanceSettlementStatus }): Promise<MaintenanceRun>;
};
```

Every settlement update must match the current claim ID. Never keep a database transaction open while calling a provider.

- [ ] **Step 7: Run shared storage verification**

Run:

```bash
pnpm vitest run packages/domain/src/domain.test.ts -t "workspace maintenance"
pnpm vitest run packages/database/src/schema.test.ts
pnpm vitest run apps/api/src/workspace-maintenance-service.integration.test.ts
pnpm --filter @personal-os/domain typecheck
pnpm --filter @personal-os/database typecheck
pnpm --filter @personal-os/api typecheck
```

Expected: all pass, including two service instances competing for the same run.

- [ ] **Step 8: Commit the maintenance foundation**

```bash
git add packages/domain packages/database apps/api/src/workspace-maintenance-service.ts apps/api/src/workspace-maintenance-service.integration.test.ts
git commit -m "feat: add durable workspace maintenance runs"
```

### Task 5: Build the authoritative Finance status and health assessment

**Files:**
- Create: `packages/domain/src/finance-maintenance.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/finance.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Create: `apps/api/src/finance-health.ts`
- Create: `apps/api/src/finance-health.test.ts`
- Create: `apps/api/src/finance-status-service.ts`
- Create: `apps/api/src/finance-status-service.integration.test.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Modify: `apps/api/src/routes/finances.test.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.integration.test.ts`

**Interfaces:**
- Consumes: Finance account/ledger/budget/cash-flow evidence, approved Finance domain profile, active goals and motives, and the latest maintenance run.
- Produces: `getFinanceStatus(userId, scope): Promise<FinanceStatus>` and `GET /v1/finances/status` protected by `finances:read`.

- [ ] **Step 1: Write failing rubric tests**

Add deterministic tests for insufficient, provisional, on-track, watch, and off-track states. Use explicit policy defaults rather than model judgment:

```ts
export const defaultFinanceHealthPolicy = {
  budgetOffTrackForecastRatio: 1.15,
  budgetWatchForecastRatio: 1.05,
  emergencyReserveTargetMonths: 3,
  staleAfterHours: 24,
} as const;
```

Test that no approved budget yields month rating `unknown`, all Plaid accounts blocked yields confidence `insufficient`, one stale account yields `provisional`, forecast ratio 1.04 is `on_track`, 1.10 is `watch`, and 1.16 is `off_track`. Test that unknown debt APR and unknown investment allocation remain explicit missing evidence rather than failures.

- [ ] **Step 2: Run the rubric tests and verify they fail**

Run: `pnpm vitest run apps/api/src/finance-health.test.ts`

Expected: FAIL because `assessFinanceHealth` does not exist.

- [ ] **Step 3: Add Finance status and health contracts**

Define:

```ts
type FinanceDataConfidence = "insufficient" | "provisional" | "reliable";
type FinanceMonthRating = "off_track" | "on_track" | "unknown" | "watch";
type FinanceDimensionRating = "healthy" | "needs_attention" | "unknown" | "watch";
type FinanceHealthDimensionKey = "borrow" | "goals" | "invest" | "plan" | "save" | "spend";
```

Each dimension contains `rating`, `evidence`, `missingInputs`, `trend`, and `nextAction`. `FinanceStatus` extends the shared status envelope with accounts, ledger, budget, income, cash flow, wealth, review breakdown, health, questions, proposals, rulebook version, and active goals/motives. Add guided-profile preferences for `emergencyReserveTargetMonths`, `budgetWatchForecastRatio`, and `budgetOffTrackForecastRatio` with the defaults above and validation `watch < offTrack`.

- [ ] **Step 4: Implement the pure assessment**

`assessFinanceHealth(input)` must:

1. calculate confidence before any financial rating;
2. exclude pending and transfer transactions from posted budget spending;
3. compare current and forecast spending with the approved budget only;
4. use explicit profile targets where approved and the default policy otherwise;
5. return `unknown` for evidence that ilo cannot observe; and
6. keep the optional CFPB score outside this assessment.

No pure-assessment function may read PostgreSQL or call Plaid.

- [ ] **Step 5: Write failing status-service integration tests**

Cover current, stale, partial, blocked, empty, and mixed-account states. Assert the production failure shape is internally consistent:

```ts
expect(status).toMatchObject({
  freshness: { state: "unavailable" },
  state: "blocked",
  details: {
    health: { confidence: "insufficient", month: { rating: "unknown" } },
  },
});
expect(status.details.month.spending).toBeNull();
```

Also prove a windowed request returns in-window detail plus `oldestOutstandingAt` from older backlog.

- [ ] **Step 6: Implement Finance status aggregation**

Create `createFinanceStatusService({ assistant, db, finances, goals, maintenance, now })`. Compute `rulebookVersion` as a SHA-256 digest of canonical JSON containing the approved Finance profile version, active goal/motive IDs and revisions, category-rule revisions, account-role revisions, and active-budget revisions. Read all evidence under one repeatable-read transaction or one explicit `asOf` boundary.

Use `spending: null` and `forecast: null` when source evidence is insufficient. Do not reuse the overview's numeric zero as an unavailable-state fallback.

- [ ] **Step 7: Add the read-only route**

Register `GET /v1/finances/status` with `maintenanceScopeQuerySchema`. Return `{ status }`; do not trigger a sync. Add the path and response to `apps/api/src/openapi.ts`.

- [ ] **Step 8: Run status verification**

Run:

```bash
pnpm vitest run apps/api/src/finance-health.test.ts
pnpm vitest run apps/api/src/finance-status-service.integration.test.ts
pnpm vitest run apps/api/src/routes/finances.test.ts
pnpm vitest run apps/api/src/app.integration.test.ts -t "finance status"
pnpm --filter @personal-os/api typecheck
```

Expected: all pass, and stale fixtures never assert current `$0` spending.

- [ ] **Step 9: Commit the read model and rubric**

```bash
git add packages/domain apps/api/src
git commit -m "feat: add authoritative Finance status"
```

### Task 6: Implement resumable Finance maintenance

**Files:**
- Create: `apps/api/src/finance-maintenance-service.ts`
- Create: `apps/api/src/finance-maintenance-service.integration.test.ts`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/finance-service.integration.test.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Modify: `apps/api/src/routes/finances.test.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/types.ts`

**Interfaces:**
- Consumes: `WorkspaceMaintenanceService`, `FinanceStatusService`, `FinanceService`, approved rulebook version, and agent mutation context.
- Produces: `startOrResume(userId, scope): Promise<FinanceMaintenanceRun>` and `dispatchDue(limit): Promise<FinanceMaintenanceDispatchResult>` plus `POST /v1/finances/maintenance` and `GET /v1/finances/maintenance/:id`.

- [ ] **Step 1: Write the failing no-argument integration test**

Seed stale source evidence, one exact merchant rule, one high-confidence one-off proposal, one ambiguous merchant, one pending transaction, a proven transfer pair, and a possible duplicate. Then assert:

```ts
const run = await service.startOrResume(userId, { type: "all_outstanding" });
await service.dispatchDue(1);
const settled = await service.getRun(userId, run.id);
expect(settled.status).toBe("completed_with_questions");
expect(settled.result).toMatchObject({
  applied: { categorizations: 2, transfers: 2 },
  questions: { total: 2 },
  verification: { duplicateActions: 0 },
});
```

Repeat the run and assert zero duplicate mutations, questions, and audit effects.

- [ ] **Step 2: Run the maintenance test and verify it fails**

Run: `pnpm vitest run apps/api/src/finance-maintenance-service.integration.test.ts`

Expected: FAIL because the Finance coordinator does not exist.

- [ ] **Step 3: Expose bounded internal Finance operations**

Refactor, without changing existing public behavior, focused Finance-service methods used by the coordinator:

```ts
type FinanceMaintenanceOperations = {
  syncDueAccountsForUser(userId: string): Promise<FinanceSyncBatchResult>;
  reconcileTransfersForUser(userId: string, scope: MaintenanceScope): Promise<{ paired: number; transfers: number }>;
  proposeOutstandingCategorizations(userId: string, scope: MaintenanceScope, cursor?: string): Promise<FinanceCategorizationProposalPage>;
  applyApprovedOneOffs(input: ApplyFinanceCategorizationsInput, context: MutationContext): Promise<FinanceCategorizationApplyResult[]>;
  refreshCashflowForUser(userId: string): Promise<{ refreshed: boolean }>;
};
```

Agent application keeps `learnMerchant: "never"`, requires the server proposal to still meet its threshold, rejects pending transactions and possible-transfer reviews, and uses the existing optimistic transaction revision.

- [ ] **Step 4: Implement the deterministic pipeline**

Define the ordered step names as a constant:

```ts
const financeMaintenanceSteps = [
  "preflight",
  "synchronize",
  "reconcile",
  "categorize",
  "questions",
  "budget",
  "health",
  "verify",
] as const;
```

Process at most 50 categorization proposals per claimed slice, persist the cursor in the step result, then release the run claim so another process can continue. Re-check rulebook version before every mutation-bearing step. `questions` refreshes existing review cases/attention items by stable source identity and never duplicates them.

The `synchronize` step owns both provider fetch and normalized transaction ingestion; the checkpoint advances only after ingested rows, provider cursors, sync health, and audit evidence commit together.

- [ ] **Step 5: Improve transfer and duplicate uncertainty boundaries**

Auto-match only equal-and-opposite posted transactions owned by the same user, on distinct accounts, with compatible currencies, within three calendar days, and with no competing candidate. Mark both with one transfer group in the same transaction. Every other candidate remains an open `possible_transfer` review. Possible duplicates remain questions; maintenance never deletes or hides them.

- [ ] **Step 6: Add authenticated maintenance routes**

`POST /v1/finances/maintenance` parses `maintenanceRequestSchema`, requires separately consented `finances:maintain`, creates/resumes the run, advances one bounded slice, and returns `{ run }`. It must not use `requireHuman`. `GET /v1/finances/maintenance/:id` requires `finances:read`, enforces user ownership, and returns the stable run. Add both operations, schemas, scope examples, and conflict responses to `apps/api/src/openapi.ts`.

- [ ] **Step 7: Add server-owned continuation**

Expose `dispatchDueFinanceMaintenance` on `PersonalOsApp`. Schedule it every minute and at startup through `runtimeLifecycle.startBackgroundTask`. It claims at most five due runs per pass. Shutdown stops new claims and allows owned slices to drain; expired leases recover on another runtime.

- [ ] **Step 8: Cover failure and recovery states**

Add tests for sync blocked, mid-categorization process loss, rulebook conflict, recoverable database error, terminal validation error, narrow window, surgical target, and two API instances. Require `blocked`, `failed_recoverable`, or `failed_terminal` according to the classified cause and preserve prior successful step results.

- [ ] **Step 9: Run maintenance verification**

Run:

```bash
pnpm vitest run apps/api/src/finance-maintenance-service.integration.test.ts
pnpm vitest run apps/api/src/finance-service.integration.test.ts -t "categorization|transfer|duplicate"
pnpm vitest run apps/api/src/routes/finances.test.ts
pnpm vitest run apps/api/src/runtime-lifecycle.test.ts
pnpm --filter @personal-os/api typecheck
```

Expected: all pass; the second execution changes no already-settled transaction or question.

- [ ] **Step 10: Commit the coordinator**

```bash
git add apps/api/src
git commit -m "feat: maintain Finance with durable runs"
```

### Task 7: Add complete budget proposals and one-click approval

**Files:**
- Modify: `packages/domain/src/finance-maintenance.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0059_finance_budget_proposals.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `apps/api/src/finance-maintenance-service.ts`
- Modify: `apps/api/src/finance-maintenance-service.integration.test.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Modify: `apps/api/src/routes/finances.test.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/src/app.integration.test.ts`

**Interfaces:**
- Consumes: current-month income basis, categorized spending history, recurring obligations, savings goals, active budget revisions, and a maintenance run.
- Produces: a durable `FinanceBudgetProposal`, `GET /v1/finances/budget-proposals/:id`, and human-only `POST /v1/finances/budget-proposals/:id/approve`.

- [ ] **Step 1: Write failing proposal schema and service tests**

Require a complete proposal with period, evidence hash, income basis, category items, savings/investment allocations, irregular allocations, totals, cash-flow effect, conflicts, and status. Assert an agent principal receives 403, a human approves all items in one transaction, replay is idempotent, and changed evidence returns 409 without changing the active budget.

```ts
expect(approved.budgets.map((item) => item.category)).toEqual([
  "DINING",
  "GROCERIES",
  "SAVINGS",
  "SUBSCRIPTIONS",
]);
expect(approved.proposal.status).toBe("approved");
```

- [ ] **Step 2: Run proposal tests and verify they fail**

Run: `pnpm vitest run apps/api/src/finance-maintenance-service.integration.test.ts -t "budget proposal"`

Expected: FAIL because proposals are not persisted.

- [ ] **Step 3: Add normalized proposal tables**

Add `finance_budget_proposals` with user/run/month/status/evidence hash/income basis/totals/cash-flow/conflicts/revision/approved-at timestamps and `finance_budget_proposal_items` with proposal/category/kind/limit/rationale/source evidence. Use unique `(user_id, month, status)` only for active `pending` proposals and unique `(proposal_id, category)` items. Run `pnpm --filter @personal-os/database db:generate --name finance_budget_proposals`, verify the generated tag is `0059_finance_budget_proposals`, and review its SQL and journal entry; it creates empty tables only. Migration `0058_finance_provider_items` is reserved by the approved Provider Item synchronization correction in `docs/superpowers/specs/2026-08-16-finance-provider-item-sync-design.md`.

- [ ] **Step 4: Prepare proposals from explicit evidence**

Use recent categorized posted spending, active obligations, approved goals, and stated-or-observed income. Preserve current approved limits where evidence is sparse. A category with unresolved material spending is listed in `conflicts`; do not offset an overage by silently increasing its limit. Calculate and store a canonical SHA-256 evidence hash.

- [ ] **Step 5: Implement atomic human approval**

Within one serializable transaction: lock the proposal, active month budgets, Finance profile, relevant goals, and source transactions; recompute the evidence hash; reject stale proposals; upsert every proposal item; mark prior same-month proposal pending rows superseded; mark this proposal approved; and write one proposal audit plus itemized budget audit events. Register the proposal read and approval operations in `apps/api/src/openapi.ts`, including 403 agent-principal, 404 ownership, and 409 stale-revision/evidence responses.

- [ ] **Step 6: Integrate proposal state into maintenance**

The budget step returns `awaiting_approval` only when the proposal is the sole remaining human action; it returns `completed_with_questions` when other questions also remain. A later maintenance run observes the approved budget and evaluates it without preparing an identical proposal.

- [ ] **Step 7: Run budget verification**

Run:

```bash
pnpm vitest run packages/domain/src/domain.test.ts -t "budget proposal"
pnpm vitest run packages/database/src/schema.test.ts
pnpm vitest run apps/api/src/finance-maintenance-service.integration.test.ts -t "budget proposal"
pnpm vitest run apps/api/src/routes/finances.test.ts
pnpm vitest run apps/api/src/app.integration.test.ts -t "budget proposal"
```

Expected: all pass, including stale evidence and agent-forbidden approval.

- [ ] **Step 8: Commit one-click budget approval**

```bash
git add packages/domain packages/database apps/api/src
git commit -m "feat: add approved Finance budget proposals"
```

### Task 8: Publish the typed API and two preferred MCP tools

> Delivery note (2026-08-16): the Provider Item correction delivered and verified the complete
> status/maintenance slice: `getFinanceStatus`, `maintainFinances`,
> `getFinanceMaintenanceRun`, MCP `get_finance_status`, and MCP `maintain_finances`. Maintenance
> uses the explicit `finances:maintain` consent scope so existing draft-only `finances:write`
> grants do not silently expand. Read-only transports expose status without suggesting an
> unavailable write. Do not reimplement this slice after Task 7; only the two budget-proposal
> client methods remain dependent on the proposal endpoints. The checkboxes below remain open
> until that five-method combined task is fully reconciled.

**Files:**
- Modify: `packages/api-client/src/features/finances.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/finances.ts`
- Modify: `apps/mcp/src/tool-catalog.ts`
- Modify: `apps/mcp/src/discovery.ts`
- Modify: `apps/mcp/src/server.test.ts`
- Modify: `docs/mcp.md`

**Interfaces:**
- Consumes: `GET /v1/finances/status`, `POST /v1/finances/maintenance`, `GET /v1/finances/maintenance/:id`, the budget-proposal read/approval endpoints, and domain schemas.
- Produces: `api.getFinanceStatus`, `api.maintainFinances`, `api.getFinanceMaintenanceRun`, `api.getFinanceBudgetProposal`, `api.approveFinanceBudgetProposal`, MCP `get_finance_status`, and MCP `maintain_finances`.

- [ ] **Step 1: Write failing typed-client tests**

Assert exact query encoding and the no-argument body:

```ts
await api.getFinanceStatus({ type: "window", start: "2026-08-01", end: "2026-08-15" });
await api.maintainFinances();
expect(requests.at(-1)).toMatchObject({
  body: JSON.stringify({ scope: { type: "all_outstanding" } }),
  method: "POST",
  path: "/v1/finances/maintenance",
});
```

- [ ] **Step 2: Run API-client tests and verify they fail**

Run: `pnpm vitest run packages/api-client/src/client.test.ts -t "Finance maintenance"`

Expected: FAIL because the methods do not exist.

- [ ] **Step 3: Add typed client methods**

Implement all five methods using exported domain input/output types. Use URL parameters for the status scope, JSON for maintenance, and `{ expectedRevision }` for approval. Parse no response in MCP; the API client returns typed JSON only. Keep proposal approval out of the MCP tool module.

- [ ] **Step 4: Write failing MCP discovery and invocation tests**

Require:

```ts
expect(toolCatalog.get_finance_status).toMatchObject({
  domain: "finances",
  policy: "read_only",
  readOnly: true,
  requiredScopes: ["finances:read"],
  stage: "inspect",
});
expect(toolCatalog.maintain_finances).toMatchObject({
  domain: "finances",
  policy: "approved_rule",
  readOnly: false,
  requiredScopes: ["finances:maintain"],
  stage: "commit",
});
```

Prove a read-only or write-only token sees status but not maintenance, a separately consented
`finances:maintain` token sees both, no-argument invocation sends `all_outstanding`, and results
contain `_ilo` metadata plus useful text.

- [ ] **Step 5: Register the two tools**

`get_finance_status` accepts the shared optional scope. `maintain_finances` accepts the same optional scope and nothing else. Descriptions must say these are the preferred complete-workspace tools, that no arguments means all outstanding work, and that human questions/approvals remain pending rather than guessed.

Do not add Plaid, retry, confidence, cursor, batch, or policy inputs.

- [ ] **Step 6: Reduce the prompt to client-agnostic discovery**

Change `review_finances` to direct the host to `get_finance_status` for inspection and `maintain_finances` when maintenance scope and user intent permit. Do not prescribe a client schedule or multi-tool pagination loop.

- [ ] **Step 7: Run MCP verification**

Run:

```bash
pnpm vitest run packages/api-client/src/client.test.ts -t "Finance maintenance"
pnpm vitest run apps/mcp/src/server.test.ts -t "finance status|maintain finances|read-only"
pnpm --filter @personal-os/api-client typecheck
pnpm --filter @personal-os/mcp typecheck
pnpm --filter @personal-os/mcp build
```

Expected: all pass; least-privilege discovery and annotations match the catalog.

- [ ] **Step 8: Commit the public tool contract**

```bash
git add packages/api-client apps/mcp docs/mcp.md
git commit -m "feat: publish Finance maintenance MCP tools"
```

### Task 9: Make Finance freshness, maintenance, health, and approval visible

**Files:**
- Create: `apps/web/src/features/finances/status-panel.tsx`
- Create: `apps/web/src/features/finances/status-panel.test.tsx`
- Create: `apps/web/src/features/finances/budget-proposal.tsx`
- Create: `apps/web/src/features/finances/budget-proposal.test.tsx`
- Modify: `apps/web/src/features/finances/page.tsx`
- Modify: `apps/web/src/features/finances/agent-access.ts`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `docs/design/pages/finances.md`

**Interfaces:**
- Consumes: `FinanceStatus`, `FinanceMaintenanceRun`, `FinanceBudgetProposal`, and typed client mutations.
- Produces: honest Finance overview/accounts states, an explicit Maintain action, health dimensions, durable questions, and one-click budget approval.

- [ ] **Step 1: Write failing status-panel tests**

Cover reliable/clean, stale/provisional, operator-blocked, retrying, running, completed-with-questions, and insufficient-data states. Assert the blocked state contains no `$0.00 spent` claim and names one system blocker rather than 17 reconnect actions.

```tsx
render(<FinanceStatusPanel status={blockedStatus} />);
expect(screen.getByText("Finance data is blocked")).toBeVisible();
expect(screen.queryByText("$0.00 spent this month")).not.toBeInTheDocument();
expect(screen.getByText("17 accounts have stale data")).toBeVisible();
```

- [ ] **Step 2: Run focused component tests and verify they fail**

Run: `pnpm vitest run apps/web/src/features/finances/status-panel.test.tsx`

Expected: FAIL because `FinanceStatusPanel` does not exist.

- [ ] **Step 3: Implement the status and maintenance panels**

Render one primary state summary with freshness, last successful source observation, actionable/approval/input counts, current-month rating, and a `Maintain finances` button. Disable duplicate starts while a compatible run is active and show the active run state. On completion invalidate status, overview, health, review, budgets, accounts, and Agent access work-item queries.

Use textual labels for `Reliable`, `Provisional`, `Insufficient`, `On track`, `Watch`, `Off track`, `Needs input`, and `Blocked`; color and icons remain supplemental.

- [ ] **Step 4: Replace misleading overview and account summaries**

Use `FinanceStatus` as the overview authority. Show `Accounts tracked` separately from `Accounts current`. When confidence is insufficient, render an unavailable value and explanatory copy instead of numeric spending, forecast, or budget pace. On `/finances/accounts`, show connection and synchronization independently, including last success, next retry, safe failure message, and the correct reconnect/operator action.

- [ ] **Step 5: Write failing budget-proposal tests**

Test complete proposal evidence, one approval button, keyboard focus, loading, success, stale conflict, and a forbidden agent path represented as absent UI. Assert approval sends only the proposal ID/revision, never reconstructed category values.

- [ ] **Step 6: Implement one-click proposal approval**

Render the category plan, totals, income basis, savings/investment allocations, conflicts, and cash-flow effect. `Approve budget` calls `approveFinanceBudgetProposal(id, { expectedRevision })`. On 409 keep the dialog open, announce `The financial evidence changed`, refetch the replacement, and restore focus to the proposal heading.

- [ ] **Step 7: Integrate the Agent access projection**

Update `financeAgentAccessReadiness` and Finance work-item projection so blocked synchronization, maintenance questions, and pending budget approval appear once with Finance-owned routes. Healthy diagnostics remain readiness evidence, not queue rows.

- [ ] **Step 8: Run web integration tests**

Run:

```bash
pnpm vitest run apps/web/src/features/finances/status-panel.test.tsx
pnpm vitest run apps/web/src/features/finances/budget-proposal.test.tsx
pnpm vitest run apps/web/src/app.test.tsx -t "Finances|Finance"
pnpm --filter @personal-os/web typecheck
pnpm --filter @personal-os/web build
```

Expected: all pass with no stale-zero assertion, duplicate queue row, inaccessible status, or document overflow regression.

- [ ] **Step 9: Commit the Finance work surface**

```bash
git add apps/web/src docs/design/pages/finances.md
git commit -m "feat: show Finance maintenance and health"
```

### Task 10: Add live Plaid readiness and maintenance observability

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `.github/scripts/deploy-api.sh`
- Modify: `.github/scripts/check-connector-observability.mjs`
- Modify: `.github/workflows/production-health.yml`
- Modify: `infra/operations.tf`
- Modify: `scripts/check-connector-observability-contract.mjs`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: `PlaidConnector.validateCredentials`, structured application logs, ECS deployment health, and CloudWatch.
- Produces: safe `GET /health/connectors/plaid`, deploy rollback on invalid credentials/environment, and alarms for Finance configuration failure and stuck maintenance.

- [ ] **Step 1: Write failing readiness endpoint tests**

Test disabled, healthy, invalid credentials, provider timeout, and secret-redaction states:

```ts
expect(await payload(await app.request("/health/connectors/plaid"))).toEqual({
  configured: true,
  environment: "production",
  state: "ready",
});
```

For invalid credentials expect HTTP 503 with `state: "blocked"` and a safe operator message. The response must not include a Plaid request ID, client ID, secret, or raw provider message.

- [ ] **Step 2: Run the endpoint test and verify it fails**

Run: `pnpm vitest run apps/api/src/app.integration.test.ts -t "Plaid readiness"`

Expected: FAIL because the health route does not exist.

- [ ] **Step 3: Implement cached live readiness**

Add a 5-minute in-memory readiness cache per API process. The endpoint calls `validateCredentials` only on cache miss, returns 200 for disabled/ready and 503 for configured-but-blocked, and emits a structured `connector_sync_failed` event with `provider: "plaid"`, `category: "configuration"` on invalid credentials. Do not make the general `/health/ready` fail when Plaid is unavailable.

- [ ] **Step 4: Add deployment and hourly checks**

After ECS service stability but before marking deployment successful, make `.github/scripts/deploy-api.sh` call `${API_URL}/health/connectors/plaid` and enter the existing rollback path on non-200. Add the same endpoint to `.github/workflows/production-health.yml` so later configuration drift is detected.

- [ ] **Step 5: Add maintenance observations and alarms**

Emit structured events:

```ts
type FinanceMaintenanceEvent =
  | "finance_maintenance_blocked"
  | "finance_maintenance_completed"
  | "finance_maintenance_failed"
  | "finance_maintenance_started";
```

Include only run ID, status, duration, action/question counts, safe code, and backlog age. Add CloudWatch metric filters and alarms for `FinanceMaintenanceFailureCount`, `FinanceMaintenanceBlockedCount`, and `FinanceMaintenanceBacklogAgeMs`. Configuration and blocked alarms page once per alarm window; completion does not send recovery email.

- [ ] **Step 6: Extend deterministic observability validation**

Update the local contract fixture and AWS-state checker with the exact filters, metric names, thresholds, missing-data behavior, and SNS route. Use threshold 1 per 5 minutes for configuration/blocked, 3 per 15 minutes for maintenance failures, and maximum backlog age 86,400,000 ms over 15 minutes.

- [ ] **Step 7: Run observability and deployment checks**

Run:

```bash
pnpm vitest run apps/api/src/app.integration.test.ts -t "Plaid readiness"
node scripts/check-plaid-production-contract.mjs
node scripts/check-connector-observability-contract.mjs
node scripts/check-deployment-drain-contract.mjs
terraform fmt -check -recursive infra
terraform -chdir=infra validate
```

Expected: all pass; every failure message remains safe and the deploy check runs before success publication.

- [ ] **Step 8: Commit readiness and observation**

```bash
git add apps/api/src .github infra scripts docs/deployment.md
git commit -m "feat: observe Finance production maintenance"
```

### Task 11: Prove the complete workflow and close the production gap

**Files:**
- Modify: `apps/api/src/qa-fixtures.ts`
- Create: `e2e/finances.spec.ts`
- Modify: `docs/architecture/0003-finance-intelligence.md`
- Modify: `docs/product/implementation-log.md`
- Modify: `.agents/skills/personal-os-qa/references/finances.md`

**Interfaces:**
- Consumes: the completed API/MCP/web implementation and the approved production deployment procedure.
- Produces: repeatable fixtures, end-to-end acceptance, current durable docs, a verified release, and a clean production Finance status or explicit user question queue.

- [ ] **Step 1: Expand Finance QA fixtures**

Keep `demo+full@ilo.test` values stable and add named fixture states for:

- current/clean with an approved budget;
- stale configuration blocker;
- automatic retry;
- account reauthentication;
- maintenance interrupted after categorization;
- pending budget approval;
- completed with one transaction question; and
- 1,250 mixed review cases for pagination/idempotency volume.

Fixture maintenance runs use fixed UUIDs and timestamps so tests can assert exact results.

- [ ] **Step 2: Write the failing end-to-end acceptance test**

Add a desktop and 390×844 flow that:

1. opens a blocked Finance overview and verifies no zero-spending claim;
2. switches to a recovered fixture and starts no-argument maintenance;
3. observes completion with one question;
4. answers the question through signed-in Finance review;
5. approves the complete budget once;
6. verifies on-track/provisional labels and current account timestamps; and
7. runs maintenance again and observes zero duplicate actions.

- [ ] **Step 3: Run E2E and fix only contract failures**

Run:

```bash
pnpm fixtures:load
pnpm env:status
pnpm playwright test e2e/finances.spec.ts --project=chromium
```

Expected: PASS at normal and narrow viewports with no document horizontal overflow or Plaid-script duplication warning.

- [ ] **Step 4: Update durable Finance and QA documentation**

Document the shared pair, Finance lifecycle, rulebook authority, one-click budget boundary, health rubric sources, connector states, recovery, and client-agnostic behavior. Update the QA runbook with exact clean, stale, blocked, question, proposal, replay, and production-safe checks. Record the capability as shipped in the implementation log only after tests pass.

- [ ] **Step 5: Run the deterministic repository gate**

Run: `pnpm verify`

Expected: repository environment check, lint, type checking, coverage thresholds, production builds, and desktop/mobile E2E all pass. If the known app-bar navigation test flakes, rerun that exact test once; treat a second failure as a defect and fix it before continuing.

- [ ] **Step 6: Commit acceptance and documentation**

```bash
git add apps/api/src/qa-fixtures.ts e2e/finances.spec.ts docs .agents/skills/personal-os-qa/references/finances.md
git commit -m "test: verify Finance workspace maintenance"
```

- [ ] **Step 7: Apply the reviewed production infrastructure repair**

After the implementation branch is reviewed, merged, and the database backup requirement is satisfied, inspect the Terraform plan and require it to show `PLAID_ENV` changing from `sandbox` to `production`, the expected new metric filters/alarms, and no public RDS or security-group expansion. Apply that exact plan through the established production operator workflow.

- [ ] **Step 8: Verify the hosted deployment before maintenance**

Confirm:

```text
production commit = merged release SHA
API /health/ready = 200
API /health/connectors/plaid = 200 and state ready
ECS api task PLAID_ENV = production
Plaid client ID and secret = SSM references, never plaintext environment
new successful Finance sync timestamps are advancing
connector configuration alarm = OK
```

Do not invoke maintenance while source sync remains blocked or stale.

- [ ] **Step 9: Run one production Finance maintenance pass**

Call hosted `get_finance_status`, record counts without copying transaction details into logs, then call hosted `maintain_finances()` once. Wait for the durable run to reach `completed`, `completed_with_questions`, or `awaiting_approval`. Verify the same run ID and counts through the production API audit trail and local production-backed UI.

- [ ] **Step 10: Approve the production budget and verify final truth**

Review the complete current-month proposal in the signed-in Finance UI, approve it once, and rerun `maintain_finances()` so the approved proposal is verified. Success requires:

```text
all 17 Plaid accounts current or individually classified with honest recovery
every processed transaction categorized, excluded, pending, reconciled, or represented by one question
transfers and possible duplicates excluded from silent spending
current month has one approved complete budget
month spending and forecast have a stated rating and confidence
income, cash, savings, debt, investments, goals, motives, and missing evidence are present
second maintenance execution creates zero duplicate changes, questions, proposals, or audit effects
```

- [ ] **Step 11: Record production evidence and remaining limits**

Add only non-sensitive release evidence to the implementation log: release SHA, successful health states, maintenance terminal state, aggregate counts, budget approval state, and known missing provider capabilities. Do not record balances, merchants, transaction descriptions, credentials, or private profile answers.

---

## Final implementation review checklist

- [ ] The shared status/maintenance contract is domain-owned and Finance is its only implementation in this release.
- [ ] The normal client request is one no-argument `maintain_finances` call.
- [ ] Maintenance owns continuation and recovery without relying on an external prompt, scheduler, poller, or conversation.
- [ ] Every mutation is authorized by an approved rule or a separate signed-in approval endpoint.
- [ ] Production Plaid credentials and endpoint agree, and drift fails the release check.
- [ ] Hosted and local writers cannot duplicate sync or maintenance work.
- [ ] Stale data never renders as healthy zero activity.
- [ ] Budget and health results include evidence, confidence, and explicit unknowns.
- [ ] No money movement, trading, cancellation, credit decision, tax advice, or fiduciary recommendation was introduced.
- [ ] `pnpm verify` and the live production acceptance pass are both recorded.
