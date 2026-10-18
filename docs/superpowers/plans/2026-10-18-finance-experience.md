# Finance Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method is not selected; this document does not authorize implementation or merging.

**Goal:** Deliver automated Finance setup, accurate interactive spending, asynchronous agent conversation, and traceable activity while preserving usable manual workflows.

**Architecture:** Extend existing Finance domain services and durable host/maintenance infrastructure. Domain/API owns accounting, authority, readiness, and evidence; MCP adapts those operations and the React UI consumes typed projections. Deliver dependency-ordered slices without changing Overview or introducing a second ledger or scheduler.

**Tech Stack:** TypeScript, React, TanStack Query, shadcn components, reicon registry, Hono API, Zod domain contracts, PostgreSQL/Drizzle, MCP, Vitest, Playwright, pnpm.

**Spec:** [Finance experience design](../specs/2026-10-18-finance-experience-design.md). Read it before every task; its defaults are normative for this plan.

## Global Constraints

- Spending is a new page; Overview stays unchanged.
- All activation or changes to an active budget require exact human approval.
- Unknown is not zero. Proposals, read receipts, and successful actions are distinct states.
- All settings errors and discrete action feedback use Sonner. All glyphs come from the reicon registry.
- Do not create a second ledger, notification policy, scheduler, profile, or review identity.
- Use additive migrations and owner-bound references; never edit a published migration.
- External scheduling expectations do not edit external jobs or prove execution.
- Required coverage: 95% statements/functions/lines and 94% branches.
- Follow repository create-pr workflow and live Nohmi Linear routing before publishing any PR.

## Review Focus

1. A previously allowed agent approval reaches a compatibility route: reject it without altering the budget (Task 1).
2. Pending replacement, refund, and reimbursement all affect one purchase: show one correct economic amount (Task 3).
3. A weekly schedule crosses DST or repeats a root request: do not create phantom missed slots or inferred registrations (Task 5).
4. One user answers across pages while two agents resume: preserve all messages, one effect, and accurate receipts (Task 6).
5. An existing user has stale sources and old budget approvals: preserve records and inspectability without fabricating setup or human provenance (Tasks 3, 9).

## Delivery units and dependency order

A: authority and contracts (1–2); B: spending (3–4); C: registered automation (5);
D: conversation and evidence (6–7); E: activity (8); F: setup and manual parity (9–10);
G: integrated acceptance (11). These are separate reviewable changes under one design, not parallel
edits to shared schema/routes. Task 4 depends on 3; 6 depends on 2 and 5; 7–8 depend on 6;
9 depends on 2 and 5–7; 10 uses the coverage inventory in Task 1; 11 follows all tasks.
Do not expose incomplete routes or gate existing users before Task 9 is complete.

## Repository map and proposed new files

Existing seams: `packages/domain/src/finance/`, `packages/domain/src/workspace-settings.ts`,
`packages/domain/src/automation-host-continuation.ts`, `packages/database/src/schema.ts`,
`apps/api/src/finance/`, `apps/api/src/automation-host-service.ts`,
`apps/api/src/routes/finances.ts`, `packages/api-client/src/features/finances.ts`,
`apps/mcp/src/tools/finances*.ts`, and `apps/web/src/features/finances/`.

New modules are named in each task. Export them through the package's existing public barrel;
register routes/services through the existing composition root discovered from current Finance
registration. Allocate migration numbers using repository database tooling at execution time;
never guess a number from this plan. Integration tests use the existing database fixture pattern.
Focused commands below run from repository root; use the checked-in environment lifecycle for
Docker/runtime work. Commit only the task's files after tests pass, with the suggested subject.

### Task 1: Freeze budget authority and inventory manual coverage

**Modify:** `apps/api/src/finance/profile-budget-service.ts`, `apps/api/src/finance/setup-service.ts`,
`apps/api/src/finance-action-service.ts`, `apps/api/src/finance/sms-approval-service.ts`,
`apps/mcp/src/tools/finances.ts`, `apps/mcp/src/tools/finances-stewardship.ts`.
**Tests:** `apps/api/src/finance/profile-budget-authority.test.ts`,
`apps/api/src/finance/profile-budget-service.integration.test.ts`,
`apps/mcp/src/tools/finances.workflows.test.ts`.
**Create:** `docs/engineering/finance-ui-workflow-coverage.md`.

**Interfaces:** Preserve existing approval inputs, but accept active-budget mutations only with verified
human approval bound to exact proposal/profile revisions. Agents may still prepare proposals.

- [ ] Inventory every registered tool in the four Finance tool modules and all active-budget writes.
  Record tool, domain operation, UI destination, verified test, gap, or internal-only reason in the coverage file.
- [ ] Add failing tests: agent with bypass and execute scope cannot activate; setup/legacy plan cannot
  bypass approval; human exact approval succeeds; stale proposal fails; rejection produces no active write.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/profile-budget-authority.test.ts apps/api/src/finance/profile-budget-service.integration.test.ts apps/mcp/src/tools/finances.workflows.test.ts` and confirm the new rejection tests fail for the intended reason.
- [ ] Enforce the boundary at domain mutation points, update adapters/playbook/tool guidance, and preserve
  truthful historical actor data. Inspect compatibility and SMS routes, not only the primary UI path.
- [ ] Rerun focused tests; require PASS. Commit: `fix: require human approval for Finance budgets`.

### Task 2: Shared contracts, preferences, and durable evidence storage

**Create:** `packages/domain/src/finance/spending.ts`, `onboarding.ts`, `conversation.ts`, `activity.ts`
(in the same directory), and corresponding `*.test.ts` files.
**Modify:** `packages/domain/src/workspace-settings.ts`, public exports,
`packages/database/src/schema.ts`, and additive migrations/journal.
**Create:** `apps/api/src/finance/experience-storage.integration.test.ts`.

**Interfaces:** Export `FinanceSpendingQuery`, `FinanceSpendingView`, `FinanceOnboardingState`,
`FinanceConversationPage`, `FinanceConversationEvidence`, and `FinanceActivityPage` exactly as scoped
in spec §9. Use existing principal/money/ID schemas. Preferences add auto/buckets/categories grouping,
boolean pending/uncategorized/refund/transfer options, personal/outflow basis, auto/show/hide manual
controls, and period kind. Storage adds onboarding progress, conversation/messages, receipts,
case-message/action evidence links; reuse canonical cases and audit rows rather than duplicating them.

- [ ] Add schema tests for invalid dates/timezones, empty versus omitted scope, invalid money,
  preference defaults, foreign reference combinations, and unknown-versus-zero onboarding answers.
- [ ] Run `pnpm exec vitest run packages/domain/src/finance/spending.test.ts packages/domain/src/finance/onboarding.test.ts packages/domain/src/finance/conversation.test.ts packages/domain/src/finance/activity.test.ts`; confirm new contracts initially fail.
- [ ] Implement schemas and owner-bound additive tables/indexes. Messages have immutable sequence/content,
  unique owner/idempotency keys, and versioned excerpt anchors. Receipts are monotonic per principal.
- [ ] Test migrations on populated pre-change fixtures: preserve budgets, questions, and audit rows;
  reject cross-owner case/message/action links; duplicate sends produce one message.
- [ ] Run the schema command plus `pnpm exec vitest run apps/api/src/finance/experience-storage.integration.test.ts`; require PASS. Commit: `feat: add Finance experience contracts and evidence storage`.

### Task 3: Authoritative spending and monthly comparison API

**Create:** `apps/api/src/finance/spending-service.ts`, `spending-service.test.ts`,
`spending-service.integration.test.ts`.
**Modify:** `apps/api/src/finance/recognition.ts` only where reusable projection is needed,
`apps/api/src/routes/finances.ts`, `packages/api-client/src/features/finances.ts`,
`apps/web/src/features/finances/transaction-query.ts`, and relevant transaction query schemas.

**Interfaces:** API client `getFinanceSpending(query: FinanceSpendingQuery): Promise<FinanceSpendingView>`.
Read route `/finances/spending` under the existing API prefix. Transaction query accepts the same
range/group/account/basis settings; it resolves record matches server-side, including split allocations.

- [ ] Write failing fixtures: pending replaced by posted counted once; $120 expense/$80 reimbursable
  yields $40 personal and $120 outflow before matched refunds; reimbursement receipt never subtracts
  the same $80 again; splits sum exactly; excluded/shared accounts and uncategorized disclosures agree.
- [ ] Add historical tests: proposed plan ignored, human-approved revision for selected month selected,
  later-month budget never substituted, legacy ambiguous approval withholds fill, multi-month fill absent,
  partial bucket coverage explicit, zero-limit overage finite, currencies never combined without rates.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/spending-service.test.ts apps/api/src/finance/spending-service.integration.test.ts`; confirm expected failures.
- [ ] Implement API-owned complete aggregation with source freshness and cursor-independent totals.
  Return comparison version/evidence and the same filter semantics used by transaction drill-down.
- [ ] Rerun tests plus `pnpm exec vitest run apps/web/src/features/finances/transaction-query.test.ts`;
  require PASS. Commit: `feat: add accurate Finance spending projection`.

### Task 4: Spending page and elastic bubbles

**Create under `apps/web/src/features/finances/`:** `spending-page.tsx`, `spending-controls.tsx`,
`spending-bubbles.tsx`, `spending-layout.ts`, `spending-fill.ts`, `spending-list.tsx`, and focused tests.
**Modify:** `navigation.tsx`, `workspace-page.tsx`, `settings.tsx`, preference adapters,
`apps/web/src/components/icons.ts` when additional semantic glyphs are required.

**Interfaces:** `FinanceSpendingPage` consumes Task 3 only. Pure helper
`fillHeightForAreaRatio(ratio: number): number` returns normalized height; pure layout stepping takes
nodes, viewport, anchors, and elapsed time and returns positions/velocities with a settled flag.
Route `/finances/spending`; URL period/scope overrides account preferences.

- [ ] Add tests: grouping fallback/explicit preference; 60% area fill; size ratio matches spending ratio;
  full versus overspent style; missing monthly limit; filter changes preserved in Transactions links.
- [ ] Add interaction tests: 6px drag threshold, release does not navigate, bucket drill-down/action,
  small/zero/negative values available in list, reduced motion, touch Arrange, session Reset layout.
- [ ] Run `pnpm exec vitest run apps/web/src/features/finances/spending-fill.test.ts apps/web/src/features/finances/spending-layout.test.ts apps/web/src/features/finances/spending-page.test.tsx`; confirm intended failures.
- [ ] Implement deterministic packing/center attraction, area-correct overlay, foreground contrast,
  350ms maximum settling transitions, suspend off-screen work, and semantic list/navigation equivalents.
  Use existing tokens and reicon; do not introduce an unrelated visualization runtime.
- [ ] Rerun focused tests plus `pnpm lint`; require PASS. Commit: `feat: add interactive Finance spending view`.

### Task 5: Registration, prompts, health, and external recognition

**Modify:** `packages/domain/src/automation-host-continuation.ts`,
`apps/api/src/automation-host-service.ts`, `apps/api/src/finance/host-run-authority.ts`,
`apps/mcp/src/tools/finances.ts`, `apps/mcp/src/tool-catalog.ts`, API routes/client.
**Create:** `apps/api/src/finance/automation-recognition.ts`, `automation-prompts.ts`,
`automation-recognition.test.ts`, `automation-registration.integration.test.ts`;
`apps/web/src/features/finances/automations-page.tsx` and `automations-page.test.tsx`.

**Interfaces:** Extend existing schedule CRUD/observe methods, not a second schedule service.
`detectFinanceAutomationCandidate(observations): Candidate | null` follows spec §6; candidates cannot
be active schedules. Add authenticated confirmation under the original connection; preserve existing
host-surface compatibility. Persist issued template version/text and verified message capability.

- [ ] Test copyable stable ID prompt, version history, local-only cadence edit, removal/history retention,
  connection mismatch rejection, active versus verified versus completed distinction.
- [ ] Test four-root-start inference, retry/resume exclusion, 30-minute tolerance, daily/weekly DST,
  5–60 minute grace rule, duplicate/manual-registration race, event host without countdown.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/automation-recognition.test.ts apps/api/src/finance/automation-registration.integration.test.ts`; confirm failures.
- [ ] Implement lifecycle and durable overdue observation/notification integration. Use existing host
  authority, coalescing, and background work; do not depend on a page being open for attention.
- [ ] Build list/detail/edit/remove/recopy UI with Sonner actions, sidebar attention, explicit external
  scheduler ownership, and current known/estimated health. Refactor reusable host-settings pieces.
- [ ] Run preceding tests plus `pnpm exec vitest run apps/api/src/automation-host-service.integration.test.ts apps/web/src/features/finances/automations-page.test.tsx`; require PASS. Commit: `feat: register and observe Finance automations`.

### Task 6: Durable conversation, delivery, and action provenance

**Create:** `apps/api/src/finance/conversation-service.ts`, `conversation-evidence.ts`,
`conversation-service.integration.test.ts`, `conversation-evidence.integration.test.ts`.
**Modify:** `apps/api/src/finance/maintenance-intent-service.ts`, `answer-service.ts`,
`apps/api/src/finance-action-service.ts`, relevant mutation services, API routes/client,
`apps/mcp/src/tools/finances.ts`, and tool catalog.

**Interfaces:** API client `getFinanceConversation({cursor?})`,
`sendFinanceMessage({text, recordRefs, caseId?, idempotencyKey})`, and
`markFinanceConversationRead({throughSequence})`. MCP adds scoped fetch, acknowledgment, and reply
adapters backed by the same service. Evidence envelope from Task 2 accompanies canonical mutations;
validate every cited case/message/record belongs to the actor's owner and relevant scope.

- [ ] Test one question/three transactions/two replies: all three messages retained, each change linked,
  Activity can retrieve excerpts; user-initiated case also works; foreign links fail before mutation.
- [ ] Test paginated fetch plus explicit acknowledgment, monotonic user cursor, duplicate send/reply,
  two schedules claiming one case, partial failure followed by resume, revoked connection, and
  approved-budget evidence never inferred merely from an answer's wording.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/conversation-service.integration.test.ts apps/api/src/finance/conversation-evidence.integration.test.ts`; confirm failures.
- [ ] Implement durable messages, delivery/acknowledgment, schedule binding/claims, reply persistence,
  and case-evidence linkage. Atomically persist required audit evidence with financial mutations.
  Explicitly queue chat for next run; reconcile existing immediate answer-continuation paths.
- [ ] Rerun tests and `pnpm exec vitest run apps/mcp/src/tools/finances.workflows.test.ts`; require PASS.
  Commit: `feat: persist Finance conversations and action evidence`.

### Task 7: Agent-style asynchronous Chat

**Create:** `apps/web/src/features/finances/chat-page.tsx`, `chat-composer.tsx`, `chat-message.tsx`,
`chat-case-card.tsx`, `chat-page.test.tsx`.
**Modify:** Finance navigation/workspace routing, existing notification integration.
**Vendor/adapt:** only needed shadcn message/composer primitives under `apps/web/src/components/ui/`.

**Interfaces:** `/finances/chat` consumes Task 6; Task 5 determines known/estimated/overdue timing and
capability. Existing Reviews remain the manual fallback. No additional model runtime or credential.

- [ ] Test visible locked Chat in manual/pending mode; verified unlock; unread count and attention;
  read only after visible render; multiple user replies; exact record context; reply notification
  respects existing preferences; failed send preserves draft and emits Sonner.
- [ ] Test overdue accepts queued messages with unknown timing; all paused/revoked locks composer but
  preserves history; no fictitious typing or Seen state; keyboard and narrow-screen usage.
- [ ] Run `pnpm exec vitest run apps/web/src/features/finances/chat-page.test.tsx`; confirm failures.
- [ ] Compose shadcn chat patterns with record cards and explicit budget approval UI tied to the existing
  authenticated exact-version endpoint. Agent-reported approval is never sufficient.
- [ ] Rerun tests and `pnpm lint`; require PASS. Commit: `feat: add asynchronous Finance chat`.

### Task 8: Finance Activity and audit completeness

**Create:** `apps/api/src/finance/activity-service.ts`, `activity-service.integration.test.ts`,
`apps/web/src/features/finances/activity-page.tsx`, `activity-detail.tsx`, `activity-page.test.tsx`.
**Modify:** audit-producing Finance mutation services, routes/client, Finance navigation/routing.

**Interfaces:** `getFinanceActivity({cursor?, type?, actor?, recordId?, from?, to?}): Promise<FinanceActivityPage>`.
Activity details resolve evidence from Task 6; route `/finances/activity` supports stable event deep links.

- [ ] Test atomic mutation/audit failure rollback; grouped categorization with inspectable children;
  budget events separate; proposals/failures never displayed as applied; missing legacy evidence honest.
- [ ] Test case-to-three-messages-to-three-records navigation, later corrections retained, pagination
  without duplicates, owner isolation, and removal of user data through existing privacy lifecycle.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/activity-service.integration.test.ts apps/web/src/features/finances/activity-page.test.tsx`; confirm failures.
- [ ] Implement projection/filtering and fill missing important audit writes identified by the inventory.
  Store precise before/after fields where the current audit only records changed-field names.
- [ ] Rerun focused tests; require PASS. Commit: `feat: expose Finance activity with conversation provenance`.

### Task 9: Resumable setup gate and shared preferences

**Create:** `apps/api/src/finance/onboarding-service.ts`, `onboarding-service.integration.test.ts`,
`apps/web/src/features/finances/onboarding-gate.tsx`, `onboarding-flow.tsx`, `onboarding-flow.test.tsx`.
**Modify:** setup/configuration services, `setup-page.tsx`, `configuration-editor.tsx`, settings,
`workspace-page.tsx`, manual-control owners, API routes/client, MCP setup adapter.

**Interfaces:** `getFinanceOnboarding(): Promise<FinanceOnboardingState>` and
`completeFinanceOnboarding({expectedRevision, automationChoice})` return current readiness.
Completion server validates spec §2; merely visiting a page never completes setup.

- [ ] Test agent/manual switching, unknown versus none/zero, missing source block, Plaid sync pending,
  unresolved ownership excluded or clarified, budget optional, automation later finish, verification
  pending finish, and no API deadlock preventing setup itself.
- [ ] Test existing-user prefill, preserved return links, later source failure does not re-lock workspace,
  explicit manual visibility survives mode changes, import hiding follows creation controls while
  corrections/questions remain visible, invalid saves use Sonner and retain input.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/onboarding-service.integration.test.ts apps/web/src/features/finances/onboarding-flow.test.tsx`; confirm failures.
- [ ] Implement one-time setup prompt, shared preference controls and completion summary; route the
  ordinary workspace through the gate only after all finish/repair routes work. No new financial profile.
- [ ] Rerun focused tests plus `pnpm exec vitest run apps/web/src/features/finances/setup-page.test.tsx apps/api/src/finance/setup-service.integration.test.ts`; require PASS. Commit: `feat: guide Finance setup with optional automation`.

### Task 10: Close manual-workflow coverage gaps

**Modify:** Task 1 coverage document; owning existing Finance UI modules: `transaction-controls.tsx`,
`transaction-interactions.tsx`, `transaction-breakdown-dialog.tsx`, `review-page.tsx`, `plan-editor.tsx`,
`accounts-page.tsx`, `cashflow-page.tsx`, `configuration-collections.tsx`, and domain APIs only where
an authorized human equivalent is missing.
**Create when missing:** `merchant-manager.tsx`, `rule-manager.tsx`, `related-transaction-dialog.tsx`
under the Finance feature, each with focused tests. Reuse existing editors rather than duplicate them.

**Interfaces:** Existing typed Finance mutation APIs and review actions; human-only approvals remain
human-only. New UI adapters must delegate to those APIs and preserve exact revisions/idempotency.

- [ ] Convert each inventory gap into a named acceptance test and bounded subtask before changing its
  owner module. Every registered tool must have a tested outcome surface or explicit internal-only reason.
- [ ] Add regression journeys for bulk uncategorized categorization, exact-cent split, supported
  transfer/refund/reimbursement links, recurring item changes, merchant/rule previews, and plan approval.
- [ ] Run each named owning test file with `pnpm exec vitest run <file>` and verify intended failure.
- [ ] Implement only uncovered user outcomes; never expose machine challenge/checkpoint submission as
  a fabricated manual action. Mark non-executable capability unavailable with its actual recovery path.
- [ ] Rerun owning tests and update evidence links in coverage matrix; require no unexplained user-facing
  gaps. Commit each bounded gap fix separately, then `docs: verify Finance manual workflow coverage`.

### Task 11: Integrated acceptance, documentation, and release evidence

**Create:** `e2e/finance-spending.spec.ts`, `e2e/finance-conversation.spec.ts`,
`e2e/finance-automations.spec.ts`.
**Modify:** `e2e/finance-setup.spec.ts`, `e2e/finance-mvp.spec.ts`, fixtures through repository QA workflow,
`docs/design/pages/finances.md`, `docs/product/workspaces.md`, `docs/product/finance-workspace-plan.md`,
`docs/product/implementation-log.md`, and affected engineering docs.

- [ ] Add deterministic E2E journeys for fresh/manual/agent setup, pending verification, historical
  spending/no budget/multi-month, mobile drag versus scroll, reduced motion, and filter-preserving links.
- [ ] Add question plus two replies through simulated authorized scheduled run to categorized records,
  unread receipts and notification policy, Activity evidence, missed run, and recovery without duplicates.
- [ ] Run `pnpm exec playwright test e2e/finance-setup.spec.ts e2e/finance-spending.spec.ts e2e/finance-conversation.spec.ts e2e/finance-automations.spec.ts` in the checked-in runtime; require desktop/mobile PASS.
- [ ] Reconcile old contradictory documentation and record shipped scope only after verified code.
  Check the coverage matrix against the final MCP catalog and inspect all new pages visually.
- [ ] Freeze the candidate and run `pnpm verify` once under repository delivery policy. Resolve every
  unexplained failure; report actual evidence, never assume a documentation change proves availability.
- [ ] Exercise permitted production-equivalent Plaid and external-host registration/check-in/next-run
  reply flows. Record configuration, authority, transport, time, lifecycle, recovery, and observation
  evidence; flag unavailable live checks without claiming deployment success.
- [ ] Commit acceptance/docs changes. Follow create-pr/Linear requirements if publication is requested;
  this plan does not authorize merge or production mutation.

## Design-to-task coverage

| Design sections | Owning tasks |
| --- | --- |
| 1 scope/navigation | 4, 5, 7, 8, 9 |
| 2 setup | 2, 9, 11 |
| 3 preferences/mode | 2, 4, 9, 10 |
| 4 accounting/history | 3, 11 |
| 5 bubbles | 4, 11 |
| 6 automations | 5, 6, 11 |
| 7 messages/cases/receipts | 2, 6, 7, 11 |
| 8 authority/activity/manual parity | 1, 6, 8, 10 |
| 9 architecture/storage/contracts | 2 and each domain implementation task |
| 10 verification | 11 plus each focused task gate |

## Evidence limits at planning handoff

The existing code was inspected, not exhaustively audited or exercised. Manual tool/UI parity,
all budget-authority paths, historical data quality, generic-host enrollment, and live external-host
message delivery are required implementation checks. Do not silently remove a requirement if a gap
is larger than expected: scope its owning task and preserve the contract. No product dependencies,
new migrations, runtime changes, deployment, or tests claiming product behavior were performed to
produce this plan.
