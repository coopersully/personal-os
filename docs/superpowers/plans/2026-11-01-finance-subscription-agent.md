# Finance Subscription Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Cooper has already selected execution by existing owners; these skills do not authorize replacing owners or adding competing writers. The Finance parent remains manager-only.

**Goal:** Deliver subscription-backed daily Finance maintenance and focused text conversations, with trustworthy financial actions, contextual learning and documented user setup.

**Architecture:** nohmi stores financial truth, conversation, knowledge, policy and durable work. Provider adapters invoke subscription-backed agents; scheduled and event runs share authority and idempotency while having different scopes. Claude is the first adapter, with no silent paid-model fallback.

**Tech Stack:** Existing TypeScript/pnpm domain, API, web and connector packages; existing MCP, Texting, persistence and hosted verification. No new runtime or replacement agent service is assumed.

**Spec:** ../specs/2026-11-01-finance-subscription-agent-design.md (approved November 1). User setup copy: ../specs/2026-11-01-finance-agent-setup-guide-draft.md.

## Global Constraints

- Hybrid operation: one or two broad maintenance runs each day plus focused event responses. Preserve the existing 8 a.m./8 p.m. local routine during delivery.
- Bypass on: perform confident authorized work without asking for approval. Bypass off: propose changes for review. Ask clarification in either mode when uncertain.
- Remember answers automatically and reuse them only when their circumstances apply.
- Routine actions appear in a monthly confirmation digest; potentially fortnightly when volume grows. Important changes and useful budget guidance are timely.
- Do not require or silently fall back to separately metered model API billing.
- Existing provider subscription limits, consent, original-host authority and permission breadth remain enforced.
- Existing owners implement. Speed coordinates shared migrations/resources; accepted predecessors and exact path reservations govern dependent edits, not a blanket whole-parity hold.
- No new financial mutation, test SMS, manual routine run, credential enrollment, bank reconnect or schedule change is authorized merely by this plan. Use explicit supported setup/acceptance authorization at the applicable gate.
- No money movement, direct financial API/DB bypass, historical batch replay, destructive reset or force push. Completed Amazon Health and Instacart batches remain completed.
- Source implemented, source reviewed, tests passed, merged, deployed, consumed by original host and user-visible acceptance are separate states.
- The original orchestration workspace has no Git metadata. These documents are adopted into an authorized isolated repository checkout; do not initialize a replacement repository in the original workspace.

## Review Focus

1. A late answer arrives after the question changed: preserve the text, reject stale effects, clarify the current target (Conversation C3).
2. A schedule and event race for the same transaction: one domain effect and one contextual outcome, no repeated financial mutation (Conversation C2; Finance F2).
3. Provider accepted invocation but response was lost: leave uncertain dispatch, reconcile before retry; never charge a paid fallback (Conversation C2).
4. A remembered answer resembles a new case but differs in purpose: ask, preserve provenance, never promote inference into permission (Autonomy A2).
5. User never reads the digest or subscription expires: correctness does not depend on silence-as-approval; work remains durable and delays visible (Autonomy A3; Conversation C4).

---

## Plan structure and ownership

This is a program with independently reviewable subsystem plans. Follow their task
interfaces rather than implementing all stages in one branch.

| Plan | Existing owner | Independently useful result |
|---|---|---|
| 2026-11-01-finance-conversation-plan.md | Agent parity/shared Texting; Finance texting owner accepts | Existing subscription routine can process a scoped real text and return its verified result |
| 2026-11-01-finance-maintenance-plan.md | Finance worker; Plaid recovery/Accounts; Memory dependency owner | Legal maintenance, evidence-preserving review resolution and trustworthy budget preparation |
| 2026-11-01-finance-autonomy-setup-plan.md | Existing domain owners under Finance coordination | Consistent approval behavior, contextual learning, attention/digests and truthful guided setup |

Existing owner references: Finance implementation 01a178f6-6a74-7133-a62a-a5a7cf966cd6;
Texting acceptance 01a18dd8-fef0-7082-9fb8-a778d78792ba;
Plaid recovery 01a1834e-b928-7ae0-a034-266730cefb21;
Agent parity coordinator 01a1786b-7783-7f01-93bf-ab80b491fa85;
Speed coordination 01a16a98-d729-7771-86a5-27fbf7959b1a.
Use these retained assignments, not new chats. Memory implementation remains with
its current verified owner; Finance consumes its contract rather than creating a
parallel knowledge store.

## Task P0: Adopt the approved documentation and lock bounded ownership

**Files:** Adopt these four plan documents plus both approved-design/setup-draft
documents into the same repository-relative docs/superpowers paths in the existing
owner's authorized checkout. Preserve finance-request-checklist.txt in the parent.

**Interfaces:** Consumes approved design; produces an owner/path/dependency matrix
and a versioned documentation commit. No domain/runtime interface is introduced.

- [ ] Existing integration owner checks current main and worktree changes without reset; identifies exact documentation checkout and preserves other owners' edits.
- [ ] Copy design, setup guide and plans; verify links and mark approved design versus planned/unreleased behavior accurately.
- [ ] Record existing owner reservations for each task and accepted prerequisite receipts. If a listed existing path changed on latest main, update the task mapping before implementation; do not blindly create a duplicate module.
- [ ] Commit only the adopted documents with message `docs: plan subscription-backed Finance conversations`.

## Execution order

1. Finish existing corrective releases and the shared dependency prerequisite; do not reimplement reviewed changes. C1/F1 can use source evidence while release gates complete.
2. C1–C4 deliver a first focused question/answer loop. A1 supplies consistent policy before allowing new autonomous mutations. A4 supplies protected enrollment needed for real acceptance.
3. F2–F4 proceed independently where evidence and reservations allow. Historical cleanup need not wait for all conversation features; conversation need not wait for the entire backlog.
4. A2–A3 add contextual reuse, personalized guidance and digest behavior on established financial receipts.
5. A4–A5 finish setup, real workflow acceptance and rollout evidence. Update the checklist only from actual accepted outcomes.

## Release and acceptance rules

- [ ] Each task starts with failing focused behavioral tests for new behavior, then minimal implementation, green focused tests/types, independent review and an isolated commit.
- [ ] Use existing supported dependencies and allocated runner. Never install/borrow dependencies or start heavy suites merely to satisfy this document. Speed allocates supported verification when local execution is unavailable.
- [ ] Before merge: exact candidate/base, current required checks, review receipts and shared ownership ACK. Normal protected merge only, by the authorized owner.
- [ ] Before deployment: applicable release classification and migration adoption verified. COMPLETE_NO_DEPLOY prerequisites stay distinct from runtime release.
- [ ] After deployment: original registered host loads the corrected contracts and produces actual scoped outcomes. Natural scheduled observation is preferred for existing routine acceptance; no manual rerun implied.
- [ ] For financial batches: fresh preview/revision and stable idempotency, supported authorized owner UI execution, independent connector readback. Aggregate counts alone do not authorize action.
- [ ] For provider setup: explicit user enrollment through protected UI, no secrets in docs/chat/logs. Record capability and readiness without storing credential material in receipts.

## Rollback and recovery

Provider registration must retain a safe scheduled-only mode and original identity.
Disable new event dispatch on confirmed malfunction without discarding queued text;
already-submitted/uncertain invocations remain visible. Stop new financial effects
if policy/evidence integrity fails. Preserve audit records; revert source through
normal review, never delete financial history or rewrite applied migrations.
Use explicit compensating financial actions only with applicable authority.

## Completion evidence package

Each owner returns source head/base, files, focused and required check receipts,
review/merge/deployment state, actual acceptance outcomes, remaining limitations and
rollback controls. Parent records a checklist mapping:

| User outcome | Evidence needed |
|---|---|
| Personal and generic duplicate repair | Correct identity/history/balances plus general regression/adoption |
| Transcript diagnosis | Delivered four-run explanation with unknown causes distinguished; already delivered |
| Avoidable blocking fixed | Original routine makes useful eligible progress; blocked items don't halt independent work |
| Actionable texts and replies | Current work → actual notification → accepted reply → domain receipt → contextual response |
| Faster conversation | Supported subscription event invocation, measured latency, no paid fallback |
| Inbox zero and November ready | Exact resolution receipts, independent remaining counts, confirmed budget inputs and applicable approval |
| Ongoing dream state | Contextual learning, consistent autonomy, material alerts, digest and guided user setup all accepted |

## Self-review record

Map design sections to tasks: architecture/subscription C1–C4; two execution paths
C3/F1; authority A1; learning A2; attention/digest A3; setup A4; financial facts and
backlog F2/F3; budget F4; actual acceptance A5. Five review-focus failure modes have
explicit owner tasks. New interfaces in subsystem plans are proposals unless
identified as existing by owner evidence; no live capability is inferred from them.

Cooper approved this implementation plan on November 1 and explicitly authorized
execution through completion by existing owners. No further general plan approval
is required. Parent remains manager-only; exact provider enrollment and financial
operation gates still apply when reached.

## Planning evidence

Retained Agent parity owner provided exact path/interface/test mapping in the
private coordination artifact `finance-approved-design-planning-input-20261101.json`.
That owner retains its provenance; it is not a checked-in repository path.
Finance owner supplied bounded planning report from source5d311c9c/base307fa783.
Neither planning request ran tests or altered product source. New contracts in these
plans are proposals to be implemented behind shared owner boundaries, not fabricated
existing exports. Normal API/domain, connector and UI tests are listed explicitly;
repository-wide suites require existing verification allocation.

## Execution release — November 1

Implementation authorized by Cooper. Existing Agent parity owner assigned P0/C1–C4,
central A1 and A4; Finance assigned F1–F4 and Finance A2/A3; Plaid recovery retains F3;
Texting owner assigned C4/A5 acceptance; Speed retains shared prerequisites and
verification coordination. Dispatch is not implementation or completion evidence.
Proceed at each owner's safe checkpoint; retain exact prerequisites and record
actual task progress in the parent checklist. No new implementation owner created.
