import {
  attentionItems,
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  type Database,
  domainProfiles,
} from "@personal-os/database";
import type {
  AttentionItem,
  Calendar,
  CalendarCommitmentProposal,
  CalendarEvent,
  CalendarEventBlock,
  CalendarEventMutationRevision,
  CreateEventBlockInput,
  CreateEventInput,
  CreateLocalCalendarInput,
  DeleteEventBlockInput,
  DeleteEventInput,
  EventBlockMode,
  EventListQuery,
  ParsedPreviewCalendarCommitmentInput,
  RestoreEventInput,
  UpdateEventBlockInput,
  UpdateEventInput,
  UpdateLocalCalendarInput,
  UpsertCalendarAttentionItemInput,
} from "@personal-os/domain";
import { calendarProfilePreferencesSchema, idSchema } from "@personal-os/domain";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { auditValues } from "./audit.js";
import { invalidateCalendarProfileSources } from "./calendar-profile.js";
import { buildCalendarCommitmentProposal } from "./calendar-proposal.js";
import {
  type CalendarProviderEffect,
  createCalendarProviderEffectLedger,
} from "./calendar-provider-effects.js";
import type { ConnectedEventGateway } from "./connector-service.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { connectionHealthForAccount } from "./connector-sync-health.js";
import { auditSnapshot, serializeCalendar, serializeEvent } from "./serialization.js";
import type { Principal } from "./types.js";

type MutationContext = {
  principal: Principal;
  requestId: string;
};

type CalendarServiceOptions = {
  connectedEvents: ConnectedEventGateway;
  db: Database;
  now: () => Date;
  observeProviderFailure?: (entry: CalendarProviderFailureObservation) => void;
};

export type CalendarProviderFailureObservation = {
  actorId: string;
  actorType: Principal["actorType"];
  code: AppError["code"];
  details: unknown;
  message: string;
  operation: string;
  requestId: string;
  status: AppError["status"];
  userId: string;
};

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type CalendarProfileSourceExecutor = Pick<Database, "select">;
type CalendarRecord = typeof calendars.$inferSelect;
type CalendarAccountRecord = typeof calendarAccounts.$inferSelect;
type CalendarEventRecord = typeof calendarEvents.$inferSelect;
type ConnectedEvent = Awaited<ReturnType<ConnectedEventGateway["update"]>>;
type CalendarEventAttendee = NonNullable<CalendarEventRecord["attendees"]>[number];

function normalizeAttendees(
  attendees:
    | Array<{
        email: string;
        isOrganizer?: boolean | undefined;
        name?: string | null | undefined;
        response?: "accepted" | "declined" | "needs_action" | "tentative" | undefined;
      }>
    | undefined,
): CalendarEventAttendee[] {
  return (attendees ?? []).map((attendee) => ({
    email: attendee.email,
    isOrganizer: attendee.isOrganizer ?? false,
    name: attendee.name ?? null,
    response: attendee.response ?? "needs_action",
  }));
}

function deduplicateCalendars(records: CalendarRecord[]): CalendarRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = record.remoteCalendarId
      ? `${record.provider}:${record.remoteCalendarId}`
      : record.id;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function deduplicateEvents(records: CalendarEventRecord[]): CalendarEventRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = record.remoteEventId
      ? `${record.provider}:${record.calendarId}:${record.remoteEventId}`
      : record.id;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function blockInput(
  source: CalendarEventRecord,
  calendarId: string,
  mode: EventBlockMode,
): CreateEventInput {
  return {
    allDay: source.allDay,
    calendarId,
    endsAt: source.endsAt.toISOString(),
    location: mode === "details" ? source.location : null,
    notes: mode === "details" ? source.notes : null,
    startsAt: source.startsAt.toISOString(),
    timezone: source.timezone,
    title: mode === "details" ? source.title : "Busy",
  };
}

function connectedEventValues(remote: ConnectedEvent, timestamp: Date) {
  return {
    allDay: remote.allDay,
    conferenceUrl: remote.conferenceUrl,
    endsAt: remote.endsAt,
    location: remote.location,
    notes: remote.notes,
    raw: remote.raw,
    recurrence: remote.recurrence,
    remoteEtag: remote.etag,
    remoteEventId: remote.remoteEventId,
    startsAt: remote.startsAt,
    status: remote.status,
    syncedAt: timestamp,
    timezone: remote.timezone,
    title: remote.title,
  };
}

function eventBlock(record: CalendarEventRecord): CalendarEventBlock {
  return {
    calendarId: record.calendarId,
    eventId: record.id,
    mode: record.blockMode as EventBlockMode,
    provider: record.provider,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function eventRevisionWhere(record: CalendarEventRecord, deleted: boolean) {
  return and(
    eq(calendarEvents.id, record.id),
    eq(calendarEvents.userId, record.userId),
    sql`date_trunc('milliseconds', ${calendarEvents.updatedAt}) = ${record.updatedAt}`,
    deleted ? isNotNull(calendarEvents.deletedAt) : isNull(calendarEvents.deletedAt),
    record.remoteEtag === null
      ? isNull(calendarEvents.remoteEtag)
      : eq(calendarEvents.remoteEtag, record.remoteEtag),
  );
}

function assertExpectedUpdatedAt(
  record: CalendarEventRecord,
  expectedUpdatedAt: string | undefined,
): void {
  if (expectedUpdatedAt && record.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new AppError("conflict", "The calendar event changed since it was loaded.", {
      currentUpdatedAt: record.updatedAt.toISOString(),
      eventId: record.id,
    });
  }
}

function assertExpectedBlockUpdatedAt(
  blocks: CalendarEventRecord[],
  expectedById: Record<string, string> | undefined,
): void {
  if (!expectedById) return;
  const currentById = Object.fromEntries(
    blocks.map((block) => [block.id, block.updatedAt.toISOString()]),
  );
  const expectedIds = Object.keys(expectedById).sort();
  const currentIds = Object.keys(currentById).sort();
  if (
    expectedIds.length !== currentIds.length ||
    expectedIds.some(
      (id, index) => id !== currentIds[index] || expectedById[id] !== currentById[id],
    )
  ) {
    throw new AppError("conflict", "The linked calendar blocks changed since they were loaded.", {
      currentBlockUpdatedAtById: currentById,
    });
  }
}

function requireAgentMutationRevisions(
  context: MutationContext,
  input: object,
  fields: string[],
): void {
  if (context.principal.actorType !== "agent") return;
  const values = input as Record<string, unknown>;
  const missingFields = fields.filter((field) => values[field] === undefined);
  if (missingFields.length > 0) {
    throw new AppError(
      "invalid_request",
      "Agent Calendar mutations require the current source and block revisions.",
      { missingFields },
    );
  }
}

function requireRevisionWrite<T>(record: T | undefined, eventId: string): T {
  if (!record) {
    throw new AppError(
      "conflict",
      "The calendar event changed while provider effects were being projected.",
      { eventId },
    );
  }
  return record;
}

function auditCalendarAttentionMetadata(
  value: typeof attentionItems.$inferSelect | null,
): Record<string, unknown> | null {
  if (!value) return null;
  return {
    domain: value.domain,
    importance: value.importance,
    kind: value.kind,
    relatedEntityType: value.relatedEntityType,
    status: value.status,
    version: value.version,
  };
}

function serializeCalendarAttentionItem(row: typeof attentionItems.$inferSelect): AttentionItem {
  return {
    createdAt: row.createdAt.toISOString(),
    domain: row.domain,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    id: row.id,
    importance: row.importance,
    kind: row.kind,
    occursAt: row.occursAt?.toISOString() ?? null,
    relatedEntityId: row.relatedEntityId,
    relatedEntityType: row.relatedEntityType,
    source: row.source,
    status: row.status,
    summary: row.summary,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

async function requireCurrentRevision(
  transaction: DatabaseTransaction,
  record: CalendarEventRecord,
  deleted: boolean,
): Promise<void> {
  const [current] = await transaction
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(eventRevisionWhere(record, deleted))
    .for("update")
    .limit(1);
  requireRevisionWrite(current, record.id);
}

async function requireCurrentBlockSet(
  transaction: DatabaseTransaction,
  source: CalendarEventRecord,
  expectedBlocks: CalendarEventRecord[],
  deleted: boolean,
): Promise<void> {
  const currentBlocks = await transaction
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, source.userId),
        eq(calendarEvents.blockSourceEventId, source.id),
        deleted ? isNotNull(calendarEvents.deletedAt) : isNull(calendarEvents.deletedAt),
      ),
    )
    .orderBy(asc(calendarEvents.createdAt), asc(calendarEvents.id))
    .for("update");
  assertExpectedBlockUpdatedAt(
    currentBlocks,
    Object.fromEntries(expectedBlocks.map((block) => [block.id, block.updatedAt.toISOString()])),
  );
}

function providerEffect(
  action: CalendarProviderEffect["action"],
  calendar: CalendarRecord,
  event: CalendarEventRecord | null,
  role: CalendarProviderEffect["role"],
): CalendarProviderEffect {
  if (calendar.provider === "local") {
    throw new AppError("internal_error", "Local Calendar changes are not provider effects.");
  }
  return {
    action,
    calendarId: calendar.id,
    eventId: event?.id ?? null,
    provider: calendar.provider,
    remoteEventId: action === "create" ? null : (event?.remoteEventId ?? null),
    role,
  };
}

function serializeCalendarSource(
  calendar: CalendarRecord,
  account: CalendarAccountRecord,
): Calendar {
  return {
    ...serializeCalendar(calendar),
    source: {
      accountLabel: account.label,
      health: connectionHealthForAccount(account),
      remoteCalendarId: calendar.remoteCalendarId,
      syncError: account.syncError
        ? "The connected account needs attention. Synchronize Calendar or review Connections."
        : null,
      syncStatus: account.syncStatus,
    },
  };
}

export function createCalendarService({
  connectedEvents,
  db,
  now,
  observeProviderFailure,
}: CalendarServiceOptions) {
  function providerLedger(
    operation: string,
    effects: CalendarProviderEffect[],
    context: MutationContext,
  ) {
    return createCalendarProviderEffectLedger(operation, effects, (error) =>
      observeProviderFailure?.({
        actorId: context.principal.actorId,
        actorType: context.principal.actorType,
        code: error.code,
        details: error.details,
        message: error.message,
        operation,
        requestId: context.requestId,
        status: error.status,
        userId: context.principal.userId,
      }),
    );
  }

  async function findCalendar(userId: string, id: string) {
    const [record] = await db
      .select()
      .from(calendars)
      .where(and(eq(calendars.id, id), eq(calendars.userId, userId), isNull(calendars.deletedAt)))
      .limit(1);
    if (!record) {
      throw new AppError("not_found", "The calendar was not found.");
    }
    return record;
  }

  async function findActiveEvent(userId: string, id: string) {
    const [record] = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.id, id),
          eq(calendarEvents.userId, userId),
          isNull(calendarEvents.deletedAt),
        ),
      )
      .limit(1);
    if (!record) {
      throw new AppError("not_found", "The calendar event was not found.");
    }
    return record;
  }

  async function findActiveBlocks(userId: string, sourceEventId: string) {
    return db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, userId),
          eq(calendarEvents.blockSourceEventId, sourceEventId),
          isNull(calendarEvents.deletedAt),
        ),
      )
      .orderBy(asc(calendarEvents.createdAt), asc(calendarEvents.id));
  }

  async function serializeWithBlocks(record: CalendarEventRecord): Promise<CalendarEvent> {
    const calendar = await findCalendar(record.userId, record.calendarId);
    if (record.blockSourceEventId) return serializeEvent(record, [], calendar.accountId);
    const blocks = await findActiveBlocks(record.userId, record.id);
    return serializeEvent(record, blocks.map(eventBlock), calendar.accountId);
  }

  function requireSourceEvent(event: CalendarEventRecord): void {
    if (event.blockSourceEventId) {
      throw new AppError(
        "conflict",
        "This busy block is managed by its source event. Change the source event instead.",
      );
    }
  }

  function requireWritable(calendar: typeof calendars.$inferSelect): void {
    if (!calendar.isWritable) {
      throw new AppError("forbidden", "This calendar is read-only.");
    }
  }

  function requireLocal(calendar: typeof calendars.$inferSelect): void {
    if (calendar.provider !== "local") {
      throw new AppError("forbidden", "Connected calendars are managed by their provider.");
    }
  }

  async function findCalendarAccount(accountId: string, userId: string) {
    const [account] = await db
      .select()
      .from(calendarAccounts)
      .where(and(eq(calendarAccounts.id, accountId), eq(calendarAccounts.userId, userId)))
      .limit(1);
    if (!account) {
      throw new AppError("not_found", "The calendar source account was not found.");
    }
    return account;
  }

  async function previewCommitment(
    userId: string,
    input: ParsedPreviewCalendarCommitmentInput,
  ): Promise<CalendarCommitmentProposal> {
    const destination = await findCalendar(userId, input.candidate.calendarId);
    const account = await findCalendarAccount(destination.accountId, userId);
    const [duplicate] = await db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, userId),
          eq(calendarEvents.calendarId, destination.id),
          eq(calendarEvents.title, input.candidate.title),
          eq(calendarEvents.startsAt, new Date(input.candidate.startsAt)),
          eq(calendarEvents.endsAt, new Date(input.candidate.endsAt)),
          isNull(calendarEvents.deletedAt),
        ),
      )
      .limit(1);
    const [profile] = await db
      .select()
      .from(domainProfiles)
      .where(
        and(
          eq(domainProfiles.userId, userId),
          eq(domainProfiles.domain, "calendar"),
          ...(input.profileId ? [eq(domainProfiles.id, input.profileId)] : []),
        ),
      )
      .limit(1);
    if (input.profileId && !profile) {
      throw new AppError("not_found", "The Calendar profile was not found.");
    }
    return buildCalendarCommitmentProposal(input, {
      destination: serializeCalendarSource(destination, account),
      evaluatedAt: now(),
      possibleDuplicateEventId: duplicate?.id ?? null,
      profile: profile
        ? {
            preferences: profile.preferences,
            status: profile.status,
            version: profile.version,
          }
        : null,
    });
  }

  const service = {
    async validateProfileSources(
      transaction: CalendarProfileSourceExecutor,
      userId: string,
      sourceIds: string[],
      status: "active" | "draft",
      preferences: Record<string, boolean | number | string | string[] | null>,
    ): Promise<void> {
      const uniqueSourceIds = [...new Set(sourceIds)];
      if (uniqueSourceIds.length !== sourceIds.length) {
        throw new AppError("invalid_request", "Calendar source contexts must be unique.");
      }
      if (sourceIds.some((sourceId) => !idSchema.safeParse(sourceId).success)) {
        throw new AppError(
          "invalid_request",
          "Calendar source contexts must use canonical Calendar IDs.",
        );
      }
      const parsedPreferences = calendarProfilePreferencesSchema.safeParse(preferences);
      if (status === "active" && !parsedPreferences.success) {
        throw new AppError(
          "invalid_request",
          "An active Calendar profile requires the complete Calendar preference contract.",
          { issues: parsedPreferences.error.issues },
        );
      }
      if (status === "active" && sourceIds.length === 0) {
        throw new AppError(
          "invalid_request",
          "An active Calendar profile requires at least one owned Calendar source context.",
        );
      }
      const defaultCalendarId = parsedPreferences.success
        ? parsedPreferences.data.defaultCalendarId
        : typeof preferences.defaultCalendarId === "string"
          ? preferences.defaultCalendarId
          : null;
      if (defaultCalendarId && !idSchema.safeParse(defaultCalendarId).success) {
        throw new AppError(
          "invalid_request",
          "The default Calendar destination must use a canonical Calendar ID.",
        );
      }
      const calendarIds = [
        ...new Set([...uniqueSourceIds, ...(defaultCalendarId ? [defaultCalendarId] : [])]),
      ];
      const ownedCalendars =
        calendarIds.length > 0
          ? await transaction
              .select({ id: calendars.id, isWritable: calendars.isWritable })
              .from(calendars)
              .where(
                and(
                  eq(calendars.userId, userId),
                  inArray(calendars.id, calendarIds),
                  isNull(calendars.deletedAt),
                ),
              )
              .orderBy(calendars.id)
              .for("update")
          : [];
      const byId = new Map(ownedCalendars.map((calendar) => [calendar.id, calendar]));
      const unknownSourceId = uniqueSourceIds.find((sourceId) => !byId.has(sourceId));
      if (unknownSourceId) {
        throw new AppError(
          "invalid_request",
          "Calendar source contexts must reference calendars owned by this user.",
          { sourceId: unknownSourceId },
        );
      }
      if (defaultCalendarId) {
        const destination = byId.get(defaultCalendarId);
        if (!destination) {
          throw new AppError(
            "invalid_request",
            "The default Calendar destination must belong to this user.",
          );
        }
        if (!destination.isWritable) {
          throw new AppError(
            "invalid_request",
            "The default Calendar destination must be writable.",
          );
        }
        if (status === "active" && !sourceIds.includes(defaultCalendarId)) {
          throw new AppError(
            "invalid_request",
            "The default Calendar destination must have a source context in the active profile.",
          );
        }
      }
    },

    async createEvent(input: CreateEventInput, context: MutationContext): Promise<CalendarEvent> {
      const calendar = await findCalendar(context.principal.userId, input.calendarId);
      requireWritable(calendar);
      const effect =
        calendar.provider === "local" ? null : providerEffect("create", calendar, null, "source");
      const ledger = providerLedger("create_event", effect ? [effect] : [], context);
      const remote =
        effect === null
          ? null
          : await ledger.run(effect, () => connectedEvents.create(calendar, input));
      const record = await ledger.commit(() =>
        db.transaction(async (transaction) => {
          const created = requireDatabaseRecord(
            (
              await transaction
                .insert(calendarEvents)
                .values({
                  allDay: remote?.allDay ?? input.allDay,
                  attendees: normalizeAttendees(input.attendees),
                  calendarId: calendar.id,
                  conferenceUrl: remote?.conferenceUrl ?? null,
                  endsAt: remote?.endsAt ?? new Date(input.endsAt),
                  eventType: input.eventType ?? "default",
                  location: remote?.location ?? input.location,
                  notes: remote?.notes ?? input.notes,
                  provider: calendar.provider,
                  raw: remote?.raw,
                  recurrence: remote?.recurrence ?? [],
                  reminders: input.reminders ?? [],
                  remoteEtag: remote?.etag,
                  remoteEventId: remote?.remoteEventId,
                  startsAt: remote?.startsAt ?? new Date(input.startsAt),
                  status: remote?.status ?? "confirmed",
                  syncedAt: remote ? now() : null,
                  timezone: remote?.timezone ?? input.timezone,
                  title: remote?.title ?? input.title,
                  transparency: input.transparency ?? "busy",
                  userId: context.principal.userId,
                  visibility: input.visibility ?? "default",
                })
                .returning()
            )[0],
            "The calendar event could not be created.",
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "calendar_event.created",
              after: auditSnapshot(created),
              before: null,
              entityId: created.id,
              entityType: "calendar_event",
              ...context,
            }),
          );
          return created;
        }),
      );
      return serializeEvent(record, [], calendar.accountId);
    },

    async previewCommitment(
      userId: string,
      input: ParsedPreviewCalendarCommitmentInput,
    ): Promise<CalendarCommitmentProposal> {
      return previewCommitment(userId, input);
    },

    async upsertAttentionItem(
      eventId: string,
      input: UpsertCalendarAttentionItemInput,
      context: MutationContext,
    ): Promise<AttentionItem> {
      const saved = await db.transaction(async (transaction) => {
        const event = (
          await transaction
            .select()
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.id, eventId),
                eq(calendarEvents.userId, context.principal.userId),
                isNull(calendarEvents.deletedAt),
              ),
            )
            .for("update")
            .limit(1)
        )[0];
        if (!event) throw new AppError("not_found", "The calendar event was not found.");
        requireSourceEvent(event);
        const calendar = (
          await transaction
            .select()
            .from(calendars)
            .where(
              and(
                eq(calendars.id, event.calendarId),
                eq(calendars.userId, context.principal.userId),
                isNull(calendars.deletedAt),
              ),
            )
            .limit(1)
        )[0];
        if (!calendar) throw new AppError("not_found", "The event calendar was not found.");
        const existing = (
          await transaction
            .select()
            .from(attentionItems)
            .where(
              and(
                eq(attentionItems.userId, context.principal.userId),
                eq(attentionItems.domain, "calendar"),
                eq(attentionItems.relatedEntityId, event.id),
                eq(attentionItems.relatedEntityType, "calendar_event"),
                eq(attentionItems.kind, input.kind),
                eq(attentionItems.status, "open"),
              ),
            )
            .for("update")
            .limit(1)
        )[0];
        const values = {
          domain: "calendar" as const,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          importance: input.importance,
          kind: input.kind,
          occursAt: input.occursAt ? new Date(input.occursAt) : null,
          relatedEntityId: event.id,
          relatedEntityType: "calendar_event",
          source: {
            accountId: calendar.accountId,
            provider: event.provider,
            remoteId: event.remoteEventId ?? (event.provider === "local" ? event.id : null),
            revision: event.remoteEtag ?? event.updatedAt.toISOString(),
            sourceType: "calendar_event" as const,
          },
          status: "open" as const,
          summary: input.summary,
          title: input.title,
          userId: context.principal.userId,
        };
        const updatedAt = now();
        const item = requireDatabaseRecord(
          (existing
            ? await transaction
                .update(attentionItems)
                .set({ ...values, updatedAt, version: existing.version + 1 })
                .where(
                  and(
                    eq(attentionItems.id, existing.id),
                    eq(attentionItems.version, existing.version),
                  ),
                )
                .returning()
            : await transaction.insert(attentionItems).values(values).returning())[0],
          "The Calendar attention item could not be saved.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: existing ? "assistant.attention.updated" : "assistant.attention.created",
            after: auditCalendarAttentionMetadata(item),
            before: auditCalendarAttentionMetadata(existing ?? null),
            entityId: item.id,
            entityType: "attention_item",
            ...context,
          }),
        );
        return item;
      });
      return serializeCalendarAttentionItem(saved);
    },

    async createEventBlock(
      sourceEventId: string,
      input: CreateEventBlockInput,
      context: MutationContext,
    ): Promise<CalendarEvent> {
      requireAgentMutationRevisions(context, input, ["expectedUpdatedAt"]);
      const source = await findActiveEvent(context.principal.userId, sourceEventId);
      requireSourceEvent(source);
      assertExpectedUpdatedAt(source, input.expectedUpdatedAt);
      const destination = await findCalendar(context.principal.userId, input.calendarId);
      requireWritable(destination);
      if (destination.id === source.calendarId) {
        throw new AppError("invalid_request", "An event cannot block its own calendar.");
      }
      const [existing] = await db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.blockSourceEventId, source.id),
            eq(calendarEvents.calendarId, destination.id),
            isNull(calendarEvents.deletedAt),
          ),
        )
        .limit(1);
      if (existing) return serializeWithBlocks(source);

      const mirrored = blockInput(source, destination.id, input.mode);
      // A precise, unlinked Busy event can be adopted. This makes the initial migration from
      // separately-created provider events safe without ever merging arbitrary detailed events.
      const adoptionCandidates =
        input.mode === "busy"
          ? await db
              .select()
              .from(calendarEvents)
              .where(
                and(
                  eq(calendarEvents.userId, context.principal.userId),
                  eq(calendarEvents.calendarId, destination.id),
                  eq(calendarEvents.title, "Busy"),
                  eq(calendarEvents.startsAt, source.startsAt),
                  eq(calendarEvents.endsAt, source.endsAt),
                  eq(calendarEvents.allDay, source.allDay),
                  isNull(calendarEvents.blockSourceEventId),
                  isNull(calendarEvents.deletedAt),
                ),
              )
              .limit(2)
          : [];
      const adopted = adoptionCandidates.length === 1 ? adoptionCandidates[0] : undefined;
      const effect =
        !adopted && destination.provider !== "local"
          ? providerEffect("create", destination, null, "block")
          : null;
      const ledger = providerLedger("create_event_block", effect ? [effect] : [], context);
      const remote = adopted
        ? null
        : effect
          ? await ledger.run(effect, () => connectedEvents.create(destination, mirrored))
          : null;
      await ledger.commit(() =>
        db.transaction(async (transaction) => {
          await requireCurrentRevision(transaction, source, false);
          const created = adopted
            ? requireRevisionWrite(
                (
                  await transaction
                    .update(calendarEvents)
                    .set({ blockMode: input.mode, blockSourceEventId: source.id, updatedAt: now() })
                    .where(eventRevisionWhere(adopted, false))
                    .returning()
                )[0],
                adopted.id,
              )
            : requireDatabaseRecord(
                (
                  await transaction
                    .insert(calendarEvents)
                    .values({
                      allDay: remote?.allDay ?? mirrored.allDay,
                      blockMode: input.mode,
                      blockSourceEventId: source.id,
                      calendarId: destination.id,
                      conferenceUrl: remote?.conferenceUrl ?? null,
                      endsAt: remote?.endsAt ?? new Date(mirrored.endsAt),
                      location: remote?.location ?? mirrored.location,
                      notes: remote?.notes ?? mirrored.notes,
                      provider: destination.provider,
                      raw: remote?.raw,
                      recurrence: remote?.recurrence ?? [],
                      remoteEtag: remote?.etag,
                      remoteEventId: remote?.remoteEventId,
                      startsAt: remote?.startsAt ?? new Date(mirrored.startsAt),
                      status: remote?.status ?? "confirmed",
                      syncedAt: remote ? now() : null,
                      timezone: remote?.timezone ?? mirrored.timezone,
                      title: remote?.title ?? mirrored.title,
                      userId: context.principal.userId,
                    })
                    .returning()
                )[0],
                "The calendar block could not be created.",
              );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "calendar_event.blocked",
              after: auditSnapshot({ block: created, source }),
              before: auditSnapshot(source),
              entityId: source.id,
              entityType: "calendar_event",
              ...context,
            }),
          );
        }),
      );
      return serializeWithBlocks(source);
    },

    async createLocalCalendar(
      input: CreateLocalCalendarInput,
      context: MutationContext,
    ): Promise<Calendar> {
      const [account] = await db
        .select()
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.userId, context.principal.userId),
            eq(calendarAccounts.provider, "local"),
          ),
        )
        .limit(1);
      if (!account) {
        throw new AppError("internal_error", "The local calendar account is missing.");
      }
      const record = await db.transaction(async (transaction) => {
        const created = requireDatabaseRecord(
          (
            await transaction
              .insert(calendars)
              .values({
                accountId: account.id,
                color: input.color,
                isSelected: true,
                isWritable: true,
                name: input.name,
                provider: "local",
                timezone: input.timezone,
                userId: context.principal.userId,
              })
              .returning()
          )[0],
          "The calendar could not be created.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "calendar.created",
            after: auditSnapshot(created),
            before: null,
            entityId: created.id,
            entityType: "calendar",
            ...context,
          }),
        );
        return created;
      });
      return serializeCalendar(record);
    },

    async deleteLocalCalendar(id: string, context: MutationContext): Promise<void> {
      const before = await findCalendar(context.principal.userId, id);
      requireLocal(before);
      await db.transaction(async (transaction) => {
        const deletedAt = now();
        const after = requireDatabaseRecord(
          (
            await transaction
              .update(calendars)
              .set({ deletedAt, updatedAt: deletedAt })
              .where(eq(calendars.id, before.id))
              .returning()
          )[0],
          "The calendar could not be deleted.",
        );
        await transaction
          .update(calendarEvents)
          .set({ deletedAt, updatedAt: deletedAt })
          .where(and(eq(calendarEvents.calendarId, before.id), isNull(calendarEvents.deletedAt)));
        await invalidateCalendarProfileSources(transaction, {
          context,
          now: deletedAt,
          unavailableCalendarIds: [before.id],
          userId: context.principal.userId,
        });
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "calendar.deleted",
            after: auditSnapshot(after),
            before: auditSnapshot(before),
            entityId: after.id,
            entityType: "calendar",
            ...context,
          }),
        );
      });
    },

    async deleteEventBlock(
      sourceEventId: string,
      blockEventId: string,
      context: MutationContext,
      input: DeleteEventBlockInput = {},
    ): Promise<CalendarEvent> {
      requireAgentMutationRevisions(context, input, [
        "expectedBlockUpdatedAt",
        "expectedUpdatedAt",
      ]);
      const source = await findActiveEvent(context.principal.userId, sourceEventId);
      requireSourceEvent(source);
      assertExpectedUpdatedAt(source, input.expectedUpdatedAt);
      const block = await findActiveEvent(context.principal.userId, blockEventId);
      if (block.blockSourceEventId !== source.id) {
        throw new AppError("not_found", "The linked calendar block was not found.");
      }
      assertExpectedUpdatedAt(block, input.expectedBlockUpdatedAt);
      const destination = await findCalendar(context.principal.userId, block.calendarId);
      requireWritable(destination);
      const effect =
        destination.provider === "local"
          ? null
          : providerEffect("delete", destination, block, "block");
      const ledger = providerLedger("delete_event_block", effect ? [effect] : [], context);
      if (effect) {
        await ledger.run(effect, () => connectedEvents.delete(destination, block));
      }
      await ledger.commit(() =>
        db.transaction(async (transaction) => {
          await requireCurrentRevision(transaction, source, false);
          const deletedAt = now();
          const after = requireRevisionWrite(
            (
              await transaction
                .update(calendarEvents)
                .set({ deletedAt, updatedAt: deletedAt })
                .where(eventRevisionWhere(block, false))
                .returning()
            )[0],
            block.id,
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "calendar_event.unblocked",
              after: auditSnapshot(after),
              before: auditSnapshot(block),
              entityId: source.id,
              entityType: "calendar_event",
              ...context,
            }),
          );
        }),
      );
      return serializeWithBlocks(source);
    },

    async deleteEvent(
      id: string,
      context: MutationContext,
      input: DeleteEventInput = {},
    ): Promise<CalendarEventMutationRevision> {
      requireAgentMutationRevisions(context, input, [
        "expectedBlockUpdatedAtById",
        "expectedUpdatedAt",
      ]);
      const before = await findActiveEvent(context.principal.userId, id);
      requireSourceEvent(before);
      assertExpectedUpdatedAt(before, input.expectedUpdatedAt);
      const calendar = await findCalendar(context.principal.userId, before.calendarId);
      requireWritable(calendar);
      const blocks = await findActiveBlocks(context.principal.userId, before.id);
      assertExpectedBlockUpdatedAt(blocks, input.expectedBlockUpdatedAtById);
      const blockTargets = [];
      for (const block of blocks) {
        const destination = await findCalendar(context.principal.userId, block.calendarId);
        requireWritable(destination);
        blockTargets.push({
          block,
          destination,
          effect:
            destination.provider === "local"
              ? null
              : providerEffect("delete", destination, block, "block"),
        });
      }
      const sourceEffect =
        calendar.provider === "local" ? null : providerEffect("delete", calendar, before, "source");
      const ledger = providerLedger(
        "delete_event",
        [
          ...blockTargets.flatMap(({ effect }) => (effect ? [effect] : [])),
          ...(sourceEffect ? [sourceEffect] : []),
        ],
        context,
      );
      for (const { block, destination, effect } of blockTargets) {
        if (effect) {
          await ledger.run(effect, () => connectedEvents.delete(destination, block));
        }
      }
      if (sourceEffect) {
        await ledger.run(sourceEffect, () => connectedEvents.delete(calendar, before));
      }
      return ledger.commit(() =>
        db.transaction(async (transaction) => {
          await requireCurrentRevision(transaction, before, false);
          await requireCurrentBlockSet(transaction, before, blocks, false);
          const deletedAt = now();
          const after = requireRevisionWrite(
            (
              await transaction
                .update(calendarEvents)
                .set({ deletedAt, updatedAt: deletedAt })
                .where(eventRevisionWhere(before, false))
                .returning()
            )[0],
            before.id,
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "calendar_event.deleted",
              after: auditSnapshot(after),
              before: auditSnapshot(before),
              entityId: after.id,
              entityType: "calendar_event",
              ...context,
            }),
          );
          const blockUpdatedAtById: Record<string, string> = {};
          for (const block of blocks) {
            const deletedBlock = requireRevisionWrite(
              (
                await transaction
                  .update(calendarEvents)
                  .set({ deletedAt, updatedAt: deletedAt })
                  .where(eventRevisionWhere(block, false))
                  .returning()
              )[0],
              block.id,
            );
            blockUpdatedAtById[deletedBlock.id] = deletedBlock.updatedAt.toISOString();
          }
          return {
            blockUpdatedAtById,
            eventId: after.id,
            updatedAt: after.updatedAt.toISOString(),
          };
        }),
      );
    },

    async getEvent(id: string, userId: string): Promise<CalendarEvent> {
      return serializeWithBlocks(await findActiveEvent(userId, id));
    },

    async list(userId: string): Promise<Calendar[]> {
      const rows = await db
        .select({ account: calendarAccounts, calendar: calendars })
        .from(calendars)
        .innerJoin(calendarAccounts, eq(calendarAccounts.id, calendars.accountId))
        .where(
          and(
            eq(calendars.userId, userId),
            eq(calendarAccounts.calendarEnabled, true),
            isNull(calendars.deletedAt),
          ),
        )
        .orderBy(
          desc(calendars.isPrimary),
          desc(calendars.isWritable),
          asc(calendars.name),
          asc(calendars.id),
        );
      const accountsById = new Map(rows.map(({ account }) => [account.id, account]));
      return deduplicateCalendars(rows.map(({ calendar }) => calendar))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((calendar) => {
          const account = accountsById.get(calendar.accountId);
          if (!account) {
            throw new AppError("internal_error", "The Calendar source account is missing.");
          }
          return serializeCalendarSource(calendar, account);
        });
    },

    async listEvents(userId: string, query: EventListQuery): Promise<CalendarEvent[]> {
      const calendarConditions = [eq(calendars.userId, userId), isNull(calendars.deletedAt)];
      if (query.calendarIds) {
        calendarConditions.push(inArray(calendars.id, query.calendarIds));
      }
      const calendarRecords = await db
        .select()
        .from(calendars)
        .where(and(...calendarConditions))
        .orderBy(
          desc(calendars.isPrimary),
          desc(calendars.isWritable),
          asc(calendars.name),
          asc(calendars.id),
        );
      const calendarIds = deduplicateCalendars(calendarRecords)
        .filter((calendar) => calendar.isSelected)
        .map((calendar) => calendar.id);
      const accountIdByCalendarId = new Map(
        calendarRecords.map((calendar) => [calendar.id, calendar.accountId]),
      );
      const conditions = [
        eq(calendarEvents.userId, userId),
        isNull(calendarEvents.deletedAt),
        lt(calendarEvents.startsAt, new Date(query.to)),
        gt(calendarEvents.endsAt, new Date(query.from)),
        inArray(calendarEvents.calendarId, calendarIds),
      ];
      if (query.query) {
        const searchCondition = or(
          ilike(calendarEvents.title, `%${query.query}%`),
          ilike(calendarEvents.notes, `%${query.query}%`),
          ilike(calendarEvents.location, `%${query.query}%`),
        );
        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }
      const records = await db
        .select({ event: calendarEvents })
        .from(calendarEvents)
        .innerJoin(
          calendars,
          and(
            eq(calendars.id, calendarEvents.calendarId),
            eq(calendars.isSelected, true),
            isNull(calendars.deletedAt),
          ),
        )
        .where(and(...conditions))
        .orderBy(asc(calendarEvents.startsAt));
      const eventRecords = records
        .map(({ event }) => event)
        .sort(
          (left, right) =>
            left.startsAt.getTime() - right.startsAt.getTime() ||
            calendarIds.indexOf(left.calendarId) - calendarIds.indexOf(right.calendarId) ||
            left.id.localeCompare(right.id),
        );
      const linkedSourceIds = Array.from(
        new Set(
          eventRecords.flatMap((record) =>
            record.blockSourceEventId ? [record.blockSourceEventId] : [],
          ),
        ),
      );
      const linkedSources =
        linkedSourceIds.length > 0
          ? await db
              .select()
              .from(calendarEvents)
              .where(
                and(
                  eq(calendarEvents.userId, userId),
                  inArray(calendarEvents.id, linkedSourceIds),
                  isNull(calendarEvents.deletedAt),
                ),
              )
          : [];
      const sourcesById = new Map(linkedSources.map((record) => [record.id, record]));
      const visibleCalendarIds = new Set(calendarIds);
      const visibleRecords = eventRecords.filter((record) => {
        if (!record.blockSourceEventId) return true;
        const source = sourcesById.get(record.blockSourceEventId);
        return !source || !visibleCalendarIds.has(source.calendarId);
      });
      const deduplicated = deduplicateEvents(visibleRecords);
      const displayedSourceIds = deduplicated
        .filter((record) => !record.blockSourceEventId)
        .map((record) => record.id);
      const blockRecords =
        displayedSourceIds.length > 0
          ? await db
              .select()
              .from(calendarEvents)
              .where(
                and(
                  eq(calendarEvents.userId, userId),
                  inArray(calendarEvents.blockSourceEventId, displayedSourceIds),
                  isNull(calendarEvents.deletedAt),
                ),
              )
              .orderBy(asc(calendarEvents.createdAt), asc(calendarEvents.id))
          : [];
      const blocksBySource = new Map<string, CalendarEventBlock[]>();
      for (const block of blockRecords) {
        const sourceId = block.blockSourceEventId as string;
        blocksBySource.set(sourceId, [...(blocksBySource.get(sourceId) ?? []), eventBlock(block)]);
      }
      return deduplicated.map((record) =>
        serializeEvent(
          record,
          blocksBySource.get(record.id) ?? [],
          accountIdByCalendarId.get(record.calendarId) ?? null,
        ),
      );
    },

    async restoreEvent(
      id: string,
      context: MutationContext,
      input: RestoreEventInput = {},
    ): Promise<CalendarEvent> {
      requireAgentMutationRevisions(context, input, [
        "expectedBlockUpdatedAtById",
        "expectedUpdatedAt",
      ]);
      const [before] = await db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.id, id),
            eq(calendarEvents.userId, context.principal.userId),
            isNotNull(calendarEvents.deletedAt),
          ),
        )
        .limit(1);
      if (!before) {
        throw new AppError("not_found", "The deleted calendar event was not found.");
      }
      requireSourceEvent(before);
      assertExpectedUpdatedAt(before, input.expectedUpdatedAt);
      const calendar = await findCalendar(context.principal.userId, before.calendarId);
      requireWritable(calendar);
      const deletedBlocks = await db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.userId, context.principal.userId),
            eq(calendarEvents.blockSourceEventId, before.id),
            isNotNull(calendarEvents.deletedAt),
          ),
        )
        .orderBy(asc(calendarEvents.createdAt), asc(calendarEvents.id));
      assertExpectedBlockUpdatedAt(deletedBlocks, input.expectedBlockUpdatedAtById);
      const blockTargets = [];
      for (const block of deletedBlocks) {
        const destination = await findCalendar(context.principal.userId, block.calendarId);
        requireWritable(destination);
        blockTargets.push({
          block,
          destination,
          effect:
            destination.provider === "local"
              ? null
              : providerEffect("create", destination, block, "block"),
        });
      }
      const sourceEffect =
        calendar.provider === "local" ? null : providerEffect("create", calendar, before, "source");
      const ledger = providerLedger(
        "restore_event",
        [
          ...(sourceEffect ? [sourceEffect] : []),
          ...blockTargets.flatMap(({ effect }) => (effect ? [effect] : [])),
        ],
        context,
      );
      const remote =
        sourceEffect !== null
          ? await ledger.run(sourceEffect, () =>
              connectedEvents.create(calendar, {
                allDay: before.allDay,
                calendarId: before.calendarId,
                endsAt: before.endsAt.toISOString(),
                location: before.location,
                notes: before.notes,
                startsAt: before.startsAt.toISOString(),
                timezone: before.timezone,
                title: before.title,
              }),
            )
          : null;
      const projectedSource = {
        ...before,
        ...(remote ? connectedEventValues(remote, now()) : {}),
        deletedAt: null,
      };
      const restoredBlocks: Array<{
        block: CalendarEventRecord;
        remote: ConnectedEvent | null;
        values: CreateEventInput;
      }> = [];
      for (const { block, destination, effect } of blockTargets) {
        const values = blockInput(
          projectedSource,
          destination.id,
          block.blockMode as EventBlockMode,
        );
        restoredBlocks.push({
          block,
          remote: effect
            ? await ledger.run(effect, () => connectedEvents.create(destination, values))
            : null,
          values,
        });
      }
      const after = await ledger.commit(() =>
        db.transaction(async (transaction) => {
          const restoredAt = now();
          const restored = requireRevisionWrite(
            (
              await transaction
                .update(calendarEvents)
                .set({
                  ...(remote
                    ? {
                        allDay: remote.allDay,
                        conferenceUrl: remote.conferenceUrl,
                        endsAt: remote.endsAt,
                        location: remote.location,
                        notes: remote.notes,
                        raw: remote.raw,
                        recurrence: remote.recurrence,
                        remoteEtag: remote.etag,
                        remoteEventId: remote.remoteEventId,
                        startsAt: remote.startsAt,
                        status: remote.status,
                        syncedAt: restoredAt,
                        timezone: remote.timezone,
                        title: remote.title,
                      }
                    : {}),
                  deletedAt: null,
                  updatedAt: restoredAt,
                })
                .where(eventRevisionWhere(before, true))
                .returning()
            )[0],
            before.id,
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "calendar_event.restored",
              after: auditSnapshot(restored),
              before: auditSnapshot(before),
              entityId: restored.id,
              entityType: "calendar_event",
              ...context,
            }),
          );
          for (const restoredBlock of restoredBlocks) {
            const blockRemote = restoredBlock.remote;
            requireRevisionWrite(
              (
                await transaction
                  .update(calendarEvents)
                  .set({
                    ...(blockRemote
                      ? connectedEventValues(blockRemote, restoredAt)
                      : {
                          allDay: restoredBlock.values.allDay,
                          endsAt: new Date(restoredBlock.values.endsAt),
                          location: restoredBlock.values.location,
                          notes: restoredBlock.values.notes,
                          startsAt: new Date(restoredBlock.values.startsAt),
                          timezone: restoredBlock.values.timezone,
                          title: restoredBlock.values.title,
                        }),
                    deletedAt: null,
                    updatedAt: restoredAt,
                  })
                  .where(eventRevisionWhere(restoredBlock.block, true))
                  .returning()
              )[0],
              restoredBlock.block.id,
            );
          }
          return restored;
        }),
      );
      return serializeWithBlocks(after);
    },

    async setSelected(
      id: string,
      isSelected: boolean,
      context: MutationContext,
    ): Promise<Calendar> {
      const before = await findCalendar(context.principal.userId, id);
      const after = await db.transaction(async (transaction) => {
        const updated = requireDatabaseRecord(
          (
            await transaction
              .update(calendars)
              .set({ isSelected, updatedAt: now() })
              .where(eq(calendars.id, before.id))
              .returning()
          )[0],
          "The calendar could not be updated.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: isSelected ? "calendar.selected" : "calendar.hidden",
            after: auditSnapshot(updated),
            before: auditSnapshot(before),
            entityId: updated.id,
            entityType: "calendar",
            ...context,
          }),
        );
        return updated;
      });
      return serializeCalendar(after);
    },

    async updateEventBlock(
      sourceEventId: string,
      blockEventId: string,
      input: UpdateEventBlockInput,
      context: MutationContext,
    ): Promise<CalendarEvent> {
      requireAgentMutationRevisions(context, input, [
        "expectedBlockUpdatedAt",
        "expectedUpdatedAt",
      ]);
      const source = await findActiveEvent(context.principal.userId, sourceEventId);
      requireSourceEvent(source);
      assertExpectedUpdatedAt(source, input.expectedUpdatedAt);
      const block = await findActiveEvent(context.principal.userId, blockEventId);
      if (block.blockSourceEventId !== source.id) {
        throw new AppError("not_found", "The linked calendar block was not found.");
      }
      assertExpectedUpdatedAt(block, input.expectedBlockUpdatedAt);
      if (block.blockMode === input.mode) return serializeWithBlocks(source);
      const destination = await findCalendar(context.principal.userId, block.calendarId);
      requireWritable(destination);
      const values = blockInput(source, destination.id, input.mode);
      const { calendarId: _calendarId, ...update } = values;
      const effect =
        destination.provider === "local"
          ? null
          : providerEffect("update", destination, block, "block");
      const ledger = providerLedger("update_event_block", effect ? [effect] : [], context);
      const remote =
        effect !== null
          ? await ledger.run(effect, () => connectedEvents.update(destination, block, update))
          : null;
      await ledger.commit(() =>
        db.transaction(async (transaction) => {
          await requireCurrentRevision(transaction, source, false);
          const updatedAt = now();
          const after = requireRevisionWrite(
            (
              await transaction
                .update(calendarEvents)
                .set({
                  ...(remote
                    ? connectedEventValues(remote, updatedAt)
                    : {
                        allDay: values.allDay,
                        endsAt: new Date(values.endsAt),
                        location: values.location,
                        notes: values.notes,
                        startsAt: new Date(values.startsAt),
                        timezone: values.timezone,
                        title: values.title,
                      }),
                  blockMode: input.mode,
                  updatedAt,
                })
                .where(eventRevisionWhere(block, false))
                .returning()
            )[0],
            block.id,
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "calendar_event.block_privacy_changed",
              after: auditSnapshot(after),
              before: auditSnapshot(block),
              entityId: source.id,
              entityType: "calendar_event",
              ...context,
            }),
          );
        }),
      );
      return serializeWithBlocks(source);
    },

    async updateEvent(
      id: string,
      input: UpdateEventInput,
      context: MutationContext,
    ): Promise<CalendarEvent> {
      requireAgentMutationRevisions(context, input, [
        "expectedBlockUpdatedAtById",
        "expectedUpdatedAt",
      ]);
      const before = await findActiveEvent(context.principal.userId, id);
      requireSourceEvent(before);
      const { expectedBlockUpdatedAtById, expectedUpdatedAt, ...changes } = input;
      assertExpectedUpdatedAt(before, expectedUpdatedAt);
      const calendar = await findCalendar(context.principal.userId, before.calendarId);
      requireWritable(calendar);
      const startsAt = changes.startsAt ? new Date(changes.startsAt) : before.startsAt;
      const endsAt = changes.endsAt ? new Date(changes.endsAt) : before.endsAt;
      if (endsAt <= startsAt) {
        throw new AppError("invalid_request", "Event end must be after its start.");
      }
      const blocks = await findActiveBlocks(context.principal.userId, before.id);
      assertExpectedBlockUpdatedAt(blocks, expectedBlockUpdatedAtById);
      const blockTargets = [];
      for (const block of blocks) {
        const destination = await findCalendar(context.principal.userId, block.calendarId);
        requireWritable(destination);
        blockTargets.push({
          block,
          destination,
          effect:
            destination.provider === "local"
              ? null
              : providerEffect("update", destination, block, "block"),
        });
      }
      const sourceEffect =
        calendar.provider === "local" ? null : providerEffect("update", calendar, before, "source");
      const ledger = providerLedger(
        "update_event",
        [
          ...(sourceEffect ? [sourceEffect] : []),
          ...blockTargets.flatMap(({ effect }) => (effect ? [effect] : [])),
        ],
        context,
      );
      const remote =
        sourceEffect !== null
          ? await ledger.run(sourceEffect, () => connectedEvents.update(calendar, before, changes))
          : null;
      const localValues = {
        ...(changes.allDay === undefined ? {} : { allDay: changes.allDay }),
        ...(changes.attendees === undefined
          ? {}
          : { attendees: normalizeAttendees(changes.attendees) }),
        ...(changes.endsAt === undefined ? {} : { endsAt }),
        ...(changes.eventType === undefined ? {} : { eventType: changes.eventType }),
        ...(changes.location === undefined ? {} : { location: changes.location }),
        ...(changes.notes === undefined ? {} : { notes: changes.notes }),
        ...(changes.recurrence === undefined ? {} : { recurrence: changes.recurrence }),
        ...(changes.reminders === undefined ? {} : { reminders: changes.reminders }),
        ...(changes.startsAt === undefined ? {} : { startsAt }),
        ...(changes.timezone === undefined ? {} : { timezone: changes.timezone }),
        ...(changes.title === undefined ? {} : { title: changes.title }),
        ...(changes.transparency === undefined ? {} : { transparency: changes.transparency }),
        ...(changes.visibility === undefined ? {} : { visibility: changes.visibility }),
      };
      const projectedSource: CalendarEventRecord = {
        ...before,
        ...(remote ? connectedEventValues(remote, now()) : localValues),
      };
      const reconciledBlocks: Array<{
        block: CalendarEventRecord;
        remote: ConnectedEvent | null;
        values: CreateEventInput;
      }> = [];
      for (const { block, destination, effect } of blockTargets) {
        const values = blockInput(
          projectedSource,
          destination.id,
          block.blockMode as EventBlockMode,
        );
        const { calendarId: _calendarId, ...update } = values;
        reconciledBlocks.push({
          block,
          remote: effect
            ? await ledger.run(effect, () => connectedEvents.update(destination, block, update))
            : null,
          values,
        });
      }
      const after = await ledger.commit(() =>
        db.transaction(async (transaction) => {
          await requireCurrentRevision(transaction, before, false);
          await requireCurrentBlockSet(transaction, before, blocks, false);
          const updatedAt = now();
          const updated = requireRevisionWrite(
            (
              await transaction
                .update(calendarEvents)
                .set({
                  ...(remote ? connectedEventValues(remote, updatedAt) : localValues),
                  updatedAt,
                })
                .where(eventRevisionWhere(before, false))
                .returning()
            )[0],
            before.id,
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "calendar_event.updated",
              after: auditSnapshot(updated),
              before: auditSnapshot(before),
              entityId: updated.id,
              entityType: "calendar_event",
              ...context,
            }),
          );
          for (const reconciled of reconciledBlocks) {
            requireRevisionWrite(
              (
                await transaction
                  .update(calendarEvents)
                  .set({
                    ...(reconciled.remote
                      ? connectedEventValues(reconciled.remote, updatedAt)
                      : {
                          allDay: reconciled.values.allDay,
                          endsAt: new Date(reconciled.values.endsAt),
                          location: reconciled.values.location,
                          notes: reconciled.values.notes,
                          startsAt: new Date(reconciled.values.startsAt),
                          timezone: reconciled.values.timezone,
                          title: reconciled.values.title,
                        }),
                    updatedAt,
                  })
                  .where(eventRevisionWhere(reconciled.block, false))
                  .returning()
              )[0],
              reconciled.block.id,
            );
          }
          return updated;
        }),
      );
      return serializeWithBlocks(after);
    },

    async updateLocalCalendar(
      id: string,
      input: UpdateLocalCalendarInput,
      context: MutationContext,
    ): Promise<Calendar> {
      const before = await findCalendar(context.principal.userId, id);
      requireLocal(before);
      const after = await db.transaction(async (transaction) => {
        const updated = requireDatabaseRecord(
          (
            await transaction
              .update(calendars)
              .set({
                ...(input.color === undefined ? {} : { color: input.color }),
                ...(input.name === undefined ? {} : { name: input.name }),
                ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
                updatedAt: now(),
              })
              .where(eq(calendars.id, before.id))
              .returning()
          )[0],
          "The calendar could not be updated.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "calendar.updated",
            after: auditSnapshot(updated),
            before: auditSnapshot(before),
            entityId: updated.id,
            entityType: "calendar",
            ...context,
          }),
        );
        return updated;
      });
      return serializeCalendar(after);
    },
  };
  return service;
}
