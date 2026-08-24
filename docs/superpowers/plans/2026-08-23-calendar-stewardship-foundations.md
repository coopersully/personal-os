# Calendar Stewardship Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first independently useful Calendar Ilo slice: a versioned server-owned playbook, evidence-bound schedule findings, honest Calendar status, and immutable reviews over fresh existing projections.

**Architecture:** Calendar-owned domain schemas define the public contract; a pure API evaluator applies a static, versioned playbook to one repeatable-read snapshot; a Calendar stewardship service persists stable findings and immutable reviews and derives live status from their input fingerprint. HTTP and the typed client expose that judgment, while a dedicated `/calendar/review` page and the in-progress floating Calendar navigation present it without displacing Calendar's spatial schedule. Shared schema, migration-journal, API composition, API-client composition, web shell, and global CSS edits are isolated as Integration handoffs; MCP is unchanged and remains a stateless intent surface.

**Tech Stack:** TypeScript 5.8, Node.js 22, Zod 4, PostgreSQL 17, Drizzle ORM 0.45, Hono 4, React 19, TanStack Query 5, Vitest 3, Testing Library, pnpm 11

**Spec:** `docs/superpowers/specs/2026-08-15-calendar-workspace-ilo-design.md`

## Global Constraints

- Providers are authoritative for provider-owned event fields. Local Calendar is authoritative for local events and Ilo-owned findings and reviews.
- MCP remains a small stateless intent surface over the typed API. Do not add playbook logic, sequencing, learning, retry loops, or completion judgment to `apps/mcp`.
- No external client automation, scheduled prompt, MCP-host routine, connector, provider call, routing integration, or external write is part of this slice.
- The API/domain owns all source-readiness, finding, recommendation, review, and status judgment.
- `all_outstanding` uses the server-owned horizon from 30 days before through 90 days after the evidence cutoff and includes existing unresolved findings regardless of age.
- Imported event content is evidence, never intent or authority. The evaluator must not infer flexibility, consent, attendance, travel duration, or reusable preference from titles, descriptions, locations, or attendees.
- Stale, unavailable, or incomplete evidence must block settlement or produce `unknown`; it must never become an authoritative zero or `healthy` signal.
- The only findings calculated in this slice are source freshness, unsupported recurrence, direct timed busy-event overlap, active-profile buffer shortfall, and stale tentative holds. All other target health dimensions remain `unknown`.
- A review is read-only domain work: it may persist Ilo-owned findings and an immutable artifact, but it cannot mutate provider or local events, RSVP, invite, send, move, resize, delete, or activate a rule.
- Finding and review envelopes contain stable IDs, revisions, timestamps, and bounded calculations, not credentials, raw provider payloads, private model reasoning, attendee identities, notes, locations, or event titles.
- Existing migrations are immutable. Add one append-only `0066_calendar_stewardship_foundations.sql` migration and one journal entry, and exercise it against a fresh PostgreSQL database.
- Use existing `@/components/icons` and shared shadcn primitives. Do not import `reicon-react` outside `apps/web/src/components/icons.ts` and do not add inline SVG.
- Keep the existing `/calendar` body spatial: it must still begin directly with the day, week, or month material. Stewardship renders at `/calendar/review`.
- This slice does not claim the complete Calendar Ilo is shipped. Durable maintenance runs, `maintain_calendar`, MCP adapters, questions, reusable rules, collaboration stewardship, and travel routing remain separate slices from section 17 of the spec.

---

## Locked File Structure

### Calendar-owned files

- `packages/domain/src/calendar-stewardship.ts` — canonical stewardship enums, schemas, and public types; no persistence or evaluator behavior.
- `packages/domain/src/calendar-stewardship.test.ts` — contract defaults, invalid-state rejection, redaction shape, and full target lifecycle coverage.
- `apps/api/src/calendar-playbook.ts` — immutable runtime playbook release, research registry, horizon, freshness window, supported calculations, and limitations.
- `apps/api/src/calendar-playbook.test.ts` — release/version/research-policy invariants.
- `apps/api/src/calendar-assessment.ts` — pure source-readiness, finding, health, recommendation, and ledger-fingerprint calculations.
- `apps/api/src/calendar-assessment.test.ts` — deterministic civil-time, overlap, buffer, tentative, recurrence, freshness, and redaction tests.
- `apps/api/src/calendar-stewardship-service.ts` — owner-scoped snapshot reads, atomic finding reconciliation, immutable review publication, and live status derivation.
- `apps/api/src/calendar-stewardship-service.integration.test.ts` — PostgreSQL migration, atomicity, source isolation, invalidation, and lifecycle evidence.
- `apps/api/src/routes/calendar.ts` — Calendar-owned `GET /v1/calendars/status` and read-scoped `POST /v1/calendars/reviews` handlers.
- `apps/api/src/routes/calendar.test.ts` — scope and transport behavior.
- `packages/api-client/src/features/calendar.ts` — typed `getCalendarStatus` and `createCalendarReview` calls.
- `apps/web/src/features/calendar/stewardship-page.tsx` — dedicated review/status UI.
- `apps/web/src/features/calendar/stewardship-page.test.tsx` — loading, first assessment, blocked, findings, stale, retry, and refresh behavior.
- `apps/web/src/features/calendar/floating-nav.tsx` — preserve the concurrent floating-nav work and add one route-only Schedule health action.
- `apps/web/src/features/calendar/floating-nav.test.tsx` — verify the health action without weakening create/date/search behavior.
- `apps/web/src/features/calendar/page.ts` — Calendar-owned status query key only.
- `docs/design/pages/calendar.md` — shipped surface and honest limitations.
- `docs/product/implementation-log.md` — delivered vertical-slice record.

### Explicit Integration handoffs in this slice

- `packages/database/src/schema.ts` — declare `calendar_findings` and `calendar_reviews`.
- `packages/database/src/schema.test.ts` — keep Drizzle constraints and migration SQL aligned.
- `packages/database/migrations/0066_calendar_stewardship_foundations.sql` — append-only expansion.
- `packages/database/migrations/meta/_journal.json` — register migration 0066 without editing prior entries.
- `packages/domain/src/index.ts` — export the Calendar stewardship contract.
- `apps/api/src/app.ts` — construct the stewardship service and inject it into Calendar routes.
- `apps/api/src/openapi.ts` — register the two new HTTP paths.
- `packages/api-client/src/client.ts` — existing spread composition automatically includes the feature methods; only change it if the current composition is not a spread.
- `packages/api-client/src/client.test.ts` — verify the composed public client.
- `apps/web/src/app.tsx` — register `/calendar/review`, give it non-spatial app-bar behavior, and retain the concurrent no-sidebar/floating-nav Calendar composition.
- `apps/web/src/app.test.tsx` — verify navigation ownership and preserve `/calendar` composition.
- `apps/web/src/styles.css` — bounded page layout using existing tokens.

### Deliberately untouched paths

- `apps/mcp/**`
- `packages/connectors/**`
- external clients and automation catalogs
- Today and global Reviews composition
- generic maintenance run/step infrastructure
- Calendar event mutation and provider-effect services

---

### Task 1: Canonical Calendar Stewardship Contract

**Files:**
- Create: `packages/domain/src/calendar-stewardship.ts`
- Create: `packages/domain/src/calendar-stewardship.test.ts`
- Modify (Integration): `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `idSchema`, `isoDateTimeSchema`, `semanticVersionSchema` from `packages/domain/src/common.ts`; `materialSourceReferenceSchema` from `packages/domain/src/feature-contracts.ts`.
- Produces: `CalendarFinding`, `CalendarReview`, `CalendarStatus`, `CalendarMaintenanceScope`, `CalendarHealthDimension`, `CalendarHealthSignal`, `CalendarReviewState`, `CalendarMaintenanceLifecycle`, `CalendarSourceFreshness`, `CalendarRecommendation`, `createCalendarReviewInputSchema`, `calendarReviewSchema`, and `calendarStatusSchema`.

- [ ] **Step 1: Write the failing schema tests**

```ts
import {
  calendarMaintenanceLifecycleSchema,
  calendarReviewSchema,
  calendarStatusSchema,
  createCalendarReviewInputSchema,
} from "./calendar-stewardship.js";

const now = "2026-08-23T16:00:00.000Z";
const id = "11111111-1111-4111-8111-111111111111";

describe("Calendar stewardship contracts", () => {
  it("defaults review creation to the server-owned all-outstanding scope", () => {
    expect(createCalendarReviewInputSchema.parse({})).toEqual({ scope: { type: "all_outstanding" } });
  });

  it("retains the complete target lifecycle even when this slice reaches only settled review states", () => {
    expect(calendarMaintenanceLifecycleSchema.options).toEqual([
      "never_maintained",
      "stale",
      "queued",
      "active",
      "maintained",
      "maintained_with_questions",
      "blocked",
      "failed",
    ]);
  });

  it("rejects a false healthy status with unavailable source evidence", () => {
    const parsed = calendarStatusSchema.safeParse({
      asOf: now,
      readiness: "degraded",
      setupBlockers: [],
      lifecycle: "blocked",
      sources: [{
        accountId: id,
        calendarId: id,
        completeness: "complete",
        evidenceCutoff: now,
        lastSyncedAt: null,
        provider: "google",
        readable: true,
        reason: "Authorization must be renewed.",
        recovery: "reconnect",
        state: "unavailable",
        writable: true,
      }],
      authority: {
        approvedRule: [],
        automatic: ["inspect", "assess"],
        individualApproval: ["create_event", "move_event", "resize_event", "trash_event", "restore_event"],
        unavailable: ["rsvp", "invite", "cancel_attended_event", "book_travel", "send_correspondence"],
      },
      backlog: {
        actionable: null,
        ambiguousEffects: null,
        awaitingApproval: null,
        awaitingInput: null,
        blocked: 1,
        failed: null,
        openFindings: null,
      },
      health: [{
        dimension: "source_trust",
        evidenceFindingIds: [],
        signal: "healthy",
        summary: "Sources are current.",
      }],
      latestReview: null,
      validNextOperations: ["assess_calendar", "open_connections"],
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps review evidence redacted and revision-bound", () => {
    const review = calendarReviewSchema.parse({
      createdAt: now,
      evidenceCutoff: now,
      findings: [],
      health: [],
      id,
      ledgerFingerprint: "a".repeat(64),
      nextMaintenanceAt: "2026-08-23T16:15:00.000Z",
      playbookVersion: "1.0.0",
      profileVersion: null,
      recommendations: [],
      rulebookVersion: "calendar-profile/none",
      scope: { type: "all_outstanding" },
      scopeEnd: "2026-11-21T16:00:00.000Z",
      scopeStart: "2026-07-24T16:00:00.000Z",
      sourceFreshness: [],
      state: "maintained",
    });
    expect(JSON.stringify(review)).not.toMatch(/credentials|raw|attendee|notes|location|title/i);
  });
});
```

- [ ] **Step 2: Run the domain test and verify the missing module failure**

Run: `pnpm exec vitest run packages/domain/src/calendar-stewardship.test.ts`

Expected: FAIL because `./calendar-stewardship.js` does not exist.

- [ ] **Step 3: Add the exact public contract and cross-field honesty checks**

```ts
import { z } from "zod";
import { idSchema, isoDateTimeSchema, semanticVersionSchema } from "./common.js";
import { materialSourceReferenceSchema } from "./feature-contracts.js";

export const calendarMaintenanceScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all_outstanding") }),
  z.object({ type: z.literal("window"), start: isoDateTimeSchema, end: isoDateTimeSchema }),
  z.object({
    type: z.literal("target"),
    entityType: z.enum([
      "event", "series", "invitation", "finding", "question", "proposal",
      "provider_effect", "maintenance_run",
    ]),
    id: idSchema,
  }),
]);
export type CalendarMaintenanceScope = z.infer<typeof calendarMaintenanceScopeSchema>;

export const createCalendarReviewInputSchema = z.object({
  scope: calendarMaintenanceScopeSchema.default({ type: "all_outstanding" }),
});
export type CreateCalendarReviewInput = z.infer<typeof createCalendarReviewInputSchema>;

export const calendarMaintenanceLifecycleSchema = z.enum([
  "never_maintained", "stale", "queued", "active", "maintained",
  "maintained_with_questions", "blocked", "failed",
]);
export type CalendarMaintenanceLifecycle = z.infer<typeof calendarMaintenanceLifecycleSchema>;

export const calendarHealthSignalSchema = z.enum(["healthy", "attention", "strained", "unknown"]);
export type CalendarHealthSignal = z.infer<typeof calendarHealthSignalSchema>;

export const calendarHealthDimensionSchema = z.enum([
  "source_trust", "hard_conflicts", "buffer_and_travel", "protected_time",
  "meeting_load", "out_of_hours", "breaks_and_recovery", "schedule_volatility",
]);
export type CalendarHealthDimension = z.infer<typeof calendarHealthDimensionSchema>;

export const calendarReviewStateSchema = z.enum([
  "maintained", "maintained_with_questions", "blocked",
]);
export type CalendarReviewState = z.infer<typeof calendarReviewStateSchema>;

export const calendarSourceFreshnessSchema = z.object({
  accountId: idSchema,
  calendarId: idSchema,
  completeness: z.enum(["complete", "partial", "unknown"]),
  evidenceCutoff: isoDateTimeSchema,
  lastSyncedAt: isoDateTimeSchema.nullable(),
  provider: z.enum(["google", "icloud", "local"]),
  readable: z.boolean(),
  reason: z.string().max(240).nullable(),
  recovery: z.enum(["automatic", "operator", "reconnect"]).nullable(),
  state: z.enum(["current", "stale", "unavailable"]),
  writable: z.boolean(),
});
export type CalendarSourceFreshness = z.infer<typeof calendarSourceFreshnessSchema>;

export const calendarFindingKindSchema = z.enum([
  "source_stale", "source_unavailable", "recurrence_unassessed",
  "event_overlap", "buffer_shortfall", "tentative_hold",
]);
export type CalendarFindingKind = z.infer<typeof calendarFindingKindSchema>;
export const calendarFindingSeveritySchema = z.enum(["info", "attention", "strained"]);
export type CalendarFindingSeverity = z.infer<typeof calendarFindingSeveritySchema>;
export const calendarFindingStatusSchema = z.enum(["open", "resolved"]);
export type CalendarFindingStatus = z.infer<typeof calendarFindingStatusSchema>;
export const calendarFindingEvidenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("source"), accountId: idSchema, calendarId: idSchema }),
  z.object({
    type: z.literal("event"), eventId: idSchema, startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema, revision: z.string().min(1),
  }),
  z.object({
    type: z.literal("event_pair"), eventIds: z.tuple([idSchema, idSchema]),
    startsAt: isoDateTimeSchema, endsAt: isoDateTimeSchema,
    minutes: z.number().int().min(0), revisions: z.tuple([z.string().min(1), z.string().min(1)]),
  }),
]);
export type CalendarFindingEvidence = z.infer<typeof calendarFindingEvidenceSchema>;

export const calendarFindingSchema = z.object({
  evidence: calendarFindingEvidenceSchema,
  evidenceCutoff: isoDateTimeSchema,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  firstObservedAt: isoDateTimeSchema,
  id: idSchema,
  kind: calendarFindingKindSchema,
  lastObservedAt: isoDateTimeSchema,
  playbookVersion: semanticVersionSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
  rulebookVersion: z.string().min(1).max(160),
  severity: calendarFindingSeveritySchema,
  sourceReferences: z.array(materialSourceReferenceSchema),
  status: calendarFindingStatusSchema,
  summary: z.string().min(1).max(500),
});
export type CalendarFinding = z.infer<typeof calendarFindingSchema>;

export const calendarHealthAssessmentSchema = z.object({
  dimension: calendarHealthDimensionSchema,
  evidenceFindingIds: z.array(idSchema),
  signal: calendarHealthSignalSchema,
  summary: z.string().min(1).max(500),
});
export type CalendarHealthAssessment = z.infer<typeof calendarHealthAssessmentSchema>;

export const calendarRecommendationSchema = z.object({
  assumptions: z.array(z.string().max(240)),
  confidence: z.enum(["low", "medium", "high"]),
  findingIds: z.array(idSchema),
  horizon: z.object({ start: isoDateTimeSchema, end: isoDateTimeSchema }),
  key: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
  tradeoffs: z.array(z.string().max(240)),
});
export type CalendarRecommendation = z.infer<typeof calendarRecommendationSchema>;

export const calendarReviewSchema = z.object({
  createdAt: isoDateTimeSchema,
  evidenceCutoff: isoDateTimeSchema,
  findings: z.array(calendarFindingSchema),
  health: z.array(calendarHealthAssessmentSchema),
  id: idSchema,
  ledgerFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  nextMaintenanceAt: isoDateTimeSchema,
  playbookVersion: semanticVersionSchema,
  profileVersion: z.number().int().positive().nullable(),
  recommendations: z.array(calendarRecommendationSchema),
  rulebookVersion: z.string().min(1).max(160),
  scope: calendarMaintenanceScopeSchema,
  scopeEnd: isoDateTimeSchema,
  scopeStart: isoDateTimeSchema,
  sourceFreshness: z.array(calendarSourceFreshnessSchema),
  state: calendarReviewStateSchema,
});
export type CalendarReview = z.infer<typeof calendarReviewSchema>;

export const calendarStewardshipOperationSchema = z.enum([
  "inspect", "assess", "create_event", "move_event", "resize_event", "trash_event",
  "restore_event", "rsvp", "invite", "cancel_attended_event", "book_travel",
  "send_correspondence",
]);

export const calendarStatusSchema = z.object({
  asOf: isoDateTimeSchema,
  authority: z.object({
    approvedRule: z.array(calendarStewardshipOperationSchema),
    automatic: z.array(calendarStewardshipOperationSchema),
    individualApproval: z.array(calendarStewardshipOperationSchema),
    unavailable: z.array(calendarStewardshipOperationSchema),
  }),
  backlog: z.object({
    actionable: z.number().int().min(0).nullable(),
    ambiguousEffects: z.number().int().min(0).nullable(),
    awaitingApproval: z.number().int().min(0).nullable(),
    awaitingInput: z.number().int().min(0).nullable(),
    blocked: z.number().int().min(0),
    failed: z.number().int().min(0).nullable(),
    openFindings: z.number().int().min(0).nullable(),
  }),
  health: z.array(calendarHealthAssessmentSchema),
  latestReview: calendarReviewSchema.nullable(),
  lifecycle: calendarMaintenanceLifecycleSchema,
  readiness: z.enum(["setup_required", "ready", "degraded"]),
  setupBlockers: z.array(z.string().max(240)),
  sources: z.array(calendarSourceFreshnessSchema),
  validNextOperations: z.array(z.enum(["assess_calendar", "open_connections", "review_findings"])),
}).superRefine((status, context) => {
  const sourceTrust = status.health.find(({ dimension }) => dimension === "source_trust");
  if (status.sources.some(({ state }) => state !== "current") && sourceTrust?.signal === "healthy") {
    context.addIssue({ code: "custom", message: "Unavailable or stale sources cannot be healthy.", path: ["health"] });
  }
  if (status.lifecycle === "maintained" && status.sources.some(({ completeness, state }) => state !== "current" || completeness !== "complete")) {
    context.addIssue({ code: "custom", message: "Maintained status requires current complete sources.", path: ["lifecycle"] });
  }
});
export type CalendarStatus = z.infer<typeof calendarStatusSchema>;
```

Add `export * from "./calendar-stewardship.js";` to `packages/domain/src/index.ts`.

- [ ] **Step 4: Run the contract tests and domain typecheck**

Run: `pnpm exec vitest run packages/domain/src/calendar-stewardship.test.ts && pnpm --filter @personal-os/domain typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the canonical contract**

```bash
git add packages/domain/src/calendar-stewardship.ts packages/domain/src/calendar-stewardship.test.ts packages/domain/src/index.ts
git commit -m "feat(calendar): define stewardship contracts"
```

---

### Task 2: Versioned Playbook and Pure Evidence Evaluator

**Files:**
- Create: `apps/api/src/calendar-playbook.ts`
- Create: `apps/api/src/calendar-playbook.test.ts`
- Create: `apps/api/src/calendar-assessment.ts`
- Create: `apps/api/src/calendar-assessment.test.ts`

**Interfaces:**
- Consumes: `CalendarFindingKind`, `CalendarHealthAssessment`, `CalendarRecommendation`, `CalendarReviewState`, `CalendarSourceFreshness`, and `MaterialSourceReference` from `@personal-os/domain`.
- Produces: `CALENDAR_PLAYBOOK`, `CalendarAssessmentSnapshot`, `CalendarAssessmentDraft`, `assessCalendar(snapshot)`, and `calendarLedgerFingerprint(snapshot)`.

- [ ] **Step 1: Write failing tests for playbook provenance and conservative judgment**

```ts
import { CALENDAR_PLAYBOOK } from "./calendar-playbook.js";
import { assessCalendar, calendarLedgerFingerprint, type CalendarAssessmentSnapshot } from "./calendar-assessment.js";

const cutoff = new Date("2026-08-23T16:00:00.000Z");
const source = {
  accountId: "11111111-1111-4111-8111-111111111111",
  calendarId: "22222222-2222-4222-8222-222222222222",
  calendarRevision: "2026-08-23T15:59:00.000Z",
  isWritable: true,
  lastSyncedAt: "2026-08-23T15:58:00.000Z",
  provider: "google" as const,
  recurrencePresent: false,
  syncGeneration: 4,
  syncRecovery: null,
  syncStatus: "idle" as const,
};
const event = (id: string, startsAt: string, endsAt: string, overrides = {}) => ({
  allDay: false,
  blockSourceEventId: null,
  calendarId: source.calendarId,
  endsAt,
  id,
  provider: "google" as const,
  recurrence: [],
  revision: `${id}-v1`,
  startsAt,
  status: "confirmed" as const,
  transparency: "busy" as const,
  updatedAt: "2026-08-15T16:00:00.000Z",
  ...overrides,
});
const snapshot = (events: ReturnType<typeof event>[]): CalendarAssessmentSnapshot => ({
  activeProfile: { afterBufferMinutes: 15, beforeBufferMinutes: 15, id: "33333333-3333-4333-8333-333333333333", version: 2 },
  evidenceCutoff: cutoff,
  events,
  existingOpenFindings: [],
  scope: { type: "all_outstanding" },
  scopeEnd: new Date("2026-11-21T16:00:00.000Z"),
  scopeStart: new Date("2026-07-24T16:00:00.000Z"),
  sources: [source],
});

describe("Calendar stewardship playbook", () => {
  it("ships a reviewable semantic release and primary-source registry", () => {
    expect(CALENDAR_PLAYBOOK.version).toBe("1.0.0");
    expect(CALENDAR_PLAYBOOK.allOutstanding).toEqual({ futureDays: 90, pastDays: 30 });
    expect(CALENDAR_PLAYBOOK.sourceFreshnessMinutes).toBe(15);
    expect(CALENDAR_PLAYBOOK.research.map(({ publisher }) => publisher)).toEqual(
      expect.arrayContaining(["IETF", "IANA", "Google", "Microsoft Research", "NIOSH", "WHO/ILO"]),
    );
  });
});

describe("Calendar assessment", () => {
  it("finds overlap, buffer shortfall, and a future tentative hold without copying event prose", () => {
    const result = assessCalendar(snapshot([
      event("44444444-4444-4444-8444-444444444444", "2026-08-24T13:00:00.000Z", "2026-08-24T14:00:00.000Z"),
      event("55555555-5555-4555-8555-555555555555", "2026-08-24T13:45:00.000Z", "2026-08-24T14:30:00.000Z", { status: "tentative" }),
      event("66666666-6666-4666-8666-666666666666", "2026-08-24T14:35:00.000Z", "2026-08-24T15:00:00.000Z"),
    ]));
    expect(result.findings.map(({ kind }) => kind)).toEqual([
      "event_overlap", "tentative_hold", "buffer_shortfall",
    ]);
    expect(result.state).toBe("maintained_with_questions");
    expect(JSON.stringify(result)).not.toContain("title");
  });

  it("blocks stale source evidence and unsupported recurrence", () => {
    const stale = snapshot([event("44444444-4444-4444-8444-444444444444", "2026-08-24T13:00:00.000Z", "2026-08-24T14:00:00.000Z", { recurrence: ["RRULE:FREQ=WEEKLY"] })]);
    stale.sources[0] = { ...source, lastSyncedAt: "2026-08-23T15:00:00.000Z", recurrencePresent: true };
    const result = assessCalendar(stale);
    expect(result.state).toBe("blocked");
    expect(result.findings.map(({ kind }) => kind)).toEqual(expect.arrayContaining(["source_stale", "recurrence_unassessed"]));
    expect(result.health.find(({ dimension }) => dimension === "protected_time")?.signal).toBe("unknown");
  });

  it("fingerprints revisions and policy, not private content or cutoff time", () => {
    const first = snapshot([event("44444444-4444-4444-8444-444444444444", "2026-08-24T13:00:00.000Z", "2026-08-24T14:00:00.000Z")]);
    const sameInputsAtAnotherCutoff = { ...first, evidenceCutoff: new Date("2026-08-23T16:05:00.000Z") };
    expect(calendarLedgerFingerprint(first)).toBe(calendarLedgerFingerprint(sameInputsAtAnotherCutoff));
    expect(calendarLedgerFingerprint({ ...first, events: [{ ...first.events[0]!, revision: "changed" }] })).not.toBe(calendarLedgerFingerprint(first));
  });
});
```

- [ ] **Step 2: Run the evaluator tests and verify missing exports**

Run: `pnpm exec vitest run apps/api/src/calendar-playbook.test.ts apps/api/src/calendar-assessment.test.ts`

Expected: FAIL because the playbook and assessment modules do not exist.

- [ ] **Step 3: Implement the immutable playbook release and pure evaluator**

```ts
// apps/api/src/calendar-playbook.ts
import type { CalendarFindingKind } from "@personal-os/domain";

export const CALENDAR_PLAYBOOK = Object.freeze({
  allOutstanding: { futureDays: 90, pastDays: 30 },
  sourceFreshnessMinutes: 15,
  tentativeHoldAgeDays: 7,
  supportedFindingKinds: [
    "source_stale", "source_unavailable", "recurrence_unassessed",
    "event_overlap", "buffer_shortfall", "tentative_hold",
  ] satisfies CalendarFindingKind[],
  limitations: [
    "Recurring series are not expanded in this release; their source is incomplete and blocks settlement.",
    "Travel, protected time, meeting load, out-of-hours load, recovery, and volatility are not calculated in this release.",
    "Event prose and attendee material never create intent or authority.",
  ],
  research: [
    { key: "ical", publisher: "IETF", reviewedAt: "2026-08-15", url: "https://datatracker.ietf.org/doc/rfc5545/" },
    { key: "caldav", publisher: "IETF", reviewedAt: "2026-08-15", url: "https://datatracker.ietf.org/doc/rfc4791/" },
    { key: "scheduling", publisher: "IETF", reviewedAt: "2026-08-15", url: "https://www.rfc-editor.org/info/rfc6638" },
    { key: "civil-time", publisher: "IANA", reviewedAt: "2026-08-15", url: "https://www.iana.org/time-zones" },
    { key: "google-events", publisher: "Google", reviewedAt: "2026-08-15", url: "https://developers.google.com/workspace/calendar/api/v3/reference/events/update" },
    { key: "preferences", publisher: "Microsoft Research", reviewedAt: "2026-08-15", url: "https://www.microsoft.com/en-us/research/publication/rhythm-of-work-mixed-methods-characterization-of-information-workers-scheduling-preferences-and-practices/" },
    { key: "recovery", publisher: "NIOSH", reviewedAt: "2026-08-15", url: "https://www.cdc.gov/niosh/bulletin/2012/sleep-and-work.html" },
    { key: "long-hours", publisher: "WHO/ILO", reviewedAt: "2026-08-15", url: "https://www.who.int/news/item/17-05-2021-long-working-hours-increasing-deaths-from-heart-disease-and-stroke" },
  ],
  version: "1.0.0",
} as const);
```

```ts
// apps/api/src/calendar-assessment.ts — public internal seam
export type CalendarAssessmentSnapshot = {
  activeProfile: { afterBufferMinutes: number; beforeBufferMinutes: number; id: string; version: number } | null;
  evidenceCutoff: Date;
  events: Array<{
    allDay: boolean; blockSourceEventId: string | null; calendarId: string; endsAt: string;
    id: string; provider: "google" | "icloud" | "local"; recurrence: string[];
    revision: string; startsAt: string; status: "confirmed" | "tentative" | "cancelled";
    transparency: "busy" | "free"; updatedAt: string;
  }>;
  existingOpenFindings: Array<{ fingerprint: string; id: string; kind: CalendarFindingKind }>;
  scope: CalendarMaintenanceScope;
  scopeEnd: Date;
  scopeStart: Date;
  sources: Array<{
    accountId: string; calendarId: string; calendarRevision: string;
    isWritable: boolean; lastSyncedAt: string | null; provider: "google" | "icloud" | "local";
    recurrencePresent: boolean; syncGeneration: number;
    syncRecovery: "automatic" | "operator" | "reconnect" | null;
    syncStatus: "idle" | "syncing" | "error";
  }>;
};

export type CalendarAssessmentDraft = {
  findings: Array<Omit<CalendarFinding, "firstObservedAt" | "id" | "lastObservedAt" | "resolvedAt" | "status">>;
  health: Array<Omit<CalendarHealthAssessment, "evidenceFindingIds"> & { evidenceFindingFingerprints: string[] }>;
  recommendations: Array<Omit<CalendarRecommendation, "findingIds"> & { findingFingerprints: string[] }>;
  rulebookVersion: string;
  sourceFreshness: CalendarSourceFreshness[];
  state: CalendarReviewState;
};
```

Implement these exact evaluator rules:

1. Sort sources and events by stable IDs before hashing or comparing.
2. Treat local sources as current without `lastSyncedAt`; connected sources are current only when idle, without recovery, and synced no more than 15 minutes before cutoff. `operator` and `reconnect` are unavailable; every other non-current connected source is stale.
3. Mark a source `partial` and emit `recurrence_unassessed` when any in-scope event on it has a non-empty recurrence array.
4. Candidate timed events are selected, non-cancelled, busy, non-all-day, non-block events without recurrence.
5. Emit one `event_overlap` for each overlapping pair, keyed by sorted event IDs. Emit no separate buffer finding for that same pair.
6. With an active profile, compare adjacent non-overlapping events. Emit `buffer_shortfall` when the gap is less than `max(afterBufferMinutes, beforeBufferMinutes)`.
7. Emit `tentative_hold` only for tentative events that start after cutoff and whose `updatedAt` is at least seven days before the cutoff.
8. `source_trust` is strained for unavailable, attention for stale/partial, and healthy only when every selected source is current and complete. `hard_conflicts` is strained when overlaps exist and otherwise healthy on complete evidence. `buffer_and_travel` is attention for buffer findings and otherwise unknown because travel is unsupported. The other five dimensions are always unknown in release 1.0.0.
9. State is blocked for any non-current or incomplete source; otherwise maintained-with-questions when findings exist; otherwise maintained.
10. Findings and recommendations use generic copy and the typed evidence union. Never copy event title, notes, location, attendee, raw provider data, or account labels.
11. Compute SHA-256 fingerprints over canonical sorted JSON containing scope bounds, source identity/revision/sync generation, event identity/revision, active profile identity/version, playbook version, and rulebook version. Do not include evidence cutoff, event prose, or other private content.

- [ ] **Step 4: Run evaluator tests, API typecheck, and formatting check**

Run: `pnpm exec vitest run apps/api/src/calendar-playbook.test.ts apps/api/src/calendar-assessment.test.ts && pnpm --filter @personal-os/api typecheck && pnpm exec biome check apps/api/src/calendar-playbook.ts apps/api/src/calendar-assessment.ts apps/api/src/calendar-playbook.test.ts apps/api/src/calendar-assessment.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the evaluator**

```bash
git add apps/api/src/calendar-playbook.ts apps/api/src/calendar-playbook.test.ts apps/api/src/calendar-assessment.ts apps/api/src/calendar-assessment.test.ts
git commit -m "feat(calendar): add versioned stewardship assessment"
```

---

### Task 3: Durable Finding and Immutable Review Storage

**Files:**
- Modify (Integration): `packages/database/src/schema.ts`
- Modify (Integration): `packages/database/src/schema.test.ts`
- Create (Integration): `packages/database/migrations/0066_calendar_stewardship_foundations.sql`
- Modify (Integration): `packages/database/migrations/meta/_journal.json`

**Interfaces:**
- Consumes: `CalendarFindingEvidence`, `CalendarFindingKind`, `CalendarFindingSeverity`, `CalendarFindingStatus`, `CalendarHealthAssessment`, `CalendarMaintenanceScope`, `CalendarRecommendation`, `CalendarReviewState`, `CalendarSourceFreshness`, and `MaterialSourceReference` from `@personal-os/domain`.
- Produces: Drizzle tables `calendarFindings` and `calendarReviews`, exported from `@personal-os/database` through the existing schema export.

- [ ] **Step 1: Write failing schema/migration integrity tests**

```ts
import { calendarFindings, calendarReviews } from "./schema.js";

it("keeps Calendar findings stable and reviews immutable", async () => {
  const findings = getTableConfig(calendarFindings);
  const reviews = getTableConfig(calendarReviews);
  expect(findings.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
    "calendar_findings_identity_idx",
    "calendar_findings_user_status_idx",
  ]));
  expect(findings.checks.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
    "calendar_findings_fingerprint_check",
    "calendar_findings_status_check",
    "calendar_findings_resolution_check",
  ]));
  expect(reviews.indexes.map((index) => index.config.name)).toContain("calendar_reviews_user_created_idx");
  expect(reviews.columns.map((column) => column.name)).not.toContain("updated_at");
  const migrationSql = await readFile(
    resolve(process.cwd(), "packages/database/migrations/0066_calendar_stewardship_foundations.sql"),
    "utf8",
  );
  expect(migrationSql).toContain('CREATE TABLE "calendar_findings"');
  expect(migrationSql).toContain('CREATE TABLE "calendar_reviews"');
  expect(migrationSql).toContain("^[0-9a-f]{64}$");
  expect(migrationSql).toContain('CREATE UNIQUE INDEX "calendar_findings_identity_idx"');
  expect(migrationSql).not.toContain('ALTER TABLE "calendar_events"');
});
```

- [ ] **Step 2: Run the schema test and verify missing table exports**

Run: `pnpm exec vitest run packages/database/src/schema.test.ts`

Expected: FAIL because `calendarFindings`, `calendarReviews`, and migration 0066 do not exist.

- [ ] **Step 3: Add the append-only schema expansion and exact SQL migration**

Add these shapes next to the Calendar tables in `schema.ts`:

```ts
export const calendarFindings = pgTable(
  "calendar_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").$type<CalendarFindingKind>().notNull(),
    severity: text("severity").$type<CalendarFindingSeverity>().notNull(),
    status: text("status").$type<CalendarFindingStatus>().notNull().default("open"),
    summary: text("summary").notNull(),
    evidence: jsonb("evidence").$type<CalendarFindingEvidence>().notNull(),
    sourceReferences: jsonb("source_references").$type<MaterialSourceReference[]>().notNull().default([]),
    evidenceCutoff: timestamp("evidence_cutoff", { withTimezone: true }).notNull(),
    playbookVersion: text("playbook_version").notNull(),
    rulebookVersion: text("rulebook_version").notNull(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("calendar_findings_identity_idx").on(table.userId, table.fingerprint),
    index("calendar_findings_user_status_idx").on(table.userId, table.status, table.lastObservedAt),
    check("calendar_findings_fingerprint_check", sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check("calendar_findings_status_check", sql`${table.status} IN ('open', 'resolved')`),
    check("calendar_findings_resolution_check", sql`(${table.status} = 'resolved') = (${table.resolvedAt} IS NOT NULL)`),
  ],
);

export const calendarReviews = pgTable(
  "calendar_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    state: text("state").$type<CalendarReviewState>().notNull(),
    scope: jsonb("scope").$type<CalendarMaintenanceScope>().notNull(),
    scopeStart: timestamp("scope_start", { withTimezone: true }).notNull(),
    scopeEnd: timestamp("scope_end", { withTimezone: true }).notNull(),
    evidenceCutoff: timestamp("evidence_cutoff", { withTimezone: true }).notNull(),
    nextMaintenanceAt: timestamp("next_maintenance_at", { withTimezone: true }).notNull(),
    playbookVersion: text("playbook_version").notNull(),
    rulebookVersion: text("rulebook_version").notNull(),
    profileVersion: integer("profile_version"),
    ledgerFingerprint: text("ledger_fingerprint").notNull(),
    sourceFreshness: jsonb("source_freshness").$type<CalendarSourceFreshness[]>().notNull(),
    health: jsonb("health").$type<CalendarHealthAssessment[]>().notNull(),
    findingSnapshots: jsonb("finding_snapshots").$type<CalendarFinding[]>().notNull(),
    recommendations: jsonb("recommendations").$type<CalendarRecommendation[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("calendar_reviews_user_created_idx").on(table.userId, table.createdAt),
    check("calendar_reviews_fingerprint_check", sql`${table.ledgerFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("calendar_reviews_state_check", sql`${table.state} IN ('maintained', 'maintained_with_questions', 'blocked')`),
    check("calendar_reviews_scope_check", sql`${table.scopeStart} <= ${table.evidenceCutoff} AND ${table.evidenceCutoff} <= ${table.scopeEnd}`),
  ],
);
```

Create migration 0066 with only the two tables, their foreign keys, checks, and indexes:

```sql
CREATE TABLE "calendar_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"source_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_cutoff" timestamp with time zone NOT NULL,
	"playbook_version" text NOT NULL,
	"rulebook_version" text NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_findings_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "calendar_findings_status_check" CHECK ("status" IN ('open', 'resolved')),
	CONSTRAINT "calendar_findings_resolution_check" CHECK (("status" = 'resolved') = ("resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "calendar_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"scope" jsonb NOT NULL,
	"scope_start" timestamp with time zone NOT NULL,
	"scope_end" timestamp with time zone NOT NULL,
	"evidence_cutoff" timestamp with time zone NOT NULL,
	"next_maintenance_at" timestamp with time zone NOT NULL,
	"playbook_version" text NOT NULL,
	"rulebook_version" text NOT NULL,
	"profile_version" integer,
	"ledger_fingerprint" text NOT NULL,
	"source_freshness" jsonb NOT NULL,
	"health" jsonb NOT NULL,
	"finding_snapshots" jsonb NOT NULL,
	"recommendations" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_reviews_fingerprint_check" CHECK ("ledger_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "calendar_reviews_state_check" CHECK ("state" IN ('maintained', 'maintained_with_questions', 'blocked')),
	CONSTRAINT "calendar_reviews_scope_check" CHECK ("scope_start" <= "evidence_cutoff" AND "evidence_cutoff" <= "scope_end")
);
--> statement-breakpoint
ALTER TABLE "calendar_findings" ADD CONSTRAINT "calendar_findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_reviews" ADD CONSTRAINT "calendar_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_findings_identity_idx" ON "calendar_findings" USING btree ("user_id", "fingerprint");
--> statement-breakpoint
CREATE INDEX "calendar_findings_user_status_idx" ON "calendar_findings" USING btree ("user_id", "status", "last_observed_at");
--> statement-breakpoint
CREATE INDEX "calendar_reviews_user_created_idx" ON "calendar_reviews" USING btree ("user_id", "created_at");
```

Append this exact journal record after index 54, using a monotonically greater `when` value:

```json
{
  "idx": 66,
  "version": "7",
  "when": 1787558400000,
  "tag": "0066_calendar_stewardship_foundations",
  "breakpoints": true
}
```

- [ ] **Step 4: Verify schema, SQL, journal, and fresh-database migration**

Run: `pnpm exec vitest run packages/database/src/schema.test.ts apps/api/src/calendar-service.integration.test.ts && pnpm --filter @personal-os/database typecheck`

Expected: PASS; the integration suite applies every migration through 0066 to a fresh PostgreSQL 17 container.

- [ ] **Step 5: Commit the durable ledger**

```bash
git add packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/migrations/0066_calendar_stewardship_foundations.sql packages/database/migrations/meta/_journal.json
git commit -m "feat(calendar): persist findings and reviews"
```

---

### Task 4: Calendar Stewardship Service and Live Status

**Files:**
- Create: `apps/api/src/calendar-stewardship-service.ts`
- Create: `apps/api/src/calendar-stewardship-service.integration.test.ts`

**Interfaces:**
- Consumes: `Database`, `calendarAccounts`, `calendarEvents`, `calendarFindings`, `calendarReviews`, `calendars`, and `domainProfiles`; `assessCalendar`, `calendarLedgerFingerprint`, `CalendarAssessmentSnapshot`; `CALENDAR_PLAYBOOK`; `CalendarReview`, `CalendarStatus`, and `CreateCalendarReviewInput`.
- Produces: `createCalendarStewardshipService({ db, now })` returning `createReview(userId, input): Promise<CalendarReview>` and `getStatus(userId): Promise<CalendarStatus>`. Private persistence seams are `readAssessmentSnapshot(executor, userId, scope, evidenceCutoff): Promise<CalendarAssessmentSnapshot>`, `reconcileFindings(transaction, userId, snapshot, draft): Promise<CalendarFinding[]>`, `bindFindingIds(health, findings): CalendarHealthAssessment[]`, `bindRecommendationFindingIds(recommendations, findings): CalendarRecommendation[]`, `insertReview(transaction, input): Promise<CalendarReview>`, `readLatestReview(executor, userId): Promise<CalendarReview | null>`, and `buildStatus(input): CalendarStatus`.

- [ ] **Step 1: Write failing PostgreSQL integration tests for atomic review and status behavior**

```ts
describe("Calendar stewardship service", () => {
  it("publishes owner-scoped findings and an immutable review from one repeatable-read snapshot", async () => {
    const review = await service.createReview(user.id, { scope: { type: "all_outstanding" } });
    expect(review.state).toBe("maintained_with_questions");
    expect(review.findings.map(({ kind }) => kind)).toContain("event_overlap");
    const rows = await database.db.select().from(calendarReviews);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.findingSnapshots).toEqual(review.findings);
    expect(JSON.stringify(rows[0])).not.toMatch(/Planning meeting|private note|attendee@example.com/);
  });

  it("reopens stable findings, resolves absent findings, and never crosses users", async () => {
    const first = await service.createReview(user.id, { scope: { type: "all_outstanding" } });
    const overlap = first.findings.find(({ kind }) => kind === "event_overlap")!;
    await database.db.update(calendarEvents).set({ startsAt: new Date("2026-08-24T15:00:00.000Z"), updatedAt: now }).where(eq(calendarEvents.id, secondEvent.id));
    const second = await service.createReview(user.id, { scope: { type: "all_outstanding" } });
    expect(second.findings).not.toContainEqual(expect.objectContaining({ id: overlap.id }));
    const [resolved] = await database.db.select().from(calendarFindings).where(eq(calendarFindings.id, overlap.id));
    expect(resolved?.status).toBe("resolved");
    expect((await otherUserService.getStatus(otherUser.id)).latestReview).toBeNull();
  });

  it("invalidates status when a source, event, profile, playbook, or review freshness boundary changes", async () => {
    await service.createReview(user.id, { scope: { type: "all_outstanding" } });
    expect((await service.getStatus(user.id)).lifecycle).toBe("maintained_with_questions");
    await database.db.update(calendarEvents).set({ remoteEtag: "changed-v2", updatedAt: new Date(now.getTime() + 1_000) }).where(eq(calendarEvents.id, firstEvent.id));
    expect((await service.getStatus(user.id)).lifecycle).toBe("stale");
  });

  it("blocks unavailable and recurrence-incomplete projections without claiming a zero", async () => {
    await database.db.update(calendarAccounts).set({ syncRecovery: "reconnect", syncStatus: "error", syncFailureCount: 1, syncError: "Safe reconnect required", syncErrorCode: "authorization_required", syncErrorCategory: "authorization" }).where(eq(calendarAccounts.id, account.id));
    const review = await service.createReview(user.id, { scope: { type: "all_outstanding" } });
    expect(review.state).toBe("blocked");
    const status = await service.getStatus(user.id);
    expect(status.lifecycle).toBe("blocked");
    expect(status.backlog.openFindings).toBeNull();
    expect(status.validNextOperations).toContain("open_connections");
  });
});
```

Use the existing Testcontainers setup from `apps/api/src/calendar-service.integration.test.ts`: PostgreSQL 17.5, `migrate(database.db, { migrationsFolder })`, and per-test user/account/calendar fixtures.

- [ ] **Step 2: Run the service integration test and verify the missing factory**

Run: `pnpm exec vitest run apps/api/src/calendar-stewardship-service.integration.test.ts`

Expected: FAIL because `createCalendarStewardshipService` does not exist.

- [ ] **Step 3: Implement repeatable-read snapshotting, finding reconciliation, review publication, and status invalidation**

```ts
type CalendarStewardshipServiceOptions = { db: Database; now: () => Date };

export function createCalendarStewardshipService({ db, now }: CalendarStewardshipServiceOptions) {
  return {
    async createReview(userId: string, input: CreateCalendarReviewInput): Promise<CalendarReview> {
      if (input.scope.type !== "all_outstanding") {
        throw new AppError("invalid_request", "This Calendar release supports all-outstanding reviews only.");
      }
      const evidenceCutoff = now();
      return db.transaction(async (transaction) => {
        const snapshot = await readAssessmentSnapshot(transaction, userId, input.scope, evidenceCutoff);
        const draft = assessCalendar(snapshot);
        const findings = await reconcileFindings(transaction, userId, snapshot, draft);
        const health = bindFindingIds(draft.health, findings);
        const recommendations = bindRecommendationFindingIds(draft.recommendations, findings);
        const review = await insertReview(transaction, {
          draft,
          findings,
          health,
          ledgerFingerprint: calendarLedgerFingerprint(snapshot),
          nextMaintenanceAt: new Date(evidenceCutoff.getTime() + CALENDAR_PLAYBOOK.sourceFreshnessMinutes * 60_000),
          profileVersion: snapshot.activeProfile?.version ?? null,
          recommendations,
          snapshot,
          userId,
        });
        return calendarReviewSchema.parse(review);
      }, { isolationLevel: "repeatable read" });
    },

    async getStatus(userId: string): Promise<CalendarStatus> {
      const asOf = now();
      return db.transaction(async (transaction) => {
        const latestReview = await readLatestReview(transaction, userId);
        const scope = latestReview?.scope ?? { type: "all_outstanding" as const };
        const cutoff = latestReview?.evidenceCutoff ?? asOf;
        const snapshot = await readAssessmentSnapshot(transaction, userId, scope, cutoff);
        const assessment = assessCalendar({ ...snapshot, evidenceCutoff: asOf });
        const fingerprintChanged = latestReview !== null && latestReview.ledgerFingerprint !== calendarLedgerFingerprint(snapshot);
        const expired = latestReview !== null && asOf > new Date(latestReview.nextMaintenanceAt);
        const lifecycle = latestReview === null
          ? "never_maintained"
          : fingerprintChanged || expired
            ? "stale"
            : latestReview.state;
        return calendarStatusSchema.parse(buildStatus({ asOf, assessment, latestReview, lifecycle, snapshot }));
      }, { isolationLevel: "repeatable read", readOnly: true });
    },
  };
}
```

Implement these persistence invariants:

- `readAssessmentSnapshot` reads selected, enabled, non-deleted calendars and their accounts; events intersecting the fixed 30/90 window; every currently open Calendar finding; and the active Calendar profile. It projects only IDs, revisions, scheduling fields, sync state, recurrence presence, and buffer preferences.
- Use `remoteEtag ?? updatedAt.toISOString()` as an event revision and `calendar.updatedAt.toISOString()` plus account sync generation/state as source revisions.
- Reject non-`all_outstanding` input with the exact `invalid_request` error above; the target schemas remain complete for later slices.
- Upsert each current finding on `(user_id, fingerprint)`, preserving `id` and `firstObservedAt`, setting `status = open`, updating evidence/version/last-observed fields, and clearing `resolvedAt`.
- Resolve previously open findings whose kind is supported by playbook 1.0.0 but whose fingerprint is absent from the new assessment. Do not alter findings from a future unsupported playbook kind.
- Insert one new `calendar_reviews` row after finding reconciliation. Never update a review row.
- Bind health and recommendation references to the persisted finding IDs before snapshotting.
- `readiness` is `setup_required` when there is no selected calendar or no active Calendar profile, `degraded` when any selected source is stale/unavailable/partial, and `ready` otherwise.
- `backlog.openFindings` and `backlog.actionable` are `null` when required evidence is stale, unavailable, or partial; otherwise they are the authoritative current-finding count. `blocked` counts blocked sources. Keep `awaitingApproval`, `awaitingInput`, `failed`, and `ambiguousEffects` null because this slice has not implemented those ledgers and cannot claim a zero.
- `authority.automatic` is exactly `inspect` and `assess`; `individualApproval` names the existing guarded event operations; `approvedRule` is empty because Calendar rules are not shipped; `unavailable` names RSVP, invitation, attended-event cancellation, travel booking, and correspondence actions unavailable to this slice.
- `validNextOperations` always includes `assess_calendar`; add `open_connections` for operator/reconnect recovery and `review_findings` when a current review has findings.
- Do not write audit rows: review creation changes only Ilo-owned derived state and has no provider effect. The immutable review itself is the evidence artifact.

- [ ] **Step 4: Run integration, service-adjacent tests, and API typecheck**

Run: `pnpm exec vitest run apps/api/src/calendar-stewardship-service.integration.test.ts apps/api/src/calendar-assessment.test.ts packages/database/src/schema.test.ts && pnpm --filter @personal-os/api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the stewardship service**

```bash
git add apps/api/src/calendar-stewardship-service.ts apps/api/src/calendar-stewardship-service.integration.test.ts
git commit -m "feat(calendar): publish durable stewardship reviews"
```

---

### Task 5: Read-Scoped HTTP Surface and Typed API Client

**Files:**
- Modify: `apps/api/src/routes/calendar.ts`
- Modify: `apps/api/src/routes/calendar.test.ts`
- Modify: `packages/api-client/src/features/calendar.ts`
- Modify (Integration): `packages/api-client/src/client.test.ts`
- Modify (Integration): `apps/api/src/app.ts`
- Modify (Integration): `apps/api/src/app.integration.test.ts`
- Modify (Integration): `apps/api/src/openapi.ts`
- Modify (only if composition is no longer a spread): `packages/api-client/src/client.ts`

**Interfaces:**
- Consumes: `ReturnType<typeof createCalendarStewardshipService>`, `createCalendarReviewInputSchema`, `CalendarReview`, and `CalendarStatus`.
- Produces: `GET /v1/calendars/status`, `POST /v1/calendars/reviews`, `api.getCalendarStatus()`, and `api.createCalendarReview(input?)`.

- [ ] **Step 1: Write failing route and composed-client tests**

```ts
it("keeps status and read-only review creation Calendar-read scoped", async () => {
  const stewardship = {
    createReview: vi.fn(async () => review),
    getStatus: vi.fn(async () => status),
  };
  // Register routes with the existing principal/scopes harness.
  scopes = new Set<AccessScope>();
  expect((await request("/v1/calendars/status")).status).toBe(403);
  expect((await request("/v1/calendars/reviews", { body: "{}", method: "POST" })).status).toBe(403);

  scopes = new Set<AccessScope>(["calendar:read"]);
  expect((await request("/v1/calendars/status")).status).toBe(200);
  const response = await request("/v1/calendars/reviews", { body: "{}", method: "POST" });
  expect(response.status).toBe(201);
  expect(stewardship.createReview).toHaveBeenCalledWith(id, { scope: { type: "all_outstanding" } });
});
```

```ts
it("exposes Calendar status and review through the composed typed client", async () => {
  responses.set("GET /v1/calendars/status", { status });
  responses.set("POST /v1/calendars/reviews", { review });
  await expect(client.getCalendarStatus()).resolves.toEqual(status);
  await expect(client.createCalendarReview()).resolves.toEqual(review);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/v1/calendars/reviews"), expect.objectContaining({ method: "POST" }));
});
```

```ts
it("publishes Calendar stewardship in the OpenAPI document", async () => {
  const response = await app.request("/openapi.json");
  const document = await response.json();
  expect(document.paths["/v1/calendars/status"].get.responses[200].description).toBe("Calendar stewardship status");
  expect(document.paths["/v1/calendars/reviews"].post.responses[201].description).toBe("Immutable Calendar review created");
});
```

- [ ] **Step 2: Run route and client tests and verify missing options/methods**

Run: `pnpm exec vitest run apps/api/src/routes/calendar.test.ts packages/api-client/src/client.test.ts`

Expected: FAIL because the route options and typed client do not expose stewardship.

- [ ] **Step 3: Wire thin handlers, typed calls, composition, and OpenAPI paths**

Change `CalendarRouteOptions` to receive both services:

```ts
type CalendarRouteOptions = {
  app: Hono<AppEnv>;
  calendar: ReturnType<typeof createCalendarService>;
  stewardship: ReturnType<typeof createCalendarStewardshipService>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
};
```

Before `/:id` routes, register:

```ts
app.get("/v1/calendars/status", async (context) =>
  context.json({ status: await stewardship.getStatus(context.get("principal").userId) }),
);
app.post("/v1/calendars/reviews", async (context) =>
  context.json({
    review: await stewardship.createReview(
      context.get("principal").userId,
      await parseOptionalBody(context, createCalendarReviewInputSchema),
    ),
  }, 201),
);
```

Replace the one-path read-only POST exception with a set containing both exact paths:

```ts
const calendarReadOnlyPostPaths = new Set([
  "/v1/calendars/commitments/preview",
  "/v1/calendars/reviews",
]);
app.use("/v1/calendars/*", (context, next) =>
  context.req.method === "POST" && calendarReadOnlyPostPaths.has(context.req.path)
    ? calendarReadAccess(context, next)
    : calendarFeatureAccess(context, next),
);
```

Construct `const calendarStewardship = createCalendarStewardshipService({ db: dependencies.db, now });` in `apps/api/src/app.ts` and inject it into `registerCalendarRoutes`. Add OpenAPI entries with 200/201 and shared security. Add these client methods:

```ts
async getCalendarStatus(): Promise<CalendarStatus> {
  const response = await request<{ status: CalendarStatus }>("/v1/calendars/status");
  return response.status;
},
async createCalendarReview(input: CreateCalendarReviewInput = { scope: { type: "all_outstanding" } }): Promise<CalendarReview> {
  const response = await request<{ review: CalendarReview }>("/v1/calendars/reviews", {
    body: JSON.stringify(input),
    method: "POST",
  });
  return response.review;
},
```

Do not add an MCP tool and do not add any event-write scope to review creation.

- [ ] **Step 4: Run route, client, app integration, OpenAPI, and type checks**

Run: `pnpm exec vitest run apps/api/src/routes/calendar.test.ts packages/api-client/src/client.test.ts apps/api/src/app.integration.test.ts && pnpm --filter @personal-os/api typecheck && pnpm --filter @personal-os/api-client typecheck`

Expected: PASS; the app integration suite fetches `/openapi.json` and observes both Calendar stewardship paths.

- [ ] **Step 5: Commit the HTTP and client surface**

```bash
git add apps/api/src/routes/calendar.ts apps/api/src/routes/calendar.test.ts apps/api/src/app.ts apps/api/src/app.integration.test.ts apps/api/src/openapi.ts packages/api-client/src/features/calendar.ts packages/api-client/src/client.test.ts packages/api-client/src/client.ts
git commit -m "feat(calendar): expose stewardship status and reviews"
```

---

### Task 6: Calendar-Owned Stewardship Review Page and Floating Navigation Entry

**Files:**
- Create: `apps/web/src/features/calendar/stewardship-page.tsx`
- Create: `apps/web/src/features/calendar/stewardship-page.test.tsx`
- Modify without reverting concurrent work: `apps/web/src/features/calendar/floating-nav.tsx`
- Create: `apps/web/src/features/calendar/floating-nav.test.tsx`
- Modify: `apps/web/src/features/calendar/page.ts`

**Interfaces:**
- Consumes: `api.getCalendarStatus()`, `api.createCalendarReview()`, `CalendarStatus`, `CalendarReview`, existing Alert/Badge/Button/Card/Empty/Item/Skeleton components, and icons from `@/components/icons`.
- Produces: `CalendarStewardshipPage`, `calendarQueryKeys.status`, one `Schedule health` route link in `CalendarFloatingNav`, and private helpers `CalendarStewardshipSkeleton(): JSX.Element`, `CalendarStewardshipError({ error, onRetry }): JSX.Element`, `LifecyclePanel({ status }: { status: CalendarStatus }): JSX.Element`, `SourceEvidencePanel({ status }: { status: CalendarStatus }): JSX.Element`, `HealthDimensionsPanel({ health }: { health: CalendarHealthAssessment[] }): JSX.Element`, `FindingPanel({ review, openFindingCount }: { review: CalendarReview | null; openFindingCount: number | null }): JSX.Element`, and `RecommendationPanel({ review }: { review: CalendarReview | null }): JSX.Element`.

- [ ] **Step 1: Write failing component tests for all honest user-visible states**

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { CalendarStewardshipPage } from "./stewardship-page.js";

const mocks = vi.hoisted(() => ({ createCalendarReview: vi.fn(), getCalendarStatus: vi.fn() }));
vi.mock("../../api.js", () => ({ api: mocks, errorMessage: (error: unknown) => error instanceof Error ? error.message : "Unknown error" }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { gcTime: 0, retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><CalendarStewardshipPage /></MemoryRouter></QueryClientProvider>);
}

it("explains first assessment and refreshes to the durable review", async () => {
  const browser = userEvent.setup();
  mocks.getCalendarStatus.mockResolvedValueOnce(neverMaintainedStatus).mockResolvedValueOnce(maintainedStatus);
  mocks.createCalendarReview.mockResolvedValue(review);
  renderPage();
  expect(await screen.findByText("Calendar has not been assessed yet")).toBeInTheDocument();
  await browser.click(screen.getByRole("button", { name: "Assess calendar" }));
  await waitFor(() => expect(mocks.createCalendarReview).toHaveBeenCalledWith());
  expect(await screen.findByText("Busy events overlap")).toBeInTheDocument();
  expect(screen.getByText(/Evidence through/)).toBeInTheDocument();
});

it("shows blocked evidence and the first-party recovery path without a false zero", async () => {
  mocks.getCalendarStatus.mockResolvedValue(blockedStatus);
  renderPage();
  expect(await screen.findByRole("heading", { name: "Source evidence needs attention" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Connections" })).toHaveAttribute("href", "/settings?section=connections");
  expect(screen.queryByText("No findings")).not.toBeInTheDocument();
  expect(screen.getByText("Unknown until source evidence is current")).toBeInTheDocument();
});

it("shows stale review state and recovers from read and mutation errors", async () => {
  const browser = userEvent.setup();
  mocks.getCalendarStatus.mockRejectedValueOnce(new Error("Status unavailable")).mockResolvedValueOnce(staleStatus);
  mocks.createCalendarReview.mockRejectedValueOnce(new Error("Assessment unavailable")).mockResolvedValueOnce(review);
  renderPage();
  expect(await screen.findByText("Status unavailable")).toBeInTheDocument();
  await browser.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("This review is stale")).toBeInTheDocument();
  await browser.click(screen.getByRole("button", { name: "Assess calendar" }));
  expect(await screen.findByText("Assessment unavailable")).toBeInTheDocument();
});

it("keeps schedule health reachable from the floating Calendar actions", () => {
  render(<MemoryRouter><CalendarFloatingNav anchor={{ day: 23, month: 8, year: 2026 }} calendars={[]} onNavigate={vi.fn()} timeZone="UTC" user={user} /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Schedule health" })).toHaveAttribute("href", "/calendar/review");
  expect(screen.getByRole("button", { name: "Choose date" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Search calendar" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create event" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the page test and verify the missing component**

Run: `pnpm exec vitest run apps/web/src/features/calendar/stewardship-page.test.tsx`

Expected: FAIL because `CalendarStewardshipPage` does not exist.

- [ ] **Step 3: Build the dedicated, accessible review surface**

Add `status: ["calendar-status"] as const` to `calendarQueryKeys` and implement:

```tsx
export function CalendarStewardshipPage() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryFn: api.getCalendarStatus, queryKey: calendarQueryKeys.status });
  const assess = useMutation({
    mutationFn: () => api.createCalendarReview(),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: calendarQueryKeys.status }),
  });

  if (status.isPending) return <CalendarStewardshipSkeleton />;
  if (status.isError) return <CalendarStewardshipError error={status.error} onRetry={() => void status.refetch()} />;

  const value = status.data;
  return (
    <div className="calendar-stewardship-page">
      <header className="calendar-stewardship-page__header">
        <div><Button asChild size="sm" variant="ghost"><Link to="/calendar"><ArrowLeftIcon aria-hidden="true" />Back to schedule</Link></Button><p className="eyebrow">Calendar Ilo</p><h2>Schedule health</h2><p>Evidence-bound review of source trust, conflicts, buffers, and tentative holds.</p></div>
        <Button disabled={assess.isPending} onClick={() => assess.mutate()}>
          <RefreshIcon aria-hidden="true" />{assess.isPending ? "Assessing…" : "Assess calendar"}
        </Button>
      </header>
      {assess.isError ? <Alert variant="destructive"><AlertTitle>Assessment unavailable</AlertTitle><AlertDescription>{errorMessage(assess.error)}</AlertDescription></Alert> : null}
      <LifecyclePanel status={value} />
      <SourceEvidencePanel status={value} />
      <HealthDimensionsPanel health={value.health} />
      <FindingPanel review={value.latestReview} openFindingCount={value.backlog.openFindings} />
      <RecommendationPanel review={value.latestReview} />
    </div>
  );
}
```

Rendering rules:

- `never_maintained`: show “Calendar has not been assessed yet” and explain the 30-day prior/90-day future horizon.
- `stale`: show “This review is stale” and preserve the prior artifact below it.
- `blocked`: heading “Source evidence needs attention”; show source reason and recovery owner. Render “Open Connections” only for `operator`/`reconnect`.
- `maintained`: label “Reviewed”; `maintained_with_questions`: label “Reviewed with findings”. Do not use “optimized”, “fixed”, or “all clear”.
- Show evidence cutoff, next maintenance time, playbook version, and rulebook version.
- Render every health dimension with its signal. Unknown copy is “Unknown until source evidence is current” for source blocking and the server-supplied summary otherwise.
- Do not show “No findings” when `openFindingCount` is null. Show “No findings in the supported checks” only for an authoritative zero and repeat that travel, protected-time, load, recovery, and volatility are not calculated in this release.
- Render generic finding summaries only; never request or render event prose.
- Recommendations remain advisory and have no mutation button.
- Use semantic headings, `role="status"` for lifecycle, and `aria-live="polite"` for assessment completion.

In `CalendarFloatingNav`, preserve the concurrent date, search, and inline-create modes and add only this route link to the closed pill:

```tsx
<Button asChild size="icon" variant="ghost">
  <Link aria-label="Schedule health" to="/calendar/review">
    <ShieldCheckIcon aria-hidden="true" />
  </Link>
</Button>
```

- [ ] **Step 4: Run the component tests and web typecheck**

Run: `pnpm exec vitest run apps/web/src/features/calendar/stewardship-page.test.tsx apps/web/src/features/calendar/floating-nav.test.tsx && pnpm --filter @personal-os/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the Calendar-owned page**

```bash
git add apps/web/src/features/calendar/stewardship-page.tsx apps/web/src/features/calendar/stewardship-page.test.tsx apps/web/src/features/calendar/floating-nav.tsx apps/web/src/features/calendar/floating-nav.test.tsx apps/web/src/features/calendar/page.ts
git commit -m "feat(calendar): add schedule health review page"
```

---

### Task 7: Web Shell and Floating Calendar Navigation Integration

**Files:**
- Modify (Integration): `apps/web/src/app.tsx`
- Modify (Integration): `apps/web/src/app.test.tsx`
- Modify (Integration): `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `CalendarStewardshipPage`, `CalendarFloatingNav`, existing `navigationOwnerForLocation` behavior for `/calendar/*`, and the concurrent `app-shell--calendar` no-sidebar composition.
- Produces: routable `/calendar/review`, a floating `Schedule health` entry on `/calendar`, a first-party back link on the review, non-spatial review app bar, and bounded responsive page layout.

- [ ] **Step 1: Write failing shell tests that protect both routes**

```tsx
it("routes Calendar stewardship inside the Calendar workspace without replacing the spatial schedule", async () => {
  renderApp("/calendar/review");
  expect(await screen.findByRole("heading", { name: "Schedule health" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to schedule" })).toHaveAttribute("href", "/calendar");
  expect(screen.getByText("Calendar review", { selector: ".workspace-app-bar__title" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Calendar date picker")).not.toBeInTheDocument();

  renderApp("/calendar");
  expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Calendar actions" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Schedule health" })).toHaveAttribute("href", "/calendar/review");
  expect(screen.queryByLabelText("Calendar date picker")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused shell tests and verify the missing route/navigation**

Run: `pnpm exec vitest run apps/web/src/app.test.tsx -t 'Calendar stewardship|Calendar workspace'`

Expected: FAIL because `/calendar/review` redirects and no Calendar feature navigation exists.

- [ ] **Step 3: Register the route and make Calendar chrome path-sensitive**

Add the feature route:

```tsx
<Route path="/calendar/review" element={<CalendarStewardshipPage />} />
```

Update the title and app bar conditions:

```ts
if (pathname === "/calendar/review") return "Calendar review";
if (pathname === "/calendar") return "Calendar";
```

```tsx
const isSpatialCalendar = pathname === "/calendar";
const identity = isSpatialCalendar
  ? <CalendarAppBarIdentity user={user} />
  : <span className="workspace-app-bar__title">{pageTitle ?? workspaceDefinitions.find((item) => item.id === workspace)?.label}</span>;
const context = isSpatialCalendar
  ? <CalendarAppBarControls onToday={onCalendarToday} user={user} />
  : workspace === "mail"
    ? <MailTopbarSearch />
    : pathname === "/today"
      ? <TodayWeatherTopbar user={user} weather={weather} />
      : pathname === "/activity"
        ? <ActivityTopbarControls />
        : pathname === "/reminders"
          ? <RemindersTopbarControls />
          : pathname === "/tasks"
            ? <TasksTopbarControls />
            : null;
```

Keep the concurrent Calendar workspace behavior: no desktop sidebar, no mobile dock, and no app-bar create button. Render `CalendarFloatingNav` only from the spatial `CalendarPage`, after the day/week/month body, using the existing `anchor`, `calendars.data ?? []`, `user`, and `updateCalendarState` values:

```tsx
<CalendarFloatingNav
  anchor={anchor}
  calendars={calendars.data ?? []}
  onNavigate={(date) => updateCalendarState({ date: localDateToIso(date), follow: "0" })}
  timeZone={user.planningTimezone}
  user={user}
/>
```

Do not render the floating date/search/create actions on `/calendar/review`; the review page owns only its explicit Back to schedule link.

Add only bounded feature classes to `styles.css` using existing tokens:

```css
.calendar-stewardship-page {
  display: grid;
  gap: 1rem;
  height: 100%;
  overflow-y: auto;
  padding: clamp(1rem, 3vw, 2rem);
}
.calendar-stewardship-page__header {
  align-items: start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}
.calendar-stewardship-page__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (max-width: 720px) {
  .calendar-stewardship-page__header { align-items: stretch; flex-direction: column; }
  .calendar-stewardship-page__grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Run focused page/shell tests, icon contract, and web typecheck**

Run: `pnpm exec vitest run apps/web/src/features/calendar/stewardship-page.test.tsx apps/web/src/app.test.tsx -t 'Calendar stewardship|Calendar workspace|Schedule health' && node scripts/check-icon-contract.mjs && pnpm --filter @personal-os/web typecheck`

Expected: PASS; `/calendar` retains its date orientation, app-bar controls, floating actions, and spatial body without restoring the removed sidebar, while `/calendar/review` uses Calendar ownership with review-specific chrome.

- [ ] **Step 5: Commit the Integration wiring**

```bash
git add apps/web/src/app.tsx apps/web/src/app.test.tsx apps/web/src/styles.css
git commit -m "feat(calendar): wire stewardship review surface"
```

---

### Task 8: Shipped-Slice Documentation and Full Verification

**Files:**
- Modify: `docs/design/pages/calendar.md`
- Modify: `docs/product/implementation-log.md`
- Verify only: `docs/product/ilo-workspace-stewardship.md`
- Verify only: `docs/architecture/0004-workspace-ilo-stewardship.md`
- Verify only: `docs/engineering/external-boundary-reliability.md`
- Verify only: `docs/engineering/connector-reliability.md`

**Interfaces:**
- Consumes: the complete target design and the implemented slice evidence from Tasks 1–7.
- Produces: an honest shipped-capability record and repository-wide verification evidence.

- [ ] **Step 1: Write the implementation-log and page contract text**

Add this entry at the top of `docs/product/implementation-log.md`:

```markdown
## 2026-08-23 — Calendar stewardship foundations

- Added a server-owned Calendar playbook release and research registry, with a fixed 30-day prior
  and 90-day future assessment horizon and a 15-minute connected-source freshness boundary.
- Added stable, evidence-bound findings for source readiness, unsupported recurrence, direct timed
  busy-event overlap, active-profile buffer shortfall, and tentative holds. Private event prose,
  attendees, locations, raw provider payloads, and credentials do not enter the review envelope.
- Added owner-scoped durable findings, immutable Calendar reviews, input-fingerprint invalidation,
  and multidimensional status that blocks or reports unknown instead of turning partial evidence
  into a healthy zero.
- Added an authenticated Calendar schedule-health page and read-scoped typed API. It can assess and
  advise, but it cannot change events or provider state.
- This is slice 1 of the approved Calendar Ilo target. Durable maintenance runs, `maintain_calendar`,
  MCP wiring, questions, reusable rules, collaboration stewardship, and travel routing are not
  claimed as shipped.
```

Add a matching “Schedule health review” section to `docs/design/pages/calendar.md` that names `/calendar/review`, the supported finding kinds, all UI states, evidence/version display, and the same explicit limitations. Do not edit `docs/mcp.md` because this slice adds no MCP surface.

- [ ] **Step 2: Run the focused complete-slice suite**

Run:

```bash
pnpm exec vitest run \
  packages/domain/src/calendar-stewardship.test.ts \
  packages/database/src/schema.test.ts \
  apps/api/src/calendar-playbook.test.ts \
  apps/api/src/calendar-assessment.test.ts \
  apps/api/src/calendar-stewardship-service.integration.test.ts \
  apps/api/src/routes/calendar.test.ts \
  packages/api-client/src/client.test.ts \
  apps/web/src/features/calendar/stewardship-page.test.tsx \
  apps/web/src/app.test.tsx
```

Expected: PASS with PostgreSQL migration 0066 applied in integration tests.

- [ ] **Step 3: Run deterministic repository verification**

Run: `pnpm verify`

Expected: PASS for environment checks, lint, type checking, coverage thresholds, production builds, and desktop/mobile E2E acceptance.

- [ ] **Step 4: Inspect the final diff for boundary violations and private-data leakage**

Run:

```bash
git diff --check
git diff --stat HEAD~7..HEAD
git diff HEAD~7..HEAD -- apps/mcp packages/connectors
rg -n 'credentials|rawProvider|attendee|event\.title|event\.notes|event\.location' apps/api/src/calendar-assessment.ts apps/api/src/calendar-stewardship-service.ts apps/web/src/features/calendar/stewardship-page.tsx
```

Expected: no whitespace errors; no changes under MCP or connectors; the redaction search has no review-envelope use of private fields. If commit count differs because a task was amended, replace `HEAD~7` with the commit immediately before Task 1.

- [ ] **Step 5: Commit documentation and record verification evidence**

```bash
git add docs/design/pages/calendar.md docs/product/implementation-log.md
git commit -m "docs: record Calendar stewardship foundations"
git status --short
```

Expected: the documentation commit succeeds and `git status --short` is empty.

---

## Acceptance Traceability for This Slice

| Approved target requirement | Slice-1 evidence | Deferred target work |
| --- | --- | --- |
| Living ledger | Existing source/event/profile projections plus stable findings and immutable reviews | Semantic annotations, questions, rules, run/step/effect ledgers |
| Professional roles and researched playbook | Runtime playbook 1.0.0, source registry, conservative limitations | Scheduled research refresh enforcement and later calculation releases |
| Surgical tools and authority | Read-only assessment only; no event/provider mutation or inferred authority | Exact previews, approvals, approved-rule actions, collaboration operations |
| Autonomous maintenance turn | Domain evaluator and terminal review judgment are reusable by a coordinator | Durable runs, leases, fencing, recovery, coalescing, `maintain_calendar` |
| Authority boundaries | Read scope, provider truth, active-profile-only buffers, redacted evidence | Questions, signed-in reusable-rule approval, mutation audits |
| Learning loop | No implicit learning; recommendations remain advisory | One-off answers, explicit rule proposals, disablement, rollback |
| Status model | Full lifecycle contract; live `never_maintained`, `stale`, `maintained`, `maintained_with_questions`, and `blocked` states | Observable `queued`, `active`, and `failed` from durable runs |
| Review artifact | Owner-scoped immutable review with scope, cutoff, versions, freshness, health, findings, and advice | Run effects, questions/proposals, rule history, target-run amendments |
| Stateless MCP | No MCP change; all judgment remains callable through typed HTTP/API client | Thin `get_calendar_status` and `maintain_calendar` adapters in slice 2 |
| No external client automation | No schedule, prompt, host routine, connector, or provider call | Automatic initiation remains outside the approved design |

## Shared Integration Change List

These changes require Integration-owner review even though they are necessary for the vertical slice:

1. `packages/database/src/schema.ts`, migration 0066, schema test, and migration journal registration.
2. `packages/domain/src/index.ts` export registration.
3. `apps/api/src/app.ts` service construction and route injection.
4. `apps/api/src/openapi.ts` path registration.
5. `packages/api-client/src/client.test.ts` composed-client coverage; `client.ts` only if spread composition has changed.
6. `apps/web/src/app.tsx`, `app.test.tsx`, and `styles.css` route, app-bar, floating-navigation placement, and layout composition.

There is deliberately no Integration change to MCP, Today, global Reviews, generic maintenance infrastructure, connector configuration, deployment networking, secrets, callbacks, schedules, or external provider boundaries.
