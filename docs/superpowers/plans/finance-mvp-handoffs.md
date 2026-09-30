# Finance MVP task launch prompts

Status: Specification and rollout approved by Cooper on 2026-09-14; dispatch remains gated by
prerequisite merges. The temporary baseline-delivery task owns the documentation and COO-46 ports.
These prompts do not themselves launch implementation tasks. The orchestrator resolves live project and issue IDs,
fetches main, and confirms each milestone's readiness immediately before creating a task.

## Common prompt — send with exactly one stream prompt below

Implement the assigned Finance MVP milestone in the nohmi project. Read AGENTS.md,
`docs/product/finance-workspace-plan.md`,
`docs/superpowers/plans/2026-09-13-finance-mvp.md`, and the skills for your changed surfaces.
The specification and plan define product scope, ownership, invariants and acceptance. Implement
only the dispatched milestone; inspect current main to avoid rebuilding already delivered work.

Start in this task's isolated worktree from freshly fetched main, record the exact base SHA, and
create a `cooper/<primary-linear-issue>-<short-outcome>` branch. Every PR targets main. Confirm the
required predecessor milestone has merged before consuming it. Do not branch from another task's
unmerged work or copy the old Finance branch. If a prerequisite is missing, report it and perform
only independent analysis or tests until the orchestrator supplies a ready milestone.

You are not alone in the repository. Do not revert others' work. Respect the ownership table and
request a short edit/publication slot for shared files and migrations. Implement new behavior in
small domain-owned modules; shared registration stays thin. Never introduce a former product name
or a compatibility alias. A necessary API/name cutover includes all live callers and repair docs.

Use deterministic tests for money, authority, evidence, revisions, idempotency, tenant isolation and
recovery. Run the milestone's focused tests, then fresh `pnpm verify` before opening a PR. Use the
checked-in runtime lifecycle. Coordinate full-suite/container capacity; do not weaken tests or
coverage to get green checks. If verification is environmentally blocked, report the exact blocker
and keep readiness honest.

Commit and push the implementation, create a PR through the repository `create-pr` skill, link the
correct live Nohmi Linear issue(s), and handle review feedback and CI failures. Preserve the human
assignee. Do not merge or deploy unless the orchestrator relays the user's applicable authorization.
Do not perform real SMS, account-consent or other production mutations from this prompt alone.

Both Codex and Claude are release requirements. An available tool, mock, secret or healthy process
is not production evidence. Domain state, approvals and recovery belong to nohmi; recurring
schedules belong to external hosts. Facts and user notes cannot grant financial authority.

Report: current milestone; base and head SHAs; changed behavior and owned files; exact checks and
results; PR/Linear links; dependency or product blockers; shared edit/migration slot needs; remaining
production proof. When ready, report the exact merge gate met and next eligible milestone. Do not
start another stream or broaden scope silently.

## Finance foundations — COO-52

Own stream F in the plan, beginning with F0a and F0b as separate reviewable milestones. Trace the
current maintenance callers and preserve the stronger candidate/challenge/review guarantees while
converging one lifecycle. Publish validated shared ports and their behavioral tests; establish
safe absent-producer states and the global execution-policy seam without authorizing other domains
implicitly. Coordinate canonical schema, central route/client/MCP registrations and migration slots.
You also own later F1/F2 integration, but start those only when the orchestrator confirms producers
have merged. Do not implement ledger matching, plan arithmetic or SMS rendering here.

First result: a caller inventory, proposed minimal cutover and any contradiction with the approved
spec; then implement the confirmed F0 milestone. Escalate material protocol/policy changes before
coding around them. Report the exact commit at which each downstream contract is safe to consume.

## Finance sources and position — COO-53, COO-48, optional COO-50

Own L0–L2 and the bounded LV experiment. Begin with L0 under COO-53: verify existing source lifecycle,
new-user account setup and honest coverage. Continue with L1/L2 under COO-48 after F0 contracts land.
Reuse existing provider Item, event, allocation and reimbursement models. Return one qualified
position contract; all cashflow, budget-input and wealth facts must derive from it consistently.
The F0b `financeMoneyFactReasonCodeSchema` defines the validating reason-code handshake: dependency
or source unavailable, stale or incomplete evidence, pending transactions, unresolved allocation
or reimbursement, missing commitments or protection policy, and unsupported account type. Map
provider failures to those codes; do not forward provider messages or private source text. Extend
the shared enum with its boundary tests before producing a new classification.
Test the exact financial oracle and overlap cases in the plan. UI ownership is Accounts, Cashflow,
Wealth and domain position components; coordinate Overview with F.

COO-50 is optional research, not a requirement to implement Venmo. Follow the feasibility document,
obtain account-test authorization when required, and report wallet-level go/no-go evidence. A
Transactions institution listing or successful credit-card link is insufficient. No uploads,
manual forwarding, credential scraping or fabricated cash-out allocations.

## Finance setup and planning — COO-54, COO-49

Own P0/P2 under COO-54 and P1 under COO-49. Begin with a progressively useful first plan and resumable
setup. Reconcile current profile/plan writers, reuse confirmed facts and disclose unknowns. Use the
landed position contract, never a separate calculation or optimistic estimate of available cash.
Deliver explicit policy previews/activation and cumulative bounded reallocation without changing
the approved baseline. Actual goal funding and expected contributions are distinct.

Own setup/profile/plan/period-review modules and UI. Consume shared Knowledge from C, financial facts
from L and execution policy from F. Automatic application cannot be enabled before its real evidence
and authority dependencies land. Recommendations must tie to user priorities and verified data.

## Finance context and reviews — COO-47; baseline COO-46

Own C0–C3. Confirm COO-46's existing contextual-review changes are on main; do not duplicate them.
Extend durable Finance work to prospective notes, contextual free-form answers, partial/ambiguous
matches, manual corrections and complete unified Reviews projection. Implement the landed answer
port with ownership/revision/idempotency checks. A recorded note is not a resolved operation.

Keep operational notes in Finance and reusable facts in shared typed User Knowledge with provenance,
validity, sensitivity and correction. Own only the minimum structured Knowledge slice necessary for
this journey; no semantic platform rebuild. Coordinate the shared Reviews edit slot and schema
publication. Never read the SMS conversation or implement Texting routing in Finance.

## Finance SMS — COO-55

Own T0–T2. Extend the existing shared Texting transport with typed notification policy, durable
inbound processing, exact work/message references, factual replies and revision-bound reversible
approval. Consume C's Finance operations and F's execution policy. H owns external-host dispatch.
Keep quiet-hours, reminders, consent, redaction, short composition and uncertain delivery behavior
consistent. A receipt acknowledgment says context was accepted, not that bookkeeping completed.

Start with T0 after shared contracts land. Use consumer tests to prepare T1, but real routing cannot
be advertised before C's operation exists. Test manual resolution races, delayed/reordered replies,
STOP, provider timeout and failed host continuation. Do not build unrelated general-inbox domains.

## Finance host integrations — COO-56

Own H0–H3; start with H0 feasibility before broad implementation. Both Codex and Claude are required.
Name the exact product surface and distinguish desktop, cloud routine, CLI and SDK behavior. Verify
current official support for unattended tools, continuation after original session termination,
host-owned cadence or supported event/API trigger, availability, permissions and cost.

A host-owned bounded follow-up schedule may provide continuation when native event wake-up is
unavailable, but disclose and measure latency and runtime requirements. No user copying replies
between applications. Do not replace required Codex/Claude support with a different runtime and
call it equivalent. Persist connection-bound schedule identity and health without making nohmi a
recurring scheduler. Coordinate continuation schemas with F and inbound events with T.

If either host cannot meet the approved journey, stop dependent implementation and report specific
evidence and product options. Later H3 requires separately authorized live tests for each host;
passing adapter mocks cannot close the issue.

## Finance release acceptance — COO-57

Own Q0–Q3. Build the shared synthetic acceptance fixtures and full app/API/MCP/SMS journey from the
specification's observable outcomes. Inspect already merged tests before adding duplicates. Verify
all financial surfaces against common expected facts, two-tenant isolation, corrections, partial
reimbursements, cumulative policy races and source/host interruptions.

Use real persistence and domain operations, mock only external boundaries for deterministic suites.
Run desktop and mobile acceptance. Coordinate final full-suite capacity. Return defects to the
owning implementation task with a minimal reproducer; do not rewrite domain modules in this task.
Produce a sanitized evidence matrix for exact commits and separately exercised Codex/Claude live
journeys. Do not mark release ready while either host or the real SMS path lacks evidence.
