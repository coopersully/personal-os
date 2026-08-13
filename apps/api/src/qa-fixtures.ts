import {
  attentionItems,
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  type Database,
  domainProfiles,
  financeAccounts,
  financeAlerts,
  financeBudgets,
  financeCategories,
  financeCategoryRules,
  financeClassificationDecisions,
  financeIncomeStreams,
  financeMerchantAliases,
  financeMerchants,
  financeProfiles,
  financeRecurringObligations,
  financeReviewCases,
  financeTransactions,
  goals,
  mailboxes,
  mailDrafts,
  mailMessages,
  mailRules,
  mailSnoozes,
  mailThreads,
  motives,
  pinterestConnections,
  reminders,
  taskLists,
  taskProjects,
  users,
} from "@personal-os/database";
import { addLocalDays, localDateAt, localDateTimeToUtc, localDateToIso } from "@personal-os/domain";
import { and, eq, inArray, or } from "drizzle-orm";
import { hashPassword } from "./security.js";

export const QA_PASSWORD = ["Testing", "12345", "!"].join("");
export const DEMO_QA_PASSWORD = String.fromCodePoint(
  35,
  37,
  89,
  120,
  113,
  68,
  50,
  75,
  122,
  37,
  56,
  83,
  35,
  51,
);

export type QaFixtureScenario =
  | "complete"
  | "degraded"
  | "empty"
  | "onboarding"
  | "onboarding-apple"
  | "onboarding-finances"
  | "onboarding-google"
  | "onboarding-ready";

export type QaFixtureAccount = {
  description: string;
  displayName: string;
  email: string;
  id: string;
  key: string;
  password: string;
  scenario: QaFixtureScenario;
};

export const qaFixtureAccounts = [
  {
    description: "Polished, fully populated product demo across every workspace.",
    displayName: "Alex Morgan",
    email: "demo+full@ilo.test",
    id: "f1000000-0000-4000-8000-000000000001",
    key: "demo-full",
    password: DEMO_QA_PASSWORD,
    scenario: "complete",
  },
  {
    description: "Reusable loaded workspace with broad, realistic personal data.",
    displayName: "Jordan Lee",
    email: "qa+loaded@ilo.test",
    id: "f2000000-0000-4000-8000-000000000001",
    key: "qa-loaded",
    password: QA_PASSWORD,
    scenario: "complete",
  },
  {
    description: "Brand-new, unverified account that opens at the start of onboarding.",
    displayName: "Sam Rivera",
    email: "qa+onboarding-new@ilo.test",
    id: "f3000000-0000-4000-8000-000000000001",
    key: "qa-onboarding-new",
    password: QA_PASSWORD,
    scenario: "onboarding",
  },
  {
    description: "Partially configured account that resumes on the Google connection step.",
    displayName: "Casey Chen",
    email: "qa+onboarding-google@ilo.test",
    id: "f4000000-0000-4000-8000-000000000001",
    key: "qa-onboarding-google",
    password: QA_PASSWORD,
    scenario: "onboarding-google",
  },
  {
    description: "Completed setup with no material, useful for empty-state QA.",
    displayName: "Taylor Reed",
    email: "qa+empty@ilo.test",
    id: "f5000000-0000-4000-8000-000000000001",
    key: "qa-empty",
    password: QA_PASSWORD,
    scenario: "empty",
  },
  {
    description: "Populated workspace with connector and financial reauthorization failures.",
    displayName: "Morgan Bell",
    email: "qa+recovery@ilo.test",
    id: "f6000000-0000-4000-8000-000000000001",
    key: "qa-recovery",
    password: QA_PASSWORD,
    scenario: "degraded",
  },
  {
    description: "Partially configured account that resumes on the Apple connection step.",
    displayName: "Avery Patel",
    email: "qa+onboarding-apple@ilo.test",
    id: "f7000000-0000-4000-8000-000000000001",
    key: "qa-onboarding-apple",
    password: QA_PASSWORD,
    scenario: "onboarding-apple",
  },
  {
    description: "Partially configured account that resumes on the finance connection step.",
    displayName: "Riley Brooks",
    email: "qa+onboarding-finances@ilo.test",
    id: "f8000000-0000-4000-8000-000000000001",
    key: "qa-onboarding-finances",
    password: QA_PASSWORD,
    scenario: "onboarding-finances",
  },
  {
    description: "Partially configured account at the final onboarding summary.",
    displayName: "Quinn Davis",
    email: "qa+onboarding-ready@ilo.test",
    id: "f9000000-0000-4000-8000-000000000001",
    key: "qa-onboarding-ready",
    password: QA_PASSWORD,
    scenario: "onboarding-ready",
  },
] as const satisfies readonly QaFixtureAccount[];

type FixtureData = {
  attentionItems: Array<typeof attentionItems.$inferInsert>;
  auditEvents: Array<typeof auditEvents.$inferInsert>;
  calendarAccounts: Array<typeof calendarAccounts.$inferInsert>;
  calendarEvents: Array<typeof calendarEvents.$inferInsert>;
  calendars: Array<typeof calendars.$inferInsert>;
  domainProfiles: Array<typeof domainProfiles.$inferInsert>;
  financeAccounts: Array<typeof financeAccounts.$inferInsert>;
  financeAlerts: Array<typeof financeAlerts.$inferInsert>;
  financeBudgets: Array<typeof financeBudgets.$inferInsert>;
  financeCategories: Array<typeof financeCategories.$inferInsert>;
  financeCategoryRules: Array<typeof financeCategoryRules.$inferInsert>;
  financeClassificationDecisions: Array<typeof financeClassificationDecisions.$inferInsert>;
  financeIncomeStreams: Array<typeof financeIncomeStreams.$inferInsert>;
  financeMerchantAliases: Array<typeof financeMerchantAliases.$inferInsert>;
  financeMerchants: Array<typeof financeMerchants.$inferInsert>;
  financeProfiles: Array<typeof financeProfiles.$inferInsert>;
  financeRecurringObligations: Array<typeof financeRecurringObligations.$inferInsert>;
  financeReviewCases: Array<typeof financeReviewCases.$inferInsert>;
  financeTransactions: Array<typeof financeTransactions.$inferInsert>;
  goals: Array<typeof goals.$inferInsert>;
  mailDrafts: Array<typeof mailDrafts.$inferInsert>;
  mailMessages: Array<typeof mailMessages.$inferInsert>;
  mailRules: Array<typeof mailRules.$inferInsert>;
  mailSnoozes: Array<typeof mailSnoozes.$inferInsert>;
  mailThreads: Array<typeof mailThreads.$inferInsert>;
  mailboxes: Array<typeof mailboxes.$inferInsert>;
  motives: Array<typeof motives.$inferInsert>;
  pinterestConnections: Array<typeof pinterestConnections.$inferInsert>;
  reminders: Array<typeof reminders.$inferInsert>;
  taskLists: Array<typeof taskLists.$inferInsert>;
  taskProjects: Array<typeof taskProjects.$inferInsert>;
  users: Array<typeof users.$inferInsert>;
};

function emptyFixtureData(): FixtureData {
  return {
    attentionItems: [],
    auditEvents: [],
    calendarAccounts: [],
    calendarEvents: [],
    calendars: [],
    domainProfiles: [],
    financeAccounts: [],
    financeAlerts: [],
    financeBudgets: [],
    financeCategories: [],
    financeCategoryRules: [],
    financeClassificationDecisions: [],
    financeIncomeStreams: [],
    financeMerchantAliases: [],
    financeMerchants: [],
    financeProfiles: [],
    financeRecurringObligations: [],
    financeReviewCases: [],
    financeTransactions: [],
    goals: [],
    mailDrafts: [],
    mailMessages: [],
    mailRules: [],
    mailSnoozes: [],
    mailThreads: [],
    mailboxes: [],
    motives: [],
    pinterestConnections: [],
    reminders: [],
    taskLists: [],
    taskProjects: [],
    users: [],
  };
}

function fixtureId(account: QaFixtureAccount, record: number): string {
  return `${account.id.slice(0, 8)}-0000-4000-8000-${record.toString(16).padStart(12, "0")}`;
}

function addBaseAccount(
  data: FixtureData,
  account: QaFixtureAccount,
  passwordHash: string,
  now: Date,
): void {
  const timezone = "America/New_York";
  const localAccountId = fixtureId(account, 10);
  const localCalendarId = fixtureId(account, 20);
  const setup =
    account.scenario === "onboarding"
      ? {
          setupCompletedAt: null,
          setupCurrentStep: "welcome" as const,
          setupDismissedAt: null,
          setupStartedAt: null,
          setupStatus: "not_started" as const,
        }
      : account.scenario.startsWith("onboarding-")
        ? {
            setupCompletedAt: null,
            setupCurrentStep:
              account.scenario === "onboarding-apple"
                ? ("icloud" as const)
                : account.scenario === "onboarding-finances"
                  ? ("finances" as const)
                  : account.scenario === "onboarding-ready"
                    ? ("ready" as const)
                    : ("google" as const),
            setupDismissedAt: null,
            setupStartedAt: new Date(now.getTime() - 10 * 60_000),
            setupStatus: "in_progress" as const,
          }
        : {
            setupCompletedAt: new Date(now.getTime() - 30 * 86_400_000),
            setupCurrentStep: "ready" as const,
            setupDismissedAt: null,
            setupStartedAt: new Date(now.getTime() - 30 * 86_400_000 - 15 * 60_000),
            setupStatus: "complete" as const,
          };
  data.users.push({
    accentColor: account.scenario === "degraded" ? "#d97855" : "#c7d23c",
    createdAt: new Date(now.getTime() - 45 * 86_400_000),
    displayName: account.displayName,
    email: account.email,
    emailVerifiedAt: account.scenario === "onboarding" ? null : now,
    homeLocation: {
      coordinates: {
        latitude: 40.7128,
        longitude: -74.006,
      },
      label: "New York, NY",
      timezone,
    },
    id: account.id,
    passwordHash,
    planningTimezone: timezone,
    setupSelectedWorkspaces:
      account.scenario === "onboarding-google" || account.scenario === "onboarding-apple"
        ? ["calendar", "mail"]
        : account.scenario === "onboarding-finances"
          ? ["tasks", "finances"]
          : account.scenario === "onboarding-ready"
            ? ["tasks"]
            : ["calendar", "tasks", "mail", "finances"],
    theme: "system",
    updatedAt: now,
    workdayEndMinute: 17 * 60,
    workdayStartMinute: 9 * 60,
    ...setup,
  });
  data.calendarAccounts.push({
    calendarEnabled: true,
    createdAt: now,
    id: localAccountId,
    label: "Personal",
    mailEnabled: false,
    provider: "local",
    providerAccountId: account.id,
    syncStatus: "idle",
    updatedAt: now,
    userId: account.id,
  });
  data.calendars.push({
    accountId: localAccountId,
    color: "#5B6CFF",
    createdAt: now,
    id: localCalendarId,
    isPrimary: true,
    isSelected: true,
    isWritable: true,
    name: "Personal",
    provider: "local",
    remoteCalendarId: account.id,
    timezone,
    updatedAt: now,
    userId: account.id,
  });
}

function addLoadedWorkspace(
  data: FixtureData,
  account: QaFixtureAccount,
  now: Date,
  degraded: boolean,
): void {
  const timezone = "America/New_York";
  const today = localDateAt(now, timezone);
  const yesterday = addLocalDays(today, -1);
  const tomorrow = addLocalDays(today, 1);
  const todayIso = localDateToIso(today);
  const yesterdayIso = localDateToIso(yesterday);
  const month = todayIso.slice(0, 7);
  const localCalendarId = fixtureId(account, 20);
  const connectedAccountId = fixtureId(account, 11);
  const workCalendarId = fixtureId(account, 21);
  const familyCalendarId = fixtureId(account, 22);
  const taskInboxId = fixtureId(account, 230);
  const personalTaskListId = fixtureId(account, 231);
  const workTaskListId = fixtureId(account, 232);
  const shoppingTaskListId = fixtureId(account, 233);
  const personalQuarterlyProjectId = fixtureId(account, 240);
  const workQuarterlyProjectId = fixtureId(account, 241);
  const workLaunchProjectId = fixtureId(account, 242);
  const inboxId = fixtureId(account, 300);
  const sentId = fixtureId(account, 301);
  const draftsId = fixtureId(account, 302);
  const checkingId = fixtureId(account, 400);
  const savingsId = fixtureId(account, 401);
  const brokerageId = fixtureId(account, 402);
  const creditCardId = fixtureId(account, 403);
  const diningCategoryId = fixtureId(account, 420);
  const groceriesCategoryId = fixtureId(account, 421);
  const housingCategoryId = fixtureId(account, 422);
  const incomeCategoryId = fixtureId(account, 423);
  const subscriptionsCategoryId = fixtureId(account, 424);
  const cafeMerchantId = fixtureId(account, 430);
  const marketMerchantId = fixtureId(account, 431);
  const streamId = fixtureId(account, 470);
  const obligationId = fixtureId(account, 471);
  const transaction = (record: number) => fixtureId(account, 440 + record);
  const at = (day: typeof today, minute: number) => localDateTimeToUtc(day, minute, timezone);
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

  data.taskLists.push(
    {
      color: "slate",
      createdAt: ago(24 * 30),
      description: "Personal administration and home commitments.",
      id: personalTaskListId,
      kind: "standard",
      name: "Personal",
      normalizedName: "personal",
      updatedAt: now,
      userId: account.id,
    },
    {
      color: "blue",
      createdAt: ago(24 * 30),
      description: "Work commitments and finite outcomes.",
      id: workTaskListId,
      kind: "standard",
      name: "Work",
      normalizedName: "work",
      updatedAt: now,
      userId: account.id,
    },
    {
      color: "amber",
      createdAt: ago(24 * 20),
      description: "Things to compare or pick up.",
      id: shoppingTaskListId,
      kind: "standard",
      name: "Shopping",
      normalizedName: "shopping",
      updatedAt: now,
      userId: account.id,
    },
  );
  data.taskProjects.push(
    {
      createdAt: ago(24 * 20),
      id: personalQuarterlyProjectId,
      lifecycle: "open",
      listId: personalTaskListId,
      name: "Quarterly reset",
      normalizedName: "quarterly reset",
      notes: "Close a small set of recurring personal loose ends.",
      targetDate: localDateToIso(addLocalDays(today, 30)),
      updatedAt: now,
      userId: account.id,
      why: "Keep routine administration from becoming background stress.",
    },
    {
      createdAt: ago(24 * 20),
      id: workQuarterlyProjectId,
      lifecycle: "open",
      listId: workTaskListId,
      name: "Quarterly reset",
      normalizedName: "quarterly reset",
      notes: "Prepare the current work cycle for a clean close.",
      targetDate: localDateToIso(addLocalDays(today, 21)),
      updatedAt: now,
      userId: account.id,
      why: "Make the next planning cycle start from an explicit state.",
    },
    {
      createdAt: ago(24 * 10),
      id: workLaunchProjectId,
      lifecycle: "open",
      listId: workTaskListId,
      name: "Launch follow-through",
      normalizedName: "launch follow-through",
      notes: "A same-List destination for Task Project moves.",
      targetDate: localDateToIso(addLocalDays(today, 14)),
      updatedAt: now,
      userId: account.id,
      why: "Keep post-launch work grouped without changing its List.",
    },
  );

  data.calendarAccounts.push({
    calendarEnabled: true,
    createdAt: ago(24 * 40),
    email: account.email,
    id: connectedAccountId,
    label: degraded ? "Google needs attention" : "Fixture Google",
    lastSyncedAt: degraded ? ago(24 * 5) : ago(1),
    mailEnabled: true,
    provider: "google",
    providerAccountId: `fixture-google-${account.key}`,
    syncError: degraded
      ? "Google authorization is no longer valid. Reconnect to resume syncing."
      : null,
    syncErrorCategory: degraded ? "authorization" : null,
    syncErrorCode: degraded ? "fixture_google_authorization_failed" : null,
    syncFailureCount: degraded ? 1 : 0,
    syncRecovery: degraded ? "reconnect" : null,
    syncStatus: degraded ? "error" : "idle",
    updatedAt: now,
    userId: account.id,
  });
  data.calendars.push(
    {
      accountId: connectedAccountId,
      color: "#34A853",
      createdAt: ago(24 * 40),
      id: workCalendarId,
      isPrimary: false,
      isSelected: true,
      isWritable: false,
      lastSyncedAt: degraded ? ago(24 * 5) : ago(1),
      name: "Work",
      provider: "google",
      remoteCalendarId: `fixture-work-${account.key}`,
      timezone,
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: connectedAccountId,
      color: "#F6BF26",
      createdAt: ago(24 * 40),
      id: familyCalendarId,
      isPrimary: false,
      isSelected: true,
      isWritable: false,
      lastSyncedAt: degraded ? ago(24 * 5) : ago(1),
      name: "Family",
      provider: "google",
      remoteCalendarId: `fixture-family-${account.key}`,
      timezone,
      updatedAt: now,
      userId: account.id,
    },
  );
  data.calendarEvents.push(
    {
      allDay: true,
      calendarId: localCalendarId,
      createdAt: ago(72),
      endsAt: at(tomorrow, 0),
      id: fixtureId(account, 100),
      notes: "Keep the day intentionally spacious.",
      provider: "local",
      reminders: [],
      startsAt: at(today, 0),
      status: "confirmed",
      timezone,
      title: "Quarterly planning day",
      transparency: "free",
      updatedAt: now,
      userId: account.id,
      visibility: "public",
    },
    {
      attendees: [
        {
          email: account.email,
          isOrganizer: true,
          name: account.displayName,
          response: "accepted",
        },
        {
          email: "maya@example.com",
          isOrganizer: false,
          name: "Maya Chen",
          response: "accepted",
        },
      ],
      calendarId: workCalendarId,
      conferenceUrl: "https://meet.google.com/ilo-demo-room",
      createdAt: ago(48),
      endsAt: at(today, 10 * 60),
      id: fixtureId(account, 101),
      location: "Google Meet",
      notes: "Decide the smallest useful launch scope and name the open risks.",
      provider: "google",
      raw: { fixture: true },
      remoteEventId: `strategy-${todayIso}`,
      startsAt: at(today, 9 * 60),
      status: "confirmed",
      syncedAt: ago(1),
      timezone,
      title: "Product strategy review",
      updatedAt: now,
      userId: account.id,
    },
    {
      calendarId: workCalendarId,
      createdAt: ago(36),
      endsAt: at(today, 11 * 60 + 30),
      id: fixtureId(account, 102),
      location: "Studio 3",
      provider: "google",
      raw: { fixture: true },
      remoteEventId: `critique-${todayIso}`,
      startsAt: at(today, 10 * 60 + 30),
      status: "tentative",
      syncedAt: ago(1),
      timezone,
      title: "Design critique",
      updatedAt: now,
      userId: account.id,
    },
    {
      calendarId: workCalendarId,
      createdAt: ago(36),
      endsAt: at(today, 11 * 60 + 45),
      id: fixtureId(account, 103),
      provider: "google",
      raw: { fixture: true },
      remoteEventId: `research-${todayIso}`,
      startsAt: at(today, 10 * 60 + 45),
      status: "confirmed",
      syncedAt: ago(1),
      timezone,
      title: "Customer research debrief",
      updatedAt: now,
      userId: account.id,
    },
    {
      calendarId: localCalendarId,
      createdAt: ago(24),
      endsAt: at(today, 15 * 60 + 30),
      eventType: "focus",
      id: fixtureId(account, 104),
      notes: "Notifications off. Draft the decision memo.",
      provider: "local",
      startsAt: at(today, 14 * 60),
      status: "confirmed",
      timezone,
      title: "Focus block",
      updatedAt: now,
      userId: account.id,
      visibility: "private",
    },
    {
      calendarId: familyCalendarId,
      createdAt: ago(24),
      endsAt: at(today, 19 * 60 + 30),
      id: fixtureId(account, 105),
      location: "Via Carota",
      provider: "google",
      raw: { fixture: true },
      remoteEventId: `dinner-${todayIso}`,
      startsAt: at(today, 18 * 60),
      status: "confirmed",
      syncedAt: ago(1),
      timezone,
      title: "Dinner with Maya",
      updatedAt: now,
      userId: account.id,
    },
    {
      calendarId: localCalendarId,
      createdAt: ago(12),
      endsAt: at(tomorrow, 11 * 60),
      id: fixtureId(account, 106),
      location: "Broadway Dental",
      provider: "local",
      reminders: [{ minutes: 60 }],
      startsAt: at(tomorrow, 10 * 60),
      status: "confirmed",
      timezone,
      title: "Dentist appointment",
      updatedAt: now,
      userId: account.id,
    },
  );
  data.reminders.push(
    {
      createdAt: ago(72),
      dueAt: at(yesterday, 16 * 60),
      id: fixtureId(account, 200),
      kind: "reminder",
      notes: "Confirm the final attendee list.",
      priority: "high",
      status: "next",
      tags: ["launch"],
      timezone,
      title: "Send launch review agenda",
      updatedAt: now,
      userId: account.id,
    },
    {
      createdAt: ago(48),
      dueAt: at(today, 13 * 60),
      estimateMinutes: 20,
      id: fixtureId(account, 201),
      kind: "task",
      notes: "Include activation, retention, and qualitative feedback.",
      priority: "high",
      status: "inbox",
      tags: ["work", "writing"],
      taskLifecycle: "open",
      taskListId: workTaskListId,
      taskProjectId: workQuarterlyProjectId,
      taskRevision: 1,
      taskWhy: "Give the team a concise record of the week.",
      timezone,
      title: "Draft weekly product update",
      updatedAt: now,
      userId: account.id,
    },
    {
      createdAt: ago(30),
      estimateMinutes: 45,
      id: fixtureId(account, 202),
      kind: "task",
      notes: null,
      priority: "medium",
      status: "inbox",
      tags: ["home"],
      taskLifecycle: "open",
      taskListId: taskInboxId,
      taskRevision: 1,
      taskWhy: "Choose coverage before the current policy renews.",
      title: "Compare renters insurance renewals",
      updatedAt: now,
      userId: account.id,
    },
    {
      createdAt: ago(24),
      dueAt: at(tomorrow, 17 * 60),
      estimateMinutes: 30,
      id: fixtureId(account, 203),
      kind: "task",
      priority: "medium",
      scheduledAt: at(tomorrow, 14 * 60),
      status: "scheduled",
      tags: ["finance"],
      taskLifecycle: "open",
      taskListId: personalTaskListId,
      taskRevision: 1,
      taskWhy: "Remove subscriptions that are no longer useful.",
      timezone,
      title: "Review monthly subscriptions",
      updatedAt: now,
      userId: account.id,
    },
    {
      completedAt: ago(20),
      createdAt: ago(72),
      dueAt: at(yesterday, 12 * 60),
      estimateMinutes: 15,
      id: fixtureId(account, 204),
      kind: "task",
      priority: "low",
      status: "completed",
      tags: ["admin"],
      taskLifecycle: "completed",
      taskListId: personalTaskListId,
      taskProjectId: personalQuarterlyProjectId,
      taskRevision: 1,
      taskWhy: "Keep preventive care scheduled.",
      timezone,
      title: "Book dentist appointment",
      updatedAt: ago(20),
      userId: account.id,
    },
    {
      createdAt: ago(6),
      dueAt: null,
      id: fixtureId(account, 205),
      kind: "reminder",
      priority: "low",
      status: "inbox",
      tags: [],
      title: "Call Mom",
      updatedAt: now,
      userId: account.id,
    },
    {
      createdAt: ago(18),
      id: fixtureId(account, 206),
      kind: "task",
      priority: "low",
      status: "cancelled",
      tags: ["shopping"],
      taskCancelledAt: ago(3),
      taskLifecycle: "cancelled",
      taskListId: shoppingTaskListId,
      taskRevision: 1,
      taskWhy: "Avoid buying a replacement that is no longer needed.",
      title: "Replace spare charging cable",
      updatedAt: ago(3),
      userId: account.id,
    },
    {
      createdAt: ago(12),
      deletedAt: ago(2),
      id: fixtureId(account, 207),
      kind: "task",
      priority: "medium",
      status: "inbox",
      tags: ["shopping"],
      taskLifecycle: "open",
      taskListId: shoppingTaskListId,
      taskRevision: 1,
      taskWhy: "Keep an intentionally recoverable Trash example.",
      title: "Compare desk lamps",
      updatedAt: ago(2),
      userId: account.id,
    },
    {
      createdAt: ago(8),
      estimateMinutes: 25,
      id: fixtureId(account, 208),
      kind: "task",
      priority: "medium",
      status: "inbox",
      tags: ["work"],
      taskLifecycle: "open",
      taskListId: workTaskListId,
      taskProjectId: workQuarterlyProjectId,
      taskRevision: 1,
      taskWhy: "Exercise moving a Task between Projects without changing Lists.",
      title: "Prepare launch follow-through",
      updatedAt: now,
      userId: account.id,
    },
  );
  data.goals.push(
    {
      createdAt: ago(24 * 30),
      description: "Protect two uninterrupted blocks each weekday.",
      id: fixtureId(account, 210),
      progress: 64,
      status: "active",
      targetDate: localDateToIso(addLocalDays(today, 60)),
      title: "Build a sustainable focus rhythm",
      updatedAt: now,
      userId: account.id,
    },
    {
      createdAt: ago(24 * 20),
      description: "Keep fixed costs visible and avoid surprise renewals.",
      id: fixtureId(account, 211),
      progress: 35,
      status: "active",
      targetDate: localDateToIso(addLocalDays(today, 90)),
      title: "Simplify monthly finances",
      updatedAt: now,
      userId: account.id,
    },
  );
  data.motives.push(
    {
      createdAt: ago(24 * 30),
      detail: "Make room for thoughtful work without losing the rest of life.",
      id: fixtureId(account, 212),
      isActive: true,
      title: "Calm momentum",
      updatedAt: now,
      userId: account.id,
    },
    {
      createdAt: ago(24 * 20),
      detail: "Choose fewer commitments and follow through on them.",
      id: fixtureId(account, 213),
      isActive: true,
      title: "Intentional follow-through",
      updatedAt: now,
      userId: account.id,
    },
  );
  data.mailboxes.push(
    {
      accountId: connectedAccountId,
      createdAt: ago(24 * 40),
      id: inboxId,
      lastSyncedAt: degraded ? ago(24 * 5) : ago(1),
      name: "Inbox",
      provider: "google",
      remoteMailboxId: "INBOX",
      role: "inbox",
      totalCount: 5,
      unreadCount: 2,
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: connectedAccountId,
      createdAt: ago(24 * 40),
      id: sentId,
      lastSyncedAt: degraded ? ago(24 * 5) : ago(1),
      name: "Sent",
      provider: "google",
      remoteMailboxId: "SENT",
      role: "sent",
      totalCount: 18,
      unreadCount: 0,
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: connectedAccountId,
      createdAt: ago(24 * 40),
      id: draftsId,
      lastSyncedAt: degraded ? ago(24 * 5) : ago(1),
      name: "Drafts",
      provider: "google",
      remoteMailboxId: "DRAFT",
      role: "drafts",
      totalCount: 1,
      unreadCount: 0,
      updatedAt: now,
      userId: account.id,
    },
  );
  const threads = [
    {
      from: { address: "maya@example.com", name: "Maya Chen" },
      hours: 2,
      record: 310,
      snippet: "I added the retention cut and the open questions for Friday.",
      starred: true,
      subject: "Board packet for Friday",
      unread: true,
    },
    {
      from: { address: "statements@examplebank.test", name: "Example Bank" },
      hours: 6,
      record: 311,
      snippet: "Your July statement is now available.",
      starred: false,
      subject: "Your July statement is ready",
      unread: false,
    },
    {
      from: { address: "reservations@example.com", name: "Via Carota" },
      hours: 20,
      record: 312,
      snippet: "Your table for two is confirmed for 6:00 PM.",
      starred: false,
      subject: "Dinner reservation confirmed",
      unread: false,
    },
    {
      from: { address: "travel@example.com", name: "Travel Desk" },
      hours: 28,
      record: 313,
      snippet: "Please approve the fare change before tomorrow afternoon.",
      starred: false,
      subject: "Action needed: travel approval",
      unread: true,
    },
    {
      from: { address: "cohort@example.org", name: "Design Systems Cohort" },
      hours: 54,
      record: 314,
      snippet: "Here is everything you need before the first session.",
      starred: false,
      subject: "Welcome to the design systems cohort",
      unread: false,
    },
  ];
  for (const [index, thread] of threads.entries()) {
    const threadId = fixtureId(account, thread.record);
    data.mailThreads.push({
      accountId: connectedAccountId,
      bodyText: thread.snippet,
      createdAt: ago(thread.hours),
      from: thread.from,
      id: threadId,
      messageCount: index === 0 ? 2 : 1,
      provider: "google",
      receivedAt: ago(thread.hours),
      remoteMailboxIds: ["INBOX"],
      remoteThreadId: `fixture-thread-${account.key}-${index}`,
      snippet: thread.snippet,
      starred: thread.starred,
      subject: thread.subject,
      to: [{ address: account.email, name: account.displayName }],
      unread: thread.unread,
      updatedAt: now,
      userId: account.id,
    });
    data.mailMessages.push({
      attachments:
        index === 0
          ? [
              {
                contentType: "application/pdf",
                filename: "board-packet.pdf",
                id: `fixture-attachment-${account.key}`,
                size: 248_300,
              },
            ]
          : [],
      bodyText: thread.snippet,
      cc: [],
      createdAt: ago(thread.hours),
      from: thread.from,
      id: fixtureId(account, 320 + index),
      receivedAt: ago(thread.hours),
      remoteMessageId: `fixture-message-${account.key}-${index}`,
      threadId,
      to: [{ address: account.email, name: account.displayName }],
      updatedAt: now,
    });
  }
  data.mailMessages.push({
    attachments: [],
    bodyText: "Looks good. I will add the final appendix before lunch.",
    cc: [],
    createdAt: ago(1),
    from: { address: account.email, name: account.displayName },
    id: fixtureId(account, 326),
    receivedAt: ago(1),
    remoteMessageId: `fixture-message-${account.key}-reply`,
    threadId: fixtureId(account, 310),
    to: [{ address: "maya@example.com", name: "Maya Chen" }],
    updatedAt: now,
  });
  data.mailDrafts.push({
    accountId: connectedAccountId,
    body: "Thanks for the thoughtful notes. I’ll send the revised outline tomorrow.",
    createdAt: ago(3),
    id: fixtureId(account, 330),
    subject: "Re: Research synthesis",
    to: [{ address: "research@example.com", name: "Research Team" }],
    updatedAt: ago(2),
    userId: account.id,
  });
  data.mailSnoozes.push({
    createdAt: now,
    id: fixtureId(account, 331),
    threadId: fixtureId(account, 314),
    until: at(tomorrow, 9 * 60),
    updatedAt: now,
    userId: account.id,
  });
  const mailProfileId = fixtureId(account, 333);
  data.domainProfiles.push({
    categories: [
      {
        description: "Messages that need a decision, response, or near-term action.",
        examples: ["Travel approval", "Board packet"],
        key: "needs_attention",
        label: "Needs attention",
      },
      {
        description: "Expected routine notices that can leave the unread queue.",
        examples: ["Monthly statement"],
        key: "routine_notice",
        label: "Routine notice",
      },
    ],
    createdAt: ago(24 * 10),
    domain: "mail",
    id: mailProfileId,
    instructions: [
      "Keep messages that need a response or decision visible.",
      "Mark expected statement notices as read while preserving the message.",
      "Treat payment failures, security warnings, and delivery problems as exceptions.",
    ],
    objective: "Keep the inbox focused on decisions and time-sensitive exceptions.",
    preferences: {
      inboxStyle: "signal_only",
      routineOrderRetentionDays: 1,
    },
    sourceContexts: [
      {
        notes: "Personal and household communication.",
        purpose: "Primary inbox",
        sourceId: connectedAccountId,
        sourceLabel: "Fixture Google",
      },
    ],
    status: "active",
    summary:
      "Keep actionable messages visible, quietly clear expected routine notices, and preserve exceptions.",
    updatedAt: now,
    userId: account.id,
  });
  data.mailRules.push({
    actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
    condition: {
      field: "sender",
      operator: "equals",
      value: "statements@examplebank.test",
    },
    createdAt: ago(24 * 10),
    description: "Keep routine bank statements out of the unread queue.",
    enabled: true,
    id: fixtureId(account, 332),
    name: "Statements",
    policy: "approved_rule",
    profileId: mailProfileId,
    sourceAccountIds: [connectedAccountId],
    updatedAt: now,
    userId: account.id,
  });
  data.mailRules.push({
    actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
    condition: {
      field: "sender",
      operator: "contains",
      value: "news",
    },
    createdAt: ago(12),
    description: "A safe review fixture for the Agent Access action queue.",
    enabled: false,
    id: fixtureId(account, 334),
    name: "Fixture newsletters",
    policy: "preview",
    profileId: mailProfileId,
    sourceAccountIds: [connectedAccountId],
    updatedAt: ago(1),
    userId: account.id,
  });

  const attentionDomains = ["mail", "calendar", "tasks", "finances"] as const;
  const attentionLabels = {
    calendar: "Calendar",
    finances: "Finances",
    mail: "Mail",
    tasks: "Tasks",
  } as const;
  const attentionImportance = ["critical", "high", "normal", "low"] as const;
  for (let index = 0; index < 8; index += 1) {
    const domain = attentionDomains[
      index % attentionDomains.length
    ] as (typeof attentionDomains)[number];
    data.attentionItems.push({
      createdAt: ago(20 - index),
      domain,
      id: fixtureId(account, 520 + index),
      importance: attentionImportance[
        index % attentionImportance.length
      ] as (typeof attentionImportance)[number],
      kind: index % 2 === 0 ? "important" : "follow_up",
      occursAt: ago(8 - index),
      status: "open",
      summary: `Resolve deterministic ${domain} fixture work before the agent continues.`,
      title: `${attentionLabels[domain]} fixture attention ${index + 1}`,
      updatedAt: ago(8 - index),
      userId: account.id,
    });
  }

  data.financeAccounts.push(
    {
      balance: 842_534,
      createdAt: ago(24 * 90),
      id: checkingId,
      institution: "Fixture Credit Union",
      kind: "cash",
      lastSyncedAt: ago(2),
      name: "Everyday checking",
      provider: "manual",
      status: "manual",
      updatedAt: now,
      userId: account.id,
    },
    {
      balance: 1_520_000,
      createdAt: ago(24 * 90),
      id: savingsId,
      institution: "Fixture Credit Union",
      kind: "cash",
      lastSyncedAt: ago(2),
      name: "Emergency savings",
      provider: "manual",
      status: "manual",
      updatedAt: now,
      userId: account.id,
    },
    {
      balance: 4_285_000,
      createdAt: ago(24 * 90),
      id: brokerageId,
      institution: "Fixture Investments",
      kind: "investment",
      lastSyncedAt: ago(6),
      name: "Brokerage",
      provider: "manual",
      status: "manual",
      updatedAt: now,
      userId: account.id,
    },
    {
      balance: 124_750,
      createdAt: ago(24 * 90),
      id: creditCardId,
      institution: "Fixture Card",
      kind: "debt",
      lastSyncedAt: degraded ? ago(24 * 7) : ago(3),
      name: "Travel card",
      provider: degraded ? "plaid" : "manual",
      providerAccountId: degraded ? `fixture-card-${account.key}` : null,
      status: degraded ? "needs_reauth" : "manual",
      updatedAt: now,
      userId: account.id,
    },
  );
  data.financeCategories.push(
    {
      color: "#F59E0B",
      createdAt: now,
      group: "Spending",
      id: diningCategoryId,
      isSystem: true,
      name: "Dining",
      slug: "dining",
      updatedAt: now,
      userId: account.id,
    },
    {
      color: "#10B981",
      createdAt: now,
      group: "Spending",
      id: groceriesCategoryId,
      isSystem: true,
      name: "Groceries",
      slug: "groceries",
      updatedAt: now,
      userId: account.id,
    },
    {
      color: "#6366F1",
      createdAt: now,
      group: "Essential",
      id: housingCategoryId,
      isSystem: true,
      name: "Housing",
      slug: "housing",
      updatedAt: now,
      userId: account.id,
    },
    {
      color: "#22C55E",
      createdAt: now,
      group: "Financial",
      id: incomeCategoryId,
      isSystem: true,
      name: "Income",
      slug: "income",
      updatedAt: now,
      userId: account.id,
    },
    {
      color: "#EC4899",
      createdAt: now,
      group: "Spending",
      id: subscriptionsCategoryId,
      isSystem: true,
      name: "Subscriptions",
      slug: "subscriptions",
      updatedAt: now,
      userId: account.id,
    },
  );
  data.financeMerchants.push(
    {
      createdAt: ago(24 * 30),
      displayName: "Corner Cafe",
      id: cafeMerchantId,
      isUserConfirmed: true,
      normalizedName: "corner cafe",
      updatedAt: now,
      userId: account.id,
    },
    {
      createdAt: ago(24 * 30),
      displayName: "Neighborhood Market",
      id: marketMerchantId,
      isUserConfirmed: true,
      normalizedName: "neighborhood market",
      updatedAt: now,
      userId: account.id,
    },
  );
  data.financeMerchantAliases.push(
    {
      confidence: 10_000,
      createdAt: now,
      id: fixtureId(account, 435),
      merchantId: cafeMerchantId,
      normalizedName: "corner cafe nyc",
      rawName: "CORNER CAFE NYC #042",
      source: "user",
      updatedAt: now,
      userId: account.id,
    },
    {
      confidence: 10_000,
      createdAt: now,
      id: fixtureId(account, 436),
      merchantId: marketMerchantId,
      normalizedName: "neighborhood market",
      rawName: "NEIGHBORHOOD MARKET",
      source: "user",
      updatedAt: now,
      userId: account.id,
    },
  );
  data.financeTransactions.push(
    {
      accountId: checkingId,
      amount: 412_500,
      category: "INCOME",
      categoryConfidence: 10_000,
      categoryId: incomeCategoryId,
      categorySource: "provider",
      createdAt: ago(24 * 7),
      direction: "income",
      id: transaction(0),
      merchant: "ILO LABS PAYROLL",
      needsReview: false,
      providerTransactionId: `fixture-income-${todayIso}`,
      transactionDate: localDateToIso(addLocalDays(today, -7)),
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: checkingId,
      amount: 2_850,
      category: "Dining",
      categoryConfidence: 10_000,
      categoryId: diningCategoryId,
      categorySource: "user",
      createdAt: ago(5),
      direction: "expense",
      id: transaction(1),
      merchant: "CORNER CAFE NYC #042",
      merchantId: cafeMerchantId,
      needsReview: false,
      transactionDate: todayIso,
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: checkingId,
      amount: 8_742,
      category: "Groceries",
      categoryConfidence: 9_900,
      categoryId: groceriesCategoryId,
      categorySource: "rule",
      createdAt: ago(28),
      direction: "expense",
      id: transaction(2),
      merchant: "NEIGHBORHOOD MARKET",
      merchantId: marketMerchantId,
      needsReview: false,
      transactionDate: yesterdayIso,
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: checkingId,
      amount: 285_000,
      category: "Housing",
      categoryConfidence: 10_000,
      categoryId: housingCategoryId,
      categorySource: "user",
      createdAt: ago(24 * 12),
      direction: "expense",
      id: transaction(3),
      merchant: "HUDSON RENTALS",
      needsReview: false,
      transactionDate: localDateToIso(addLocalDays(today, -12)),
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: creditCardId,
      amount: 1_999,
      category: "Subscriptions",
      categoryConfidence: 9_800,
      categoryId: subscriptionsCategoryId,
      categorySource: "agent",
      createdAt: ago(24 * 4),
      direction: "expense",
      id: transaction(4),
      merchant: "FIGMA",
      needsReview: false,
      transactionDate: localDateToIso(addLocalDays(today, -4)),
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: creditCardId,
      amount: 7_825,
      category: null,
      categoryConfidence: 4_200,
      categorySource: "provider",
      createdAt: ago(12),
      direction: "expense",
      id: transaction(5),
      merchant: "SQ *UNKNOWN POPUP 8821",
      needsReview: true,
      providerCategory: "GENERAL_MERCHANDISE",
      providerCategoryConfidence: "LOW",
      transactionDate: todayIso,
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: creditCardId,
      amount: 124_00,
      category: "Travel",
      categoryConfidence: 8_500,
      categorySource: "provider",
      createdAt: ago(8),
      direction: "expense",
      id: transaction(6),
      merchant: "MTA*METROCARD",
      needsReview: false,
      pending: true,
      transactionDate: todayIso,
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: checkingId,
      amount: 50_000,
      category: "Transfers",
      categoryConfidence: 10_000,
      categorySource: "rule",
      createdAt: ago(24 * 2),
      direction: "transfer",
      id: transaction(7),
      merchant: "Transfer to emergency savings",
      needsReview: false,
      reconciliationStatus: "matched",
      transactionDate: localDateToIso(addLocalDays(today, -2)),
      transferGroupId: fixtureId(account, 499),
      updatedAt: now,
      userId: account.id,
    },
    {
      accountId: savingsId,
      amount: 50_000,
      category: "Transfers",
      categoryConfidence: 10_000,
      categorySource: "rule",
      createdAt: ago(24 * 2),
      direction: "transfer",
      id: transaction(8),
      merchant: "Transfer from everyday checking",
      needsReview: false,
      reconciliationStatus: "matched",
      transactionDate: localDateToIso(addLocalDays(today, -2)),
      transferGroupId: fixtureId(account, 499),
      updatedAt: now,
      userId: account.id,
    },
  );
  data.financeClassificationDecisions.push({
    categoryId: diningCategoryId,
    categoryName: "Dining",
    confidence: 10_000,
    createdAt: ago(4),
    id: fixtureId(account, 460),
    merchantId: cafeMerchantId,
    outcome: "confirmed",
    rationale: "Confirmed by the fixture user.",
    source: "user",
    transactionId: transaction(1),
    updatedAt: now,
    userId: account.id,
  });
  data.financeReviewCases.push({
    createdAt: ago(10),
    id: fixtureId(account, 461),
    rationale: "The provider supplied a low-confidence general merchandise category.",
    reason: "unknown_merchant",
    status: "open",
    transactionId: transaction(5),
    updatedAt: now,
    userId: account.id,
  });
  data.financeCategoryRules.push({
    category: "Groceries",
    createdAt: ago(24 * 20),
    id: fixtureId(account, 462),
    merchantNormalized: "neighborhood market",
    updatedAt: now,
    userId: account.id,
  });
  data.financeBudgets.push(
    {
      category: "Dining",
      createdAt: ago(24 * 20),
      id: fixtureId(account, 463),
      limit: 60_000,
      month,
      updatedAt: now,
      userId: account.id,
    },
    {
      category: "Groceries",
      createdAt: ago(24 * 20),
      id: fixtureId(account, 464),
      limit: 80_000,
      month,
      updatedAt: now,
      userId: account.id,
    },
    {
      category: "Subscriptions",
      createdAt: ago(24 * 20),
      id: fixtureId(account, 465),
      limit: 15_000,
      month,
      updatedAt: now,
      userId: account.id,
    },
  );
  data.financeProfiles.push({
    createdAt: ago(24 * 45),
    effectiveDate: localDateToIso(addLocalDays(today, -45)),
    employer: "Ilo Labs",
    employmentType: "full_time",
    expectedNetPay: 412_500,
    grossAnnualIncome: 14_500_000,
    id: fixtureId(account, 466),
    nextPayday: localDateToIso(addLocalDays(today, 7)),
    payAccountId: checkingId,
    payFrequency: "biweekly",
    role: "Product Lead",
    updatedAt: now,
    userId: account.id,
  });
  data.financeIncomeStreams.push({
    accountId: checkingId,
    amountTolerance: 15_000,
    cadence: "biweekly",
    confidence: 9_800,
    createdAt: ago(24 * 45),
    displayName: "Ilo Labs payroll",
    expectedAmount: 412_500,
    id: streamId,
    lastObservedDate: localDateToIso(addLocalDays(today, -7)),
    nextExpectedDate: localDateToIso(addLocalDays(today, 7)),
    payer: "ILO LABS PAYROLL",
    source: "user",
    status: "active",
    updatedAt: now,
    userId: account.id,
  });
  data.financeRecurringObligations.push({
    accountId: creditCardId,
    amountTolerance: 500,
    cadence: "monthly",
    confidence: 9_500,
    createdAt: ago(24 * 45),
    displayName: "Figma",
    expectedAmount: 1_999,
    id: obligationId,
    kind: "subscription",
    lastObservedDate: localDateToIso(addLocalDays(today, -4)),
    merchant: "FIGMA",
    nextExpectedDate: localDateToIso(addLocalDays(today, 26)),
    source: "inferred",
    status: "active",
    updatedAt: now,
    userId: account.id,
  });
  data.financeAlerts.push({
    body: "The fixture subscription increased by $2.00. Confirm the new recurring amount.",
    createdAt: ago(6),
    evidence: { expectedAmount: 17.99, observedAmount: 19.99 },
    id: fixtureId(account, 472),
    recurringObligationId: obligationId,
    severity: "info",
    status: "open",
    title: "Subscription price changed",
    transactionId: transaction(4),
    type: "subscription_price_changed",
    updatedAt: now,
    userId: account.id,
  });
  data.pinterestConnections.push({
    backgroundColor: "#f4f1ea",
    backgroundMode: "matched",
    boardUrl: "https://www.pinterest.com/fixture/quiet-workspaces/",
    cornerRadius: 12,
    createdAt: ago(24 * 15),
    enabled: false,
    frameSpacing: 18,
    id: fixtureId(account, 480),
    layout: "grid",
    mosaicFit: "preserve",
    paddingBottom: 20,
    paddingEnd: 20,
    paddingLinked: true,
    paddingStart: 20,
    paddingTop: 20,
    rotationDegrees: 0,
    tileSize: 72,
    updatedAt: now,
    userId: account.id,
  });
  data.auditEvents.push(
    {
      action: "reminder.created",
      actorId: account.id,
      actorType: "user",
      after: { title: "Draft weekly product update" },
      before: null,
      createdAt: ago(48),
      entityId: fixtureId(account, 201),
      entityType: "reminder",
      id: fixtureId(account, 500),
      requestId: `fixture-${account.key}-reminder`,
      userId: account.id,
    },
    {
      action: "finance.transaction_reviewed",
      actorId: account.id,
      actorType: "user",
      after: { category: "Dining", needsReview: false },
      before: { category: null, needsReview: true },
      createdAt: ago(4),
      entityId: transaction(1),
      entityType: "finance_transaction",
      id: fixtureId(account, 501),
      requestId: `fixture-${account.key}-finance`,
      userId: account.id,
    },
  );
}

export type LoadQaFixturesOptions = {
  accounts?: readonly QaFixtureAccount[];
  now?: Date;
};

export type LoadQaFixturesResult = {
  accountCount: number;
  emails: string[];
};

export async function loadQaFixtures(
  db: Database,
  options: LoadQaFixturesOptions = {},
): Promise<LoadQaFixturesResult> {
  const accounts = options.accounts ?? qaFixtureAccounts;
  const now = options.now ?? new Date();
  const passwordHashes = new Map<string, string>();
  for (const password of new Set(accounts.map((account) => account.password))) {
    passwordHashes.set(password, await hashPassword(password));
  }
  const data = emptyFixtureData();
  for (const account of accounts) {
    const passwordHash = passwordHashes.get(account.password);
    if (!passwordHash) throw new Error(`A password hash was not created for ${account.key}.`);
    addBaseAccount(data, account, passwordHash, now);
    if (account.scenario === "complete") addLoadedWorkspace(data, account, now, false);
    if (account.scenario === "degraded") addLoadedWorkspace(data, account, now, true);
  }
  const emails = accounts.map((account) => account.email);
  const ids = accounts.map((account) => account.id);
  await db.transaction(async (transaction) => {
    const fixtureScope = or(inArray(users.email, emails), inArray(users.id, ids));
    if (fixtureScope) await transaction.delete(users).where(fixtureScope);
    await transaction.insert(users).values(data.users);
    if (data.attentionItems.length)
      await transaction.insert(attentionItems).values(data.attentionItems);
    const generatedInboxes = await transaction
      .select({ id: taskLists.id, userId: taskLists.userId })
      .from(taskLists)
      .where(and(inArray(taskLists.userId, ids), eq(taskLists.kind, "inbox")));
    const generatedInboxByUser = new Map(generatedInboxes.map((inbox) => [inbox.userId, inbox.id]));
    for (const account of accounts) {
      const generatedInboxId = generatedInboxByUser.get(account.id);
      if (!generatedInboxId)
        throw new Error(`The database did not create an Inbox for ${account.key}.`);
      const inboxPlaceholder = fixtureId(account, 230);
      for (const reminder of data.reminders) {
        if (reminder.userId === account.id && reminder.taskListId === inboxPlaceholder) {
          reminder.taskListId = generatedInboxId;
        }
      }
    }
    if (data.taskLists.length) await transaction.insert(taskLists).values(data.taskLists);
    if (data.taskProjects.length) await transaction.insert(taskProjects).values(data.taskProjects);
    await transaction.insert(calendarAccounts).values(data.calendarAccounts);
    await transaction.insert(calendars).values(data.calendars);
    if (data.calendarEvents.length)
      await transaction.insert(calendarEvents).values(data.calendarEvents);
    if (data.reminders.length) await transaction.insert(reminders).values(data.reminders);
    if (data.goals.length) await transaction.insert(goals).values(data.goals);
    if (data.motives.length) await transaction.insert(motives).values(data.motives);
    if (data.mailboxes.length) await transaction.insert(mailboxes).values(data.mailboxes);
    if (data.mailThreads.length) await transaction.insert(mailThreads).values(data.mailThreads);
    if (data.mailMessages.length) await transaction.insert(mailMessages).values(data.mailMessages);
    if (data.mailDrafts.length) await transaction.insert(mailDrafts).values(data.mailDrafts);
    if (data.mailSnoozes.length) await transaction.insert(mailSnoozes).values(data.mailSnoozes);
    if (data.domainProfiles.length)
      await transaction.insert(domainProfiles).values(data.domainProfiles);
    if (data.mailRules.length) await transaction.insert(mailRules).values(data.mailRules);
    if (data.financeAccounts.length)
      await transaction.insert(financeAccounts).values(data.financeAccounts);
    if (data.financeCategories.length)
      await transaction.insert(financeCategories).values(data.financeCategories);
    if (data.financeMerchants.length)
      await transaction.insert(financeMerchants).values(data.financeMerchants);
    if (data.financeMerchantAliases.length)
      await transaction.insert(financeMerchantAliases).values(data.financeMerchantAliases);
    if (data.financeTransactions.length)
      await transaction.insert(financeTransactions).values(data.financeTransactions);
    if (data.financeClassificationDecisions.length)
      await transaction
        .insert(financeClassificationDecisions)
        .values(data.financeClassificationDecisions);
    if (data.financeReviewCases.length)
      await transaction.insert(financeReviewCases).values(data.financeReviewCases);
    if (data.financeCategoryRules.length)
      await transaction.insert(financeCategoryRules).values(data.financeCategoryRules);
    if (data.financeBudgets.length)
      await transaction.insert(financeBudgets).values(data.financeBudgets);
    if (data.financeProfiles.length)
      await transaction.insert(financeProfiles).values(data.financeProfiles);
    if (data.financeIncomeStreams.length)
      await transaction.insert(financeIncomeStreams).values(data.financeIncomeStreams);
    if (data.financeRecurringObligations.length)
      await transaction
        .insert(financeRecurringObligations)
        .values(data.financeRecurringObligations);
    if (data.financeAlerts.length)
      await transaction.insert(financeAlerts).values(data.financeAlerts);
    if (data.pinterestConnections.length)
      await transaction.insert(pinterestConnections).values(data.pinterestConnections);
    if (data.auditEvents.length) await transaction.insert(auditEvents).values(data.auditEvents);
  });
  return { accountCount: accounts.length, emails };
}
