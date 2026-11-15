# Shared Toolkit Completion Implementation Plan

> Historical planning context imported November 12, 2026. Current canonical product contracts,
> later accepted decisions, and implementation evidence supersede conflicting assumptions here.
> This import does not authorize Finance/Texting expansion or establish shipped Memory capability.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make account knowledge and native work safely reusable across authorized agents and later runs.

**Architecture:** Extend native domain work with small coordination records; keep knowledge in typed relational records and immutable history. Reuse existing review projections and domain authority; add optional push only after polling works.

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

- Credential scopes narrow between pagination pages: no stale snapshot can disclose removed access (S3/S5).
- Agent summaries repeat the same source: repetition must not become corroboration (S2).
- Manual work completes while a lease is active: stale holders cannot repeat the effect (S4).
- Old host fire arrives after an owner transfer: original execution epoch cannot apply (S5).
- Endpoint DNS changes after validation: no connection reaches a private address (S7).

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

### S1: Knowledge records, provenance and authority

**Dependencies:** None; can run alongside F1.

**Files:** Create `packages/domain/src/knowledge.ts`, `apps/api/src/knowledge/record-service.ts`, `apps/api/src/knowledge/record-service.integration.test.ts`; modify `packages/domain/src/auth.ts`, database schema/new migration, and `apps/web/src/features/settings/access-scopes.ts`.

**Interfaces:** Export `KnowledgeRecord`, `KnowledgeSource`, `KnowledgeMutationInput` and `KnowledgeReceipt` from strict schemas in §4. `createKnowledgeRecordService({db,now}).create(principal: Principal, input: KnowledgeMutationInput): Promise<KnowledgeReceipt>` and `.get(principal, {id}): Promise<KnowledgeRecord>`. Input specifies kind/value/scope/sensitivity/purposes/evidence/mutationKey; actor/source classification is server-derived.

- [ ] Write `records_user_fact_and_rejects_forged_source` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(saved.record.status).toBe('active');
expect(replayed.receiptId).toBe(saved.receiptId);
expect(otherOwnerRead.status).toBe(404);
expect(forgedSignedSmsSource.status).toBe(403);
```

- [ ] Run `pnpm exec vitest run apps/api/src/knowledge/record-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Implement records/revisions/source ownership, 8 KiB/20-source/20-relationship limits and opt-in read/write scopes. Add wrong-scope, oversized payload, cross-owner relation, key reuse with changed payload, and owner deletion tests. Existing credentials must remain unchanged; unsourced agent observations become proposed inference.
- [ ] Run `pnpm exec vitest run apps/api/src/knowledge/record-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: persist scoped knowledge with source provenance`.

### S2: Knowledge correction, conflicts and controlled learning

**Dependencies:** S1.

**Files:** Create `apps/api/src/knowledge/lifecycle-service.ts`, `apps/api/src/knowledge/promotion-policy.ts`, `apps/api/src/knowledge/lifecycle-service.integration.test.ts`; modify `packages/domain/src/knowledge.ts` and database schema/new migration.

**Interfaces:** `mutateKnowledge(principal: Principal, input: KnowledgeLifecycleInput): Promise<KnowledgeReceipt>`; input discriminates revise/dispute/promote/supersede/restrict/delete, with recordId, expectedRevision, mutationKey and action-specific fields. `evaluateKnowledgePromotion(input: PresentationPreferenceEvidence): PromotionDecision` consumes unique source IDs, user selections/dates, current contradiction state and owner setting.

- [ ] Write `concurrent_corrections_preserve_conflict_and_deduplicate_evidence` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(staleRevision.status).toBe(409);
expect(conflictingFacts.conflictIds).toHaveLength(2);
expect(threeCopiesOfOneSelection.promote).toBe(false);
expect(threeDistinctEligibleDates.promote).toBe(true);
expect(financialInference.promote).toBe(false);
```

- [ ] Run `pnpm exec vitest run apps/api/src/knowledge/lifecycle-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Implement immutable revision history, conflict grouping and explicit resolution. Enforce exact safe-promotion category/three dates/30-day window from §4; agent inference cannot promote sensitive financial assumptions. Include source removal, revoked author retention, no delete-content leakage through history, related-goal cycle rejection, and unchanged policy authority tests.
- [ ] Run `pnpm exec vitest run apps/api/src/knowledge/lifecycle-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: add knowledge lifecycle and evidenced promotion`.

### S3: Bounded context retrieval and public knowledge tools

**Dependencies:** S1–S2.

**Files:** Create `apps/api/src/knowledge/context-service.ts`, `apps/api/src/routes/knowledge.ts`, `packages/api-client/src/features/knowledge.ts`, `apps/mcp/src/tools/knowledge.ts`, `integration/workspace-agent/knowledge.integration.test.ts`; modify domain knowledge contract and tool discovery.

**Interfaces:** `getContextForIntent(principal, input: KnowledgeContextQuery): Promise<KnowledgeContextPack>` accepts workspace/purpose/entityRefs/timeWindow/limit as §5. `searchKnowledge(principal, query: KnowledgeSearchQuery): Promise<KnowledgePage>` has cursor/query/kind/scope/status and limit≤50. `explainContext(principal,{contextUseId}): Promise<KnowledgeContextExplanation>` reauthorizes sources. Map lifecycle operations one-to-one to HTTP/client/MCP; expose actual owner-only reasons.

- [ ] Write `agent_b_retrieves_agent_a_fact_without_cross_scope_leak` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(agentBPack.facts.map(x => x.id)).toContain(factId);
expect(tasksOnlyPack.facts.map(x => x.id)).not.toContain(financeFactId);
expect(pack.byteLength).toBeLessThanOrEqual(32768);
expect(afterDeletionExplanation.sources[0].state).toBe('unavailable');
```

- [ ] Run `pnpm exec vitest run integration/workspace-agent/knowledge.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Filter ownership/scopes/purposes before full-text candidate selection, rank deterministically and separate fact/inference/conflict sections. Persist only context-use references. Test stale/disputed required inputs, narrowed scopes on later cursor pages, expiry, wrong-filter cursor, deleted source explanation and malformed tool arguments through normal MCP discovery.
- [ ] Run `pnpm exec vitest run integration/workspace-agent/knowledge.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: expose purpose-bound shared knowledge context`.

### S4: Work references, adapters and durable claims

**Dependencies:** None; reuse existing review projection; no knowledge dependency.

**Files:** Create `packages/domain/src/work.ts`, `apps/api/src/work/claim-service.ts`, `apps/api/src/work/adapters.ts`, `apps/api/src/work/claim-service.integration.test.ts`; modify `apps/api/src/agent-access-work-items.ts` only to share readers/references, and database schema/new migration.

**Interfaces:** Export `WorkRef`, `WorkVersion`, `WorkClaim`, `WorkDisposition` from §§2–3. `WorkAdapter.inspect(principal, ref): Promise<WorkSnapshot>` and `.validateDisposition(tx, principal, input): Promise<WorkResult>`. `claimWork(principal,{work,expectedRevision,mutationKey}): Promise<WorkClaim>`; renew/release use claimId/fence/expectedRevision. `assertWorkFence(tx, principal, claim): Promise<void>` is called inside domain commits.

- [ ] Write `one_live_claim_and_no_replay_after_expiry` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(claimRace.filter(x => x.status === 'claimed')).toHaveLength(1);
expect(lease.expiresAtMs - clock.now()).toBe(300000);
expect(staleFence.status).toBe(409);
expect(receiptsForWork).toHaveLength(1);
```

- [ ] Run `pnpm exec vitest run apps/api/src/work/claim-service.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Implement 5-minute fenced claims, fixed lock ordering, current grant checks and native-receipt references. Keep uncertain effects non-replayable. Test expiry/renewal race, process loss after accepted effect, manual resolution during claim, duplicate disposition, wrong owner and cancelled/revoked holder. Do not duplicate native question or answer rows.
- [ ] Run `pnpm exec vitest run apps/api/src/work/claim-service.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: coordinate native work with durable fenced claims`.

### S5: Discovery and Finance resumption without a host requirement

**Dependencies:** S4; S3 supplies optional context but missing knowledge does not block discovery.

**Files:** Create `apps/api/src/work/discovery-service.ts`, `apps/api/src/work/finance-adapter.ts`, `apps/api/src/routes/work.ts`, `packages/api-client/src/features/work.ts`, `apps/mcp/src/tools/work.ts`, `integration/workspace-agent/work-resumption.integration.test.ts`; modify `apps/api/src/finance/host-run-authority.ts`, `apps/api/src/finance/maintenance-service.ts` and `apps/api/src/finance-host-dispatcher.ts` for explicit tagged generic authority/owner transfer.

**Interfaces:** `listWork(principal, query: WorkPageQuery): Promise<WorkPage>`; `getWork(principal,{ref}): Promise<WorkSnapshot>`; `recordWorkResult(principal,{claimId,fence,expectedRevision,disposition,receiptRefs,mutationKey}): Promise<WorkResult>`. `transferWaitingFinanceWork(principal,{work,expectedRevision,targetConnectionId,mutationKey}): Promise<WorkResult>` is owner-only and rejects submitted/uncertain dispatch. Existing host continuation method remains schedule-bound.

- [ ] Write `fresh_authorized_session_resumes_generic_work_and_preserves_host_fence` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(genericResume.outcome).toBe('completed');
expect(otherConnectionLegacyResume.status).toBe(403);
expect(transferSubmitted.status).toBe(409);
expect(cursorReadAfterRevocation.status).toBe(403);
```

- [ ] Run `pnpm exec vitest run integration/workspace-agent/work-resumption.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Wire bounded native adapters and 15-minute actor/filter-bound cursors; keep existing review list contract intact. Add tagged generic authority and exact owner transfer only for undispatched work. Test source failure≠empty list, new work after snapshot, read-only claim denial, late old-host fire rejection, no-schedule retrieval and native accepted-answer receipts after restart.
- [ ] Run `pnpm exec vitest run integration/workspace-agent/work-resumption.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: expose durable work discovery and safe Finance resumption`.

### S6: Knowledge controls, goals and migration

**Dependencies:** S2–S3; F3 consumes goal links and reservations independently.

**Files:** Create `apps/web/src/features/knowledge/page.tsx`, `apps/web/src/features/knowledge/page.test.tsx`, `apps/api/src/knowledge/migration-service.ts`, `apps/api/src/knowledge/migration-service.integration.test.ts`, `e2e/knowledge.spec.ts`; modify `packages/domain/src/goals.ts`, `apps/api/src/goals-service.ts`, settings/navigation composition and database schema/new migration.

**Interfaces:** `exportKnowledge(principal,{cursor,limit}): Promise<KnowledgeExportPage>` returns versioned schemas/records/history/relations with current permissions. `migrateKnowledgeSource(principal,{sourceRef,expectedSourceRevision,mutationKey}): Promise<KnowledgeReceipt>` imports explicit proposed observation. Extend canonical goal with parentGoalId/horizon/priority/measure/reviewCadence and typed owned workspace links, not duplicate goal objects.

- [ ] Write `user_corrects_restricts_exports_and_deletes_knowledge` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(importTwice.recordId).toBe(importOnce.recordId);
expect(importedProfile.status).toBe('proposed');
expect(exportAfterDelete.records.some(x => x.id === deletedId)).toBe(false);
expect(goalCycle.status).toBe(409);
```

- [ ] Run `pnpm exec vitest run apps/api/src/knowledge/migration-service.integration.test.ts apps/web/src/features/knowledge/page.test.tsx`; confirm the new assertion fails for the intended missing behavior.
- [ ] Build About you and contextual source/history/conflict controls; owner settings govern learning, promotion and cross-workspace use by category. Add idempotent explicit migration and bounded export; preserve native notes/policy. Cover keyboard/mobile, revoked scope during export, restriction invalidating context, source deletion, errors via Sonner and silent successful autosaves.
- [ ] Run `pnpm exec vitest run apps/api/src/knowledge/migration-service.integration.test.ts apps/web/src/features/knowledge/page.test.tsx` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: add inspectable knowledge controls and source migration`.

### S7: Optional authenticated work-event subscriptions

**Dependencies:** S4–S5; polling journey must pass first.

**Files:** Create `packages/domain/src/work-events.ts`, `apps/api/src/work/event-service.ts`, `apps/api/src/work/event-dispatcher.ts`, `apps/api/src/work/event-dispatcher.integration.test.ts`, `apps/api/src/routes/work-events.ts`; modify database schema/new migration, `apps/api/src/main.ts` lifecycle, client work feature and agent-access settings.

**Interfaces:** `createWorkSubscription(principal,{endpoint,mutationKey}): Promise<PendingSubscription>`; `verifyWorkSubscription(principal,{id,expectedRevision,mutationKey}): Promise<WorkSubscription>`; rotate/revoke owner-only. `publishWorkEvent(tx,{ownerId,work,revision,type}): Promise<void>`; `runWorkEventPage({limit: number}): Promise<DispatchSummary>` with maximum page25. Export subscriber verification format from §11.

- [ ] Write `events_are_minimal_retry_bounded_and_cannot_target_private_networks` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(eventBodyBytes).toBeLessThanOrEqual(4096);
expect(privateAddressAttempt.networkCalls).toBe(0);
expect(redirectAttempt.followed).toBe(false);
expect(expiredDelivery.status).toBe('failed');
expect(revokedSubscription.newSubmissions).toBe(0);
```

- [ ] Run `pnpm exec vitest run apps/api/src/work/event-dispatcher.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Implement transactional outbox and exact §11 challenge/signing/rotation/timeout/retry/retention limits. The server performs and validates the endpoint challenge; a caller-supplied echoed token cannot mark an endpoint verified. Validate DNS on every attempt, pin vetted address and TLS hostname, no redirects. Test rebinding, IPv6/mapped addresses, clock skew, duplicate event, failure after submission, key rotation/revocation, body redaction and lifecycle drain. Record configured/authorized/reachable evidence separately; do not activate a production subscription in tests.
- [ ] Run `pnpm exec vitest run apps/api/src/work/event-dispatcher.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `feat: add optional authenticated work events`.

### S8: Shared toolkit composition and acceptance

**Dependencies:** S1–S6 required; S7 separately gated optional deployment.

**Files:** Create `integration/workspace-agent/shared-toolkit.integration.test.ts`; modify `apps/api/src/finance-playbook-service.ts`, `packages/domain/src/finance/workflow-contracts.ts`, existing MCP discovery/catalog tests, `docs/product/user-knowledge.md`, `docs/architecture/0005-user-knowledge.md` and agent tool evidence docs.

**Interfaces:** Produce one actual-registration capability projection consumed by existing orientation/playbook responses; attach knowledge contracts, context-use refs and `WorkRef` values. Existing public discovery names remain unchanged; new operations use only new current product names, no compatibility aliases.

- [ ] Write `knowledge_and_answer_survive_fresh_session_without_host_registration` with the scenario and decisive assertions below, plus the negative cases named in this task.

```ts
expect(freshSession.knowledgeIds).toContain(savedFactId);
expect(freshSession.answerReceiptId).toBe(originalAnswerReceiptId);
expect(freshSession.requiredHost).toBeNull();
expect(unregisteredCapability.available).toBe(false);
```

- [ ] Run `pnpm exec vitest run integration/workspace-agent/shared-toolkit.integration.test.ts`; confirm the new assertion fails for the intended missing behavior.
- [ ] Exercise two credentials on one account, isolated second account, revoked origin credential, fresh-session answer pickup, knowledge correction and manual-resolution race using real MCP/API/database composition. Run `pnpm exec playwright test e2e/knowledge.spec.ts` for desktop/mobile projects, then required full verification. Update source readiness only; retain production evidence gaps.
- [ ] Run `pnpm exec vitest run integration/workspace-agent/shared-toolkit.integration.test.ts` again; expect all selected tests to pass. Recheck public schemas and native receipt state where the effect crosses a service boundary.
- [ ] Update the owning docs/capability inventory and commit this tested slice as `test: prove shared toolkit cross-session acceptance`.

## Completion gate

- [ ] Run `git diff --check`, focused contract/integration tests and `pnpm verify`; retain actual results.
- [ ] Reconcile each task with its linked spec requirement, record external evidence gaps and preserve all failed/pending states.
- [ ] Verify upgrade, deletion, revocation and rollback readability before marking the subsystem complete.
