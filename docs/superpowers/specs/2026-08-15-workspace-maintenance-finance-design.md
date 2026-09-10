# Workspace maintenance and Finance design

**Date:** 2026-08-15
**Status:** Approved in conversation
**First implementation:** Finances

## Goal

Give every ilo workspace a predictable maintenance contract while shipping Finances as the first
complete implementation. An authorized MCP client should be able to express only the intent
`maintain finances`; ilo must inspect current state, perform every action allowed by the approved
rulebook, isolate genuine uncertainty, prepare consequential proposals, verify the result, and
return an honest health assessment.

The MCP client is not part of the implementation. Ilo does not configure, schedule, or rely on any
external host. Correctness, progress, authorization, recovery, and auditability remain server-owned.

## Problem

Ilo currently exposes useful low-level Finance reads and one categorization preview, but no
authoritative operating loop. A client must decide which tools to call, paginate the ledger, order
work, remember progress, interpret confidence, and verify the result. Different clients can reach
different outcomes, and an interrupted run has no durable checkpoint.

The current shared assistant surface provides context, setup, domain guidance, attention items,
activity, and a daily brief. The Finance MCP surface provides guided setup, overview, wealth, cash
flow, ledger health, transactions, categories, budgets, merchants, the review queue,
categorization proposals, and attention-item creation. It does not provide either of the two
workspace-level jobs this design requires:

1. determine whether the workspace is healthy and what remains uncertain; and
2. drive the workspace toward a clean, verified state.

Production evidence also demonstrates why orchestration cannot live in a client prompt. All 17
connected accounts are stale, while the overview presents zero current-month activity and zero
items needing judgment. Ledger health separately reports 1,208 unresolved reviews and 1,208
transfer candidates. Hosted and local logs show the scheduled Plaid sync failing repeatedly.
Production credentials succeed against Plaid production, but the ECS task has used
`PLAID_ENV=sandbox` since task revision 45 on July 30. The system does not persist a classified sync
failure or backoff and therefore retries misleadingly while continuing to label the accounts
connected.

## Chosen approach

Define a shared workspace-maintenance protocol and expose one domain-owned tool pair per
workspace:

```text
get_<workspace>_status
maintain_<workspace>
```

Finances ships first as:

```text
get_finance_status
maintain_finances
```

The tool names, lifecycle, status envelope, scopes, run states, approvals, questions, and
verification semantics are consistent across workspaces. Each domain retains its own evidence,
rules, mutations, recovery behavior, and least-privilege scopes. Later Mail, Calendar, Tasks, and
other workspace implementations are separate vertical projects.

### Rejected alternatives

- **One generic `get_workspace_status` / `maintain_workspace` pair:** this hides domain authority,
  produces a cross-domain god tool, weakens discoverability and least-privilege metadata, and moves
  business decisions toward the MCP adapter.
- **Keep granular tools and improve prompts:** prompts cannot provide durable progress,
  idempotency, concurrency control, consistent policy, or authoritative verification. This leaves
  correctness dependent on the client.
- **A Finance-only work index with no shared protocol:** this improves one screen but fails to
  establish the repeatable workspace contract the product needs.

## System boundary

The existing ownership model remains authoritative:

- `packages/domain` owns the shared maintenance contracts and Finance-specific evidence and policy
  schemas.
- `packages/database` owns durable runs, steps, leases, proposals, and Finance persistence.
- `packages/connectors` owns Plaid transport and provider-error normalization.
- `apps/api` owns authenticated coordination, Finance rules, durable execution, authorization,
  audit, and verification.
- `packages/api-client` exposes the typed public API.
- `apps/mcp` remains a stateless adapter over the API and forwards only the caller's scoped token.
- `apps/web` presents status, source freshness, questions, evidence, and approvals.

Neither MCP nor the web application calls Plaid or PostgreSQL directly. No MCP client owns a
maintenance checkpoint, retry loop, confidence threshold, or financial rule.

## Shared workspace contract

### Status

Every maintained domain returns the shared envelope:

```ts
type WorkspaceMaintenanceState = "clean" | "needs_work" | "needs_input" | "blocked";

type WorkspaceStatus<TDetails> = {
  asOf: string;
  domain: AssistantDomain;
  state: WorkspaceMaintenanceState;
  freshness: {
    observedAt: string;
    state: "current" | "stale" | "partial" | "unavailable";
    blockers: WorkspaceBlocker[];
  };
  work: {
    actionable: number;
    awaitingApproval: number;
    awaitingInput: number;
    blocked: number;
    oldestOutstandingAt: string | null;
  };
  activeRun: MaintenanceRunSummary | null;
  details: TDetails;
  validNextOperations: MaintenanceOperation[];
};
```

Counts are authoritative or explicitly bounded. Partial domain failure never becomes an
authoritative zero. A requested date window narrows the detailed assessment but does not hide the
existence and age of older backlog.

### Maintenance scopes

The shared scope union represents the two requested workflows:

```ts
type MaintenanceScope =
  | { type: "all_outstanding" }
  | { type: "window"; start: string; end: string }
  | { type: "target"; entityType: string; id: string };
```

- `all_outstanding` is the no-argument default and drives the workspace as close to clean as policy
  permits.
- `window` handles all work whose relevant evidence falls inside an inclusive date range while
  still reporting older backlog.
- `target` re-evaluates or processes one source-linked entity, answered question, or approved
  proposal under the current rulebook. It does not manufacture the person's answer or approval.

### Durable run

`maintain_<workspace>` resumes the caller's compatible active run or creates a new run. A run stores
its normalized scope, rulebook version, source snapshot, steps, checkpoint, lease, idempotency key,
applied actions, questions, proposals, failures, audit references, and verification result.

Run states are:

```text
queued
running
completed
completed_with_questions
awaiting_approval
blocked
failed_recoverable
failed_terminal
```

The API continues durable work independently of the MCP connection. The MCP call may wait briefly
for progress, but it returns a stable run reference when work continues. Repeating the no-argument
call resumes or reports the compatible run instead of creating duplicate work. The normal tool
contract does not require MCP Tasks; task support may be advertised only when the public API owns
the complete durable lifecycle and the connected host supports it.

## Finance MCP contract

### `get_finance_status`

The read-only status tool accepts an optional scope, defaulting to all Finance state. It returns:

- account connection and synchronization health;
- ledger freshness, coverage, pending activity, transfer candidates, possible duplicates, and
  provenance gaps;
- outstanding classifications grouped by reason and age;
- current budget coverage, pace, forecast, and proposals;
- income, cash flow, savings, debt, investment, account, goal, and motive evidence;
- the Finance health assessment and its confidence;
- pending questions and approvals; and
- the current rulebook version and valid next operations.

The tool performs no refresh or mutation. If current data is not trustworthy, it reports stale,
partial, or blocked state and never converts absence into zero spending.

### `maintain_finances`

The normal call requires no arguments:

```ts
maintain_finances()
```

Optional input narrows the operation:

```ts
type MaintainFinancesInput = {
  scope?: MaintenanceScope;
};
```

The client does not provide confidence, pagination, batching, retry, checkpoint, ordering, or
mutation-policy arguments. Those are server-owned safeguards. The result provides a concise text
summary and structured run state, changes, questions, proposals, blockers, health, verification,
and first-party work-surface links.

The tool requires `finances:write` and uses the `approved_rule` policy. It may execute only actions
already authorized by the versioned rulebook. It clearly identifies any `approve_each` artifact
that still needs the signed-in person, but it cannot supply that approval or broaden its own
authority. A token with only `finances:read` can discover status but not maintenance.

Existing granular tools remain available for inspection, compatibility, and expert workflows. The
status/maintenance pair becomes the preferred path and the public `review_finances` prompt is
reduced to a client-agnostic pointer to these tools; correctness does not depend on the prompt.
Existing generic goal, motive, and domain-profile tools remain the MCP write surface for personal
direction. Finance status and maintenance consume their approved state rather than duplicating
those mutations.

## Finance maintenance lifecycle

A Finance run executes these server-owned stages:

```text
preflight and acquire lease
→ synchronize accounts
→ ingest and normalize transactions
→ reconcile proven transfers
→ identify possible duplicates
→ apply approved permanent rules
→ apply eligible one-off classifications
→ create or refresh uncertainty questions
→ prepare or evaluate the monthly budget
→ calculate financial health
→ verify authoritative state
→ release lease
```

Each step commits independently with a deterministic idempotency key and advances the durable
checkpoint only after its audit records commit. A bounded failure preserves completed work and
records whether the step can retry. A new invocation resumes at the first incomplete step.

The default run covers all outstanding work and evaluates the current calendar month. A windowed
run mutates only eligible evidence inside the window. It still reports older work in its final
status so a narrow recurring invocation cannot make an accumulated backlog invisible.

## Rulebook and authority

The Finance rulebook is server-owned, versioned, and assembled from:

- the approved Finance domain profile;
- active goals and motives;
- confirmed merchant and category rules;
- account roles and budget-inclusion choices;
- the active budget and pending budget proposals;
- approved maintenance permissions; and
- deterministic evidence and safety thresholds.

Every run records the version it loaded. If the rulebook changes before a mutation, the API stops
further writes, refreshes status, and either revalidates the remaining work or creates a new run.
A draft profile is context only and never execution authority.

### Action tiers

1. **Deterministic:** apply confirmed merchant rules, previously approved mappings, provider
   identity updates, and transfers with a proven internal counterpart automatically.
2. **Eligible one-off:** apply a transaction-only classification when server-owned evidence meets
   the approved threshold and contains no conflict. Do not create reusable evidence from that
   action.
3. **Uncertain:** create or refresh one source-linked question when evidence conflicts or remains
   incomplete. Never guess in order to make a count reach zero.

Pending transactions cannot create permanent rules. Model self-reported confidence is not mutation
authority. Transfer and duplicate decisions require deterministic ledger evidence. Permanent
merchant rules require explicit approval unless the user has previously approved an equally
specific rule-creation policy.

### Questions

Questions are durable, deduplicated, linked to source evidence, and phrased as bounded decisions.
Supported Finance outcomes include:

- categorize this transaction only;
- always categorize this merchant under the stated scope;
- confirm or reject an internal transfer pair;
- exclude or include the transaction in budget spending;
- accept or revise a budget proposal; and
- defer or dismiss the question with a recorded reason.

The first-party Finance or Agent access work surface resolves questions through narrowly scoped
human API mutations. A target-scoped `maintain_finances` call can re-evaluate or process that source
after the answer exists, but it cannot answer the question for the person. This keeps the one
maintenance tool on a consistent `approved_rule` policy while preserving one-click human decisions.

## Budget behavior

Routine maintenance may assess the active budget and prepare a complete monthly proposal. Creating
or revising budget limits always requires one explicit approval of the full proposal. The proposal
contains:

- period, income basis, and source freshness;
- category limits and total planned spending;
- savings and investment contributions;
- irregular or sinking-fund allocations;
- comparison with recent observed spending;
- conflicts with active goals or obligations;
- expected cash-flow and safe-to-spend effect; and
- the evidence version used to calculate it.

Approval is optimistic: if underlying transactions, income, goals, or the active budget change,
the stale proposal cannot commit. The API prepares a replacement for review. One approval commits
the complete proposal atomically and emits itemized audit evidence. Maintenance never silently
rebalances category limits simply to make current spending appear healthy.

## Financial-health assessment

Ilo reports data confidence separately from financial health. Missing or stale evidence lowers
confidence and may make an assessment provisional or unavailable; it does not silently count as a
negative financial outcome.

### Data confidence

The confidence assessment considers account and transaction coverage, sync freshness,
classification completeness, transfer and duplicate uncertainty, budget coverage, and income and
balance provenance. Results are `reliable`, `provisional`, or `insufficient` with evidence and
missing inputs.

### Current-month operating health

The month is rated `on_track`, `watch`, `off_track`, or `unknown` using:

- actual and forecast spending against the approved budget;
- category pace and material overruns;
- observed and expected income;
- net cash flow;
- savings and investment contributions;
- upcoming obligations and safe-to-spend; and
- material changes from prior comparable periods.

### Overall financial profile

Each dimension returns a rating, evidence, missing inputs, trend, and next action:

- **Spend:** spending relative to income and coverage of obligations.
- **Save:** liquid resilience, emergency reserves, and long-term contributions.
- **Borrow:** debt load, expensive debt, and repayment progress.
- **Plan:** budget completeness, recurring obligations, protection, and upcoming expenses.
- **Invest:** contribution consistency, allocation visibility, diversification, fees when known,
  and alignment with time horizon and risk preference.
- **Goals:** measurable progress against approved goals and motives.

The structure adapts the Financial Health Network's Spend, Save, Borrow, and Plan indicators. FINRA
guidance grounds cash flow, net worth, high-interest debt, and emergency reserves. Investor.gov
guidance grounds time horizon, regular contributions, diversification, allocation, and fee
awareness. Ilo labels the result as its own evidence-based assessment, not a validated score,
fiduciary recommendation, credit decision, or promise of investment performance.

The validated CFPB Financial Well-Being Scale remains a separate optional assessment. Ilo preserves
the exact questionnaire and scoring method and does not blend its subjective 0–100 result into the
objective Finance assessment. The Finance profile records goals, motives, emergency-reserve target,
budget style, savings priorities, debt strategy, investment horizon, and risk preferences. Missing
profile inputs become maintenance questions rather than inferred facts.

## Connector health and production recovery

Connection and synchronization are distinct account properties:

```text
connection: connected | needs_reauthentication | manual
synchronization: current | stale | retrying | blocked
```

Persist last attempt, last successful sync, next retry, classified failure code, safe failure
summary, and consecutive failure count. Normalize provider failures into at least configuration,
reauthentication, rate limit, provider availability, transport, and validation classes. Apply
bounded exponential backoff and stop the current one-minute infinite retry behavior.

A system credential or environment mismatch creates one Finance operational blocker. It does not
mark every account as needing user reauthentication. A genuine institution authorization failure
remains account-specific.

The initial production repair must:

1. restore `PLAID_ENV=production` for the hosted API;
2. add a deployment-time check proving the selected environment accepts the configured
   credentials without exposing them;
3. persist and expose sync failures through API, MCP, and web;
4. verify that new successful sync timestamps and transactions arrive; and
5. clear the operational blocker only from authoritative recovery evidence.

Because local and hosted APIs may both connect directly to production, database-backed account and
maintenance leases prevent concurrent sync or cleanup. Lease expiry supports recovery after a
process loss. Provider transaction identity and database constraints remain the ingestion
idempotency boundary.

## UI behavior

The Finance overview must distinguish tracked accounts from current accounts and must not show zero
spending as current fact when ledger evidence is stale. It presents:

- current, stale, retrying, and blocked account counts;
- the latest maintenance run and next operation;
- outstanding work grouped by reason;
- current-month rating with its data-confidence label;
- Finance health dimensions and missing evidence;
- source-linked questions; and
- one complete budget proposal with a one-click approval action.

Questions and approvals also remain available through the existing Agent access action queue. The
global queue is a projection only; Finance owns every decision and mutation.

## Client-agnostic contract

Ilo does not create or manage external schedules, prompts, or automations. Any authorized MCP host
may invoke the tools manually or on its own schedule. Tool descriptions and structured results are
self-contained so a natural-language request such as `maintain finances`, `maintain finances for
August`, or `clean up this transaction` is sufficient for a capable host to select the intended
tool and scope.

The server never assumes that the client will paginate, poll correctly, preserve a conversation,
or follow a multi-step prompt. Responses expose the stable run reference, current terminal or
nonterminal state, and valid next operations. Durable server execution and the next invocation are
sufficient for recovery.

## Security, privacy, and audit

- `get_finance_status` requires `finances:read`; `maintain_finances` requires `finances:write`.
- API authorization, feature access, and policy decisions remain authoritative.
- Provider credentials and tokens never appear in tool arguments, results, audit events, or logs.
- Tool output minimizes account identifiers and private provider payloads while preserving useful
  source references.
- Every mutation records actor, policy, rulebook version, run, idempotency key, source evidence,
  and redacted before/after state.
- Maintenance cannot initiate money movement, trades, subscription cancellation, or any other
  provider-side financial action.
- A local production-connected runtime has real authority; leases, optimistic concurrency, and
  audit behavior apply identically to local and hosted callers.

## Verification

### Domain and service tests

- Validate the shared scope, status, run-state, question, proposal, and verification schemas.
- Cover no-argument, all-outstanding, windowed, and surgical maintenance.
- Prove checkpoint resume, idempotent retry, lease exclusion, lease expiry, and rulebook-version
  conflicts.
- Prove deterministic, one-off, uncertain, pending, transfer, duplicate, and provenance behavior.
- Prove question deduplication and target resolution.
- Prove budget proposal atomicity, optimistic conflict, one-click approval, and audit detail.
- Prove health ratings, confidence gates, missing evidence, goal influence, and trend boundaries.

### Connector and API tests

- Cover production/sandbox credential mismatch, reauthentication, rate limit, provider outage,
  transport failure, malformed response, and recovery.
- Prove classified error persistence, safe output, backoff, and successful-clear evidence.
- Prove transaction-ingestion idempotency with concurrent hosted/local workers.
- Prove read/write scopes and domain isolation for both public Finance endpoints.

### MCP tests

- Require complete tool-catalog metadata, shared output annotations, least-privilege discovery, and
  read-only filtering.
- Prove that MCP forwards the scoped token and delegates all decisions to the API.
- Prove useful text and structured output for clean, needs-work, needs-input, blocked, running,
  awaiting-approval, partial, and completed results.
- Preserve granular Finance tools while making the maintenance pair discoverable as preferred
  operations.

### Product and production validation

- Use populated, empty, stale, recovery, and high-volume Finance fixtures.
- Verify desktop and narrow Finance status, questions, approval, partial, blocked, and recovered
  states, plus keyboard names, focus, overflow, and console behavior.
- Run `pnpm verify` before handoff.
- Deploy the Plaid configuration repair and verify the production task definition, health checks,
  successful account sync timestamps, ledger ingestion, and absence of duplicate work.
- Run one production maintenance pass, approve the generated current-month budget, and verify the
  resulting status from hosted MCP, local production-backed web/API, audit activity, and the
  Finance UI.

## Acceptance criteria

The first implementation is complete when:

1. `get_finance_status` reports one honest, internally consistent production assessment.
2. `maintain_finances()` requires no client orchestration and safely resumes after interruption.
3. Every transaction in the processed scope is categorized, explicitly excluded, pending,
   reconciled, or represented by one actionable question.
4. Transfers and possible duplicates are never silently counted as spending.
5. The current month has a complete, explicitly approved budget.
6. Month-to-date spending and forecast are rated against that budget with stated confidence.
7. Income, cash, savings, debt, investments, accounts, goals, motives, and missing evidence appear
   in the health assessment.
8. Repeating maintenance creates no duplicate mutations, questions, proposals, or audit effects.
9. Hosted and local production-connected runtimes coordinate safely.
10. Plaid data is current, failures are observable, and production no longer reports stale absence
    as healthy zero activity.

## Rollout order

1. Repair and guard the Plaid production configuration.
2. Add persistent connector health, classified errors, backoff, and database leases.
3. Add shared maintenance contracts and durable run storage.
4. Implement the Finance coordinator, rulebook, questions, and verification.
5. Implement budget proposals and one-click approval.
6. Implement the Finance health assessment.
7. Expose typed API and the two MCP tools.
8. Update Finance and Agent access UI states.
9. Run production catch-up and validate the acceptance criteria.

## Out of scope

- Configuring or implementing any external MCP client's schedules, prompts, or automations.
- Shipping maintenance handlers for Mail, Calendar, Tasks, or other workspaces in this change.
- Money movement, bill payment, trades, portfolio rebalancing, subscription cancellation, credit
  decisions, tax advice, or individualized fiduciary recommendations.
- Automatically changing an approved budget without a new explicit approval.
- Creating permanent rules from pending transactions or model confidence alone.
- Treating missing provider data as zero or treating a queued question as resolved work.

## Research references

- [CFPB Financial Well-Being Scale](https://www.consumerfinance.gov/data-research/research-reports/financial-well-being-scale/)
- [CFPB financial well-being resources](https://www.consumerfinance.gov/consumer-tools/educator-tools/financial-well-being-resources/)
- [CFPB emergency-fund guidance](https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/)
- [Financial Health Network measurement framework](https://finhealthnetwork.org/wp-content/uploads/2024/05/Assessing-the-Fintech-Market-Against-Age-Inclusive-Standards.pdf)
- [FINRA Financial Foundations](https://www.finra.org/investors/insights/lock-down-your-financial-emergency-kit)
- [Investor.gov introduction to investing](https://www.investor.gov/introduction-investing)
- [Investor.gov asset allocation and diversification](https://www.investor.gov/introduction-investing/getting-started/asset-allocation)
