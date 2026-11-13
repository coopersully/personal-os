# Finance review backlog

Finance agents own investigation, grouping, reconciliation and follow-through. People supply
facts and preferences that cannot be established from available evidence. A cleared badge is
the consequence of a resolved financial issue, never the goal of a maintenance operation.

## Counting and financial truth

`all_outstanding` includes historical work. Current-period spending and pacing remain scoped to
the selected period. Surfaces distinguish flagged transactions, open review records, pending
action approvals and unanswered questions; these counts overlap and must not be added into a
fictional count of independent decisions. Bounded pages carry pagination and completeness.

The current versioned financial profile is the planning authority. Legacy profile fields are a
fallback only where no canonical profile exists. An explicit unknown in the canonical profile
must not silently resurrect an older value. Budget approval binds the displayed proposal and
its profile revision; readiness is informational and commit-time validation remains mandatory.

## Approved plans and monthly category limits

Finance status and canonical budget reads share owner-timezone monthly plan context. An approved
versioned plan establishes approval; legacy monthly category-limit rows do not. Context names the
approved version for the current month, the most recent earlier approved version, and the nearest
current/future proposal, incomplete draft or future approved plan. A future approval is never this month's plan;
retirement when a successor is approved does not erase the earlier month's approval history.
Latest-version budget reads still return a draft when it is the latest version, alongside this
explicit context. Missing current-month approval does not mean no budget has ever been approved.
Archived plan containers are excluded from current/upcoming selection; earlier approved versions
remain explicit historical context. Invalid stored planning timezones return a controlled unavailable
error with timezone-repair guidance, never a guessed UTC month. Read failures remain unavailable
errors (`service_unavailable` with refresh recovery), never fabricated missing plans. Missing
current-month approval points to reviewing that month’s proposal when present, otherwise creating
a proposal. If a newer incomplete draft supersedes an older proposal, recovery points to revising
that latest draft, not approving the superseded proposal. It never asks to reapprove the previous month. Profile revisions can
require a new proposal without erasing a previous approval.

Status keeps complete allocated resources and spending allocations distinct. Health and forecast
comparisons use only the approved plan's spending allocations, never savings, debt, goals or buffer
as spending limits. Legacy category-limit totals remain separately labeled and are not combined
with the canonical plan. These reads neither approve nor retire a plan, qualify a monthly baseline,
or alter financial records. Historical work scopes do not replace the current planning month.

## Grouped investigation

Assessment groups outstanding material by useful investigation patterns, including roundups,
internal account movements, card payments, ambiguous payments and ordinary categorization.
Labels and merchant names are navigation aids, not proof. Agents inspect exact transactions,
their revisions, account ownership, currency, amounts, dates, relationships and source evidence.
Matching amounts or a high confidence score alone do not establish an internal transfer.
Generic provider transfer labels, opposite signs, date proximity and uniqueness establish a
candidate, not proof that the movements share a destination. For such pairs, show both frozen
merchant/amount/date summaries and require the owner's explicit confirmation that they are the
same movement between owned accounts. Agent execution alone cannot confirm these candidates.
The confirmed pair shares a persistent transfer group; an exact undo restores the previous links,
classifications, allocations and review states. The correction preview shows both affected legs
and the saved values being restored, rather than asking the owner to approve opaque identifiers.

An answered purpose and an unverified expense link are different facts. Preserve the answer and
continue investigating the link; do not ask the person to repeat an already recorded answer.
Do not create a permanent rule from an isolated purchase or treat every payment through a mixed
merchant as the same economic activity. Notes alone cannot verify a historical financial effect.

## Bounded execution and recovery

Bulk work previews an explicit manifest of decisions, evidence and observed revisions. It does
not accept a blanket instruction to dismiss every open item. Execution uses the existing
domain writers and current authorization, including per-connection revocation and review policy.
Grouping does not grant authority and does not turn an agent into a human approver.

An accepted batch persists before execution. Each item and its outcome commit atomically;
successful items are not repeated on resume. Calls process bounded chunks, expose unresolved
items and stale evidence, and require an explicit continuation while work remains. No in-memory
promise claims background completion. Corrected evidence requires a new preview rather than
editing an accepted manifest. Unrelated review reasons remain open.

## Acceptance

Synthetic fixtures cover multi-year backlogs, mismatched flags/review records, canonical unknowns,
stale revisions, partial failure, concurrent resume, lost responses, owner isolation and revoked
agents. App and MCP results describe the same work. Approval failures identify recovery and a
request ID through the standard feedback surface; production success requires production
evidence and is never inferred from local tests.


## Qualify independent maintenance work before preview

The read-only `POST /v1/finances/review-batches/qualification` operation accepts up to 25 explicit decisions, with the same current revision and timestamp bindings as preview. It creates no run, durable preview, question, approval, audit or ledger effect. The typed client exposes `qualifyFinanceMaintenanceWork`. Existing preview remains all-or-nothing and execute retains its original current-authorization and source revalidation; qualification is never an execution capability.

Results retain every supplied item in order. Source checks use the owned transaction/account and, for connected Plaid sources, both account and authoritative Provider Item freshness. Unknown currency, pending data, unavailable topology or stale sources stay blocked. Transfer confirmation additionally uses the existing unique reciprocal counterpart validator and checks the counterpart account/source. A scan reaching 201 same-amount rows is incomplete and cannot establish uniqueness. Requests have a 25-item bound, a 1-second SQL statement bound and a 5-second work window checked between items; an unexpected storage failure aborts the read rather than inventing partial success.

The first evidence adapter qualifies exact reciprocal transfer confirmations only. Other decisions remain `awaiting_evidence` until their owning evidence adapter establishes sufficiency; caller explanations, confidence, routing groups and `current_record` do not establish it. Missing execute permission is reported as `authorization_denied`, separately from source failure. Valid permission without standing approval remains `awaiting_approval`. A human inspection request itself does not grant approval. Independent qualified items remain visible alongside all held items, so a caller can prepare a separate exact preview for justified work without creating another maintenance run.

The response includes canonical source references and an observation time, plus explicit `advisoryOnly`, `previewRequired` and `executionRevalidationRequired` markers. Re-read or requalify after source changes; the strict existing preview and execution paths remain authoritative. The MCP tool `qualify_finance_maintenance_work` uses the same service and typed client with only `finances:read`, including read-only discovery; it requires no maintenance or execution scope to inspect. Its catalog entry is read-only, prepare-stage and closed-world. Natural-host consumption and useful independent progress remain outcome acceptance, not a consequence of passing source tests.

## November-first budgeting and the active inbox

Accepted product direction on November 12, 2026; implementation remains a target until separately
verified. Cooper's first maintained budget month is November 2026 in the user's default timezone.
Preserve all prior transactions, reviews and provenance. Historical work belongs in a separately
inspectable cleanup queue unless it affects current balances, spending, obligations or allocations.
Moving work out of the active scope never resolves it or establishes historical completeness.
Unknown dates and uncertain dependencies require triage rather than automatic historical placement.

The active inbox counts distinct human decisions, with transaction flags, review cases, processing
work and technical blockers reported separately. Zero human decisions does not imply budget-ready:
material evidence dependencies must be resolved and the exact current plan approved. The opening
position requires qualified balance anchors and interval coverage; missing information is not zero.

Finance Chat owns concise, linked questions and batch approvals. Answers durably resume authorized
work and receive a verified result; they do not silently create permanent rules. Reuse the original
routine, current-instruction bootstrap and notification controls. Each later month uses the same
policy with a fresh proposal and explicit carryover, rather than resetting history or automatically
approving a plan. See the [detailed design](../superpowers/specs/2026-11-12-finance-inbox-zero-design.md)
and [implementation plan](../superpowers/plans/2026-11-12-finance-inbox-zero.md).


### Exact owner approval and resumable batches

Approving a displayed review batch records a one-batch, exact-fingerprint instruction with
24-hour expiry. Pending work survives the client closing and resumes through the existing
bounded batch executor on the server maintenance tick. This does not create a standing agent
grant. Every effect still checks current source revisions and the live approval, cancellation,
expiry and worker claim. Cancellation stops future effects; it does not undo applied effects.
Unexpected failures have bounded retries and an explicit recovery state. A completed batch
reports its actual applied/exception counts in Finance Chat with a link to the saved outcomes.

Shared Finance Chat also permits a connected Finance reader to inspect bounded conversation
pages, and an agent with read/write/maintain grants to publish short attributed record cards.
These annotations neither consume the original routine's source messages nor impersonate an
owner answer. The original host's causal reply protocol, identity, cadence and grants remain
unchanged. Pending published approvals contribute to active human attention; approved work
contributes to processing, and stopped work retains technical recovery. Historical raw review
counts remain separately available.

### Monthly continuity and retained runs

The approved first month is a floor, not a fixed reporting month. `maintain_finances`
returns `monthlyWork` for an approved start policy: current owner-local month, canonical
attention, current/previous/upcoming budget versions and domain-owned next-work guidance.
A future start remains disabled; reversing the policy restores the all-outstanding workflow.
An old run's scope, host identity, saved candidate and approvals remain unchanged. Its
blocked or completed state does not establish readiness for the current month.

The current-month date window is a discovery aid, not permission to omit unresolved work
since activation or exact historical dependencies. Approved independent batches continue via
the existing durable worker even while aggregate bookkeeping is blocked. Historical records
are retained; late postings and cross-period refunds can return them to active attention.

Monthly budget preparation reuses an existing target proposal when present. Previous approved
allocations are a template only: changed income and bills need fresh evidence, and material
unknowns need an owner answer. The supported carryover policy is `none`; unspent allocations
and unreceived income are not additional cash. Exact new versions require owner approval in
Finance Chat. Actual unattended execution and phone delivery remain release acceptance,
not claims established by this contract or synthetic tests.

### Activation evidence and subsequent months

Historical disposition uses the qualified starting-month boundary for each affected account,
separately from the current month's opening and budget readiness. A missing December statement
must not reactivate independent October work. An unqualified or relinked account holds its own
history for triage; matching cross-boundary transfer candidates and persisted relationships keep
potential dependencies active until resolved. Published batch and correction cards derive scope
from their actual member transactions, with one human approval for a mixed-period batch.

### Budget input freshness

An approval is an immutable historical fact, not permanent proof that the plan fits current
income and bills. `get_finance_budget` accepts a target month and returns `planningInputs`:
the material source snapshot and its fingerprint. Preparation must read that snapshot before
constructing resources and allocations, and send its exact `expectedInputFingerprint` on
create/revise. Missing legacy evidence may remain a draft but cannot qualify for approval;
changed evidence requires a new proposal. Never stamp a newly read fingerprint onto amounts
computed from older evidence.

The snapshot includes profile identity, planning timezone, active income and obligations,
expected dates, applicable schedule semantics and canonical schedule validity. Cosmetic names
and observation timestamps do not independently invalidate it. Approval compares this evidence
again in the same statement that activates the version. This is an optimistic statement boundary,
not a guarantee that sources cannot change afterward. An overlapping later update can stale an
approval immediately; readiness is freshly projected and the approval history is retained.

Current-month readiness requires both an approved plan and current inputs. Today and Finance
surface a concise budget review action even when there are no transaction questions. The
assistant must revise changed inputs through the existing proposal and owner-approval flow;
it must not erase the prior approval, automatically carry money forward or claim inbox zero
from an empty question count alone.

Expected funding has a separate, explicit owner confirmation. The exact-version approval
screen presents every resource's kind, amount and linked owned account (or manual estimate),
plus assumptions, and asks the owner to confirm that they reasonably expect those resources
to fund this month. `confirmExpectedResources` is accepted only from the actual owner. The
immutable approval audit binds the month, version, resources and planning fingerprint; the
version records the confirming owner. Agents cannot provide this attestation. Legacy or
agent-approved versions can remain historical approvals without qualifying budget readiness.
This supports owner-confirmed expectations, not guaranteed income, received funds, or permission
to ignore contradictory evidence and unresolved dependencies. No old approval is backfilled.
