# Finance Inbox Zero Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the current thread, honoring Cooper's explicit no-delegation instruction for production Finance operations. Cooper approved this detailed plan on November 12, 2026.

**Goal:** Make November 2026 budget-ready and reach zero active human Finance decisions, then maintain that state through Finance Chat and the existing routine.

**Architecture:** Extend the existing Finance domain services and durable review/maintenance lifecycle. Share one attention and budget-readiness projection across API, typed client, MCP, web and mobile; MCP never implements financial rules or calls providers directly.

**Tech Stack:** TypeScript, Zod, PostgreSQL/Drizzle, Hono, typed API client, MCP, React, Expo; existing provider sync and notification infrastructure.

**Spec:** `docs/superpowers/specs/2026-11-12-finance-inbox-zero-design.md`

## Global constraints

- First budget month: `2026-11`; use the user's default timezone. Do not add per-record timezone inputs.
- Preserve all history. Scope disposition does not resolve a review or prove historical completeness.
- No browser production operations, human-composer handoffs, direct database cleanup, QA financial mutations or new Codex schedule.
- Existing max-100 preview, max-25 qualification and max-10 execute limits remain unless independently justified.
- No agent self-approval or self-granted scopes. Source freshness, consent, actor ownership and revisions are commit-time checks.
- Keep approved plans, proposals, balances, income, spending and savings distinct; unknown is never zero.
- Work tracked under COO-153 — Reconcile Finance review backlog and recover budget approvals, in unique live Nohmi project.
- Current worktree predates shipped Finance Chat. Inspect current main and adopt existing delivered implementations before editing; do not overwrite newer services from this checkout.
- Detailed design/plan review approved November 12, 2026. Existing inline implementation choice is preserved; no repeated method question.

## Review focus

1. Cross-month transfer pairs and late postings: history placement must not conceal a current-period dependency (Tasks 1–3, 7).
2. Source access revoked after preview or grants changed after approval: no execution under stale authority (Tasks 2–4).
3. Duplicate, reordered or lost chat/execute responses: one answer and one financial effect, recoverable without repeated human questions (Tasks 3–5).
4. Ambiguous same-amount matches, fees, refunds and pending replacements: no false transfer or double-counted expense (Tasks 2–3).
5. A zero question count while evidence/notification work is blocked: never claim budget-ready or phone delivery (Tasks 1, 5–8).

## Shared proposed interfaces

Define Zod schemas and derived types in `packages/domain/src/finance/attention.ts` (new), exported through the existing domain entrypoint. Dates are owner-local period dates; IDs and revisions reuse current common schemas.

- `FinanceBudgetStartPolicy`: `{ firstMonth, timezone, revision, approvedAt, approvalSource }`. Approval source is server-derived, never caller-asserted.
- `FinanceAttentionSnapshot`: `{ snapshot, asOf, complete, period, activeDecisionCount, activeTransactionCount, historicalRecordCount, processingCount, technicalBlockerCount, budgetReady, dependencyRefs, rawCounts }`. `rawCounts` retains flags, cases, approvals and questions separately. Counts derive from persisted canonical relations, not sums of overlapping rows.
- `FinanceBudgetStartPreview`: `{ id, fingerprint, expectedPolicyRevision, proposedMonth, scopeCounts, openingPositionQualification, unresolvedDependencies }`.
- `FinanceEvidenceRefresh`: `{ id, status, sourceRefs, coverage, freshness, failures, retryAfter, receipt }`; status is `accepted | running | completed | blocked | failed`. Returned receipt records what was actually admitted, not just provider response success.
- Transfer decision adds `kind: transfer_pair`, both transaction IDs and expected revisions/timestamps, related case IDs/revisions when present, canonical evidence references and rationale. `evidence` free text is explanatory only.
- Extend existing batch outcomes with effect receipts and a correction link, preserving existing readers and outcome meanings. No second execution engine.

Names are proposed additions. Resolve conflicts against current main once before coding, and update this plan if an equivalent interface already exists.

### Task 1: Activation policy and canonical attention projection

**Files:** Create `packages/domain/src/finance/attention.ts` and `.test.ts`; create `apps/api/src/finance/attention-service.ts` and `.integration.test.ts`; extend `packages/domain/src/finance/review-backlog.ts`, `apps/api/src/finance/maintenance-work-selection.ts`, `docs/product/finance-review-backlog.md`. Add the next available database migration and its schema registration using the repository's migration convention, never a guessed occupied sequence.

**Interfaces:** Produce `getAttentionSnapshot(actor, period): Promise<FinanceAttentionSnapshot>`, `previewBudgetStart(actor, { firstMonth, expectedPolicyRevision, idempotencyKey }): Promise<FinanceBudgetStartPreview>`, and `applyBudgetStart(actor, { previewId, fingerprint }): Promise<FinanceBudgetStartPolicy>`. Actor and transaction context use existing service types.

- [ ] On current main inspect the existing backlog/status implementation and migration index; bind exact owning files and current schema names before the first edit.
- [ ] Write failing tests for November 1 local boundary, late October posting relevant to November, unknown dates, overlapping flags/cases, reversibility, isolation and mismatched review records. Assert history remains unresolved and totals remain all-outstanding when requested.
- [ ] Run `pnpm exec vitest run packages/domain/src/finance/attention.test.ts apps/api/src/finance/attention-service.integration.test.ts`; confirm assertions fail for missing behavior.
- [ ] Implement versioned owner policy and dependency-aware attention projection. Deduplicate one decision only with an explicit shared action key; otherwise preserve distinct reasons. Persist and audit scope changes separately from financial resolutions.
- [ ] Run the same tests plus existing review-backlog and maintenance-work-selection tests; require pass. Commit this independently reviewable slice.

### Task 2: Trustworthy opening position and durable evidence recovery

**Files:** Extend `apps/api/src/finance/baseline-qualification-service.ts`, `baseline-qualification-evidence.ts`, their tests, and `packages/domain/src/finance/baseline-qualification.ts`; create `apps/api/src/finance/evidence-refresh-service.ts` and `.integration.test.ts`, `packages/domain/src/finance/evidence-refresh.ts`. Reuse current provider Item sync/admission owner; locate it on current main before adding a scheduler or table.

**Interfaces:** Consume Task 1 policy and dependencies. Produce `prepareEvidenceRefresh(actor, { sourceRefs, period, idempotencyKey }): Promise<FinanceEvidenceRefresh>` and `getEvidenceRefresh(actor, id): Promise<FinanceEvidenceRefresh>`. Extend the existing baseline result with opening anchors, coverage and exact unresolved dependencies.

- [ ] Write failing integration tests for incomplete balance-to-start reconstruction, duplicate account identity, revoked connection, provider timeout, pending transactions, missing facts, durable process restart and duplicate refresh requests.
- [ ] Run the new integration test and existing baseline qualification tests; confirm missing behavior fails.
- [ ] Persist a handle before provider work; use existing sync leases/transport/timeouts and bounded recovery. Keep source observation, raw-fact admission and financial qualification distinct. No direct MCP provider calls or freshness timestamp patching.
- [ ] Qualify the opening balance only with a valid anchor and complete intervening movements. Promote exact historical dependencies; keep independent November work eligible. Include income, obligations and set-asides without treating transfers as resources twice.
- [ ] Run focused source/baseline integration tests and types; require pass. Document transport/authority/recovery evidence and commit.

### Task 3: Unified evidence-backed batches and safe correction

**Files:** Extend `packages/domain/src/finance/review-batch.ts`, `apps/api/src/finance/review-batch-service.ts`, `review-batch-service.integration.test.ts`, and `maintenance-work-selection.ts`; create focused pair qualification/correction modules alongside them if necessary rather than expanding an oversized service.

**Interfaces:** Consume Task 2 qualified canonical evidence. Extend existing preview/qualification/execute with `transfer_pair`; produce `previewBatchUndo(actor, { batchId, outcomeIndexes, idempotencyKey })` returning an immutable fingerprinted correction preview, and `executeBatchUndo(actor, { previewId, fingerprint, limit })` returning the existing bounded run/outcome shape.

- [ ] Write failing tests for flag-only pairs, one-sided cases, two-sided cases, unrelated remaining reasons, unique versus ambiguous counterpart, roundups with unverified destination, card payment fees, split amounts, currency mismatch and pending-to-posted replacement.
- [ ] Write failure tests for stale revision, approval mismatch, authorization revocation, partial chunk failure, simultaneous resume, lost success response and undo after later user edits. Assert completed effects never replay and audit records remain.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/review-batch-service.integration.test.ts packages/domain/src/finance/review-backlog.test.ts`; establish red tests.
- [ ] Implement pair/categorization evidence adapters through existing domain writers; close only proven reasons atomically with receipts. Never use linking alone as evidence that all review flags are resolved. Enforce immutable manifests and current authorization on each bounded execution.
- [ ] Implement revision-safe compensating corrections, refusing conflicts with a new-preview recovery link. Run focused tests and commit.

### Task 4: MCP/API capabilities and approval continuity

**Files:** Extend `apps/api/src/routes/finance-review-backlog.ts`, `packages/api-client/src/features/finance-review-backlog.ts`, `apps/mcp/src/tools/finance-review-backlog.ts`, their tests, and `apps/mcp/src/tool-catalog.ts`; add focused attention/evidence-refresh route/client/tool modules using the same structure. Update `docs/mcp.md`.

**Interfaces:** Expose Task 1–3 contracts via authenticated API and typed client. Add proposed budget-start preview/apply, evidence refresh prepare/get, undo preview/execute tools. Retain existing `execute_finance_review_batch` rather than duplicating it.

- [ ] Write failing catalog/read-only/least-scope tests for every new tool. Assert this connection without execute cannot discover or invoke execution; write does not imply approval. Test cross-owner and cross-authorization preview access denial.
- [ ] Add supported owner approval-view retrieval for a batch created by an agent, using the existing action-review identity path. Keep original actor-bound execution intact; human review must not require exposing every other agent's private previews.
- [ ] Implement scoped adapters with no domain logic. Return precise recoveries for unavailable capability, missing authority, stale evidence and awaiting approval; do not reduce these to one generic blocked state.
- [ ] Run `pnpm exec vitest run apps/mcp/src/tools/finance-review-backlog.test.ts packages/api-client/src/features/finance-review-backlog.test.ts apps/api/src/routes/finance-review-backlog.test.ts` plus new module tests and catalog suite; require pass. Commit.

### Task 5: Chat decisions, continuation, rules and notifications

**Files:** Extend `apps/api/src/finance/conversation-review-mirror.ts`, `conversation-question-mirror.ts`, `conversation-causality.ts`, `conversation-service.ts`, corresponding tests, `apps/api/src/finance-notification-runtime.ts`, `apps/mcp/src/tools/finance-conversation.ts` if present on current main; use existing conversation tool module ownership if registration is elsewhere. Extend the current instruction source rather than writing a new host-specific prompt.

**Interfaces:** Consume immutable batch and activation previews. Reuse native message references/action reviews and current causal reply contracts. Answer acceptance persists once and returns durable continuation identity, never fabricated financial success.

- [ ] Write failing tests: existing blocked historical run plus new human message, duplicate answer delivery, stale approval card, actor impersonation attempt, repeated already-answered question, rule revocation and process loss after answer commit.
- [ ] Persist linked agent-authored cards through existing conversation service; add a narrowly scoped MCP publish adapter only if absent. One decision question links its entire manifest; do not post as a human or use arbitrary narrative as approval.
- [ ] On valid answer, enqueue/reuse durable continuation; execute only under policy, then reread and reply with actual result. Rule creation remains an explicit separately approved proposal.
- [ ] Test one push intent per causal reply/material decision, deduplicated repeated blockers, quiet hours/disabled notifications, denied token, provider timeout and revoked device. Record accepted versus displayed distinctly.
- [ ] Run conversation causality, review mirror and notification integration tests; require pass. Commit and update current-instruction adoption expectations without changing routine identity/cadence/grants.

### Task 6: Clear active inbox and budget UX across surfaces

**Files:** Extend `apps/mobile/src/features/finances/conversation.tsx`, `conversation-composer.tsx`, existing Finance overview/planning screens discovered on current main; extend `apps/web/src/features/finances/review-backlog.tsx`, `conversation-page.tsx`, `plan-page.tsx`; add tests beside each owning module. Update `docs/design/pages/finances.md`.

**Interfaces:** Consume Task 1 snapshot and Task 5 linked decision cards; frontend does not derive its own readiness or add overlapping counts.

- [ ] Add failing UI tests for zero questions with blocked evidence, historical-only work, mixed partial batch results, current month change, stale cards and correction conflicts. Assert $ amounts, navigable references, keyboard/accessibility labels and Sonner feedback without inline action-result copy.
- [ ] Implement short active attention summary and separate historical cleanup entry. Display budget qualification and approval independently. Keep technical recovery out of the human financial-question list while visibly explaining budget impact.
- [ ] Implement batch inspect/approve/change/correction controls with compact native-standard forms/icons and appropriate touch targets. Use short chat copy, expandable details, correct disabled/loading states and one toast close control.
- [ ] Run focused UI tests. Verify synthetic fixtures in simulator and desktop at light/dark/enlarged text, including keyboard, deep links, interrupted requests and safe retry. No production-account mutations for QA. Save screenshots and interaction evidence; commit.

### Task 7: Monthly continuity and regression closure

**Files:** Extend `apps/api/src/finance/maintenance-service.ts`, `maintenance-work-selection.ts`, budget proposal/baseline owners from Tasks 1–2, and their tests; update `docs/product/finance-review-backlog.md` and current Finance maintenance guidance.

**Interfaces:** Existing `maintain_finances` uses activation policy and current owner-local month, not hardcoded November. Existing budget versioning creates a proposal; approval remains separate.

- [ ] Write failing November-to-December, year-rollover, DST, late-posting, refund, recurring-bill change, changed-income, no-current-source and approved-rule revocation tests. Assert old unanswered unrelated history does not starve current work.
- [ ] Implement prospective month selection, explicit carryover policy and dependency promotion. Show a new plan proposal when needed, never silently approve it or treat unreceived income as cash.
- [ ] Run focused maintenance/budget tests and a synthetic end-to-end loop: receipt → qualification → question → answer → effect → reread → notification → next month. Require evidence for every spec requirement; commit.

### Task 8: Release and real November inbox-zero acceptance

**Files:** Private `.context/finance-inbox-zero/acceptance.md` with redacted receipts; repository product/implementation docs only for verified shipped outcomes. No account-level details committed to Git.

- [ ] Review full change against spec R1–R11 and acceptance A1–A8, including independent review required by repository delivery policy. Honor the user's no-delegation constraint for production operations; any required engineering-only independent review must not become a finance execution handoff.
- [ ] Freeze reviewed candidate; run complete `pnpm verify` or the documented equivalent hosted verification with unchanged floors, required review threads and protections. No merge with unresolved failures or tracking gaps.
- [ ] Normal protected merge, exact-main verification and production-controller deployment; verify health, source provenance and migrations. Do not recreate canceled scheduled automation.
- [ ] Reconcile existing native builds/uploads, build only changed native inputs, upload once, verify actual Internal Preview Testing and report exact installable version/build. Preserve older artifacts.
- [ ] Through MCP, refresh the complete baseline inventory and current chat context. Preview/apply the approved November-start policy via supported authorization; retain receipt and historical disposition counts. If the caller lacks required authority, use the legitimate human Chat approval path, not direct writes or browser fallback.
- [ ] Qualify opening position and refresh exact missing evidence. Reconcile duplicate accounts via preview/approved supported domain actions only when actually needed. Ask Cooper only for missing facts or unavoidable reauthentication.
- [ ] Review the current November set; stage independently evidenced purchases, pairs, card payments and roundups. Present concise linked Finance Chat batches, obtain required approvals, execute bounded chunks and reconcile receipts before retries. Leave ambiguous items as precise questions. Follow approved rule policy only.
- [ ] Finalize exact November budget proposal and obtain its approval in Finance Chat. Verify current-period spending excludes proven internal movement and balances/allocations agree with qualified evidence.
- [ ] Read canonical active snapshot after every completed batch. Maintain before/after unique decision, transaction flag, case, historical and technical dependency counts. Stop claiming progress if counts do not reconcile; investigate causes instead of clearing flags.
- [ ] Observe actual original-host adoption and unattended continuation on its existing schedule, plus real reply delivery. Ask Cooper for physical phone display/tap confirmation only when provider submission is evidenced.
- [ ] Accept only when active human decisions are zero, material November budget blockers are zero, the plan is approved and routine/chat/notification acceptance is evidenced. Record historical unresolved count separately. If a genuine user decision remains, ask that specific question; do not declare completion or manufacture answers.

## Spec coverage and self-review

| Requirement | Owning tasks | Acceptance |
| --- | --- | --- |
| R1–R3 activation, history, honest counts | 1, 4, 6 | A1, A2, A5 |
| R4 opening position and budget | 2, 7, 8 | A3, A7 |
| R5–R7 evidence, batches, undo | 2–4 | A2, A4, A5 |
| R8 Chat decisions and rules | 4–6 | A3–A6 |
| R9 routine and push | 5, 8 | A6 |
| R10 future months | 7 | A7 |
| R11 mobile/web standards | 6 | A1, A8 |
| Shipping and actual account outcome | 8 | A5, A6, A8 |

Self-review: proposed interfaces have a single domain owner; subsequent tasks consume them; all five review-focus conditions have explicit tests. Source reconciliation is required because the planning checkout is older than the deployed candidate. This plan does not claim implementation, deployment, financial resolution, grant availability or device delivery.
