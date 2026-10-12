# Finance Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete trustworthy personal planning, bounded budget automation and the remaining Finance workspace surfaces.

**Architecture:** Retain the native ledger, qualified position and policy management. Extend their evidence/transaction seams for first planning, goal reservations, carryover and execution; every app/tool view uses that same truth.

**Tech Stack:** Existing TypeScript, Zod, Hono, PostgreSQL/Drizzle, React, MCP, Vitest and Playwright.

**Spec:** [Completion design](../specs/2026-10-12-finance-texting-completion-design.md), together with the September companion design named in the execution map.

## Global Constraints

- nohmi supplies storage, knowledge, deterministic workflows and tools; it never contains a built-in agent.
- One person's USD finances and calendar months; no shared household plans or money movement.
- No required host, vendor, cloud runtime, wakeup, schedule or external response-time guarantee.
- Owner and actor come from authentication; knowledge and claims never grant domain execution authority.
- Existing execute grants/bypass and original host fences stay intact; new scopes are opt-in.
- Published migrations are immutable; allocate the next migration ID on current main at execution.
- Source implementation, local test evidence and production activation are separate claims.
- New engineering limits and exact request fields are defined in the linked completion spec; no sample policy is activated.
- Use domain-owned modules and existing frameworks. API owns semantics; client/MCP stay thin. No model/vector dependency.
- Coordinate edits to schema/journal, API app, MCP server, client composition and global navigation with Integration.
- Each task includes its contract, persistence, API/client/MCP availability and appropriate app affordance; don't advertise incomplete effects.
- The plan is not executed by writing it. Checkboxes remain open until fresh implementation evidence exists.

## Review Focus

- Pending transaction becomes posted during preview/commit: count once and reject stale evidence (F2/F7).
- Many small adjustments or reverse transfers evade a cap: usage remains cumulative across policy versions (F6/F7).
- Two goals reserve the same money concurrently: only available cash is funded once (F3).
- Late correction or timezone edit affects a closed month: append adjustment, preserve original baseline and usage (F5/F6).
- Import file is malformed or repeated: no external entity fetch, partial duplicate or overwritten manual correction (F9).

## File and execution conventions

Paths below are repository-relative. `Create` means proposed new module; `Modify` means an existing
owner or composition seam. Each task names its primary files and tests. New modules also require
exports in `packages/domain/src/index.ts`, API wiring in `apps/api/src/app.ts`, client wiring in
`packages/api-client/src/client.ts`, and MCP registration/discovery in `apps/mcp/src/server.ts` and
`apps/mcp/src/tool-catalog.ts` when applicable; these are Integration-owned edits within that task.
New persistence uses `packages/database/src/schema.ts` and a newly allocated migration plus its journal
entry. Do not preassign migration numbers in parallel branches or edit published validators.

Each named input/output type is a strict domain schema with an inferred export; fields specified here
and in the spec are contract requirements, not unvalidated TypeScript-only shapes. `Principal` and
`FinanceMutationContext` are existing server-derived types; neither is accepted in public request bodies.
Every new mutation includes the spec's mutation key and expected revision unless it creates a new record.
Tests below show the decisive assertion; arrange the scenario through existing database/test fixtures.
Failures must demonstrate missing behavior, not an unrelated dependency/configuration failure.

For each integration suite use real PostgreSQL through the repository's existing Vitest fixtures.
Run focused tests first; run `pnpm verify` once the reviewable slice is complete. A busy shared verifier
slot is a blocked verification attempt, not permission to bypass checks. Update nearest canonical docs
and availability records with the slice; don't mark a future checklist complete from historical evidence.

### F1: Connect qualified position to first-plan setup

**Dependencies:** None; shared knowledge can be added through S3 later.

**Files:** Modify `apps/api/src/finance/setup-service.ts`, `apps/api/src/finance/position-service.ts`, `packages/domain/src/finance/setup-planning.ts`, `apps/api/src/finance/setup-service.integration.test.ts`, `apps/web/src/features/finances/setup-page.tsx` and its test; preserve existing Finance routes/client/tools.

**Interfaces:** Inject the existing position service into `createSetupService`; make `setupResult` consume `FinancePositionEvidence` instead of an unconditional unavailable stub. Export `FinancePlanningEvidence` containing period, position revision, profile revision, resource classification and missing inputs. First-plan preview returns this evidence with the existing proposal.

- [ ] Write `qualified_position_produces_a_funded_plan_but_unknown_is_not_zero` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(qualifiedPlan.position.state).toBe('available');
expect(unknownOwnershipPlan.canActivate).toBe(false);
expect(unknownOwnershipPlan.missingInputs).toContain('account_ownership');
expect(qualifiedPlan.allocatedCents).toBe(qualifiedPlan.declaredResourceCents);
```

- [ ] Run `pnpm exec vitest run apps/api/src/finance/setup-service.integration.test.ts apps/web/src/features/finances/setup-page.test.tsx`; confirm the new assertion fails for the intended missing behavior.
- [ ] Compose setup/position reads in one consistent snapshot and retain provenance/freshness reasons. Test missing balances, unsupported currency, stale evidence, explicit zero/none/skipped, uncertain future income, ownership gaps, and agent activation under existing execute/bypass policy. Render deficits and incomplete funding honestly instead of requiring every setup field for unrelated bookkeeping.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/setup-service.integration.test.ts apps/web/src/features/finances/setup-page.test.tsx` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: qualify first-plan Finance setup with current position`.

### F2: Converge position consumers and preserve ledger corrections

**Dependencies:** F1 establishes the planning evidence contract; no shared toolkit dependency.

**Files:** Modify `apps/api/src/finance/position.ts`, `apps/api/src/finance/position-service.ts`, `apps/api/src/finance/recognition.ts`, `apps/api/src/finance/ledger-service.ts`, `apps/api/src/finance/presentation-service.ts`, `apps/api/src/finance-maintenance-service.ts`; extend `apps/api/src/finance/position-service.integration.test.ts`, `apps/api/src/finance/account-ledger-service.integration.test.ts` and `apps/api/src/finance/recognition.test.ts`.

**Interfaces:** Reuse `FinancePositionEvidence` and `buildFinancePosition(input: PositionInput)`; add only typed missing fact/quality fields needed by consumers. Preserve native correction revision and source precedence through existing ledger writers. Presentation/read APIs return position revision so equal scopes/cutoffs can be compared.

- [ ] Write `provider_replay_preserves_manual_split_and_counts_economic_event_once` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(afterSync.categoryId).toBe(manualCategoryId);
expect(splitParts.reduce((n, x) => n + x.amountCents, 0)).toBe(parent.amountCents);
expect(position.recognizedEventCount).toBe(1);
expect(partialReimbursement.expectedRemainingCents).toBe(3000);
```

- [ ] Run `pnpm exec vitest run apps/api/src/finance/position-service.integration.test.ts apps/api/src/finance/account-ledger-service.integration.test.ts apps/api/src/finance/recognition.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Trace actual position/overview/wealth/maintenance readers and eliminate competing calculations only at their owning seams. Add fixtures for pending→posted replacement, import/provider duplicates, both transfer sides, refunds, 5,000-cent reimbursement with 2,000 received, debt principal/interest and valuation. Complete only behavior proven missing by these tests; do not replace delivered ledger/source machinery. Manual changes remain stronger than new suggestions.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/position-service.integration.test.ts apps/api/src/finance/account-ledger-service.integration.test.ts apps/api/src/finance/recognition.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `fix: converge Finance evidence and preserve ledger corrections`.

### F3: Funded goals and exclusive cash reservations

**Dependencies:** F2; canonical goal hierarchy from S6 can land independently.

**Files:** Create `packages/domain/src/finance/goal-funding.ts`, `apps/api/src/finance/goal-funding-service.ts`, `apps/api/src/finance/goal-funding-service.integration.test.ts`; modify database schema/new migration, Finance position/routes/client/tools and goals projection.

**Interfaces:** `previewGoalFunding(context: FinanceMutationContext, input: GoalFundingInput): Promise<GoalFundingPreview>`; `commitGoalFunding(context, {previewId,expectedRevision,mutationKey}): Promise<GoalFundingReceipt>`. Input discriminates reserve/release/reassign with goalId/sourceAccountId/amountCents/fundingEvidenceRef/targetGoalId as applicable. Output separates plannedCents, reservedCents, transferFundedCents, fundedCents and qualification.

- [ ] Write `competing_goals_cannot_reserve_the_same_cash` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(successfulReservations.reduce((n, x) => n + x.amountCents, 0)).toBeLessThanOrEqual(10000);
expect(plannedOnly.fundedCents).toBe(0);
expect(reservationAndSameTransfer.fundedCents).toBe(5000);
expect(afterRelease.unassignedCashCents).toBe(10000);
```

- [ ] Run `pnpm exec vitest run apps/api/src/finance/goal-funding-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Persist unique funding evidence and atomically reserve/release/reassign verified existing cash under Finance admission locks. Integrate reservations into position and exact review approvals; agent mutations use current domain execution gates. Test revocation, stale source, deleted account, same transfer+reservation, unsupported source currency, and shortfall qualification after balance falls. No bank transfer is initiated.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/goal-funding-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: track evidenced goal funding and cash reservations`.

### F4: One allocation ledger with budget views

**Dependencies:** F1–F3.

**Files:** Modify `packages/domain/src/finance/budget.ts`, `apps/api/src/finance/profile-budget-service.ts`, `apps/api/src/finance/budget-bucket-service.ts`, `apps/web/src/features/finances/plan-page.tsx`, `plan-editor.tsx`, `bucket-manager.tsx`; create `apps/api/src/finance/plan-views.ts`, `apps/api/src/finance/plan-views.test.ts` and extend `apps/web/src/features/finances/plan-editor.test.tsx`.

**Interfaces:** `projectFinancePlan(input: FinancePlanViewInput): FinancePlanView` consumes existing plan version, position revision, grouped allocations and view=`category|envelope|zero_based`. Produces one total, resource/assignment difference and group partitions; no separate balances per view. Save through existing revisioned budget operation.

- [ ] Write `budget_views_share_one_allocation_and_reject_double_assignment` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(categoryView.allocatedCents).toBe(envelopeView.allocatedCents);
expect(groupView.childrenTotalCents).toBe(groupView.allocationCents);
expect(zeroBasedWithUnassigned.canActivate).toBe(false);
expect(unknownIncomeAsResource.canActivate).toBe(false);
```

- [ ] Run `pnpm exec vitest run apps/api/src/finance/plan-views.test.ts apps/web/src/features/finances/plan-editor.test.tsx`; confirm the new assertion fails for the intended missing behavior.
- [ ] Complete group partition validation and views; preserve original baseline and existing agent approval source. UI displays planned versus funded values and exact deficits. Test one-cent rounding, overlapping children, negative/unassigned resources, stale plan edit, zero-resource valid plan and immutable period baseline. Keep mode selection a presentation preference unless allocation actually changes.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/plan-views.test.ts apps/web/src/features/finances/plan-editor.test.tsx` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: complete shared-ledger budget planning views`.

### F5: Carryover and traceable period corrections

**Dependencies:** F2/F4.

**Files:** Create `packages/domain/src/finance/carryover.ts`, `apps/api/src/finance/carryover-service.ts`, `apps/api/src/finance/carryover-service.integration.test.ts`; modify `packages/domain/src/finance/budget-policy.ts`, `apps/api/src/finance-period-review-service.ts`, database schema/new migration, Finance routes/client/policy tools.

**Interfaces:** `calculateCarryover({openingCents,allocationCents,settledSpendingCents,mode}): number`; `closeFinancePeriod(context,{period,sourceRevision,mutationKey}): Promise<FinancePeriodClosure>`; `repairFinancePeriod(context,{closureId,expectedRevision,newSourceRevision,mutationKey}): Promise<FinanceCarryoverAdjustment>`. Persist provisional/finalized state and append-only closure/adjustment evidence.

- [ ] Write `carryover_modes_and_late_correction_do_not_rewrite_baseline` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(calculateCarryover({openingCents:0,allocationCents:40000,settledSpendingCents:35000,mode:'surplus_only'})).toBe(5000);
expect(calculateCarryover({openingCents:0,allocationCents:40000,settledSpendingCents:45000,mode:'surplus_and_deficit'})).toBe(-5000);
expect(replayedClosure.id).toBe(firstClosure.id);
expect(afterCorrection.baselineRevision).toBe(originalBaselineRevision);
```

- [ ] Run `pnpm exec vitest run apps/api/src/finance/carryover-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Add none/surplus_only/surplus_and_deficit through a new versioned schema and additive validator migration. Persist frozen period timezone and future policy effective month; pending data makes closure provisional. Test none→0, negative surplus_only→0, late refund, replay, consecutive repairs, timezone change, deleted category and dependency stale flags. Do not interpret carryover as income/cash.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/carryover-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: add category carryover with auditable period repair`.

### F6: Executable policy terms and append-only usage

**Dependencies:** F4/F5; S4 required only when invoked through a work claim.

**Files:** Modify `packages/domain/src/finance/budget-policy.ts`, `budget-policy-management.ts`, `apps/api/src/finance/budget-policy-evaluator.ts`, `budget-policy-service.ts`; create `apps/api/src/finance/budget-usage-service.ts`, `apps/api/src/finance/budget-usage-service.integration.test.ts`; extend evaluator tests and database schema/new migration.

**Interfaces:** Extend policy terms with percentageLimitBps and executable version/owner activation evidence. `readBudgetUsage(tx, {ownerId,period,baselineId}): Promise<FinanceBudgetUsage>` returns monthly positiveDeltaCents plus per-category increase/decrease cents across all policy versions. `evaluateFinanceBudgetPolicy` consumes current position, baseline, usage and proposed exact deltas; no execution yet.

- [ ] Write `cumulative_percentage_and_monthly_usage_survive_reversals_and_policy_edits` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(first6000From40000.allowed).toBe(true);
expect(next5000From40000.allowed).toBe(false);
expect(afterReverse.monthlyUsedCents).toBe(12000);
expect(afterPolicyEdit.monthlyUsedCents).toBe(12000);
expect(zeroBaseline.allowed).toBe(false);
```

- [ ] Run `pnpm exec vitest run apps/api/src/finance/budget-policy-evaluator.test.ts apps/api/src/finance/budget-usage-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Implement §7 integer math and unique receipt usage ledger. Enforce both dollar and percentage bounds, eligible categories/directions, protected allocation plus consumed/committed floor, frozen period identity and no reset on manual exception. Keep execution unavailable. Test integer overflow, basis-point boundary, multi-leg sum of positive deltas, unknown usage≠0, reopened-period denial, lower cap than used and floor/spending interaction.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/budget-policy-evaluator.test.ts apps/api/src/finance/budget-usage-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: enforce budget percentage limits and durable usage`.

### F7: Atomic policy-controlled budget execution

**Dependencies:** F2/F6; consume S4 fence if execution is linked to work.

**Files:** Create `apps/api/src/finance/budget-execution-service.ts`, `apps/api/src/finance/budget-execution-service.integration.test.ts`; modify existing budget management routes/client/MCP, `apps/api/src/finance/position-service.ts` transaction-aware reader, policy capability projection, database schema/new migration and relevant Finance writers for shared revision locks.

**Interfaces:** `activateBudgetAutomation(context,{policyId,expectedRevision,previewDigest,mutationKey}): Promise<FinanceBudgetPolicyRecord>` requires exact owner approval. `executeBudgetAdjustment(context,{proposalId,previewId,expectedRevisions,authority,claim?,mutationKey}): Promise<FinanceBudgetAdjustmentReceipt>` returns original/new plan versions, deltas, usage and evidence references. `authority` is a tagged policy-version reference or exact owner-approval receipt; the latter permits only its exact reversible proposal and never activates policy or resets automatic usage. `disableBudgetAutomation` needs current owner/allowed revoke authority but no fresh position.

- [ ] Write `cap_race_commits_at_most_one_adjustment_and_replay_has_one_receipt` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(racingReceipts.filter(x => x.applied).length).toBe(1);
expect(totalAutomaticUsageCents).toBeLessThanOrEqual(15000);
expect(replay.receiptId).toBe(first.receiptId);
expect(afterRollback.newPlanVersions).toBe(0);
expect(afterDisable.applied).toBe(false);
```

- [ ] Run `pnpm exec vitest run apps/api/src/finance/budget-execution-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Inventory every writer of consumed position evidence and integrate the §7 owner evidence-epoch row under the existing Finance owner/profile lock. Each input mutation increments it in its own transaction; preview records it and execution locks/compares it before reading position. Keep availability false until writer coverage passes. Recompute under the transaction, validate exact owner policy authority, then atomically write plan/usage/audit/receipt. Test simultaneous source sync, manual allocation, grant revoke, policy disable, claim expiry, account deletion, month rollover, stale preview and crash before/after commit. Preserve current management permissions without letting them activate/widen new automatic authority.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/budget-execution-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: commit bounded budget adjustments atomically`.

### F8: Prospective context, reusable knowledge and explicit future rules

**Dependencies:** S3/S5 plus F2.

**Files:** Modify `apps/api/src/finance/context-service.ts`, `contextual-question-service.ts`, `merchant-service.ts`, `maintenance-service.ts`; create `apps/api/src/finance/context-matching-service.ts`, `apps/api/src/finance/context-matching-service.integration.test.ts`; extend domain context schemas, existing Finance routes/client/MCP.

**Interfaces:** `findFinanceContextCandidates(context,{contextId,window,limit}): Promise<FinanceContextCandidatePage>` returns deterministic owned evidence matches, never implied acceptance. `linkFinanceContext(context,{contextId,transactionId,expectedRevisions,mutationKey}): Promise<FinanceContextLinkReceipt>`; revise/cancel/dispute/expire maintain native history. Reusable knowledge invokes S3 with exact context source, not copied authority.

- [ ] Write `prospective_note_matches_only_after_explicit_link_and_correction_stays_local` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(ambiguousCandidates.items).toHaveLength(2);
expect(ambiguousCandidates.applied).toBe(false);
expect(afterLocalCorrection.futureRuleCount).toBe(0);
expect(agentBContext.sourceIds).toContain(originalMessageId);
```

- [ ] Run `pnpm exec vitest run apps/api/src/finance/context-matching-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Expose native prospective note lifecycle and deterministic matching candidates for external judgment. Deduplicate questions by unresolved evidence/revision, reuse accepted answers and S3 context, and preserve original message source. Add explicit future merchant-rule proposal/approval path if current registered rules lack it. Test repeated maintenance, changed/expired context, contradicted user fact, wrong owner and stale transaction correction.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/context-matching-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: connect Finance context to knowledge and explicit matching`.

### F9: Source lifecycle and import completeness

**Dependencies:** F2; existing hosted-bank handoff remains unchanged unless a focused regression proves a defect.

**Files:** Create `apps/api/src/finance/ofx-import.ts`, `apps/api/src/finance/import-service.integration.test.ts`; modify `apps/api/src/finance-csv.ts`, `finance-provider-item-service.ts`, `finance-provider-item-sync-service.ts`, `finance/account-service.ts`, existing Finance client/tools and accounts UI only for missing lifecycle operations.

**Interfaces:** `previewFinanceImport(context,{accountId,format: "csv"|"ofx",content,mutationKey}): Promise<FinanceImportPreview>`; `commitFinanceImport(context,{previewId,expectedRevision,mutationKey}): Promise<FinanceImportReceipt>`. Limit UTF-8 input to 5 MiB/10,000 rows, persist bounded import work and process chunks of 100 rows with checkpoint; provider IDs or canonical source fingerprint identify duplicates.

- [ ] Write `import_retry_and_disconnect_do_not_duplicate_or_erase_user_corrections` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(replayedImport.createdTransactionIds).toEqual(firstImport.createdTransactionIds);
expect(pendingReplacement.economicEvents).toHaveLength(1);
expect(afterDisconnect.manualCorrection).toEqual(beforeDisconnect.manualCorrection);
expect(malformedOfx.externalEntityRequests).toBe(0);
```

- [ ] Run `pnpm exec vitest run apps/api/src/finance/import-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Complete preview→commit→status import, explicit sync/reconnect/exclude/disconnect/remove/export, extending existing lifecycle states. Parse OFX without external entities/network fetching; exact cents/currency/date errors are row-specific. Test partial-batch restart, duplicate rows/files, ambiguous ownership, unsupported currency, malformed/oversized payload and provider removal. Preserve provider handoff uncertainty and consent; optional Venmo remains feasibility-gated outside required completion.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/import-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: complete Finance import and source lifecycle gaps`.

### F10: Qualified forecasts, recurring items, reports and watchlists

**Dependencies:** F2/F3/F5; reuse existing cashflow, scenarios, anomaly and period-review services.

**Files:** Modify `apps/api/src/finance-cashflow.ts`, `finance-scenario-service.ts`, `finance-anomaly-service.ts`, `finance-period-review-service.ts`, `packages/domain/src/finance/reporting.ts`; create `apps/api/src/finance/reporting-completion.test.ts`; extend existing Finance routes/client/tools.

**Interfaces:** `buildFinanceForecast(input: FinanceForecastInput): FinanceForecast` consumes one qualified position plus dated income/obligations, horizon 7–365 default90. Extend `FinanceSnapshot` with supporting revisions and qualification for cashflow/debt/goals/wealth. Watchlist input has explicit metric/comparator/threshold, never agent-authored executable logic. Recurrence proposals have evidence, amount range/date and confirmation status.

- [ ] Write `forecast_distinguishes_future_income_reservations_and_unknown_valuation` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(forecast.currentCashCents).toBe(position.currentCashCents);
expect(forecast.futureIncomeCents).toBe(100000);
expect(unknownValuation.wealthChange).toBeNull();
expect(readOnlyScenario.persistedPlanVersions).toBe(0);
expect(unchangedWatchlist.secondIntentCount).toBe(0);
```

- [ ] Run `pnpm exec vitest run apps/api/src/finance/reporting-completion.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Converge existing forecasts/scenarios on qualified evidence; expose low-balance dates, assumption/horizon and separate contributions/valuation. Complete recurrence confirmation/retirement, subscription observation, export and evidence-backed external advice attachment; no automatic cancellation or advice generation. Test late refunds after period close, stale sources, double-counted reserve, horizon boundaries, missed recurrence, advice becoming stale and thresholds crossed repeatedly without duplicate notifications.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/reporting-completion.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: complete qualified Finance forecasts and reporting`.

### F11: Finance app and agent acceptance

**Dependencies:** F1–F10; S3/S5 for shared context/resumption; T5 for shared review links.

**Files:** Modify existing `apps/web/src/features/finances/plan-page.tsx`, `cashflow-page.tsx`, `wealth-page.tsx`, `accounts-page.tsx`, `period-review-page.tsx`, `settings.tsx`; create `apps/web/src/features/finances/budget-policy-editor.tsx`, `budget-policy-editor.test.tsx`, `integration/workspace-agent/finance-completion.integration.test.ts`; extend `e2e/finance-setup.spec.ts`, `e2e/finance-mvp.spec.ts`.

**Interfaces:** App and MCP consume the same policy previews/receipts, carryover, goal funding and qualified reporting contracts. Policy UI shows selected categories, cents and percentage caps, directional remaining usage and minimums; exact activation is owner-only. Expose capability as available only after the API writer and required evidence producer register.

- [ ] Write `person_can_plan_correct_approve_and_revoke_with_exact_agent_parity` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(agentPreview.deltas).toEqual(appPreview.deltas);
expect(afterRevoke.executionAvailable).toBe(false);
expect(uiGoal.fundedCents).not.toBe(uiGoal.plannedCents);
expect(review.originalBaselineId).toBe(initialBaselineId);
```

- [ ] Run `pnpm exec vitest run apps/web/src/features/finances/budget-policy-editor.test.tsx integration/workspace-agent/finance-completion.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Build missing controls on existing pages, preserving scoped Reviews, keyboard access and responsive layouts. Test setup→plan→goal reservation→bounded adjustment→usage→revoke and transaction correction→resync→period review with real client/MCP/database. Run `pnpm exec playwright test e2e/finance-setup.spec.ts e2e/finance-mvp.spec.ts`; record full verification and separate authorized connector evidence. Never mark real provider delivery verified from fixtures.
- [ ] Run `pnpm exec vitest run apps/web/src/features/finances/budget-policy-editor.test.tsx integration/workspace-agent/finance-completion.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: complete Finance toolkit app and agent workflows`.

## Completion gate

- [ ] Run `git diff --check`, focused contract/integration tests and `pnpm verify`; retain actual results.
- [ ] Reconcile each task with its linked spec requirement, record external evidence gaps and preserve all failed/pending states.
- [ ] Verify upgrade, deletion, revocation and rollback readability before marking the subsystem complete.
