# Finance Subscription Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Existing owners retain execution; parent is manager-only.

**Goal:** Process focused incoming texts with the existing subscription host while retaining scheduled maintenance.

**Architecture:** nohmi owns durable wake records, claims and authority; an adapter owns provider protocol. Typed reasons distinguish exact answers, free-form conversation, maintenance and material attention.

**Tech Stack:** Existing TypeScript/pnpm API, domain, connectors, typed clients and MCP; current persistence and Texting.

**Spec:** ../specs/2026-11-01-finance-subscription-agent-design.md (approved).

## Global Constraints

Inherit all constraints from 2026-11-01-finance-subscription-agent.md. No paid-model fallback, no duplicate host/writer, no guessed financial decision, no new runtime or unallocated heavy tests. Proposed exports below are new contracts, not claims about shipped APIs. Existing exports/paths were supplied by retained owners at main307fa783; revalidate against accepted current main at execution without duplicating prior reviews.

## Review Focus

- Lost provider response leaves uncertain dispatch rather than a blind retry (C2).
- Stale answer and general text have distinct admission (C3).
- Scheduled/event races do not duplicate domain effects (C2/C3).
- Exhausted allowance never selects a paid API (C4).
- Token presence and session start never imply completed conversation (C1/C4).

---
## C1: Combined registration and subscription-provider adapter

**Owner:** retained Agent parity integration worker.
**Existing files:** `packages/domain/src/automation-host-continuation.ts`,
`apps/api/src/automation-host-service.ts`, `apps/api/src/automation-host-grant.ts`,
`apps/api/src/finance-host-dispatcher.ts`.
**Create proposed:** `packages/connectors/src/subscription-host.ts`,
`packages/connectors/src/claude-subscription-host.ts`, adjacent `.test.ts`.
**Existing tests:** `apps/api/src/automation-host-service.integration.test.ts`,
`apps/api/src/routes/automation-hosts.test.ts`,
`apps/api/src/finance/automation-registration.integration.test.ts`.

**Existing interfaces:** `createAutomationHostService({db,now,encryptionKey})`
provides create/bind/update/observe/saveFireToken; `activeHostConnectionGrant(now)`;
`createFinanceHostDispatcher({db,now,encryptionKey,fetch,log?})` returns a dispatcher
with `{processed}`. Provider transport is currently inline.
**Proposed interface:** `SubscriptionHostAdapter.invoke(input: { routineId: string; credential: string; references: { scheduleId: string; wakeId: string } }, signal: AbortSignal): Promise<{state:'accepted';sessionId:string}|{state:'rejected';retryAfterSeconds?:number}|{state:'uncertain'}>`.
API owns claim/authority; adapter cannot execute financial effects or choose a paid fallback.

- [ ] Add failing adapter tests for accepted session, definite rejection, rate limit with retry hint and ambiguous timeout. Assert no credential appears in errors/logs. Assert adapter never calls a metered-model endpoint.
- [ ] Run `pnpm exec vitest run packages/connectors/src/claude-subscription-host.test.ts --maxWorkers=1 --bail=1` in the allocated environment; observe expected behavioral failure.
- [ ] Extract provider protocol into the adapter, using existing injected fetch and encrypted credentials. Extend trigger capability to support schedule plus event, retaining original schedule/connection/routine identity and local08/20 health. No SQL migration is assumed: existing encryptedFireCredentials and trigger JSON appear sufficient.
- [ ] Add integration tests for existing scheduled-host adoption, scheduled-only fallback, version-checked credential rotation, revocation and identity preservation with pending continuations.
- [ ] Run named adapter and three existing integration tests plus affected types. Review/commit `feat: support subscription host event capability`; no live credential enrollment in this task.

## C2: Durable wake admission and exactly-once domain effects

**Owner:** same integration worker, shared persistence changes require Speed reservation.
**Existing files:** `apps/api/src/finance-host-dispatcher.ts`,
`apps/api/src/finance/continuation-reconciliation.ts`,
`apps/api/src/finance/sms-context-dispatcher.ts`.
**Create proposed:** `packages/domain/src/finance/host-wake.ts`,
`apps/api/src/finance/host-wake-service.ts`, adjacent integration test.
**Existing test consumers:** `apps/api/src/automation-host-service.integration.test.ts`,
`apps/api/src/finance/maintenance-service.integration.test.ts`. There is no verified
standalone finance-host-dispatcher integration test; don't invent one as existing.

**Interfaces:** C1 adapter; existing `reconcileFinanceContinuations(db,now,userId?)`.
Proposed `FinanceHostWakeReason = 'scheduled_maintenance' | 'accepted_answer' | 'user_conversation' | 'material_attention'`.
Proposed `enqueueFinanceHostWake(tx,input:{userId:string;scheduleId:string;connectionId:string;reason:FinanceHostWakeReason;sourceId:string;sourceRevision:string;cutoffSequence:string;idempotencyKey:string}):Promise<{wakeId:string;state:'pending'|'existing'}>`.
Persist source revision/cutoff; reuse current durable machinery where it preserves
these invariants. Add storage only if owner assessment demonstrates a gap; reserve
exact schema/journal/app composition before edits. Do not preassign a migration.

- [ ] Add failing tests that duplicate enqueue returns one wake; different owners never share work; scheduled/event race has one claim; later messages remain beyond cutoff; expired/revoked grants cannot dispatch.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/host-wake-service.integration.test.ts --maxWorkers=1 --bail=1`; observe behavioral failure.
- [ ] Implement durable typed admission, atomic claim and submitting-before-provider-call. Store accepted session identity, definite rejection/backoff or uncertain outcome. No refire from uncertain without reconciled evidence.
- [ ] Test crash after claim, crash after submitting, accepted response loss,429, provider unavailability and duplicate external session. Domain idempotency must still prevent repeated financial effects if provider execution duplicates.
- [ ] Run new tests plus the two existing consumers and API/domain types; review/commit `feat: admit durable Finance host wake work`.

## C3: Exact answers and general conversation use separate scopes

**Owner:** Agent parity owns routing; Finance supplies domain answer/decision handlers.
**Existing files/tests:** `apps/api/src/finance/sms-context-dispatcher.ts`,
`apps/api/src/finance/conversation-persistence.ts`,
`apps/api/src/finance/conversation-persistence.test.ts`,
`apps/api/src/finance/sms-context-completion.integration.test.ts`.
**Create proposed:** `apps/api/src/finance/conversation-wake-routing.ts`, `.test.ts`.

**Interface:** `routeFinanceWake(input:{messageId:string;questionId:string|null;questionRevision:string|null;currentQuestionRevision:string|null;explicitMaintenanceRequest:boolean}):{reason:FinanceHostWakeReason;scope:'answer'|'conversation'|'maintenance';needsClarification:boolean}`.
Authenticated user identity and source revisions are resolved server-side by the
existing admission service, not accepted from untrusted text. Exact matching reply
uses accepted_answer only after domain acceptance; otherwise preserve it as user
conversation/clarification. Explicit maintenance request remains authority-gated.

- [ ] Add failing tests: exact current answer selects answer; stale reply asks and cannot mutate; free-form text selects conversation; unrelated yes cannot approve; explicit maintenance request alone selects maintenance scope but does not grant permission.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/conversation-wake-routing.test.ts --maxWorkers=1 --bail=1` and observe failure.
- [ ] Wire routing to C2 and canonical conversation capture. Agent loads bounded context through MCP and returns actual domain outcome. Do not run broad reconciliation from ordinary event text. Keep provider payload minimal and treat raw SMS as untrusted input.
- [ ] Test burst corrections before/after cutoff, tenant/recipient changes, expired questions and two independent questions. Prove every admitted message is processed or remains explicitly pending.
- [ ] Run routing, persistence and SMS completion tests plus affected API/MCP/client types; review/commit `feat: route focused Finance text conversations`.

## C4: Canonical readiness, allowance delays and notification evidence

**Owner:** integration worker writes; existing Finance texting owner accepts.
**Existing files:** `apps/api/src/finance/conversation-persistence.ts`,
`apps/api/src/finance/execution-proof.ts`, `apps/api/src/routes/finance-conversation.ts`,
`apps/api/src/finance-notification-runtime.ts`, `apps/api/src/notification-service.ts`,
`apps/api/src/routes/notifications.ts`.
**Existing interfaces:** `createFinanceConversationService({db,now?}).getReadiness(userId)`
and `.getHostReadiness(userId,scheduleId)`; `getCurrentFinanceExecutionProof`;
notification service publish/claim/deliver/drain/status.
**Proposed projection:** `FinanceConversationAvailability` separates registered,
chatReady,eventCapable,textingReady,executionPending,allowanceDelayed and uncertain
states with factual reasons. No blanket ready boolean from token/heartbeat.

- [ ] Add failing tests in existing conversation-persistence and notification integration tests: valid credential but no execution proof is not consumed; provider acceptance is not financial success; allowance exhaustion leaves pending work; no alternative billed endpoint is called.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/conversation-persistence.test.ts apps/api/src/finance/notification-composition.integration.test.ts apps/api/src/notification-service.integration.test.ts apps/api/src/finance-notification-runtime.integration.test.ts --maxWorkers=1 --bail=1`; observe new failures only.
- [ ] Replace hardcoded setup readiness with canonical evidence projection or explicit unverified status. Persist delay/recovery state, do not discard messages or promise immediate delivery.
- [ ] Correlate current work/revision→notification intent→effective preferences/recipient/consent→attempt coverage→message submission/delivery. Missing authorized history access is a specific acceptance dependency, not evidence of no send. Use supported surface only.
- [ ] Test quiet-hour release, STOP, stale recipient, uncertain send, expired work and recovery after allowance reset. Do not automatically retry ambiguous fires/sends.
- [ ] Run focused tests/types, independent review and commit `feat: expose truthful Finance conversation readiness`.

## Verification entrypoints and scope

Owner verified `pnpm exec vitest run <explicit paths> --maxWorkers=1 --bail=1`
and `pnpm --filter @personal-os/api run typecheck`. Final allocated `pnpm verify`
or hosted `pnpm check:node` are broader release gates, not instructions to start
heavy local checks. Reuse actually logged coverage rather than rerunning equivalent
focused suites. Extend domain/client/MCP/Web typechecks when their contracts change.

## Self-review

C1 defines the adapter and combined identity; C2 defines the wake union used by C3;
C3 does not convert arbitrary text into accepted financial answers; C4 separates
connection from actual consumption. All five review-focus failures map to tests.
Live credentials and user onboarding are A4/A5, not secretly performed by C1–C4.
