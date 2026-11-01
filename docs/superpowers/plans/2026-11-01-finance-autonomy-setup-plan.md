# Finance Autonomy and Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Retain existing owners; do not spawn replacement writers.

**Goal:** Make autonomy consistent, learning contextual, attention personalized, and setup verifiable.

**Architecture:** Shared policy governs domain effects; Memory owns learned context; Finance evaluates material impact; Texting delivers typed attention. Guided setup composes provider capabilities and actual readiness.

**Tech Stack:** Existing TypeScript/pnpm domain and API packages, web UI, durable persistence and hosted verification.

**Spec:** ../specs/2026-11-01-finance-subscription-agent-design.md, approved November 1.

## Global Constraints

All constraints and verification/resource rules in 2026-11-01-finance-subscription-agent.md apply. New paths and signatures below are proposed planning interfaces, not claims of shipped exports. Reuse equivalent existing abstractions confirmed by the retained owner; do not create duplicate stores. Preserve 8 a.m./8 p.m. local maintenance, no paid-model fallback, current permission/consent/original-host enforcement and no unsolicited production tests. Independent review and isolated commit end each task.

## Review Focus

- OFF-mode memory must not authorize financial mutations (A1/A2).
- Similar transactions with different purposes must not inherit a wrong rule (A2).
- Digest nonresponse must not approve anything (A3).
- Partial setup and rotation must not duplicate hosts or expose credentials (A4).
- Successful host start must not be reported as financial completion (A5).

---
## A1: Consistent approval mode, separate from permission breadth

**Owner:** existing Agent parity/shared execution-policy owner with Finance consumer.
**Files:** Modify `packages/domain/src/execution-policy.ts`, `packages/domain/src/execution-policy.test.ts`,
`apps/api/src/execution-policy-service.ts`, `apps/api/src/finance-action-service.ts`,
`apps/web/src/features/settings/execution-policy.tsx`; add proposed
`packages/domain/src/finance-action-decision.ts` and `.test.ts` only if the policy
owner confirms a separate classifier is needed. Integrate every Finance mutation
entrypoint via the existing central execution boundary, not only batch UI.

**Proposed interface:** `decideFinanceAction(input: { permitted: boolean; mutation: boolean; bypass: boolean; information: 'sufficient' | 'missing' | 'conflicting' }): 'deny' | 'ask' | 'propose' | 'execute'`.
Permission failure wins; missing/conflicting information asks; a read executes when
permitted and sufficiently grounded; mutation with bypass OFF proposes, ON executes.
Domain validation and current authority are still checked at execution, including
explicitly excluded operations. This classifier cannot mint approval or grants.

- [ ] Add failing table-driven tests for the decision matrix: `expect(decideFinanceAction({permitted:true,mutation:true,bypass:false,information:'sufficient'})).toBe('propose')`; corresponding ON expects execute, missing/conflicting expects ask, denied expects deny.
- [ ] Run the domain focused test using the retained owner's supported runner; assert failure on the policy behavior rather than missing dependencies.
- [ ] Implement the classifier/central gate and apply it to every Finance mutation producer. Retain original authority checks and fail closed for an unclassified mutation. Inventory bypass gaps in direct writers in the review receipt.
- [ ] Add tests that permission revocation between proposal and execution denies the effect, and an unrelated/stale yes does not approve it. Add a UI test proving permission breadth and review mode are separate controls.
- [ ] Run focused domain/API consumers and web tests plus affected package types; require PASS. Independently review the exact candidate and commit `feat: make Finance approval mode consistent`.

## A2: Contextual answer memory without implicit authority

**Owner:** existing Memory owner writes knowledge lifecycle; Finance owner consumes it.
**Files:** Consume existing Memory/UserKnowledge lifecycle rather than creating a
second memory store. Proposed Finance consumer modules:
`apps/api/src/finance/contextual-answer-policy.ts` and `.test.ts`.

**Proposed interface:** `assessAnswerReuse(input: { candidateId: string; sourceAnswerId: string; scopeMatches: boolean; current: boolean; contradictions: readonly string[]; authorityChange: boolean }): { disposition: 'use_context' | 'ask' | 'reject'; reason: string }`.
This is the boundary after Memory retrieval, not a model confidence score. Memory
owns persisted answer/context/provenance/version/supersession; Finance records the
knowledge revision used in an action. Explicit preferences may be remembered in
both modes; inferred broad policies cannot become standing authorization.

- [ ] Add failing tests: same-purpose matching reimbursement returns use_context; same sender with different purpose returns ask; newer contradiction returns ask; revoked/superseded candidate returns reject; authorityChange returns reject.
- [ ] Run the new focused test and observe behavioral failure.
- [ ] Implement Finance applicability checking using Memory's adopted provenance/lifecycle contract. Ask the existing Memory owner to return the exact consumer export before wiring; do not add Finance-owned storage as a workaround.
- [ ] Test that learning with bypass OFF saves the answer but financial effects remain proposals; a correction supersedes prior context and flags dependent actions for assessment without silently rewriting history.
- [ ] Run focused Memory contract/Finance consumer tests and API types through allocated verification. Review and commit `feat: reuse Finance answers with contextual evidence`.

## A3: Personalized attention and confirmation digests

**Owner:** Finance owns assessment; existing Texting owner owns delivery/policy.
**Files:** Proposed `apps/api/src/finance/material-attention.ts`, `.test.ts`,
`apps/api/src/finance/confirmation-digest.ts`, `.test.ts`; connect to existing
`apps/api/src/finance-notification-runtime.ts` through its retained owner.

**Proposed interfaces:**
- `assessFinanceAttention(input: { factsTrusted: boolean; needsAnswer: boolean; actionDueBeforeDigest: boolean; personalizedBudgetImpact: 'material' | 'not_material' | 'uncertain'; evidenceRefs: readonly string[] }): { route: 'question' | 'material_alert' | 'reliability_alert' | 'digest'; reason: string }`.
- `buildFinanceDigest(input: { periodStart: string; periodEnd: string; actionReceipts: readonly { id: string; outcome: string; reason: string }[] }): { receiptIds: readonly string[]; summaryItems: readonly string[] }`.
Personalized assessment uses actual remaining category room, timing/payday,
obligations, goals and preferences. No universal dollar cutoff. Uncertain action
asks before execution; untrusted facts cannot support a confident spending claim.

- [ ] Add failing tests: small expense near exhausted essential category warrants attention; a large already-funded planned expense can remain in digest; imminent shortfall routes material_alert; uncertain classification routes question; stale totals route reliability_alert rather than overspending claim.
- [ ] Run focused tests and observe behavioral failures.
- [ ] Implement assessment and receipt-based digest projection; use existing durable notification intent/attempt semantics rather than direct duplicate sending.
- [ ] Test monthly local-time boundaries and DST, related-alert coalescing, unchanged-warning suppression, quiet-hour deferral with later revalidation, STOP/revocation, and uncertain sends that cannot be retried blindly. Digest silence must create no approval, financial effect or knowledge confirmation.
- [ ] Ship monthly default and explicit fortnightly preference; volume-based cadence is a later disclosed preference, not a hidden threshold. No new production schedule until supported setup authorization.
- [ ] Run focused API/Texting contract tests and types, independently review and commit `feat: add contextual Finance attention and digests`.

## A4: Guided subscription setup and capability readiness

**Owner:** existing Agent parity integration/UI owner; Finance texting owner accepts.
**Files:** Existing settings UI `apps/web/src/features/settings/execution-policy.tsx`
for autonomy; host registration/service and typed client/MCP paths supplied by the
Conversation plan. Existing UI integration points are
`apps/web/src/features/finances/automations-page.tsx`, `automation-registration.tsx`,
`automation-verification.tsx`, and `automation-recovery.ts` in that directory.
Reuse these rather than create a second onboarding route. Proposed new page component
`apps/web/src/features/settings/finance-agent-setup.tsx` and `.test.tsx` after route
owner confirms integration. Create user docs `docs/guides/finance-agent-setup.md`
and `docs/guides/finance-agent-troubleshooting.md` from approved draft.

**Proposed view model:** `FinanceAgentSetupState` with provider, existingHostId,
capabilities, scheduleTimes, timezone, reviewMode, and separate statuses for
registration, connectorAccess, chatReadiness, scheduleReadiness, eventReadiness,
textingReadiness, realConversationAcceptance. Never derive all-ready from a token.
No secret fields enter normal view-model serialization or telemetry.

- [ ] Add failing component tests for existing-routine adoption, partial setup, unsupported event capability showing scheduled-only, and secret fields excluded from rendered state/errors/telemetry.
- [ ] Run component tests in the existing supported web environment and observe behavioral failure.
- [ ] Implement provider-neutral steps with Claude-specific supported enrollment instructions. Preserve routine identity and pending answers; secure credential enrollment/rotation stays within existing secret storage conventions.
- [ ] Test expired grant, revoked credential, account switch, duplicate click, paused setup and disconnect with already-submitted work. No duplicate registration or false cancellation confirmation.
- [ ] Document allowance consumption, no paid fallback, separate costs, consent/quiet hours, setup verification, troubleshooting, disconnect and credential rotation. Verify actual released labels/screens before publication; exclude secrets from screenshots.
- [ ] Run focused UI/host-service tests and types; independently review and commit `feat: guide subscription-backed Finance agent setup`.

## A5: End-to-end acceptance and staged rollout

**Owner:** existing Finance texting/Claude acceptance owner, Finance orchestrator
acceptance; technical fixes returned to their existing owners.
**Files:** Create evidence document `docs/engineering/finance-subscription-acceptance.md`
with sanitized receipts only; use existing integration test locations confirmed by
owners rather than placing live credentials in test fixtures.

**Interface:** acceptance receipt contains candidate/release identity, scenario,
permission mode, bounded work/receipt references, actual tool outcome, notification
transport state, timing, subscription billing basis and residual gaps. Never include
secret values or unnecessary personal transaction contents.

- [ ] In isolated fixture tests prove the complete same-owner chain and failure cases from C1–C4/A1–A4 before requesting live enrollment.
- [ ] At explicit supported user enrollment, confirm actual provider eligibility and protected same-routine event setup. Preserve 08/20 local maintenance. Do not perform this step under planning-only authority.
- [ ] Observe a genuine scoped question/answer after the original agent session ended: inbound persistence, eligible wake, original-host fetch, decision, actual domain receipt, contextual reply. Verify externally visible result independently.
- [ ] Observe a natural maintenance run making eligible progress while one ambiguous item stays pending; measure actual consumed contract rather than only host completion.
- [ ] Record normal reply latency and slow/delayed cases plus subscription usage. Proposed pilot target is most ordinary replies within two minutes; do not market this as guaranteed or claim a pass without measurements.
- [ ] Exercise opt-out/revocation/allowance-exhaustion recovery with authorized fixtures; no paid API fallback, duplicate effects or silently lost work. Keep human receipt distinct from provider handoff/delivery.
- [ ] Review sanitized evidence against every master-plan outcome. Roll out only verified capabilities, leaving unsupported providers and incomplete scenarios explicit. Commit the acceptance documentation separately from code.

## Self-review

A1 covers policy parity and permission isolation; A2 covers contextual learning and
correction; A3 covers personalized impact/digest/quiet hours; A4 covers setup,
capability truth and credential lifecycle; A5 covers actual original-host outcomes
and subscription claims. All proposed types are local planning contracts, not
assertions about current exports. Production tests require their stated authority.

## Exact focused verification commands

Run only in an existing allocated environment with supported dependencies. These
are plan commands, not claims of execution. Newly proposed tests exist only after
their task implements them. Reuse an accepted hosted run that already covers them.

- A1: `pnpm exec vitest run packages/domain/src/execution-policy.test.ts apps/api/src/execution-policy-service.integration.test.ts apps/api/src/finance-action-service.integration.test.ts --maxWorkers=1 --bail=1`; include the proposed classifier test if a module is added.
- A2: `pnpm exec vitest run apps/api/src/finance/contextual-answer-policy.test.ts apps/api/src/finance/contextual-question-service.integration.test.ts apps/api/src/finance/context-service.integration.test.ts apps/api/src/finance/conversation-service.integration.test.ts --maxWorkers=1 --bail=1`.
- A3: `pnpm exec vitest run apps/api/src/finance/material-attention.test.ts apps/api/src/finance/confirmation-digest.test.ts apps/api/src/finance/notification-composition.integration.test.ts apps/api/src/notification-service.integration.test.ts apps/api/src/finance-notification-runtime.integration.test.ts apps/web/src/features/notifications/finance-preferences.test.tsx --maxWorkers=1 --bail=1`.
- A4: `pnpm exec vitest run apps/web/src/features/finances/automations-page.test.tsx apps/web/src/features/finances/automation-registration.test.tsx apps/api/src/automation-host-service.integration.test.ts apps/api/src/finance/conversation-persistence.test.ts --maxWorkers=1 --bail=1`; add proposed setup component test if a separate component is created.
- API/domain types: `pnpm --filter @personal-os/domain --filter @personal-os/api typecheck`. Changed web/client/MCP consumers also require their repository-declared typecheck gates, collected by the existing owner.

Each red phase must fail on the new behavior, each green phase must PASS with no
unexpected test failures. Final required checks remain subject to Speed's runner
allocation; never treat a dependency install failure as a failed feature test.
