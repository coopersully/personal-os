# Persistent Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete correctable, forgettable, discoverable memory across authorized agents and app sessions.

**Architecture:** Extend the existing PostgreSQL knowledge foundation. Domain schemas define the contract;
API services own lifecycle, disclosure and retrieval; typed client and MCP adapt it. Web and native
mobile controls consume that same API without a second memory store.

**Tech Stack:** Existing TypeScript, Zod, PostgreSQL/Drizzle, Hono, React, Expo, MCP, Vitest and Playwright.

**Spec:** [Persistent memory completion design](../specs/2026-11-12-persistent-memory-design.md).

Planning deliverable only. No checkboxes represent implementation completed by writing this plan.
Baseline is consolidated `83d784ce`; re-inspect current main and branch before execution. Reuse
existing Nohmi issues; do not recreate the archived chats or resume unrelated workstreams.

## Global Constraints

- Memory never grants authority. Sensitive knowledge confirmation and domain action approval are distinct.
- Initial auto-acceptance keys: presentation.detail = concise|detailed; presentation.format = prose|bullets.
- Require three independent explicit selections on three distinct local dates within 30 days, no contrary
  selection/conflict/suppression, and enabled learning. Default inferred review interval is 90 days.
- Preserve inferred origin through acceptance and every projection. No agent-reported event qualifies
  as first-party evidence. Owner correction suppresses automatic relearning until explicitly reset.
- Existing value input limit 8 KiB; maximum 20 evidence references and 20 relationships per mutation.
- Retrieval limit 1–50, default 20; at most 20 entity refs; query max 500 chars; context envelope max
  32 KiB UTF-8. Actor/filter/purpose/epoch-bound cursors expire after 15 minutes; export page size 50.
- Published migrations/journal entries are immutable. Allocate new migrations against current main;
  never assume 0139 remains the latest number or reuse an old reservation.
- No internal model, external vector store, transcript import, goal redesign or Finance/Texting expansion.
- Owner-confirm/restrict/forget/export and learning settings require human authentication in v1.
- Use Sonner for discrete feedback, the native pull-refresh exception, centralized reicon registry,
  session-scoped caches and no offline knowledge persistence/write queue.
- One writer owns schema/journal and composition at a time. Independent review and policy-complete
  frozen-candidate verification remain release gates. Existing historical receipts are not transferable.

## Review Focus

- Owner forget races with a new derived record: epoch-bound preview must conflict, never leave copied content (Task 3).
- Time-zone changes/replayed selections inflate learning: immutable event-local dates and identities must prevent promotion (Task 2).
- Permission or purpose narrows between pages: counts, snippets and explanations must not disclose old state (Task 4).
- A lost forget response is retried after restoration: tombstones/deletion ledger must prevent resurrection (Tasks 3 and 8).
- Logout or back navigation completes while a save is pending: stale callbacks cannot repopulate another session (Tasks 6–7).

## File ownership and shared contracts

Keep `packages/domain/src/knowledge.ts` as the stable export entry; introduce focused
`knowledge-lifecycle.ts`, `knowledge-learning.ts` and `knowledge-retrieval.ts` and re-export through
`packages/domain/src/index.ts`. Keep `apps/api/src/knowledge/record-service.ts` for create/get,
extract shared authorization into `access.ts`, and add the services named below. All creation and
mutation paths must use that same authorization/claim/derivation contract, not parallel legacy paths.

Shared boundary types (strict Zod schemas plus inferred types):

- `KnowledgeMutationResult`: union of readable receipt, private pending-owner-review receipt, or
  content-free forgotten receipt or pending erasure receipt with operationId; every variant has receiptId, recordId and outcome.
- `KnowledgeLifecycleInput`: action, recordId, expectedRevision, mutationKey and action-specific
  content/evidence/replacementId/restrictions. Actions: revise|dispute|confirm|supersede|restrict.
- `KnowledgeForgetPreview`: previewId, ownerEpoch, recordId, affected IDs/revisions and counts;
  `KnowledgeForgetInput`: previewId, ownerEpoch, mutationKey.
- `KnowledgeSelectionInput`: enumerated preference key/value, stable sourceEventId. Server derives
  owner, occurrence time, time zone and immutable event-local date from the authenticated selection.
  `issueSelectionInteraction(principal)` returns an owner/session-bound one-use ID with a 15-minute
  admission expiry; its committed event can be retried idempotently after that expiry.
- `KnowledgeQuery`: purpose, workspace?, entityRefs?, timeWindow?, text?, status?, limit?, cursor?.
- `KnowledgePage`: items, nextCursor, epoch. `KnowledgeContextPack`: contextUseId, separated
  stated/inferred/tentative/conflict sections, recentSelections (key/value/validUntil/sourceEventId),
  missingInputs, truncated, next fetch references, epoch.
- `KnowledgeContextExplanation`: current allowed IDs/revisions/reason codes or unavailable/changed.
- `KnowledgeSettings`: automaticPreferenceAcceptance boolean, revision; update requires expectedRevision
  and mutationKey. Per-key suppression reset is a separate owner mutation with expected epoch.

## Task 1: Lifecycle and durable claim/provenance state

**Tracking:** COO-166 — Memory API/MCP. **Depends on:** existing save/read foundation.
**Files:** Create domain `knowledge-lifecycle.ts`; API `knowledge/access.ts`, `lifecycle-service.ts`,
`lifecycle-service.integration.test.ts`; modify `knowledge.ts`, `record-service.ts`, database
`src/schema.ts`, schema tests, new migrations/journal and domain exports.
**Interfaces:** `createKnowledgeLifecycleService({db,now}).mutate(principal, input:
KnowledgeLifecycleInput): Promise<KnowledgeMutationResult>`; shared access functions consume
the existing `Principal` and transaction; original create/get retain their registered names.

- [ ] Add `owner_correction_wins_and_stale_agent_cannot_overwrite`: assert revision increments,
  history retains source, stale revision returns 409 and accepted owner value remains unchanged.
- [ ] Add `conflicting_claims_remain_visible`: two same-key overlapping values create a conflict;
  different validity periods do not. Add wrong-owner, supersession cycle and exact-retry assertions.
- [ ] Run `pnpm exec vitest run apps/api/src/knowledge/lifecycle-service.integration.test.ts`;
  confirm failure is the absent lifecycle behavior, not fixture setup.
- [ ] Implement origin/acceptance metadata, claim identity, validity, owner epoch, typed derivation
  edges, immutable revisions and source invalidation. Project legacy metadata through revision-keyed sidecars without editing old snapshots; integrate creation
  with the same conflict/epoch path. Add owner-only sensitive proposals with redacted agent receipts.
- [ ] Prove agent confirm/restrict/forget denial, sensitive pending receipts and unchanged permission
  grants after confirming authority-like text. Test removed source and revoked contributor separately.
- [ ] Rerun lifecycle plus existing record-service and registered knowledge integration suites;
  run affected typechecks and schema tests. Commit `feat: add knowledge correction and provenance lifecycle`.

## Task 2: Evidence-based preference acceptance

**Tracking:** COO-166 — Memory API/MCP. **Depends on:** Task 1.
**Files:** Create domain `knowledge-learning.ts`; API `knowledge/learning-service.ts`,
`learning-service.integration.test.ts`; modify schema/migrations and shared lifecycle admission.
**Interfaces:** `createKnowledgeLearningService({db,now}).recordSelection(principal,
KnowledgeSelectionInput): Promise<KnowledgeMutationResult | {outcome:'recorded'}>`;
`.getSettings(principal): Promise<KnowledgeSettings>`; `.updateSettings(principal,input)`;
`.resetSuppression(principal,{claimKey,expectedEpoch,mutationKey})`. All require a human session.

- [ ] Add `three_distinct_dates_accept_but_replays_do_not`: two dates remain proposed; three dates
  within 30 days accept with origin inferred and acceptance evidence_rule; replay leaves count 3.
- [ ] Add `correction_stops_relearning`: owner override remains active despite later events;
  only explicit reset permits a new inference. Test contrary selection, disabled setting,
  out-of-window event, changed time zone, source deletion and overdue review at day 90.
- [ ] Run `pnpm exec vitest run apps/api/src/knowledge/learning-service.integration.test.ts` for
  expected failures; implement the strict allowlist, deduped evidence, suppression and rule revisions.
- [ ] Reject arbitrary keys/values, sensitive payloads, agent events and future client timestamps.
  Promotion updates inferred preference content, never a domain setting or authority grant.
- [ ] Rerun the learning suite and lifecycle regressions; commit `feat: accept evidenced low-risk preferences`.

## Task 3: Forgetting with dependent-copy erasure

**Tracking:** COO-166 — Memory API/MCP. **Depends on:** Tasks 1–2.
**Files:** Create API `knowledge/forget-service.ts`, `forget-service.integration.test.ts`;
modify lifecycle schemas, record receipt replay, schema/migrations and audit projections.
**Interfaces:** `createKnowledgeForgetService({db,now}).preview(principal,{recordId}):
Promise<KnowledgeForgetPreview>`; `.forget(principal,KnowledgeForgetInput): Promise<KnowledgeMutationResult>`; `.status(principal,{operationId})` returns pending|blocked|completed without content.

- [ ] Add `forget_erases_history_and_transitive_copies`: use unique fixture strings; assert no
  value remains in revisions, sources, receipts or derived snapshots; independent related record survives.
- [ ] Add `changed_derivation_invalidates_preview`: race create/forget and assert 409 for stale
  epoch. Add lost-response retry, private receipt replay, repeated forget, wrong-owner and suppression tests.
- [ ] Run `pnpm exec vitest run apps/api/src/knowledge/forget-service.integration.test.ts` to
  establish failures; implement preview binding, transaction erasure, content-free tombstones,
  keyed claim suppression and owner epoch invalidation. Do not erase original domain records.
- [ ] Include all create/revise/source-import paths in explicit derivation tracking; user-authored
  independent statements remain distinct. Use durable jobs with 100-record transaction batches and a temporary owner-wide memory fence,
  50-reference preview pages and status/retry operations. Add a deletion-ledger adapter exposing
  `append({operationId,ownerId,epoch,recordIds,suppressionFingerprints})` and
  `readReceipt(operationId)`; completed requires verified durable append as well as local erasure.
  Test 10-second timeout, retries after 1/5/30 minutes, blocked repair, shutdown and crash-after-append.
- [ ] Rerun lifecycle/learning/forget suites and owner-deletion cascade tests; commit
  `feat: forget knowledge without history or replay leakage`. Do not claim backup erasure yet.

## Task 4: Discovery, bounded retrieval and export

**Tracking:** COO-167 — Purpose-bound retrieval. **Depends on:** Tasks 1–3.
**Files:** Create domain `knowledge-retrieval.ts`; API `knowledge/search-service.ts`,
`context-service.ts`, `export-service.ts`, `retrieval.integration.test.ts`; modify shared access,
database projections/indexes and source invalidation. No new vector dependency.
**Interfaces:** services expose `.search(principal,KnowledgeQuery): Promise<KnowledgePage>`,
`.history(principal,{recordId,purpose,cursor?}): Promise<KnowledgePage>`,
`.context(principal,KnowledgeQuery): Promise<KnowledgeContextPack>`,
`.explain(principal,{contextUseId}): Promise<KnowledgeContextExplanation>` and
`.exportPage(principal,{cursor?}): Promise<KnowledgePage>` (owner only).

- [ ] Add `fresh_agent_discovers_relevant_corrected_memory`: source-backed relevant records
  appear without knowing IDs; unrelated restricted records do not affect counts or snippets.
- [ ] Add `old_context_cannot_resurrect_forgotten_value`: forget/restrict between pages yields
  cursor conflict or denial; explanation returns unavailable and export contains no forgotten fixture string.
- [ ] Add `bounded_context_is_honest`: UTF-8 envelope <=32768 bytes, max 50 records, explicit
  truncation, deterministic ties, expired/overdue/disputed material excluded from accepted sections.
- [ ] Run `pnpm exec vitest run apps/api/src/knowledge/retrieval.integration.test.ts` for expected
  failures; implement permission-before-candidate search, current-source checks, epoch cursors and
  reference-only explanation receipts. Expire cursors at 15 minutes; reject text over 500 chars.
- [ ] Test 24-hour recentSelections expiry separately from durable 30-day learning evidence.
  Test authority narrowing with unchanged epoch, source failure versus empty results, owner-only
  paginated export and changed epoch while exporting. Rerun and commit `feat: retrieve purpose-bound memory`.

## Task 5: Complete public API/client/MCP and agent guidance

**Tracking:** COO-166 — Memory API/MCP and COO-167 — Purpose-bound retrieval. **Depends on:** Tasks 1–4.
**Files:** Modify `apps/api/src/routes/knowledge.ts`, API `app.ts`,
`packages/api-client/src/features/knowledge.ts`, client composition,
`apps/mcp/src/tools/knowledge.ts`, `tool-catalog.ts`, catalog/HTTP tests;
create `integration/workspace-agent/knowledge-lifecycle.integration.test.ts`.

**Interfaces:** retain save/get; add POST `/v1/knowledge/:id/actions`, POST
`/v1/knowledge/:id/forget-preview`, POST `/v1/knowledge/forget`, GET `/v1/knowledge/operations/:id`, POST
`/v1/knowledge/operations/:id/retry`, GET `/v1/knowledge`,
GET `/v1/knowledge/:id/history`, POST `/v1/knowledge/context`, GET
`/v1/knowledge/context/:id`, GET `/v1/knowledge/export`, GET/PATCH
`/v1/knowledge/settings`, POST `/v1/knowledge/selection-interactions`, POST `/v1/knowledge/selections`, POST `/v1/knowledge/learning-reset`.
Register literal routes before `/:id`. Strict request/response schemas are the Task 1–4 types.
MCP: `update_knowledge` (agent-allowed actions only), `search_user_knowledge`,
`get_context_for_intent`, `explain_context`. Owner-only functions are API/app functions, not
agent-discoverable tools. Version the save receipt union deliberately and update all consumers together.

- [ ] Add `two_agents_observe_owner_correction_and_forgetting` through real MCP/client/API and
  fresh connections; assert no private proposal values, no owner-only tools and live revocation denial.
- [ ] Run `pnpm exec vitest run integration/workspace-agent/knowledge-lifecycle.integration.test.ts`;
  verify expected failures, then wire typed adapters and exact tool grants/read-only classifications.
- [ ] Update orientation/capability guidance from actual registration: search before duplicate save,
  cite sources, distinguish inferred context and fetch fresh context after mutation. Do not alter
  existing public orientation names or claim universal workspace integration.
- [ ] Regenerate `docs/engineering/workspace-agent-tools.md` via
  `pnpm exec tsx scripts/workspace-agent-dictionary.ts`; run existing dictionary/discovery tests,
  new integration suite and affected package typechecks. Commit `feat: expose complete memory lifecycle tools`.

## Task 6: Responsive web/desktop memory controls

**Tracking:** COO-168 — Inspectable memory controls. **Depends on:** Task 5.
**Files:** Create `apps/web/src/features/knowledge/{page,record-detail,record-editor,learning-settings}.tsx`,
`page.test.tsx`; modify settings `manifest.ts`, `settings-routes.ts`, `settings-layout.tsx`, existing
settings composition and icons registry only as needed; create `e2e/knowledge.spec.ts`.
**Interfaces:** consume typed client from Task 5 with session/owner/epoch query keys. Route
`/settings?section=memory`; detail selection uses an owned record ID, never embedded private text.

- [ ] Add `owner_can_correct_inferred_memory_and_forget_dependents`: assert persistent Inferred
  label, evidence count, correction conflict recovery and preview/confirm erasure via API fixture.
- [ ] Add `late_save_after_logout_cannot_restore_memory`; assert session clearing and no late toast
  or cached content for the new account. Assert Sonner outcomes and absence of inline result messages.
- [ ] Run `pnpm exec vitest run apps/web/src/features/knowledge/page.test.tsx` for expected failures;
  implement accepted/review/conflict views, add/edit, detail/history, owner actions and learning settings.
  Include “Use this time” (24-hour session context and learning evidence) and “Remember this
  preference” (immediate stated memory) controls, with server-issued retry-stable interaction IDs.
  Keep pending forget toasts/status honest until the durable operation reaches completion.
- [ ] Implement bounded download export and accurate forgetting/source-copy explanation; keep content
  out of URLs/logs and prevent whole-history prefetch. Verify keyboard/focus, screen reader labels,
  small screens and large text. Run focused suite and
  `pnpm exec playwright test e2e/knowledge.spec.ts` in desktop/mobile browser projects.
- [ ] Commit `feat: add inspectable web memory controls` after focused acceptance.

## Task 7: Native mobile controls

**Tracking:** COO-168 — Inspectable memory controls. **Depends on:** Task 5; reuse Task 6 behavior.
**Files:** Create `apps/mobile/src/app/memory.tsx`, `features/knowledge/screen.tsx`,
`features/knowledge/screen.test.tsx`, feature editor/detail modules; modify `apps/mobile/src/app/settings/index.tsx` and
`apps/mobile/src/app/_layout.tsx` route registration; reuse the existing settings section manifest.
**Interfaces:** same typed client, owner/epoch keys and operations as Task 6; use native navigation
and existing export/share adapter. No new persistence or parallel mobile memory model.

- [ ] Add `native_owner_reviews_corrects_and_forgets` and
  `back_navigation_and_logout_fence_pending_writes`; verify Inferred label and refreshed canonical state.
- [ ] Run `pnpm exec vitest run apps/mobile/src/features/knowledge/screen.test.tsx` for expected failures;
  implement list/detail/editor, review/restriction, learning, forget preview and paginated export.
- [ ] Verify platform share capability/failure, permission denial, native back, keyboard/large text,
  session clearing, spinner/error-only pull refresh and normal Sonner lifecycle for explicit actions.
- [ ] Rerun focused tests, native typecheck and fixture simulator journey; commit
  `feat: add native memory controls`. Physical-device/share acceptance remains separately recorded.

## Task 8: Integration, recovery and release acceptance

**Tracking:** COO-165 — Persistent memory and its direct children. **Depends on:** Tasks 1–7.
**Files:** Create `integration/workspace-agent/memory-acceptance.integration.test.ts`;
extend knowledge migration recovery tests; update `docs/product/user-knowledge.md`, ADR 0005 and
implementation log. Extend the existing backup/restore procedure in `deploy/mac-mini/README.md`
or its actual owning runbook after inspection; do not create an unrelated deployment framework.
**Interfaces:** reuse public Task 5 surfaces. Restore admission consumes the independent content-free
deletion ledger and refuses service startup until deleted IDs/epochs are reconciled.

- [ ] Add `memory_survives_restart_but_forgotten_content_does_not_return`: two agents, owner correction,
  inference promotion, scope narrowing, forget, service restart and fixture backup/restore rehearsal.
  Assert all actual API/MCP/history/search/export paths, not only SQL table counts.
- [ ] Verify append-only upgrades from current main and the published Memory history, immutable
  journal subsequences, existing data preservation and failure rollback. Reconcile 0139 against
  the execution-time main watermark before claiming upgrade coverage.
- [ ] Establish deletion-ledger retention/durability independent of the restored snapshot; document
  actual backup retention and purge behavior, operator access and replay admission. Test with isolated
  fixtures first; missing operator/key/config access remains an explicit release blocker.
- [ ] Run focused suites, independent review and resolve findings. Freeze the candidate, then run
  `pnpm verify` or documented equivalent hosted verification once; do not transfer old-head receipts.
- [ ] Complete required protected PR gates only with existing valid merge authority. Obtain authorized
  deployed-version, migration and authenticated fixture evidence without inventing personal memories.
- [ ] Update direct issues with actual acceptance; keep incomplete native/device or operational gates
  visible. Commit documentation as `docs: record persistent memory acceptance` only with true evidence.

## Execution order and completeness check

Execute 1 → 2 → 3 → 4 → 5 → 6/7 → 8. UI tasks may proceed independently only after shared contracts
are accepted and writable ownership is isolated. No implementation dispatch is created by this plan.
Spec sections 4–5 map to Task 1; 6 to Task 2; 7 to Tasks 3/8; 8 to Tasks 4/5;
9 to Tasks 6/7; 10 to Task 8. All Review Focus risks have named tests above.
Recommended execution is sequential implementation with independent review at the security/storage
boundaries; product code starts only under a subsequent execution instruction.
