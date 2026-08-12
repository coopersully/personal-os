# Tasks and Tracking Ledger Design

**Status:** Proposed

**Date:** 2026-08-12

**Document relationship:** Once approved, this design supersedes the proposed reminder/task and
goal/motive/habit framing in `docs/product/master-design.md` sections 6.5–6.6 and the corresponding
MCP vocabulary. Those authoritative documents should be updated in the first implementation plan,
not piecemeal during design review.

## Decision summary

ilo will have two sibling workspaces:

- **Tasks** is for finite things a person intends to do.
- **Tracking** is for repeated observations, habits, routines, and personal measurements.

They are composed in **Today**, where due tasks and due check-ins can appear together without
becoming the same kind of record. A reminder is not a third kind of work. It is a prompt attached to
a task, check-in, or later another supported object. A direct request such as “remind me to call Sam
tomorrow at 7” creates a task with a prompt.

The product is a personal ledger with four primary verbs: **remind, check off, log, and query**. It
is not a wellness program, a coach, or a diagnostic product. Behavioral research informs details
such as short check-ins, stable cues, flexible targets, recovery after lapses, and honest treatment
of missing data; it does not determine the product's voice or impose a self-improvement philosophy.

## Problem

ilo currently exposes tasks, reminders, goals, and motives as separate agent domains even though
the distinctions are inconsistent:

- tasks and reminders share one database table but have different API, authorization, and MCP
  contracts;
- tasks are structurally richer, while reminders have the safer agent contract, including reads by
  ID, optimistic revision checks, trash/restore, and structured failure handling;
- goals are manually updated percentages and motives are independent text records, so neither is
  connected to what the person actually did or logged;
- habits and measurements have no first-class home;
- a notification, an expected response, and the underlying thing being tracked are liable to be
  treated as one object.

This produces a system that feels created rather than intentional. It models available screens and
tool names, not the material the person is trying to remember or record.

## Approaches considered

### One combined personal ledger workspace

Put tasks, habits, sleep, meals, and measurements into one polymorphic item model and one workspace.
This makes Today composition easy, but it gives every record a vague lifecycle and forces “done,”
“logged,” “skipped,” and “missing” into one status system. It was rejected because the simplest user
question—“is this something I need to do or something I want to record?”—has a useful, stable answer.

### Separate Tasks, Habits, Health, Goals, and Reminders workspaces

Give each familiar noun its own domain and navigation entry. This can produce tailored screens, but
it repeats schedules, prompts, entries, goals, and agent rules across domains and makes ordinary data
such as sleep or meals feel medicalized. It was rejected because templates and views can provide the
useful specialization without fragmenting the ledger.

### Tasks plus Tracking, composed in Today (selected)

Keep finite actions and repeated observations as two coherent sibling domains. Treat habits,
ratings, measurements, sleep, meals, and other observations as configurations of the same honest
tracking primitives.
Treat reminders as delivery behavior. This gives the person clear homes while preserving one daily
surface and one agent conversation.

## Product frame

The product should let a person answer concrete questions:

- What do I need to do today, tomorrow, or this week?
- What am I trying to practice consistently?
- What happened: when did I sleep, what did I eat, did I exercise, and what did I notice?
- What have I completed or logged over a chosen period?
- Is a pattern changing, and how complete is the underlying data?

It should support both precise and loose intentions. “Take medication at 8:00” is exact. “Get this
done this week” has a due window. “Track meals” may accept entries whenever they happen. “Work out
three times a week” has a target rather than a required daily occurrence.

The system must not turn absence into a moral or factual conclusion. No response is not the same as
“did not do it.” A device estimate is not a measured clinical fact. A missed check-in is not a failed
goal. The ledger preserves those distinctions.

### Non-goals

- A holistic wellness, therapy, medical, or diagnostic product.
- A nutrition prescription, clinical sleep system, or automatic calorie authority.
- A motivational coach persona or an identity-scoring system.
- A universal habit method, fixed habit-formation countdown, or mandatory streak mechanic.
- A generic schema builder exposed before the common task and tracker paths feel simple.
- Automatic causal claims, silent routine changes, or agent access to every personal log.

## Information architecture

### Tasks workspace

Tasks remains a primary navigation destination at `/tasks`. It contains finite commitments,
including inbox, scheduled, upcoming, completed, cancelled, and trashed views. A task may be one-off
or recurring. Each recurring occurrence is independently completable so that completing Monday does
not rewrite Tuesday.

Task detail includes its title, notes, due or scheduled window, priority, estimate, tags, optional
`why`, recurrence, prompts, history, and links to a larger goal when applicable.

### Tracking workspace

Tracking becomes a primary navigation destination at `/tracking`. It contains tracker definitions
and their entries. It provides:

- **Due**: check-ins currently awaiting a response;
- **Trackers**: active, paused, and archived definitions;
- **History**: a chronological ledger that can be filtered by tracker, period, and source;
- **Goals**: computed or explicitly updated targets connected to tasks and tracking data;
- **Insights**: descriptive counts, averages, ranges, trends, and comparisons with their data quality
  shown.

Habits are presented as a convenient type of tracker, not as a separate storage domain or
workspace. Sleep, meals, exercise, and other subjects are ordinary tracker configurations with
appropriate field types and views—not separate product verticals or privileged medical domains.

### Today

Today composes, but does not merge:

1. tasks due or scheduled in the current local day;
2. open check-in occurrences;
3. overdue items that still invite action;
4. optional progress context for active goals.

Each row retains its domain identity and appropriate action: a task is completed; a check-in is
answered, skipped, or marked not applicable. A failed notification delivery does not remove the
underlying item from Today.

## Domain model

### Task

A **Task** is a finite action with a completion state. It contains:

- identity, owner, title, notes, tags, priority, and optional estimate;
- optional `why` in the person's own words;
- scheduled time or window, due time or window, and the time zone in which the intention was made;
- status and completion/cancellation timestamps;
- recurrence definition when it repeats;
- source reference, revision, created/updated timestamps, and soft-deletion state.

The system stores **Task Occurrences** for recurring work. An occurrence has its own effective time
window and outcome. Changes to the recurrence rule apply prospectively; past occurrences retain the
rule version that produced them.

### Tracker

A **Tracker** defines a repeated question or event the person wants to record. It contains:

- name, description, optional `why`, color/icon presentation, and state;
- mode: `check_in`, for expected responses, or `event_log`, for entries whenever something happens;
- a versioned field schema;
- optional schedule and response window;
- optional habit configuration and target;
- presentation and privacy preferences;
- source reference, revision, and audit timestamps.

The initial field types are deliberately general: boolean, number with unit, duration, rating,
single choice, short text, timestamp, time interval, and attachment reference. Tracker templates may
compose these fields. Schema changes create a new version; historical entries continue to validate
and render against the version used when they were recorded.

### Check-in schedule and occurrence

A **Check-in Schedule** defines when a response opportunity should exist. It can express a local
time, a time window, selected weekdays, an interval, or a target count within a calendar period.
Schedules are evaluated in an explicit IANA time zone and preserve their behavior across daylight
saving transitions.

Frequency targets do not imply daily occurrences. “Three workouts per week” can remain an event log
with one open weekly progress window; it does not generate seven opportunities and four synthetic
failures. Occurrences are materialized only for check-ins the person actually asked ilo to present.

A durable **Check-in Occurrence** is created separately from any notification. Its lifecycle is:

- `scheduled`: not open yet;
- `open`: available to answer;
- `answered`: linked to a canonical entry;
- `skipped`: explicitly declined by the person;
- `expired`: the response window ended without an answer;
- `cancelled`: invalidated by an intentional schedule change.

An expired occurrence means **no response**. It is displayed as “missed” only when the person has
explicitly configured the tracker to treat each opportunity that way. It never silently creates a
negative entry.

### Entry

An **Entry** is a timestamped fact in the ledger. It contains:

- tracker and tracker-schema version;
- values keyed to the versioned fields;
- `observedAt`, or `observedFrom` and `observedTo` for an interval;
- the observation time zone and the separate time at which it was recorded;
- origin: manual, agent, import, or automation;
- material source reference and provider identifier when imported;
- optional check-in occurrence;
- confidence/estimation markers on values that were estimated;
- correction metadata and audit timestamps.

An event-log tracker accepts multiple entries in a period. A check-in occurrence has one canonical
answer, but corrections remain an append-only chain: a replacement entry supersedes the prior
version instead of silently overwriting it. Retraction similarly preserves the fact that a record
once existed. Backfilling is supported because `observedAt` and `recordedAt` are distinct.

For habit check-ins, an answered entry may record `completed`, `partial`, `not_completed`, or
`not_applicable`. `skipped` remains an occurrence action, and `expired` remains missing data. This
prevents four materially different states from collapsing into a false boolean.

### Habit

A **Habit** is a tracker configuration in which repeated performance matters. It adds a behavior,
an optional stable cue or context, and a target such as:

- every weekday;
- at least three times in a week;
- between seven and nine hours per night;
- record an event whenever it happens, with no success threshold.

The default progress view shows period counts, target ranges, and recent history. Streaks are an
optional presentation setting, off by default. Breaking a streak never deletes prior progress or
changes a goal to failed.

### Goal

A **Goal** is a desired outcome or constraint over time. It can be:

- task-backed, such as completing a project by Friday;
- tracker-backed, such as three workouts per week;
- numeric, such as an average or range over a tracker field;
- manual when no honest computation is possible.

A goal stores its own title, optional description and `why`, period, state, target definition, and
links to tasks or trackers. Computed goals show their formula and source data. Manual progress is
labelled manual rather than mixed with computed evidence. Goals may be paused, revised, completed,
or retired without being presented as personal failure.

A **Motive** does not remain a top-level record type. The immediate reason belongs in optional `why`
fields on tasks, trackers, and goals. Broader values and preferences belong in the person's profile
and may inform agent behavior only after explicit review.

### Prompt rule, prompt, and delivery

A **Prompt Rule** is the reusable delivery preference attached to a task recurrence or check-in
schedule. It specifies relative or fixed timing, channel preferences, quiet-hour behavior, and
escalation limits. A concrete **Prompt** is generated for a task or check-in occurrence and records
what should be brought to the person's attention. A one-off task may have a concrete prompt without
a reusable rule.

A **Delivery Attempt** records channel, send time, outcome, provider reference, and retry state.
Delivery is not the commitment and is not the response. The underlying task or occurrence remains
queryable when delivery is delayed or fails.

The word **reminder** remains valid user language and a compatibility API concept. Internally it
resolves to a prompt rule or prompt attached to an object. Existing standalone reminders are
preserved during migration and converted only when their intended task semantics are unambiguous.

## Product behavior informed by evidence

| Evidence-informed principle | Product behavior | Guardrail |
| --- | --- | --- |
| Repetition in a stable context supports habit formation. | A habit can store an optional cue, place, or “after I…” context and reuse it in a short check-in. | ilo never claims a behavior is formed after a fixed number of days; reported formation times vary widely. |
| Self-monitoring and goal setting can support behavior change. | Fast entry, visible history, clear targets, and descriptive progress are first-class. | Tracking is always optional and editable; ilo does not assume monitoring helps every person or behavior. |
| Specific when/where plans can improve follow-through. | A tracker or task may record an implementation cue and turn it into a schedule suggestion. | The person reviews the suggestion; an agent does not silently impose routines. |
| Frequent or long assessment increases burden. | A check-in asks one primary question by default, remembers sensible field defaults, and limits follow-ups. Quiet hours, pause, and batching are first-class. | Research thresholds from intensive assessment studies are design signals, not universal limits for ilo. |
| Real self-tracking includes lapses and resumption. | Pause, resume, skip, backfill, and change-target flows are ordinary actions with preserved history. | No shame copy, reset punishment, or fabricated negative entry. |
| Streaks can motivate but a broken highlighted streak can reduce engagement. | Streak display is opt-in and may offer a transparent repair rule. | Counts and trends remain available without streaks; repair never alters source entries. |
| Personal observations vary in structure and precision. | Event logs accept concise text, optional attachments, and optional structured fields. Interval logs support overnight spans and source attribution. | Estimated values are labelled estimated; imported or device-derived data is not presented as diagnosis or clinical-grade truth. |
| Goal adjustment can be adaptive. | Goals can be revised, paused, or retired with a reason and intact history. | ilo does not equate target revision with failure. |

## Illustrative tracker configurations

These examples validate the general model. They do not create separate product domains, imply equal
launch priority, or require dedicated food, fitness, or health experiences. Any setup shortcut
produces an ordinary versioned tracker.

### Habit check-off

A short question, configurable schedule/window, multi-state outcome, optional note, cue, and target.
Example: “Did I take a walk after lunch?” with a target of four times per week.

### Sleep diary

An interval across midnight with optional fields for perceived quality, awakenings, and notes. A
morning check-in can prefill a likely interval but the person confirms it. Imported device sessions
retain their source and can coexist with a subjective diary; ilo does not silently merge them into a
single supposedly exact value.

### Event log

An event log records something whenever it happens, without manufacturing scheduled failures. It
can hold a timestamp, plain-language description, optional attachment, optional labels, and
tracker-defined fields. A meal description is one possible use, alongside exercise, reading,
caffeine, symptoms, or any other event the person chooses to record. If a future integration or
model supplies estimated structured values, they require source labels and review before becoming
canonical.

### Numeric or rating log

A number, duration, rating, or range with unit and optional note. Example: cups of coffee, meditation
minutes, or energy from one to five. The UI makes the scale definition visible so a later rating has
the same meaning.

## ilo's superpowers

The ledger becomes more useful when ilo can act across capture, prompting, and retrieval while
remaining faithful to the person's records.

1. **Natural-language capture with confirmation.** “I need to send the invoice this week,” “ask me
   about sleep every morning,” and “track what I eat” become previews of a task or tracker before the
   material write when interpretation is uncertain.
2. **Durable conversational check-ins.** ilo can find open occurrences, ask the configured short
   question, record the exact response, and safely retry without creating duplicates. A conversation
   is a delivery channel, not the schedule of record.
3. **Precise personal queries.** ilo can answer “what did I eat yesterday?”, “how many workouts did I
   log this month?”, and “what do I still need to do this week?” with time zone, window, source, and
   missing-data semantics intact.
4. **Honest summaries.** Counts, averages, ranges, period comparisons, and correlations state sample
   size, missingness, source mix, and whether values were estimated. Correlation is never phrased as
   causation.
5. **Low-friction correction.** “That was Tuesday, not today” or “I slept until 7:30” creates a
   traceable correction through the same interface.
6. **Schedule suggestions from actual use.** ilo can notice repeated deferrals, nonresponses, or
   entries at a different time and propose a new window. It does not change the schedule until the
   person approves it.
7. **Cross-workspace context without type confusion.** A goal may connect tasks and trackers, and
   Today can prioritize both. ilo still completes tasks and records entries through distinct domain
   operations.

## Agent and MCP contract

### Scopes and privacy selection

Tasks retain `tasks:read` and `tasks:write`. Tracking introduces `tracking:read` and
`tracking:write`; goals become part of Tracking rather than retaining a permanent separate agent
domain. Legacy reminder and goal scopes remain aliases during a bounded compatibility period. An
alias is eligible for removal only after all first-party clients have migrated, affected records
have a reviewed projection or migration, existing grants have been reauthorized without widening
access, and compatibility use has remained absent for a published observation window. The delivery
plan chooses that window and release count before deprecation begins.

Workspace scopes alone are too coarse for potentially sensitive sleep, medication, mood, journal,
or other personal logs. Agent authorization pairs the tracking scope with explicitly selected tracker
sources. New trackers are not automatically shared with an existing agent unless the person chose a
clearly described “all current and future trackers” grant. A write grant cannot create entries for a
tracker outside the corresponding source selection.

### Tools

The coherent task surface is:

- `list_tasks`, `get_task`, `create_task`, `update_task`;
- `complete_task`, `cancel_task`, `trash_task`, `restore_task`;
- recurrence occurrence operations where a single instance must differ from the series.

The initial tracking surface is:

- `list_trackers`, `get_tracker`, `create_tracker`, `update_tracker`, `pause_tracker`,
  `archive_tracker`;
- `list_due_checkins`, `get_checkin`, `answer_checkin`, `skip_checkin`;
- `record_entry`, `list_entries`, `get_entry`, `correct_entry`, `retract_entry`;
- `list_tracking_goals`, `get_tracking_goal`, `create_tracking_goal`, `update_tracking_goal`,
  `get_goal_progress`;
- preview tools for schema changes, material schedule changes, bulk backfill, and destructive actions.

Every mutation accepts an idempotency key where a retry can duplicate a durable fact and an expected
revision where concurrent edits matter. Deletion is soft by default. Tool metadata must accurately
identify read, preview, write, destructive, and idempotent behavior; the current task catalog's
blanket idempotency labels are not carried forward.

Tools remain small domain operations over the public API. There is no generic “manage my life” tool,
and the MCP adapter contains no business logic or direct database access. MCP protocol Tasks—the
protocol's long-running operation handles—remain unrelated to the user's Tasks workspace and should
not be exposed or described as personal tasks.

### Agent workflow stages

- Reads and descriptive queries execute directly within the granted sources.
- Low-risk writes may execute directly only under the person's reviewed domain policy.
- Ambiguous capture, schema changes, schedule expansion, and estimated structured data require a
  preview and explicit confirmation.
- Bulk edits, deletion, or changes that increase prompt frequency are destructive/material and
  require confirmation.

The API, not the agent, owns recurrence expansion, check-in lifecycle, revisions, correction chains,
deduplication, aggregation, authorization, and audit behavior.

## Examples

### “Remind me to do this tomorrow at 7 pm”

ilo previews a Task scheduled for 7:00 p.m. in the person's current time zone with a prompt at the
same time. Confirmation creates the task and prompt. Completing the task closes the commitment;
delivery history remains diagnostic.

If the person says only “I need to do this tomorrow at 7,” ilo creates the scheduled task and
follows the person's reviewed default for timed-task notifications. The preview always makes the
presence or absence of a prompt explicit.

### “I need to do this sometime this week”

ilo creates a Task with a due window ending at the person's end of week, without inventing an exact
appointment. Today can surface it increasingly near the end of the window without pretending it was
scheduled for a specific hour.

### “Check in about my sleep every morning”

ilo previews a Sleep Diary tracker, morning local-time window, requested fields, and prompt. Each
morning generates a durable occurrence. The answer records an overnight interval; ignoring the
prompt expires the occurrence without recording zero sleep.

### “Track what I eat” as an ordinary event log

ilo creates a generic event-log tracker named by the person. “Lunch was leftover curry” records the
description and time using the same primitives as any other event log. This does not activate a
food-specific application, nutrition model, or calorie workflow. A later photograph or nutrient
estimate is source-labelled and reviewable rather than silently treated as ground truth.

### “Work out three times a week”

ilo creates a Habit tracker with an event or check-off field and a weekly count target. The person
can log three workouts on any days; the model does not create seven daily failures.

## Architecture and ownership

Tracking is a new first-class product domain following the existing monorepo boundaries:

- `packages/domain` owns tracker, schedule, occurrence, entry, goal, query, and response schemas;
- `packages/database` owns normalized persistence, migrations, constraints, idempotency, and source
  identity;
- `apps/api` owns authorization, lifecycle rules, aggregation, schedule materialization, correction,
  import reconciliation, and audit writes;
- `packages/api-client` exposes the typed HTTP contract;
- `apps/web/src/features/tracking` owns the Tracking workspace while shared Today/nav composition
  remains Integration-owned;
- `apps/mcp` remains a stateless adapter over the API and owns tool descriptions, discovery, and MCP
  error mapping only.

Core records should be normalized rather than kept as opaque JSON. Versioned field definitions and
entry values may use constrained JSON shapes validated by shared schemas. Attachments use the
existing storage boundary and are referenced, not embedded. All times are stored as instants plus
the local-zone context required to reproduce the person's intended schedule.

Any phase that adds push delivery, a native health bridge, provider import, or other external
handoff must first complete the repository's external-boundary review for configuration, authority,
transport, time, durable commit point, retry/recovery, observation, and production-equivalent
evidence. A present credential or a successful mock is not import or delivery proof.

## Imports and data provenance

Device imports are a later phase, but the ledger must not block them. Apple HealthKit and Android
Health Connect expose sleep and other health-related records with provider identifiers and time
intervals. An import stores provider, account/source, provider record identifier, original time
range, ingestion time, and mapping version.

Re-import is idempotent. Provider corrections supersede their earlier imported version. A manual
entry is not automatically deleted because a device record overlaps it; reconciliation can present
both and let a person choose a preferred source or an explicit merge. Derived summaries disclose
mixed sources and duplicate exclusions.

## Privacy, safety, and trust

- Tracking is private by default and follows the repository's source-scoped agent access model.
- Entries, corrections, prompt deliveries, agent reads/writes, and imports are auditable.
- Export and deletion include definitions, entries, source metadata, and attachments. Soft deletion
  precedes irreversible purge.
- ilo does not diagnose sleep disorders, eating disorders, mental health conditions, or medical
  causes from ledger data.
- It does not infer `not_completed` from silence, treat model-extracted values as facts, or treat a
  wearable estimate as clinical measurement.
- Analytics show period, unit, sample count, missing/open/expired occurrence counts, estimation, and
  source mix. Insufficient or incompatible data produces an honest limitation instead of a score.
- Trackers and metrics can be paused, hidden from Today, or hidden from insights without losing their
  history.
- Prompt delivery observes quiet hours and frequency caps. Delivery failures are visible and
  recoverable; repeated failures do not generate repeated ledger entries.

## Migration and compatibility

1. Bring Tasks to the existing Reminder safety baseline: get, revision guards, source references,
   structured errors, trash/restore, accurate idempotency declarations, and audit consistency.
2. Preserve task IDs and task behavior while separating task persistence from the legacy shared
   `reminders` representation through a reviewed migration.
3. Represent new reminders as prompts. Keep legacy reminder endpoints/tools temporarily, returning
   compatibility projections and deprecation metadata. Convert a standalone legacy reminder to a
   Task plus Prompt only when its semantics are unambiguous; otherwise preserve it until the person
   reviews it.
4. Migrate existing goals to Tracking goals. Mark existing percentage progress as manual/legacy
   until a person links a computation. Do not fabricate tracker history from a percentage.
5. Preserve motives for export and review. Offer to attach each as `why` or a profile value, but do
   not guess the target relationship.
6. Map existing grants through compatibility scope aliases and ask for new source selection before
   exposing tracker entries.

## Delivery sequence

This design should be implemented as bounded, independently reviewable plans:

1. **Task and reminder contract cleanup:** safe task parity, truthful tool metadata, prompt domain
   contract, and compatibility plan.
2. **Core tracking ledger:** tracker/schema versions, entries, corrections, source provenance, and
   generic queries without scheduled prompting.
3. **Tracking workspace:** tracker setup, history, templates, pause/archive, manual logging, and
   source-scoped agent consent.
4. **Check-in orchestration and Today:** schedules, durable occurrences, delivery attempts,
   conversational check-ins, quiet hours, and cross-workspace Today composition.
5. **Goals and insights:** computed targets, data-quality-aware summaries, optional streaks, and goal
   links across Tasks and Tracking.
6. **Imports and advanced assistance:** HealthKit/Health Connect connectors, reconciliation, reviewed
   estimates, and evidence-backed schedule suggestions.

## Acceptance and verification

At minimum, implementation must prove:

- domain validation for every field type, schedule, lifecycle transition, and goal formula;
- API authorization for workspace scope plus tracker source selection;
- optimistic concurrency, retry idempotency, audit events, correction/retraction chains, and soft
  deletion;
- recurrence and schedule behavior across time zones, travel, DST gaps/folds, overnight intervals,
  target-period boundaries, and prospective schedule revisions;
- no response, skipped, not applicable, partial, not completed, delivery failed, and cancelled remain
  distinguishable end to end;
- imported source deduplication, provider correction, manual/import overlap, mixed-source summaries,
  and explicit estimation;
- MCP tool discovery, stage metadata, structured errors, token isolation, source filtering, and
  duplicate agent retries;
- accessible desktop/mobile flows for capture, one-tap check-in, backfill, correction, pause, and
  history;
- notification failure does not lose an occurrence, and expired occurrences do not fabricate
  entries;
- descriptive queries disclose their time window, sample/missingness, unit, estimation, and source
  assumptions;
- repository verification through focused unit/integration/E2E coverage followed by `pnpm verify`.

## Refinement findings incorporated

The first refinement pass reconciled the product with ilo's current contracts. It added task
occurrences, source-scoped tracking grants, revision-safe mutations, explicit compatibility behavior,
and a separation between prompts, deliveries, and underlying commitments.

The second pass challenged the model against self-tracking research and interval, event-log, and
device-import edge cases. It added durable check-in occurrences, versioned tracker schemas, honest
missing-data states, append-only correction chains, overnight intervals, explicit estimates, burden
controls, pause/resume/backfill, optional streaks, and future import identity/deduplication.

## Design defaults

- Tracking v1 has no food-specific vertical. Food works through the same generic event-log fields as
  any other subject; food databases, nutrient modeling, and calorie workflows are out of scope.
- Agent check-ins are channel-agnostic in the domain. The first implementation should use ilo's
  existing in-product agent/notification path before adding external channels.
- Tracker goals support count, sum, average, duration, range, and manually assessed outcomes first;
  arbitrary formulas are out of scope.
- Correlation is descriptive and opt-in. Predictive recommendations or causal claims are out of
  scope.
- A tracker may ask one primary question plus optional fields. There is no universal hard cap on
  daily check-ins, but ilo warns before creating a high-burden schedule and requires confirmation to
  increase prompt frequency.

## Research basis

- Lally et al. and subsequent evidence synthesized in a 2024 systematic review show that habit
  formation time varies substantially and that repetition in a stable context matters; this rejects
  fixed “21-day” product claims: [Habit formation systematic review and meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC11641623/).
- Digital habit interventions commonly use prompts/cues, goal setting, and self-monitoring, though
  much of the evidence is health-behavior-specific: [JMIR systematic review](https://www.jmir.org/2024/1/e54375).
- Specific implementation intentions can help translate goals into action:
  [Implementation intentions and goal achievement](https://www.sciencedirect.com/science/article/abs/pii/S0065260106380021).
- Mobile ecological momentary assessment research reports substantial variation in compliance and
  suggests that more frequent or longer assessments can increase burden:
  [EMA compliance systematic review and meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7970161/).
- The lived informatics model treats lapsing, resuming, and changing tracking practice as normal:
  [Lived informatics model of personal data](https://pmc.ncbi.nlm.nih.gov/articles/PMC12435389/).
- Highlighted broken streaks can reduce later engagement, supporting optional rather than default
  streak presentation: [On or Off Track: How (Broken) Streaks Affect Consumer Decisions](https://academic.oup.com/jcr/article/49/6/1095/6623414).
- The Consensus Sleep Diary provides a practical subjective sleep-diary foundation, while the
  American Academy of Sleep Medicine cautions against treating consumer sleep technology as a
  substitute for validated clinical evaluation:
  [Consensus Sleep Diary](https://pmc.ncbi.nlm.nih.gov/articles/PMC3250369/) and
  [AASM position statement](https://aasm.org/consumer-sleep-technology-position-statement/).
- Food was used only as a pressure test for general event logging and estimation. Smartphone dietary
  assessment combines free text, images, portions, databases, and automated classification with
  continuing validity and usability limitations; this supports keeping any future estimates
  explicit rather than creating a food product now:
  [Systematic review of smartphone dietary assessment tools](https://pubmed.ncbi.nlm.nih.gov/34875978/).
- Personal tracking can be counterproductive for some people, especially when metrics become rigid
  or anxiety-producing; associations do not establish universal causation but justify autonomy and
  safety controls:
  [diet/fitness tracker systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/) and
  [sleep wearable anxiety review](https://pmc.ncbi.nlm.nih.gov/articles/PMC11879103/).
- Goal adjustment—including disengagement from unattainable goals and re-engagement elsewhere—can
  be adaptive: [goal adjustment meta-analysis](https://pubmed.ncbi.nlm.nih.gov/31131441/).

## Success criteria

The redesign succeeds when a person can understand the model without product explanation:

- something to do belongs in Tasks;
- something to observe repeatedly belongs in Tracking;
- a reminder merely brings either one to attention;
- Today shows what needs attention now;
- ilo can reliably capture, check in, correct, and answer questions without exaggerating what the
  data says.
