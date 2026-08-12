import type {
  attentionItems,
  calendarEvents,
  calendars,
  mailboxes,
  mailThreads,
  reminders,
  taskLists,
  users,
} from "@personal-os/database";
import type {
  AttentionItem,
  Calendar,
  CalendarEvent,
  CalendarEventBlock,
  Mailbox,
  MailThread,
  Reminder,
  Task,
  TaskList,
  User,
} from "@personal-os/domain";

type UserRow = typeof users.$inferSelect;
type AttentionItemRow = typeof attentionItems.$inferSelect;
type ReminderRow = typeof reminders.$inferSelect;
type TaskListRow = typeof taskLists.$inferSelect;
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
    setup: {
      completedAt: row.setupCompletedAt?.toISOString() ?? null,
      currentStep: row.setupCurrentStep,
      dismissedAt: row.setupDismissedAt?.toISOString() ?? null,
      selectedWorkspaces: row.setupSelectedWorkspaces,
      startedAt: row.setupStartedAt?.toISOString() ?? null,
      status: row.setupStatus,
    },
    theme: row.theme,
    planningTimezone: row.planningTimezone,
    homeLocation: row.homeLocation,
    workdayEndMinute: row.workdayEndMinute,
    workdayStartMinute: row.workdayStartMinute,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeAttentionItem(row: AttentionItemRow): AttentionItem {
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

export function serializeReminder(row: ReminderRow): Reminder {
  return {
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    id: row.id,
    notes: row.notes,
    priority: row.priority,
    source: {
      accountId: null,
      provider: "local",
      remoteId: row.id,
      revision: row.updatedAt.toISOString(),
      sourceType: "reminder",
    },
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

export function serializeTaskList(row: TaskListRow): TaskList {
  return {
    archivedAt: row.archivedAt?.toISOString() ?? null,
    availability: row.availability,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    description: row.description,
    id: row.id,
    kind: row.kind,
    name: row.name,
    revision: row.revision,
    source: null,
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
  accountId: string | null = null,
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
    source: {
      accountId,
      provider: row.provider,
      remoteId: row.remoteEventId ?? (row.provider === "local" ? row.id : null),
      revision: row.remoteEtag ?? row.updatedAt.toISOString(),
      sourceType: "calendar_event",
    },
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
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function auditSnapshot(value: object | null): Record<string, unknown> | null {
  return value === null
    ? null
    : (redactAuditValue(JSON.parse(JSON.stringify(value))) as Record<string, unknown>);
}

type DomainProfileAuditValue = {
  categories: unknown[];
  domain: string;
  instructions: unknown[];
  preferences: Record<string, unknown>;
  sourceContexts: unknown[];
  status: string;
  version: number;
};

type AttentionItemAuditValue = {
  domain: string;
  importance: string;
  kind: string;
  relatedEntityType: string | null;
  status: string;
  version: number;
};

type MailRuleAuditValue = {
  actions: Array<{ type: string }> | null;
  condition: { field: string; operator: string } | null;
  enabled: boolean;
  legacyAction: string;
  policy: string;
  sourceAccountIds: string[];
  version: number;
};

const domainProfileMutableFields = [
  "categories",
  "instructions",
  "objective",
  "preferences",
  "sourceContexts",
  "status",
  "summary",
] as const;

/**
 * Return only accountability metadata for shared profile audit records.
 * Domain profile content requires its domain read scope and must not leak to
 * principals that can read the audit log alone.
 */
export function auditDomainProfileMetadata(
  value: DomainProfileAuditValue | null,
  changedFields: string[],
): Record<string, unknown> | null {
  if (!value) return null;
  return {
    categoryCount: value.categories.length,
    changedFields,
    domain: value.domain,
    instructionCount: value.instructions.length,
    preferenceCount: Object.keys(value.preferences).length,
    sourceCount: value.sourceContexts.length,
    status: value.status,
    version: value.version,
  };
}

export function domainProfileChangedFields(before: object | null, after: object): string[] {
  const beforeRecord = before as Record<string, unknown> | null;
  const afterRecord = after as Record<string, unknown>;
  return domainProfileMutableFields.filter(
    (field) => JSON.stringify(beforeRecord?.[field]) !== JSON.stringify(afterRecord[field]),
  );
}

const mailRuleMutableFields = [
  "actions",
  "condition",
  "confidenceThreshold",
  "description",
  "enabled",
  "name",
  "policy",
  "profileId",
  "sourceAccountIds",
] as const;

export function mailRuleChangedFields(before: object | null, after: object): string[] {
  const beforeRecord = before as Record<string, unknown> | null;
  const afterRecord = after as Record<string, unknown>;
  return mailRuleMutableFields.filter(
    (field) => JSON.stringify(beforeRecord?.[field]) !== JSON.stringify(afterRecord[field]),
  );
}

/** Mail rule content and source topology require mail:read; audits expose metadata only. */
export function auditMailRuleMetadata(
  value: MailRuleAuditValue | null,
  changedFields: string[],
): Record<string, unknown> | null {
  if (!value) return null;
  const actionTypes = value.actions?.map((action) => action.type) ?? [value.legacyAction];
  return {
    actionCount: actionTypes.length,
    actionTypes: [...new Set(actionTypes)].sort(),
    changedFields,
    conditionField: value.condition?.field ?? "any",
    conditionOperator: value.condition?.operator ?? "contains",
    enabled: value.enabled,
    policy: value.policy,
    sourceCount: value.sourceAccountIds.length,
    version: value.version,
  };
}

/**
 * Attention audit records deliberately omit titles, summaries, entity IDs,
 * source references, remote IDs, and timing details.
 */
export function auditAttentionItemMetadata(
  value: AttentionItemAuditValue | null,
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
  "summary",
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
