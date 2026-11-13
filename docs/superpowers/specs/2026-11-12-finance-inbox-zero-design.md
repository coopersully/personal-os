# Finance inbox zero and November-first budgeting

Date: 2026-11-12
Status: Detailed design and implementation plan approved by Cooper on November 12, 2026, including verification, deployment, TestFlight and real Finance Chat acceptance. No production changes made by this document.
Tracking: COO-153 — Reconcile Finance review backlog and recover budget approvals (Nohmi).

## Intent and approved direction

Make November 2026 a trustworthy budgeting starting point, then keep each subsequent month maintained through Finance Chat. Cooper supplies only facts, preferences and approvals the system cannot establish. Preserve every historical transaction and its provenance. Separate historical cleanup from the active inbox unless it affects current balances, current-period spending, obligations or allocations. The agent performs investigation and follow-through through production MCP, never browser impersonation or human-composer handoffs.

Inbox zero means zero unresolved decisions requiring Cooper in the active period, not zero rows in the historical ledger. Budget-ready is a separate condition: relevant evidence is complete/current, an exact plan is approved, and no material unresolved current-period dependencies remain. A zero decision count with pending machine work is not budget-ready.

## Approaches

- Delete or blanket-dismiss pre-November work: rejected; destroys meaning, obscures uncertainty and can corrupt opening balances.
- Resolve all history before allowing November: rejected; blocks useful budgeting on unrelated old work.
- Approved approach: November-first activation with preserved historical work, dependency-based promotion and evidence-backed batch resolution. More explicit state is required, but it makes both usable budgeting and honest long-term cleanup possible.

Implementation choices below are proposals, not already shipped behavior or new financial authority.

## Current evidence and gaps

Live production MCP observation on November 12: 2,846 outstanding records comprising 1,578 transaction flags and 1,268 open cases; 34 current-month records and 2,812 historical records. These overlap and are not unique transactions or independent questions. There are 39 mismatched cases; mismatch is not permission to close them. Counts must be refreshed during execution.

Existing source has backlog reads, bounded qualification, durable preview/execute batches, baseline qualification, budget versioning, chat mirrors and notifications. The execute tool is implemented but absent from this connected credential's discovery: its grants include Finance read/write/maintain, not execute. Earlier inspections found stale provider qualification, flag-only pairs that cannot use the review-case transfer decision, and previews scoped to the creating authorization. Revalidate these gaps against deployed source; do not build duplicate endpoints from the older local checkout. Existing November proposal is unapproved; do not equate a balanced proposal with acceptance.

Production source reference: merged Finance Chat delivery 827aeadf; retained reviewed source 4de77f75 in the finance-chat-inbox-zero worktree. Rebase implementation onto current verified main before editing code.

## Requirements

R1. Persist an owner-scoped, versioned activation policy with first budget month 2026-11, the user's default timezone, approval provenance and a reversible history visibility preference. November means local November 1 inclusive; timezone is not editable per transaction. The policy is prospective month-to-month, not a permanent November-only filter.

R2. Preserve original flags, cases, timestamps, evidence and decisions. Historical placement is a work-scope disposition, not resolution, deletion or a claim that historical reports are complete. Historical totals stay inspectable. Unknown dates and dependencies that cannot be ruled out stay in triage; they are never silently historical.

R3. Build one API-owned attention projection: unique actionable decisions, active affected transactions, historical unresolved records, processing work and technical blockers. Keep raw flag/case counts separately labeled. Web, mobile, MCP, status and maintenance consume this projection. Deduplicate only by demonstrable underlying decision/effect, not merchant or amount.

R4. Establish a November opening-position receipt from observed balance anchors and complete intervening ledger evidence; do not infer an opening balance from today's balance if the interval is incomplete. Include cash, debt, investments where relevant, expected income, recurring bills, savings/set-asides and commitments. Distinguish stock (balance) from flow (income/spending) and planned from received income. A vault transfer cannot create extra income or duplicate spend; a credit card repayment cannot double-count the original expense. No zero fallback for unknowns, invented balancing transactions or duplicate account inclusion. Explain and promote exact historical dependencies. Preserve the currently approved older budget.

R5. Resolve November through bounded evidence-backed batches. Extend the decision model for exact transfer pairs even when neither side has a review case. Bind both native transaction IDs, revisions, ownership, currency, posted/pending state, provider evidence and a unique reciprocal relationship. Roundup wording is only a clue. Handle card-payment principal versus fees/interest separately. Equal amounts alone are insufficient; ambiguous competing matches ask a focused question. Ordinary categorization needs its own evidence adapter. Resolve only reasons actually addressed; never indiscriminately clear needsReview.

R6. Refresh/admit evidence through a durable API-owned operation using existing provider sync/admission mechanisms where available. Return accepted/running/completed/blocked/failed, freshness, coverage, authorization and recovery separately. A read-only provider fetch is not a freshness rewrite. Preserve original source facts; verify canonical evidence after completion. Bounded retries, leases, revocation checks and restart reconciliation are mandatory. Reauthentication requires the person, not altered credentials or fabricated freshness.

R7. Every consequential batch has an immutable preview, expected revisions, fingerprint, approval identity/policy, idempotency key and per-item receipt. Use existing max-100 preview and max-10 execute limits unless independently justified. Approval applies to the displayed manifest only. Changed evidence requires a replacement preview. Completed items cannot run twice; independent qualified items can proceed while others are blocked. Treat a lost response as uncertain until receipt reconciliation. Retain a reversible correction/undo path: restore only effects still owned by the batch; later conflicting edits produce a new correction preview. Never roll back bank activity or delete audit history.

R8. Finance Chat is the decision surface. Agent-authored summaries are short (default up to three short sentences plus structured cards), with merchant/date/$amount and tappable native references, expected budget impact, batch approval/change actions and an expandable manifest. Ask one coherent question at a time; do not repeat answered questions. Persist an answer once, bind it to the exact question/manifest and enqueue durable continuation. Acknowledgment is not execution success. Summarize actual applied/remaining/blocked outcomes after reread. Persist rule suggestions separately from one-time answers; only explicit scoped approval activates a versioned rule. Do not infer a permanent rule from one merchant or one answer.

R9. Reuse the existing routine and original connection, cadence, grants and current-instruction bootstrap. A new message/answer must create or reuse durable work independently of an old blocked historical run. Current-period work cannot be starved by that run. One run can retain independent blocked items while progressing eligible ones. Use existing authorized notification delivery for actionable questions, causal replies and material failures; deduplicate unchanged blockers, respect preferences/quiet hours, and avoid transaction details on lock screen by default. Distinguish message persisted, provider accepted, device displayed and link opened. No new recurring Codex automation.

R10. At month rollover, build a proposal from approved rules/allocations and fresh evidence, retaining changed income/bills and explicit carryover policy. Do not automatically approve a new budget without already granted authority. December must work without changing the November policy or re-reviewing all history. Notify only for a meaningful decision or exception; normal successful maintenance is quiet unless requested.

R11. Mobile and web share domain state. Use existing settings rows, domain icons, USD $ formatting, compact labels and native menu/form standards. Yellow values indicate missing attention; red indicates incorrect values. Use Sonner for action outcomes, with one close control and readable Undo/Retry. Persistent configuration and unresolved work are actual state, not inline action-result banners. Keep history discoverable and never show a misleading all-clear.

## MCP/API contract expansion

MCP remains a stateless typed-client adapter; the Finance API owns decisions, policy, provider work, persistence, notifications and progress. Names below are proposed additions unless explicitly marked existing.

| Surface | Contract and authorization |
| --- | --- |
| Existing get_finance_status / get_finance_review_backlog | Add canonical active/historical/decision/blocker breakdown and snapshot completeness; read scope. Never silently change all-outstanding semantics. |
| preview_finance_budget_start / apply_finance_budget_start | Preview month, timezone, exact affected work and unresolved dependencies; apply fingerprint with owner approval through existing action-review policy. Agent write scope cannot supply human approval or self-grant execute. |
| prepare_finance_evidence_refresh / get_finance_evidence_refresh | Durable exact-source refresh handle, bounded requested coverage and freshness receipts; maintain grant plus current connection capabilities, no bank-changing effects or exposed provider secrets. |
| Existing qualify_finance_maintenance_work | Add flag-only pairs and categorization evidence adapters; keep advisory read-only qualification separate from approval/execution authority. |
| Existing preview/get/list/execute_finance_review_batch | Extend pair decisions and correction receipts, retain limits and execute-scope enforcement. Recovery can expose an owner-authorized approval view without allowing another agent to execute a creator-bound batch. |
| preview_finance_review_batch_undo / execute_finance_review_batch_undo | Exact original receipt plus current revisions; compensating domain changes only, with same approval boundaries as forward execution. |
| Existing conversation/question/action-review tools | Publish agent-authored linked batch cards through a supported conversation operation; discover/read/respond only under existing conversation authority. Add a scoped publishing adapter if absent. Human app approval remains human; an MCP agent may relay a user's explicit choice only where server policy supports authenticated delegated consent. |
| Existing maintain_finances / maintenance-run reads | Durable active-period-first work selection, independent blocked work, progress and honest recovery. Reuse rather than build a second orchestrator. |
| Existing budget baseline/proposal/approval tools | Surface opening-position dependency receipt and exact current-month proposal; no duplicate planning ledger or broad grant change. |

The missing execute scope is an authority gap, not a broken tool or blanket permission request. Human approval in Finance Chat may finish work through its authorized domain path. If unattended rule execution requires a grant not currently present, request only that bounded grant through normal agent-access controls; do not grant it from implementation code or block other safe inspection/preparation.

## Safety and recovery

Owner isolation, connection revocation, exact source/review revisions and independent review remain mandatory. No personal financial records as QA fixtures. Production changes occur only via supported MCP/domain workflows with user-approved manifests or valid standing rules. No direct SQL cleanup, blanket archival, synthetic evidence, invented rule consent or duplicate routine. Reactivation of history preserves original decisions; rollback of UI releases must not strand durable work accepted by a newer API.

## Acceptance and definition of done

A1. Active decisions, flags/cases, historical work and technical blockers agree across API/MCP/web/mobile on the same snapshot. Boundary dates, unknown dates and promoted historical dependencies are tested.
A2. All 34 observed November records are accounted for individually as resolved, a genuinely needed linked decision, or an explicit technical/evidence dependency. Current counts may change; a saved fixed count is not proof of zero. Historical transfer/roundup batches retain independent work and no false resolutions.
A3. Exact November opening-position evidence and an approved balanced budget exist; allocations do not exceed evidenced resources and unknown material inputs block ready status. Cooper can complete remaining approvals in Finance Chat without Codex.
A4. Answer a synthetic grouped question, retry it, interrupt execution and resume: each effect occurs once, only related review reasons close, conflicting undo is safe, and all surfaces converge.
A5. Real authorized production workflow resolves actual items with before/after receipts. No fake QA transactions. Finish with zero active human decisions AND zero material budget blockers; if either remains, report exact pending reasons rather than declare completion.
A6. Original routine picks up an actual message/answer, uses current instructions and produces a causal concise reply. Verify unattended invocation separately from manual testing. Verify push provider receipt separately from Cooper's physical display/tap confirmation.
A7. December rollover, changed income, late November postings and revoked rules pass synthetic acceptance without losing history or applying unapproved plans.
A8. Normal independent review, frozen-candidate full verification, protected merge, production health/provenance and signed TestFlight availability are evidenced before claiming shipped. Phone installation is not financial acceptance.

## Delivery boundaries

This spec and its implementation plan are approved for implementation; approval does not approve individual financial batches. Implement in the current thread as requested, without delegating production finance operations. Detailed implementation/design approval precedes product code under the Superpowers workflow. No additional execution-method question is needed: Cooper selected this agent.
