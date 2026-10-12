# Finance, Texting and shared toolkit completion specification

Status: detailed planning draft requested by Cooper on 2026-10-12; no product implementation,
production activation, external messages or account-policy changes occur through this document.
Baseline: `f918b63a91fd8a997af75e9f14b02f53f4305b49`, integrated by `03b9886a`.

This supplies implementable contracts for the remaining work in the approved conversation direction
and the September [shared toolkit](2026-09-28-shared-agent-toolkit-design.md),
[Finance](2026-09-28-finance-toolkit-design.md), and [Texting](2026-09-28-texting-toolkit-design.md)
designs. The [source audit](../../engineering/finance-texting-spec-reconciliation.md) distinguishes
implemented foundations from target behavior. Exact new limits below are engineering design defaults;
they are not claims about current code or choices already saved in Cooper's account.

## 1. Outcome, scope and alternatives

An authorized external agent can inspect trustworthy financial evidence and previous agents' knowledge,
ask an eligible question through SMS, and pick up the answer in a later session. The person can do the
same financial work in the app. nohmi stores the persistent brain, runs deterministic preparation and
recovery, and enforces policy. It never supplies a built-in reasoning agent or requires a cloud host.

One person's USD finances and calendar months are the release boundary. Separate accounts stay
isolated. Future currencies remain possible; shared household plans remain excluded. No money movement,
trading, bill payment, tax filing or financial credential claims are added.

Chosen approach: extend existing domain records with shared knowledge and a small coordination layer.
A separate generic object store would duplicate Finance questions and receipts. Completing every
financial feature before the shared journey would delay useful cross-session interaction. Deliver
independent slices and accurately expose availability instead.

Do not rebuild notification composition, signed Finance reply admission, durable acknowledgments,
recovery loops, source handoffs, history, policy management or optional host setup. There is also an
existing `agent-access-work-items.ts` review/attention projection with bounded snapshot pagination.
Extend its readers and references; it is not yet a durable generic claim or general SMS work service.

## 2. Shared types and authority

All new public schemas live in domain-owned modules, use strict Zod validation, export inferred
TypeScript types, and share one HTTP/client/MCP contract. Owner, actor, connection and server timestamps
come from authenticated state; callers cannot supply them. UUID IDs, integer revisions, existing
ISO-date validators, explicit nullable unknowns and existing error envelopes are retained.

New coordination types:

- `WorkRef`: `{ domain: 'finances'|'texting'|'mail'|'tasks'|'calendar', kind: string, id: UUID }`.
  Each registered domain adapter validates its finite supported kinds. No arbitrary table names.
- `WorkVersion`: `{ ref: WorkRef, revision: string }`; the domain owns revision semantics.
- `WorkPageQuery`: optional domain/state/cursor, limit integer 1–50, default 25. The old review-list
  contract keeps its existing maximum of 10; do not silently change existing pagination.
- `WorkClaim`: `{ id, work, fence: integer, expiresAt, holder }`; holder is server-derived and
  redacted where caller lacks permission. Default lease 5 minutes, renewable for 5 minutes at a time.
- `MutationKey`: a UUID supplied by the caller, bound to owner, operation and canonical request hash.
  Same key/different payload conflicts; same accepted request returns the authoritative receipt.
- `WorkDisposition`: `waiting_for_user | awaiting_approval | blocked | failed | completed` with exact
  child receipt references or a validated domain reason. A caller cannot assert an effect happened.

Knowledge adds opt-in `knowledge:read` and `knowledge:write` credential scopes. Existing credentials
are not expanded. Read does not imply write; write alone does not bypass read restrictions. Domain
sources additionally require their existing workspace read scopes. Global knowledge requires its own
read grant and declared purpose; workspace-scoped knowledge also requires the workspace read scope.
Sensitive records return only to explicitly eligible purposes and owner-configured categories.
Learning/disclosure settings and promotion of sensitive/high-impact inference are owner-only.

Work discovery needs the referenced domain's read scope. Claims need that domain's write scope;
financial maintenance also needs its current maintenance authority. An effect still requires the
owning operation's execute/approval/consent checks. No generic work scope grants execution authority.
Agents retain existing opt-in execute plus owner-bypass permissions for currently registered actions.
New automatic budget policy activation is an exact owner approval; existing management operations
remain available under their current permissions but cannot activate this new authority indirectly.

## 3. Work discovery, claims and resumption

Store coordination rows keyed uniquely by owner and native work reference, containing revision,
claim fence/expiry, disposition and native receipt references. Native questions, proposals, answers,
messages and Finance runs remain authoritative. Domain adapters supply `inspect`, `list`,
`validateDisposition` and `resolveReceipt`; they never interpret natural language.

Provide `list_work`, `get_work`, `claim_work`, `renew_work_claim`, `release_work_claim` and
`record_work_result` through `/v1/work` and thin MCP/client adapters. Lists are bounded snapshots,
ordered by creation time then stable ID; signed cursors bind owner, caller, filters and snapshot,
expire after 15 minutes, and recheck current authorization on every page. A new polling traversal
starts a fresh snapshot; cursor advancement never acknowledges work. Unknown sources report
unavailability, not an empty success. Extend existing review projections without a second domain queue.

Claim admission locks the coordination row, revalidates domain revision/current authority and increments
its fence. Claim renewal requires the same holder, fence and live unexpired grant. Commit checks claim,
revision and authority in the domain transaction; expiry cannot replay an accepted effect. Accepted
receipt lookup precedes any repeat submission after reauthorization. Domain writers acquire locks in
one documented order: existing owner/domain admission lock, coordination row, then the existing native
record order. No new path may acquire these in reverse. Manual actions do not require a claim; they
invalidate stale agent effects through native revisions. Active work remains visible to other readers.

A waiting-for-user disposition releases the active lease; an answer reopens actionable work at a new
revision. Claimed work is not reassigned before expiry except explicit owner cancellation. An uncertain
external submission remains uncertain after expiry: the next holder may inspect/reconcile, not resend.

Finance's optional host-bound runs retain original-connection checks. Implement an explicit owner
transfer operation only for undispatched waiting work, revalidating the target's active scopes and
invalidating the old dispatch epoch. Submitted/uncertain host fires cannot be transferred for replay.
For new generic maintenance work, no schedule is required. A new authorized caller can claim and
resume using accepted receipts without inheriting the previous caller's authority. Never loosen the
existing host guard globally to accomplish this. Persist claimed generic continuation authority in a
separate tagged variant, with legacy rows retaining their existing interpretation.

## 4. Knowledge persistence and lifecycle

Relational tables: records, immutable revisions, typed relationships, source references, evidence
observations and context-use references, all with owner keys and composite foreign keys. A record
contains `kind`, `schemaVersion`, validated `value`, workspace/entity scope, sensitivity, purposes,
confidence, status, validity/review dates, current revision and provenance. Status is one of
`proposed | active | disputed | superseded | expired`. Deletion removes content and indexes; retained
operational receipts contain only permitted redacted reference metadata, not deleted knowledge values.

Kinds and required values:

| Kind | Typed value |
| --- | --- |
| fact | subject reference, predicate, string/boolean/integer/date value with declared value type |
| preference | subject, preference key, typed value; never a policy grant |
| relationship | two owned subject/entity references, relationship type, direction |
| goal | reference to canonical goal; hierarchy, horizon, priority, measure, review cadence remain typed goal data |
| constraint | subject, condition, applicable time range and stated boundary |
| routine | subject, recurrence description, observed/stated classification and validity range; no execution schedule |
| decision | subject, selected option, concise user-visible reason and evidence; no private reasoning trace |
| entity_meaning | exact owned workspace entity reference, meaning and applicable purpose |
| inference | subject, proposition, explicit uncertainty, evidence refs and review/expiry condition |

Bound a record's serialized value to 8 KiB, 20 source references and 20 relationships per mutation.
Source types are domain record/revision, signed inbound message, owner statement, and agent observation.
The server resolves source ownership and classification. An agent can record a clearly attributed user
statement without a second confirmation, but caller text cannot forge a signed SMS source. Unsourced
agent assertions remain proposed inference. An agent-recorded clear user statement from an external
conversation may use original wording plus its session/message reference, explicitly labeled as
agent-recorded rather than a server-verified user message. It may become active without another routine
confirmation, but never supplies signed SMS or approval authority. Repeated summaries keep the original evidence identity.

Creation, revision, dispute, promotion, supersession, restriction and deletion use expected revision
and mutation key. Exact retries return the same result. Updating an existing record at a stale revision
returns conflict without silently replacing it. Concurrent conflicting new facts sharing a subject,
predicate, scope and overlapping validity become a conflict set, not last-writer-wins. Both claims and
sources remain visible until resolved. Related references cannot cross accounts.

No automatic promotion of financial assumptions, sensitive/identity claims, policy or external action
instructions. Initial safe-promotion registry contains one reversible category: preferred presentation
detail (`concise` or `detailed`). Three distinct explicit user selections on three separate local dates,
within 30 days, no contrary current selection, plus owner-enabled automatic promotion permit activation.
Duplicated events or agent reuse never count again. All other inference awaits owner promotion. This
bounded deterministic rule implements progressive learning without inventing an internal agent.

Provider/source removal marks provenance unavailable and triggers review without erasing an independent
user statement. Revoking a contributing connection does not delete account-owned knowledge; it prevents
future access. Owner deletion cascades across revisions, indexes and relationships. Export returns a
versioned machine-readable bundle of permitted records/history/sources with unavailable sources marked.

## 5. Context and workflow guidance

`get_context_for_intent` accepts workspace, enumerated purpose, up to 20 entity refs, time window and
limit 1–50 (default 20). Total content budget is 32 KiB; results expose truncation and bounded fetch
references. Allowed initial purposes: setup, bookkeeping, planning, review, communication, and recovery.
Each workspace/operation maps to allowed knowledge kinds and source scopes before candidate selection.
Structured and PostgreSQL full-text search are sufficient; no vector store or model dependency.

Separate facts, preferences, inference, decisions, policy references, contradictions and missing inputs.
Rank by exact entity match, active status, validity/freshness, source quality then stable ID. Disputed or
stale knowledge is visibly qualified; it cannot satisfy a required fresh input. Context-use records
store IDs/revisions and selection reasons, not duplicate source bodies. `explain_context` rechecks current
permissions and deletion; it cannot resurrect removed evidence.

Expose search/get/create/propose/update/dispute/promote/supersede/delete/export operations, with explicit
owner-only boundaries. Goal hierarchy and typed workspace links extend the canonical goal model rather
than copying goal balances into knowledge. Each maintenance/setup/playbook output names its version,
required evidence, missing knowledge, allowed next actions and capability availability from actual
registration. A missing agent leaves judgment pending. No tool executes a model or stores hidden reasoning.

Migration is explicit and idempotent by source ID/revision. Import profile prose as proposed observations,
not active facts; retain exact approvals in native domain policy. Keep notes at their original records
unless a caller explicitly promotes reusable meaning. Do not bulk extract facts using an internal model.

## 6. Finance truth, initial planning and goals

Connect first-plan setup to the existing qualified position service in one consistent snapshot. Expose
cutoff, ownership, currency, freshness and missing reasons. Unknown values are not zero. All overview,
plan, cashflow, wealth, reports and tools consume the same position evidence; extensions remain in its
owning domain calculations. Missing one source blocks dependent assertions, not unrelated bookkeeping.

Monthly resources distinguish dependable recurring income, uncertain income and one-time cash. Exact-cent
plans allocate obligations, debt minimums, discretionary categories, goal contributions and buffer.
Activation records source/profile/position/plan revisions. Preserve the original monthly baseline;
subsequent versions never rewrite it. Existing authorized agent activation retains its provenance;
when the person explicitly approves a baseline, preserve that fact separately from agent approval.
Automatic adjustment additionally requires owner confirmation of its original baseline. An agent-approved
plan remains usable under existing permissions before that confirmation. A period cannot have competing baselines. Unknown ownership or unfunded obligations prevent a fully
funded claim. Deficits and skipped answers remain visible.

Flexible groups partition one allocation, never duplicate it across children. Category, envelope and
zero-based views are projections of the same plan. Zero-based mode requires every declared cent assigned;
unknown/uncertain resources do not satisfy that constraint. Budget remaining is not available cash.

Goal reservation records identify goal, owned cash source, amount, period and unique funding evidence.
Planned contributions never increase funded amount. Reservation and matched transfer for the same evidence
count once. Release/reassignment are explicit revisioned writes; concurrent goals cannot reserve the same
unassigned cash. Source shortfall changes qualification and creates work rather than inventing funding.

Complete source lifecycle and recognition coverage by extending existing services only where a failing
acceptance test identifies a gap: manual/provider/import replay, pending replacement, exact split sums,
refunds, transfer pairs, debt principal/interest, investment valuation and partial reimbursement. Unknown
transfer matching remains reviewable. CSV and OFX imports produce previewable batches and deterministic
identities; duplicate imports cannot double count. Retain stronger manual corrections through provider
sync and maintenance. A future categorization rule requires its own exact preview and approval.

Forecasts project only evidenced dated income/obligations; default 90 days, permitted 7–365 days. Assumed
recurrences are qualified. Scenarios are read-only; committing a plan is a separate existing operation.
Reports separate contributions, withdrawals, debt and valuation and return unknown for unsupported facts.
Recurring bills/subscriptions carry evidence, next due date, amount range and confirmed status; detection
is deterministic, proposed until confirmed, and never auto-cancels a service.

## 7. Budget policy, usage and carryover

Continue existing policy storage and pure evaluator; add a versioned executable contract. Initial
policies default to disabled. The person selects eligible categories, directions, per-change cents,
monthly cents, percentage basis points (integer 0–10000) and allocation floors. No example is a saved
policy. Agents may prepare policy proposals but cannot activate or widen automatic adjustment authority.
Disabling remains immediate and available with stale financial evidence.

Each adjustment must conserve total allocated cents and cannot borrow, change assumed income, draw
protected reserves or change policy. Count the sum of positive deltas once toward dollar usage. Track
increases and decreases separately per category against its immutable baseline; reversing an adjustment
consumes new capacity and never refunds usage. The permitted cumulative directional amount is
`floor(baselineAllocationCents * limitBps / 10000)`, using overflow-safe integer arithmetic. Carryover
and subsequent allocation increases do not change that denominator. Zero baseline permits zero automatic
change. An exact manually approved exception is recorded separately and cannot reset automatic usage.

Example test policy only: category A baseline 40,000 cents, 2,500 basis points, per-change 10,000 cents,
monthly 15,000 cents. A 6,000-cent decrease passes A's percentage bound; a further 5,000 fails the cumulative
10,000-cent bound. A reverse 6,000 increase consumes another 6,000 of monthly usage. Other categories'
limits must independently pass. Floors also preserve already spent/committed allocation; unavailable
usage or position denies automatic execution.

Persist append-only automatic usage entries, keyed uniquely by accepted adjustment receipt, with original
period, baseline and policy version. Usage spans all policy and plan versions in that owner/month. Freeze
period timezone when opening the month; changing user timezone takes effect next unopened period and
cannot create another same-owner calendar-month capacity bucket. Reallocation closes with the period;
late corrections are explicit versioned adjustments, never unrecorded backdated automatic transfers.

Commit under existing Finance owner/profile admission, then coordination (if claimed), plan/baseline,
policy, period usage and ordered dependencies. Maintain a `finance_evidence_epochs` owner row: every writer of position inputs locks and increments
its revision under the existing Finance owner/profile admission lock. Preview records that epoch.
Commit locks/rechecks it before reading position and usage inside the same transaction; a snapshot read
outside it is not a commit fence. Migration initializes the row, and executor availability stays false
until every input writer participates. Read-only consumers do not increment the epoch. Recheck grant, owner approval, disabled status, exact preview digest, evidence and period.
Write plan version, usage, audit and receipt atomically. A failed transaction spends no usage; accepted
receipt replay produces no second version. Capability is available only once these registrations exist.

For category closure, remainder = opening carryover + allocation − settled recognized spending.
`none` carries 0; `surplus_only` carries max(0, remainder); `surplus_and_deficit` carries signed remainder.
40,000 allocated/35,000 spent carries 0 or 5,000; 45,000 spent carries 0 or −5,000. Positive carryover is
neither new income nor cash. Pending/unresolved evidence marks closure provisional. Late corrections
append a source-revision-bound adjustment, keep original baseline/closure and flag dependent plans stale.
Rollover identity is owner/category/month with append-only revisions; replay never adds carryover twice.
Policy changes preview their future effective boundary. No historical migration or validator is rewritten.

## 8. General Texting and child operations

The signed webhook persists message and native work availability without requiring any host. Existing
STOP/HELP/START handling and exact Finance binding are deterministic fast paths. Other messages become
`waiting_for_agent`, with no built-in intent classifier. Texting's work adapter projects that record
into shared discovery; privacy and current consent filter message detail independently from work IDs.

External agents claim, read the latest conversation, obtain purpose-bound knowledge and submit structured
child requests. `TextChildRequest` contains parent work/revision, stable child key, registered operation
name, exact domain input and optional dependencies on prior children. It is not a shell command, URL or
arbitrary tool proxy. Initially register only existing reversible local actions: creating a Task, updating
one Task's fields/completion, creating/updating a local Calendar event, and Finance's current question/
categorization operations. Full completion also registers receipt resolvers for existing supported Mail, Tasks/Reminders, Calendar
and Finance operations. An external agent may use their existing native tools and attach a verified
receipt to the parent work; attachment never executes or approves the operation. Native operation, owned
target, actor authority and request/effect identity must match the declared child intent. Missing native
receipt support returns a specific app-review/unsupported outcome rather than accepting a claimed success.
Later direct-dispatch adapters require their own reviewed authority/evidence contract. Mail send, credentials,
policy activation and unsupported provider effects stay in their existing stronger path.

Persist child intent before calling its domain writer, whether invoked by Texting or through an existing native tool. Every adapter supports read-receipt/reconcile and
passes the same stable mutation key across restart. Inspect acceptance before retry. Pending uncertain
children remain uncertain; successful siblings remain successful. Disposition records receipt IDs, not
agent-asserted success. Shared claims coordinate response/effect ownership; they do not create domain scope.
The parent remains waiting/partial until required child results or explicit user-visible unsupported
reasons exist. Incoming conversation changes invalidate a prepared response until reread.

`record_text_response` stores an authored draft and evidence references; `send_text_response` uses current
conversation/read receipt, native send policy and mutation key. The durable draft is not a delivered SMS.
The existing manual read/send tools remain valid; their interaction with claims is handled at the common
send admission path so bypassing a new wrapper cannot duplicate a response for the same work.

## 9. SMS approvals, coaching and delivery

Extend exact bound replies, not free-text authority. Bind owner, recipient, consent epoch, work/revision,
expected vocabulary, expiry and outbound identity before inbound processing. Preserve provider causal
ordering checks. Default expiry 24 hours or earlier domain expiry. One explicit item may accept `yes`/`no`
only when its canonical prompt advertises that vocabulary and exactly one eligible binding exists; otherwise
require existing approve/reject or explicit selector. Never reinterpret an ambiguous old reply against new
work. Sensitive/unbounded/irreversible/new-policy actions use authenticated app review. An agent paraphrase
cannot manufacture signed user approval. First extension is one exact bounded category reallocation
proposal through the same Finance writer; it does not activate standing policy or consume it as automatic use.

Default coaching is adaptive questions/actions only; successful maintenance stays quiet. Expose optional
daily check-in preference and preferred local time to callers without scheduling an agent. Default quiet
hours 22:00–08:00; unchanged-item reminder interval seven elapsed days with custom/never settings. Replies
qualify for quiet-hour exemption only when tied to a verified inbound within the last 24 hours; this grants
no response-time promise. Default check-in time is 09:00 local when explicitly enabled, one eligibility
slot per owner/local date/channel. Daylight-saving repetition cannot create a second slot. Store timezone
with the slot; timezone edits cannot reopen a consumed slot on the same calendar date.

The caller supplies an eligible work/question or an explicitly enabled check-in; nohmi does not write
financial advice. Recheck work revision, consent, quiet hours, reminder history and privacy at send time.
Use existing stricter transport/length/rate limits. Changing text or rerunning an agent cannot reset the
work reminder identity. Multi-workspace aggregation includes only independently eligible redacted items;
it does not broaden source access. Re-enable does not replay expired or obsolete messages.

Maintain separate states for inbound acceptance, work handling, domain effects and outbound delivery.
Accepted finance changes remain applied if SMS fails. Unknown provider acceptance prohibits blind resend.
Retain outstanding/uncertain receipts until reconciliation or owner deletion. Redacted errors and explicit
recovery remain visible in app and tools.

## 10. App, links and capability experience

Retain scoped Reviews dialogs/drawers. Add a global `/reviews` destination composed from the same native
projections, with workspace filters and stable exact-item references. `/settings?section=reviews` explicitly
redirects to this view. Finance-scoped links remain supported. Put URL construction/parsing in shared domain
helpers so API, MCP and web agree; only Integration wires global routes and navigation. Deleted items show
unavailable evidence, not a different current proposal. Hidden scopes never leak item counts or titles.

About you supplies inspect/source/history/correct/dispute/promote/restrict/export/delete controls. Finance
adds remaining planning, carryover, policy/usage, goal funding, cashflow, recurring and report controls on
existing pages. Texting settings shows consent, authored messages, handling versus delivery, unresolved
children and safe recovery. Workspace knowledge controls reuse the same service. Responsive desktop/mobile
acceptance and keyboard/screen-reader behavior are required. Use the existing icon registry and feedback
contract; discrete action failures use Sonner and successful background saves stay quiet.

Capability discovery derives from real registration plus required dependencies, not a hard-coded optimistic
manifest. Distinguish supported, permission-blocked, configuration-blocked and unavailable. Tools return
stable next actions and exact app links. No UI claims an agent is running or will answer because work exists.

## 11. Optional work events

After polling works, add opt-in owner-managed HTTPS subscriptions independent of host registration.
Transactional outbox records only work ID/type/revision and fetch reference. At-least-once delivery uses
stable event ID; receivers must fetch current state under their own scopes. Body maximum 4 KiB; no message,
knowledge body or credentials. Max five subscriptions per account; signing secrets encrypted, revealed only
at creation/rotation. Use a cryptographically random 32-byte signing key. `Nohmi-Event-Id` is the UUID,
`Nohmi-Timestamp` is integer Unix seconds and `Nohmi-Signature` is `v1=` followed by base64 of
HMAC-SHA256 over UTF-8 `timestamp + "." + eventId + "."` followed by exact raw body bytes.
Receiver window is five minutes; compare signatures in constant time and deduplicate event IDs.
Rotation allows old/new verification for 24 hours, then erases the old secret. Revocation stops queued sends.

Verify endpoint ownership using a one-time random challenge via HTTPS POST (expires in ten minutes) with
no account data; accept only a 2xx JSON response echoing the exact challenge under `challenge`.
Only public HTTPS on port 443; disallow credentials, IP-literal hosts, private/link-local/
loopback/multicast/reserved addresses. Resolve and validate every attempt and pin the connection address
while preserving hostname TLS verification; no redirects. Five-second total attempt timeout, no nested
HTTP retries, maximum two concurrent requests globally and one per subscription. Attempts at acceptance,
then after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours; afterward mark failed. Honor bounded
Retry-After within the next 24 hours; expire delivery after 24 hours. Keep redacted terminal delivery
metadata seven days, then delete; native work persists. Polling recovers missed events.

Integrate the dispatcher with existing lifecycle/drain conventions. No inbound listener for external
agents, host reachability certification or automatic agent launch is introduced. Production-equivalent
network/authority evidence is required for this optional boundary itself before activation.

## 12. Rollout and completion criteria

Additive migrations only; allocate each filename and journal entry at execution against current main.
Deploy readable schemas/contracts before writers, register capability only after composition/tests, and
retain rollback readers for accepted new records. Disable new effect admission on rollback without deleting
pending receipts. Bounded backfills checkpoint progress and preserve source identity. No auto-upgrade of
credential scopes, SMS consent or budget authority.

Plans: [shared toolkit](../plans/2026-10-12-shared-toolkit-completion.md),
[Finance](../plans/2026-10-12-finance-completion.md), [Texting](../plans/2026-10-12-texting-completion.md).
The [execution map](../plans/2026-10-12-finance-texting-completion.md) gives dependencies and full coverage.

Completion requires domain tests, real PostgreSQL races/migrations/deletion, API/client/MCP contract and
normal-discovery calls, responsive app journeys and full repository verification. Real provider/transport
proof is separate and authorized for the particular environment. Tests cannot prove production consent,
carrier eligibility, network reachability or external-agent availability. A scripted authenticated caller
can prove fresh-session resumption; it need not certify Claude, Codex, local or cloud hosting.
