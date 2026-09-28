# Complete Finance toolkit design

- Status: Written design for Cooper's review; conversation-level direction approved 2026-09-28.
- Source baseline: local `3daaa61f`, inspected 2026-09-28; not a production certification.
- Companions: [shared toolkit](2026-09-28-shared-agent-toolkit-design.md),
  [Texting](2026-09-28-texting-toolkit-design.md).
- Canonical contracts: [master design](../../product/master-design.md),
  [Finance MVP](../../product/finance-workspace-plan.md),
  [finance invariants](../../architecture/0003-finance-intelligence.md).
- This specifies the full Finance target in staged releases. Implementation planning follows
  written approval; no product implementation or external action occurs through this document.

## 1. Outcome and boundaries

One person can understand their finances, establish a realistic plan, inspect and correct records,
and authorize external agents to maintain bookkeeping and adjust allocations within explicit limits.
nohmi supplies trusted records, calculations, knowledge, work queues, workflows, and tools. External
agents reason, conduct interviews, identify tradeoffs, ask questions, and author advice. The app
remains usable without an agent, SMS, a completed budget, or a paid connector.

The initial and planned implementation uses USD and calendar months. Shared household budgeting and
multi-person financial management are permanently excluded. Confirmed beneficial shares of joint
accounts may inform this person's plan without granting another person access or counting their
money. Additional currencies are a future possibility, not part of this release. No money movement,
trading, bill payment, tax filing, or professional credential claims.

Success is financial resilience, progress toward the person's goals, and quality of life. Spending
less is not itself success. Recommendations must relate to actual obligations, reserves, goals,
or stated priorities and expose uncertainty. nohmi does not internally generate financial advice.

## 2. Settled choices

| Decision | Required behavior |
| --- | --- |
| Coaching | Adaptive: agents ask useful questions while learning and become quieter as uncertainty shrinks; optional daily check-in preference |
| Agent authority | Clear bookkeeping and bounded budget reallocations under explicit policy; crossing boundaries needs a proposal |
| Adjustable categories | Only explicitly selected categories; all others protected |
| Limits | Dollar and percentage limits both apply, plus a cumulative monthly dollar cap and optional category minimums |
| Carryover | Per category: none, unused surplus only, or both surplus and overspending |
| Corrections | Affect that transaction only, remain authoritative through later maintenance; future rules require separate approval |
| Knowledge | Save clear user-stated facts with provenance; inspect/correct/delete; do not create action authority |
| Goal progress | Planned contributions are separate from actual funding or explicit reservation of existing cash |
| Texting | Supports new requests and replies; exact supported reversible proposals may be approved by bound SMS |

Daily coaching is a preference exposed to external agents, not a nohmi-owned recurring agent job.
No approved dollar values, percentage values, protected amounts, or production policy are supplied
by this spec. Setup collects them and requires exact approval.

## 3. Existing source and integration gaps

| Area | Foundation to reuse | Remaining completion |
| --- | --- | --- |
| Sources/ledger | Plaid lifecycle, manual/import accounts, economic events, splits, transfers, reimbursement services and rules | Verify complete lifecycle and one consistent accounting treatment across readers, corrections and period boundaries |
| Position | `finance/position-service.ts`, registered position read, maintenance checkpoint | Finish consumer convergence, evidence qualification, source/ownership coverage and accurate spendable calculation |
| Setup | Versioned profile and progressive first-plan modules | Connect complete qualified position, income/obligation evidence and useful app/agent setup |
| Budget authority | Policy management/evaluator modules with execution unavailable | Explicit activation, complete position/usage producers, atomic application, caps/floors, UI/API/MCP parity |
| Context | Capture store, contextual question and answer services, Reviews projection | Agent access, prospective matching, reusable knowledge, complete SMS integration and correction lifecycle |
| Maintenance | Canonical runs/challenges, settlement and immutable reviews | Integrate all real producers, expose agent work and verify meaningful terminal states |
| Delivery | Typed contracts and partial notification/reply foundations | Real producers, work-bound questions and authority-preserving reply resolution |

See the [implementation log](../../product/implementation-log.md) and engineering contracts for
exact evidence. The workflow manifest currently advertises position and maintenance resumption;
the other named ports remain unavailable. Contextual questions include interactive-user restrictions;
existing question tools are not proof of new contextual or SMS capability. Inventory callers and
permissions before widening a surface. Source presence must not become a claim of production use.

## 4. Financial sources and ledger

Retain source-native identities, provider revisions, timestamps, currency, ownership evidence and
freshness. Support account connection, selection, initial sync, ongoing sync, reconnect, exclusion,
disconnect, removal and export through explicit observable states. Manual accounts and supported
CSV/OFX imports remain first-class. Optional Venmo access remains separately feasibility-gated and
cannot delay generic sources. Do not silently use manual forwarding as automatic provider access.

Recognize an economic event once across imports, provider replay, pending replacement, both sides
of transfers and split allocations. Preserve user overrides independently from provider projection
refresh. Exact split cents sum to their parent; links and corrections are revisioned and reversible
where supported. Manual corrections prevail until explicitly revised; maintenance cannot overwrite
them with a lower-authority suggestion or learn a future rule without approval.

Distinguish purchase, transfer, refund, reimbursement, debt principal/interest, investment
contribution, income and valuation. A reimbursement expectation is neither income nor available
cash. Partial receipts retain the unmatched remainder; disputes and contradictory evidence become
work for an agent or person. Uncertain transfer matching never silently suppresses real spending.

## 5. One qualified financial position

All dashboards, budgets, forecasts, reports and tools use the same domain calculations and evidence
contract. Facts include cutoff, account/date scope, provenance, revision, freshness, quality and
missing-input reasons. Unknown is not zero. An unavailable source affects its dependent facts,
not unrelated usable records.

Expose separately: balances, posted spending, pending exposure, recurring/due obligations, debt,
investments, protected allocations, actual goal reservations, net worth and spendable capacity.
Avoid counting the same goal, bill, pending authorization, transfer or reserve twice. Budget
remaining is not spendable cash. A future expected paycheck is not current cash. Unknown account
ownership qualifies or excludes its totals rather than assigning 100% to the person.

Forecasts use dated reliable income and obligations, disclose assumptions and horizon, and show
pressure points and projected low balance. Scenarios are read-only comparisons until an authorized
plan change is committed. Wealth changes distinguish contributions, withdrawals, debt changes and
valuation where evidence supports the distinction. Unsupported detail remains unknown.

## 6. Setup and plans

Progressively collect account purposes/ownership, dependable income and timing, essential bills,
debt minimums/APRs, reserves, goals, discretionary priorities and desired communication. Reuse
current account knowledge and earlier answers. Confirm uncertainty; distinguish unknown, zero,
explicit none and skipped. An agent may conduct the interview, and the app offers direct controls.

Build an exact-cent proposed monthly plan with obligations, debt minimums, category allocations,
goal contributions and a chosen buffer. Separate recurring resources, uncertain income and
one-time funds. Explain deficits and unfunded goals instead of inventing income or borrowing.
Record exact source/profile/plan revisions on approval. One human-approved monthly baseline remains
immutable; later plan versions and actuals remain comparable to it.

Category limits, flexible grouped spending, and optional envelope/zero-based views share one
allocation ledger. Flexible groups cannot allocate the same dollar to every child. Zero-based mode
requires assigning all declared plan resources, while an unfunded or unknown resource remains
explicit. Envelope balances are planning amounts; only explicit cash reservations affect funded
goals or spendable cash. Views must not introduce a second financial truth.

## 7. Carryover and period boundaries

Each category explicitly selects `none`, `surplus_only`, or `surplus_and_deficit`. For a finalized
month, calculate category remainder from opening carryover plus the active month's allocation
minus settled category spending. `none` carries zero; `surplus_only` carries the positive remainder;
`surplus_and_deficit` carries the signed remainder. Show the opening carryover separately from new
monthly funding. Positive carryover is an allocation, not new income or proof of cash on hand.

For example, a $400 allocation with $350 spent yields $0 or $50 carryover according to policy;
$450 spent yields $0 or -$50. A deficit remains visible even when policy does not carry it.
Unresolved pending exposure and late source activity keep closure provisional. A later correction
creates a traceable carryover adjustment and a stale-plan/review indication, never rewrites the
original approved baseline. Do not claim a finalized balance while required evidence is missing.

Rollover is idempotent by owner/category/month and source revision. Policy changes take effect for
the explicit future boundary shown in their preview; they do not silently alter closed months.
Insufficient verified resources or a negative category balance produces a funding question, not
fabricated money. Currency and timezone are explicit in period identity; changing timezone cannot
reset usage or create another approved monthly baseline.

## 8. Bounded reallocation policy

The user approves the exact eligible categories, allowed directions, per-change dollar cap,
cumulative monthly dollar cap, percentage bound and category protected minimums. All constraints
must pass. Budget authority is separate from review bypass, factual answers and knowledge. It
cannot authorize borrowing, reserve withdrawals, increased assumed income, or changing its own
limits. Disabling authority remains available even when evidence is stale.

Detailed rule proposed for written review: percentages bound each category's cumulative automatic
increases and decreases separately against its immutable original monthly allocation. They do not
use a dynamically enlarged plan or carryover as the denominator. Each transfer counts once by
amount toward the monthly dollar cap, and both categories consume directional percentage capacity.
Reverse transfers do not erase used capacity. A zero baseline permits no percentage-authorized
automatic change; a human may approve an exact exception without silently raising future limits.

A protected minimum is the category's current-month allocation floor, not its bank balance or
promise of unspent cash. Reallocation also cannot remove funding already consumed or committed.
The preview exposes baseline, current allocation, spending/commitments, proposed result, floors
and remaining policy capacity. Missing position, usage or applicable evidence denies automatic
execution rather than treating missing use as zero.

Approval/commit locks and rereads policy, current plan, position, category dependencies and monthly
usage. A transfer is atomic, zero-sum and idempotent. Competing small transfers cannot exceed caps.
Policy edits and new plan versions do not reset monthly usage. Crossing a boundary produces an
exact review; it does not quietly normalize overspending by changing the baseline. Record before/
after amounts, policy, source revisions, actor, explanation, receipt and recovery evidence.

## 9. Goals, questions, context and knowledge

Goals expose target amount, optional date, priority, planned contribution, actual funded amount,
progress evidence and shortfall. A planned $200 is not $200 saved. An explicit reservation of
verified existing cash may fund a goal without a bank transfer; that reservation reduces unassigned
cash. A confirmed transfer and reservation for the same funding cannot count twice. Release or
reassignment is explicit and audited. Account shortfalls qualify goals instead of inventing funds.

Questions, exact proposals and repairs retain existing stable Finance identities in unified
Reviews. Agents can discover, create where authorized, answer and resolve them with explicit
receipts. Recording an answer is separate from applying a financial decision. Prospective context
can exist before a transaction and later support matching; it can be revised, cancelled, disputed
or explicitly expired. Matching ambiguity remains available for agent judgment.

Agents can save reusable facts into the shared brain with message/record provenance. Later agents
reuse the same knowledge rather than interrogating the person again. Preserve user statements
versus inferred meaning and never convert either into budget authority. Transaction corrections
remain local; proposals for future merchant rules require independent preview and approval.

## 10. Maintenance, reviews and app

One canonical maintenance workflow accepts outstanding work, an exact window, or a supported
target. It synchronizes/inspects sources, runs authorized deterministic cleanup, calculates position,
assembles knowledge/evidence, and exposes judgment work and permitted next operations to agents.
It can resume from another authorized session. Verification reads authoritative resulting state;
unapplied suggestions do not count as completed work or financial improvements.

Readiness distinguishes useful partial bookkeeping from a fully reconciled period. Missing required
position evidence blocks a maintained claim; questions can remain with explicit qualified results
where the domain contract allows. Reviews preserve cutoff, coverage, changes, plan versus actuals,
cashflow/debt/goal/wealth measures and unresolved work. External agents may attach evidence-backed
advice and explanations; templates can render deterministic summaries without claiming reasoning.

App surfaces: overview, transactions, questions/Reviews, budget editor and policy preview, cashflow,
accounts/repair, wealth, goals, recurring bills/subscriptions, reports/export, and settings. Show
actual and planned values distinctly, expose evidence on demand, and make corrections and revocation
directly available. Insights/watchlists use explicit thresholds and observed changes; agents
interpret their significance. Advice must identify its author and supporting revisions.

Adaptive coaching is exposed as shared preference and notification history. Agents can select
useful questions and become quieter as knowledge improves. The toolkit enforces quiet hours,
deduplication and reminder intervals; optional check-ins do not authorize repeated nagging or a
nohmi-owned recurring reasoning task.

## 11. Completion sequence and acceptance

1. **Usable Finance conversation:** finish discoverable questions, real SMS binding/answers,
   fresh-session retrieval, authorized resolution and the same app result. No host certification.
2. **Trustworthy position and planning:** converge all financial consumers, complete setup and
   baseline approval, goals, recurring activity and forecast qualification.
3. **Bounded budget automation:** finish policy activation and usage enforcement, all carryover
   modes, period repair and app/API/MCP controls.
4. **Full Finance toolkit:** complete modes/views, shared knowledge and prospective matching,
   reports, watchlists, subscriptions and evidence-backed review/advice support.

Plans must decompose these into small domain-owned changes using current source rather than
rebuilding delivered foundations. Acceptance includes exact cents, duplicate imports/provider
events, pending replacement, transfers, partial reimbursement, ownership gaps, shared goal funding,
late period corrections, cap races, stale approvals, zero baselines, reverse-transfer capacity,
read-only/revoked callers, manual correction races, agent handoff and wrong-owner access.

Use real database tests for invariants/locking/migrations, contract tests for API/MCP, and desktop/
mobile journeys for setup, approval, correction and recovery. Future implementation PRs run
`pnpm verify`. Real connector and SMS evidence requires separately authorized provider journeys;
passing tests or draft policies cannot establish production activation. A missing agent leaves work
pending and inspectable; it is not a failure of nohmi to host or wake that agent.
