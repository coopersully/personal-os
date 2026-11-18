# Finance configuration and readiness

Status: proposed design for review; not an implementation claim.

## Intent

Finance setup should open directly into saved, editable configuration. People can work in any
order wherever dependencies permit. Features explain the actual information or work they need,
rather than requiring an unrelated global setup completion flag. The user selected prerequisite
screens for unavailable destinations on October 5, 2026.

## Configuration experience

Opening Financial setup loads existing configuration and readiness automatically. If initialization
is necessary, it is owner-scoped and idempotent. Page loading must not call an advancement operation
that can approve a budget, start maintenance, or create repeated proposals. Initialization and
workflow execution have separate responsibilities.

Replace the questionnaire and its numbered linear progression with Profile, Accounts and records,
and Budget sections with independent status. Profile displays all relevant fields, including saved
values, grouped into Household, Income, Expenses and debts, and Goals and reserves. Use the same
field components and edit behavior in Finance settings. Short labels replace interview prompts;
use shared currency/date inputs, selects, and editable collections. Keep explanations only where
needed to understand a value.

Save valid scalar edits on blur and selections on change. Collection edits save valid rows after
completion; an unfinished row remains a draft. There are no per-question Save or Skip buttons and
no routine “All changes saved” message. Empty is unknown, zero is an explicit value, and an explicit
None control records a confirmed empty collection. Budget approval remains an explicit action.

Preserve unsaved edits across section navigation. Serialize writes that share a revision, preserve
newer local edits while an earlier save completes, and do not overwrite drafts during refresh.
Failures remain beside their fields with retry; revision conflicts retain the draft and explain
how to reconcile with current saved values. Unrelated sections remain usable during background work.

## Ownership and persistence

Expose a cohesive, typed Finance configuration interface for Setup and Settings. Workspace
preferences belong to `finances_workspace_settings`; financial facts keep their existing versioned
records, provenance, and budget references. One logical configuration does not require one database
row. Do not duplicate facts in a preferences JSON object or allow multiple competing edit paths.

Inventory the existing income profile, financial profile, setup planning fields, and workspace
preferences before changing storage. Assign one authoritative write path per field; explicitly
reconcile overlapping income fields and preserve their distinct meanings where they differ
(expected income versus reliable resources). Any migration retains existing values and provenance.
Setup orchestration stores execution state, not a second copy of user settings.

Typed domain contracts own configuration sections and readiness. The authenticated API supplies
both. Web Setup and Settings share components, queries, mutations, and cache invalidation. Existing
agent workflows remain adapters to the same facts and version checks.

## Readiness and prerequisites

Derive readiness per capability from authoritative inputs and evidence. The response identifies
capability, state, blockers, and relevant resolution destinations. Distinguish missing user input,
background work, an operational failure, and ready state. An unavailable read is not an incomplete
profile; show recovery rather than asking the user to re-enter data.

| Destination/capability | Policy |
| --- | --- |
| Overview | Always available; summarize available material and the next meaningful prerequisite. |
| Accounts | Always available, including manual accounts and connection flows. |
| Transactions | Always available for recording/importing and inspecting existing records. |
| Budget | Show an existing draft or active budget when present. If none can be displayed, explain the missing inputs and offer the relevant setup section. Draft generation and approval have separate prerequisites. |
| Cash flow | Enable useful existing views independently. Gate forecast material on its own required inputs/evidence, not on unrelated profile questions. |
| Wealth | Show recorded assets and goals when available. Gate derived position/advice only on their actual evidence requirements. |
| Reviews | Remain accessible whenever actionable review items exist, regardless of overall setup status. |

Reuse existing domain rules for each calculation and approval. Do not invent a new “all fields
answered” requirement, treat absent amounts as zero, or lower financial evidence requirements to
unlock a page. A missing producer or failed sync is an operational limitation, not something that
finishing the questionnaire can fix.

A destination with no meaningful usable content opens a prerequisite screen inside its normal
workspace shell. Show the destination name, a concise reason, and the next action. Link missing
configuration directly to the appropriate section/field. For background work show its current
state; for recoverable errors show retry; for operator-only failures give an honest limitation.
Avoid competing generic Setup links. If some page content is useful, keep it visible and gate only
the affected part. Preserve the requested destination so the user can return after resolving it.

Sidebar entries remain navigable to these screens, with an accessible status indicator. Do not
render them as disabled controls that cannot explain themselves. Direct URLs, search results,
header actions, and API mutations follow the same readiness rules. Existing records remain
accessible when later edits or provider failures make a derived capability unavailable.

## Navigation

Remove Finance settings from the workspace sidebar; it remains in the standard Settings system.
Proposed sidebar groups:

- Overview: Overview.
- Money: Accounts, Transactions.
- Planning: Budget (existing Plan destination), Cash flow, Wealth.
- Setup: Financial setup.
- Footer: the existing review alert, only when actionable items exist.

Retain existing URLs and redirects. Financial setup remains available for later corrections and
shows an attention indicator only for actionable outstanding setup work. Do not add another review
queue or a redundant Finance settings shortcut.

## Background work and validation

Independent profile editing, account connections/imports, and record checks may overlap. Dependent
operations enforce prerequisites server-side. Work that outlives a request uses the existing
durable execution infrastructure, with pending, failure, retry, and completion states. Results are
bound to input revisions so stale work cannot silently approve or replace a newer budget.

Acceptance covers first visit, returning visit, partial configuration, unknown versus confirmed
none, concurrent edits, retries, async completion after navigation, stale derived results, owner
isolation, deep links, mobile/desktop layouts, keyboard access, and partial backend outages.
Verify that navigation alone performs no approval or maintenance action and that unavailable
features explain real blockers. Update the canonical Finance page specification with shipped
behavior when implementation is verified.
