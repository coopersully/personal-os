# Finance MVP specification

> October 18 Finance experience revision: the consolidated [design](../superpowers/specs/2026-10-18-finance-experience-design.md)
> and [implementation plan](../superpowers/plans/2026-10-18-finance-experience.md) define the target for setup,
> Spending, Chat, Automations, Activity, and manual workflow coverage. They supersede conflicting
> earlier targets below, including ungated setup and agent budget self-approval. This is not a
> declaration that the redesigned experience has shipped.

- Status: Approved by Cooper on 2026-09-14 ("It looks good, proceed."). Approval authorizes the planned rollout; it does not establish shipped capability.
- Baseline inspected: `origin/main` at `3d3306608c4b6f729d0c93e4e887dae2ba930d2d`, 2026-09-13.
- Planning owner: the Finance orchestration task; implementation belongs to separate workstream tasks.
- Tracker: [COO-45](https://linear.app/coopersully/issue/COO-45/plan-and-coordinate-the-complete-finance-mvp).
- Delivery: the [earlier implementation plan](../superpowers/plans/2026-09-13-finance-mvp.md) and
  [handoffs](../superpowers/plans/finance-mvp-handoffs.md) are historical sequencing, not current
  dispatch authority. The [full Finance design](../superpowers/specs/2026-09-28-finance-toolkit-design.md),
  [Texting design](../superpowers/specs/2026-09-28-texting-toolkit-design.md), and
  [shared toolkit design](../superpowers/specs/2026-09-28-shared-agent-toolkit-design.md) await written
  review before replacement implementation plans are prepared.

## 1. Product outcome

A new user can connect financial accounts, understand their financial position, establish a realistic
plan, and let an authorized agent keep records and the plan current. The user answers only questions
that require their judgment, through the app or SMS, and can always inspect or correct the result.
Periodic reviews explain progress, risk, uncertainty and useful next decisions.

Financial resilience, wealth building and quality of life are the objective. Lower spending alone
is not success. A recommendation must explain its relationship to an obligation, reserve, debt,
goal or stated priority; it must not moralize about a category or assume every user wants the same
tradeoff. Better bookkeeping is necessary but does not by itself constitute the Finance MVP.

This specification narrows the larger [master design](master-design.md#67-finances),
[workspace contract](workspaces.md#finances), [stewardship doctrine](workspace-stewardship.md),
[User Knowledge contract](user-knowledge.md), and [Texting contract](texting-operations.md).
Those remain canonical target contracts. This document replaces the earlier branch-oriented lane
proposal; the current review changes are one prerequisite, not the organizing center of the MVP.

## Finance intelligence and visual exploration

Accepted product direction, October 18: Finances is an automated financial assistant with a strong
analytical foundation. It turns the financial records and relevant context the person has entrusted
to nohmi into understanding, visual exploration, evidence-backed forecasts, and useful choices.
Bookkeeping is the foundation, not the end product. Manual operation remains supported; authorized
agent maintenance is the intended experience that keeps the financial picture current.

Maximize the usefulness of available, authorized data rather than the volume of data collected.
Combine transactions, account meaning, income timing, recurring commitments, reimbursement evidence,
goals, priorities, and prior answers when they serve the person's purpose. Reuse known answers;
request additional context only when its benefit is concrete, explain that benefit, and distinguish
user-confirmed facts from inferred or uncertain information. Follow the User Knowledge contract for
purpose, consent, retention, correction, and cross-workspace access. Context never grants authority.

The user should be able to move through four levels of understanding:

1. **Observe:** see where money went, what remains owed, and what is coming next through clear visuals
   linked to exact records. Bubbles, lists, trends, rhythm, timelines, and journeys offer different
   perspectives on the same financial evidence, not competing totals.
2. **Understand:** identify changes, recurring commitments, and contributions to a result. Explanations
   distinguish supported relationships from hypotheses; correlation is not a causal finding.
3. **Explore:** change explicit hypothetical assumptions and compare options, timing, or goal progress
   without changing the actual budget, account balances, or recorded contributions.
4. **Decide and follow through:** an agent prepares useful proposals, asks only questions that need the
   person, and carries authorized work through to a verified result. Budget activation and changes
   always require exact human approval. Activity links important outcomes to their supporting records,
   conversation excerpts, and approval evidence.

Forecasts must expose their horizon, source freshness, coverage, assumptions, and limitations.
Use intervals only when a defensible method supports them; do not invent statistical confidence,
affordability guarantees, or precise dates from incomplete inputs. Favor understandable models whose
outputs can be checked, corrected, and improved through observed outcomes. A schema field's presence
is not evidence that the user's data is populated, current, or sufficient for prediction.

Success is a person who can understand their situation, explore choices, and act with less repetitive
work—not more charts, more questions, or lower spending for its own sake. Every new analytical view
should name the decision or understanding it supports, its evidence requirements, its unavailable
state, and how to inspect or correct the underlying records. The
[Finance experience design](../superpowers/specs/2026-10-18-finance-experience-design.md) turns this
motivation into the current planned views and workflows; it does not establish shipped capability.

## 2. Accepted constraints and approved release boundary

### Accepted

- Automatic bookkeeping within granted authority and sufficient evidence; budget changes and activation only
  after exact human approval. No production policy is activated by this specification.
- App and agent operate on the same records. Users can resolve items themselves and provide
  free-form context before or after an event. Corrections survive later maintenance.
- nohmi is the account's persistent brain, storage and tools, never a built-in agent. External
  agents reason and manage knowledge; authorized agents on the same account can retrieve permitted
  contributions from other agents and previous runs. No vendor, host runtime, schedule registration,
  agent wake-up or response time is a release requirement.
- External hosts own recurring schedules. nohmi owns durable domain state, accepted-work recovery,
  source synchronization, questions, policy and results. Multiple hosts may overlap safely.
- Venmo-specific access must work automatically after connection. No upload or manually maintained
  forwarding fallback. It is optional to release until the [feasibility gate](../engineering/venmo-automatic-access.md)
  proves useful personal-wallet data and ongoing access.
- No money movement, trading, bill payment, tax filing or professional credential claims.
- Every record and operation is tenant isolated. One person's habits never become platform defaults.

### Approved MVP scope

One person's US/USD financial plan with calendar-month category allocations, dated cash-flow
forecast, recurring income/bills, debt visibility, basic savings goals, investment balances and net
worth. Existing manual accounts and supported generic imports remain usable. The app must work
without an agent, a completed budget, a paid connector or SMS; unavailable automation is explicit.

Preserve existing supported features rather than remove them to match this boundary. Do not add
all later budget views, FX consolidation, investment execution, tax optimization, full portfolio
analytics or semantic indexes as prerequisites of the first usable journey. Full delivery includes
category carryover, shared structured knowledge and general cross-workspace Texting tools; it never
includes a built-in SMS agent. Shared household and multi-person financial plans are permanently
out of scope; additional currencies are a possible future extension. Account ownership that cannot be established must qualify or exclude affected
aggregates. A joint account is not authority to disclose another person's records.

Budget automation prepares proposals for human approval, including reallocations of existing
resources. New borrowing, reserve withdrawals, increased assumed income, or reduced protected
priorities must remain explicit in those proposals. Monthly rollovers and different budget modes remain later product work.

## 3. Historical baseline and the completion gap

The table below records the September 13 planning baseline, not current delivery status. Use the
implementation log, current code and new design's source inventory for subsequent progress.
Implementation evidence comes from code, migrations, tests and deployed observations; source
presence is not proof that every path works in production.

| Area | Existing foundation | MVP completion work |
| --- | --- | --- |
| Sources | Plaid Item synchronization, selected accounts, manual activity/imports, account semantics and health | Verify new-user connection/reconnect, coverage, duplicates, removal and account meaning; close gaps across UI/API/MCP |
| Ledger | Transactions, economic events, splits, transfers, reimbursement services, merchant rules | One consistent recognition/allocation model across totals, period boundaries, pending replacements, ownership and corrections |
| Financial position | Snapshot, cashflow, wealth and budget projections | Qualify every affected total; separate cash, commitments, pending exposure, protected money, contributions and spending |
| Setup and planning | Resumable setup, versioned profile/budget, goal and recurring models | Expand the current short interview into a useful plan; reconcile profile/planned/observed income and obligations; approve boundaries |
| Questions/context | Canonical cases plus other question/review paths; the separately reviewed COO-46 source slice adds contextual notes and dashboard actions (not yet merged) | Complete unified lifecycle, prospective notes, matching, user correction and narrow reusable knowledge |
| Maintenance | Protocol start/judgment/audit/resume plus older candidate/challenge/settle surfaces | Converge orchestration without losing challenge, authority, fencing or review guarantees; verify honest terminal states |
| Texting | Verified phone, consent, guarded read/send MCP tools, inbound persistence and delivery tracking | Shared notifications, durable inbound processing, work-bound free-form answers, revision-bound approvals and recovery |
| External caller access | Generic agent interfaces and older host-specific planning | Discover and resume durable work from any fresh authorized session; overlapping calls, polling and optional work events |
| Review/advice | Period review and planning/report surfaces | One evidence-qualified review tying actuals and forecasts to goals, useful recommendations and unresolved work |

The baseline originally required separate review of `cooper/finance-review-context`. This is
historical dependency context, not an assertion that it is still unmerged. Inspect current main
and the implementation log before dispatch; do not copy old branches or repeat delivered work.

## 4. User journeys and acceptance requirements

### F1 — Connect and understand coverage

Connect through the normal consent flow, select accounts, confirm purpose/ownership, and see the
first useful result with an honest sync state. Pending, stale, reconnect-required, excluded and
unsupported sources remain visible. Revocation stops future access and data controls have an
explicit outcome. A failed account does not hide useful work on other accounts. The account UI
and agent status agree on freshness, repair owner and which totals are incomplete.

### F2 — Trust the ledger and current position

Recognize an economic event once across provider replays, pending-to-posted replacement, both sides
of a transfer, imports and split allocations. Show gross purchase, received reimbursement and
unmatched remainder separately. A repayment expectation is not cash or income. An investment
contribution moves value between assets; it is not consumption or investment return.

Expose cash balance, posted spending, expected obligations, pending exposure, protected allocations,
debt, investments and net worth as distinct measures. Each carries cutoff, coverage, provenance,
qualification and missing evidence. Budget remaining is not interchangeable with spendable cash.
Do not publish definitive spending capacity when material obligations, ownership or source evidence
are missing. Avoid reserving the same obligation or goal dollar more than once.

### F3 — Establish a realistic plan

Progressively ask about income reliability, bills and timing, debt obligations, reserves, goals and
protected quality-of-life priorities. Reuse known answers; mark assumptions for confirmation.
The user can skip unknowns and still bookkeep. A proposed monthly plan distinguishes recurring
income, uncertain future income and exceptional resources. It must balance exact cents and explain
unfunded needs instead of inventing money. Approval records the exact profile and plan revisions.

A first useful plan includes spending categories, obligations, debt minimums, savings/goal
allocations and a buffer when the user chooses one. Goals have a target, optional date/priority and
evidence-backed progress. Planned funding is not proof that money moved or a goal balance grew.

### F4 — Maintain within user boundaries

Maintenance reconciles sources, applies authorized bookkeeping, evaluates the plan, collects
questions, and verifies its result. It can cover outstanding work, a bounded period or an exact
owned target. Repeated invocation resumes compatible work; it never duplicates economic effects.

Budget activation and changes to the active budget always require the person's explicit approval
of the exact proposal. This October 18 decision supersedes the earlier optional automatic budget
revision allowance. Agents may prepare proposals, but confidence, global bypass, or a previously
approved adjustment policy cannot substitute for approval of this change. Preserve the baseline
and do not silently normalize overspending by changing it. Existing policy records remain history;
the runtime enforcement of this revised target must be verified before claiming it is shipped.

A monthly comparison additionally needs an explicit currency, complete account universe, calendar
month and timezone, and stable allocation identity and amounts. Present this review only when that
baseline needs qualification; it is not a global setup requirement. The person confirms the exact
persisted review. Agents may prepare it but cannot confirm it. The resulting snapshot is immutable,
including account membership and category labels, so a later account addition, category rename or
new active plan cannot silently change an earlier comparison. Selected chart accounts and dates do
not narrow the whole-month budget numerator.

Historical confirmation records its own human actor and timestamp alongside the original budget
approval actor and timestamp. A later human confirmation may qualify an existing complete historical
snapshot, including one originally approved by an agent, but must be labelled retrospective; it
never rewrites the old actor or claims that the person approved it at the time. Missing account,
currency, baseline or allocation evidence remains explicitly unavailable with a contextual review
path. A user-confirmed budget currency is a declaration for that baseline, not evidence that unknown
ledger transaction currencies are qualified. The Spending projection must still validate its
numerator's accounting basis, pending/refund treatment, currency and coverage independently.

The person explicitly designates one complete, human-approved baseline for each calendar month.
Changing a policy, replacing a plan, or changing timezone cannot create a second baseline for that
month. Policy terms and saved preview evidence remain immutable history; edits append versions,
and disable/withdraw remain available even when evidence is missing or a preview has expired.
Draft management and saving a hypothetical preview confer no execution authority. Historical
policy limits and previews do not authorize automatic budget changes.

A rule stays inactive until an exact preview exposes matches, non-matches, consequences, conflicts,
authority and disable/recovery. A factual answer, setup completion or global bypass never activates
it. Read-only agents may explain/propose; mutation execution follows the same domain authority
through every channel. Budget changes require per-proposal human approval through every channel.

### F5 — Resolve outstanding work once

Show a concise Finance list with a count and a complete review destination. Every question,
approval or user-required repair has one stable domain identity projected into unified Reviews.
Show date, amount, direction, account, useful merchant and why the answer matters. Nearby activity
is context, not proof of a relationship.

Users can type a note, choose a category, split, link, defer or dismiss as allowed by the item.
Answering a question records evidence; resolving an item records an applied outcome. Preserve that
distinction. All surfaces reflect the same lifecycle, including when a manual action races an agent.

Prospective context can exist before any transaction: original text, optional time window, expected
amount/participants, referenced records and revision. Unknown values stay unknown. Suggested matches
retain evidence and confidence; material ambiguity asks the user. Partial reimbursements keep an
unmatched amount; edited, canceled, expired or contradicted expectations cannot silently keep
matching. Expiry ends automatic matching but preserves inspectable history. No universal expiry is
silently imposed on user expectations; setup can propose a user-approved default.

Reusable facts follow the shared typed User Knowledge lifecycle. One-off notes stay with Finance
records. MVP uses bounded structured retrieval and explicit provenance; it does not require
embeddings or unrestricted conversation history. Conflicting facts are disputed rather than last
writer wins. Knowledge can inform recommendations but cannot grant action authority.

### F6 — Finance SMS through the toolkit

The [Finance SMS journey](texting-operations.md#finance-mvp-requirement) proves nohmi's own
capabilities: an exact question or proposal can be sent, a signed reply persists, a fresh authorized
caller retrieves it and applies an allowed resolution, and the same result appears in the app.
The toolkit supports polling and optional work events without host or schedule registration.
External agents interpret free-form text, ask clarifications and compose substantive responses.
nohmi validates structured bindings, records source evidence and performs deterministic operations.

Shared policy applies consent, disclosure, quiet hours, reminders and deduplication. Actionable
messages contain at most three items; multi-item messages link to authenticated unified Reviews.
Adaptive coaching preferences and past questions are exposed to agents so they can become quieter
as uncertainty shrinks. An optional daily check-in is a preference, not a nohmi-owned agent schedule.

Inbound records and processing status survive the original session. A provider acknowledgment does
not claim bookkeeping completed. Work can wait for an external caller indefinitely without an
invented response-time promise. A caller's absence, revocation or failure leaves honest recoverable
state. No named model host, automatic continuation attempt, or host-specific latency gates release.

SMS can record factual answers and approve an exact unexpired reversible proposal under current
channel/domain policy. Free-form agent interpretation cannot manufacture user approval. New budget
authority, rules, credentials and stronger approvals use authenticated app review. A stale or
ambiguous yes cannot approve anything. Accepted work and safely replayable unfinished work remain
distinct during recovery and manual-resolution races.

### F7 — Review and improve finances

The user can inspect a durable periodic review containing cutoff/coverage, completed corrections,
plan versus actuals, cash-flow pressure, debt/goal/wealth progress, unresolved exposure and next
choices. Explain why spending above or below plan matters for that person's stated goals.
Recommendations show evidence, assumptions, tradeoffs and uncertainty. A forecast is not booked
money; net worth changes distinguish contributions, liabilities and valuation where evidence allows.

Provide useful basic recommendations without requiring market feeds. Specialist investment, tax
or jurisdiction-sensitive advice requires separately researched applicability and is not an MVP
promise. Correcting source evidence recomputes current projections; an issued review remains an
immutable snapshot with a superseding review when necessary.

## 5. Architecture and failure behavior

- `packages/domain`: validated shared contracts and money/lifecycle invariants.
- `packages/database`: tenant-owned records, revisions, durable claims, audit and migrations.
- Finance API modules: ledger meaning, setup, plans, policy, reconciliation, work and reviews.
- Shared Texting: consent, delivery, conversation claims, explicit bindings and structured routing;
  external agents interpret messages and compose substantive responses.
- Shared notification policy: eligibility once per work identity, then channel suppression.
- User Knowledge: typed reusable facts and purpose-bound retrieval; Finance owns operational notes.
- External caller access: bounded work retrieval, claims, account knowledge and optional events;
  no mandatory host-specific adapter, schedule registry or internal agent.
- Typed API client, web and MCP: the same domain operations; no competing calculations or authority.

See the [contract and ownership plan](../superpowers/plans/2026-09-13-finance-mvp.md). There is one
canonical Finance maintenance lifecycle. The foundation work traces callers and preserves the
stronger challenge/settlement guarantees while cutting callers over explicitly. Former product
protocol names require a hard cutover; do not introduce compatibility aliases. Data migration may
be phased, but new public naming must follow current repository instructions.

States distinguish execution progress from financial health. A run can finish with questions and
qualified totals; maintained requires verified scoped reconciliation. Blocked authority/evidence,
provider failure, ambiguous external delivery and user input each retain their own repair path.
Use revision guards, fenced leases, stable operation IDs and transactional outboxes where accepted
work outlives the request. Verify scope and tenant ownership before lookup or mutation, including
nested references and knowledge retrieval.

## 6. Release evidence

| Gate | Observable evidence |
| --- | --- |
| Fresh user | Connect or use manual account, understand coverage, create/approve plan and configure authority without an agent or host registration |
| Normal month | Receive income, pay bills, spend, contribute to savings/investments and review mutually consistent totals |
| Ambiguity | Shared expense plus partial reimbursement, prospective note, unmatched remainder, correction and later maintenance |
| Authority | Read-only rejection, inactive rule, stale approval, cumulative cap race, revoked credential and protected category |
| Recovery | Provider replay/removal, pending replacement, duplicate invocation/SMS, process interruption, stale source, offline host and uncertain send |
| Channel parity | App, API, MCP and SMS resolve one case; a manual correction wins without later reversal |
| Fresh caller | End the original client session, receive a later real SMS reply, retrieve and resolve it using a fresh authorized client; prove overlapping callers and cross-agent knowledge reuse |
| Release | Fresh `pnpm verify`, reviewed migration transitions, production-equivalent connector/SMS evidence and operator recovery |

Use synthetic multi-tenant fixtures in the repository. Production smoke evidence records only
sanitized identifiers, timestamps, configuration capabilities and terminal states. Obtain explicit
authorization for actual SMS/provider connection tests; this plan is not consent to send messages.
No host, connector or SMS capability is marked shipped from mocks alone.

## 7. Supersession and remaining evidence

Cooper's September 28 decisions supersede the earlier named-host requirements, mandatory schedule
identity, agent continuation latency target, and implications of built-in reasoning. They also
settle per-category carryover, combined reallocation limits, protected minimums, actual goal
funding, same-account cross-agent knowledge and permanent exclusion of shared financial plans.
The coordinated written designs require review before new implementation plans are approved.

Release still requires verified domain invariants, migration/recovery safety, truthful capabilities,
real authorized connector/SMS evidence and app/API/MCP parity. Removing external-host certification
never weakens evidence for nohmi's own external boundaries. Vendor walkthroughs are optional,
explicitly scoped interoperability examples. Venmo coverage remains a separate feasibility gate and
must not delay the required generic Finance journey.
