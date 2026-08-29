# Mail workspace Ilo stewardship design

**Date:** 2026-08-15
**Status:** Approved in conversation
**Workspace:** Mail

## Goal

Make the Mail Ilo a persistent expert steward that keeps every material conversation accounted for
against the person's goals. It maintains clear obligations, ownership, timing, evidence,
uncertainty, recovery, and a durable review without depending on an MCP host to know how Mail should
be maintained.

The default outcome is obligation integrity, not inbox zero. A person's active Mail goals may define
a different desired organization or review cadence, but goals cannot override evidence, safety,
provider capability, or the permanent prohibition on sending mail.

This design applies the product doctrine in
[`Ilo workspace stewardship`](../../product/ilo-workspace-stewardship.md), the architecture in
[`ADR 0004`](../../architecture/0004-workspace-ilo-stewardship.md), and the
[`workspace Ilo charter`](../../product/workspace-ilo-charter-template.md).

## Product promise

> Keep every material conversation accounted for against the user's goals, with clear obligations,
> evidence, ownership, timing, uncertainty, and recovery—without ever sending mail.

The Mail Ilo may inspect synchronized provider evidence, organize supported provider state, maintain
local stewardship state, prepare private response guidance, isolate questions, learn explicitly
approved rules, and explain the resulting position. It never sends, replies to, or forwards an
email.

## Explicit non-goals and product invariant

Sending mail is not an authority tier to add later. Ilo does not provide:

- email sending, replying, forwarding, or recipient selection;
- a provider-shaped draft that can later be transmitted by Ilo;
- provider filter creation, permanent deletion, spam classification, or unsubscribe execution;
- automatic link navigation, attachment execution, or authority derived from message content;
- external MCP client schedules, prompts, or automations; or
- legal, compliance, security, or records-management determinations that require a qualified human.

Private response guidance may identify purpose, facts to address, open questions, tone
considerations, and attachments the person may need. It is a local advisory artifact with no send
operation and no claim that a response was delivered.

The currently shipped `create_mail_draft` and `send_mail` surfaces conflict with this invariant and
are target removals. Until the removal slice ships, the implementation log and code remain the
authority for current behavior; this target design must not be described as already delivered.

## Living ledger

Mail's canonical ledger combines provider evidence with Ilo-owned stewardship state. Provider
material is a projection, never a replacement source of truth, and Ilo-owned judgments never
rewrite message content or provider history.

### Ledger records

| Record | Purpose | Authority and provenance | Degraded behavior |
| --- | --- | --- | --- |
| Connected Mail source | Account identity, enabled capability, connection and synchronization health | Connected-account ID, provider, granted capability, safe health code, last attempt, last success, next retry | Retain cached material; distinguish retrying, stale, reconnect, and unavailable |
| Mailbox projection | Provider mailbox or label identity and role | Account, provider remote ID, local ID, sync cursor/revision, projection time | Counts and membership are stale, not zero |
| Conversation projection | Thread subject, participants, message membership, provider state, timestamps | Account, provider thread ID, local thread ID, provider/local revision, last projection time | Preserve prior projection; absence from a capped page is not deletion evidence |
| Message projection | Sender, recipients, body text, attachment metadata, receipt time, provider state | Provider message ID, source revision, parent conversation, mailbox/label evidence | Mark partial projection or parsing limits; do not invent missing content |
| Obligation | One duty detected in a conversation | Conversation and message references, source revision, kind, owner, due/review time, confidence, rationale, closure evidence | Remains open or uncertain until source evidence or a person resolves it |
| Disposition | Current handling posture for a conversation | Conversation revision, goal/rule version, actor, rationale, effective time | Becomes stale when source, goal, or rule evidence changes |
| Stewardship context | Goals, motives, account meanings, relationships, priorities, retention preferences, exceptions | Approved profile/rule versions and explicit user decisions | Draft context is visible but non-operative |
| Question and proposal | Bounded uncertainty or proposed change | Exact evidence, choices, source revision, scope, deduplication identity | Remains open; never converts to an inferred answer |
| Rule | Reusable, explicitly approved behavior | Version, source scope, condition, action, exceptions, approval evidence, enablement | Drift pauses or invalidates execution; prior versions remain auditable |
| Effect evidence | Local or provider mutation lifecycle | Operation, source revision, rule/policy, idempotency identity, provider effect, audit | Ambiguous effects reconcile before replay |
| Maintenance run and step | Durable stewardship progress | Scope, cutoff, versions, claims, checkpoints, retries, settlement | Resumes, recovers, blocks, or fails honestly |
| Review artifact | Durable explanation of state and changes | Run, scope, evidence cutoff, source links, prior review, publication version | A changed assessment produces a successor; published reviews are immutable |

### Obligation model

An exact conversation may have more than one obligation. Initial kinds are:

- `reply`: the person appears to owe a response outside Ilo;
- `follow_up`: the person should revisit or prompt another party;
- `decide`: the conversation contains a decision the person must make;
- `schedule`: a potential time commitment needs Calendar review;
- `record`: the material should be retained or linked for an approved business or personal purpose;
- `security_review`: authenticity, sensitive information, a link, or an attachment needs human
  judgment.

Each obligation stores its owner (`user`, `other`, or an explicit named relationship reference),
state, due point or next-review point, source revision, relevant goal or motive, confidence,
evidence, and closure evidence. `other` never means Ilo will reply or act outside the supported Mail
operations.

### Disposition model

Conversation disposition is separate from obligation state:

- `active`: work remains with the person;
- `deferred`: deliberately postponed until an exact review time;
- `waiting`: another party or external event is expected;
- `delegated`: another person owns the next move, with a follow-up point when relevant;
- `reference`: retained for context with no known active obligation;
- `noise`: non-material under an explicit decision or rule;
- `resolved`: all known obligations have closure evidence.

This separation prevents a waiting or delegated conversation from disappearing when it still needs
a dated follow-up.

## Expert playbook

The playbook is a versioned server-owned product asset. It records its research sources,
applicability, review date, assumptions, affected judgments, and evidence requirements. A client
prompt, model memory, or repository coding skill is not runtime expertise.

The initial corpus is `mail-playbook-v1`, reviewed on 2026-08-15. Every release records the exact
source revision or retrieval date. The review cadences below are maximum intervals; a relevant
standards, provider, security, or product-policy change triggers an earlier review.

| Professional discipline | Responsibilities reproduced | Initial authoritative research | Limits |
| --- | --- | --- | --- |
| Chief of staff | Relate correspondence to goals, commitments, important relationships, dependencies, deadlines, and opportunity cost | User-approved goals and motives; Mail-owned priority rubric | Does not infer the person's goals, make relationship decisions, or claim executive authority |
| Correspondence triager | Identify materiality, response need, routing, ownership, urgency, and follow-up state | [UK Cabinet Office correspondence guidance](https://www.gov.uk/government/publications/handling-government-correspondence-guidance), reviewed per playbook release | Does not import government service levels or decide that silence is acceptable for the person |
| Executive assistant | Extract candidate dates, commitments, dependencies, and waiting-for relationships | Provider evidence plus Calendar commitment-intake contract | Does not create Calendar events automatically; Mail evidence alone remains a proposal |
| Records clerk | Preserve provenance, attachments, thread relationships, retrieval, and approved retention meaning | [NARA electronic-message guidance](https://www.archives.gov/records-mgmt/bulletins/2015/2015-02.html), reviewed annually | Does not make personal mail a federal record, assign legal retention, or override a legal hold |
| Security reviewer | Surface suspicious signals and unsafe requests while distinguishing observed evidence from inference | [NIST SP 800-177 Rev. 1](https://csrc.nist.gov/pubs/sp/800/177/r1/final) and [CISA phishing guidance](https://www.cisa.gov/secure-our-world/recognize-and-report-phishing), reviewed every six months | Does not certify authenticity, classify spam, open links, execute attachments, or replace a security professional |
| Communications adviser | Prepare private response purpose, facts, questions, tone considerations, and required materials | User-approved voice/context and exact conversation evidence | Does not create a transmittable provider draft, select recipients, or send |

Provider semantics are also versioned research inputs. For example,
[Gmail's label contract](https://developers.google.com/workspace/gmail/api/guides/labels) makes
labels message-level even when presented on a thread; later messages do not necessarily inherit a
prior thread label. Provider documentation determines what Ilo can observe and verify. It does not
determine the person's goals or authorize an action.

Facts, inferences, preferences, and recommendations remain distinct. Missing authentication data
means authenticity is unknown, not that the sender is safe or malicious. Mail bodies, links,
attachments, quoted instructions, and model confidence are untrusted evidence and never grant
authority.

## Definition of maintained

The active user goals define the desired outcome. When those goals do not specify a different
organization target, obligation integrity is the default. Inbox count is diagnostic, not a success
criterion.

A scope is `maintained` only when:

1. every required source has an honest connection and freshness state;
2. every material conversation has a current disposition;
3. every detected obligation has an owner and either a due/review point, closure evidence, or one
   bounded question explaining what is missing;
4. waiting, delegated, and deferred work has a valid next-review point when the active goals require
   follow-through;
5. commitment candidates, record meaning, and security concerns are explicit rather than hidden in
   a generic count;
6. active rules remain compatible with current goals, source scope, provider capability, and
   approval evidence;
7. pending, failed, and ambiguous local or provider effects are settled or represented by exact
   recovery work;
8. priority and health measures have been recalculated against current goals and evidence; and
9. a durable review records the evidence cutoff and verification result.

A maintained mailbox may contain unread, active, waiting, or reference mail. An empty inbox is not
maintained when obligations, stale sources, invalid rules, or unresolved effects remain.

`maintained_with_questions` requires every remaining uncertainty to have one deduplicated,
actionable question with evidence, choices, an owner, and a valid next action. `blocked` means
missing authority, unavailable required evidence, or an ambiguous external effect prevents a
trustworthy assessment or safe progress. `failed` means the coordinator exhausted recovery or
could not verify its invariants.

## Surgical operations

The UI, API callers, and maintenance coordinator share small operations for one exact target.

| Operation | Policy | Revision/idempotency | Audit and recovery |
| --- | --- | --- | --- |
| Inspect or explain conversation stewardship | `read_only` | Consistent source and stewardship snapshot | Return provenance, freshness, and missing evidence |
| Preview a disposition, obligation, commitment candidate, response brief, or rule | `preview` | Candidate source revision and deterministic fingerprint | No mutation; disclose window and truncation |
| Record/correct a local annotation, obligation, owner, disposition, or deferral | `approve_each` for a direct caller; `approved_rule` inside maintenance | Expected conversation and stewardship revision | Redacted before/after audit; reversible correction |
| Answer one question | `approve_each` | Expected question and source revision | Resolve present case; preserve answer and re-evaluation evidence |
| Approve a reusable rule | `approve_each` in the signed-in product | Expected proposal/rule version and preview fingerprint | Versioned activation, rollback, and affected-scope audit |
| Change read/unread, star, owned label, archive, or recoverable trash | `approve_each` directly; `approved_rule` inside maintenance | Exact source revision and effect identity | Provider-effect ledger; synchronize and reconcile before replay |
| Snooze or set a local follow-up point | `approve_each` directly; `approved_rule` inside maintenance | Exact obligation/conversation revision | Local reversible audit and expiry behavior |
| Re-evaluate one target | `preview` for a direct caller; `approved_rule` inside maintenance when derived records change | Target, source revision, and cause identity | Deduplicate questions, proposals, and reviews |

Unsupported operations fail as unavailable capabilities. They are never represented as a missing
scope that a caller could request.

## Rulebook, questions, and learning

The effective Mail rulebook is assembled from:

- active Mail goals and motives;
- the approved Mail profile and source meanings;
- important relationships and priority definitions;
- active deterministic Mail rules and exceptions;
- retention and follow-up preferences;
- provider capability and source scope; and
- non-overridable product safety rules.

Every run records the exact versions it loaded. If a goal, profile, rule, source revision, or
provider capability changes before mutation, the API stops affected writes and revalidates or
settles with a question or blocker.

### Question contract

A question is durable, source-linked, deduplicated, and bounded. It contains the observed facts,
the inference that could not be settled, available choices, the effect of each choice, a one-off
answer path, and any separate reusable-rule proposal. Examples include:

- Does this conversation require a reply, or is it reference only?
- Who owns this follow-up and when should it be reviewed?
- Is this sender or topic important under the current goals?
- Should this exact conversation be archived, retained, or recoverably trashed?
- Should this commitment candidate proceed to Calendar review?
- Is this result a one-time exception or should Ilo propose a narrowly scoped future rule?

### Learning contract

An answer resolves the present case first. Generalization is a separate workflow:

1. record the answer with its source and question revisions;
2. re-evaluate the affected obligation and disposition;
3. when a reusable pattern is plausible, create a proposal with scope, examples,
   counterexamples, exceptions, action, and affected records;
4. require explicit approval before activation;
5. version the rule and re-evaluate only its declared scope; and
6. preserve correction, disablement, rollback, and prior-version history.

Silence, archive behavior, an absent message, repeated model output, or confidence alone never
becomes a learned preference. Feedback may mark a judgment `correct`, `incorrect`, `outdated`, or
`exception`; that feedback updates the present case and may support a proposal, but it is not itself
blanket authority.

## Durable maintenance turn

The domain owns one loop for `all_outstanding`, a bounded time window, and an exact target:

1. coalesce with or fence a compatible active run;
2. normalize scope and record the evidence cutoff, goals, playbook, and rulebook versions;
3. request synchronization of relevant sources through the durable connector scheduler;
4. inspect freshness and reconcile changed, duplicate, missing, stale, and ambiguous evidence;
5. detect material conversations, obligations, deadlines, waiting relationships, commitment
   candidates, and security concerns;
6. apply deterministic rules and other operations already allowed by current authority;
7. create or refresh bounded questions and proposals for irreducible judgment;
8. recalculate priority, overdue follow-ups, relationship state, goal coverage, and health;
9. publish the review artifact; and
10. verify every maintained-state check before settlement.

The server, not the client, owns pagination, batching, sequencing, thresholds, leases, retries,
checkpoints, and verification. A windowed run mutates only eligible evidence inside its scope but
still reports older backlog. A target run never makes the wider workspace appear maintained.

### Durable execution

A run stores its normalized scope, cutoff, goal/playbook/rulebook versions, source snapshot, steps,
checkpoint, lease generation, idempotency key, actions, questions, proposals, failures, audit
references, review, and verification result. Each step commits independently and advances only
after its audit evidence commits.

Compatible concurrent requests coalesce. Incompatible overlapping scopes fence writes by account
and conversation. Process loss resumes from the first unsettled step. External ambiguity enters
exact-state reconciliation before replay. Repeating the same intent returns, resumes, or verifies
the compatible run instead of duplicating effects, questions, proposals, or reviews.

The run lifecycle is `queued`, `running`, `recovering`, or `settled`. Settlement is exactly one of
`maintained`, `maintained_with_questions`, `blocked`, or `failed`. A run does not hold a lease or
remain indefinitely active while a person thinks; it settles `maintained_with_questions`, and a
later target or full run re-evaluates after the answer exists.

## Status and health model

Mail status exposes separate dimensions so one reassuring label cannot hide stale evidence or
unresolved work:

```ts
type MailStatus = {
  readiness: "not_configured" | "ready" | "degraded" | "blocked";
  run: "idle" | "queued" | "running" | "recovering";
  assessment:
    | "not_assessed"
    | "maintained"
    | "maintained_with_questions"
    | "blocked"
    | "failed";
  headline:
    | "setup_required"
    | "maintaining"
    | "maintained"
    | "questions"
    | "blocked"
    | "failed"
    | "unknown";
};
```

The domain/API calculates `headline` and its ordered reasons. Web and MCP do not derive it from
counts. Status also returns:

- evidence cutoff and per-source connection/freshness;
- goal, playbook, and rulebook versions;
- obligations grouped by kind, owner, age, and due state;
- waiting, delegated, and deferred follow-up exposure;
- questions, proposals, failed or ambiguous effects, and recoveries;
- latest run and latest review;
- valid next intents and first-party recovery links; and
- health dimensions with evidence, missing inputs, trend, and confidence.

Initial health dimensions are source trust, obligation coverage, timeliness, follow-through,
uncertainty/security exposure, and rule/effect integrity. Active goals may weight the dimensions,
but cannot override source truth or safety invariants. An unavailable input produces `unknown`, not
a favorable zero.

## Analysis, advice, and review artifact

Mail advice connects evidence to the person's approved goals and demonstrated decisions. Each
recommendation names its evidence, assumptions, time horizon, confidence, tradeoffs, and unresolved
risks. Advice may recommend a review cadence, a narrower rule, a relationship follow-up, a Calendar
proposal, or a source repair. It never recommends or performs an outbound send through Ilo.

Every settled run publishes an immutable, versioned review with:

1. scope, requested goals, evidence cutoff, and source freshness;
2. material examined and material outside the scope;
3. conversation, obligation, and disposition changes;
4. completed local and provider effects with audit references;
5. waiting, delegated, deferred, and overdue follow-ups;
6. security or authenticity concerns requiring judgment;
7. open questions, proposals, blockers, and recovery work;
8. goal coverage, relationship patterns, and changes from the prior review;
9. recommendations and tradeoffs;
10. rules applied, corrected, proposed, activated, or disabled;
11. maintained-state verification and the next suggested maintenance point; and
12. links to exact conversations, questions, activity, and recovery surfaces.

The durable review contains source references and privacy-minimized explanations, not copied
message bodies, attachment contents, credentials, or raw provider errors. Publication is the
commit point. Changed evidence creates a successor linked to the prior review; a published review
is never rewritten in place.

## Product and API surfaces

The Mail workspace remains the operational surface. Its mailbox and reader continue to show
provider material. A stewardship summary shows status, freshness, outstanding obligations, and the
latest review. A conversation can disclose its obligations, disposition, evidence, questions,
response guidance, and proposed next step.

Mail questions and approvals may project into shared **Reviews**, but Mail owns every read model and
mutation. **Settings → Mail** owns goals, source meanings, rules, retention preferences, readiness,
and recovery. Compose and every send affordance leave the product.

The typed public API owns status, maintenance, questions, reviews, surgical operations,
authorization, synchronization, durable execution, audit, and recovery. Web and MCP consume the
same contracts.

## Stateless MCP intent surface

A mature Mail MCP surface adds:

- `get_mail_status`, requiring `mail:read`, for the complete domain-owned assessment; and
- `maintain_mail`, requiring `mail:write`, to start, resume, or verify `all_outstanding`, a bounded
  window, or an exact target.

`maintain_mail` uses the `approved_rule` policy. It may write transparent derived evidence,
questions, run progress, and review artifacts, but it may apply a provider change only through an
active rule that already authorizes that exact action and scope. It cannot supply an `approve_each`
decision, activate a rule, or widen token authority.

The client does not provide confidence thresholds, pagination, batching, retries, checkpoints,
playbook instructions, mutation policy, or approvals. The result includes a concise text summary
and structured durable state, changes, questions, blockers, health, verification, and first-party
links.

Existing useful list, read, exact-update, attention, and rule-preview tools remain surgical typed
API adapters. `create_mail_draft` and `send_mail` are removed. MCP owns no playbook, sequencing,
learning, status inference, run state, or completion decision. No external client automation is
part of this design. MCP Tasks remain unavailable until the public API and shared MCP surface own a
complete task-handle contract.

## No-send removal and compatibility

The removal lands as an explicit capability contraction:

1. stop advertising and accepting new Ilo Mail drafts or sends;
2. remove Compose and send/reply/forward affordances from the web product;
3. replace public send mutations with structured unavailable-capability compatibility responses,
   remove typed-client discovery, MCP tools, and connector send methods, then remove the API stubs
   after the compatibility window;
4. remove outbound Gmail authority and iCloud SMTP use that no remaining capability needs;
5. retain historical local draft rows read-only through a rollback-compatible release;
6. provide signed-in export or deletion for retained historical drafts without a send action; and
7. drop obsolete storage and runtime configuration only in a later contract migration after the
   rollback window closes.

Old clients receive a structured unavailable-capability response during the compatibility window,
not a discovery entry or a silent no-op. No migration converts a historical draft into response
guidance automatically because recipient-shaped content and advisory guidance have different
authority and privacy contracts.

## Ownership and parallel work

### Mail-owned surface

The Mail owner owns:

- ledger, obligation, disposition, question, status, playbook, rulebook, maintenance, and review
  contracts in `packages/domain/src/mail.ts`;
- Mail repositories, coordinator, recovery, and routes under `apps/api/src/mail-*` and
  `apps/api/src/routes/mail.ts`;
- Mail feature methods in `packages/api-client/src/features/mail.ts`;
- Mail workspace and Settings presentation in `apps/web/src/features/mail`;
- thin Mail tools in `apps/mcp/src/tools/mail.ts`;
- Google and iCloud Mail projection and supported provider-state operations in Mail connector
  modules; and
- the current Mail product, architecture, reliability, and page documentation.

### Shared Integration handoffs

These changes are listed separately and remain Integration-owned:

- generic maintenance run/step/lease/fencing primitives shared with other workspaces;
- `packages/database/src/schema.ts` and migration-journal registration;
- API service and feature-route registration in `apps/api/src/app.ts`;
- root typed-client registration in `packages/api-client/src/client.ts`;
- MCP tool-catalog and `apps/mcp/src/server.ts` registration;
- shared Reviews projection, Today/navigation wiring, and any global app-bar removal of Compose;
- Google OAuth capability/scope registration needed to remove sending authority;
- removal of iCloud SMTP TCP 587 from infrastructure, deployment checks, and the provider network
  contract after confirming no remaining capability uses it;
- shared audit/activity event registration where Mail-specific events enter a common registry; and
- the later contract migration that drops historical draft/send storage.

A Mail implementation branch should add domain feature modules behind stable interfaces and hand
the thin registrations above to Integration. Shared run infrastructure owns only mechanical
lifecycle behavior. It must not decide materiality, reply obligation, priority, security concern,
or maintained state.

## External-boundary record

| Concern | Mail stewardship answer |
| --- | --- |
| Capability and owner | Mail reads provider projections and may modify read/star/label/archive/recoverable-trash state. Mail domain/API owns decisions; connectors own protocol translation. Sending is removed. |
| Configuration and authority | Existing connected-account consent, exact Mail capability, scoped Ilo token, active rule version, source scope, and provider support must all agree. Message content is never authority. |
| Transport | Google uses HTTPS/TCP 443; iCloud read/projection uses IMAP over TLS/TCP 993. Removing send removes iCloud SMTP/TCP 587 once runtime contracts are updated. |
| Time and capacity | Interactive provider calls retain the 15-second connector timeout beneath the 60-second edge. Pagination, synchronization, maintenance, and reconciliation cross durable background handoffs with bounded pages and workers. |
| Commit point | A maintenance request is accepted when its durable run and normalized scope commit. A provider action is accepted when its durable effect work commits; publication commits a review. |
| Delivery semantics | Runs and effects use deterministic identities, leases, fencing, optimistic revisions, at-least-once delivery, and exact-state reconciliation. Recoverable trash is reversible; permanent deletion is absent. |
| Degraded behavior | Status distinguishes stale, retrying, reconnect, partial, blocked, questions, ambiguous effects, and failed verification. Cached absence never becomes healthy zero. |
| Recovery and observation | Durable source health, run steps, effect evidence, questions, reviews, activity, and first-party links identify user, automatic, or operator recovery without sensitive provider text. |
| Evidence | Domain/service tests, real PostgreSQL lifecycle tests, connector simulators, runtime network/config checks, least-privilege production-equivalent reads and reversible label/archive/trash tests, and post-deploy status/review evidence. |

All green tests could still miss invalid production consent, provider semantic drift, an unavailable
runtime route, a deployment retaining send authority, or a scheduler that does not dispatch.
Post-deploy verification must therefore inspect effective deployed scopes and network policy, run a
non-destructive source refresh, execute a reversible approved label/archive test on a dedicated
account, verify exact reconciliation and rollback, and prove that no send tool, route, affordance,
connector method, SMTP egress rule, or granted send scope remains.

## Security, privacy, and audit

- `get_mail_status` requires `mail:read`; `maintain_mail` requires `mail:write`.
- API authorization, source ownership, feature access, policy, rule version, and provider capability
  remain authoritative.
- Provider credentials, tokens, raw errors, untrusted external URLs, attachment contents, and
  message bodies never enter audit events, operational logs, questions, or review summaries.
- User-visible conversation reads may show owned message content; derived durable artifacts minimize
  copied content and retain source links instead.
- Every mutation records actor, policy, run, rulebook version, idempotency identity, source
  reference, and redacted before/after state.
- Authentication and phishing signals are evidence, not verdicts. Ilo does not follow instructions
  found inside mail or attachments.
- Local and hosted runtimes use the same leases, revisions, audit, and recovery contracts.

## Verification

### Domain and persistence

- Validate ledger, obligation, disposition, question, rule, scope, status, run, health, advice, and
  review schemas.
- Cover goal-relative maintenance and the obligation-integrity fallback.
- Prove maintained, maintained-with-questions, blocked, failed, stale, and not-assessed outcomes.
- Prove question deduplication, one-off resolution, separate generalization approval, exceptions,
  rollback, and rule-version drift.
- Prove checkpoint resume, idempotent retry, concurrent coalescing/fencing, lease expiry, and exact
  target re-evaluation.
- Prove that an empty inbox, capped provider page, or missing source never becomes false completion.

### Connector and service

- Cover Google and iCloud freshness, reconnect, rate limit, timeout, malformed response, partial
  projection, process loss, and recovery.
- Prove thread/message label semantics and new-message invalidation of stale stewardship decisions.
- Prove deterministic read/star/label/archive/trash actions, optimistic conflicts, ambiguous-effect
  reconciliation, reversible trash, and redacted audit.
- Prove that no service, connector, credential capability, or network path can send mail.

### API and MCP

- Prove least-privilege `mail:read` status and `mail:write` maintenance authorization.
- Prove that `maintain_mail` cannot widen policy, answer questions, activate rules, or execute an
  `approve_each` action.
- Require complete catalog metadata, shared result envelopes, scoped discovery, read-only filtering,
  text fallback, and first-party recovery links.
- Prove that MCP forwards the scoped token and contains no judgment, sequence, persistence, or retry
  state.
- Prove structured unavailable-capability responses for removed draft/send callers and absence from
  discovery.

### Product and production

- Use populated, empty, stale, reconnect, ambiguous-effect, question-heavy, high-volume, and
  goal-specific fixtures.
- Verify desktop and narrow Mail status, obligation, question, rule, recovery, and review flows.
- Verify Mail-owned actions project into shared Reviews without duplicating mutations.
- Verify Compose, send, reply, forward, and provider-send authority are absent.
- Run `pnpm verify` before handoff.
- Complete one production-equivalent maintenance turn over dedicated Google and iCloud sources,
  settle every item honestly, repeat without duplicate work, and verify the review and activity
  evidence.

## Acceptance criteria

The target Mail stewardship slice is complete when:

1. `get_mail_status` reports one internally consistent, evidence-cutoff assessment.
2. `maintain_mail()` requires no client-authored workflow and safely resumes after interruption.
3. Every material conversation in scope has a disposition and every obligation has closure,
   ownership/timing, or one actionable question.
4. Waiting, delegated, and deferred work cannot disappear without a valid follow-up decision.
5. Repeating maintenance creates no duplicate effects, questions, proposals, audits, or reviews.
6. Goals influence priority and health without granting authority or hiding objective failures.
7. Answers affect the present case, and reusable rules activate only through separate explicit
   approval.
8. Source staleness, partial projection, and ambiguous provider effects prevent false completion.
9. Web, typed API, and MCP expose the same domain-owned status and recovery truth.
10. No Ilo UI, API, MCP, connector, OAuth capability, runtime port, or durable workflow can send
    mail.

## Rollout order

1. Contract the permanent no-send invariant and audit current send dependencies.
2. Remove new draft/send discovery and capability while preserving rollback-safe historical data.
3. Add Mail ledger extensions, obligations, dispositions, questions, and review persistence.
4. Add status, health, and exact surgical operations.
5. Add the durable Mail maintenance coordinator and recovery.
6. Add the explicit learning and rule-proposal loop.
7. Expose typed API and the stateless MCP status/maintenance pair.
8. Add Mail workspace, Settings, Reviews projection, and review-artifact UI.
9. Remove obsolete send storage, OAuth authority, SMTP configuration, and TCP 587 only after the
   compatibility window and deployment evidence permit it.
10. Run production-equivalent maintenance and verify acceptance evidence.

## Out of scope

- Any external MCP host schedule, prompt, routine, or automation.
- Sending, forwarding, replying, bulk outreach, newsletters, or delivery analytics.
- Automatic Calendar event creation; Mail produces only evidence-linked commitment proposals.
- Permanent deletion, provider filter creation, spam classification, link navigation, attachment
  execution, and unsubscribe actions.
- Legal-retention policy, legal-hold administration, security certification, or professional
  impersonation.
- A generic workflow engine that encodes Mail judgment.
- Treating inbox zero, a finished process, or a model confidence score as maintained-state proof.
