import {
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  type Database,
} from "@personal-os/database";
import type {
  Calendar,
  CalendarEvent,
  CalendarEventBlock,
  CreateEventBlockInput,
  CreateEventInput,
  CreateLocalCalendarInput,
  EventBlockMode,
  EventListQuery,
  UpdateEventBlockInput,
  UpdateEventInput,
  UpdateLocalCalendarInput,
} from "@personal-os/domain";
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { auditValues } from "./audit.js";
import type { ConnectedEventGateway } from "./connector-service.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
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
};

type CalendarRecord = typeof calendars.$inferSelect;
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
    // Google can mirror one appointment into multiple connected primary calendars with
    // different provider IDs. The unified projection should still show one visible event.
    const key = JSON.stringify([
      record.provider,
      record.title.trim().toLocaleLowerCase(),
      record.startsAt.toISOString(),
      record.endsAt.toISOString(),
      record.allDay,
    ]);
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
  };
}

export function createCalendarService({ connectedEvents, db, now }: CalendarServiceOptions) {
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
    if (record.blockSourceEventId) return serializeEvent(record);
    const blocks = await findActiveBlocks(record.userId, record.id);
    return serializeEvent(record, blocks.map(eventBlock));
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

  return {
    async createEvent(input: CreateEventInput, context: MutationContext): Promise<CalendarEvent> {
      const calendar = await findCalendar(context.principal.userId, input.calendarId);
      requireWritable(calendar);
      const remote =
        calendar.provider !== "local" ? await connectedEvents.create(calendar, input) : null;
      const record = await db.transaction(async (transaction) => {
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
      });
      return serializeEvent(record);
    },

    async createEventBlock(
      sourceEventId: string,
      input: CreateEventBlockInput,
      context: MutationContext,
    ): Promise<CalendarEvent> {
      const source = await findActiveEvent(context.principal.userId, sourceEventId);
      requireSourceEvent(source);
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
      const remote = adopted
        ? null
        : destination.provider !== "local"
          ? await connectedEvents.create(destination, mirrored)
          : null;
      await db.transaction(async (transaction) => {
        const created = adopted
          ? requireDatabaseRecord(
              (
                await transaction
                  .update(calendarEvents)
                  .set({ blockMode: input.mode, blockSourceEventId: source.id, updatedAt: now() })
                  .where(eq(calendarEvents.id, adopted.id))
                  .returning()
              )[0],
              "The existing busy block could not be linked.",
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
      });
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
    ): Promise<CalendarEvent> {
      const source = await findActiveEvent(context.principal.userId, sourceEventId);
      requireSourceEvent(source);
      const block = await findActiveEvent(context.principal.userId, blockEventId);
      if (block.blockSourceEventId !== source.id) {
        throw new AppError("not_found", "The linked calendar block was not found.");
      }
      const destination = await findCalendar(context.principal.userId, block.calendarId);
      requireWritable(destination);
      if (destination.provider !== "local") {
        await connectedEvents.delete(destination, block);
      }
      await db.transaction(async (transaction) => {
        const deletedAt = now();
        const after = requireDatabaseRecord(
          (
            await transaction
              .update(calendarEvents)
              .set({ deletedAt, updatedAt: deletedAt })
              .where(eq(calendarEvents.id, block.id))
              .returning()
          )[0],
          "The linked calendar block could not be removed.",
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
      });
      return serializeWithBlocks(source);
    },

    async deleteEvent(id: string, context: MutationContext): Promise<void> {
      const before = await findActiveEvent(context.principal.userId, id);
      requireSourceEvent(before);
      const calendar = await findCalendar(context.principal.userId, before.calendarId);
      requireWritable(calendar);
      const blocks = await findActiveBlocks(context.principal.userId, before.id);
      for (const block of blocks) {
        const destination = await findCalendar(context.principal.userId, block.calendarId);
        requireWritable(destination);
        if (destination.provider !== "local") {
          await connectedEvents.delete(destination, block);
        }
      }
      if (calendar.provider !== "local") {
        await connectedEvents.delete(calendar, before);
      }
      await db.transaction(async (transaction) => {
        const deletedAt = now();
        const after = requireDatabaseRecord(
          (
            await transaction
              .update(calendarEvents)
              .set({ deletedAt, updatedAt: deletedAt })
              .where(eq(calendarEvents.id, before.id))
              .returning()
          )[0],
          "The calendar event could not be deleted.",
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
        if (blocks.length > 0) {
          await transaction
            .update(calendarEvents)
            .set({ deletedAt, updatedAt: deletedAt })
            .where(
              inArray(
                calendarEvents.id,
                blocks.map((block) => block.id),
              ),
            );
        }
      });
    },

    async getEvent(id: string, userId: string): Promise<CalendarEvent> {
      return serializeWithBlocks(await findActiveEvent(userId, id));
    },

    async list(userId: string): Promise<Calendar[]> {
      const records = await db
        .select()
        .from(calendars)
        .where(and(eq(calendars.userId, userId), isNull(calendars.deletedAt)))
        .orderBy(
          desc(calendars.isPrimary),
          desc(calendars.isWritable),
          asc(calendars.name),
          asc(calendars.id),
        );
      return deduplicateCalendars(records)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(serializeCalendar);
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
        serializeEvent(record, blocksBySource.get(record.id) ?? []),
      );
    },

    async restoreEvent(id: string, context: MutationContext): Promise<CalendarEvent> {
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
      const calendar = await findCalendar(context.principal.userId, before.calendarId);
      requireWritable(calendar);
      const remote =
        calendar.provider !== "local"
          ? await connectedEvents.create(calendar, {
              allDay: before.allDay,
              calendarId: before.calendarId,
              endsAt: before.endsAt.toISOString(),
              location: before.location,
              notes: before.notes,
              startsAt: before.startsAt.toISOString(),
              timezone: before.timezone,
              title: before.title,
            })
          : null;
      const projectedSource = {
        ...before,
        ...(remote ? connectedEventValues(remote, now()) : {}),
        deletedAt: null,
      };
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
      const restoredBlocks: Array<{
        block: CalendarEventRecord;
        remote: ConnectedEvent | null;
        values: CreateEventInput;
      }> = [];
      for (const block of deletedBlocks) {
        const destination = await findCalendar(context.principal.userId, block.calendarId);
        requireWritable(destination);
        const values = blockInput(
          projectedSource,
          destination.id,
          block.blockMode as EventBlockMode,
        );
        restoredBlocks.push({
          block,
          remote:
            destination.provider !== "local"
              ? await connectedEvents.create(destination, values)
              : null,
          values,
        });
      }
      const after = await db.transaction(async (transaction) => {
        const restoredAt = now();
        const restored = requireDatabaseRecord(
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
              .where(eq(calendarEvents.id, before.id))
              .returning()
          )[0],
          "The calendar event could not be restored.",
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
            .where(eq(calendarEvents.id, restoredBlock.block.id));
        }
        return restored;
      });
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
      const source = await findActiveEvent(context.principal.userId, sourceEventId);
      requireSourceEvent(source);
      const block = await findActiveEvent(context.principal.userId, blockEventId);
      if (block.blockSourceEventId !== source.id) {
        throw new AppError("not_found", "The linked calendar block was not found.");
      }
      if (block.blockMode === input.mode) return serializeWithBlocks(source);
      const destination = await findCalendar(context.principal.userId, block.calendarId);
      requireWritable(destination);
      const values = blockInput(source, destination.id, input.mode);
      const { calendarId: _calendarId, ...update } = values;
      const remote =
        destination.provider !== "local"
          ? await connectedEvents.update(destination, block, update)
          : null;
      await db.transaction(async (transaction) => {
        const updatedAt = now();
        const after = requireDatabaseRecord(
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
              .where(eq(calendarEvents.id, block.id))
              .returning()
          )[0],
          "The linked calendar block could not be updated.",
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
      });
      return serializeWithBlocks(source);
    },

    async updateEvent(
      id: string,
      input: UpdateEventInput,
      context: MutationContext,
    ): Promise<CalendarEvent> {
      const before = await findActiveEvent(context.principal.userId, id);
      requireSourceEvent(before);
      const calendar = await findCalendar(context.principal.userId, before.calendarId);
      requireWritable(calendar);
      const startsAt = input.startsAt ? new Date(input.startsAt) : before.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : before.endsAt;
      if (endsAt <= startsAt) {
        throw new AppError("invalid_request", "Event end must be after its start.");
      }
      const remote =
        calendar.provider !== "local"
          ? await connectedEvents.update(calendar, before, input)
          : null;
      const localValues = {
        ...(input.allDay === undefined ? {} : { allDay: input.allDay }),
        ...(input.attendees === undefined
          ? {}
          : { attendees: normalizeAttendees(input.attendees) }),
        ...(input.endsAt === undefined ? {} : { endsAt }),
        ...(input.eventType === undefined ? {} : { eventType: input.eventType }),
        ...(input.location === undefined ? {} : { location: input.location }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.recurrence === undefined ? {} : { recurrence: input.recurrence }),
        ...(input.reminders === undefined ? {} : { reminders: input.reminders }),
        ...(input.startsAt === undefined ? {} : { startsAt }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.transparency === undefined ? {} : { transparency: input.transparency }),
        ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
      };
      const projectedSource: CalendarEventRecord = {
        ...before,
        ...(remote ? connectedEventValues(remote, now()) : localValues),
      };
      const blocks = await findActiveBlocks(context.principal.userId, before.id);
      const reconciledBlocks: Array<{
        block: CalendarEventRecord;
        remote: ConnectedEvent | null;
        values: CreateEventInput;
      }> = [];
      for (const block of blocks) {
        const destination = await findCalendar(context.principal.userId, block.calendarId);
        requireWritable(destination);
        const values = blockInput(
          projectedSource,
          destination.id,
          block.blockMode as EventBlockMode,
        );
        const { calendarId: _calendarId, ...update } = values;
        reconciledBlocks.push({
          block,
          remote:
            destination.provider !== "local"
              ? await connectedEvents.update(destination, block, update)
              : null,
          values,
        });
      }
      const after = await db.transaction(async (transaction) => {
        const updatedAt = now();
        const updated = requireDatabaseRecord(
          (
            await transaction
              .update(calendarEvents)
              .set({
                ...(remote ? connectedEventValues(remote, updatedAt) : localValues),
                updatedAt,
              })
              .where(eq(calendarEvents.id, before.id))
              .returning()
          )[0],
          "The calendar event could not be updated.",
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
            .where(eq(calendarEvents.id, reconciled.block.id));
        }
        return updated;
      });
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
}
