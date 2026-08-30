# Finance Account Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct provider account classification, preserve user-owned planning semantics, and expose trustworthy, searchable account and wealth context through the API and MCP.

**Architecture:** Extend the Finance domain contracts first, then project Plaid type evidence through the connector and existing provider-item synchronization boundary. Persist user-owned ownership/inclusion independently from provider evidence, calculate summaries in the API, and keep the typed client and MCP as thin consumers of the public route.

**Tech Stack:** TypeScript, Zod, PostgreSQL 17, Drizzle ORM, Hono, MCP TypeScript SDK, Vitest, Testcontainers, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-27-finance-account-semantics-design.md`

## Global Constraints

- Preserve the API as the product boundary; MCP must not contain Finance business rules.
- Provider synchronization may not overwrite a user-owned kind, ownership, or inclusion decision.
- Existing provider account rows are corrected during bounded normal synchronization, not by an unbounded deploy-time backfill.
- Existing migrations remain immutable; schema, migration `0072`, and journal entry ship together.
- Every account mutation remains idempotent, ownership-scoped, and append-only audited.
- Run focused tests while iterating and `pnpm verify` before handoff.

---

### Task 1: Canonical account semantics contracts

**Files:**
- Modify: `packages/domain/src/finance.ts`
- Modify: `packages/domain/src/finance/ledger.ts`
- Modify: `packages/domain/src/finance/reporting.ts`
- Test: `packages/domain/src/finance.test.ts`

**Interfaces:**
- Produces `financeProviderAccountTypeSchema`, `financeAccountKindSourceSchema`, `financeAccountOwnershipTypeSchema`, `financeAccountQuerySchema`, and `financeAccountListSchema`.
- Extends `FinanceAccount` with `providerType`, `providerSubtype`, `kindSource`, `includeInPlanning`, `ownershipType`, and `ownershipShare`.
- Extends `FinanceWealthSummary` with `accountSemantics`.

- [ ] **Step 1: Write failing domain tests**

Add literal schema fixtures proving that a provider investment account parses, an unsupported
provider type fails, filters normalize correctly, and invalid ownership shares fail.

- [ ] **Step 2: Run the domain test and verify RED**

Run: `pnpm vitest run packages/domain/src/finance.test.ts`

Expected: FAIL because the account-semantics exports and required fields do not exist.

- [ ] **Step 3: Implement the minimal domain schemas**

Add the bounded enums, account fields, query/list result, ownership validation, and wealth
semantics disclosure. Re-export focused contracts through the Finance barrel.

- [ ] **Step 4: Run domain tests and type checking**

Run: `pnpm vitest run packages/domain/src/finance.test.ts && pnpm --filter @personal-os/domain typecheck`

Expected: PASS.

### Task 2: Plaid account type projection

**Files:**
- Modify: `packages/connectors/src/plaid.ts`
- Test: `packages/connectors/src/plaid.test.ts`
- Modify: `apps/api/src/finance-provider-item-service.ts`
- Modify: `apps/api/src/finance-provider-item-sync-service.ts`
- Test: `apps/api/src/finance-provider-item-service.integration.test.ts`
- Test: `apps/api/src/finance-provider-item-sync-service.integration.test.ts`

**Interfaces:**
- Consumes `PlaidAccountSnapshot.type` and `.subtype` from the connector.
- Produces `financeAccountKindFromProviderType(type)` inside the Finance API boundary.
- Provider upsert/refresh writes type/subtype and updates kind only when `kindSource !== "user"`.

- [ ] **Step 1: Write failing connector tests**

Extend the complete Plaid account fixture with `type: "investment"` and
`subtype: "simple"`; expect the returned snapshot to preserve both. Add a malformed fixture with
an unsupported type and expect a typed invalid-response failure.

- [ ] **Step 2: Run connector tests and verify RED**

Run: `pnpm vitest run packages/connectors/src/plaid.test.ts`

Expected: FAIL because type/subtype are discarded and unsupported types are not validated.

- [ ] **Step 3: Implement connector parsing**

Add Plaid's documented account-type enum to the account response schema, accept a nullable subtype,
and project both fields without provider-specific behavior outside the connector.

- [ ] **Step 4: Run connector tests and verify GREEN**

Run: `pnpm vitest run packages/connectors/src/plaid.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing provider projection tests**

Add table-driven integration cases with literal expected kinds for depository, investment,
brokerage, credit, loan, and other. Add a case where `kindSource = user` and verify synchronization
updates provider metadata and balance but retains the user kind.

- [ ] **Step 6: Run provider tests and verify RED**

Run: `pnpm vitest run apps/api/src/finance-provider-item-service.integration.test.ts apps/api/src/finance-provider-item-sync-service.integration.test.ts`

Expected: FAIL because the provider metadata and source-aware mapping are not persisted.

- [ ] **Step 7: Implement source-aware account projection**

Centralize the type-to-kind mapping in a Finance helper used by connection upsert and refresh.
Preserve user-owned kind and every planning field during provider synchronization.

- [ ] **Step 8: Run provider tests and verify GREEN**

Run the command from Step 6.

Expected: PASS.

### Task 3: Persist planning metadata safely

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/migrations/0072_finance_account_semantics.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Test: `packages/database/src/finance-schema.integration.test.ts`

**Interfaces:**
- Adds Finance account columns `provider_type`, `provider_subtype`, `kind_source`,
  `include_in_planning`, `ownership_type`, and `ownership_share_bps`.
- Stores ownership share as basis points from 0 through 10,000; public contracts use decimals from
  0 through 1.

- [ ] **Step 1: Write a failing fresh-migration preservation test**

Insert legacy-shaped Plaid and manual accounts, run through the migrated schema, and assert safe
defaults: included in planning, ownership unknown/null, and no guessed provider type. New manual
accounts receive individual/10,000 semantics through the account creation service.

- [ ] **Step 2: Run the database test and verify RED**

Run: `pnpm vitest run packages/database/src/finance-schema.integration.test.ts`

Expected: FAIL because the columns do not exist.

- [ ] **Step 3: Add the Drizzle columns and atomic migration**

Use bounded defaults and check constraints for source, ownership type, and ownership basis points.
Do not scan or classify existing account names in SQL.

- [ ] **Step 4: Run database tests and verify GREEN**

Run the command from Step 2.

Expected: PASS against a fresh migrated database.

### Task 4: Account updates, filtered discovery, and summaries

**Files:**
- Modify: `apps/api/src/finance/account-service.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Test: `apps/api/src/finance/account-ledger-service.integration.test.ts`
- Test: `apps/api/src/routes/finances.test.ts`

**Interfaces:**
- `accountService.list(userId, query): FinanceAccountList` filters and summarizes owned accounts.
- `accountService.update` accepts the new planning fields and validates the merged state.
- `GET /v1/finances/accounts` returns the typed account list.

- [ ] **Step 1: Write failing account-service integration tests**

Cover kind/status/name filters, excluded accounts, a 50% joint account, debt subtraction, unknown
ownership, normalized duplicate groups, empty results, and invalid merged ownership updates.
Assert the audit before/after snapshot changes when planning semantics change.

- [ ] **Step 2: Run service tests and verify RED**

Run: `pnpm vitest run apps/api/src/finance/account-ledger-service.integration.test.ts`

Expected: FAIL because list summaries and planning updates are absent.

- [ ] **Step 3: Implement service behavior**

Keep normalization, duplicate warnings, ownership weighting, and totals in the API service. Return
zero totals for empty results. Keep raw provider balance evidence intact.

- [ ] **Step 4: Run service tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Write and run a failing route contract test**

Exercise `GET /v1/finances/accounts?kind=investment&query=ira&includeExcluded=false` and assert the
literal structured response plus authentication boundary.

Run: `pnpm vitest run apps/api/src/routes/finances.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 6: Implement the route and verify GREEN**

Parse with `financeAccountQuerySchema`, call the injected account service, and return its result.

Run: `pnpm vitest run apps/api/src/routes/finances.test.ts`

Expected: PASS.

### Task 5: Trustworthy wealth reporting

**Files:**
- Modify: `apps/api/src/finance-service.ts`
- Test: `apps/api/src/finance-service.integration.test.ts`

**Interfaces:**
- Consumes the canonical account planning calculation from Task 4.
- Produces existing wealth totals plus `accountSemantics` disclosures.

- [ ] **Step 1: Write failing wealth integration tests**

Create literal balances for cash, investment, credit debt, 50% joint investment, excluded cash, and
unknown ownership. Assert exact totals, excluded/unresolved IDs, duplicate warnings, and
`trustworthy: false`; then resolve ownership and assert `trustworthy: true`.

- [ ] **Step 2: Run the wealth tests and verify RED**

Run: `pnpm vitest run apps/api/src/finance-service.integration.test.ts -t "wealth"`

Expected: FAIL because wealth ignores planning metadata and provides no trust disclosure.

- [ ] **Step 3: Reuse the account planning calculation in wealth reporting**

Do not duplicate sign, share, exclusion, or duplicate logic. Preserve the existing income and
legacy monthly-budget fields.

- [ ] **Step 4: Run the wealth tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

### Task 6: Typed client and MCP account discovery

**Files:**
- Modify: `packages/api-client/src/features/finances.ts`
- Test: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/finances.ts`
- Test: `apps/mcp/src/server.test.ts`
- Test: `apps/mcp/src/tools/finances.workflows.test.ts`

**Interfaces:**
- `api.listFinanceAccounts(query)` calls `GET /v1/finances/accounts`.
- MCP `list_finance_accounts` accepts `query`, `kind`, `status`, and `includeExcluded` and returns
  the API-owned summary unchanged.

- [ ] **Step 1: Write failing typed-client tests**

Call `listFinanceAccounts({ kind: "investment", query: "ira" })` and assert the exact encoded URL
and parsed account-list response.

- [ ] **Step 2: Run client tests and verify RED**

Run: `pnpm vitest run packages/api-client/src/client.test.ts`

Expected: FAIL because the client method does not exist.

- [ ] **Step 3: Implement the typed client and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 4: Write failing MCP workflow tests**

Invoke `list_finance_accounts` with investment/name filters and assert the API receives the same
query and that the returned tool result contains grouped totals and unresolved IDs. Assert the MCP
does not recalculate any total.

- [ ] **Step 5: Run MCP tests and verify RED**

Run: `pnpm vitest run apps/mcp/src/server.test.ts apps/mcp/src/tools/finances.workflows.test.ts`

Expected: FAIL because the tool accepts no filters and reads the generic overview.

- [ ] **Step 6: Implement the thin MCP adapter and verify GREEN**

Run the command from Step 5.

Expected: PASS.

### Task 7: Final verification and PR

**Files:**
- Review all modified Finance files and generated migration metadata.

**Interfaces:**
- Produces one reviewable branch and pull request with no unrelated changes.

- [ ] **Step 1: Run focused Finance verification**

Run: `pnpm vitest run packages/domain/src/finance.test.ts packages/connectors/src/plaid.test.ts packages/database/src/finance-schema.integration.test.ts apps/api/src/finance-provider-item-service.integration.test.ts apps/api/src/finance-provider-item-sync-service.integration.test.ts apps/api/src/finance/account-ledger-service.integration.test.ts apps/api/src/finance-service.integration.test.ts apps/api/src/routes/finances.test.ts packages/api-client/src/client.test.ts apps/mcp/src/server.test.ts apps/mcp/src/tools/finances.workflows.test.ts`

Expected: PASS.

- [ ] **Step 2: Run deterministic repository verification**

Run: `pnpm verify`

Expected: PASS without lowering coverage or skipping builds/E2E.

- [ ] **Step 3: Review migration and diff**

Run: `git diff --check && git status --short && git diff --stat && git diff origin/main...HEAD`

Expected: only the approved Finance vertical slice and planning documents are present.

- [ ] **Step 4: Commit, push, and open the PR**

Use a concise Finance-scoped commit message, push `cooper/finance-account-semantics`, and create a
PR summarizing the production failure reproduced, account semantics added, trust disclosures, and
verification evidence.
