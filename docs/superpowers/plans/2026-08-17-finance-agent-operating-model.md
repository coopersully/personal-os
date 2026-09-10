# Finance Agent Operating Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one status-first Finance workflow that profiles and plans with the user, maintains a trustworthy ledger, handles mixed purchases and reimbursements, challenges its proposed work, applies or queues supported changes according to the app-only review setting, and publishes a durable period review.

**Architecture:** Keep MCP stateless and put Finance expertise, action disposition, candidate-ledger preparation, challenge lifecycle, accounting semantics, and settlement in domain/API services. All semantic mutations use one API-owned apply-or-review router; `maintain_finances` prepares one durable candidate batch, pauses for a connected-agent challenge, then applies it or creates one approval before deterministic verification and period-review publication. Focused services isolate scenarios, action routing, merchant evidence, reimbursements, anomaly detection, challenges, and period reviews.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle/PostgreSQL, `@personal-os/api-client`, MCP TypeScript SDK, React, TanStack Query, shadcn UI, Vitest, Playwright.

## Global Constraints

- Preserve existing dirty-worktree changes and uncommitted `0059_finance_automation_settings.sql`; new append-only migrations start at `0060`.
- `reviewBypassEnabled` remains default-off, per-user, and mutable only by a signed-in user in Finance settings.
- Agent tokens never grant or mutate bypass. Identical agent calls return `applied`, `pending_review`, or `needs_input` according to current evidence and the app setting.
- Bypass changes approval handling, never evidence requirements. User answers are one-off unless `applyToFuture: true` is explicit.
- Provider connections, account administration, imports, and bypass remain human-only. Finance never moves money, trades, pays bills, or files taxes.
- Preserve original provider transactions, source references, revisions, classification evidence, redacted audits, durable recovery, and API-client ownership.
- One maintenance turn creates at most one routine approval. Genuine uncertainty remains separate questions.
- The connected agent performs the semantic challenge; do not add a hidden server-side model provider.
- MCP remains a thin API adapter. Keep the playbook, rubric, sequencing, candidate ledger, and completion decision in Finance domain/API code.
- Use reicon through `@/components/icons` and existing shadcn primitives.
- Follow TDD and commit only each task's focused files without disturbing unrelated user changes.

## File Responsibilities

- `packages/domain/src/finance.ts`: ledger, action, allocation, reimbursement, profile, scenario, and period-review schemas.
- `packages/domain/src/finance-maintenance.ts`: status, candidate/challenge, and maintenance-result schemas.
- `apps/api/src/finance-action-service.ts`: prepare/apply/queue/approve/dismiss semantic actions.
- `apps/api/src/finance-scenario-service.ts`: deterministic bounded scenario comparison.
- `apps/api/src/finance-merchant-evidence.ts`: merchant variability and category evidence.
- `apps/api/src/finance-reimbursement-service.ts`: reimbursement lifecycle and accounting.
- `apps/api/src/finance-anomaly-service.ts`: unusual-spend/reimbursement detection.
- `apps/api/src/finance-challenge-service.ts`: challenge packet, submission, findings, and requeue.
- `apps/api/src/finance-period-review-service.ts`: reproducible period reviews.
- `apps/api/src/finance-maintenance-service.ts`: durable orchestration only.
- `apps/api/src/finance-status-service.ts`: authoritative orientation and next operation.
- `apps/web/src/features/finances/review-queue.tsx`: combined questions/approvals.
- `apps/web/src/features/finances/transaction-breakdown-dialog.tsx`: mixed-purchase splits.
- `apps/web/src/features/finances/reimbursement-list.tsx`: reimbursement progress.

---

### Task 1: Define Action, Planning, and Review Contracts

**Files:**
- Modify: `packages/domain/src/finance.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0060_finance_agent_action_reviews.sql`
- Modify: `packages/database/migrations/meta/_journal.json`

**Interfaces:**
- Produces: `FinanceFactEvidence<T>`, `FinanceActionOutcome<T>`, `FinanceQuestion`, `FinanceActionReview`, `FinanceAgentActionPayload`, `SetFinanceBudgetPlanInput`, `FinanceScenarioInput`, and `FinanceScenarioResult`.
- Produces: `finance_agent_action_reviews` and expanded effective-dated `finance_profiles`.

- [ ] **Step 1: Write failing exclusive-outcome tests**

```ts
const schema = financeActionOutcomeSchema(financeBudgetPlanSchema);
expect(schema.parse({ status: "applied", result: budgetPlan })).toMatchObject({ status: "applied" });
expect(schema.parse({ status: "pending_review", review })).toMatchObject({ status: "pending_review" });
expect(schema.parse({ status: "needs_input", question })).toMatchObject({ status: "needs_input" });
expect(() => schema.parse({ status: "applied", result: budgetPlan, review })).toThrow();
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @personal-os/domain test -- domain.test.ts`

Expected: FAIL because the contracts do not exist.

- [ ] **Step 3: Add public schemas**

Define fact bases `user_stated|ledger_observed|calculated|estimated|missing`; action kinds for categorizations, questions, recurring/alerts/merchants, budget, transactions, income, profile, breakdowns, and reimbursements; and the three-disposition union. Reviews expose at most 100 safe display changes and never private payloads.

- [ ] **Step 4: Define budget/scenario/profile inputs**

```ts
export const setFinanceBudgetPlanInputSchema = z.object({
  allocations: z.array(z.object({ categoryId: idSchema, limit: moneySchema.positive() })).min(1).max(100),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(25).default([]),
  goalIds: z.array(idSchema).max(25).default([]),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
  rationale: z.string().trim().min(1).max(4_000),
  replace: z.boolean().default(true),
  scenarioFingerprint: z.string().max(128).nullable().default(null),
});
```

Add profile fields for household/dependents/housing, reserve target, and separate investment-risk willingness/capacity. Reject duplicate category/goal IDs and scenarios above five alternatives or 120 months.

- [ ] **Step 5: Write database tests and migration**

Assert review ownership, requesting agent, source/kind, private payload, safe changes, run reference, expected revision, fingerprint, status, partial unique pending fingerprint, and user/status index. Add profile columns and journal entry `0060`.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter @personal-os/domain test -- domain.test.ts && pnpm --filter @personal-os/database test -- schema.test.ts`

```bash
git add packages/domain/src/finance.ts packages/domain/src/domain.test.ts packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/migrations/0060_finance_agent_action_reviews.sql packages/database/migrations/meta/_journal.json
git commit -m "feat(finances): define agent action contracts"
```

---

### Task 2: Make Status and Planning Self-Contained

**Files:**
- Create: `apps/api/src/finance-scenario-service.ts`
- Create: `apps/api/src/finance-scenario-service.test.ts`
- Modify: `apps/api/src/finance-status-service.ts`
- Modify: `apps/api/src/finance-status-service.integration.test.ts`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/finance-service.integration.test.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Modify: `apps/api/src/routes/finances.test.ts`
- Modify: `packages/api-client/src/features/finances.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/finances.ts`
- Modify: `apps/mcp/src/tool-catalog.ts`
- Modify: `apps/mcp/src/server.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts and existing accounts/goals/budgets/cash flow.
- Produces: enriched `getFinanceStatus`, `compareFinanceScenarios`, atomic `setBudgetPlan`, and corresponding MCP tools.

- [ ] **Step 1: Write failing status test**

Assert review mode, evidence/close readiness, wealth, stated/observed income, cash-flow low point, prioritized goals, plan variance, missing facts, ordered interview, work counts, reimbursements placeholder, active run, latest review placeholder, and `recommendedNextOperation`.

- [ ] **Step 2: Build evidence before questions**

Classify material facts with `FinanceFactEvidence`. A first budget requires reliable monthly income, housing cost, household size, recurring obligations, and one goal priority. Return concise `prompt` and `why`; narrow conclusions when evidence is missing.

- [ ] **Step 3: Test and implement deterministic scenarios**

```ts
export function compareFinanceScenarios(input: FinanceScenarioInput): FinanceScenarioResult {
  const normalized = normalizeScenarioInput(input);
  return financeScenarioResultSchema.parse({
    asOf: normalized.asOf,
    baseline: projectScenario(normalized.baseline, normalized.horizonMonths),
    alternatives: normalized.alternatives.map((item) => projectScenario(item, normalized.horizonMonths)),
    fingerprint: scenarioFingerprint(normalized),
  });
}
```

Test cash-flow effect, lowest balance, reserve runway, debt/goal effects, assumptions, warnings, and stable fingerprint. Do not model random returns.

- [ ] **Step 4: Test and implement atomic budget plan**

Lock owned categories/goals/current budget rows; validate capacity; replace/upsert in one transaction; preserve assumptions/rationale/fingerprint; audit a redacted summary. Expose `POST /v1/finances/scenarios/compare` and `PUT /v1/finances/budget-plan`.

- [ ] **Step 5: Add typed client and MCP tools**

Register `compare_finance_scenarios` as read-only preview and `set_finance_budget_plan` as `finances:write`. Keep descriptions concise and bypass-free.

- [ ] **Step 6: Run and commit**

Run:

```bash
pnpm --filter @personal-os/api test -- finance-status-service.integration.test.ts finance-scenario-service.test.ts finance-service.integration.test.ts
pnpm --filter @personal-os/api-client test -- client.test.ts
pnpm --filter @personal-os/mcp test -- server.test.ts
```

```bash
git add apps/api/src/finance-scenario-service.ts apps/api/src/finance-scenario-service.test.ts apps/api/src/finance-status-service.ts apps/api/src/finance-status-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/finance-service.integration.test.ts apps/api/src/routes/finances.ts apps/api/src/routes/finances.test.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts apps/mcp/src/tools/finances.ts apps/mcp/src/tool-catalog.ts apps/mcp/src/server.test.ts
git commit -m "feat(finances): make status drive planning"
```

---

### Task 3: Unify Apply-or-Review Behavior

**Files:**
- Create: `apps/api/src/finance-action-service.ts`
- Create: `apps/api/src/finance-action-service.integration.test.ts`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Modify: `apps/api/src/routes/finances.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/api-client/src/features/finances.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/finances.ts`
- Modify: `apps/mcp/src/tool-catalog.ts`
- Modify: `apps/mcp/src/server.test.ts`

**Interfaces:**
- Produces: `createFinanceActionService({ db, finances, now })` with `performDirect`, `listReviews`, `approve`, and `dismiss`.

- [ ] **Step 1: Write failing router tests**

For profile, budget, categorization, merchant, recurring, alert, transaction, and income actions, assert bypass-on `applied`, bypass-off `pending_review`, and missing evidence `needs_input`. Test pending fingerprint reuse, stale supersession, atomic replay, agent approval denial, and absent bypass mutation.

- [ ] **Step 2: Implement prepare-before-disposition**

```ts
const prepared = await finances.prepareAction(action, context);
if (prepared.status === "needs_input") return prepared;
if (context.principal.actorType === "agent" && !reviewBypassEnabled) return queuePreparedAction(prepared, context);
return { status: "applied" as const, result: await applyPreparedAction(prepared.action, context) };
```

Use an exhaustive action-kind switch. Validate evidence/revisions before reading bypass.

- [ ] **Step 3: Make approval atomic**

Allow semantic writers to accept a Drizzle transaction. Lock review, revalidate, apply, audit, and mark `applied` in one transaction. Repeated approval returns the terminal result.

- [ ] **Step 4: Replace rejection middleware and add routes**

Remove bypass rejection for supported ledger work. Keep human guards on settings/providers/accounts/imports/approval. Add list/approve/dismiss action-review routes; return `202` for pending review.

Expose the conversational mutation as `answer_finance_question`; retain `resolve_finance_review` as a compatibility alias until existing clients migrate. Both names call the same action-router path and cannot mutate bypass or approve an action review.

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @personal-os/api test -- finance-action-service.integration.test.ts routes/finances.test.ts && pnpm --filter @personal-os/mcp test -- server.test.ts`

```bash
git add apps/api/src/finance-action-service.ts apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/routes/finances.ts apps/api/src/routes/finances.test.ts apps/api/src/app.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts apps/mcp/src/tools/finances.ts apps/mcp/src/tool-catalog.ts apps/mcp/src/server.test.ts
git commit -m "feat(finances): unify agent action disposition"
```

---

### Task 4: Support Mixed Merchants and Transaction Breakdowns

**Files:**
- Create: `apps/api/src/finance-merchant-evidence.ts`
- Create: `apps/api/src/finance-merchant-evidence.test.ts`
- Modify: `packages/domain/src/finance.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0061_finance_transaction_allocations.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/finance-service.integration.test.ts`
- Modify: `apps/api/src/finance-action-service.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Modify: `packages/api-client/src/features/finances.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/finances.ts`
- Modify: `apps/mcp/src/server.test.ts`

**Interfaces:**
- Produces: merchant behavior `unknown|consistent|mixed`, `FinanceTransactionAllocation`, `SetFinanceTransactionBreakdownInput`, `evaluateMerchantEvidence`, and `set_finance_transaction_breakdown`.

- [ ] **Step 1: Test merchant variability**

Assert two CVS Health confirmations cannot auto-apply a later CVS purchase when diversity/mixed prior exists; corrections lower eligibility; explicit mixed always disables merchant-only evidence; consistent uncorrected history can become eligible.

- [ ] **Step 2: Implement evidence evaluation**

Return behavior, category, confidence, `merchantOnlyEligible`, and rationale using diversity, corrections, minimum observations, explicit behavior, and bounded broad-retailer prior.

- [ ] **Step 3: Add allocation schemas and migration `0061`**

Create `finance_transaction_allocations` with transaction/category/amount/order, treatment `personal|reimbursable`, rationale, revision, ownership indexes; add merchant behavior; backfill one allocation for existing categorized posted transactions.

- [ ] **Step 4: Test breakdown accounting**

Assert exact integer-cent sum, ownership/revision checks, $62.14 CVS split across Health/Groceries/Personal Care, allocation-driven budgets/exports, one-off default, and explicit future-rule handling.

- [ ] **Step 5: Implement and expose breakdown**

Lock transaction/allocations, validate exact sum, replace atomically, update evidence, and audit safely. Add `PUT /v1/finances/transactions/:id/breakdown`, typed client, action routing, and MCP tool.

- [ ] **Step 6: Run and commit**

Run: `pnpm --filter @personal-os/api test -- finance-merchant-evidence.test.ts finance-service.integration.test.ts && pnpm --filter @personal-os/mcp test -- server.test.ts`

```bash
git add apps/api/src/finance-merchant-evidence.ts apps/api/src/finance-merchant-evidence.test.ts packages/domain/src/finance.ts packages/domain/src/domain.test.ts packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/migrations/0061_finance_transaction_allocations.sql packages/database/migrations/meta/_journal.json apps/api/src/finance-service.ts apps/api/src/finance-service.integration.test.ts apps/api/src/finance-action-service.ts apps/api/src/routes/finances.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts apps/mcp/src/tools/finances.ts apps/mcp/src/server.test.ts
git commit -m "feat(finances): support mixed merchant breakdowns"
```

---

### Task 5: Add Reimbursement Accounting and Anomaly Detection

**Files:**
- Create: `apps/api/src/finance-reimbursement-service.ts`
- Create: `apps/api/src/finance-reimbursement-service.integration.test.ts`
- Create: `apps/api/src/finance-anomaly-service.ts`
- Create: `apps/api/src/finance-anomaly-service.test.ts`
- Modify: `packages/domain/src/finance.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0062_finance_reimbursements.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/finance-status-service.ts`
- Modify: `apps/api/src/finance-action-service.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Modify: `packages/api-client/src/features/finances.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/finances.ts`
- Modify: `apps/mcp/src/server.test.ts`

**Interfaces:**
- Produces: reimbursement/match schemas, lifecycle service, anomaly detector, reimbursement status, and `reconcile_finance_reimbursement`.

- [ ] **Step 1: Define/test reimbursement lifecycle**

Statuses: `expected|partially_received|received|overdue|cancelled|needs_input`. Reject zero/negative or over-remaining matches. Test partial, multi-payer, combined credit, ambiguous credit question, overdue, and cancellation.

- [ ] **Step 2: Add migration `0062`**

Create reimbursements and many-to-many matches with ownership, expense allocation, expected/received amounts, payer/date, evidence, status, revision, and user/status/date/credit indexes.

- [ ] **Step 3: Implement accounting semantics**

For a $310 dinner with $220 expected: preserve $310 gross cash, report $90 personal Dining, $220 outstanding, exclude unreceived money from `safeToSpend`, and restore unmatched amount to personal spending on cancellation.

- [ ] **Step 4: Test/implement robust anomalies**

Use merchant history when at least five observations exist, then category history, robust median/deviation, budget materiality, and known reimbursement patterns. Flag a $310 dinner against a $45 baseline; suppress normal dinner and expected rent. Return structured source refs/rationale, not a universal threshold.

- [ ] **Step 5: Add status/routes/client/MCP**

Report outstanding/overdue/received/unmatched credits. Add list, reconcile, and cancel routes; route agent mutations through Task 3. Use one discriminated reimbursement MCP operation rather than separate cancel tool.

- [ ] **Step 6: Run and commit**

Run: `pnpm --filter @personal-os/api test -- finance-reimbursement-service.integration.test.ts finance-anomaly-service.test.ts finance-status-service.integration.test.ts && pnpm --filter @personal-os/mcp test -- server.test.ts`

```bash
git add apps/api/src/finance-reimbursement-service.ts apps/api/src/finance-reimbursement-service.integration.test.ts apps/api/src/finance-anomaly-service.ts apps/api/src/finance-anomaly-service.test.ts packages/domain/src/finance.ts packages/domain/src/domain.test.ts packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/migrations/0062_finance_reimbursements.sql packages/database/migrations/meta/_journal.json apps/api/src/finance-service.ts apps/api/src/finance-status-service.ts apps/api/src/finance-action-service.ts apps/api/src/routes/finances.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts apps/mcp/src/tools/finances.ts apps/mcp/src/server.test.ts
git commit -m "feat(finances): track reimbursements"
```

---

### Task 6: Prepare One Durable Maintenance Candidate

**Files:**
- Modify: `packages/domain/src/finance-maintenance.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0063_finance_maintenance_candidates.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `apps/api/src/finance-maintenance-service.ts`
- Modify: `apps/api/src/finance-maintenance-service.integration.test.ts`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/finance-action-service.ts`

**Interfaces:**
- Produces: `FinanceMaintenanceCandidate`, paginated candidate items, candidate-ledger revision/projection, and one commit/approval batch.

- [ ] **Step 1: Define and test candidate contracts**

Candidate states are `preparing|ready_for_challenge|challenged|awaiting_approval|committing|committed|superseded`. Items contain action kind, private prepared payload, safe changes, source refs, expected revisions, evidence/confidence, fingerprint, and `prepared|question|removed|committed` disposition.

- [ ] **Step 2: Add migration `0063`**

Create candidate and item tables with one active candidate per run, user/run ownership, item/fingerprint uniqueness, paging indexes, and run cascade.

- [ ] **Step 3: Write the 47-item failing maintenance test**

Use 41 supported categorizations plus four ambiguous merchants, one possible reimbursement, and one possible transfer. Assert 41 prepared actions and six questions, zero pre-challenge semantic mutations, and stable candidate fingerprints across retry.

- [ ] **Step 4: Refactor the step graph**

```ts
[
  "preflight", "synchronize", "reconcile", "prepare", "questions",
  "budget_and_health_projection", "challenge_prepare", "challenge_resolve",
  "commit_or_queue_review", "health_refresh", "verify", "period_review",
]
```

Only exact deterministic reconciliation commits before challenge. Categorization, breakdown, reimbursement, recurring, merchant, alert, profile, and budget decisions remain candidate items.

- [ ] **Step 5: Build candidate-ledger projections**

Overlay prepared allocations/categories/reimbursements on current rows without canonical mutations. Project gross cash, personal spending, reimbursements, budget variance, and questions.

- [ ] **Step 6: Implement batch disposition**

After challenge, bypass-on commits validated items through per-item fences; bypass-off creates one `maintenance_turn` action review with at most 100 safe rows. Approval revalidates all revisions and requeues the same run; drift supersedes/rebuilds affected items.

- [ ] **Step 7: Run and commit**

Run: `pnpm --filter @personal-os/api test -- finance-maintenance-service.integration.test.ts finance-action-service.integration.test.ts`

```bash
git add packages/domain/src/finance-maintenance.ts packages/domain/src/domain.test.ts packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/migrations/0063_finance_maintenance_candidates.sql packages/database/migrations/meta/_journal.json apps/api/src/finance-maintenance-service.ts apps/api/src/finance-maintenance-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/finance-action-service.ts
git commit -m "feat(finances): prepare maintenance candidates"
```

---

### Task 7: Add the Connected-Agent Ledger Challenge

**Files:**
- Create: `apps/api/src/finance-challenge-service.ts`
- Create: `apps/api/src/finance-challenge-service.integration.test.ts`
- Modify: `packages/domain/src/maintenance.ts`
- Modify: `packages/domain/src/finance-maintenance.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0064_finance_ledger_challenges.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `apps/api/src/workspace-maintenance-service.ts`
- Modify: `apps/api/src/workspace-maintenance-service.integration.test.ts`
- Modify: `apps/api/src/finance-maintenance-service.ts`
- Modify: `apps/api/src/finance-maintenance-service.integration.test.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Modify: `apps/api/src/routes/finances.test.ts`
- Modify: `packages/api-client/src/features/finances.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/finances.ts`
- Modify: `apps/mcp/src/tool-catalog.ts`
- Modify: `apps/mcp/src/server.test.ts`

**Interfaces:**
- Produces: run status `awaiting_agent_challenge`, challenge packet/page/submission/finding schemas, `createFinanceChallengeService`, and MCP retrieve/submit tools.

- [ ] **Step 1: Test/add shared waiting status**

Add `awaiting_agent_challenge` to domain/database open and settlement statuses. It has no lease/retry date and requeues only with exact expected status/rulebook/candidate revision.

- [ ] **Step 2: Add migration `0064`**

Update run checks. Create challenge and finding tables with unique run/candidate, rubric version, cutoff, candidate revision, coverage, submitting agent, finding kind/severity/source refs/evidence/rationale/action/resolution, and user/state indexes.

- [ ] **Step 3: Test challenge packet scope**

Weekly: changes since last review plus month-to-date context. Month window: full month plus trailing baseline. Include every automatic candidate, manual/user-confirmed comparisons, merchant/category history, rules/corrections, breakdowns/reimbursements, budgets/profile/recurring data, source refs, and versioned rubric.

- [ ] **Step 4: Implement packet and pagination**

```ts
prepare(runId, candidateId, context): Promise<FinanceLedgerChallenge>;
getPage(userId, challengeId, cursor?): Promise<FinanceLedgerChallengePage>;
submit(input, context): Promise<FinanceMaintenanceRun>;
resolve(runId, context): Promise<FinanceChallengeResolution>;
```

The rubric covers mixed merchants, conflicts, rule breadth, corrections, unusual amounts, reimbursements, refunds, transfers/debt, duplicates/reversals, allocations, vague categories, stale facts, period changes, and misleading unresolved totals.

- [ ] **Step 5: Test submission validation**

Reject stale revision, changed/out-of-scope sources, incomplete coverage, unsupported action, silent reversal of user-confirmed evidence, and changed-body replay. Accept exact replay.

- [ ] **Step 6: Resolve structured findings**

`correction` revises/removes a candidate action; `question` creates bounded input; `blocker` prevents trusted settlement; `observation` feeds the period review. Store concise evidence/rationale, never private reasoning.

- [ ] **Step 7: Pause/resume the same run and expose MCP**

`challenge_prepare` persists and settles `awaiting_agent_challenge`. Submission atomically marks submitted and requeues the same run. Add GET/POST maintenance challenge routes. Require `finances:maintain` and agent principal for submission. `maintain_finances` returns the exact link and next operation. Register exact MCP names `get_finance_ledger_challenge` and `submit_finance_ledger_challenge`.

- [ ] **Step 8: Run and commit**

Run: `pnpm --filter @personal-os/api test -- finance-challenge-service.integration.test.ts finance-maintenance-service.integration.test.ts && pnpm --filter @personal-os/mcp test -- server.test.ts`

```bash
git add apps/api/src/finance-challenge-service.ts apps/api/src/finance-challenge-service.integration.test.ts packages/domain/src/maintenance.ts packages/domain/src/finance-maintenance.ts packages/domain/src/domain.test.ts packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/migrations/0064_finance_ledger_challenges.sql packages/database/migrations/meta/_journal.json apps/api/src/workspace-maintenance-service.ts apps/api/src/workspace-maintenance-service.integration.test.ts apps/api/src/finance-maintenance-service.ts apps/api/src/finance-maintenance-service.integration.test.ts apps/api/src/routes/finances.ts apps/api/src/routes/finances.test.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts apps/mcp/src/tools/finances.ts apps/mcp/src/tool-catalog.ts apps/mcp/src/server.test.ts
git commit -m "feat(finances): challenge maintenance candidates"
```

---

### Task 8: Verify and Publish Period Reviews

**Files:**
- Create: `apps/api/src/finance-period-review-service.ts`
- Create: `apps/api/src/finance-period-review-service.integration.test.ts`
- Modify: `packages/domain/src/finance.ts`
- Modify: `packages/domain/src/finance-maintenance.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0065_finance_period_reviews.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `apps/api/src/finance-maintenance-service.ts`
- Modify: `apps/api/src/finance-maintenance-service.integration.test.ts`
- Modify: `apps/api/src/finance-status-service.ts`
- Modify: `apps/api/src/finance-status-service.integration.test.ts`
- Modify: `apps/api/src/routes/finances.ts`
- Modify: `apps/api/src/routes/finances.test.ts`
- Modify: `packages/api-client/src/features/finances.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/finances.ts`
- Modify: `apps/mcp/src/server.test.ts`

**Interfaces:**
- Produces: immutable `FinancePeriodReview`, exact getter, final settlement, latest-review status summary, and `get_finance_period_review`.

- [ ] **Step 1: Define/test the review contract**

Require period/cutoff/freshness/close readiness; opening/closing position; income; gross/personal spending; savings/cash low point; reimbursements; budget variance; goals/debt; work/rules; challenge coverage/findings/cleared checks; approvals/questions/exceptions; recommendations with evidence/assumptions/tradeoffs/disposition; monitoring responsibility.

- [ ] **Step 2: Add migration `0065`**

Create one immutable review per run with user/run uniqueness, period, cutoff, bounded structured sections, source IDs, and created timestamp.

- [ ] **Step 3: Strengthen deterministic verify**

Test and enforce freshness, rulebook/candidate revision, allocation sums, reimbursement limits, action fingerprints, completed challenge, and status/count consistency. Semantic judgment stays in challenge.

- [ ] **Step 4: Implement period-review service**

```ts
createForRun(runId, context): Promise<FinancePeriodReview>;
getOwned(userId, reviewId): Promise<FinancePeriodReview>;
getLatest(userId): Promise<FinancePeriodReview | null>;
```

Test the mixed CVS and reimbursed-dinner fixture and reproducibility from unchanged inputs.

- [ ] **Step 5: Settle honestly and expose status/API/MCP**

Precedence: blocked, awaiting approval, completed with questions, completed. Add `GET /v1/finances/period-reviews/:id`, typed client, exact `get_finance_period_review` tool, and status headline/material changes/monitoring link.

- [ ] **Step 6: Run and commit**

Run: `pnpm --filter @personal-os/api test -- finance-period-review-service.integration.test.ts finance-maintenance-service.integration.test.ts finance-status-service.integration.test.ts && pnpm --filter @personal-os/mcp test -- server.test.ts`

```bash
git add apps/api/src/finance-period-review-service.ts apps/api/src/finance-period-review-service.integration.test.ts packages/domain/src/finance.ts packages/domain/src/finance-maintenance.ts packages/domain/src/domain.test.ts packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/migrations/0065_finance_period_reviews.sql packages/database/migrations/meta/_journal.json apps/api/src/finance-maintenance-service.ts apps/api/src/finance-maintenance-service.integration.test.ts apps/api/src/finance-status-service.ts apps/api/src/finance-status-service.integration.test.ts apps/api/src/routes/finances.ts apps/api/src/routes/finances.test.ts packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts apps/mcp/src/tools/finances.ts apps/mcp/src/server.test.ts
git commit -m "feat(finances): publish challenged period reviews"
```

---

### Task 9: Build the Finance Work Surface

**Files:**
- Create: `apps/web/src/features/finances/review-queue.tsx`
- Create: `apps/web/src/features/finances/review-queue.test.tsx`
- Create: `apps/web/src/features/finances/transaction-breakdown-dialog.tsx`
- Create: `apps/web/src/features/finances/transaction-breakdown-dialog.test.tsx`
- Create: `apps/web/src/features/finances/reimbursement-list.tsx`
- Create: `apps/web/src/features/finances/reimbursement-list.test.tsx`
- Modify: `apps/web/src/features/finances/page.tsx`
- Modify: `apps/web/src/features/finances/navigation.tsx`
- Modify: `apps/web/src/features/finances/settings.tsx`
- Modify: `apps/web/src/features/finances/settings.test.tsx`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: typed status/questions/approvals/breakdowns/reimbursements/runs/reviews/settings.
- Produces: combined Review queue, exact split editor, reimbursement list, and progressive dashboard.

- [ ] **Step 1: Test/implement combined Review**

Questions first with what/why/evidence/choices; approvals with evidence/assumptions/change/tradeoff/agent/time/links; one 41-item maintenance approval as one card; accessible loading/error/empty states. Use Card, Item, Badge, Button, AlertDialog, Collapsible, Empty, Skeleton, Alert.

- [ ] **Step 2: Test/implement breakdown dialog**

CVS three-way split, exact remaining cents, disabled invalid submit, conditional reimbursement fields, future-rule off by default, mixed warning, optimistic rollback, keyboard/focus behavior.

- [ ] **Step 3: Test/implement reimbursement list**

Outstanding/Overdue/Recently received, gross/personal amounts, payer/date, linked credits, partial progress, transaction links, non-color status cues.

- [ ] **Step 4: Refine dashboard and setting**

Show position/freshness, personal spending vs plan, materially different gross cash, low balance/reserve runway, Review counts, reimbursements, latest review, goals, next action. Setting copy:

- `Let agents apply confident Finance changes`
- Off: `Agents still do the work, but confident changes wait in Review.`
- On: `Confident changes apply immediately. Questions and ambiguous activity still come to Review.`

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @personal-os/web test && pnpm --filter @personal-os/web typecheck`

```bash
git add apps/web/src/features/finances/review-queue.tsx apps/web/src/features/finances/review-queue.test.tsx apps/web/src/features/finances/transaction-breakdown-dialog.tsx apps/web/src/features/finances/transaction-breakdown-dialog.test.tsx apps/web/src/features/finances/reimbursement-list.tsx apps/web/src/features/finances/reimbursement-list.test.tsx apps/web/src/features/finances/page.tsx apps/web/src/features/finances/navigation.tsx apps/web/src/features/finances/settings.tsx apps/web/src/features/finances/settings.test.tsx apps/web/src/app.test.tsx
git commit -m "feat(finances): present maintained ledger work"
```

---

### Task 10: Document and Prove the Complete Conversation

**Files:**
- Modify: `docs/architecture/0003-finance-intelligence.md`
- Modify: `docs/architecture/0004-workspace-ilo-stewardship.md`
- Modify: `docs/product/ilo-workspace-stewardship.md`
- Modify: `docs/mcp.md`
- Modify: `docs/design/pages/finances.md`
- Modify: `docs/product/implementation-log.md`
- Modify: `apps/api/src/qa-fixtures.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/mcp/src/server.test.ts`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: authoritative shipped docs and conversation-level acceptance.

- [ ] **Step 1: Build the polished acceptance fixture**

Include missing profile facts, budget tradeoff, mixed CVS history/split, $310 dinner/$220 reimbursement, partial/ambiguous credits, 41 supported decisions/six questions, stale recurring assumption, and refund misclassification.

- [ ] **Step 2: Test the complete conversation**

Assert status orientation; identical mutation calls in both modes; same maintenance candidate; awaiting challenge; full challenge coverage; correction/questions; same-run resume; bypass-on commit vs bypass-off one approval; one-off answers; final reconciled status/review.

- [ ] **Step 3: Update authoritative docs**

Document apply-or-review, app-only bypass, allocations/mixed merchants, reimbursements, candidate/challenge/verify/review, recovery states, MCP flow, Review UI, and human-only boundaries. Remove obsolete 403/human-only claims only when new behavior ships. Record migrations/tools/routes/evidence and remaining risks in implementation log.

- [ ] **Step 4: Run proportional verification**

```bash
pnpm --filter @personal-os/domain test
pnpm --filter @personal-os/database test
pnpm --filter @personal-os/api test
pnpm --filter @personal-os/api-client test
pnpm --filter @personal-os/mcp test
pnpm --filter @personal-os/web test
pnpm --filter @personal-os/web typecheck
pnpm lint
```

- [ ] **Step 5: Run final repository verification**

Run: `pnpm verify`

Expected: lint, typecheck, coverage, builds, and desktop/mobile E2E pass. Record production-only evidence gaps rather than promoting mocks to deployment proof.

- [ ] **Step 6: Commit docs and acceptance**

```bash
git add docs/architecture/0003-finance-intelligence.md docs/architecture/0004-workspace-ilo-stewardship.md docs/product/ilo-workspace-stewardship.md docs/mcp.md docs/design/pages/finances.md docs/product/implementation-log.md apps/api/src/qa-fixtures.ts apps/api/src/app.integration.test.ts apps/mcp/src/server.test.ts apps/web/src/app.test.tsx
git commit -m "docs(finances): document agent ledger stewardship"
```

---

## Delivery Gates

1. Tasks 1–3 establish status/planning and identical apply-or-review behavior before new ledger mutations depend on them.
2. Task 4 precedes Task 5 so reimbursements attach to exact allocations.
3. Tasks 6–8 ship together operationally; do not advertise `awaiting_agent_challenge` without retrieval/submission, commit, verify, review, and recovery.
4. Do not enable pending mutations until the Review UI can resolve them.
5. Do not advertise breakdowns until budget/overview/export/MCP totals all consume allocations.
6. Do not advertise reimbursements until gross cash, personal spending, cancellation, partial matching, overdue behavior, and reviews agree.
7. Do not claim maintenance completed without valid challenge, deterministic verify, and durable period review.
8. Any future backend model host needs a separate external-boundary design and production evidence.
