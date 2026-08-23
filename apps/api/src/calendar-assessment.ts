import { createHash } from "node:crypto";
import type {
  CalendarFinding,
  CalendarFindingEvidence,
  CalendarFindingKind,
  CalendarHealthAssessment,
  CalendarMaintenanceScope,
  CalendarRecommendation,
  CalendarReviewState,
  CalendarSourceFreshness,
  MaterialSourceReference,
} from "@personal-os/domain";
import { CALENDAR_PLAYBOOK } from "./calendar-playbook.js";

type AssessmentEvent = {
  allDay: boolean;
  blockSourceEventId: string | null;
  calendarId: string;
  endsAt: string;
  id: string;
  provider: "google" | "icloud" | "local";
  recurrence: string[];
  remoteEventId: string | null;
  revision: string;
  startsAt: string;
  status: "confirmed" | "tentative" | "cancelled";
  transparency: "busy" | "free";
  updatedAt: string;
};

type AssessmentSource = {
  accountId: string;
  calendarId: string;
  calendarRevision: string;
  isWritable: boolean;
  lastSyncedAt: string | null;
  provider: "google" | "icloud" | "local";
  recurrencePresent: boolean;
  syncGeneration: number;
  syncRecovery: "automatic" | "operator" | "reconnect" | null;
  syncStatus: "idle" | "syncing" | "error";
};

export type CalendarAssessmentSnapshot = {
  activeProfile: {
    afterBufferMinutes: number;
    beforeBufferMinutes: number;
    id: string;
    version: number;
  } | null;
  evidenceCutoff: Date;
  evidenceLimits: { eventBudgetExceeded: boolean; openFindingBudgetExceeded: boolean };
  events: AssessmentEvent[];
  existingOpenFindings: Array<{ fingerprint: string; id: string; kind: CalendarFindingKind }>;
  scope: CalendarMaintenanceScope;
  scopeEnd: Date;
  scopeStart: Date;
  sources: AssessmentSource[];
};

export type CalendarAssessmentDraft = {
  evidenceLimited: boolean;
  findings: Array<
    Omit<CalendarFinding, "firstObservedAt" | "id" | "lastObservedAt" | "resolvedAt" | "status">
  >;
  health: Array<
    Omit<CalendarHealthAssessment, "evidenceFindingIds"> & { evidenceFindingFingerprints: string[] }
  >;
  recommendations: Array<
    Omit<CalendarRecommendation, "findingIds"> & { findingFingerprints: string[] }
  >;
  rulebookVersion: string;
  sourceFreshness: CalendarSourceFreshness[];
  state: CalendarReviewState;
};

export const CALENDAR_ASSESSMENT_BUDGETS = Object.freeze({ events: 250, findings: 100 });

type DraftFinding = CalendarAssessmentDraft["findings"][number];
type EventPair = readonly [AssessmentEvent, AssessmentEvent];

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const RELEASE_UNKNOWN_DIMENSIONS = [
  "protected_time",
  "meeting_load",
  "out_of_hours",
  "breaks_and_recovery",
  "schedule_volatility",
] as const;

function compareById<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function compareSources(left: AssessmentSource, right: AssessmentSource): number {
  return (
    left.accountId.localeCompare(right.accountId) ||
    left.calendarId.localeCompare(right.calendarId) ||
    left.provider.localeCompare(right.provider)
  );
}

function canonicalJson(value: unknown): string {
  const canonicalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(canonicalize);
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function rulebookVersion(activeProfile: CalendarAssessmentSnapshot["activeProfile"]): string {
  return activeProfile
    ? `calendar-profile/${activeProfile.id}/v${activeProfile.version}`
    : "calendar-profile/none";
}

function sourceReference(source: AssessmentSource): MaterialSourceReference {
  return {
    accountId: source.accountId,
    provider: source.provider,
    remoteId: source.calendarId,
    revision: source.calendarRevision,
    sourceType: "calendar_event",
  };
}

function eventReference(
  event: AssessmentEvent,
  source: AssessmentSource | undefined,
): MaterialSourceReference {
  return {
    accountId: source?.accountId ?? null,
    provider: event.provider,
    remoteId: event.provider === "local" ? event.id : (event.remoteEventId ?? event.id),
    revision: event.revision,
    sourceType: "calendar_event",
  };
}

function eventIsInScope(event: AssessmentEvent, snapshot: CalendarAssessmentSnapshot): boolean {
  if (event.recurrence.length > 0) return true;
  const startsAt = new Date(event.startsAt).getTime();
  const endsAt = new Date(event.endsAt).getTime();
  return startsAt < snapshot.scopeEnd.getTime() && endsAt > snapshot.scopeStart.getTime();
}

function sourceState(
  source: AssessmentSource,
  evidenceCutoff: Date,
): CalendarSourceFreshness["state"] {
  if (source.provider === "local") return "current";
  if (source.syncRecovery === "operator" || source.syncRecovery === "reconnect") {
    return "unavailable";
  }
  if (
    source.syncStatus === "idle" &&
    source.syncRecovery === null &&
    source.lastSyncedAt !== null &&
    evidenceCutoff.getTime() - new Date(source.lastSyncedAt).getTime() >= 0 &&
    evidenceCutoff.getTime() - new Date(source.lastSyncedAt).getTime() <=
      CALENDAR_PLAYBOOK.sourceFreshnessMinutes * MINUTE_MS
  ) {
    return "current";
  }
  return "stale";
}

function sourceReason(state: CalendarSourceFreshness["state"]): string | null {
  if (state === "current") return null;
  if (state === "unavailable") {
    return "Connected calendar evidence requires operator action or reconnection.";
  }
  return "Connected calendar evidence is not current at the assessment cutoff.";
}

function sourceFinding(
  kind: "source_stale" | "source_unavailable" | "recurrence_unassessed",
  source: AssessmentSource,
  rulebook: string,
): DraftFinding {
  const evidence: CalendarFindingEvidence = {
    accountId: source.accountId,
    calendarId: source.calendarId,
    type: "source",
  };
  const sourceReferences = [sourceReference(source)];
  const summary =
    kind === "source_unavailable"
      ? "This calendar source is unavailable for a settled assessment."
      : kind === "source_stale"
        ? "This calendar source is not current enough for a settled assessment."
        : "Recurring events are not expanded in this release, so this calendar source is incomplete.";
  return makeFinding({
    evidence,
    kind,
    rulebook,
    severity: kind === "source_unavailable" ? "strained" : "attention",
    sourceReferences,
    summary,
  });
}

function sortedPair(left: AssessmentEvent, right: AssessmentEvent): EventPair {
  return compareById(left, right) <= 0 ? [left, right] : [right, left];
}

function pairEvidence(
  first: AssessmentEvent,
  second: AssessmentEvent,
  startsAt: string,
  endsAt: string,
): CalendarFindingEvidence {
  const [left, right] = sortedPair(first, second);
  return {
    endsAt,
    eventIds: [left.id, right.id],
    minutes: Math.max(0, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / MINUTE_MS)),
    revisions: [left.revision, right.revision],
    startsAt,
    type: "event_pair",
  };
}

function pairSourceReferences(
  first: AssessmentEvent,
  second: AssessmentEvent,
  sourcesByCalendarId: Map<string, AssessmentSource>,
): MaterialSourceReference[] {
  return sortedPair(first, second).map((event) => eventReference(event, sourcesByCalendarId.get(event.calendarId)));
}

function makeFinding(input: {
  evidence: CalendarFindingEvidence;
  kind: CalendarFindingKind;
  rulebook: string;
  severity: DraftFinding["severity"];
  sourceReferences: MaterialSourceReference[];
  summary: string;
}): DraftFinding {
  return {
    evidence: input.evidence,
    evidenceCutoff: "",
    fingerprint: sha256({
      evidence: input.evidence,
      kind: input.kind,
      playbookVersion: CALENDAR_PLAYBOOK.version,
      rulebookVersion: input.rulebook,
      sourceReferences: input.sourceReferences,
    }),
    kind: input.kind,
    playbookVersion: CALENDAR_PLAYBOOK.version,
    rulebookVersion: input.rulebook,
    severity: input.severity,
    sourceReferences: input.sourceReferences,
    summary: input.summary,
  };
}

function recommendationFor(finding: DraftFinding, snapshot: CalendarAssessmentSnapshot) {
  const copy: Record<CalendarFindingKind, string> = {
    buffer_shortfall: "Review the transition buffer around the affected schedule window.",
    event_overlap: "Review the conflicting schedule window before relying on it.",
    recurrence_unassessed: "Expand or otherwise assess the recurring schedule before relying on this review.",
    source_stale: "Refresh the calendar source before relying on this review.",
    source_unavailable: "Restore access to the calendar source before relying on this review.",
    tentative_hold: "Review whether the tentative schedule hold is still needed.",
  };
  return {
    assumptions: ["This release provides advisory findings and does not change calendar events."],
    confidence:
      finding.kind === "source_stale" ||
      finding.kind === "source_unavailable" ||
      finding.kind === "recurrence_unassessed"
        ? "low"
        : "medium",
    findingFingerprints: [finding.fingerprint],
    horizon: {
      end: snapshot.scopeEnd.toISOString(),
      start: snapshot.scopeStart.toISOString(),
    },
    key: `calendar-${finding.kind}`,
    summary: copy[finding.kind],
    tradeoffs: ["The assessment cannot infer intent or make a calendar change."],
  } satisfies CalendarAssessmentDraft["recommendations"][number];
}

/**
 * Stable identity for whether a persisted assessment still represents the same
 * source, event, profile, and policy inputs. It intentionally excludes the
 * wall-clock evidence cutoff and all private provider content.
 */
export function calendarLedgerFingerprint(snapshot: CalendarAssessmentSnapshot): string {
  const rulebook = rulebookVersion(snapshot.activeProfile);
  return sha256({
    activeProfile: snapshot.activeProfile
      ? { id: snapshot.activeProfile.id, version: snapshot.activeProfile.version }
      : null,
    events: [...snapshot.events]
      .sort(compareById)
      .map(({
        availability,
        calendarId,
        endsAt,
        id,
        isAllDay,
        provider,
        recurrence,
        remoteEventId,
        revision,
        startsAt,
        status,
        transparency,
      }) => ({
        availability,
        calendarId,
        endsAt,
        id,
        isAllDay,
        provider,
        recurrence,
        remoteEventId,
        revision,
        startsAt,
        status,
        transparency,
      })),
    evidenceLimits: snapshot.evidenceLimits,
    playbookVersion: CALENDAR_PLAYBOOK.version,
    rulebookVersion: rulebook,
    scope: snapshot.scope,
    sources: [...snapshot.sources]
      .sort(compareSources)
      .map(({ accountId, calendarId, calendarRevision, provider, syncGeneration }) => ({
        accountId,
        calendarId,
        calendarRevision,
        provider,
        syncGeneration,
      })),
  });
}

/** Evaluate one immutable Calendar evidence snapshot without database or provider access. */
export function assessCalendar(snapshot: CalendarAssessmentSnapshot): CalendarAssessmentDraft {
  const rulebook = rulebookVersion(snapshot.activeProfile);
  const sources = [...snapshot.sources].sort(compareSources);
  const events = snapshot.events
    .filter((event) => eventIsInScope(event, snapshot))
    .sort(compareById);
  const sourcesByCalendarId = new Map(sources.map((source) => [source.calendarId, source]));
  const recurrenceByCalendarId = new Set(
    events.filter((event) => event.recurrence.length > 0).map((event) => event.calendarId),
  );
  const findings: DraftFinding[] = [];
  let findingBudgetExceeded = false;
  const pushFinding = (finding: DraftFinding): void => {
    if (findings.length < CALENDAR_ASSESSMENT_BUDGETS.findings) findings.push(finding);
    else findingBudgetExceeded = true;
  };
  const inputEvidenceLimited =
    snapshot.evidenceLimits.eventBudgetExceeded ||
    snapshot.evidenceLimits.openFindingBudgetExceeded;
  let sourceFreshness = sources.map((source) => {
    const state = sourceState(source, snapshot.evidenceCutoff);
    const completeness = recurrenceByCalendarId.has(source.calendarId) ? "partial" : "complete";
    if (state !== "current") {
      pushFinding(sourceFinding(state === "unavailable" ? "source_unavailable" : "source_stale", source, rulebook));
    }
    if (completeness === "partial") {
      pushFinding(sourceFinding("recurrence_unassessed", source, rulebook));
    }
    return {
      accountId: source.accountId,
      calendarId: source.calendarId,
      completeness: inputEvidenceLimited ? "partial" : completeness,
      evidenceCutoff: snapshot.evidenceCutoff.toISOString(),
      lastSyncedAt: source.lastSyncedAt,
      provider: source.provider,
      readable: state !== "unavailable",
      reason: inputEvidenceLimited
        ? "Calendar evidence exceeded the bounded assessment budget."
        : completeness === "partial" && state === "current"
          ? "Recurring events are not expanded in this release."
          : sourceReason(state),
      recovery: source.syncRecovery,
      state,
      writable: source.isWritable,
    } satisfies CalendarSourceFreshness;
  });

  const candidates = events
    .filter(
      (event) =>
        event.status !== "cancelled" &&
        event.transparency === "busy" &&
        !event.allDay &&
        event.blockSourceEventId === null &&
        event.recurrence.length === 0,
    )
    .sort(
      (left, right) =>
        new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime() || compareById(left, right),
    );

  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    const first = candidates[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const second = candidates[secondIndex]!;
      const overlapStart = Math.max(new Date(first.startsAt).getTime(), new Date(second.startsAt).getTime());
      const overlapEnd = Math.min(new Date(first.endsAt).getTime(), new Date(second.endsAt).getTime());
      if (overlapEnd <= overlapStart) continue;
      pushFinding(
        makeFinding({
          evidence: pairEvidence(
            first,
            second,
            new Date(overlapStart).toISOString(),
            new Date(overlapEnd).toISOString(),
          ),
          kind: "event_overlap",
          rulebook,
          severity: "strained",
          sourceReferences: pairSourceReferences(first, second, sourcesByCalendarId),
          summary: "Two timed busy events overlap in the assessed schedule window.",
        }),
      );
    }
  }

  for (const event of events) {
    if (
      event.status !== "cancelled" &&
      event.status === "tentative" &&
      new Date(event.startsAt).getTime() > snapshot.evidenceCutoff.getTime() &&
      snapshot.evidenceCutoff.getTime() - new Date(event.updatedAt).getTime() >=
        CALENDAR_PLAYBOOK.tentativeHoldAgeDays * DAY_MS
    ) {
      pushFinding(
        makeFinding({
          evidence: {
            endsAt: event.endsAt,
            eventId: event.id,
            revision: event.revision,
            startsAt: event.startsAt,
            type: "event",
          },
          kind: "tentative_hold",
          rulebook,
          severity: "attention",
          sourceReferences: [eventReference(event, sourcesByCalendarId.get(event.calendarId))],
          summary: "A future tentative schedule hold has not been updated recently.",
        }),
      );
    }
  }

  if (snapshot.activeProfile) {
    const requiredBufferMinutes = Math.max(
      snapshot.activeProfile.afterBufferMinutes,
      snapshot.activeProfile.beforeBufferMinutes,
    );
    for (let index = 1; index < candidates.length; index += 1) {
      const first = candidates[index - 1]!;
      const second = candidates[index]!;
      const gapStart = new Date(first.endsAt).getTime();
      const gapEnd = new Date(second.startsAt).getTime();
      if (gapEnd <= gapStart || gapEnd - gapStart >= requiredBufferMinutes * MINUTE_MS) continue;
      pushFinding(
        makeFinding({
          evidence: pairEvidence(first, second, first.endsAt, second.startsAt),
          kind: "buffer_shortfall",
          rulebook,
          severity: "attention",
          sourceReferences: pairSourceReferences(first, second, sourcesByCalendarId),
          summary: "Adjacent timed busy events do not meet the active transition buffer.",
        }),
      );
    }
  }

  if (findingBudgetExceeded) {
    sourceFreshness = sourceFreshness.map((source) => ({
      ...source,
      completeness: "partial" as const,
      reason: "Calendar findings exceeded the bounded assessment budget.",
    }));
  }
  const missingSource = sourceFreshness.length === 0;
  const completeEvidence = !missingSource && sourceFreshness.every(
    (source) => source.state === "current" && source.completeness === "complete",
  );
  const unavailable = sourceFreshness.some((source) => source.state === "unavailable");
  const degraded = missingSource || sourceFreshness.some(
    (source) => source.state !== "current" || source.completeness !== "complete",
  );
  const sourceEvidenceFingerprints = findings
    .filter(
      (finding) =>
        finding.kind === "source_stale" ||
        finding.kind === "source_unavailable" ||
        finding.kind === "recurrence_unassessed",
    )
    .map((finding) => finding.fingerprint);
  const overlaps = findings.filter((finding) => finding.kind === "event_overlap");
  const bufferShortfalls = findings.filter((finding) => finding.kind === "buffer_shortfall");
  const health: CalendarAssessmentDraft["health"] = [
    {
      dimension: "source_trust",
      evidenceFindingFingerprints: sourceEvidenceFingerprints,
      signal: missingSource ? "unknown" : unavailable ? "strained" : degraded ? "attention" : "healthy",
      summary: missingSource
        ? "No selected Calendar source is available to assess."
        : unavailable
        ? "Required calendar evidence is unavailable."
        : degraded
          ? "Required calendar evidence is not fully current and complete."
          : "All selected calendar sources are current and complete.",
    },
    {
      dimension: "hard_conflicts",
      evidenceFindingFingerprints: overlaps.map((finding) => finding.fingerprint),
      signal: overlaps.length > 0 ? "strained" : completeEvidence ? "healthy" : "unknown",
      summary:
        overlaps.length > 0
          ? "Direct timed busy-event conflicts were found."
          : completeEvidence
            ? "No direct timed busy-event conflicts were found."
            : "Conflict coverage is incomplete because required evidence is not settled.",
    },
    {
      dimension: "buffer_and_travel",
      evidenceFindingFingerprints: bufferShortfalls.map((finding) => finding.fingerprint),
      signal: bufferShortfalls.length > 0 ? "attention" : "unknown",
      summary:
        bufferShortfalls.length > 0
          ? "Some adjacent timed busy events fall short of the active transition buffer."
          : "Travel feasibility is not calculated in this release.",
    },
    ...RELEASE_UNKNOWN_DIMENSIONS.map((dimension) => ({
      dimension,
      evidenceFindingFingerprints: [],
      signal: "unknown" as const,
      summary: "This health dimension is not calculated in release 1.0.0.",
    })),
  ];

  const findingsWithCutoff = findings.map((finding) => ({
    ...finding,
    evidenceCutoff: snapshot.evidenceCutoff.toISOString(),
  }));
  return {
    evidenceLimited: inputEvidenceLimited || findingBudgetExceeded,
    findings: findingsWithCutoff,
    health,
    recommendations: findings.map((finding) => recommendationFor(finding, snapshot)),
    rulebookVersion: rulebook,
    sourceFreshness,
    state: degraded ? "blocked" : findings.length > 0 ? "maintained_with_questions" : "maintained",
  };
}
