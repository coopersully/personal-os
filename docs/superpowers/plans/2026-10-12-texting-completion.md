# Texting Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing reliable SMS foundation into a general agent-usable inbox with exact effects and honest recovery.

**Architecture:** Project native messages into shared work discovery; external callers interpret requests and use registered domain adapters. Persist child intents and native receipts before composing responses, preserving current transport and consent enforcement.

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

- User sends another message after response preparation: stale response requires reread (T3).
- Process dies after one child commits: resume from receipt and keep successful siblings (T2).
- Bare yes, equal provider timestamps or multiple bindings: never infer approval (T4).
- Quiet hours, DST or timezone edits occur while queued: recheck and prevent duplicate check-ins (T6).
- Effect succeeds but SMS fails or STOP arrives: retain the effect, suppress unauthorized sends and show separate states (T7).

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

### T1: Durable general inbound work

**Dependencies:** S4/S5 shared WorkRef, adapters and discovery; keep current exact Finance fast path.

**Files:** Create `apps/api/src/texting-inbox-service.ts`, `apps/api/src/work/texting-adapter.ts`, `apps/api/src/texting-inbox-service.integration.test.ts`; modify `packages/domain/src/texting.ts`, `apps/api/src/texting-service.ts`, `texting-recovery-service.ts`, database schema/new migration and shared adapter registration.

**Interfaces:** `admitTextWork(tx, {ownerId,messageId,conversationRevision}): Promise<WorkRef>` is an internal signed-webhook operation, not public API. `TextWorkSnapshot` projects message/conversation refs, handling state, current consent and permitted next actions. Texting adapter implements S4/S5 native work contract.

- [ ] Write `new_text_is_durable_without_a_schedule_and_webhook_replay_is_one_work` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(pending.state).toBe('waiting_for_agent');
expect(replayedWork.ref).toEqual(originalWork.ref);
expect(hostSchedules).toHaveLength(0);
expect(unverifiedSenderWork).toHaveLength(0);
```

- [ ] Run `pnpm exec vitest run apps/api/src/texting-inbox-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Persist generic availability atomically with accepted inbound, after existing STOP/HELP/START and exact-bound Finance handling. No intent inference. Preserve signed claim/provenance and current consent epochs. Test duplicate webhook, restart before publication, recognized Finance reply not double-routed, revoked phone, account deletion and read scope without workspace scope. Awaiting agent must be a normal inspectable state.
- [ ] Run `pnpm exec vitest run apps/api/src/texting-inbox-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: expose durable general Texting work`.

### T2: Structured child operations with partial-result recovery

**Dependencies:** T1/S4; adapt current domain writers, not new orchestration agents.

**Files:** Create `packages/domain/src/texting-work.ts`, `apps/api/src/texting-child-service.ts`, `apps/api/src/texting-child-adapters.ts`, `apps/api/src/texting-child-service.integration.test.ts`; modify database schema/new migration and relevant native Task/Calendar/Finance mutation entrypoints only where same-key receipt adapters are missing.

**Interfaces:** `submitTextChild(principal, input: TextChildRequest): Promise<TextChildReceipt>` where request has parentWork/expectedRevision/claimId/fence/childKey/operation/nativeInput/dependsOnKeys/mutationKey. Finite operation union initially task_create/task_update/local_event_create/local_event_update/finance_question_answer/finance_categorization_decision. `reconcileTextChild(principal,{childId}): Promise<TextChildReceipt>` uses native receipt inspection; no arbitrary dispatch strings. `attachTextChildReceipt(principal,{childId,nativeReceiptRef,expectedRevision,mutationKey}): Promise<TextChildReceipt>` supports already-registered native operations after resolving owner, native operation/target, declared child intent and current read authority; it cannot execute them or manufacture approval.

- [ ] Write `one_failed_child_does_not_replay_or_undo_a_successful_sibling` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(afterRestart.taskReceiptId).toBe(beforeRestart.taskReceiptId);
expect(createdTasks).toHaveLength(1);
expect(parent.outcome).toBe('partial');
expect(uncertainChild.resubmissions).toBe(0);
expect(unscopedCalendarChild.status).toBe(403);
```

- [ ] Run `pnpm exec vitest run apps/api/src/texting-child-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Persist intent before domain dispatch, derive stable owner/child operation key and track verified native receipts. Validate dependency references/cycles and latest parent revision. Add bounded reconciliation page≤25 through current recovery lifecycle; failed children do not roll back completed siblings. Test crash before call/after commit/before link, same-key changed payload, manual native edit, wrong owner, revoked scope and unsupported stronger actions. Receipt lookup cannot rely on agent-supplied success flags. Build an explicit native-receipt resolver coverage table for Mail, Tasks/Reminders, Calendar and Finance using `integration/workspace-agent/operation-cases.ts`; test each supported resolver and each stronger-boundary/app-review outcome. No native action is advertised as coordinated without a receipt and exact intent match.
- [ ] Run `pnpm exec vitest run apps/api/src/texting-child-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: coordinate Texting child operations with native receipts`.

### T3: Agent tools and coordinated responses

**Dependencies:** T1/T2/S3 for relevant knowledge.

**Files:** Create `apps/api/src/texting-response-service.ts`, `apps/api/src/texting-response-service.integration.test.ts`; modify `apps/api/src/routes/texting.ts`, `packages/api-client/src/features/texting.ts`, `apps/mcp/src/tools/texting.ts`, `apps/api/src/texting-service.ts` common send admission and tool catalog.

**Interfaces:** `recordTextResponse(principal,{work,claimId,fence,expectedConversationRevision,body,receiptRefs,mutationKey}): Promise<TextResponseDraft>`; `sendTextResponse(principal,{draftId,expectedRevision,readReceipt,mutationKey}): Promise<TextResponseReceipt>`. Expose `record_text_response`, `send_text_response`, child submit/reconcile and shared list/get/claim through thin adapters. Existing manual send remains available with the same admission fence for linked work.

- [ ] Write `new_inbound_invalidates_draft_and_manual_send_cannot_duplicate_work_reply` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(staleConversationSend.status).toBe(409);
expect(draft.providerSubmissions).toBe(0);
expect(wrapperAndManualSend.providerSubmissions).toBe(1);
expect(sendUncertain.retryPermitted).toBe(false);
```

- [ ] Run `pnpm exec vitest run apps/api/src/texting-response-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Persist authored draft separately from provider send; verify claimed work, current read receipt, child result evidence and body disclosure. A draft may ask clarification without claiming domain completion. Route wrapper/manual linked sends through the common same-work guard. Test two agents racing responses, claim expiry, revocation between draft/send, provider timeout after acceptance, new inbound and response containing inaccessible child evidence.
- [ ] Run `pnpm exec vitest run apps/api/src/texting-response-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: expose coordinated Texting response tools`.

### T4: Exact bounded approvals beyond categorization

**Dependencies:** T1/T3 and F7 for budget reallocation; no new standing policy activation over SMS.

**Files:** Modify `apps/api/src/texting-reply-binding.ts`, `texting-sms-admission.ts`, `apps/api/src/finance/sms-approval-service.ts`, `packages/domain/src/texting.ts`; extend `apps/api/src/texting-sms-admission.integration.test.ts`, `apps/api/src/finance/sms-context-completion.integration.test.ts`.

**Interfaces:** Extend existing binding with advertised answer vocabulary and typed bounded proposal variant. `admitBoundTextDecision` remains server-only signed-source admission; Finance adapter invokes the F7 commit writer with an exact approval receipt instead of automatic policy authority. Public agent tools can inspect/propose, never mint a signed source. Binding expires at min(domain expiry, outbound+24h).

- [ ] Write `yes_applies_only_one_exact_advertised_binding_and_never_activates_policy` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(singleAdvertisedYes.applied).toBe(true);
expect(twoEligibleYes.applied).toBe(false);
expect(equalProviderTimestamps.applied).toBe(false);
expect(staleProposal.applied).toBe(false);
expect(standingPolicyAfterReply.active).toBe(false);
```

- [ ] Run `pnpm exec vitest run apps/api/src/texting-sms-admission.integration.test.ts apps/api/src/finance/sms-context-completion.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Retain approve/reject behavior; allow yes/no only on one canonical prompt advertising it. Add exact bounded reallocation approval with immutable effect receipt and no automatic-usage reset. Test missing/equal/reordered provider timestamps, consent epoch change, bare yes without binding, expiry, superseded proposal, duplicate inbound, forged source, protected/sensitive action app fallback and effect committed before acknowledgment failure.
- [ ] Run `pnpm exec vitest run apps/api/src/texting-sms-admission.integration.test.ts apps/api/src/finance/sms-context-completion.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: extend exact SMS approval admission safely`.

### T5: Canonical global Reviews and exact links

**Dependencies:** S4/S5 projections; independent of remaining Texting/F7 effect work.

**Files:** Create `packages/domain/src/review-links.ts`, `packages/domain/src/review-links.test.ts`; modify `apps/web/src/features/reviews/page.tsx`, `flow.tsx`, `entry.tsx`, `navigation.tsx`, `apps/web/src/app.tsx`, `apps/mcp/src/app-links.ts`, `apps/api/src/assistant-service.ts`, `texting-recovery-service.ts`; extend `apps/web/src/features/reviews/page.test.tsx` and `apps/mcp/src/app-links.test.ts`.

**Interfaces:** `buildReviewLink({work,workspace?,scope: "workspace"|"all"}): string` and `parseReviewLink(input: URLSearchParams): ReviewLinkTarget` own URL contract. `/reviews` hosts all-workspace projection; existing Finance-scoped links retain behavior; legacy settings Reviews explicitly redirects. Exact WorkRef/revision survives navigation, and each native action owns its authority.

- [ ] Write `all_link_producers_open_exact_review_and_hidden_work_does_not_leak` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(parseReviewLink(new URL(link, origin).searchParams).work).toEqual(work);
expect(legacySettingsDestination.pathname).toBe('/reviews');
expect(restrictedUserVisibleTitles).not.toContain(hiddenTitle);
expect(deletedWorkView.state).toBe('unavailable');
```

- [ ] Run `pnpm exec vitest run packages/domain/src/review-links.test.ts apps/web/src/features/reviews/page.test.tsx apps/mcp/src/app-links.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Compose the global queue from existing readers and shared work references; retain scoped responsive dialogs/drawers and keyset history. Update API/MCP/Texting/assistant links together. Test multiple workspaces, exact archived evidence, deleted source, unauthorized scope, unavailable projection, browser back, mobile focus restoration and copied link across sessions. Do not replace native approval stores with a global store.
- [ ] Run `pnpm exec vitest run packages/domain/src/review-links.test.ts apps/web/src/features/reviews/page.test.tsx apps/mcp/src/app-links.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: unify Reviews navigation and exact work links`.

### T6: Adaptive preferences and deterministic message eligibility

**Dependencies:** T1/T3; use current notification service and real workspace work resolvers.

**Files:** Modify `packages/domain/src/notification-policy.ts`, `apps/api/src/notification-service.ts`, `notification-work-resolver.ts`, `apps/web/src/features/notifications/finance-preferences.tsx`, `apps/mcp/src/tools/workspace-notifications.ts`; create `apps/api/src/texting-coaching-policy.integration.test.ts`; extend existing notification client/routes rather than duplicate them.

**Interfaces:** Extend preferences with mode=`adaptive|daily_check_in`, optional preferredLocalTime, existing quiet/reminder overrides. `evaluateTextEligibility(input: TextEligibilityInput): TextEligibilityDecision` consumes server-resolved intent/work revision, verified inbound reference, consent and notification history. Return reason and nextEligibleAt, not generated question text. Check-in slot identity owner/localDate/channel; immutable timezone attribution.

- [ ] Write `daily_preference_creates_no_agent_job_and_rewording_cannot_evade_reminder` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(defaultSettings.mode).toBe('adaptive');
expect(enabledCheckIn.agentSchedulesCreated).toBe(0);
expect(dstRepeatedHour.newCheckInIntents).toBe(1);
expect(rewordedSameWork.eligible).toBe(false);
expect(replyWithoutRecentInbound.quietHourExempt).toBe(false);
```

- [ ] Run `pnpm exec vitest run apps/api/src/texting-coaching-policy.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Implement spec §9 exact quiet hours, seven-elapsed-day reminders, 24-hour reply eligibility, 09:00 opted-in default and per-date duplicate suppression. Reuse delivered publisher/drain; register domain resolvers only for native eligible work. Test timezone move, midnight queue delay, DST skip/repeat, never-remind, resolved-after-queue, narrowed privacy, workspace override, re-enable and two callers submitting the same check-in. No question generation or scheduled reasoning.
- [ ] Run `pnpm exec vitest run apps/api/src/texting-coaching-policy.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: add adaptive Texting preferences and eligibility`.

### T7: Processing, delivery and recovery controls

**Dependencies:** T1–T3/T5/T6; S6 knowledge controls consumed contextually. Add T4 approval recovery cases after T4 lands; the initial conversation does not wait for broader budget approvals.

**Files:** Modify `apps/web/src/features/texting/page.tsx`, `page.test.tsx`, `apps/api/src/texting-recovery-service.ts`, `texting-recovery-runtime.ts`, `texting-recovery-dispatcher.ts`; create `apps/api/src/texting-work-recovery.integration.test.ts`; update database retention/deletion path only for new work/child/draft rows.

**Interfaces:** `getTextWorkStatus(principal,{work}): Promise<TextWorkStatus>` returns independent inbound/handling/children/outbound states and allowed recovery actions. `recoverTextWork(principal,{work,expectedRevision,action,mutationKey}): Promise<TextWorkStatus>` action is inspect/reconcile/release_unsubmitted/clarify, each domain-validated. No generic retry action for uncertain submission.

- [ ] Write `restart_stop_and_failed_delivery_preserve_applied_effects` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(afterSmsFailure.financeEffect.status).toBe('applied');
expect(afterStop.newSends).toBe(0);
expect(afterEnable.oldExpiredSends).toBe(0);
expect(retention.pendingUncertainReceipts).toHaveLength(1);
expect(ownerDeletion.privateBodies).toHaveLength(0);
```

- [ ] Run `pnpm exec vitest run apps/api/src/texting-work-recovery.integration.test.ts apps/web/src/features/texting/page.test.tsx`; confirm the new assertion fails for the intended missing behavior.
- [ ] Extend existing recovery stages for generic child/results, not a second scheduler. Display waiting for agent, claimed, clarification, partial, applied, blocked and uncertain independently from delivered. Add manual source/consent repair and safe inspection actions; retain sensitive payload policy, owner deletion and outstanding-effect retention. Test drain during dispatch, one failed stage not starving others, terminal callback regression, forged status, lost response after effect and mobile recovery.
- [ ] Run `pnpm exec vitest run apps/api/src/texting-work-recovery.integration.test.ts apps/web/src/features/texting/page.test.tsx` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: complete Texting work visibility and recovery`.

### T8: Integrated daily-budget-question journey and external evidence

**Dependencies:** S1–S6, F1/F8, T1–T7; budget-execution scenario additionally F7; S7 events tested separately.

**Files:** Create `integration/workspace-agent/texting-completion.integration.test.ts`, `e2e/texting-work.spec.ts`, `docs/engineering/texting-toolkit-acceptance.md`; extend `integration/workspace-agent/tool-dictionary.ts` only through its current generation path and current Texting operational evidence docs.

**Interfaces:** Use actual MCP discovery→client→API→PostgreSQL→existing SMS provider adapter. Test harness external caller supplies authored question/response and uses scoped credentials; it is not an embedded product agent. Acceptance record separates code, runtime configuration, authority, transport, recovery, observation and real provider evidence.

- [ ] Write `fresh_agent_reads_answer_and_prior_knowledge_then_verifies_result` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(secondSession.answerReceiptId).toBe(firstAnswerReceiptId);
expect(secondSession.knowledgeIds).toContain(savedPreferenceId);
expect(verifiedResult.domainReceiptId).toBe(appliedReceiptId);
expect(duplicateWebhook.additionalEffects).toBe(0);
expect(noCallerState.handling).toBe('waiting_for_agent');
```

- [ ] Run `pnpm exec vitest run integration/workspace-agent/texting-completion.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Exercise sourced fact→eligible authored question→signed reply→fresh authorized session→supported effect→app evidence. Include unsolicited request, multi-workspace partial result, app manual resolution, no host, revoked credential and missing scope. Run `pnpm exec playwright test e2e/texting-work.spec.ts`. Full verification precedes source-ready status; authorized real SMS/carrier/consent and runtime network proof is a separate checklist, not an automatic production send or requirement to certify a named agent host.
- [ ] Run `pnpm exec vitest run integration/workspace-agent/texting-completion.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `test: prove complete Texting toolkit journeys`.

## Completion gate

- [ ] Run `git diff --check`, focused contract/integration tests and `pnpm verify`; retain actual results.
- [ ] Reconcile each task with its linked spec requirement, record external evidence gaps and preserve all failed/pending states.
- [ ] Verify upgrade, deletion, revocation and rollback readability before marking the subsystem complete.
