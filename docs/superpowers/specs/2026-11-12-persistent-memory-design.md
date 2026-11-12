# Persistent memory completion design

Status: Planning complete; product implementation and release acceptance remain outstanding.
Owner: COO-165 — Persistent memory. Implementation slices: COO-166 — Memory API/MCP,
COO-167 — Purpose-bound retrieval, COO-168 — Inspectable memory controls.

## 1. Intent and decisions

nohmi stores the person's reusable context so an authorized agent in a later session can find,
understand and use it without relying on another agent's private conversation. The person can
inspect, correct, limit and forget that context. External agents reason; nohmi provides typed
storage, evidence, deterministic retrieval and enforceable controls. Memory never grants authority.

Cooper confirmed on November 12, 2026: low-risk preferences may become accepted automatically
with enough evidence, must remain labeled inferred and easy to correct; sensitive facts and
anything changing agent authority require confirmation. Confirmation of knowledge is distinct
from approving an action or granting a permission in the owning domain.

Engineering defaults in this design are proposed implementation choices, not additional statements
from Cooper: the initial preference allowlist, three-day evidence threshold, pagination limits,
default review interval and client placement. They make the plan executable and can be revised
without changing the confirmed product boundary.

## 2. Approach and scope

Extend existing PostgreSQL records and API-owned semantics, with thin typed client/MCP adapters.
Use exact filters and PostgreSQL full-text search first. This is the recommended continuation of
the agreed foundation. A free-form transcript store cannot provide reliable correction or source
authority; a separate vector-memory service adds another deletion/permission boundary without
solving the missing lifecycle. Neither is part of this release.

In scope: creation/proposals, correction, disputes, confirmation, supersession, restriction,
forgetting, evidence-based low-risk promotion, listing/search/context, explanation, export,
responsive web/desktop and native-mobile controls, and cross-session acceptance.

Out of scope: an internal agent, bulk transcript extraction, semantic embeddings, shared-household
memory, general work-claim orchestration, goal hierarchy redesign, Finance/Texting expansion,
automatic permission changes, and per-agent sensitive-category sharing. Existing goals and domain
records remain canonical. Source import is explicit and bounded, not a required bulk migration.

## 3. Source baseline

At consolidated source `83d784ce`, save/read exists through `POST /v1/knowledge`,
`GET /v1/knowledge/:id`, `save_knowledge` and `get_knowledge`. Initial revisions, source attribution,
relationships, receipts, redacted audit and live credential checks exist. The accepted value limit
is 8 KiB, with 20 evidence references and 20 relationships per mutation. Preserve Unicode and
generated inference envelopes without truncation.

Missing: lifecycle operations, discovery, retrieval, learning, history/export, user controls and
integrated use by later agents. Status/date/confidence fields alone are not implemented lifecycle
behavior. Existing creation sets revision 1, empty validity/review dates and coarse confidence.
Sensitive records currently cannot be disclosed to agents. Entity-meaning references currently
resolve Knowledge records, not arbitrary workspace entities; goal evidence revisions are rejected.

The consolidation passed 102 focused tests and affected backend typechecks. That is not a full
release receipt or production availability. Historical hosted evidence and operator observations
retain their original candidate identities. Published SQL and journal entries are immutable;
the appended 0139 recovery handles the later main watermark, subject to fresh execution review.

## 4. Records, provenance and state

Keep typed fact, preference, relationship, goal-reference, constraint, routine, decision,
entity-meaning and inference content. Add a schema-versioned origin field (`stated` or `inferred`)
independent of lifecycle status and acceptance (`owner`, `evidence_rule`, or null), plus the
acceptance actor/rule version, time and evidence references. An active inferred preference stays
inferred in every API response and UI. Owner confirmation of an inference records confirmation;
it does not rewrite its original source. A new explicit owner correction can supply stated content.

Backfill existing rows conservatively from server-recorded provenance: inferred content remains
inferred; agent-recorded statements remain attributed to the agent, never server-verified owner
messages. Do not manufacture evidence or calibrated certainty from existing 0/1 confidence values.
Prefer evidence counts and source explanations to percentages in the UI.

Statuses remain proposed, active, disputed, superseded and expired. Forgotten is a content-free
tombstone, not a readable revision. Facts can change over time; validity periods distinguish
an update from a contradiction. An obsolete claim remains history until explicitly forgotten.

Use a normalized claim key: owner + subject reference + predicate/preference key + workspace.
Normalize Unicode NFC, trim and collapse whitespace, and case-fold identifiers only, not values.
Owned entity IDs are preferred; free-text subject identities do not promise semantic alias matching.
Overlapping valid claims with the same key and different typed values form a visible conflict.
No last-writer-wins resolution and no model-based contradiction detector are implied.

## 5. Mutation and authority contract

Every mutation has a UUID mutation key; changes to existing records also require expectedRevision.
Use the existing owner lock order, then current credential and record rows, within one transaction.
Recheck ownership, scopes, purpose, source availability and restriction at commit and on receipt
replay. Wrong-owner reads return not found. Stale edits return conflict with only currently
disclosable current state; changed-payload key reuse fails. Lost responses can be retried safely.

Operations: revise, dispute, confirm, supersede, restrict and forget. Revision history is immutable
for ordinary edits; deliberate forgetting is its explicit content-erasure exception. Supersession
links an owned predecessor and replacement and rejects cycles. A dispute excludes a record from
ordinary accepted context until resolved. Human corrections take precedence over inferred values.

Agents with both knowledge scopes may propose and revise within existing disclosure boundaries,
but cannot confirm on the owner's behalf, weaken restrictions, resolve an owner dispute, or
forget records. Those actions require an authenticated human session in this release. An agent
correction to an owner-confirmed value creates a proposal/conflict rather than overwriting it.
Human saves/confirmations bind the exact displayed value and revision; ordinary explicit human
entry counts as confirmation without an additional ceremonial prompt.

Sensitive agent submissions are private proposals: return only proposal ID and pending-owner-review
state, including on replay. The value is visible to the owner only. Confirmation permits use as
owner knowledge, not disclosure to an agent; sensitive agent sharing remains unavailable in this
release. A caller cannot label sensitive information as an allowlisted low-risk preference: only
strict enumerated presentation keys/values qualify, with no arbitrary payload or source excerpt
included in the promoted preference. Other free text never qualifies for automatic promotion.

Anything resembling an instruction or authority preference stays informational. Even explicit
confirmation of “allow automatic purchases” cannot change grants or action policy. Link to the
existing domain's exact approval flow if an authority change is desired.

## 6. Low-risk learning

Initial allowlist: presentation.detail = concise|detailed and presentation.format = prose|bullets.
Only standard-sensitivity, non-action preferences qualify. No identity, health, financial,
relationship, scheduling, notification-sending or permission preference is eligible.

The owner can enable/disable automatic acceptance; default enabled for this allowlist under the
confirmed product direction. Disabling stops future promotions but does not silently delete
already accepted preferences. Each accepted preference remains individually correctable.

Require at least three independent explicit user selections supporting the same value on three
distinct local dates in a rolling 30-day window, no contrary eligible selection in that window,
no unresolved conflict, and no owner rejection/suppression of that claim key. Only authenticated
first-party selection events qualify initially; an agent's reported conversation may support a
proposal but cannot manufacture promotion evidence. A single user correction saved as a durable
preference is immediately authoritative and does not require three events.

Store immutable source-event IDs, event time, event-local date and time zone. Repeated tool calls,
summaries, retries, agents or copied evidence never multiply a source event. Deletion/revocation of
evidence makes it ineligible on reevaluation. API code evaluates the rule transactionally when new
evidence arrives or the owner changes the learning setting; no internal model or recurring agent.

Promotion adds an immutable revision with origin=inferred and acceptance=evidence_rule, rule version
and supporting event IDs. Default reviewAt is 90 days after acceptance; overdue inferred preferences
are labeled stale and excluded from default accepted context until refreshed or owner-confirmed.
An explicit contradictory selection disputes automatic acceptance immediately. Owner correction or
rejection suppresses auto-promotion for that claim key until the owner explicitly resets learning
for it; further behavioral repetition cannot undo that decision.

## 7. Correction, restriction and forgetting

Correction updates future context immediately and retains inspectable prior versions. Restriction
narrows workspace/purpose use and invalidates derived access; it is not deletion. Source removal
marks evidence unavailable, but does not erase an independently stated fact. Revoking a contributor
prevents access, not ownership of their previous account contributions.

Forget permanently removes a record's content from live records, revisions, evidence excerpts,
search projections, exports, cached API/client results and receipt replay. Keep only non-content
receipt/tombstone identity needed to prevent resurrection and explain an unavailable reference.
Do not retain plain-text values or unkeyed value hashes as “redaction.”

Track explicit derivation edges separately from ordinary related links. Before forget, an owner-only
preview returns affected record/revision IDs, dependent-copy count and affected history count.
Commit binds the preview to the current owner knowledge epoch; changed dependencies require a new
preview. Erase dependent derived copies transitively, including their revision snapshots; merely
related independent records remain, with removed references. Source documents/messages/tasks remain
unless separately deleted through their own domain. Explain that distinction in the confirmation.

Store a per-owner keyed suppression fingerprint of the canonical claim key (not the forgotten value)
to prevent automatic recreation from the same declared claim. No automatic semantic guarantee is
made for differently phrased claims. An explicit human re-add may clear that suppression; agents
cannot clear it. Account deletion removes tombstones, fingerprints and learning evidence as well.

Increment the owner knowledge epoch on forget/restrict/correction and evidence invalidation. Search
cursors, context explanations, exports and client caches must reauthorize/revalidate against it.
No persisted context pack stores copied memory bodies. External agents may already have received
content; nohmi cannot recall those copies. Encrypted historical backups are not instantly rewritten:
release must document their actual retention and an independently retained deletion ledger replayed
before a restored service is exposed. Missing ledger/recovery access blocks release, not a claim of
complete erasure. Minimize ledger data to IDs/epochs and suppression fingerprints, never content.

## 8. Retrieval and explanation

Expose owner browsing, filtered search, detail/history, bounded context and explanation. Apply current
owner/scopes/purpose/workspace/sensitivity filters before candidate selection, counts, ranking or
pagination. Recheck source/derived restrictions at read time; a snapshot of old grants is insufficient.
Owner management views can inspect proposed/disputed/history; normal agent context excludes them
from accepted facts. Optional uncertainty sections are explicit and remain permission-filtered.

Query: workspace (optional), one enumerated purpose, at most 20 owned entity refs, optional time
window/text and limit 1–50 (default 20). Preserve setup/bookkeeping/planning/review/communication/
recovery purposes. Context response maximum is 32 KiB serialized UTF-8, including envelope; expose
truncation and fetch references, never silently truncate record content. Search query max 500 chars.
Opaque cursors expire after 15 minutes and bind actor, owner, filter, purpose and knowledge epoch;
changed authority or epoch requires a fresh query rather than serving a stale page.

Use structured filters and PostgreSQL full-text ranking, then deterministic ties: exact entity match,
active/current validity, freshness, source class, stable ID. A disclosed record must also have live
eligible source references. A missing source yields unavailable evidence, not invented corroboration.
Separate stated facts, active inferred preferences, tentative inferences, conflicts and missing inputs.
Expired/disputed/review-overdue material cannot satisfy a required current input. A query cannot
promise that an absent memory is true or that all necessary context is known.

Persist context-use ID, selected IDs/revisions and bounded reason codes, not values or query text.
explain_context reauthorizes every referenced record and reports unavailable/changed state without
resurrecting old bodies. A context pack is evidence, never an instruction authority channel.

Owner-only export is paginated (50 records/page), includes permitted history/provenance and schema
version, and fails/restarts on epoch change. No durable server export blob or emailed attachment.
Deleted content is absent. Sources are references/allowed excerpts, not a bulk export of native data.

## 9. App experience

Use a dedicated Memory entry in existing account settings, not a new workspace or navigation redesign.
Responsive web serves browser/desktop; native mobile uses the same API and dedicated screen.
Views: accepted context, inferred/proposed items needing review, and conflicts. Search and filters
support type/workspace/status. A row shows readable content, stated/inferred origin and relevant
freshness; detail reveals source, contributing agent, acceptance reason, history and permitted use.

Actions: add, edit, confirm/reject, resolve a conflict, change use restrictions, export, and preview/
confirm forget. Sensitive proposals are owner-only. Learning settings show the eligible categories,
evidence rule and enable switch. An accepted inferred preference says “Inferred” and “Accepted from
3 selections” (actual count), never “You told us.” No percentage-confidence decoration.

Corrections are explicit Save actions. Loading/success/failure for discrete actions use one Sonner
toast; no inline result banners. Background successful autosaves, if any, remain silent. Follow the
native pull-to-refresh spinner/error-only exception. Handle stale-edit conflicts with refreshed
values and recovery controls, without automatic overwrite. Clear owner-scoped caches on logout,
account change and mutation epochs; no offline knowledge persistence or offline write queue in v1.
Make keyboard, screen-reader, large-text, small-screen and native-back-navigation behavior testable.
Export uses existing platform download/share mechanisms and clearly reports when it is unavailable.

## 10. Acceptance and delivery boundary

1. Agent A saves allowed sourced knowledge; agent B discovers it by purpose after a fresh server/session.
2. Owner correction affects B's next retrieval; stale agent writes conflict and do not reverse it.
3. Three independent eligible selections promote an inferred preference; repeats and sensitive or
   authority claims do not. Inferred origin survives promotion, export, explanation and correction history.
4. Restriction/revocation applies to search, counts, history, derived records, cursors and exact retries.
5. Forget removes live and historical values plus dependent copies; a lost response retry, export,
   old context-use ID and restored-backup rehearsal cannot disclose or resurrect them.
6. Web/desktop and native mobile can inspect, correct, review and forget through the same API.
7. Real PostgreSQL tests cover migration, concurrent mutations, recovery and cascade; registered
   HTTP/client/MCP tests prove parity, and browser/native tests prove controls and accessibility.
8. Complete current-candidate review and repository verification precede an authorized release.
   Production recovery access, deployment provenance and authenticated fixture acceptance remain
   separate gates; never invent personal memories or treat historical CI as new evidence.

## 11. Clarified implementation decisions

### Existing history

Use sidecar metadata keyed by record/revision for the compatibility projection; leave published
revision JSON untouched. Missing acceptance evidence maps to null, not owner confirmation. Newly
appended revisions contain the full versioned shape. Receipt replay reauthorizes the projection,
without rewriting original input hashes or inventing past approval.

### Selection evidence

The Memory screen exposes separate actions: “Use this time” records one authenticated selection
for session context; “Remember this preference” immediately saves an explicit stated preference.
Authorized agents may retrieve the former as session context, but nohmi does not guarantee that an
agent follows it. Only instrument other first-party surfaces once they expose that same explicit
choice. Do not mine passive clicks. Server-issued interaction IDs deduplicate retries; repeated
selections on one local date still contribute only one supporting date. Session selections expire
from active context after 24 hours, while eligible evidence is retained for the rolling 30-day rule.

### Source changes

Eligibility is per supporting claim, not “all sources must exist.” An independent owner statement
survives provider removal, showing that source as unavailable. Agent-recorded wording plus external
session/message refs is attributed stated evidence, not independently verified evidence and never
eligible for auto-promotion counts. Derived inference with no eligible support becomes disputed.
Upstream correction disputes explicitly derived descendants until reevaluated; ordinary related
records remain unchanged. A restricted source still constrains its copies even with other support.
Removed selection evidence triggers reevaluation; insufficient support disputes automatic acceptance.
Revoking the contributing credential alone does not erase evidence or account-owned statements.

### Forget completion and restore safety

Forget is a durable operation, not an in-memory request. Commit a pending operation and erasure
outbox entry, then immediately deny memory-content reads and writes for that owner during erasure.
Status reads remain available without bodies. A resumable worker computes the derivation closure
and erases at most 100 records per transaction; preview pages expose 50 IDs/revisions plus counts.
This owner-level temporary fence prevents concurrent derivations and stale context access. A stale
preview conflicts before admission. Ordinary independent records become available again at completion.

The existing backup/recovery operator owns an encrypted append-only deletion-ledger destination
outside the restorable database and its failure domain. Terminal success requires local erasure
AND a durable read-back-verified external append receipt; append by operation ID is idempotent.
A crash between external acknowledgement and local completion safely retries the same append.
Unavailable storage leaves pending/retryable status, never false success. Restore admission fails
closed without the authoritative ledger, including reconciliation of snapshots taken during deletion.
Only IDs/epochs and keyed suppression fingerprints cross this boundary. Do not provision a new
service or change production configuration without the applicable execution authority.

The ledger adapter has append/read-receipt methods, a 10-second attempt timeout, one active attempt
per owner, and capped retries at 1, 5 and 30 minutes. After those attempts, expose blocked/retry-needed
with operator recovery and an explicit retry action; memory stays fenced rather than leaking data.
Background recovery uses durable jobs and shutdown fencing. Configuration, destination identity,
transport/ports and credential access must be verified against the actual existing recovery system
before implementing its production adapter. Those are recorded operational prerequisites, not
claims supplied by a passing fake-ledger test. Approved production destination and matching recovery
key access remain unresolved; feature release cannot claim restore-safe forgetting until they exist.

## 12. Related contracts

The canonical [User Knowledge contract](../../product/user-knowledge.md) owns product policy;
[ADR 0005](../../architecture/0005-user-knowledge.md) owns architecture. This design and the
[completion plan](../plans/2026-11-12-persistent-memory.md) supersede memory portions of the
October 12 shared-toolkit plan (S1–S3, memory controls in S6, memory acceptance in S8).
Unrelated work claims, events, Finance/Texting expansion and goal redesign are not prerequisites.
