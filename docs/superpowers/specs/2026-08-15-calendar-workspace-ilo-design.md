# Calendar workspace Ilo design

- Status: Approved target design
- Date: 2026-08-15
- Governing doctrine: [`Ilo workspace stewardship`](../../product/ilo-workspace-stewardship.md)
- Governing architecture: [`ADR 0004`](../../architecture/0004-workspace-ilo-stewardship.md)

## Goal

Make Calendar an expert, persistent steward of a person's schedule rather than a collection of
event tools or an MCP-host procedure.

The Calendar Ilo continually keeps the person's schedule trustworthy, feasible, intentional, and
recoverable; protects declared availability and preparation needs; isolates decisions requiring
human judgment; and explains schedule health without silently rearranging hard commitments.

This document defines the complete target. It does not claim that the complete steward is shipped.
The current implementation slice is identified separately.

## Motivation

The workspace-stewardship doctrine established that an MCP client can express intent but cannot be
the source of Ilo's expertise, sequencing, learning, authority, or completion judgment. Calendar
already has event management, guided profile semantics, safe commitment previews, guarded
mutations, connector health, and partial-effect recovery. It does not yet have the durable domain
layer that interprets those records as a maintained schedule.

Calendar maintenance is not event cleanup or schedule optimization. A trustworthy calendar must
preserve provider truth, civil-time and recurrence semantics, collaboration state, personal intent,
protected capacity, unresolved uncertainty, and recovery evidence. A process that merely inspected
or mutated events cannot establish that outcome.

## Chosen approach

Build a **schedule-health steward**. Calendar owns the judgment:

> Is this schedule trustworthy, feasible, intentional, adequately protected, and recoverable over
> the requested horizon?

The Calendar ledger retains event and collaboration fidelity while adding local intent,
evidence-bound findings, questions, rules, maintenance runs, advice, and reviews. The API owns the
maintenance turn. MCP remains a small stateless intent surface over the typed API.

### Rejected alternatives

- An **event-lifecycle steward** would center provider correctness, invitations, recurrence, and
  recovery. It is safe and close to the current implementation, but it does not fulfill the product
  promise around protected availability, realistic capacity, and continuing advice.
- A **planning optimizer** would arrange meetings, tasks, habits, travel, and focus time. It would
  prematurely make Calendar the owner of cross-domain priorities and encourage opaque optimization.
  Commitments and Goals continue to own what matters; Calendar assesses whether the resulting time
  plan fits.
- A **client-authored maintenance routine** would sequence granular MCP tools in a scheduled prompt.
  It would lose durable progress and learning, vary across hosts, and make retry safety dependent on
  a conversation. It is outside this design.

## 1. Purpose and promise

- **Workspace:** Calendar
- **User outcome:** The person can trust what is scheduled, see what is infeasible or unprotected,
  answer only irreducible questions, recover uncertain work, and understand how the schedule is
  changing.
- **Ilo promise:** Keep the schedule trustworthy, feasible, intentional, and recoverable while
  preserving the person's authority over commitments and collaboration.

### Explicit non-goals

The Calendar Ilo does not:

- silently move, resize, cancel, delete, or replace hard or non-flexible commitments;
- infer consent, attendance, recipients, or reusable preferences from imported content;
- decide which task, goal, or commitment matters more than another domain says it does;
- send correspondence, purchase or book travel, or present itself as a medical or occupational
  health professional;
- treat model confidence, event prose, MCP annotations, or profile preferences as authorization;
- depend on an external MCP-host schedule, client automation, prompt, or live conversation; or
- claim live travel feasibility without fresh routing evidence from an approved integration.

The target includes collaboration and schedule-health judgment. Delivery may split that target into
independent vertical slices without weakening these boundaries.

## 2. Living ledger

The Calendar ledger has six domain-owned layers.

### 2.1 Source ledger

For each local or connected source, retain:

- owning user, account, provider, calendar, provider calendar identity, and display meaning;
- selection, enabled state, default-destination role, ownership, write capability, and granted
  capability;
- sync cursor or token, generation, claim, latest attempt and success, next due time, safe error,
  recovery owner, and projection completeness;
- provider revision semantics and the evidence cutoff used by the latest assessment; and
- profile references whose validity depends on the source.

Provider configuration, capability, freshness, and health are separate facts. A present account or
credential does not establish current readable or writable authority.

### 2.2 Event and collaboration ledger

Retain local and provider events with:

- canonical local identity and provider account, calendar, remote event, and revision identity;
- series identity, recurrence rules, exceptions, occurrence identity, cancellations, and tombstones;
- organizer, attendees, RSVP state, sequence, status, transparency, visibility, and invitation
  ownership;
- title, notes, location, conferencing, attachments, start, end, all-day state, time zone, reminders,
  and provider fidelity material;
- relational busy blocks and source/block revisions rather than duplicate visible events; and
- synchronization, deletion, audit, and recovery references.

An event's provider fields remain a projection. Provider-owned material does not become locally
authoritative merely because it is cached.

### 2.3 Intent ledger

Retain user-authored scheduling meaning separately from event prose:

- calendar and source meanings;
- default writable destination and ambiguous-time time zone;
- hard or flexible commitment semantics;
- protected work, focus, meal, break, personal, sleep, and recovery windows;
- preparation, transition, and recovery buffer preferences;
- location confidence, normal travel mode, and user-authored travel estimates;
- busy-block privacy and destination policies;
- acceptable out-of-hours or cross-time-zone exceptions; and
- typed links to owning Commitments, Goals, Mail, or other material.

Imported titles, descriptions, locations, attendees, and attachments are untrusted evidence. They
cannot create intent, rules, links, or authority by themselves.

### 2.4 Operational ledger

Retain invitations, organizer changes, proposals, exact mutation attempts, provider effects,
reconciliation attempts, revisions, idempotency identities, audits, and recovery instructions.

A provider effect uses explicit states such as pending, claimed, indeterminate, reconciliation,
succeeded, or terminal failure. Indeterminate work cannot be replayed until provider state is
reconciled.

### 2.5 Judgment ledger

Retain evidence-bound findings including:

- direct and recurrence-generated overlaps;
- insufficient preparation, transition, recovery, or travel buffers;
- unresolved invitations, stale tentative holds, and organizer changes;
- impossible or unknown travel transitions;
- meeting density, focus fragmentation, and protected-time erosion;
- out-of-hours load and asymmetric cross-time-zone burden;
- missing meals, breaks, recovery space, or declared protected windows;
- stale source evidence, conflicting intent, and unresolved provider effects; and
- superseded or dismissed findings with their decision evidence.

Every finding records its source revisions, calculation inputs, scope, evidence cutoff, playbook
version, rulebook version, severity, confidence, status, and invalidation conditions. Confidence
describes the assessment; it does not authorize an action.

### 2.6 Stewardship ledger

Retain:

- bounded questions and one-off decisions;
- proposed, active, disabled, superseded, and rolled-back rules;
- playbook releases and rulebook snapshots;
- maintenance runs, steps, claims, effects, and terminal verification;
- recommendations and their evidence; and
- immutable period reviews and target-run amendments.

### 2.7 Authority, freshness, provenance, and reconciliation

- Providers are authoritative for provider-owned event fields. Local Calendar is authoritative for
  local events and Ilo-owned annotations, questions, rules, decisions, and reviews.
- Cross-domain material remains native to its owning domain and is linked by typed source reference.
  Calendar never flattens it into a generic event or work record.
- Provider reset replaces disposable projections and cursors only. It does not delete annotations,
  rules, decisions, review artifacts, typed links, or immutable audit evidence.
- Provider provenance includes account, remote calendar, remote event, occurrence or series
  identity, and revision. An iCalendar UID or matching title and time may support reconciliation but
  is not universal cross-provider deduplication authority.
- Recurrence is interpreted as a series plus exceptions. Health analysis expands occurrences only
  inside the requested bounded horizon.
- Missing or deleted provider material retires the current projection while preserving historical
  links and explaining which findings or decisions became stale.
- Derived material is current only while every input revision, playbook version, rulebook version,
  and evidence-cutoff condition still matches.

## 3. Expert playbook

The Calendar playbook is versioned server-owned product policy. A coding-agent skill may explain
how to implement it, but model memory, a client prompt, or an MCP host is never its runtime source of
truth.

### 3.1 Professional disciplines

| Discipline | Responsibilities reproduced | Hard limit |
| --- | --- | --- |
| Executive assistant | Agenda hygiene, preparation needs, follow-ups, protected time, missing details, and concise decision escalation | Cannot speak for the person, infer consent, or treat convenience as permission |
| Scheduling and collaboration coordinator | Availability, invitation state, recurrence, time-zone effects, organizer/attendee responsibilities, and fair candidate windows | Cannot invite, RSVP, cancel, or materially reschedule without the applicable authority |
| Capacity planner | Workload, fragmentation, focus continuity, recovery space, meeting density, and declared work/life boundaries | Does not optimize against an employer ideal or diagnose health, fatigue, or productivity |
| Travel coordinator | Location continuity, explicit travel buffers, sequencing, and feasibility risks | Does not book travel or invent route duration; live routing requires a separately approved integration |
| Calendar operations auditor | Source freshness, provider fidelity, recurrence correctness, duplicate evidence, privacy, ambiguous effects, and recovery | Cannot declare correctness while required evidence is stale or an external effect is unresolved |

### 3.2 Research registry

Each playbook source records URL, publisher, retrieved and reviewed dates, applicability,
jurisdiction or provider, supported claims, calculations influenced, limitations, and superseded
version.

| Area | Authoritative or primary source | Use in the playbook |
| --- | --- | --- |
| Event, recurrence, free/busy, and civil-time exchange | [IETF RFC 5545](https://datatracker.ietf.org/doc/rfc5545/) | Calendar object and recurrence semantics |
| CalDAV access and reconciliation | [IETF RFC 4791](https://datatracker.ietf.org/doc/rfc4791/) | Calendar collections, ETags, time-range queries, free/busy, and provider reconciliation |
| Organizer and attendee scheduling | [IETF RFC 6638](https://www.rfc-editor.org/info/rfc6638/) | Scheduling-object roles, sequence, replies, cancellation, and change boundaries |
| Civil-time rules | [IANA Time Zone Database](https://www.iana.org/time-zones) | Versioned local-time, offset, and daylight-saving calculations |
| Google event effects and provider behavior | [Google Calendar event reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/update) and [event creation guidance](https://developers.google.com/workspace/calendar/api/guides/create-events) | Visibility, transparency, attendees, notifications, recurrence, IDs, and deduplication behavior |
| Administrative scheduling practice | [U.S. Bureau of Labor Statistics occupational profile](https://www.bls.gov/ooh/office-and-administrative-support/secretaries-and-administrative-assistants.htm) | Role framing for scheduling, record organization, and administrative support |
| Individual scheduling preferences | [Rhythm of Work](https://www.microsoft.com/en-us/research/publication/rhythm-of-work-mixed-methods-characterization-of-information-workers-scheduling-preferences-and-practices/) | Treat cyclical and relational preferences as individual, not universal |
| Cross-time-zone burden | [Large-Scale Characteristics of Synchronous Collaboration Across Time Zones](https://www.microsoft.com/en-us/research/wp-content/uploads/2023/02/Large-Scale-Characteristics-of-Synchronous-Collaboration-Across-Time-Zones-CHI-2023.pdf) | Explain out-of-hours asymmetry and tradeoffs without prohibiting collaboration |
| Protected focus time | [Focus Time](https://www.microsoft.com/en-us/research/?p=957483) | Support evidence-bound focus protection recommendations |
| Break and recovery signals | [NIOSH sleep and work guidance](https://www.cdc.gov/niosh/bulletin/2012/sleep-and-work.html) | Conservative, non-medical break and recovery prompts |
| Long-hours risk | [WHO/ILO joint estimates](https://www.who.int/news/item/17-05-2021-long-working-hours-increasing-deaths-from-heart-disease-and-stroke) | Explain sustained long-hours signals without diagnosis |
| Future live routing | [Google Routes API route-matrix guidance](https://developers.google.com/maps/documentation/routes/compute_route_matrix) | Potential timestamped distance and duration evidence; not current authority |

Protocol and provider material is reviewed on each relevant connector change and at least quarterly.
Time-zone policy advances with each deployed tzdata release. Behavioral and occupational research is
reviewed at least annually. Time-sensitive material must be refreshed before a playbook release can
influence a new recommendation.

### 3.3 Advice boundaries

Research supplies explainable signals, not universal norms. The playbook must:

- prefer approved personal preferences over population-level findings;
- distinguish an observed calendar interval from actual work, sleep, travel, or wellbeing;
- present sustained long hours, missing recovery, or fragmentation as advisory schedule signals,
  not health diagnoses;
- disclose sample, workplace, geography, and inference limitations where relevant; and
- avoid live travel claims unless a separately owned routing integration provides current evidence.

## 4. Definition of maintained and status model

Calendar status is multidimensional.

```ts
type CalendarReadiness = "setup_required" | "ready" | "degraded";

type CalendarMaintenanceLifecycle =
  | "never_maintained"
  | "stale"
  | "queued"
  | "active"
  | "maintained"
  | "maintained_with_questions"
  | "blocked"
  | "failed";

type CalendarHealthSignal = "healthy" | "attention" | "strained" | "unknown";
```

`CalendarStatus` returns:

- readiness and setup blockers;
- source capability, freshness, completeness, cutoff, and recovery owner;
- maintenance lifecycle and compatible active run;
- actionable, awaiting-approval, awaiting-input, blocked, failed, and ambiguous-effect backlog;
- schedule-health dimensions and trend;
- authority available automatically, through approved rules, through individual approval, or not at
  all;
- latest run and review; and
- valid next operations and first-party recovery links.

Counts are authoritative or explicitly bounded. Partial evidence never becomes an authoritative
zero.

### 4.1 Observable terminal evidence

`maintained` requires all of the following for the normalized scope:

- every required source is fresh and sufficiently complete at the evidence cutoff;
- event, recurrence, block, invitation, deletion, and provider-effect reconciliation completed;
- no ambiguous external effect remains;
- every required health model was calculated from current inputs;
- every action authorized by an active rule was completed or was deterministically ineligible;
- no blocking question remains; and
- the full review artifact committed and a final verification read still matches its inputs.

`maintained_with_questions` meets the same conditions but retains explicit non-blocking questions,
proposals, or advisory findings. Each item is visible; none is hidden inside a success count.

`blocked` means safe progress requires missing authority, unavailable required source evidence,
provider recovery, an unsupported external capability, or a person's decision. Completed work and a
partial review remain durable.

`failed` means an internal invariant, persistence failure, or exhausted retry prevented trustworthy
settlement. A failure review is published when the durable review path remains available; otherwise
the run record exposes `reviewUnavailable`, the failure evidence, and the recovery owner. A bounded
human question is not a failure.

`queued` and `active` are observable nonterminal states. `stale` means the latest settled assessment
no longer covers the required evidence horizon or one of its inputs has changed.

## 5. Surgical operations

The domain/API owns these exact operation classes.

| Class | Operations |
| --- | --- |
| Inspect | Sources, calendars, event or occurrence, availability, invitation state, findings, questions, rules, maintenance runs, provider effects, and reviews |
| Preview | Create, update, move, resize, trash, restore, RSVP, busy mirror, focus, meal, break, buffer, travel block, conflict repair, availability proposal, rule impact, and maintenance scope |
| Annotate | Hard/flexible meaning, preparation need, travel mode, protected intent, exception, source meaning, and not-a-concern decision |
| Correct | Guarded event edit, recurrence-instance edit, block repair, projection reconciliation, duplicate-link correction, and stale-finding retirement |
| Approve | One exact proposal, one question resolution, or one separately reviewed reusable rule |
| Recover | Synchronize before replay, reconcile an ambiguous effect, resume or cancel a run, retry a safe step, restore material, disable a rule, and roll back an Ilo-owned annotation or block |
| Verify | Re-read exact provider and local state and settle only from durable evidence |

Every mutation carries owner, actor, policy, expected revisions, source references, idempotency
identity where applicable, playbook and rulebook versions, redacted before and after audit evidence,
resulting provider effects, and recovery instructions.

Previews snapshot the exact candidate set and revisions. Approval fails closed when the snapshot,
source, destination, rule, capability, or authority changes.

## 6. Rulebook and authority boundaries

The Calendar rulebook is assembled from the approved Calendar profile, active source meanings,
protected-time preferences, explicit event annotations and exceptions, active Calendar rules,
cross-domain typed references, and current source capability. A draft profile is context only.

### 6.1 Action policy

| Action | Default policy |
| --- | --- |
| Read, synchronize, reconcile projections, and calculate findings | `read_only` domain work |
| Prepare recommendations or exact candidate changes | `preview` |
| Save or dismiss a one-off local interpretation | `approve_each`, unless an active local-annotation rule applies |
| Create, move, resize, trash, restore, or change event visibility | `approve_each` |
| Apply a narrowly defined busy-mirror, buffer, or flexible planning-block rule | `approved_rule`, with exact source, destination, time, and revision scope |
| RSVP, invite attendees, send updates, cancel an attended event, or alter organizer-controlled material | Always `approve_each` |
| Move or delete a hard or non-flexible commitment | Always `approve_each`; maintenance may only propose |
| Book travel, purchase anything, or send correspondence | Unavailable |
| Infer authority from imported content, MCP annotations, model confidence, or a profile preference | Forbidden |

`maintain_calendar` requires Calendar read and write scope because it may execute previously approved
rules. The intent itself is not approval and never widens token scopes, source capability, or an
underlying operation's policy. A maintenance call on a token without the required scope is rejected;
it is not downgraded into a different contract silently.

Stale or incomplete provider evidence cannot authorize a write. An ambiguous provider effect must
reconcile before replay. Reusable rules have bounded sources, destinations, actions, conditions,
time horizons, exceptions, versions, and kill switches.

Calendar can assess whether scheduled material fits. Commitments and Goals continue deciding what
work matters. Mail owns source capture and verification. Cross-domain candidates retain their owning
source and arrive through typed API contracts; Calendar does not scan another workspace.

## 7. Autonomous maintenance turn

Autonomous means that once the API durably accepts a turn, domain-owned execution can continue,
resume, and settle without the initiating client. This design does not add an external client
schedule or define automatic initiation.

### 7.1 Scopes

```ts
type CalendarMaintenanceScope =
  | { type: "all_outstanding" }
  | { type: "window"; start: string; end: string }
  | {
      type: "target";
      entityType:
        | "event"
        | "series"
        | "invitation"
        | "finding"
        | "question"
        | "proposal"
        | "provider_effect"
        | "maintenance_run";
      id: string;
    };
```

`all_outstanding` includes every unresolved question, ambiguous effect, failed repair, and active
finding regardless of age. It expands and assesses events from 30 days before through 90 days after
the cutoff. `window` uses the inclusive requested interval while still reporting older backlog.
`target` re-evaluates exactly one source-linked entity and its required dependencies.

The 30/90-day default is server-owned versioned policy. A later product decision may expose an
approved profile override, but a client cannot widen an individual run beyond the API's documented
limits.

### 7.2 Domain-owned sequence

1. Persist normalized scope, evidence cutoff, actor, playbook version, rulebook version, and
   idempotency identity.
2. Acquire the Calendar maintenance lease and inspect source readiness.
3. Synchronize required sources or record why current evidence cannot be obtained.
4. Materialize bounded series occurrences and reconcile deletions, exceptions, blocks, invitation
   changes, duplicate evidence, and unsettled provider effects.
5. Recalculate conflicts, buffers, travel feasibility, protected time, workload, focus
   fragmentation, meeting density, out-of-hours load, and time-zone burden.
6. Apply only exact actions authorized by active rules after rechecking source and rule revisions.
7. Create or refresh bounded questions and exact proposals for remaining uncertainty.
8. Produce evidence-linked advice and publish the review or partial review.
9. Re-read authoritative state, settle the terminal status, and release the lease.

The API acknowledges a new turn only after the durable run and first queued step commit.

### 7.3 Durable run and recovery

A run stores requested and normalized scope, source snapshot, evidence cutoff, playbook and rulebook
versions, steps, checkpoint, lease, fencing token, attempts, idempotency keys, actions, effects,
questions, proposals, cancellation state, audit references, review identity, and verification
result.

- Each step commits independently and resumes at the first unverified step.
- One Calendar maintenance run per user can be active. An equal or narrower compatible request
  coalesces with it. A broader or incompatible request queues a successor without changing the
  active run's snapshot.
- Exact interactive operations may continue. Optimistic revisions fence stale maintenance work,
  which re-reads and recalculates rather than overwriting the change.
- Retryable reads and calculations use bounded attempts and retain failure history.
- An uncertain provider effect enters reconciliation and is never replayed until exact provider
  state is inspected.
- Cancellation stops before the next effect boundary. Already committed effects remain recorded
  and appear in the review.
- A playbook or rulebook version change stops new mutations. Remaining work is revalidated in a
  successor run.
- Process loss, caller loss, and repeated web or MCP calls cannot duplicate accepted work.

## 8. Questions, decisions, and learning

A Calendar question records:

- exact source references and revisions;
- why the answer matters;
- bounded choices and their immediate effects;
- whether it resolves this case only or supports a separate rule proposal;
- staleness and invalidation conditions; and
- a stable deduplication identity.

Supported questions include hard/flexible meaning, whether a tentative hold still reserves time,
whether a location is reliable enough for travel analysis, whether a source should mirror as private
busy time, which preparation or recovery buffer applies, and whether an out-of-hours meeting is an
intentional one-off exception.

An answer resolves only the present case. It becomes reusable only through a separate explicit
approval that shows the complete rule source scope, destination, condition, action, exceptions,
examples, and rollback behavior. Reusable rule activation is a signed-in first-party approval. MCP
may prepare or display the proposal but cannot turn an answer into active policy.

Rules retain provenance, version, effective date, applicability, exceptions, disablement,
supersession, and rollback history. A changed rule re-evaluates open findings and future occurrences
inside the current horizon. It does not silently rewrite history or provider events.

Observed behavior may produce a recommendation such as a recurring protected-time pattern. It never
becomes preference or authority without approval. Resolved questions are not asked again while their
answer remains applicable and its source revisions remain current.

## 9. Analysis and advice

Calendar health is a set of explainable dimensions, not one opaque score:

- source trust and reconciliation;
- hard-conflict and unresolved-invitation state;
- buffer and travel feasibility;
- protected-time continuity;
- meeting density and focus fragmentation;
- out-of-hours and cross-time-zone burden;
- declared meals, breaks, and recovery space; and
- schedule volatility and trend.

Each dimension is `healthy`, `attention`, `strained`, or `unknown` and lists the facts that produced
that state. Unknown is preferable to a misleading healthy result when evidence is stale, locations
are ambiguous, or the calendar cannot show actual work and recovery.

Every recommendation identifies evidence, assumptions, horizon, confidence, active personal goals
or preferences, unresolved risks, tradeoffs, and an exact preview when a change is possible. Advice
may suggest protecting focus time, redistributing cross-time-zone burden, adding buffers, clarifying
a hold, or declining infeasible work. It does not imply permission to perform those actions.

Travel feasibility is `unknown` unless it can use an approved explicit buffer, a user-authored
estimate, or fresh routing evidence. A future routing result must record provider, mode, requested
departure or arrival, observed time, duration, fallback behavior, and expiry.

## 10. Durable review artifact

Every maintained or maintained-with-questions run publishes an immutable `CalendarReview`. A
blocked run publishes a partial review. A failed run publishes a failure review when the review
store remains viable; otherwise the durable run record explicitly reports that the review is
unavailable.

An all-outstanding or windowed review contains:

1. Scope, evidence cutoff, playbook and rulebook versions, and source freshness.
2. Material inspected, reconciled, changed, or recovered.
3. Schedule-health dimensions and trend, including unknowns.
4. Conflicts, invitation decisions, buffer or travel risks, and protected-capacity findings.
5. Outstanding questions, proposals, blocked work, failures, and ambiguous effects.
6. Recommendations with evidence, assumptions, horizon, confidence, preferences, and tradeoffs.
7. Rules applied, proposed, changed, disabled, or superseded.
8. Next maintenance point and exact recovery links.

A target run publishes a compact amendment linked to the latest period review. Reviews are never
edited to conceal earlier uncertainty. A correction supersedes the prior artifact with an explicit
reason and retains both records.

Review access is owner-scoped and redacted by surface. Provider credentials, raw provider payloads,
private model reasoning, and unnecessary attendee or event content never enter audit logs or a
cross-surface review envelope.

## 11. Surfaces and ownership

### 11.1 Domain-owned surfaces

- `packages/domain` owns Calendar ledger, finding, question, rule, advice, status, scope, step, and
  review schemas and invariants.
- Feature-owned database modules own Calendar persistence and repositories.
- `apps/api` Calendar services own playbook evaluation, rule evaluation, maintenance sequencing,
  completion judgment, authorization, audit, synchronization use, and recovery.
- The Calendar route exposes status, maintenance, surgical operations, questions, approvals,
  recovery, and reviews.
- `packages/api-client/src/features/calendar.ts` exposes the same typed contract.
- `apps/web/src/features/calendar` presents source health, findings, questions, previews, approvals,
  run state, recovery, advice, and review artifacts.
- `apps/mcp/src/tools/calendar.ts` contains thin typed-API adapters only.

### 11.2 Stateless MCP intent surface

The mature MCP surface normally advertises:

- `get_calendar_status`, requiring Calendar read scope;
- `maintain_calendar`, requiring Calendar read and write scope;
- useful existing reads and exact event operations; and
- selected preview, question-resolution, approval, verification, and recovery tools when token
  scope and current state permit them.

`get_calendar_status` accepts an optional Calendar scope and returns readiness, source freshness,
backlog, authority, health dimensions, active run, latest review, and valid next operations.

`maintain_calendar` starts, resumes, coalesces with, or reports the compatible domain-owned turn. It
returns a stable run reference and may return terminal state when work finishes within the request.
It never depends on MCP Tasks, polling correctness, retained conversation state, or a client-authored
sequence.

MCP validates request and response shape, calls the authenticated typed API, and preserves
structured state and first-party links. It contains no playbook, workflow sequence, rule evaluation,
learning, retry loop, or completion decision. Tool annotations remain compatible-host hints rather
than authorization.

No external client automation, scheduled prompt, or MCP-host routine is designed here.

## 12. Integration-owned changes

The Calendar feature must list these as separate Integration handoffs rather than editing shared
composition roots opportunistically:

1. Generic maintenance run and step persistence, leases, fencing, retry history, cancellation,
   terminal settlement, and shared result envelopes.
2. Shared database schema and migration-journal registration.
3. API, API-client, and MCP composition-root registration.
4. Global Reviews composition and any Today or shared attention projection.
5. Shared authorization or signed-in approval infrastructure needed by reusable-rule activation.
6. Typed cross-domain candidate registration from Mail, Commitments, and Goals. Each source domain
   retains evidence and priority judgment.
7. Any future routing provider: credentials, consent, billing, quota, transport, timeouts, cache and
   freshness policy, infrastructure, recovery, legal display requirements, and production evidence.

Integration may own the mechanics in items 1 through 3. It must not own Calendar conflict meaning,
health calculations, question semantics, rules, advice, or the maintained-state decision.

## 13. External boundaries

Existing Calendar provider synchronization and mutation continue to follow
[`external-boundary-reliability.md`](../../engineering/external-boundary-reliability.md) and
[`connector-reliability.md`](../../engineering/connector-reliability.md).

A maintenance turn uses the existing durable connector scheduler and current provider-effect
reconciliation rules. Durable provider-effect execution remains target work. The turn does not make
unbounded provider calls inside the originating HTTP request. Source synchronization may continue
after the run commits; the run waits durably for the required evidence or settles blocked.

Live routing is not part of the current boundary. Adding it requires a separate boundary record
covering capability and owner, credential and consent, HTTPS transport, request and run budgets,
rate and billing limits, durable cache commit, per-element failure, expiry, fallback, recovery,
observation, terms, and production-equivalent evidence.

Green tests could still coexist with stale provider grants, incomplete recurring-event semantics,
unavailable CalDAV scheduling support, provider-side invitation behavior, delayed tzdata deployment,
or routing data that does not reflect real travel. Status and reviews must preserve those evidence
gaps.

## 14. Target capability versus current implementation

### Current shipped slice

The implementation log and current code already provide:

- local and provider calendars with normalized event projections;
- event CRUD, relational busy blocks, source revisions, guarded agent mutations, recoverable
  deletion, provider capability and freshness state, and synchronization recovery;
- guided Calendar profile semantics for source meanings, destination, flexibility, time zone,
  privacy, buffers, and eligible evidence kinds;
- preview-only commitment candidates;
- event-linked attention; and
- structured partial-provider-effect reporting with synchronize-before-retry guidance.

These are useful surgical and evidence foundations. They do not constitute a maintained Calendar
workspace.

### Target capability not yet claimed as shipped

- Versioned runtime expert playbook and source registry.
- Durable semantic annotations, findings, questions, Calendar rules, and learning.
- Calendar maintenance runs and domain coordinator.
- `get_calendar_status` and `maintain_calendar`.
- Schedule-health dimensions, recommendations, and trend.
- Durable Calendar review artifacts.
- Rule-authorized buffer, mirror, or flexible planning actions.
- Complete invitation, collaboration, and travel-feasibility stewardship.

The implementation log changes only when a meaningful vertical slice ships with code, migrations,
tests, and deployment evidence.

## 15. Security, privacy, audit, and recovery

- All reads and writes remain owner-scoped and authorized in the API.
- Maintenance authority is the intersection of token scopes, user policy, active rule, source
  capability, fresh evidence, exact revisions, and operation-specific hard limits.
- Provider credentials, tokens, raw payloads, private model reasoning, and unnecessary event or
  attendee content never enter MCP responses, reviews, logs, or audit snapshots.
- Every mutation records actor, policy, run, source evidence, playbook and rulebook versions,
  idempotency identity, and redacted before and after state.
- Rule disablement stops future claims but does not erase completed effects. Rollback is an explicit
  compensating operation where the target still exists and authority permits it.
- Hard event changes, collaboration effects, ambiguous provider effects, and unsupported travel
  evidence fail closed.
- A manual first-party path remains available to inspect, answer, approve, repair, cancel, restore,
  or defer work when autonomous execution is blocked.

## 16. Acceptance evidence

### Domain and persistence

- Recurrence, occurrence exceptions, all-day boundaries, daylight-saving transitions, overlap,
  buffer, travel, source authority, invalidation, status, and recommendation rules.
- Migrated persistence for findings, questions, rules, runs, steps, effects, advice, and reviews.
- Concurrent claims, fencing, coalescing, queued successors, cancellation, retry, stale-run recovery,
  and process loss.
- Rule-version and source-revision changes immediately before mutation.
- Question deduplication, one-off answers, explicit reusable learning, disablement, and rollback.

### API and security

- Authorization, cross-user isolation, policy enforcement, revision conflicts, idempotency, audit,
  and redaction.
- Source freshness and partial evidence never produce false zero backlog or a maintained result.
- Provider ambiguity enters reconciliation and cannot replay blindly.
- Typed status, maintenance, surgical, question, approval, recovery, and review behavior.

### MCP and UI

- MCP discovery follows scope and read-only server mode.
- MCP results preserve durable run, terminal state, structured errors, and first-party links without
  owning orchestration.
- Calendar UI exposes source health, bounded questions, exact approvals, active and terminal runs,
  recovery, health evidence, and review artifacts on desktop and mobile.
- An external client can disconnect immediately after `maintain_calendar` acceptance without
  affecting completion or recovery.

### Product and production evidence

- At least one production-equivalent all-outstanding turn over fresh local and provider projections.
- A bounded window turn and exact-target repair.
- A provider authorization failure, stale projection, recurrence change, concurrent event edit,
  process loss, and ambiguous provider effect.
- Honest maintained, maintained-with-questions, blocked, and failed outcomes with their required
  review or failure artifact.
- Documented production risks for provider semantics, source completeness, civil-time data, and any
  future routing boundary that remain possible despite green tests.

## 17. Initial delivery decomposition

This target should be implemented through independently testable vertical slices:

1. Read-only Calendar status, versioned playbook, evidence-bound findings, and a review over fresh
   existing projections.
2. Durable maintenance runs, steps, leases, recovery, `maintain_calendar`, and stateless MCP wiring.
3. Questions, one-off decisions, reusable Calendar rules, and first-party approval flows.
4. Approved-rule local annotations, mirrors, buffers, and flexible planning blocks using existing
   guarded surgical operations.
5. Collaboration stewardship for invitations, RSVP, organizer changes, and availability proposals.
6. Travel-feasibility stewardship only after a separately approved routing integration exists.

Each slice must name its Calendar-owned paths and list schema, migration journal, composition roots,
Reviews, Today, shared approvals, and cross-domain registrations as Integration handoffs.
