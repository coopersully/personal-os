# Finance Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution preference is maximum parallel implementation in isolated worktrees. This document does not itself start implementation or authorize merging.

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

Execution priority: maximize parallel work and ship independently verified slices as soon as their
actual prerequisites are ready. Do not wait for whole waves. Freeze contracts early, develop producers
and consumers concurrently in isolated worktrees, and integrate continuously. See the workstream
map's delivery-priority section for shared-file coordination and release constraints.

See the [parallel workstream map](2026-10-18-finance-workstreams.md) for the current delivery topology,
file ownership, release gates, and parallel waves. It supersedes the coarse sequential order below;
the numbered task acceptance criteria remain applicable.


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

List is a first-class initial view, not only an accessibility fallback. Add a remembered Bubbles/List
presentation preference independent of grouping; share query state and server totals. Support exact
amounts, sorting by name/spent/budget-used, bucket expansion, no-budget states, pending detail, and
responsive rows. Trends is included through Task 12 below.

- [ ] Add tests: grouping fallback/explicit preference; 60% area fill; size ratio matches spending ratio;
  full versus overspent style; missing monthly limit; filter changes preserved in Transactions links.
- [ ] Add interaction tests: 6px drag threshold, release does not navigate, bucket drill-down/action,
  small/zero/negative values available in list, reduced motion, touch Arrange, session Reset layout.
- [ ] Test Bubbles/List switching preserves all filters and totals, remembers presentation separately
  from grouping, supports list sorting/expansion, and retains identical transaction links on mobile.
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

Accepted focused-review handoff: Reply in Chat navigates from the canonical case to the existing
conversation with visible removable case/record context above the composer. Add tests that inspect
context, detach it without dismissing the case, preserve an existing draft during navigation, and
send the exact visible references. A detached reference must not be silently reattached on send.
Keep explicit references distinct from inferred suggestions and never resolve a case on navigation.

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

Use the mode matrix in spec §9 as an exhaustive UI acceptance table. Keep agent connectivity,
account-source freshness, onboarding completion, and financial calculation readiness independent.
Manual mode includes a direct uncategorized-review entry and automation recommendation without
repeated interruption. Do not add a competing review queue.

- [ ] Test agent/manual switching, unknown versus none/zero, missing source block, Plaid sync pending,
  unresolved ownership excluded or clarified, budget optional, automation later finish, verification
  pending finish, and no API deadlock preventing setup itself.
- [ ] Test existing-user prefill, preserved return links, later source failure does not re-lock workspace,
  explicit manual visibility survives mode changes, import hiding follows creation controls while
  corrections/questions remain visible, invalid saves use Sonner and retain input.
- [ ] Add table-driven coverage for manual, pending verification, active, overdue, all paused/revoked,
  removed registrations, and missing evidence. Assert Chat history/composer behavior, creation/import
  visibility, recovery links, sidebar attention, and continued access to corrections and Reviews.
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


## Accepted extension: timeline and trends workstreams

These tasks implement spec §11. They can be separate delivery workstreams after shared contracts
are settled. Their shared route/client/schema edits must have one integration owner. Task 11 final
acceptance must include both extensions before declaring the whole design complete.

### Task 12: Spending Trends

**Create:** `apps/api/src/finance/spending-trends-service.ts`, `spending-trends-service.test.ts`,
`spending-trends-service.integration.test.ts`, and
`apps/web/src/features/finances/spending-trends.tsx`, `spending-trends.test.tsx`.
**Modify:** domain spending contracts, API routes/client, spending page/controls/preferences.
**Depends on:** shared spending query/contribution/bin contracts and a minimal Spending route shell; not completed Bubbles/List UI.
**Interfaces:** `getFinanceSpendingTrends(query: FinanceSpendingQuery)` returns dated bins, grain,
comparison period, absolute/percentage deltas, category contributions, freshness and completeness.
Reuse Task 3 recognition/aggregation; never create competing accounting calculations.

- [ ] Add failing tests for identical totals across views, pending replacement, category focus,
  equal-elapsed comparison, unequal month lengths, DST, zero denominator, partial bins, and missing coverage.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/spending-trends-service.test.ts apps/api/src/finance/spending-trends-service.integration.test.ts`; verify intended failures.
- [ ] Implement shared aggregation, 31/180-day grain thresholds, labeled comparisons and contribution
  deltas. Preserve personal/outflow/refund/pending/transfer settings and separate currency groups.
- [ ] Build Trends as the third remembered Spending view, bars/comparison summary and accessible
  table; test bar navigation preserves query scope and reduced-motion/keyboard/mobile behavior.
- [ ] Run preceding tests plus `pnpm exec vitest run apps/web/src/features/finances/spending-trends.test.tsx`;
  require PASS. Add Trends journeys to `e2e/finance-spending.spec.ts`. Commit the bounded slice.

### Task 13: Cash flow Agenda and Calendar

**Create:** `apps/api/src/finance/cashflow-timeline-service.ts`, `cashflow-timeline-service.integration.test.ts`,
`packages/domain/src/finance/cashflow-timeline.ts`, and
`apps/web/src/features/finances/cashflow-agenda.tsx`, `cashflow-calendar.tsx`, `cashflow-timeline.test.tsx`.
**Modify:** `cashflow-page.tsx`, canonical cash-flow/recurring/reimbursement read services,
API routes/client, shared Finance preferences.
**Depends on:** Task 2; reuse accounting/ownership helpers from Task 3.
**Interfaces:** `getFinanceCashflowTimeline({from, to, timezone, accountIds})` returns dated and undated
occurrences with stable source references, expected/actual matching, uncertainty, freshness, and
an explicitly available/unavailable projected-balance result. Preserve existing detail mutations.

- [ ] Add failing integration cases for expected-to-actual matching, overdue/undated/unknown-amount
  items, duplicate occurrences, uncertain reimbursement, ownership limitations, one/both-sided
  transfer scope, card purchase/payment treatment, and no forecast despite available event records.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/cashflow-timeline-service.integration.test.ts`; verify intended failure.
- [ ] Implement an API-owned timeline using existing recurring and reimbursement records; no synthetic
  Calendar-workspace events or unsupported safe-to-spend amounts. Keep underlying source links stable.
- [ ] Refine Outlook with Agenda default and remembered Calendar option, next-30-days default,
  date navigation, account scope, undated section, day details, and existing source editors.
- [ ] Test equivalent items in both views, accessible calendar navigation, timezone boundaries,
  source failure isolation, mobile layout, and Sonner for discrete actions.
- [ ] Run the integration test and `pnpm exec vitest run apps/web/src/features/finances/cashflow-timeline.test.tsx apps/web/src/features/finances/cashflow-page.test.tsx`; require PASS.
- [ ] Add `e2e/finance-cashflow-timeline.spec.ts` to final desktop/mobile acceptance; commit the slice.

Coverage extension: spec §11 is owned by Tasks 12–13. Task 11 verification follows Tasks 12–13 as
well as the original tasks. Focused Reviews interaction changes need their own accepted design
before extending implementation beyond the shared-case guarantees already specified.

## Approved financial exploration extension

Spec §12 and workstreams K–O are part of the larger delivery. They may ship separately after their
own prerequisites; core acceptance does not wait for every follow-on. Whole-program completion does.

### Task 14: Spending Rhythm

**Depends on:** Task 3 recognized-contribution aggregate and shared dated-bin contract; not finished Trends UI, Chat, or setup gate.
**Create:** `apps/web/src/features/finances/spending-rhythm.tsx`, `spending-rhythm.test.tsx`.
**Modify:** spending controls/preferences and shared trends service if daily coverage is not exposed.
**Interface:** reuse `getFinanceSpendingTrends` daily bins with date coverage state; no client ledger.

- [ ] Test last-three-month calendar boundaries, timezone/DST, consistent filters/totals, positive
  intensity, net-refund state, missing/future/zero distinction, and exact transaction drill-down.
- [ ] Run `pnpm exec vitest run apps/web/src/features/finances/spending-rhythm.test.tsx`; verify intended failure.
- [ ] Implement heatmap, legend, day detail, keyboard navigation, and accessible list using spec §12.
- [ ] Rerun focused test and add Rhythm desktop/mobile journey to `e2e/finance-spending.spec.ts`;
  require PASS before committing the independently reviewable view.

### Task 15: Recurring-cost ladder

**Depends on:** existing recurring-item reads and shared money/currency/ownership contract; Task 13
is useful integration context but not a hard prerequisite if the existing source reads suffice.
**Create:** `apps/api/src/finance/recurring-cost-projection.ts`, `recurring-cost-projection.test.ts`,
`apps/web/src/features/finances/recurring-cost-ladder.tsx`, `recurring-cost-ladder.test.tsx`.
**Modify:** typed Cash flow contract/client and Bills & subscriptions view.
**Interface:** API-owned projection of original cadence/amount, normalized monthly/annual amounts,
certainty, source references, comparable price changes, and excluded-variable-item coverage.

- [ ] Test 52/26/24/12/4/1 annualization factors, rounding only at presentation, different currencies,
  variable/irregular exclusions, suspect items, and no unsupported usage or cancellation inference.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/recurring-cost-projection.test.ts`; verify intended failure.
- [ ] Implement projection and ranked/stacked accessible presentation with original cadence and labels.
- [ ] Run preceding test plus `pnpm exec vitest run apps/web/src/features/finances/recurring-cost-ladder.test.tsx`;
  require PASS and add Cash flow acceptance coverage before committing.

### Task 16: Payday-to-payday

**Depends on:** Task 13 timeline/expected-to-actual matching and reliable income dates; protected-floor
profile extension integrates through the shared-contract owner without adding a setup requirement.
**Create:** `apps/api/src/finance/payday-projection.ts`, `payday-projection.test.ts`,
`payday-projection.integration.test.ts`, `apps/web/src/features/finances/payday-view.tsx`,
`payday-view.test.tsx`.
**Interface:** timeline-scoped cycle projection with selected income stream, start/end, known movements,
optional protected floor, evidence-qualified lowest balance/date, and explicit unavailable reasons.

- [ ] Test multiple-stream selection, variable payday fallback, missing balance/date, partial ownership,
  actual replacement, internal transfers, card payments, and unknown floor versus zero floor.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/payday-projection.test.ts apps/api/src/finance/payday-projection.integration.test.ts`; verify intended failures.
- [ ] Implement projection using the timeline ledger and optional user-confirmed floor; never return
  a confident affordability amount from incomplete evidence.
- [ ] Build cycle timeline and source details; run preceding tests plus
  `pnpm exec vitest run apps/web/src/features/finances/payday-view.test.tsx`; require PASS.
- [ ] Add multi-payday/missing-evidence E2E coverage and commit the slice.

### Task 17: Reimbursement journey

**Depends on:** existing reimbursement ledger/source contracts; Task 6 only for optional conversation
provenance links. Does not wait for the whole timeline or Chat implementation to ship the core view.
**Create:** `apps/web/src/features/finances/reimbursement-journey.tsx`, `reimbursement-journey.test.tsx`.
**Modify:** existing reimbursement list/read projection only for missing timeline evidence; add
`apps/api/src/finance/reimbursement-journey.integration.test.ts` for any extended read projection.
**Interface:** existing reimbursement case ID, expense/receipt links and history; never a second case.

- [ ] Test one/many expenses, partial/multiple receipts, remaining balance, unknown date versus overdue,
  corrections, unmatched credits, personal-cost consistency, and cross-owner reference rejection.
- [ ] Run `pnpm exec vitest run apps/web/src/features/finances/reimbursement-journey.test.tsx`; verify intended failure.
- [ ] Implement inspectable journey in Reimbursements with existing manual reconcile actions, accurate
  expected/received labels, and conversation/activity links only where real evidence exists.
- [ ] Rerun focused UI/API tests and add partial-recovery E2E coverage; require PASS before commit.

### Task 18: Goal scenarios

**Depends on:** existing goal/profile data and scenario contract, plus Task 1 before exposing any
prepare-for-approval action. Existing simplified scenario arithmetic must be reviewed, not assumed suitable.
**Create:** `apps/api/src/finance/goal-scenario-projection.ts`, `goal-scenario-projection.test.ts`,
`apps/web/src/features/finances/goal-scenarios.tsx`, `goal-scenarios.test.tsx`.
**Modify:** domain scenario contracts, Wealth view, Cash flow Scenarios links, and hypothetical storage
only if current saved-scenario support is absent; coordinate additive schema work through B.
**Interface:** explicit goal progress/target, fixed contribution and optional schedule/date inputs;
returns remaining amount, dated cumulative contribution series, estimated completion or unavailable
reason, and assumptions. A proposal handoff uses the existing exact human approval contract.

- [ ] Test achieved/unknown progress, zero contribution, month-end contribution dates, past target date,
  exact cents, no assumed returns, three-alternative bound, and no mutation of budget/goal actuals.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/goal-scenario-projection.test.ts`; verify intended failure.
- [ ] Implement transparent hypothetical projection and slider/exact-input comparison with assumptions.
  Separate save-scenario from prepare-budget-proposal; neither transfers funds nor records contributions.
- [ ] Run preceding test plus `pnpm exec vitest run apps/web/src/features/finances/goal-scenarios.test.tsx`;
  require PASS and verify human approval cannot be bypassed through scenario application.
- [ ] Add hypothetical-versus-actual E2E coverage and commit the slice.

All five extension tasks inherit the original owner isolation, Sonner, reicon, accessible alternatives,
current-source evidence, focused tests, and repository release verification gates. J tracks extension
acceptance independently; update implementation documentation only as each view actually lands.


## Review refinements: Spending contracts

Task 3 must produce a shared recognized-contribution snapshot consumed by aggregate, bins, and
transaction drill-down. Add cross-day/cross-month pending-replacement tests proving sum of bins equals
aggregate and drill-down contributions. Add expected/partial/canceled reimbursement fixtures without
changing existing cash-exposure callers. Compare selected-account spending separately from complete
monthly budget-scope utilization, label differences, and withhold fill for unknowable budget scope.
Test exact-month/no-carry-forward budget selection, deterministic approval ordering, preserved historic
allocation references, date-only timezone behavior, and positive-bubble/net-refund reconciliation.
Task 12 uses equal elapsed calendar days rather than invented intraday precision. Task 4 exposes the
scope and negative-adjustment explanations beside the visualization. These are producer contract
gates, not reasons to serialize independent visualization implementations.


## Independent review refinements: required task additions

These additions implement spec §13. The three external-host refinements (generic host,
capability handshake, and interrupted-run recovery) were explicitly approved after discussion.
Message timing is settled in the subsequent refinement. Implement these contracts before dependent
features are exposed.
Other engineering evidence gaps remain required acceptance work.

| Task / owner | Required contract or implementation refinement | Required regression evidence |
| --- | --- | --- |
| 1 / A | Explicitly own active-budget `createBudget` and `setBudgetPlan` in `apps/api/src/finance-service.ts`, their HTTP/MCP routes, review replay and maintenance executors | Direct-service, HTTP and MCP agent rejection; authenticated human success; no active write on rejection |
| 2, 9 / B/I | Separate workspace completion from budget-setup protocol; stable capability reason/recovery matrix; preserve unknowns across unrelated profile revisions | Manual/agent switching then subsequent setup invocation without optional-budget re-lock or repeated interrogation |
| 9 / I | Existing-user read/correction grandfathering when all sources disconnected; onboarding-critical manual subset only | Populated migration/E2E with disconnected sources, historical records, old approvals, pending cases |
| 5 / B/E | Generic polling-host registry/schema/migration and first authenticated binding alongside existing variants | Unbound job creation, wrong-connection rejection, preserved Codex/Claude behavior, actual supported-host round trip |
| 5–7 / E/F | Server challenge fetch/ack/persist-response capability exchange, protocol-version bound | No self-report unlock, no handshake unread/activity, incompatible upgrade relocks only dependent capability |
| 6 / F | Consumed message boundary and record revision; owner-level coalesced claims; explicit guarded recovery | Second reply during run, manual correction race, revoke before effect, revoke after effect before reply, two hosts/no duplicate effect |
| 6–8 / F/G | Canonical focused-review projection states and atomic evidence production | Durable send/waiting, unavailable target/manual recovery, failed attempt distinct from applied, no future-message citation |
| 13 / B/D | New versioned occurrence/match contract with calendar anchors and partial-payment allocations | Weekly repeats, semimonthly anchors, leap/month-end, schedule edits after match, partial/multiple payments, idempotent refresh |
| 13,16 / D/M | Explicit cash snapshot basis/as-of/reflected movements and floor scope | Pending already in available balance not deducted twice; mismatched/missing snapshots; card/transfer scope; conservative same-day order |
| 15 / L | Currency/service identity/commitment classification and cadence extension | Same merchant/two services, missing account currency, savings excluded, paused/suspected split, semimonthly support |
| 17 / N/H | Existing allocation-owned journeys with grouping; guarded receipt correction/unmatch or compensating history | Partial receipt then cancel, incorrectly matched credit recovery, shared credit bounds, grouped totals/source links |
| 18 / B/O | Goal-progress confirmation/as-of, legacy-zero handling, finite 1,200-month horizon, source-versioned scenarios | Unknown vs confirmed zero, changed goal after save, tiny contribution beyond horizon, fresh proposal approval |

Add occurrence and goal-progress migrations through B rather than hiding persistence work inside UI
tasks. D owns Cash flow shell integration; L/M/N each own their standalone view. G reads evidence;
financial mutation owners integrate F's envelope at commit. Update the exact focused test files named
in each task with the listed cases before declaring the task complete.

Parallel release refinements: D can ship known-event Agenda/Calendar before a precise projection,
with explicit coverage. N can ship existing per-case journeys before grouping/correction extensions;
these remain required program scope. O can ship view-only hypotheses before save/proposal handoff.
I can ship against a verified capability projection that correctly locks unavailable Chat, without
waiting for all F. No slice may advertise an unavailable dependent capability as complete.


## Accepted message-batch timing refinement

Task 6 captures a server-side cutoff at run start and pages through only that fixed snapshot. Persist
it across resumes. Do not poll/re-fetch newer messages during the run or fold them into an uncommitted
action. Later arrivals always become unread follow-up for the next run. Test a new message arriving
between pages, before mutation commit, after commit/before reply, and during resume: none joins the
original batch or is marked consumed by its completion. Current-batch success leaves follow-up work
pending under the existing case linkage. A direct manual record mutation still triggers normal
revision/conflict checks; distinguish that from a new chat message. Task 7 states next-run handling
near the composer. This supersedes the earlier draft suggesting incorporation before commit.


Task 6 integration clarification: `maintain_finances` start owns creation of the fixed message batch.
Its response carries batch data or the run-bound next action to fetch pages; resume retains that same
batch. Remove any implication that the prompt independently drains a live queue before starting
maintenance. Coordinate prompt templates with E. Add tests for start retries, compatible coalescing
with newer messages, resume after failure, and legacy continuation overlap; prove one batch/answer
cannot create duplicate financial effects. Task 5 registration must not claim this capability before
the actual protocol path exists and verifies it.


Task 5 prompt acceptance clarification: every generated recurring automation prompt includes that
registration's internal schedule ID on create, edit, and recopy. Add tests for two registrations to
prove their prompt IDs never cross, and verify template revisions retain the original schedule ID.
The ID is mandatory attribution, not an optional credential. A separate copy-ID action is optional.
