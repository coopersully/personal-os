import type {
  calendarEvents,
  calendars,
  mailboxes,
  mailThreads,
  reminders,
  users,
} from "@personal-os/database";
import type {
  Calendar,
  CalendarEvent,
  CalendarEventBlock,
  Mailbox,
  MailThread,
  Reminder,
  Task,
  User,
} from "@personal-os/domain";

type UserRow = typeof users.$inferSelect;
type ReminderRow = typeof reminders.$inferSelect;
type CalendarEventRow = typeof calendarEvents.$inferSelect;
type CalendarRow = typeof calendars.$inferSelect;
type MailboxRow = typeof mailboxes.$inferSelect;
type MailThreadRow = typeof mailThreads.$inferSelect;

export function serializeUser(row: UserRow): User {
  return {
    accentColor: row.accentColor,
    createdAt: row.createdAt.toISOString(),
    displayName: row.displayName,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    id: row.id,
    theme: row.theme,
    planningTimezone: row.planningTimezone,
    homeLocation: row.homeLocation,
    workdayEndMinute: row.workdayEndMinute,
    workdayStartMinute: row.workdayStartMinute,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeReminder(row: ReminderRow): Reminder {
  return {
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    id: row.id,
    notes: row.notes,
    priority: row.priority,
    timezone: row.timezone,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeTask(row: ReminderRow): Task {
  return {
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    estimateMinutes: row.estimateMinutes,
    id: row.id,
    notes: row.notes,
    priority: row.priority,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    status: row.status,
    tags: row.tags,
    timezone: row.timezone,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeCalendar(row: CalendarRow): Calendar {
  return {
    accountId: row.accountId,
    color: row.color,
    id: row.id,
    isPrimary: row.isPrimary,
    isSelected: row.isSelected,
    isWritable: row.isWritable,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    name: row.name,
    provider: row.provider,
    timezone: row.timezone,
  };
}

export function serializeEvent(
  row: CalendarEventRow,
  blocks: CalendarEventBlock[] = [],
): CalendarEvent {
  return {
    allDay: row.allDay,
    attendees: row.attendees,
    blockMode: row.blockMode,
    blocks,
    blockSourceEventId: row.blockSourceEventId,
    calendarId: row.calendarId,
    conferenceUrl: row.conferenceUrl,
    createdAt: row.createdAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    eventType: row.eventType,
    id: row.id,
    location: row.location,
    notes: row.notes,
    provider: row.provider,
    recurrence: row.recurrence,
    reminders: row.reminders,
    remoteEventId: row.remoteEventId,
    startsAt: row.startsAt.toISOString(),
    status: row.status,
    transparency: row.transparency,
    timezone: row.timezone,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    visibility: row.visibility,
  };
}

export function serializeMailbox(row: MailboxRow): Mailbox {
  return {
    accountId: row.accountId,
    id: row.id,
    name: row.name,
    provider: row.provider,
    role: row.role,
    totalCount: row.totalCount,
    unreadCount: row.unreadCount,
  };
}

export function serializeMailThread(
  row: MailThreadRow,
  mailboxIds: Map<string, string>,
): MailThread {
  return {
    accountId: row.accountId,
    bodyText: row.bodyText,
    from: row.from,
    id: row.id,
    mailboxIds: row.remoteMailboxIds.flatMap((remoteId) => {
      const id = mailboxIds.get(`${row.accountId}:${remoteId}`);
      return id ? [id] : [];
    }),
    messageCount: row.messageCount,
    provider: row.provider,
    receivedAt: row.receivedAt.toISOString(),
    remoteThreadId: row.remoteThreadId,
    snippet: row.snippet,
    starred: row.starred,
    subject: row.subject,
    to: row.to,
    unread: row.unread,
  };
}

export function auditSnapshot(value: object | null): Record<string, unknown> | null {
  return value === null
    ? null
    : (redactAuditValue(JSON.parse(JSON.stringify(value))) as Record<string, unknown>);
}

const sensitiveAuditFields = new Set([
  "accessToken",
  "appSpecificPassword",
  "amount",
  "balance",
  "bodyText",
  "conferenceUrl",
  "content",
  "description",
  "detail",
  "email",
  "encryptedCredentials",
  "from",
  "location",
  "merchant",
  "notes",
  "passwordHash",
  "raw",
  "refreshToken",
  "snippet",
  "subject",
  "title",
  "to",
  "tokenHash",
]);

function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      sensitiveAuditFields.has(key) ? "[redacted]" : redactAuditValue(nested),
    ]),
  );
}
