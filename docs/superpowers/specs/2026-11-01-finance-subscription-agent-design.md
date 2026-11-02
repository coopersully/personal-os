# nohmi Finance: subscription-backed maintenance and conversation

Status: design and implementation plan approved by Cooper November 1, 2026; execution authorized through existing owners. Approval does not itself enroll credentials, change schedules or authorize financial mutations.
Date: November 1, 2026. Outcome owner: Finance orchestrator.
First provider: Claude. Architecture and user-facing concepts remain provider-agnostic.

## Intent

nohmi should know the user well enough to maintain accurate finances with little
supervision. It syncs transactions, distinguishes spending from money movements,
categorizes supported purchases, learns contextual preferences, maintains a budget,
and offers useful guidance. When knowledge is missing it asks; when the user replies
it acts on that answer and reports the verified result. It must not quietly make
unwanted changes or depend on the user reading a digest to discover mistakes.

Use the user's existing AI subscription through supported provider capabilities.
Do not require or silently fall back to separately metered model API billing.
Subscription execution consumes allowance; this is not unlimited execution or a
promise that SMS, banking connections, or nohmi infrastructure cost nothing.

## Decisions confirmed by Cooper

- Hybrid operation: one or two broad maintenance runs each day plus focused event
  responses. Preserve the existing 8 a.m./8 p.m. local routine during delivery.
- Event runs answer the conversation or finish its requested action. They do not
  automatically run a full financial maintenance sweep.
- Start with Claude, support other agents later through the same product model.
- Bypass on: perform confident authorized work without asking for approval.
  Bypass off: propose changes for review. Ask clarification in either mode when
  uncertain. Reading and preparing proposals are not financial mutations.
- Remember answers automatically and reuse them only when their circumstances
  apply. Consider nuance and conflicting evidence; ask rather than overgeneralize.
- Important means material budget impact or attention needed before the digest,
  personalized to the user's circumstances rather than a fixed dollar threshold.
- Routine actions appear in a monthly confirmation digest; potentially fortnightly
  when volume grows. Important changes and useful budget guidance are timely.
- Early corrections help calibration. In the long term, no supervision should be
  required; this is an aspiration, not a shipped guarantee.

## Evidence and current state

These are dated observations, not a claim that all functionality is live today.

- Approved October budget status correction is shipped. November has no approved
  plan. Income and other required inputs must be established before its final plan.
- November 1 complete backlog: 2,820 entries, 1,579 unique transactions, 1,549 flags
  and 1,271 cases. Dates span July 2024–October 2026. Flags/cases overlap; they are
  not duplicate charges and cannot simply be dismissed. No new safe bulk manifest
  was established by grouping alone.
- Four natural Claude runs (October 30 evening through November 1 morning) repeatedly
  reached blocked maintenance, including invalid command arguments and an original
  host authorization failure. Host completion was not financial completion.
- Canonical Automations UI subsequently showed verified Chat access; actual queued
  message consumption remains to be demonstrated. The old run's binding is unresolved.
- Push notifications were visible; actual SMS intent/attempt/delivery correlation
  remains unverified. The acceptance owner's connection lacks notification-history
  read access. Do not label this an established SMS transport failure.
- Main's review bypass covers only certain reversible Finance operations. Its OFF
  state is not a universal approval queue. Unpublished Cautious/Eager settings also
  do not fully implement Cooper's requested rule.
- Existing code supports durable dispatch for a narrower accepted-answer event path.
  The current scheduled-only registration is not an enabled general inbound-text
  conversational host. Combined schedule/event registration and free-form routing
  need delivery and actual acceptance.
- Maintenance-command and missing-host-binding corrections are in draft review;
  shared dependency audit remediation gates release. None proves the entire loop.

Private evidence records retained by the assigned coordination owners:
`finance-request-checklist.txt`,
`finance-claude-recurring-blockers-diagnosis-20261101.md`,
`finance-sms-agent-wake-options-20261101.md`, and
`bypass-clarification-readonly-20261101.json`. The existing Finance owner retains
`backlog-report-20261101.json` with its maintenance-backlog provenance. These are
private handoff artifacts, not checked-in repository paths.

## Approaches and selection

1. Scheduled-only: straightforward but replies wait until a run. Insufficient for
   the desired conversation; retain it as recovery, not the only execution path.
2. Hybrid events plus scheduled maintenance: Cooper's selected approach. Focused
   event runs provide conversation; scheduled runs reconcile broader work and catch
   missed events. Needs durable routing, authority, deduplication and recovery.
3. Always-running agent: not selected. Adds hosting and lifecycle cost without
   inherently improving correctness; conflicts with the subscription-first goal.

Claude's documented routine trigger uses Claude Code subscription usage rather
than Claude Platform billing, can coexist with a schedule, and starts a new session.
The API is experimental. Same-session resumption and instant responses are not
promised. Official sources checked November 1:
https://platform.claude.com/docs/en/api/claude-code/routines-fire
https://code.claude.com/docs/en/routines

## Architecture and responsibilities

nohmi is authoritative for financial records, conversation, pending work, user
knowledge, permissions, approval decisions and action receipts. External agents
interpret requests and evidence and use supported nohmi tools. A model session is
an executor, not the sole store of user context or the source of execution authority.

Use a provider-neutral host registration with explicit capabilities: scheduled
execution, event invocation, MCP connectivity, execution-result evidence, and
provider limits/health. First implement a Claude adapter. UI should say "Connected
agent" with a provider-specific setup section, not encode Claude throughout Finance.
Unsupported capabilities are visible; never simulate event support with a hidden
paid API or unsupported authentication. Add a second adapter only after verifying
its provider's supported subscription and trigger contracts.

The invocation carries a bounded reason: scheduled maintenance, accepted answer,
user conversation, or material-attention assessment. It contains minimal correlation
references. The agent loads authoritative context through authenticated nohmi tools;
incoming text is not a grant, a system instruction or proof of financial facts.

Maintain identity across schedule and event triggers. For existing users, migrate
registration without creating a competing host or invalidating pending answers.
Per-provider adapters translate invocation and response evidence; domain execution
rules and review policy remain shared.

## The two execution paths

### Scheduled maintenance

At the user's one/two daily windows, verify connection freshness and gather pending
work; reconcile balances and duplicates; match evidenced transfers/card payments;
categorize transactions with current knowledge and receipts; preserve splits;
resolve eligible reviews; reconcile budget and projections; then emit only meaningful
questions, alerts and verified completion information. Work in bounded batches.

One blocked item must not stop unrelated eligible work. Leave explicit per-item
states and next actions. "Inbox zero" means no unresolved actionable review work,
not hidden/deferred warnings or deleting ambiguous records to make a counter zero.
Financial sync runs through existing connector infrastructure; it must not require
an LLM to poll continuously. Banking-provider freshness limits remain visible.

### Focused event conversation

1. Accept and authenticate inbound SMS; determine user and relevant conversation.
2. Persist it durably and acknowledge receipt if appropriate without claiming action.
3. Route an exact answer to its current question, or route a free-form Finance
   request as conversation work. Do not fabricate a review answer to reuse routing.
4. Claim eligible work and invoke the user's connected subscription host once.
5. Agent reads the bounded conversation and relevant financial/knowledge context.
6. Clarify if uncertain; otherwise propose or execute according to current policy.
7. Independently verify actual domain outcome and send a contextual reply.
8. Preserve later messages for the next bounded continuation; do not consume them
   into a completed snapshot or lose corrections arriving during execution.

Examples: a reimbursement answer resolves that linked transaction; "how much can
I spend on dining?" reads the current trustworthy budget; a requested reallocation
uses the applicable review/bypass policy. None automatically launches a full sweep.

## Authority, learning and correctness

Separate permission breadth from approval mode. Bypass is not a credential, account
ownership proof or permission to evade an original-host or provider authorization.
Within enabled permissions, implement the confirmed ON/OFF semantics consistently
across agent mutations; determine actual action eligibility centrally, not from
prompt wording. Confident proposals in OFF mode require approval before mutation.
An answer that supplies information is not automatically approval of every related
change. Explicit conversational approval must bind to the exact proposed effects.

Confidence is evidence sufficiency, not an arbitrary model score. Require applicable
context, current source facts, no material contradiction and exact action targets.
Known schema/validation failures and missing evidence produce explicit questions or
operator recovery, not guessed facts. Confidence must not silently expand permissions.

Store learned knowledge with provenance, circumstance, time, scope and supporting
answer. Distinguish one transaction's explanation from a recurring preference and
from an explicit standing instruction. Retrieve relevant exceptions and newer
corrections before applying it. Never turn nonresponse into agreement. A correction
updates/supersedes the affected knowledge and identifies prior dependent actions
for assessment; no automatic broad historical rewrite without proper scope.

Automatic learning remains enabled in both approval modes, consistent with Cooper's
explicit request to remember answers automatically. Recording an answer, its context,
and an explicitly stated preference/correction is not approval of a financial change.
Remembered knowledge can inform proposals in review mode, but financial mutations
still require approval. A model-inferred generalization is a contextual candidate,
not a new standing authorization. Explicit instructions may be recorded faithfully;
neither recording nor inference changes permissions, review mode, grants or provider
settings. Conflicting/uncertain applicability still requires clarification. This
boundary is the design interpretation of the confirmed learning and review rules.

Every action has an inspectable before/after outcome and reason. Support correction
or compensating action where feasible; do not promise all actions are reversible.
Current no-money-movement and supported owner-UI operational restrictions remain
for this delivery. This design does not authorize autonomous bank transfers or
turn on broader permissions in Cooper's account.

## Attention and confirmation

Immediate attention includes budget shortfalls, materially changed usable category
room, time-sensitive decisions, and data failures that could mislead advice. Assess
remaining funds, payday, obligations, goals, timing and personal preferences.
Explain what happened, why it matters, what was done and whether a reply is needed.
Combine related alerts; do not repeat unchanged warnings without a useful reason.

Routine confident bookkeeping belongs in a monthly digest. The digest confirms
outcomes, notable learned preferences and corrections; it is not a required audit
assignment. Proposed default: monthly until the user chooses fortnightly or a
clearly surfaced volume-based preference is enabled. Do not invent an approved
numeric volume threshold. Material alerts and uncertainty questions never wait
for the digest. Respect consent, quiet hours and the distinction between proactive
alerts and replies to a user-initiated conversation.

## Reliability and subscription limits

Persist receipt, routing, pending/claimed work, submitting, provider acceptance,
uncertain submission, execution outcome and outbound status separately. Provider
acceptance/session start is not observed session completion. Persist completion
separately; neither state proves a verified financial outcome. SMS provider
acceptance is not delivery, reading or answer consumption.

Use domain idempotency, durable claims and serialization for conflicting work.
Scheduled and event invocations share the same pending work rules. The Claude fire
API lacks an idempotency key; an ambiguous submission cannot be blindly retried.
Expose uncertain state for reconciliation. Duplicate webhook delivery or provider
sessions must not duplicate financial effects or outgoing answers.

Respect rate limits and subscription exhaustion. Queue work with visible delayed
status; recover through the same supported host once available. Never fall back to
paid model APIs. Coalesce bursts into bounded conversation work without mixing
users or unrelated approval contexts. A five-minute check is optional recovery for
genuinely unhandled replies, not a sleeping agent, automatic nag or second model
invocation after an already handled answer. Hourly polling is fallback only.

Measure inbound receipt→host start→first tool→verified action→SMS handoff/delivery.
No guaranteed response-time SLA until measured on the target subscription. Proposed
pilot usability target: most ordinary replies within two minutes under normal
availability; report measured distribution and outliers before marketing it as
real-time. This is a proposed validation target, not an established capability.

## User setup documentation and guided product flow

Publish a provider-neutral overview plus a Claude-specific walkthrough, capability
matrix, troubleshooting page and disconnect/revocation instructions. This section
defines the future guided flow; unsupported steps must not be presented as shipped.

1. **Check eligibility.** Explain required provider subscription/capabilities,
   allowance consumption, experimental features and separate nohmi/SMS costs.
   Explicitly state that no paid model API key or silent paid fallback is required.
2. **Connect nohmi.** Use supported OAuth/MCP connection, confirm the account and
   selected domains/permissions. Explain approval versus autonomy without conflating
   it with information questions. Do not ask users to paste provider login cookies.
3. **Register the agent.** Detect the existing routine when possible and preserve
   its identity; otherwise guide supported creation. Select local maintenance times
   and timezone. Document DST and what happens if a run is missed.
4. **Enable event capability.** Guide the provider's supported API-trigger enrollment
   for the same routine. Accept credentials only through an appropriate protected
   setup surface; never through chat/logs/docs. Store encrypted, scoped and revocable.
   If enrollment is unsupported, clearly offer scheduled-only mode without claiming
   immediate texting. Don't silently create a second routine.
5. **Enable texting.** Verify recipient and consent; explain quiet hours, immediate
   attention, digest and opt-out. Bind incoming replies to the right account.
6. **Verify connection.** Show separate results for host registration, MCP access,
   Chat readiness, event invocation and texting readiness. Token presence is not
   evidence of end-to-end readiness. A clearly user-initiated connection check may
   test transport/host connectivity without financial mutation; do not run one now.
7. **Verify a real workflow.** With explicit pilot scope, process a genuine question
   or user request and confirm its domain receipt and contextual reply. If no real
   case exists, do not manufacture a financial question or falsely claim acceptance.
8. **Show ready state.** Display next maintenance window, supported capabilities,
   current delays, preferences and how to disconnect. Distinguish "connected" from
   "scheduled only" and "conversation verified".

Troubleshooting must cover expired/revoked access, provider allowance, unavailable
host, missing grant, old-run binding, delayed/no SMS, ambiguous dispatch, stale
question and partial setup. Each shows who can fix it and one concrete next action;
avoid generic reconnect advice when it would create duplicates. Disconnect stops
future invocation and invalidates credentials; preserve audit/history and accurately
report any already-submitted run rather than promising remote cancellation.

## Delivery sequence and existing owners

| Stage | Existing owner | Deliverable and exit evidence |
|---|---|---|
| 0: stabilize | Finance implementation; Agent parity; Speed for shared prerequisite | Legal maintenance commands, accurate host readiness/recovery, accepted tests/review/release and a natural run's actual tool consumption |
| 1: reliable financial facts | Plaid recovery with Accounts; Finance | Generic duplicate prevention plus supported account cleanup preserving unique history; independent balances/ownership/sync readback |
| 2: subscription conversation | Agent parity/shared Texting; existing Finance texting owner accepts | Combined schedule/event capability, protected enrollment, exact-answer and free-form routing, verified original-host reply/action loop |
| 3: backlog and budget | Finance implementation; Memory/Accounts predecessors where needed | Evidence-preserving resolver and safe cohort manifests, applied/read-back batches, remaining explicit questions, reconciled November proposal/required approval |
| 4: ongoing autonomy | Finance with Agent parity and existing Memory owner | Consistent approval mode, contextual learning/correction, incremental categorization, materiality assessment and visible receipts |
| 5: guidance and onboarding | Existing Finance/Agent parity owners; parent scope and docs | Personalized alerts, monthly digest, setup capability matrix/walkthrough, subscription-exhaustion recovery and real-user acceptance |

Stages overlap where disjoint. Avoid a whole-parity release dependency: require
only actual needed accepted predecessors and explicit shared-path reservations.
Speed remains sole migration coordinator; do not invent a slot or rewrite published
migrations. Existing owners implement; parent maintains scope and acceptance.

Already-authorized bounded fixes continue. New architecture requires review of this
design before detailed implementation-plan dispatch. Current provider credentials,
routine schedules and financial state remain unchanged by this document.

## Acceptance scenarios

- Natural morning/evening execution makes useful eligible progress despite one
  blocked item; every blocked item has explicit cause/next actor.
- New synced purchase is correctly categorized or asks a precise question; a
  transfer/card payment is not inflated into spending; existing splits survive.
- Genuine text after a prior session ended starts focused work on the same authorized
  host, uses canonical context, completes the requested outcome and replies.
- An exact answer, free-form request, ambiguous answer and correction take distinct
  appropriate paths. No approval is inferred from an unrelated yes or stale reply.
- Bypass ON skips approval for eligible confident work; OFF proposes mutations;
  uncertainty asks in both. Revoked permission cannot be overcome by bypass.
- Duplicate inbound delivery, burst messages, simultaneous maintenance/event work,
  process crash, provider rejection and uncertain acceptance do not duplicate effects.
- Exhausted subscription or disconnected host creates durable pending work and an
  honest delay, with no paid fallback and no silent loss.
- Contextual learning applies the dinner reimbursement explanation only where
  justified; conflicting context prompts clarification; corrections remain effective.
- Monthly digest is not required for correctness; important budget impact is surfaced
  promptly and quiet-hour handling is explicit. No false overspending assertion from
  stale or untrusted totals.
- First-provider adapter passes shared acceptance contracts; provider-specific code
  does not leak into Finance authority or conversational truth.
- Guided setup with an existing routine does not create duplicates; new enrollment,
  partial failure, credential rotation and disconnect have accurate visible states.

## Builder discretion and outstanding delivery checks

Builders select exact queue/storage implementation, retry/backoff within safe
submission states, test fixtures and component placement after checking live owners.
Schema additions need reservation only if actually necessary. No SQL change is
assumed solely for adding a combined trigger; general conversation jobs may differ.

Verify actual provider eligibility, account limits, MCP availability and billing at
enrollment; maintain dated provider docs. Establish pilot latency and subscription
usage before promising real-time performance. Determine explicit support/access
needed for notification-history acceptance without expanding grants silently.
Decide final digest volume behavior and materiality evaluation implementation through
reviewable defaults; do not claim a universal dollar threshold or model confidence
number satisfies personalized judgment.

## Next step

Independent builder-readiness check completed. Cooper approved the design and
implementation plan on November 1 and authorized execution through existing owners.
Execute the linked owner-scoped plans with their exact repository touchpoints,
dependencies, verification, documentation deliverables and release/rollback receipts. Keep all checklist
outcomes open until their user-visible acceptance is established.

## Builder-readiness review

Independent read-only review completed November 1. One consequential ambiguity was
raised: automatic memory versus approval-required mutations. Resolved above using
Cooper's explicit automatic-learning preference and preserving review for financial
changes. No new product decision was attributed to Cooper; the boundary is labeled
a design interpretation. Existing implementation ownership remains unchanged.

Document persistence: adopted from the requested orchestration workspace into an
authorized isolated repository checkout. The original orchestration directory has no
Git metadata; no replacement repository was initialized. Document adoption does not
establish implementation, release or user-visible acceptance.
