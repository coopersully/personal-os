import {
  calendarAccounts,
  calendarEvents,
  calendarFindings,
  calendarReviews,
  calendars,
  type Database,
  domainProfiles,
} from "@personal-os/database";
import * as databaseSchema from "@personal-os/database/schema";
import {
  type CalendarFinding,
  type CalendarHealthAssessment,
  type CalendarRecommendation,
  type CalendarReview,
  type CalendarStatus,
  type CreateCalendarReviewInput,
  calendarFindingSchema,
  calendarReviewSchema,
  calendarStatusSchema,
} from "@personal-os/domain";
import { and, desc, eq, gt, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  assessCalendar,
  CALENDAR_ASSESSMENT_BUDGETS,
  type CalendarAssessmentDraft,
  type CalendarAssessmentSnapshot,
  calendarLedgerFingerprint,
} from "./calendar-assessment.js";
import { CALENDAR_PLAYBOOK } from "./calendar-playbook.js";
import { AppError } from "./errors.js";

type CalendarStewardshipServiceOptions = { db: Database; now: () => Date };
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DatabaseExecutor = Pick<Database, "select">;
type FindingIdentity = Pick<CalendarFinding, "fingerprint" | "id">;

const DAY_MS = 24 * 60 * 60_000;

function parseBufferMinutes(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_440 ? parsed : null;
}

function findingFromRow(row: typeof calendarFindings.$inferSelect): CalendarFinding {
  return calendarFindingSchema.parse({
    evidence: row.evidence,
    evidenceCutoff: row.evidenceCutoff.toISOString(),
    fingerprint: row.fingerprint,
    firstObservedAt: row.firstObservedAt.toISOString(),
    id: row.id,
    kind: row.kind,
    lastObservedAt: row.lastObservedAt.toISOString(),
    playbookVersion: row.playbookVersion,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    rulebookVersion: row.rulebookVersion,
    severity: row.severity,
    sourceReferences: row.sourceReferences,
    status: row.status,
    summary: row.summary,
  });
}

function reviewFromRow(row: typeof calendarReviews.$inferSelect): CalendarReview {
  return calendarReviewSchema.parse({
    createdAt: row.createdAt.toISOString(),
    evidenceCutoff: row.evidenceCutoff.toISOString(),
    findings: row.findingSnapshots,
    health: row.health,
    id: row.id,
    ledgerFingerprint: row.ledgerFingerprint,
    nextMaintenanceAt: row.nextMaintenanceAt.toISOString(),
    playbookVersion: row.playbookVersion,
    profileVersion: row.profileVersion,
    recommendations: row.recommendations,
    rulebookVersion: row.rulebookVersion,
    scope: row.scope,
    scopeEnd: row.scopeEnd.toISOString(),
    scopeStart: row.scopeStart.toISOString(),
    sourceFreshness: row.sourceFreshness,
    state: row.state,
  });
}

async function readAssessmentSnapshot(
  executor: DatabaseExecutor,
  userId: string,
  scope: CreateCalendarReviewInput["scope"],
  evidenceCutoff: Date,
): Promise<CalendarAssessmentSnapshot> {
  const scopeStart = new Date(
    evidenceCutoff.getTime() - CALENDAR_PLAYBOOK.allOutstanding.pastDays * DAY_MS,
  );
  const scopeEnd = new Date(
    evidenceCutoff.getTime() + CALENDAR_PLAYBOOK.allOutstanding.futureDays * DAY_MS,
  );
  const sourceRows = await executor
    .select({
      accountId: calendarAccounts.id,
      accountLastSyncedAt: calendarAccounts.lastSyncedAt,
      calendarId: calendars.id,
      calendarLastSyncedAt: calendars.lastSyncedAt,
      calendarUpdatedAt: calendars.updatedAt,
      isWritable: calendars.isWritable,
      provider: calendars.provider,
      remoteCalendarId: calendars.remoteCalendarId,
      syncGeneration: calendarAccounts.syncGeneration,
      syncRecovery: calendarAccounts.syncRecovery,
      syncStatus: calendarAccounts.syncStatus,
    })
    .from(calendars)
    .innerJoin(
      calendarAccounts,
      and(
        eq(calendarAccounts.id, calendars.accountId),
        eq(calendarAccounts.userId, userId),
        eq(calendarAccounts.calendarEnabled, true),
      ),
    )
    .where(
      and(
        eq(calendars.userId, userId),
        eq(calendars.isSelected, true),
        isNull(calendars.deletedAt),
      ),
    )
    .orderBy(calendars.id);

  const calendarIds = sourceRows.map(({ calendarId }) => calendarId);
  const recurrencePresent = sql<boolean>`case
    when jsonb_typeof(${calendarEvents.recurrence}) = 'array'
    then jsonb_array_length(${calendarEvents.recurrence}) > 0
    else true
  end`;
  const queriedEventRows =
    calendarIds.length === 0
      ? []
      : await executor
          .select({
            allDay: calendarEvents.allDay,
            blockSourceEventId: calendarEvents.blockSourceEventId,
            calendarId: calendarEvents.calendarId,
            endsAt: calendarEvents.endsAt,
            id: calendarEvents.id,
            provider: calendarEvents.provider,
            recurrencePresent,
            remoteEtag: calendarEvents.remoteEtag,
            remoteEventId: calendarEvents.remoteEventId,
            startsAt: calendarEvents.startsAt,
            status: calendarEvents.status,
            transparency: calendarEvents.transparency,
            updatedAt: calendarEvents.updatedAt,
          })
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.userId, userId),
              inArray(calendarEvents.calendarId, calendarIds),
              isNull(calendarEvents.deletedAt),
              or(
                and(lt(calendarEvents.startsAt, scopeEnd), gt(calendarEvents.endsAt, scopeStart)),
                recurrencePresent,
              ),
            ),
          )
          .orderBy(calendarEvents.id)
          .limit(CALENDAR_ASSESSMENT_BUDGETS.events + 1);
  const eventBudgetExceeded = queriedEventRows.length > CALENDAR_ASSESSMENT_BUDGETS.events;
  const eventRows = queriedEventRows.slice(0, CALENDAR_ASSESSMENT_BUDGETS.events);

  const queriedOpenFindings = await executor
    .select()
    .from(calendarFindings)
    .where(and(eq(calendarFindings.userId, userId), eq(calendarFindings.status, "open")))
    .orderBy(calendarFindings.fingerprint)
    .limit(CALENDAR_ASSESSMENT_BUDGETS.findings + 1);
  const openFindingBudgetExceeded =
    queriedOpenFindings.length > CALENDAR_ASSESSMENT_BUDGETS.findings;
  const existingOpenFindings = queriedOpenFindings.slice(0, CALENDAR_ASSESSMENT_BUDGETS.findings);
  const [openFindingLedgerRow] = await executor
    .select({
      count: sql<number>`count(*)::integer`,
      fingerprint: sql<string>`md5(coalesce(string_agg(${calendarFindings.fingerprint} || ':' || ${calendarFindings.kind} || ':' || ${calendarFindings.id}, '|' order by ${calendarFindings.fingerprint}, ${calendarFindings.id}), ''))`,
      unsupportedCount: sql<number>`count(*) filter (where ${notInArray(calendarFindings.kind, [
        ...CALENDAR_PLAYBOOK.supportedFindingKinds,
      ])})::integer`,
    })
    .from(calendarFindings)
    .where(and(eq(calendarFindings.userId, userId), eq(calendarFindings.status, "open")));

  const [profileRow] = await executor
    .select({
      afterBufferMinutes: sql<string | null>`case
        when jsonb_typeof(${domainProfiles.preferences} -> 'afterBufferMinutes') = 'number'
        then ${domainProfiles.preferences} ->> 'afterBufferMinutes'
        else null
      end`,
      beforeBufferMinutes: sql<string | null>`case
        when jsonb_typeof(${domainProfiles.preferences} -> 'beforeBufferMinutes') = 'number'
        then ${domainProfiles.preferences} ->> 'beforeBufferMinutes'
        else null
      end`,
      id: domainProfiles.id,
      version: domainProfiles.version,
    })
    .from(domainProfiles)
    .where(
      and(
        eq(domainProfiles.userId, userId),
        eq(domainProfiles.domain, "calendar"),
        eq(domainProfiles.status, "active"),
      ),
    )
    .limit(1);
  const recurrenceCalendarIds = new Set(
    eventRows
      .filter(({ recurrencePresent }) => recurrencePresent)
      .map(({ calendarId }) => calendarId),
  );
  const afterBufferMinutes = parseBufferMinutes(profileRow?.afterBufferMinutes ?? null);
  const beforeBufferMinutes = parseBufferMinutes(profileRow?.beforeBufferMinutes ?? null);
  const activeProfile =
    profileRow && afterBufferMinutes !== null && beforeBufferMinutes !== null
      ? {
          afterBufferMinutes,
          beforeBufferMinutes,
          id: profileRow.id,
          version: profileRow.version,
        }
      : null;

  return {
    activeProfile,
    evidenceCutoff,
    evidenceLimits: { eventBudgetExceeded, openFindingBudgetExceeded },
    events: eventRows.map((event) => ({
      allDay: event.allDay,
      blockSourceEventId: event.blockSourceEventId,
      calendarId: event.calendarId,
      endsAt: event.endsAt.toISOString(),
      id: event.id,
      provider: event.provider,
      recurrence: event.recurrencePresent ? ["RECURRENCE_PRESENT"] : [],
      remoteEventId: event.remoteEventId,
      revision:
        event.remoteEtag && event.remoteEtag.trim().length > 0
          ? event.remoteEtag
          : event.updatedAt.toISOString(),
      startsAt: event.startsAt.toISOString(),
      status: event.status,
      transparency: event.transparency,
      updatedAt: event.updatedAt.toISOString(),
    })),
    existingOpenFindings: existingOpenFindings.map(({ fingerprint, id, kind }) => ({
      fingerprint,
      id,
      kind,
    })),
    existingOpenFindingSnapshots: existingOpenFindings
      .filter(({ kind }) => CALENDAR_PLAYBOOK.supportedFindingKinds.includes(kind))
      .map(findingFromRow),
    openFindingLedger: {
      count: openFindingLedgerRow?.count ?? 0,
      fingerprint: openFindingLedgerRow?.fingerprint ?? "",
      unsupportedCount: openFindingLedgerRow?.unsupportedCount ?? 0,
    },
    scope,
    scopeEnd,
    scopeStart,
    sources: sourceRows.map((source) => ({
      accountId: source.accountId,
      calendarId: source.calendarId,
      calendarRevision: [
        source.calendarUpdatedAt.toISOString(),
        `generation=${source.syncGeneration}`,
        `status=${source.syncStatus}`,
        `recovery=${source.syncRecovery ?? "none"}`,
      ].join(";"),
      isWritable: source.isWritable,
      lastSyncedAt:
        (source.calendarLastSyncedAt ?? source.accountLastSyncedAt)?.toISOString() ?? null,
      provider: source.provider,
      recurrencePresent: recurrenceCalendarIds.has(source.calendarId),
      remoteCalendarId: source.remoteCalendarId,
      syncGeneration: source.syncGeneration,
      syncRecovery: source.syncRecovery,
      syncStatus: source.syncStatus,
    })),
  };
}

async function reconcileFindings(
  transaction: DatabaseTransaction,
  userId: string,
  snapshot: CalendarAssessmentSnapshot,
  draft: CalendarAssessmentDraft,
): Promise<CalendarFinding[]> {
  const observedAt = snapshot.evidenceCutoff;
  const findings: CalendarFinding[] = [];
  for (const finding of draft.findings) {
    const [row] = await transaction
      .insert(calendarFindings)
      .values({
        evidence: finding.evidence,
        evidenceCutoff: new Date(finding.evidenceCutoff),
        fingerprint: finding.fingerprint,
        firstObservedAt: observedAt,
        kind: finding.kind,
        lastObservedAt: observedAt,
        playbookVersion: finding.playbookVersion,
        resolvedAt: null,
        rulebookVersion: finding.rulebookVersion,
        severity: finding.severity,
        sourceReferences: finding.sourceReferences,
        status: "open",
        summary: finding.summary,
        updatedAt: observedAt,
        userId,
      })
      .onConflictDoUpdate({
        target: [calendarFindings.userId, calendarFindings.fingerprint],
        set: {
          evidence: finding.evidence,
          evidenceCutoff: new Date(finding.evidenceCutoff),
          kind: finding.kind,
          lastObservedAt: observedAt,
          playbookVersion: finding.playbookVersion,
          resolvedAt: null,
          rulebookVersion: finding.rulebookVersion,
          severity: finding.severity,
          sourceReferences: finding.sourceReferences,
          status: "open",
          summary: finding.summary,
          updatedAt: observedAt,
        },
      })
      .returning();
    if (!row) {
      throw new AppError("internal_error", "The Calendar finding could not be published.");
    }
    findings.push(findingFromRow(row));
  }

  const currentFingerprints = draft.findings.map(({ fingerprint }) => fingerprint);
  if (draft.findingResolutionSafe) {
    await transaction
      .update(calendarFindings)
      .set({ resolvedAt: observedAt, status: "resolved", updatedAt: observedAt })
      .where(
        and(
          eq(calendarFindings.userId, userId),
          eq(calendarFindings.status, "open"),
          inArray(calendarFindings.kind, [...CALENDAR_PLAYBOOK.supportedFindingKinds]),
          ...(currentFingerprints.length > 0
            ? [notInArray(calendarFindings.fingerprint, currentFingerprints)]
            : []),
        ),
      );
  }
  return findings;
}

function bindFindingIds(
  health: CalendarAssessmentDraft["health"],
  findings: ReadonlyArray<FindingIdentity>,
): CalendarHealthAssessment[] {
  const ids = new Map(findings.map(({ fingerprint, id }) => [fingerprint, id]));
  return health.map(({ evidenceFindingFingerprints, ...assessment }) => ({
    ...assessment,
    evidenceFindingIds: evidenceFindingFingerprints.flatMap((fingerprint) => {
      const id = ids.get(fingerprint);
      return id ? [id] : [];
    }),
  }));
}

function bindRecommendationFindingIds(
  recommendations: CalendarAssessmentDraft["recommendations"],
  findings: ReadonlyArray<FindingIdentity>,
): CalendarRecommendation[] {
  const ids = new Map(findings.map(({ fingerprint, id }) => [fingerprint, id]));
  return recommendations.map(({ findingFingerprints, ...recommendation }) => ({
    ...recommendation,
    findingIds: findingFingerprints.flatMap((fingerprint) => {
      const id = ids.get(fingerprint);
      return id ? [id] : [];
    }),
  }));
}

function mergeBoundedFindings(
  observed: CalendarFinding[],
  preserved: CalendarFinding[],
): CalendarFinding[] {
  const merged = new Map<string, CalendarFinding>();
  for (const finding of observed) merged.set(finding.fingerprint, finding);
  for (const finding of preserved) {
    if (merged.size >= CALENDAR_ASSESSMENT_BUDGETS.findings) break;
    if (!merged.has(finding.fingerprint)) merged.set(finding.fingerprint, finding);
  }
  return [...merged.values()];
}

async function insertReview(
  transaction: DatabaseTransaction,
  input: {
    draft: CalendarAssessmentDraft;
    findings: CalendarFinding[];
    health: CalendarHealthAssessment[];
    ledgerFingerprint: string;
    nextMaintenanceAt: Date;
    profileVersion: number | null;
    recommendations: CalendarRecommendation[];
    snapshot: CalendarAssessmentSnapshot;
    userId: string;
  },
): Promise<CalendarReview> {
  const [row] = await transaction
    .insert(calendarReviews)
    .values({
      evidenceCutoff: input.snapshot.evidenceCutoff,
      findingSnapshots: input.findings,
      health: input.health,
      ledgerFingerprint: input.ledgerFingerprint,
      nextMaintenanceAt: input.nextMaintenanceAt,
      playbookVersion: CALENDAR_PLAYBOOK.version,
      profileVersion: input.profileVersion,
      recommendations: input.recommendations,
      rulebookVersion: input.draft.rulebookVersion,
      scope: input.snapshot.scope,
      scopeEnd: input.snapshot.scopeEnd,
      scopeStart: input.snapshot.scopeStart,
      sourceFreshness: input.draft.sourceFreshness,
      state: input.draft.state,
      userId: input.userId,
    })
    .returning();
  if (!row) throw new AppError("internal_error", "The Calendar review could not be published.");
  return reviewFromRow(row);
}

async function readLatestReview(
  executor: DatabaseExecutor,
  userId: string,
): Promise<CalendarReview | null> {
  const [row] = await executor
    .select()
    .from(calendarReviews)
    .where(eq(calendarReviews.userId, userId))
    .orderBy(desc(calendarReviews.createdAt), desc(calendarReviews.id))
    .limit(1);
  return row ? reviewFromRow(row) : null;
}

async function readReusableReview(
  executor: DatabaseExecutor,
  userId: string,
  ledgerFingerprint: string,
  evidenceCutoff: Date,
): Promise<CalendarReview | null> {
  const [row] = await executor
    .select()
    .from(calendarReviews)
    .where(
      and(
        eq(calendarReviews.userId, userId),
        eq(calendarReviews.ledgerFingerprint, ledgerFingerprint),
        gt(calendarReviews.nextMaintenanceAt, evidenceCutoff),
      ),
    )
    .orderBy(desc(calendarReviews.createdAt), desc(calendarReviews.id))
    .limit(1);
  return row ? reviewFromRow(row) : null;
}

function nextAssessmentTransition(
  snapshot: CalendarAssessmentSnapshot,
  evidenceCutoff: Date,
): Date {
  const transitions = [
    evidenceCutoff.getTime() + CALENDAR_PLAYBOOK.sourceFreshnessMinutes * 60_000,
  ];
  for (const source of snapshot.sources) {
    if (
      source.provider === "local" ||
      source.syncStatus !== "idle" ||
      source.syncRecovery !== null ||
      source.lastSyncedAt === null
    ) {
      continue;
    }
    const lastSyncedAt = new Date(source.lastSyncedAt).getTime();
    const transition = lastSyncedAt + CALENDAR_PLAYBOOK.sourceFreshnessMinutes * 60_000 + 1;
    if (Number.isFinite(transition) && transition > evidenceCutoff.getTime()) {
      transitions.push(transition);
    }
  }
  for (const event of snapshot.events) {
    if (event.status !== "tentative") continue;
    const startsAt = new Date(event.startsAt).getTime();
    if (!Number.isFinite(startsAt) || startsAt <= evidenceCutoff.getTime()) continue;
    const holdAgeTransition =
      new Date(event.updatedAt).getTime() + CALENDAR_PLAYBOOK.tentativeHoldAgeDays * DAY_MS;
    transitions.push(
      Number.isFinite(holdAgeTransition) && holdAgeTransition > evidenceCutoff.getTime()
        ? Math.min(holdAgeTransition, startsAt)
        : startsAt,
    );
  }
  return new Date(Math.min(...transitions));
}

function buildStatus(input: {
  asOf: Date;
  assessment: CalendarAssessmentDraft;
  latestReview: CalendarReview | null;
  lifecycle: CalendarStatus["lifecycle"];
  snapshot: CalendarAssessmentSnapshot;
}): CalendarStatus {
  const degradedSources = input.assessment.sourceFreshness.filter(
    ({ completeness, state }) => state !== "current" || completeness !== "complete",
  );
  const missingSource = input.snapshot.sources.length === 0;
  const missingProfile = input.snapshot.activeProfile === null;
  const evidenceSettled =
    !missingSource &&
    !missingProfile &&
    !input.assessment.evidenceLimited &&
    input.assessment.unsupportedOpenFindingCount === 0 &&
    degradedSources.length === 0;
  const readiness =
    missingSource || missingProfile
      ? "setup_required"
      : degradedSources.length > 0 || input.assessment.unsupportedOpenFindingCount > 0
        ? "degraded"
        : "ready";
  const setupBlockers = [
    ...(missingSource
      ? ["Select at least one enabled Calendar source before relying on stewardship assessments."]
      : []),
    ...(missingProfile
      ? ["Activate a Calendar profile before relying on stewardship assessments."]
      : []),
  ];
  const validNextOperations: CalendarStatus["validNextOperations"] = ["assess_calendar"];
  if (input.snapshot.sources.some(({ syncRecovery }) => syncRecovery === "reconnect")) {
    validNextOperations.push("open_connections");
  }
  if ((input.assessment.projectedOpenFindingCount ?? input.snapshot.openFindingLedger.count) > 0) {
    validNextOperations.push("review_findings");
  }
  const health = bindFindingIds(input.assessment.health, input.snapshot.existingOpenFindings).map(
    (assessment): CalendarHealthAssessment => {
      if (!missingSource) return assessment;
      if (assessment.dimension === "source_trust") {
        return {
          ...assessment,
          evidenceFindingIds: [],
          signal: "unknown",
          summary: "No selected Calendar source is available to assess.",
        };
      }
      if (assessment.dimension === "hard_conflicts") {
        return {
          ...assessment,
          evidenceFindingIds: [],
          signal: "unknown",
          summary: "Conflict coverage is unavailable because no Calendar source is selected.",
        };
      }
      return assessment;
    },
  );

  return {
    asOf: input.asOf.toISOString(),
    authority: {
      approvedRule: [],
      automatic: ["inspect", "assess"],
      individualApproval: [
        "create_event",
        "move_event",
        "resize_event",
        "trash_event",
        "restore_event",
      ],
      unavailable: [
        "rsvp",
        "invite",
        "cancel_attended_event",
        "book_travel",
        "send_correspondence",
      ],
    },
    backlog: {
      actionable: evidenceSettled ? input.assessment.findings.length : null,
      ambiguousEffects: null,
      awaitingApproval: null,
      awaitingInput: null,
      blocked:
        degradedSources.length +
        (missingSource ? 1 : 0) +
        (missingProfile ? 1 : 0) +
        input.assessment.unsupportedOpenFindingCount,
      failed: null,
      openFindings: input.assessment.projectedOpenFindingCount,
    },
    health,
    latestReview: input.latestReview,
    lifecycle: input.lifecycle,
    readiness,
    setupBlockers,
    sources: input.assessment.sourceFreshness,
    validNextOperations,
  };
}

export function createCalendarStewardshipService({ db, now }: CalendarStewardshipServiceOptions) {
  return {
    async createReview(userId: string, input: CreateCalendarReviewInput): Promise<CalendarReview> {
      if (input.scope.type !== "all_outstanding") {
        throw new AppError(
          "invalid_request",
          "This Calendar release supports all-outstanding reviews only.",
        );
      }
      const pool = (db as Database & { $client: Pool }).$client;
      const client = await pool.connect();
      let locked = false;
      try {
        const lockResult = await client.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtextextended('calendar:' || $1, 0)) as locked",
          [userId],
        );
        if (!lockResult.rows[0]?.locked) {
          throw new AppError(
            "conflict",
            "A Calendar review is already being published. Try again shortly.",
          );
        }
        locked = true;
        const clientDatabase = drizzle(client, { schema: databaseSchema });
        return await clientDatabase.transaction(
          async (transaction) => {
            const evidenceCutoff = now();
            const snapshot = await readAssessmentSnapshot(
              transaction,
              userId,
              input.scope,
              evidenceCutoff,
            );
            const draft = assessCalendar(snapshot);
            const ledgerFingerprint = calendarLedgerFingerprint(snapshot, draft);
            const reusable = await readReusableReview(
              transaction,
              userId,
              ledgerFingerprint,
              evidenceCutoff,
            );
            if (reusable) return reusable;
            const observedFindings =
              snapshot.sources.length === 0
                ? []
                : await reconcileFindings(transaction, userId, snapshot, draft);
            const findings = draft.evidenceLimited
              ? mergeBoundedFindings(observedFindings, snapshot.existingOpenFindingSnapshots)
              : observedFindings;
            const health = bindFindingIds(draft.health, findings);
            const recommendations = bindRecommendationFindingIds(draft.recommendations, findings);
            return insertReview(transaction, {
              draft,
              findings,
              health,
              ledgerFingerprint,
              nextMaintenanceAt: nextAssessmentTransition(snapshot, evidenceCutoff),
              profileVersion: snapshot.activeProfile?.version ?? null,
              recommendations,
              snapshot,
              userId,
            });
          },
          { isolationLevel: "repeatable read" },
        );
      } finally {
        if (!locked) {
          client.release();
        } else {
          try {
            await client.query(
              "select pg_advisory_unlock(hashtextextended('calendar:' || $1, 0))",
              [userId],
            );
            client.release();
          } catch (error) {
            const releaseError =
              error instanceof Error
                ? error
                : new Error("The Calendar publication lock could not be released.", {
                    cause: error,
                  });
            try {
              client.release(releaseError);
            } catch {
              // Preserve the unlock failure after requesting connection eviction.
            }
          }
        }
      }
    },

    async getStatus(userId: string): Promise<CalendarStatus> {
      const asOf = now();
      return db.transaction(
        async (transaction) => {
          const latestReview = await readLatestReview(transaction, userId);
          const scope = latestReview?.scope ?? ({ type: "all_outstanding" } as const);
          const cutoff = latestReview ? new Date(latestReview.evidenceCutoff) : asOf;
          const snapshot = await readAssessmentSnapshot(transaction, userId, scope, cutoff);
          const assessment = assessCalendar({ ...snapshot, evidenceCutoff: asOf });
          const fingerprintChanged =
            latestReview !== null &&
            latestReview.ledgerFingerprint !== calendarLedgerFingerprint(snapshot);
          const expired =
            latestReview !== null &&
            asOf.getTime() >= new Date(latestReview.nextMaintenanceAt).getTime();
          const lifecycle: CalendarStatus["lifecycle"] =
            latestReview === null
              ? "never_maintained"
              : fingerprintChanged || expired
                ? "stale"
                : latestReview.state;
          return calendarStatusSchema.parse(
            buildStatus({ asOf, assessment, latestReview, lifecycle, snapshot }),
          );
        },
        { accessMode: "read only", isolationLevel: "repeatable read" },
      );
    },
  };
}
