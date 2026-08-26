# Finance Agent Operating Model Design

- Status: Proposed
- Date: 2026-08-17
- Scope: Finance ledger stewardship, MCP behavior, review behavior, maintenance, planning, mixed merchants, reimbursements, and user-facing review
- Relationship to shipped behavior: This document defines the approved target design. It does not claim that the described runtime capabilities are already shipped.

## Context

The Finance workspace is an accounting ledger and planning workspace. A person connects financial accounts and data in the signed-in ilo application, then grants an agent access to the ilo MCP. The agent should be able to understand the person's financial position, interview them for material missing facts, help establish a budget and plan, maintain the ledger, surface uncertainty, and monitor the plan over time.

The Finance MCP does not connect institutions, administer provider connections, move money, trade, pay bills, or file taxes. Those are not latent capabilities waiting for more permission; they are outside the product boundary.

The existing Finance implementation already contains accounts, transactions, categories, merchants, classification evidence, review cases, transfer reconciliation, budgets, income streams, recurring obligations, alerts, cash-flow forecasting, maintenance runs, and a default-off review-bypass setting. The target design makes those pieces operate as one coherent agent workflow and closes important gaps around mixed merchants, transaction splits, reimbursements, semantic self-review, and durable period reviews.

## Goals

1. Give an agent a short, natural path to understand and maintain a person's finances.
2. Let the same MCP calls work whether changes require review or apply immediately.
3. Keep review bypass controlled only by the signed-in person in the web app.
4. Let confident ledger work proceed without forcing the agent to guess through uncertainty.
5. Represent mixed purchases, personal shares, reimbursements, refunds, transfers, and ordinary spending accurately.
6. Make `maintain_finances` a durable professional-quality Finance turn rather than a batch of CRUD calls.
7. Add a connected-agent challenge pass that red-teams the proposed final ledger before settlement.
8. Produce a concise, reproducible period review with evidence, assumptions, unresolved questions, recommendations, and next actions.
9. Keep the MCP surface small enough that an agent can discover and use it correctly.

## Non-Goals

- Connecting, disconnecting, or authenticating financial institutions through MCP.
- Moving money or initiating transfers.
- Buying, selling, or rebalancing investments.
- Paying bills.
- Filing taxes or presenting ilo as a tax preparer.
- Presenting ilo as a licensed accountant, fiduciary, or financial adviser.
- Treating model confidence as evidence.
- Turning every user answer into a permanent merchant or categorization rule.
- Adding a separate MCP tool for every professional role, calculator, or maintenance step.

## Product Model

The Finance Ilo combines the useful responsibilities of five professional disciplines:

1. **Bookkeeper / ledger accountant:** ingest, reconcile, classify, preserve support, and isolate exceptions.
2. **Management accountant:** connect goals to budgets and forecasts, explain material variance, and propose corrective action.
3. **Financial planner:** understand circumstances, prioritize goals, compare alternatives, record assumptions and tradeoffs, implement the selected plan, and monitor it.
4. **Financial coach:** make cash flow, bills, debt, savings, and the next useful action understandable.
5. **Auditor / records organizer:** preserve provenance, distinguish facts from estimates, and challenge unsupported or inconsistent conclusions.

These disciplines form one recurring loop:

```text
close the ledger
→ diagnose the position
→ compare choices
→ agree the plan
→ challenge the resulting ledger
→ monitor and update
```

The agent is not asked to select a role. The domain playbook owns the sequence and returns the work needed at each stage.

## Core Invariants

### Authority

- `reviewBypassEnabled` remains a per-user Finance setting and defaults to `false`.
- Only a signed-in user in the web app may change it.
- Agent tokens do not encode, grant, revoke, or mutate review bypass.
- The API reads the setting at the time a semantic action is prepared or committed.
- Provider connections, account administration, imports, and the bypass switch remain signed-in-user-only.
- Supported internal-ledger actions remain available to an appropriately scoped agent in either review mode.

### Action outcomes

Every semantic Finance action has one disposition:

```ts
type FinanceActionOutcome<T> =
  | { status: "applied"; result: T }
  | { status: "pending_review"; review: FinanceActionReview }
  | { status: "needs_input"; question: FinanceQuestion };
```

- Bypass enabled: justified, sufficiently supported work applies immediately.
- Bypass disabled: the same justified work becomes a pending approval.
- Either mode: missing knowledge or genuine ambiguity becomes a question.
- Bypass never lowers confidence thresholds, invents facts, or converts ambiguity into permission.

### Facts and evidence

Material facts that drive questions, plans, recommendations, or mutations carry evidence metadata:

```ts
type FinanceFactEvidence<T> = {
  value: T | null;
  basis: "user_stated" | "ledger_observed" | "calculated" | "estimated" | "missing";
  asOf: string | null;
  sourceRefs: MaterialSourceReference[];
  confidence: "high" | "medium" | "low" | null;
};
```

Facts, inferences, preferences, recommendations, and permissions remain distinct. If required evidence cannot be obtained, the agent narrows the conclusion and states what remains unknown.

### Learning

- A transaction answer applies to that transaction by default.
- A reusable rule requires explicit intent such as `applyToFuture: true`.
- Repeated confirmations may increase evidence but do not override evidence that a merchant is variable.
- Corrections reduce confidence in the affected inference or rule.
- The system does not ask the same resolved question again unless new or conflicting evidence makes it relevant.

## Canonical Agent Interaction

The normal onboarding and planning path is:

```text
get_ilo_context
→ get_finance_status
→ interview only for material missing facts
→ update_finance_profile
→ compare_finance_scenarios when a material tradeoff exists
→ set_finance_budget_plan
→ maintain_finances
→ complete the returned ledger challenge when requested
→ answer_finance_question as the user supplies missing facts
→ get_finance_status
```

The agent does not need to call every lower-level read before onboarding. `get_finance_status` provides the authoritative orientation, while surgical reads remain available for drill-down.

## Finance Status

`get_finance_status` is self-contained and reports:

- review-bypass state without offering a mutation;
- connected accounts, source freshness, blocked sources, and evidence cutoff;
- close readiness: reconciled-through date, uncategorized items, unmatched transfers, duplicates, missing provenance, and unanswered exceptions;
- cash, debt, investments, other assets, and net worth;
- stated and observed income and their evidence basis;
- average spending, current month spending, budget total, and meaningful variance;
- dated cash-flow events, projected lowest balance, and reserve runway;
- recurring obligations and income streams that are missing, changed, or stale;
- prioritized goals, target dates and amounts, feasibility, progress, and conflicts;
- debt position and payoff priority where known;
- investment allocation, concentration, liquidity/time-horizon mismatch, and willing-versus-able risk mismatch where data supports it;
- open reimbursements, overdue reimbursements, and unmatched likely reimbursement credits;
- pending approvals, unanswered questions, active/recoverable maintenance work, and latest period review;
- ordered interview questions and one recommended next operation.

Status should not turn every displayed number into a verbose evidence object. Evidence wrappers are used where provenance materially affects a decision.

## Financial Profile and Plan

The effective-dated Finance profile includes employment and income information plus material planning facts that cannot be inferred reliably:

- household size and dependents;
- housing status and monthly housing cost;
- emergency-reserve preference;
- investment-risk willingness;
- investment-risk capacity;
- other existing pay and employment fields.

Home location remains canonical user data. Goals and motives remain canonical shared records and are referenced rather than copied into the Finance profile.

Risk willingness and capacity are separate because comfort with volatility is not the same as the financial ability to absorb loss.

### Scenario comparison

`compare_finance_scenarios` is read-only. It accepts a bounded baseline and up to five alternatives covering budget allocations, income or housing changes, reserve contributions, and debt-payment changes over a defined horizon. It returns:

- monthly cash-flow effect and projected lowest balance;
- reserve runway;
- debt payoff and goal-date effects where inputs support them;
- assumptions, missing inputs, sensitivity warnings, and goal conflicts;
- a stable fingerprint that may be referenced by the selected budget plan.

It is optional. A straightforward first budget does not require an extra scenario turn.

### Atomic budget plan

`set_finance_budget_plan` updates the complete plan in one semantic operation. It carries allocations, month, referenced goals, assumptions, rationale, replace/upsert intent, and an optional scenario fingerprint. It validates capacity against the best available income evidence but permits an explicitly explained over-allocation.

## Mixed Merchants and Transaction Splits

Merchant identity is evidence, not a category.

Each merchant has a categorization behavior:

- `unknown`: insufficient history;
- `consistent`: merchant evidence may contribute enough support for a category;
- `mixed`: merchant identity alone can never justify a category.

The behavior may be explicitly set or inferred from category diversity, corrections, provider detail, and transaction history. Known broad retailers may begin with a mixed prior, but the system does not rely solely on a global brand list.

For a mixed merchant such as CVS, Target, Walmart, Costco, or Amazon:

- prior merchant-only classifications remain suggestions;
- transaction-specific evidence such as provider detail, descriptor variants, notes, receipt information, and user answers may justify a category;
- insufficient evidence produces a bounded question;
- the ordinary answer applies only to the current transaction;
- a permanent merchant rule is a separate explicit action and must disclose its breadth.

A purchase may contain more than one category. `finance_transaction_allocations` preserve the original bank transaction while dividing its amount into owned allocations. Allocation amounts must sum exactly to the source transaction amount. A single-category transaction has one allocation; it does not require special treatment in the UI.

The surgical operation `set_finance_transaction_breakdown` atomically sets category allocations and may mark one or more allocations as reimbursable. It uses the same three-outcome action contract.

## Reimbursements

A reimbursement is not ordinary income, a refund, or a note. It is a first-class ledger lifecycle.

### Data model

`finance_reimbursements` records:

- user ownership;
- one or more source expense allocations;
- expected amount;
- payer when known;
- expected date when known;
- status: `expected`, `partially_received`, `received`, `overdue`, `cancelled`, or `needs_input`;
- evidence, rationale, and revision.

`finance_reimbursement_matches` allocates one or more incoming credit transactions across one or more reimbursement cases. This permits partial repayments, multiple payers, and combined payments.

### Reporting semantics

For a $310 dinner with $220 expected back:

- the cash ledger records the full $310 outflow;
- personal Dining spending is $90;
- $220 is shown as outstanding reimbursement;
- cash-flow history shows that the full amount left the account;
- `safeToSpend` does not assume an unreceived reimbursement will arrive;
- a confirmed future reimbursement may appear as a projected inflow, but remains visibly uncertain until posted;
- cancelling or abandoning the reimbursement returns the unmatched amount to personal spending.

The UI and period review distinguish gross cash spending, personal spending, reimbursements received, and reimbursements outstanding.

### Detection and follow-up

Maintenance uses personal baselines rather than one universal dollar threshold. It considers merchant history, category history, robust amount distribution, current budget materiality, descriptor evidence, and known reimbursement patterns. It asks only when the transaction is materially unusual and reimbursement is plausible.

Example:

> This $310 restaurant charge is materially higher than your normal dining activity. Was this entirely your expense, or do you expect anyone to reimburse part of it?

Answers include entirely mine, fully reimbursable, partially reimbursable, and not sure yet.

Maintenance then:

- scans later credits for exact, partial, and combined matches;
- asks before linking an ambiguous credit;
- can look backward from a new Venmo, Zelle, PayPal, employer, or other credit to an older expense;
- tracks overdue expected reimbursements;
- never treats a reimbursement match as a reusable merchant rule.

`reconcile_finance_reimbursement` is the exact surgical operation for linking or adjusting credit allocations. It is distinct from transfer reconciliation and refund/reversal handling.

## Durable Maintenance Turn

`maintain_finances` starts, resumes, or verifies one durable Finance-owned turn for all outstanding work, a bounded window, or an exact target. It does not synchronously perform an unbounded loop inside MCP.

The target step graph is:

```text
preflight
→ synchronize
→ reconcile
→ prepare
→ questions
→ budget_and_health_projection
→ challenge_prepare
→ awaiting_agent_challenge
→ challenge_resolve
→ commit_or_queue_review
→ health_refresh
→ verify
→ period_review
```

### Mechanical work

Mechanical work runs in either review mode:

- synchronize already-connected sources;
- repair and reconcile deterministic transfers;
- recompute derived totals and forecasts;
- detect recurring activity and likely issues;
- build the candidate ledger and question set.

### Semantic work

Semantic decisions are prepared before final commit:

- categorization and transaction splits;
- reimbursement expectations and matches;
- recurring-state decisions;
- merchant changes and rules;
- alert decisions;
- budget/profile changes initiated within the turn.

The candidate ledger is an overlay of the current ledger plus prepared changes. It lets the challenge pass inspect the result that would exist after the batch without prematurely committing it.

After challenge resolution:

- bypass enabled applies the vetted batch atomically or through durable per-item fences;
- bypass disabled creates one maintenance approval with bounded drill-down;
- genuine uncertainty remains separate answerable questions;
- the run does not create dozens of approval cards.

## Connected-Agent Ledger Challenge

The ledger challenge is a semantic second pass, not a renamed deterministic verification step. It asks whether the proposed final ledger makes sense.

The connected agent performs the challenge. Ilo does not introduce a hidden server-side model provider that duplicates the connected agent and creates another credential, transport, cost, and recovery boundary.

### Durable checkpoint

After preparing the candidate ledger, the run enters `awaiting_agent_challenge`. `maintain_finances` returns a durable challenge assignment containing:

- run ID, scope, period, evidence cutoff, rulebook version, and candidate-ledger revision;
- every automatic decision in scope;
- relevant user-confirmed and manually categorized comparisons;
- category and merchant history;
- recent corrections and rules used;
- transaction splits and reimbursement cases;
- budget, profile, income, recurring, and prior-period baselines;
- source references, pagination/recovery links, and a versioned challenge rubric.

For weekly maintenance, the challenge covers activity since the previous successful review with month-to-date context. For month-end maintenance, it covers the full month with trailing baselines. Exact/window scopes retain their selected evidence window and receive sufficient historical context for comparison.

Large challenges are paginated and checkpointed. The run remains recoverable if the agent disconnects.

### Challenge rubric

The returned rubric requires the agent to look for:

- mixed merchants categorized too uniformly;
- conflicting categories for equivalent merchant evidence;
- rules broader than their supporting evidence;
- auto-categorizations inconsistent with prior user corrections;
- unusual amounts relative to the person's merchant/category history;
- plausible group, work, travel, or other reimbursable spending;
- missing, overdue, partial, or ambiguously matched reimbursements;
- refunds recorded as income or reimbursements recorded as refunds;
- transfers and debt payments incorrectly counted as spending;
- duplicate, reversal, pending-to-posted, or allocation inconsistencies;
- overuse of vague categories such as Shopping or Other;
- recurring obligations, income assumptions, budgets, goals, or profile facts that appear stale;
- unexplained period-over-period changes;
- rule drift, recent correction clusters, and unsupported high-confidence decisions;
- totals that are technically valid but misleading because material activity is unresolved.

The challenge also reports coverage and cleared checks. A no-findings result without coverage is invalid.

### Submission

`submit_finance_ledger_challenge` accepts structured findings:

```ts
type FinanceLedgerChallengeSubmission = {
  runId: string;
  candidateRevision: string;
  coverage: {
    transactionsReviewed: number;
    automaticDecisionsReviewed: number;
    reimbursementCasesReviewed: number;
    rulesReviewed: number;
  };
  findings: Array<{
    kind: string;
    severity: "blocker" | "correction" | "question" | "observation";
    sourceRefs: MaterialSourceReference[];
    evidence: string;
    rationale: string;
    proposedAction: string | null;
  }>;
  clearedChecks: string[];
};
```

The API rejects stale candidate revisions, out-of-scope sources, unsupported action kinds, incomplete coverage, and arbitrary replacement payloads. It stores concise evidence and rationale, not private chain-of-thought.

Challenge findings behave as follows:

- `correction`: modify or remove a prepared action through the same validated action path;
- `question`: create a bounded user question;
- `blocker`: prevent trusted settlement until repaired or explicitly narrowed;
- `observation`: include in the period review without manufacturing an action.

The challenger may dispute an earlier automatic decision, but it does not silently reverse a user-confirmed fact or classification. Conflicts with user-confirmed evidence become questions unless newer explicit evidence already resolves them.

Submission requeues the same run. It does not create a second maintenance run. If source or rulebook revisions changed during the challenge, the candidate is invalidated and rebuilt.

### Deterministic verify remains separate

After the challenge and commit, `verify` proves:

- source freshness and evidence cutoff remain current;
- rulebook and candidate revisions are valid;
- allocation sums and reimbursement matches satisfy invariants;
- no duplicate semantic action committed;
- approvals and questions are represented honestly;
- the resulting status matches the terminal disposition.

Challenge answers “does this make sense?” Verify answers “is it current, internally consistent, durably recorded, and complete?”

## Maintenance Settlement

Terminal and waiting states are explicit:

- `awaiting_agent_challenge`: the candidate ledger is ready for the connected agent's second pass;
- `awaiting_approval`: vetted semantic work is waiting for the signed-in person;
- `completed_with_questions`: all justified work is settled and genuine questions remain;
- `completed`: the selected scope is maintained with no unresolved work;
- `blocked`: missing/stale evidence prevents trustworthy completion;
- `failed_recoverable`: infrastructure or process failure can be retried;
- `failed_terminal`: the request or rulebook cannot be completed as submitted.

A finished process is not automatically a maintained ledger.

## Period Review

Every completed maintenance turn produces a durable `FinancePeriodReview` containing:

- selected period and evidence cutoff;
- connected-source freshness and reconciliation/close readiness;
- opening/closing position, income, gross cash spending, personal spending, savings, and cash-flow low point;
- reimbursements received, outstanding, overdue, cancelled, and unresolved;
- budget-versus-actual variance with only material explanations;
- goal and debt-plan progress;
- ledger work completed and rules used or proposed;
- challenge coverage, findings, corrections, and cleared checks;
- approvals waiting, unanswered questions, unresolved exceptions, and missing support;
- recommendations with evidence, assumptions, rationale, alternatives, tradeoffs, and disposition;
- what ilo will monitor next and which material changes the person should report.

The review is reproducible from stored inputs and revisions. It is not an ungrounded narrative.

## MCP Surface

The preferred high-level surface remains:

- `get_finance_status`
- `maintain_finances`

The small set of new exact operations is:

- `compare_finance_scenarios`
- `set_finance_budget_plan`
- `answer_finance_question`
- `set_finance_transaction_breakdown`
- `reconcile_finance_reimbursement`
- `get_finance_ledger_challenge` for exact/paginated recovery
- `submit_finance_ledger_challenge`
- `get_finance_period_review`

Existing transaction, category, merchant, recurring, alert, cash-flow, wealth, and review reads/writes remain available where useful. `resolve_finance_review` may remain temporarily as a compatibility alias for `answer_finance_question`.

The MCP server remains stateless. It validates typed input, calls the authenticated API client, and returns structured domain results. The expert rubric, sequencing, candidate ledger, challenge lifecycle, completion decision, and review artifacts live in the Finance API/domain.

## Review UI

Finances has one Review surface containing both questions and approvals.

### Questions

Questions appear first and explain:

- what is unknown;
- why the answer matters;
- the relevant transaction or evidence;
- bounded choices where possible;
- whether the answer applies once or may be promoted to a future rule.

Mixed purchases support an inline breakdown whose allocations must equal the transaction amount. Reimbursement questions support personal amount, reimbursable amount, payer, and expected date without forcing all optional facts.

### Approvals

Approvals explain:

- what will change;
- why the agent proposed it;
- the evidence and assumptions;
- material tradeoffs;
- the requesting agent and time;
- relevant transaction, reimbursement, maintenance-run, and challenge links.

One maintenance turn appears as one approval card with bounded drill-down.

### Review bypass setting

Use:

- Label: `Let agents apply confident Finance changes`
- Off: `Agents still do the work, but confident changes wait in Review.`
- On: `Confident changes apply immediately. Questions and ambiguous activity still come to Review.`

The switch appears only in the signed-in Finance settings surface.

## Dashboard Implications

The default Finance dashboard prioritizes:

- position and source freshness;
- current month personal spending versus plan;
- gross cash spending when materially different;
- projected low balance and reserve runway;
- outstanding Review work split into Questions and Approvals;
- reimbursements outstanding and overdue;
- latest period-review headline and material changes;
- goal progress and the next useful action.

Progressive disclosure leads from headline to period review, category/merchant detail, exact transactions, allocations, reimbursement cases, and evidence.

## Reliability and Recovery

- Maintenance runs, challenge packets, pages, submissions, approvals, and period reviews are durable.
- Candidate revisions fence stale agent submissions.
- Repeated identical submissions are idempotent.
- Process loss after challenge acceptance resumes the same run without repeating committed work.
- Large scopes checkpoint and paginate rather than depending on one request timeout.
- A disconnected agent leaves the run in `awaiting_agent_challenge` with an explicit recovery operation.
- Source or rulebook changes invalidate the candidate rather than silently mixing evidence versions.
- Private transaction content stays inside Finance-scoped results and is omitted from broad audit metadata.
- The challenge protocol is useful without a server-side model dependency. If a model host is ever added later, it requires its own external-boundary design and production evidence.
- Approving a maintenance batch revalidates transaction, allocation, reimbursement, source, and rulebook revisions before applying it; drift supersedes or rebuilds the affected proposal rather than committing stale work.

## Testing and Acceptance

### Mixed merchants

- Two Health confirmations at CVS do not make a later CVS purchase automatically Health once merchant variability is known.
- Conflicting confirmed categories infer or preserve `mixed` behavior.
- A split CVS transaction allocates exactly to the source amount and reports correctly by category.
- A one-time answer does not create a permanent rule.

### Reimbursements

- A partially reimbursable dinner preserves gross cash outflow and reports only the personal share against Dining.
- Full, partial, multi-payer, and combined reimbursement matches reconcile correctly.
- Ambiguous credits create questions rather than automatic matches.
- Overdue reimbursement cases surface in status and maintenance.
- Cancelling a reimbursement returns the unmatched amount to personal spending.

### Challenge

- A weekly run reviews new activity with month-to-date context.
- A month-end run reviews the full period with trailing baselines.
- The challenge catches a mixed merchant categorized uniformly, a likely reimbursement, a refund classified as income, and a stale recurring assumption.
- A no-findings submission without coverage is rejected.
- Stale or out-of-scope source references are rejected.
- Challenge corrections alter the prepared batch before commit.
- Challenge questions remain questions even when review bypass is enabled.
- Disconnect/retry resumes the same challenge without duplicating findings or mutations.

### Review modes

- Identical MCP action calls apply with bypass enabled and create approvals with bypass disabled.
- The same maintenance candidate and challenge are produced in both modes.
- Bypass disabled produces one maintenance approval, not one card per categorization.
- Neither mode permits unsupported guesses.

### Conversation-level acceptance

1. The agent reads status and interviews only for material missing facts.
2. The agent establishes the profile and plan.
3. Maintenance prepares categorizations, transaction splits, reimbursements, and genuine questions.
4. The connected agent completes the returned challenge rubric over the candidate ledger.
5. Challenge corrections are folded into the batch and challenge questions remain answerable.
6. The vetted batch applies or waits as one approval according to the app setting.
7. Deterministic verification settles the run honestly.
8. Final status and period review explain the maintained ledger, outstanding work, important statistics, and next monitoring responsibility.

## Primary Research References

- [CFP Board Practice Standards for the Financial Planning Process](https://www.cfp.net/ethics/compliance-resources/2020/01/practice-standards-for-the-financial-planning-process)
- [CFP Board Monitoring and Updating Progress](https://www.cfp.net/ethics/compliance-resources/2019/04/focus-on-ethics---monitoring-and-updating-progress)
- [AICPA Personal Financial Planning Body of Knowledge](https://www.aicpa-cima.com/resources/article/personal-financial-planning-body-of-knowledge-bok)
- [CFPB Your Money, Your Goals toolkit](https://www.consumerfinance.gov/consumer-tools/educator-tools/your-money-your-goals/toolkit/)
- [IMA Strategy, Planning, and Performance competencies](https://www.imanet.org/career-resources/competency-framework/strategy-planning-performance)
- [FINRA Know Your Risk Tolerance](https://www.finra.org/investors/insights/know-your-risk-tolerance)
- [IRS Recordkeeping](https://www.irs.gov/businesses/small-businesses-self-employed/recordkeeping)

## Decision Summary

The Finance agent uses one status-first workflow and one durable maintenance turn. Review bypass controls whether supported semantic work applies or waits; it never controls whether the agent does the work or whether uncertainty is ignored. Mixed merchants are explicitly modeled, transactions can be split, reimbursements have a real lifecycle, and the connected agent must challenge the candidate ledger before final commit. Deterministic verification and a durable period review complete the turn.
