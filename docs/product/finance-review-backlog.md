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
current/future proposal or future approved plan. A future approval is never this month's plan;
retirement when a successor is approved does not erase the earlier month's approval history.
Latest-version budget reads still return a draft when it is the latest version, alongside this
explicit context. Missing current-month approval does not mean no budget has ever been approved.
Archived plan containers are excluded from current/upcoming selection; earlier approved versions
remain explicit historical context. Invalid stored planning timezones return a controlled unavailable
error with timezone-repair guidance, never a guessed UTC month. Read failures remain unavailable
errors, never fabricated missing plans. Profile revisions can
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
