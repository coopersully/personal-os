# Finance MCP Rebuild Design

**Status:** Approved product design

**Date:** 2026-08-23

## Objective

Rebuild ilo Finance so an MCP-connected agent can set up, maintain, account for,
budget, reconcile, and audit a user's finances without requiring the user to
know tool names or visit the ilo web application.

The agent works for the user. It performs authorized work immediately, asks
only irreducible questions, applies each answer before asking the next one, and
discloses important financial information before supporting detail.

## Scope

This branch owns the complete Finance agent surface:

- Finance domain contracts and invariants;
- Finance persistence and migration;
- API operations required by the domain and MCP;
- the complete Finance MCP tool inventory;
- guided financial setup;
- autonomous maintenance, reconciliation, and audit protocols;
- transaction-backed review cases and Inbox behavior;
- structured financial profiles;
- versioned complete budgets;
- authorization, bypass, provenance, and idempotency behavior;
- deterministic, integration, and agent-conversation acceptance tests.

The existing web application must continue to compile against compatible API
projections, but Finance web-interface design and implementation are explicitly
out of scope. The web application is not a privileged Finance control plane.
MCP completeness is measured against Finance domain capabilities.

External automation systems are also out of scope. ilo does not create,
configure, schedule, inspect, or persist external automations. Any external
caller may invoke Finance MCP tools on its own schedule.

## Product Invariants

### MCP completeness

With bypass mode enabled and all appropriate Finance scopes granted, an agent
can perform every ilo-owned Finance operation. A normal Finance tool must never
direct the user to complete work in the ilo web application.

An external provider may require the user to authenticate or grant consent. In
that case the MCP initiates the operation, returns the secure provider handoff,
observes completion, and resumes the workflow. That is an external-provider
handoff, not an ilo web-app handoff.

### Natural-language routing

Users express goals, not tool names. Tool names, descriptions, schemas, server
instructions, and response contracts must make the correct operation obvious
to a capable agent. Normal user-facing messages do not expose tool names, run
IDs, checkpoints, queue terminology, or internal architecture.

### One-question interaction

Interactive Finance review asks exactly one question at a time. After the user
answers, the agent applies the corresponding financial mutation before asking
the next question. Once all questions are resolved, the agent recalculates the
affected ledger and budget state and reports completion.

An unattended maintenance invocation never waits for the user. It completes
all possible work, persists deduplicated transaction-backed review cases, and
settles successfully with those cases reported as remaining review.

### Immediate useful disclosure

Finance responses lead with:

1. what changed or what materially matters;
2. the single next question or action;
3. supporting detail only when useful or requested;
4. internal diagnostics only when debugging is requested.

### Scoped failure

A stale or failed source affects the evidence supplied by that source. It does
not globally block unrelated ledger work. Generic `blocked` states are not part
of the public Finance protocol.

## Architecture

The Finance domain owns business invariants and durable state. The API exposes
domain operations. MCP is the complete agent-facing work surface and a thin
adapter over those operations; it does not reimplement accounting rules.

The caller is the reasoning worker. `maintain_finances` is a synchronous,
resumable protocol that returns bounded reasoning work, accepts judgments, and
advances immediately. There is no ilo Finance scheduler or hidden background
worker.

Existing granular operations remain available for direct user intents. The
goal-oriented setup and maintenance tools compose the same domain services; they
do not create a second source of business logic.

## Canonical Data Model

### Structured financial profile

The Finance-owned profile is structured and versioned. It includes household,
dependents, jurisdiction, employment, income stability, expected take-home,
debts, required payments, liquidity, reserves, insurance, goals, risk capacity,
and budgeting preferences. Fields retain provenance and confidence.

Generic domain-profile prose may provide context but cannot grant or revoke
Finance permissions. Finance authorization comes only from token scopes and
bypass settings.

### Accounts and connections

Account identity is separate from provider connection state. The model records
account type, balances, inclusion settings, provider authorization,
synchronization history, coverage periods, freshness, errors, and any required
external action.

### Ledger and economic events

Imported and manual transactions are source evidence. Corrections create
attributed revisions instead of silently rewriting history.

Related transaction rows may form an economic event, including transfers,
reimbursements, refunds, reversals, duplicates, splits, recurring obligations,
and recurring income. Classification records separately capture transaction
meaning, merchant, budget category, confidence, evidence, and actor provenance.

### Versioned complete budgets

A budget is an immutable complete version, not independent mutable category
rows. Each version records its effective period, expected resources, spending,
savings, debt payments, goal contributions, buffer, assumptions, rationale,
creator, approval provenance, and balance proof.

A revision creates an atomic complete successor. Historical reporting retains
the governing version. When obligations exceed income, the plan records an
explicit deficit, reserve draw, or borrowing source; it never claims a false
balance.

Budget completion has two gates:

- the plan is balanced across income, spending, savings, debt, goals, and
  buffer;
- the ledger evidence used by the plan is trustworthy enough for its stated
  confidence.

### Finance Inbox

The Inbox consists of structured review cases linked to ledger rows or economic
events. A case records its stable event identity, reason code, evidence,
competing interpretations, financial impact, proposed resolution, first and
last observation, resolution, reopening lineage, and provenance.

Only one active case may exist for the same economic event and reason. A
resolved case may reopen only when materially contradictory evidence arrives;
the previous resolution remains visible.

Questions are rendered from review cases. They are not persisted as an
unrelated prose task list.

### Maintenance runs and audit findings

A maintenance run records its evidence snapshot, deterministic mutations,
reasoning batches, submitted judgments, reconciliation checks, audit findings,
review cases, and settlement summary.

Runs are not queue jobs. They have caller-driven states such as
`agent_reasoning_required`, `external_action_required`, `settled`, and `failed`.
User review cases do not make a run blocked.

### Mutation provenance

Every mutation records the actor type and identity, originating MCP invocation
and maintenance run, evidence, confidence where applicable, timestamp, and
prior value or version. Actor types distinguish user, agent, deterministic
rule, provider, and import. Agent work is never recorded as user-confirmed.

## Authorization and Bypass

Finance authorization is computed from explicit agent-token scopes and the
current bypass setting. Domain-profile instructions and legacy preference flags
cannot override the authorization result.

With bypass enabled and the required scope present:

- the agent may perform Finance mutations;
- the agent may approve its own budget proposals;
- the agent immediately applies user answers;
- redundant confirmation is not requested;
- every ilo-owned operation remains available through MCP.

Without the required scope, the MCP returns the exact missing scope and no
ambiguous human-only explanation.

## Conversational Protocols

### `setup_finances`

`setup_finances` handles natural-language intents such as "set up my finances"
and "create my financial profile."

The resumable protocol:

1. inspects current profile, accounts, evidence, budget, and ledger state;
2. obtains usable account evidence through MCP or an external provider handoff;
3. infers reliable facts from recent activity;
4. returns one missing high-value question;
5. accepts the answer, persists it atomically, and returns the next question;
6. produces and discloses a complete budget proposal;
7. activates the proposal after user or authorized agent approval;
8. initiates the first maintenance protocol;
9. reports the settled financial state and remaining Inbox review.

Setup completes when the structured profile is sufficient, a complete balanced
budget is active, initial maintenance has settled, and any remaining uncertainty
is represented by deduplicated Inbox cases.

### `maintain_finances`

The resumable protocol:

1. starts or resumes a run;
2. synchronizes requested sources;
3. continues unaffected work after source-scoped failures;
4. applies deterministic relationship and classification rules;
5. returns a bounded transaction-reasoning batch;
6. accepts and applies agent judgments;
7. repeats until no reasoning work remains;
8. reconciles the ledger and budget actuals;
9. returns context for an agent red-team audit;
10. accepts findings and creates or updates review cases;
11. settles with changes, important findings, and remaining review.

### Inbox review

`get_finance_inbox` returns one prioritized question and the remaining count.
`answer_finance_review` atomically records the answer, applies the associated
classification, relationship, correction, or profile mutation, resolves the
case, recalculates affected state, and returns the next question.

An ambiguous answer produces one concise clarification for the same case.

### Budget approval

Creating or revising a budget returns expected resources, allocations, buffer
or explicit deficit, material assumptions, changes from the previous version,
and whether the agent may self-approve. The proposal is disclosed in chat.
Bypass may allow immediate agent approval; otherwise natural approval language
such as "approve" or "looks good" triggers approval without requiring a tool
name or repeated budget details.

## MCP Tool Inventory

### Goal-oriented entry points

- `setup_finances`
- `maintain_finances`
- `get_finance_snapshot`
- `get_finance_maintenance_history`

### Profile and planning

- `get_financial_profile`
- `update_financial_profile`
- `get_finance_budget`
- `create_finance_budget`
- `revise_finance_budget`
- `approve_finance_budget`
- `get_finance_budget_status`
- `list_finance_goals`
- `manage_finance_goal`

### Accounts and connections

- `list_finance_accounts`
- `start_finance_account_connection`
- `get_finance_account_connection`
- `sync_finance_accounts`
- `update_finance_account`
- `disconnect_finance_account`

### Ledger

- `list_finance_transactions`
- `get_finance_transaction`
- `add_finance_transaction`
- `update_finance_transaction`
- `remove_finance_transaction`
- `split_finance_transaction`
- `classify_finance_transactions`
- `link_finance_transactions`
- `get_finance_categories`
- `get_finance_ledger_health`
- `import_finance_transactions`
- `export_finance_data`

### Inbox

- `get_finance_inbox`
- `answer_finance_review`

### Merchants, rules, and recurring activity

- `list_finance_merchants`
- `update_finance_merchant`
- `merge_finance_merchants`
- `list_finance_rules`
- `manage_finance_rule`
- `list_finance_recurring_items`
- `manage_finance_recurring_item`

### Reporting

- `get_finance_cashflow`
- `get_finance_wealth_summary`
- `get_finance_budget_status`
- `get_finance_ledger_health`
- `get_finance_snapshot`

## Existing MCP Replacement Map

| Existing tool | Rebuild decision |
| --- | --- |
| `get_finance_wealth_summary` | Keep name; rebuild calculation and response. |
| `get_finance_cashflow` | Keep name; rebuild calculation and response. |
| `review_finance_recurring_payment` | Replace with Inbox and recurring-item tools. |
| `resolve_finance_alert` | Replace with `answer_finance_review`. |
| `get_finance_ledger_health` | Keep and expand. |
| `list_finance_transactions` | Keep; repair cursor, sorting, and filters. |
| `get_finance_categories` | Keep. |
| `get_finance_budget_status` | Keep; make complete and version-aware. |
| `list_finance_merchants` | Keep; add search and pagination. |
| `rename_finance_merchant` | Replace with `update_finance_merchant`. |
| `merge_finance_merchants` | Keep; make genuinely idempotent. |
| `get_finance_review_queue` | Replace with `get_finance_inbox`. |
| `propose_finance_categorizations` | Remove; deterministic work belongs in maintenance. |
| `apply_finance_categorizations` | Replace with `classify_finance_transactions`. |
| `resolve_finance_review` | Replace with `answer_finance_review`. |
| `get_finance_overview` | Replace with `get_finance_snapshot`. |
| `add_finance_transaction` | Keep; add idempotency and correct provenance. |
| `categorize_finance_transaction` | Remove the legacy bypass path. |

## Common MCP Response Contract

Every Finance tool uses a shared envelope:

```ts
type FinanceToolResult = {
  schemaVersion: 1;
  outcome:
    | "completed"
    | "work_remaining"
    | "user_input_required"
    | "external_action_required"
    | "failed";
  communication: {
    headline: string;
    requiredDisclosures: Array<{
      importance: "critical" | "important";
      message: string;
    }>;
    nextQuestion?: {
      id: string;
      prompt: string;
      answerType: string;
    };
    optionalDetails: string[];
  };
  changes: Array<{
    type: string;
    description: string;
    affectedEntityId: string;
    reversible: boolean;
  }>;
  remainingWork: {
    count: number;
    categories: string[];
  };
  nextAction?: {
    tool: string;
    reason: string;
    arguments: Record<string, unknown>;
  };
  diagnostics?: {
    issues: Array<{
      scope: "account" | "transaction" | "budget" | "profile" | "system";
      code: string;
      plainLanguage: string;
      affectedWork: string[];
      unaffectedWork: string[];
      remedy: string;
      retryable: boolean;
    }>;
  };
};
```

Mutation tools additionally require an idempotency key. Versioned aggregates
require the expected current version. The envelope separates required user
communication, reasoning evidence, continuation instructions, and diagnostics.

## Tool Discoverability

Every tool description states:

- the natural-language user intents that should trigger it;
- when it must not be used;
- its read, proposal, or mutation behavior;
- its preconditions and relevant scopes;
- how bypass changes behavior;
- what successful completion means;
- how to follow its `nextAction`.

Descriptions lead with phrases such as "Use this when the user asks to..." and
include common paraphrases. The server provides a short routing guide, but the
tools remain independently understandable.

## Error Contract

Finance errors identify exactly what failed, affected and unaffected work, the
available remedy, whether retry is safe, and the correct next operation.

- provider failures return a scoped reconnection handoff;
- version conflicts return the current version and read operation;
- permission failures return the precise missing scope;
- partial success reports completed changes before the remaining issue;
- unexpected failures return a stable diagnostic reference;
- no public response uses an unexplained `blocked` state.

## Migration Strategy

Use expand-migrate-contract for incompatible live-data changes:

1. add the canonical versioned profile, budget, review, relationship,
   provenance, and maintenance structures alongside existing storage;
2. add compatible domain and API reads;
3. migrate bounded compatible data and use a resumable observable backfill for
   large ledger history;
4. dual-read or dual-write only where deployment compatibility requires it;
5. switch MCP to the new contracts;
6. remove obsolete paths only after callers converge.

Existing transaction identities remain stable. Legacy category/month budgets
that cannot prove completeness migrate as incomplete historical plans rather
than active balanced budgets. Existing review rows retain their history while
receiving stable event-and-reason identities.

## Verification

### Domain and database

- balance-proof invariants for complete budgets;
- deficit and reserve-draw representation;
- event relationship integrity;
- active-review deduplication;
- resolved-case reopening lineage;
- immutable provenance and correct actor types;
- migration preservation tests using existing representative data.

### API and MCP

- complete capability coverage;
- authorization and bypass matrix;
- idempotent retries;
- expected-version conflicts;
- source-scoped partial failure;
- shared response envelope conformance;
- maintenance resume after caller interruption;
- no hidden worker or queued state.

### Conversation acceptance

At minimum, supported agent hosts must demonstrate:

1. "Let's set up my finances" selects `setup_finances` without a tool name.
2. Agreement to review four items immediately produces one question.
3. Each answer is applied before the next question.
4. Four answers resolve four cases and produce a recalculated summary.
5. Bypass completes all authorized ilo-owned work without a web-app handoff.
6. A stale source does not block unrelated maintenance.
7. Provider errors are explained precisely without agent speculation.
8. A disclosed budget proposal may be self-approved when authorized.
9. General status questions disclose material financial facts first.
10. Normal conversation never exposes queue records, checkpoints, or tool names.

Before handoff, run focused tests throughout implementation and the repository's
required `pnpm verify` action.

