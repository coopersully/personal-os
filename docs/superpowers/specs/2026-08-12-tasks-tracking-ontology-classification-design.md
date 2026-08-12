# Tasks and Tracking Ontology and Classification Design

**Status:** Proposed

**Date:** 2026-08-12

**Parent design:** [Tasks and Tracking Ledger Design](./2026-08-12-tasks-and-tracking-ledger-design.md)

**Golden corpus:**
[tasks-tracking-classification.v1.json](./fixtures/tasks-tracking-classification.v1.json)

## Purpose

This document defines what ilo's core Tasks and Tracking entities mean, how they relate, and how a
capture utterance is deterministically converted into a proposed operation plan. The goal is not to
make every utterance produce a mutation. The goal is to make the same utterance and context produce
the same result, including an explicit request for clarification when the material is genuinely
ambiguous.

The ontology is normative. An LLM may extract candidate facts and phrase a clarification, but its
confidence score, world knowledge, or intuition cannot change the entity definitions or bypass the
validation rules.

## Hard-ball review of the earlier model

The initial proposal had the right broad boundaries but still contained six dangerous shortcuts:

1. **It mixed axes.** The current `Task.status` values `inbox`, `next`, `scheduled`, `completed`, and
   `cancelled` mix organizational placement, planning state, timing, and lifecycle. Those must be
   independent.
2. **It invited project guessing.** “This sounds like multiple steps” depends on world knowledge and
   will classify the same phrase differently across models. Capture uses the smallest valid object
   unless the person explicitly requests a project or supplies an explicit project with child work.
3. **It blurred projects and goals.** Both can describe outcomes. A Project is an execution
   container; a Goal is an evaluative target. The same real-world ambition may link both, but ilo
   never creates both silently.
4. **It allowed type coercion.** Recording “meditated ten minutes” into an outcome check-off as
   `completed` plus a note loses the primary fact. An incompatible value is a deterministic
   clarification, not a clever conversion.
5. **It treated one utterance as one object.** “Remind me to call Sam” requires a Task and Prompt.
   Classification returns an ordered operation plan, not a single polymorphic item.
6. **It omitted cascade semantics.** Moving a Project, moving a Task out of its Project's List, or
   completing a Project with open Tasks must have explicit atomic behavior. Otherwise the database
   cannot enforce the hierarchy honestly.

## Design principles

1. **One noun, one meaning.** Entity names do not double as views, statuses, or delivery concepts.
2. **Orthogonal axes.** Identity, organization, lifecycle, timing, recurrence, prompting, and
   presentation are stored independently.
3. **Minimum sufficient object.** When ordinary language identifies a finite action but does not
   explicitly establish a Project, capture a Task. Promotion remains reversible.
4. **Explicit ambiguity.** `needs_choice` is a successful deterministic classification outcome.
5. **No silent semantic conversion.** ilo does not coerce value types, invent destinations, turn
   prompts into deadlines, or manufacture missed behavior from absence.
6. **Context is an input.** Entity resolution uses a versioned snapshot of the person's Lists,
   Projects, Trackers, preferences, clock, and time zone. The same input snapshot yields the same
   plan.
7. **Preview is not authority.** Classification proposes domain operations. Authorization,
   revisions, invariants, idempotency, and audit remain API-owned.

## Normative entity definitions

### List

A **List** is a persistent organizational container for a continuing context such as Personal,
Work, Home, or Shopping.

- It has a name, optional description and presentation, `active` or `archived` availability, source
  and revision metadata, and soft-deletion state.
- It is not completable and has no due date, schedule, recurrence, or progress.
- It cannot contain another List.
- Each person has exactly one non-deletable system Inbox List. “Inbox” is organization, not Task
  lifecycle.
- Names reserved for system Views, including Today, Upcoming, Scheduled, Completed, and Trash,
  cannot be used by active Lists because capture and navigation must resolve them unambiguously.
- Non-deleted List names are unique per person after Unicode normalization, trimming, and case
  folding. Archiving does not free a name silently.

### Project

A **Project** is a finite execution outcome used to organize multiple Tasks. A person may explicitly
choose to manage something as a Project before its Tasks are known.

- It belongs to exactly one List.
- It has lifecycle `open`, `completed`, or `cancelled`; archival and soft deletion remain separate.
- It can have an optional target date, notes, `why`, source, and revision.
- It cannot contain Projects in v1.
- It is not itself scheduled or recurring. Its Tasks carry executable timing.
- Completing a Project with open Tasks returns a conflict with exact resolution choices: complete,
  cancel, or move the open Tasks; keep the Project open; or abandon the mutation.
- Moving a Project to another List is a material bulk operation that atomically moves all of its
  Tasks after preview.
- Non-deleted Project names are unique within a List after normalization. The same name may exist in
  different Lists, but an unqualified reference then requires resolution. Archiving does not free a
  name silently.

### Task

A **Task** is one independently completable action.

- It belongs to exactly one List and optionally one Project in that same List.
- Its lifecycle is only `open`, `completed`, or `cancelled`; `deletedAt` is separate.
- It may have notes, `why`, priority, estimate, tags, timing, recurrence, Prompt Rules, source, and
  revision.
- It cannot contain Tasks or arbitrary checklist children in v1.
- Task titles are not unique. A title reference matching multiple Tasks requires a qualified choice;
  recency or model confidence cannot select one silently.
- Moving a Task to another List detaches it from its Project unless the mutation also selects a
  Project in the destination List. The preview must disclose the detachment.
- A Task may be promoted to a Project through an explicit operation that creates the Project and
  asks whether the original Task becomes a child Task, becomes the Project title, or is completed as
  planning work. ilo never guesses this transformation.

### Task occurrence

A **Task Occurrence** is one completable instance generated from a recurring Task definition.

- It retains the definition version and local-time rule that generated it.
- Completing one occurrence does not complete the series.
- Editing the recurrence rule is prospective unless exact occurrences are explicitly selected.
- An open occurrence does not own organization; it resolves current List and Project membership
  through its Task. A terminal occurrence stores an immutable organization snapshot for historical
  reporting, so later Task moves do not rewrite what was true when the occurrence was completed.

### Tracker

A **Tracker** defines something the person wants to record repeatedly or whenever it happens.

- `check_in` mode creates expected response opportunities; `event_log` mode accepts entries whenever
  the event occurs.
- A custom Tracker has exactly one versioned primary-value definition plus optional notes and
  attachments on Entries.
- Non-deleted Tracker names are unique per person. Aliases are explicit, versioned configuration;
  overlapping aliases return a choice rather than relying on world knowledge.
- A Tracker may be configured as a Habit when repeated performance matters.
- It is not a container for Tasks and does not become incomplete when no Entry exists.

### Habit

A **Habit** is a Tracker configuration, not a separate entity table. It adds an optional stable cue
and a target such as selected days, a count per period, or a value range. It never implies a default
streak or that missing data equals failure.

### Check-in occurrence

A **Check-in Occurrence** is one expected opportunity to answer a `check_in` Tracker. Its lifecycle
is `scheduled`, `open`, `answered`, `skipped`, `not_applicable`, `expired`, or `cancelled`. It is not
an Entry. `not_applicable` records an explicit disposition without fabricating a value; expiry
records no response and does not create a negative value.

### Entry

An **Entry** is a timestamped observation recorded against one Tracker and definition version.

- Its primary value must validate without coercion.
- Observation time and recording time are distinct.
- Corrections supersede rather than overwrite.
- A Habit check-off uses an outcome primary value (`completed`, `partial`, or `not_completed`).
  Skipping or marking an opportunity not applicable changes the Check-in Occurrence without an
  Entry; silence merely allows the occurrence to expire.

### Goal

A **Goal** is an evaluative target: a desired condition measured or assessed over a horizon.

- It may link to Projects, Tasks, and Trackers but contains none of them organizationally.
- Its lifecycle is `active`, `paused`, `completed`, or `retired`.
- Progress is computed from declared source material when possible and marked manual otherwise.
- A finite execution outcome may be a Project, a Goal, or both by explicit choice. ilo creates only
  the requested entity and may separately propose the other relationship.

### Prompt Rule, Prompt, and Delivery Attempt

A **Prompt Rule** defines reusable delivery timing and preferences. A **Prompt** is one concrete
request to bring a Task or Check-in Occurrence to attention. A **Delivery Attempt** records what a
channel did with that Prompt. None is a commitment or observation.

### View

A **View** is a saved or system query. Inbox is not a View; it is the system List. Today, Upcoming,
Scheduled, Due Check-ins, Completed, and similar surfaces are Views and never own records.

## Relational model and invariants

```text
List 1 ── * Project
  │           │
  └── * Task *┘  (Task.projectId optional; Task.listId always present)
          │
          └── * TaskOccurrence

Tracker 1 ── * TrackerDefinitionVersion
   │
   ├── * CheckInOccurrence ── 0..1 canonical Entry
   └── * Entry ── * correction versions

Goal * ── * Project / Task / Tracker  (typed links, never containment)

PromptRule 1 ── * Prompt 1 ── * DeliveryAttempt
Prompt target = Task | TaskOccurrence | CheckInOccurrence
```

Storage must enforce, not merely document:

- ownership on every foreign key path;
- `Task.listId` non-null;
- a composite relationship ensuring a selected Project has the same `listId` as its Task;
- normalized non-deleted List-name uniqueness per person;
- normalized non-deleted Project-name uniqueness per List;
- one system Inbox per person and prohibition on its deletion/archive;
- lifecycle values independent of `archivedAt` and `deletedAt`;
- source references, integer revisions, idempotency keys for duplicate-prone writes, and append-only
  audit records;
- definition-version references on Entries and generated occurrences;
- canonical Entry uniqueness per answered Check-in Occurrence;
- polymorphic links implemented with validated typed link tables or separate foreign-key columns,
  not an unconstrained entity-type/string-ID pair.

The duplicated `Task.listId` on Project Tasks is intentional for direct filtering and deterministic
moves. A composite foreign key or equivalent locked service invariant prevents drift. A migration
must use expand–migrate–contract; existing Tasks first receive the system Inbox List, and the old
mixed status maps to independent lifecycle/timing fields. The old `next` value remains bounded
compatibility metadata until first-party clients and a user review path have migrated; it does not
become a new permanent lifecycle or organization axis.

## Deterministic classification contract

Classification consumes:

- exact utterance and locale;
- `now` and IANA time zone;
- versioned snapshots of accessible Lists, Projects, Trackers, open occurrences, and defaults;
- the requested interaction mode and authorization visibility.

It returns:

```text
classificationVersion
contextVersion
speechAct: mutate | query | report | remember
decision: commit_ready | preview_required | needs_choice | query | out_of_domain
operations[]
clarification: null | { reasonCode, question, choices[] }
assumptions[]
evidence[]
```

`operations` is an ordered plan of focused domain mutations. It is not a generic database write.
Examples include `create_task` followed by `create_prompt`, or `answer_checkin` followed by the Entry
it owns. A preview is committed through the relevant API operations with a shared idempotency and
audit correlation, not through a generic MCP “manage life” tool.

All local operations required to fulfill one semantic capture commit atomically through the owning
domain aggregate command. Task plus Prompt, Project plus initial Tasks, and Check-in answer plus
Entry cannot partially commit. External delivery happens later through its durable handoff and does
not roll back the local Prompt. If clauses are intentionally independent, the preview exposes
separate atomic groups and returns a per-group result; it never implies all-or-nothing behavior that
the API cannot provide.

### Decision guarantees

- `commit_ready` requires one semantic interpretation, exact entity resolution, type-valid values,
  no material cascade, no unreviewed assumption, and authority for every operation.
- `preview_required` has one interpretation but includes a write that is destructive, bulk,
  estimated, schedule-expanding, cross-container, or otherwise review-worthy.
- `needs_choice` includes 2–3 concrete choices and performs no mutation.
- `query` performs reads only.
- `out_of_domain` preserves the text but refuses to force it into Tasks or Tracking.

Model confidence is diagnostic only. It never changes these guarantees.

## Classification algorithm

### 1. Determine the speech act

- Questions and “show/list/how many” are reads.
- Past-tense reports or direct answers to an open check-in are candidate Entries.
- “Remember that…” facts without an action or Tracker are outside this ontology.
- Imperative, prospective, or explicit create/change language is a candidate mutation.
- One utterance may contain multiple clauses; clauses are classified separately and combined only
  when their references and atomic intent are unambiguous.

### 2. Honor explicit entity language when admissible

“Create a List/Project/Goal,” “make this a Project,” “track/log,” and “remind me” are high-priority
signals. Explicit language does not override invariants: “create a recurring List” is still invalid.

### 3. Classify the underlying material

In precedence order:

1. Explicit List, Project, or Goal request → that entity.
2. Explicit tracking/logging request → Tracker, or Entry when a unique existing Tracker is named and
   a value is supplied.
3. Past observation/direct check-in answer → Entry if exactly one compatible Tracker or occurrence
   resolves; otherwise `needs_choice`.
4. Finite action → Task.
5. Repeated material → use the repetition rules below.
6. A bare desired state with a measurable/assessable horizon → Goal candidate.
7. A fact, calendar event, note, or unsupported domain material → route or `out_of_domain`.

The classifier never creates a Project solely because an action sounds difficult. An explicit
Project noun, a promotion request, or an utterance that explicitly establishes one named outcome and
multiple child Tasks is required. This minimum-object rule is predictable and reversible.

### 4. Distinguish recurrence from tracking

- Explicit obligation verbs plus a cadence—“submit,” “pay,” “call,” “take,” “do,” “send”—produce a
  recurring Task candidate.
- Explicit “track,” “log,” “record,” “check in,” or “how often” produces a Tracker candidate.
- A count/range target framed as personal practice—“work out three times a week”—produces a Habit
  candidate only when the wording makes tracking/progress the requested job.
- “I want to…” or “I should…” with repeated behavior but no requested job is `needs_choice` between
  recurring Task and Habit Tracker.
- A reminder to perform creates a Task plus Prompt Rule. A reminder to report or answer creates a
  Tracker/Check-in plus Prompt Rule.

### 5. Resolve organization without invention

- An exact normalized accessible entity match resolves.
- A unique Project match determines its List.
- A qualified `List / Project` reference resolves within that List.
- Multiple matches produce `needs_choice` with qualified choices.
- An unknown destination produces `needs_choice`; ilo never auto-creates it from a prepositional
  phrase.
- With no destination, new Tasks use system Inbox. New Projects use the person's explicit default
  List if configured; otherwise they require a List choice.
- Today, Upcoming, Scheduled, and Completed are parsed as Views/timing, never destination Lists.

### 6. Parse timing on independent axes

- `by`, `before`, `no later than`, and `due` → deadline.
- `at`, `on`, `from…to`, `work on`, and `schedule` → scheduled instant/window.
- `remind`, `notify`, and `nudge` → Prompt timing.
- `every`, weekdays, intervals, and completion-relative language → recurrence or check-in schedule.
- Date-only and period language retains its precision as a local interval; it is not converted to a
  fabricated midnight instant.
- If wording supports multiple timing meanings and no reviewed personal default resolves it, return
  `needs_choice`.

### 7. Validate values and state transitions

- Entry values must match the Tracker's primary type without unit or semantic coercion.
- “Didn't” is a negative Entry only for a compatible outcome Tracker.
- “Skip” changes an open Check-in Occurrence and creates no Entry.
- Silence creates nothing.
- Corrections target an exact prior record and append a superseding version.
- Moves, completion with children, archive with active contents, definition changes, and frequency
  increases require exact preview behavior.

### 8. Produce one bounded next step

A clarification asks only the highest-precedence unresolved question. It offers concrete choices and
reclassifies from the original text plus selected answer. ilo does not conduct an open-ended setup
interview when one decision is enough.

## One capture workflow

Every Tasks or Tracking capture uses the same observable sequence:

1. **Capture:** preserve the person's exact text and interaction context.
2. **Classify:** produce a versioned structured result from the normative rubric.
3. **Clarify once:** when required, ask the highest-precedence unresolved choice and rerun the
   original capture with that answer. No mutation has occurred.
4. **Preview:** show entity types, List/Project placement, primary value, timing axes, recurrence,
   prompts, cascades, and assumptions. Simple direct interactive writes may collapse this into a
   concise confirmation under the person's approved policy; the structured preview still exists.
5. **Commit:** recheck context/revisions and atomically write the local semantic group with an
   idempotency key and audit correlation.
6. **Verify:** read the canonical result and report the actual state, including delivery pending or
   failure separately.
7. **Correct:** route corrections through revision-safe domain operations; never reinterpret the
   original text to overwrite history.

This is one workflow, not one generic entity or one generic mutation tool. The same stages apply to
a Task, Task plus Prompt, Tracker, Entry, or Project plus initial Tasks.

## Agent and MCP behavior

The classification rubric belongs in the shared domain/API contract. Web capture and agents consume
the same result. MCP may expose focused prepare tools such as `preview_task_capture` and
`preview_tracking_capture`; it does not own classification logic and does not receive a generic
cross-domain commit tool.

Entity mutations remain focused (`create_list`, `create_project`, `create_task`, `record_entry`,
etc.). A host can follow the returned plan, but the API rechecks context versions and returns a
structured conflict if names, revisions, time, permissions, or open occurrences changed after
preview.

## Golden corpus requirements

The versioned JSON corpus is executable product truth. Each case contains a fixed context,
utterance, expected decision, expected operations, and reason code. Implementations may add parser
details but may not weaken the expected semantic result.

Coverage must include:

- every entity and speech act;
- Task versus Project versus Goal boundaries;
- recurring Task versus Habit boundaries;
- Task + Prompt and Check-in + Prompt multi-operation plans;
- Inbox/List/Project placement and duplicate-name resolution;
- deadline, schedule, prompt time, date precision, DST, and ambiguous time;
- Entry type mismatch, negative result, skip, expiry, correction, and absent Tracker;
- Project/List move, completion, archive, and cascade conflicts;
- queries, calendar routing, factual memory, and unsupported material;
- retries, stale context, inaccessible destinations, and hostile instructions embedded in source
  text.

Tests compare structured results, not prose explanations. Clarification wording may vary only if the
reason code, offered entity choices, and absence of mutation remain exact.

## Research interpretation

The ontology is a product decision, not a claim that psychology establishes one universal task
taxonomy. Research informs four mechanics:

- Separating goals, ongoing areas, Projects, and next actions provides a useful planning hierarchy:
  [GTD Horizons of Focus](https://gettingthingsdone.com/wp-content/uploads/2014/10/2016-Levels-of-Your-Work.pdf).
- Concrete plan formation can reduce cognitive interference from unfulfilled goals, supporting
  executable Tasks beneath broader outcomes:
  [Masicampo and Baumeister](https://doi.org/10.1037/a0024192).
- Specifying when, where, and how can improve goal attainment, supporting timing as explicit
  structured material rather than title text:
  [implementation-intentions meta-analysis](https://doi.org/10.1016/S0065-2601(06)38002-1).
- External reminders can improve delayed-intention performance but are selected partly through
  subjective confidence, supporting prompts as optional cognitive offloading rather than the
  commitment itself:
  [Gilbert](https://doi.org/10.1016/j.concog.2015.01.006).
- Folder-like organization has durable personal meaning and should not be collapsed into tags:
  [Jones et al.](https://doi.org/10.1145/1056808.1056952).
- Habit evidence supports repeated behavior in stable contexts but not a fixed formation period or
  universal streak mechanic:
  [habit-formation systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC11641623/).

The deterministic classifier is primarily a trust and data-integrity mechanism. Its quality must be
validated against the golden corpus and moderated user tests, not inferred from model confidence or
the cited research.

## Acceptance criteria

- Two independent implementations given the same corpus context produce the same entity decision,
  operation types, placement, timing axes, and reason code.
- No fixture classified `needs_choice`, `query`, or `out_of_domain` produces a mutation.
- No incompatible Entry value is silently converted.
- No Prompt time becomes a deadline or scheduled time unless separately stated or explicitly chosen.
- No Project/List transition can leave a Task referencing an incompatible container.
- No project-size inference is based only on external world knowledge.
- Every clarification has 2–3 concrete choices and resolves only one uncertainty.
- The full corpus runs in domain unit tests, API integration tests, and MCP contract tests; UI E2E
  tests cover representative commit, preview, and clarification paths.
