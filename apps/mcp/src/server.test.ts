import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ApiClientError, type PersonalOsApiClient } from "@personal-os/api-client";
import type {
  Calendar,
  CalendarEvent,
  DailyBrief,
  Mailbox,
  MailThread,
  Reminder,
  Task,
  TaskList,
  TaskProject,
} from "@personal-os/domain";
import { type AccessScope, accessScopeSchema } from "@personal-os/domain";
import { createPersonalOsMcpServer } from "./server.js";
import { availableToolNames } from "./tool-catalog.js";

const now = "2026-07-13T12:00:00.000Z";
const id = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const reminder: Reminder = {
  id,
  title: "Test",
  notes: null,
  dueAt: null,
  timezone: null,
  priority: "medium",
  source: {
    accountId: null,
    provider: "local",
    remoteId: id,
    revision: now,
    sourceType: "reminder",
  },
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};
const task: Task = {
  cancelledAt: null,
  completedAt: null,
  createdAt: now,
  deletedAt: null,
  dueAt: null,
  estimateMinutes: 30,
  id,
  legacyStatus: "scheduled",
  lifecycle: "open",
  listId: accountId,
  notes: null,
  priority: "medium",
  projectId,
  revision: 1,
  scheduledAt: "2026-07-13T13:00:00.000Z",
  source: {
    accountId: null,
    provider: "local",
    remoteId: id,
    revision: "1",
    sourceType: "task",
  },
  tags: ["planning"],
  timezone: "America/New_York",
  title: "Plan task",
  updatedAt: now,
  why: "Protect focus time.",
};
const taskList: TaskList = {
  archivedAt: null,
  availability: "active",
  color: "blue",
  createdAt: now,
  deletedAt: null,
  description: "Personal commitments.",
  id: accountId,
  kind: "standard",
  name: "Personal",
  revision: 1,
  source: {
    accountId: null,
    provider: "local",
    remoteId: accountId,
    revision: "1",
    sourceType: "task_list",
  },
  updatedAt: now,
};
const taskProject: TaskProject = {
  archivedAt: null,
  availability: "active",
  cancelledAt: null,
  completedAt: null,
  createdAt: now,
  deletedAt: null,
  id: projectId,
  lifecycle: "open",
  listId: accountId,
  name: "Bedroom refresh",
  notes: null,
  revision: 1,
  source: {
    accountId: null,
    provider: "local",
    remoteId: projectId,
    revision: "1",
    sourceType: "task_project",
  },
  targetDate: "2026-08-01",
  updatedAt: now,
  why: "Create a calmer room.",
};
const calendar: Calendar = {
  id,
  accountId,
  provider: "local",
  name: "Personal",
  color: null,
  timezone: "UTC",
  isPrimary: true,
  isSelected: true,
  isWritable: true,
  lastSyncedAt: null,
};
const event: CalendarEvent = {
  id,
  calendarId: id,
  provider: "local",
  remoteEventId: null,
  blockSourceEventId: null,
  blockMode: null,
  blocks: [],
  title: "Focus",
  notes: null,
  location: null,
  conferenceUrl: null,
  startsAt: now,
  endsAt: "2026-07-13T13:00:00.000Z",
  timezone: "UTC",
  allDay: false,
  status: "confirmed",
  recurrence: [],
  createdAt: now,
  updatedAt: now,
};
const commitmentCandidate = {
  allDay: false,
  buffer: { afterMinutes: 15, beforeMinutes: 15 },
  calendarId: id,
  endsAt: "2026-07-13T13:00:00.000Z",
  evidence: {
    kind: "booking" as const,
    source: {
      accountId,
      provider: "google" as const,
      remoteId: "booking-1",
      revision: "v1",
      sourceType: "mail_thread" as const,
    },
    summary: "Confirmed reservation.",
  },
  flexibility: "hard" as const,
  location: null,
  notes: null,
  startsAt: now,
  timezone: "UTC",
  title: "Reservation",
  visibility: "private" as const,
};
const mailbox: Mailbox = {
  accountId,
  id,
  name: "Inbox",
  provider: "google",
  role: "inbox",
  totalCount: 2,
  unreadCount: 1,
};
const mailThread: MailThread = {
  accountId,
  bodyText: "Hello",
  from: { address: "sender@example.com", name: "Sender" },
  id,
  mailboxIds: [id],
  messageCount: 1,
  provider: "google",
  receivedAt: now,
  remoteThreadId: "remote",
  snippet: "Hello",
  starred: false,
  subject: "Test mail",
  to: [],
  unread: true,
  updatedAt: now,
};
const domainProfile = {
  categories: [],
  createdAt: now,
  domain: "mail" as const,
  id,
  instructions: ["Keep only high-signal mail visible."],
  objective: "Keep a clean inbox.",
  preferences: { inboxStyle: "signal_only" },
  sourceContexts: [],
  status: "draft" as const,
  summary: "A low-noise inbox.",
  updatedAt: now,
  version: 1,
};
const attentionItem = {
  createdAt: now,
  domain: "mail" as const,
  expiresAt: null,
  id,
  importance: "high" as const,
  kind: "important" as const,
  occursAt: null,
  relatedEntityId: null,
  relatedEntityType: null,
  source: null,
  status: "open" as const,
  summary: "A reply is due.",
  title: "Reply needed",
  updatedAt: now,
  version: 1,
};
const mailRule = {
  actions: [{ afterDays: 1, mailboxId: null, type: "archive" as const }],
  condition: { field: "any" as const, operator: "contains" as const, value: "newsletter" },
  confidenceThreshold: null,
  createdAt: now,
  description: "Archive newsletters after one day.",
  domain: "mail" as const,
  enabled: false,
  id,
  name: "Archive newsletters",
  policy: "preview" as const,
  profileId: id,
  sourceIds: [accountId],
  updatedAt: now,
  version: 1,
};
const brief: DailyBrief = {
  allDay: [],
  anytime: [reminder],
  capacity: {
    availableMinutes: 240,
    busyMinutes: 0,
    flexibleTaskMinutes: 0,
    overcommitted: false,
    scheduledTaskMinutes: 0,
    workdayEndsAt: now,
    workdayStartsAt: now,
  },
  generatedAt: now,
  laterToday: [event],
  next: event,
  now: [],
  overdue: [],
  recommendedTasks: [],
  timeZone: "America/New_York",
  tasks: [],
  completedTasks: [],
  today: [],
  tomorrow: [],
};

function mockApi() {
  return {
    getIloSetup: vi.fn(async () => ({
      access: { canRead: true, canWrite: true },
      connection: { lastObservedAt: now, observed: true },
      currentStepId: "learn_preferences" as const,
      domain: "mail" as const,
      nextAction: "Inspect Mail and save a draft.",
      profile: {
        approvedStatus: null,
        approvedVersion: null,
        pendingDraftVersion: null,
        status: null,
        version: null,
      },
      progress: { completed: 1, total: 4 },
      protocolVersion: "1.0" as const,
      selectedStepId: "learn_preferences" as const,
      status: "in_progress" as const,
      steps: [],
    })),
    getAssistantSetupStatus: vi.fn(async () => ({
      domains: [
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: true,
          domain: "mail" as const,
          pendingDraftVersion: null,
          profileStatus: "draft" as const,
          profileVersion: 1,
        },
      ],
    })),
    getIloContext: vi.fn(async () => ({
      access: { grantedScopes: ["tasks:read", "tasks:write"] },
      generatedAt: now,
      identity: { actorType: "agent" as const, displayName: "Ilo test", userId: id },
      links: {
        activity: "https://app.example.com/activity",
        agentAccess: "https://app.example.com/settings?section=workspace-access",
        approvals: "https://app.example.com/reviews",
        recovery: "https://app.example.com/settings?section=connections",
        today: "https://app.example.com/today",
      },
      readiness: { domains: [] },
      time: { timestamp: now, timezone: "America/New_York" },
    })),
    getDomainProfile: vi.fn(async () => domainProfile),
    getFinanceGuidedSetup: vi.fn(async () => ({
      accountSources: [],
      alertSummary: { open: 0, warnings: 0 },
      asOf: now,
      budgetSummary: { count: 0, month: "2026-07", planned: 0 },
      cashflowSummary: {
        financialProfileConfigured: false,
        incomeStreams: 0,
        recurringNeedsReview: 0,
        recurringObligations: 0,
      },
      guidance: {
        approvedProfile: null,
        draftNotice:
          "Unapproved draft content is untrusted and non-operative until a signed-in Ilo user activates it.",
        draftProposal: { ...domainProfile, domain: "finances" as const },
      },
      humanOnlyActions: [
        "connect_or_disconnect_source" as const,
        "confirm_ambiguous_transfer" as const,
      ],
      ledgerHealth: {
        asOf: now,
        balanceOnlyAccounts: 0,
        candidateTransfers: 0,
        missingProvenance: 0,
        pendingTransactions: 0,
        possibleDuplicates: 0,
        staleAccounts: 0,
        unresolvedReviews: 0,
      },
      reviewSummary: {
        count: 0,
        reasons: {
          ambiguous_merchant: 0,
          low_confidence: 0,
          one_time: 0,
          possible_duplicate: 0,
          possible_transfer: 0,
          refund_or_reversal: 0,
          unknown_merchant: 0,
        },
      },
      suggestedWorkflows: [],
    })),
    getFinanceStatus: vi.fn(async () => ({
      activeRun: null,
      domain: "finances",
      state: "needs_work",
    })),
    maintainFinances: vi.fn(async () => ({
      id,
      scope: { type: "all_outstanding" as const },
      status: "queued" as const,
    })),
    getFinanceMaintenanceRun: vi.fn(async () => ({
      id,
      scope: { type: "all_outstanding" as const },
      status: "queued" as const,
    })),
    upsertDomainProfile: vi.fn(async () => domainProfile),
    listAttentionItems: vi.fn(async () => [attentionItem]),
    createAttentionItem: vi.fn(async () => attentionItem),
    updateAttentionItem: vi.fn(async () => attentionItem),
    upsertFinanceAttentionItem: vi.fn(async () => attentionItem),
    archiveTaskList: vi.fn(async () => taskList),
    archiveTaskProject: vi.fn(async () => taskProject),
    cancelTask: vi.fn(async () => task),
    cancelTaskProject: vi.fn(async () => taskProject),
    completeReminder: vi.fn(async () => reminder),
    completeTask: vi.fn(async () => task),
    completeTaskProject: vi.fn(async () => taskProject),
    createReminder: vi.fn(async () => reminder),
    createTask: vi.fn(async () => task),
    createTaskList: vi.fn(async () => taskList),
    createTaskProject: vi.fn(async () => taskProject),
    createFinanceTransaction: vi.fn(async () => ({
      id,
      accountId,
      amount: 1,
      category: null,
      categoryConfidence: null,
      createdAt: now,
      date: "2026-07-13",
      direction: "expense",
      merchant: "Test",
      needsReview: true,
      notes: null,
      updatedAt: now,
    })),
    updateFinanceTransaction: vi.fn(async () => ({
      id,
      accountId,
      amount: 1,
      category: "Dining",
      categoryConfidence: 1,
      createdAt: now,
      date: "2026-07-13",
      direction: "expense",
      merchant: "Test",
      needsReview: false,
      notes: null,
      updatedAt: now,
    })),
    getFinanceOverview: vi.fn(async () => ({
      accounts: [],
      budgets: [],
      pendingSpendThisMonth: 0,
      refundCreditsThisMonth: 0,
      reviewCount: 0,
      spendingThisMonth: 0,
      transactions: [],
    })),
    getFinanceWealthSummary: vi.fn(async () => ({
      annualIncome: 0,
      cash: 0,
      debt: 0,
      incomeBasis: "none" as const,
      investments: 0,
      monthlyIncome: 0,
      monthlyPlanRemaining: null,
      netWorth: 0,
      observedAnnualIncome: 0,
      otherAssets: 0,
      plannedThisMonth: 0,
      statedAnnualIncome: null,
    })),
    getFinanceLedgerHealth: vi.fn(async () => ({
      asOf: now,
      balanceOnlyAccounts: 0,
      candidateTransfers: 0,
      missingProvenance: 0,
      pendingTransactions: 0,
      possibleDuplicates: 0,
      staleAccounts: 0,
      unresolvedReviews: 0,
    })),
    getFinanceProfile: vi.fn(async () => null),
    listFinanceIncomeStreams: vi.fn(async () => []),
    listFinanceRecurringObligations: vi.fn(async () => []),
    listFinanceAlerts: vi.fn(async () => []),
    getFinanceForecast: vi.fn(async () => ({
      asOf: now,
      lowestProjectedBalance: 0,
      lowestProjectedDate: null,
      projectedBalanceAtNextPayday: null,
      safeToSpend: 0,
      upcomingIncome: 0,
      upcomingObligations: 0,
    })),
    updateFinanceRecurringObligation: vi.fn(async () => ({
      accountId: null,
      cadence: "monthly",
      confidence: 1,
      displayName: "Test",
      expectedAmount: 1,
      id,
      kind: "subscription",
      lastObservedDate: null,
      merchant: "test",
      nextExpectedDate: null,
      source: "user",
      status: "active",
    })),
    resolveFinanceAlert: vi.fn(async () => ({
      body: "Resolved",
      createdAt: now,
      evidence: {},
      id,
      recurringObligationId: null,
      severity: "info",
      status: "resolved",
      title: "Test",
      type: "income_missing",
    })),
    getFinanceCategories: vi.fn(async () => []),
    getFinanceBudgetStatus: vi.fn(async () => []),
    listFinanceMerchants: vi.fn(async () => []),
    mergeFinanceMerchants: vi.fn(async () => ({
      aliases: [],
      displayName: "Test",
      id,
      isUserConfirmed: false,
    })),
    getFinanceReviewQueue: vi.fn(async () => []),
    listFinanceTransactions: vi.fn(async () => ({ items: [], nextCursor: null })),
    proposeFinanceCategorizations: vi.fn(async () => ({ items: [], nextCursor: null })),
    applyFinanceCategorizations: vi.fn(async () => []),
    resolveFinanceReview: vi.fn(async () => ({ deferred: true })),
    updateFinanceMerchant: vi.fn(async () => ({
      aliases: [],
      displayName: "Test",
      id,
      isUserConfirmed: true,
    })),
    updateReminder: vi.fn(async () => reminder),
    updateTask: vi.fn(async () => task),
    updateTaskList: vi.fn(async () => taskList),
    updateTaskProject: vi.fn(async () => taskProject),
    deleteReminder: vi.fn(async () => undefined),
    listReminders: vi.fn(async () => ({ items: [reminder], nextCursor: null })),
    getReminder: vi.fn(async () => reminder),
    previewOverdueReminderDeferral: vi.fn(async () => ({
      candidates: [
        {
          dueAt: "2026-07-13T10:00:00.000Z",
          id,
          priority: reminder.priority,
          proposedDueAt: "2026-07-14T13:00:00.000Z",
          proposedTimezone: "America/New_York",
          source: reminder.source,
          title: reminder.title,
          updatedAt: reminder.updatedAt,
        },
      ],
      matchedCount: 1,
      policy: "preview" as const,
      previewedAt: now,
    })),
    restoreReminder: vi.fn(async () => reminder),
    trashReminder: vi.fn(async () => reminder),
    upsertReminderAttentionItem: vi.fn(async () => attentionItem),
    getTask: vi.fn(async () => task),
    getTaskList: vi.fn(async () => taskList),
    getTaskProject: vi.fn(async () => taskProject),
    listTaskLists: vi.fn(async () => ({ items: [taskList], nextCursor: null })),
    listTaskProjects: vi.fn(async () => ({ items: [taskProject], nextCursor: null })),
    listTasks: vi.fn(async () => ({ items: [task], nextCursor: null })),
    moveTask: vi.fn(async () => task),
    moveTaskProject: vi.fn(async () => taskProject),
    previewTaskMove: vi.fn(async () => ({
      destinationListId: accountId,
      destinationListRevision: 1,
      destinationProjectId: projectId,
      destinationProjectRevision: 1,
      detachedProjectId: null,
      previewToken: "task-move-preview",
      sourceListId: accountId,
      sourceListRevision: 1,
      sourceProjectId: projectId,
      taskId: id,
      taskRevision: 1,
    })),
    previewTaskProjectMove: vi.fn(async () => ({
      affectedTaskCount: 1,
      destinationListId: accountId,
      destinationListRevision: 1,
      previewToken: "project-move-preview",
      sourceListId: accountId,
      sourceListRevision: 1,
      taskProjectId: projectId,
      taskProjectRevision: 1,
    })),
    reopenTask: vi.fn(async () => task),
    restoreTask: vi.fn(async () => task),
    trashTask: vi.fn(async () => task),
    listGoals: vi.fn(async () => []),
    createGoal: vi.fn(async () => ({
      id,
      title: "Goal",
      description: null,
      progress: 0,
      status: "active",
      targetDate: null,
      createdAt: now,
      updatedAt: now,
    })),
    updateGoal: vi.fn(async () => ({
      id,
      title: "Goal",
      description: null,
      progress: 10,
      status: "active",
      targetDate: null,
      createdAt: now,
      updatedAt: now,
    })),
    listMotives: vi.fn(async () => []),
    createMotive: vi.fn(async () => ({
      id,
      title: "Motive",
      detail: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })),
    listCalendars: vi.fn(async () => [calendar]),
    listMailboxes: vi.fn(async () => [mailbox]),
    getMailSetupContext: vi.fn(async () => ({
      accounts: [],
      automation: {
        executionLimitPerRun: 6 as const,
        failedCount: 0,
        inProgressCount: 0,
        lastCompletedAt: null,
        oldestDueAt: null,
        pendingCount: 0,
        reconciliationCount: 0,
      },
      safety: {
        delayedRetentionAutomation: true as const,
        permanentDeletion: false as const,
        providerFilterCreation: false as const,
        spamClassification: false as const,
        unsubscribeAutomation: false as const,
      },
    })),
    listMailThreads: vi.fn(async () => [mailThread]),
    getMailThread: vi.fn(async () => mailThread),
    listMailMessages: vi.fn(async () => []),
    listMailRules: vi.fn(async () => [mailRule]),
    previewMailRule: vi.fn(async () => ({
      candidates: [],
      fingerprint: "a".repeat(64),
      matchedCount: 0,
      previewedAt: now,
      ruleId: null,
      ruleVersion: null,
      scannedCount: 1,
      window: {
        limit: 200 as const,
        newestReceivedAt: now,
        oldestReceivedAt: now,
        truncated: false,
      },
    })),
    previewSavedMailRule: vi.fn(async () => ({
      candidates: [],
      fingerprint: "b".repeat(64),
      matchedCount: 0,
      previewedAt: now,
      ruleId: id,
      ruleVersion: 1,
      scannedCount: 1,
      window: {
        limit: 200 as const,
        newestReceivedAt: now,
        oldestReceivedAt: now,
        truncated: false,
      },
    })),
    createMailDraft: vi.fn(async () => ({ id })),
    createMailRule: vi.fn(async () => mailRule),
    upsertMailAttentionItem: vi.fn(async () => attentionItem),
    updateMailRule: vi.fn(async () => ({ ...mailRule, enabled: true, version: 2 })),
    updateMailThread: vi.fn(async () => mailThread),
    bulkUpdateMail: vi.fn(async ({ items }: { items: Array<{ id: string }> }) => ({
      failedCount: 0,
      failures: [],
      updatedCount: items.length,
      updatedIds: items.map((item) => item.id),
    })),
    snoozeMailThread: vi.fn(async () => undefined),
    sendMail: vi.fn(async () => undefined),
    listEvents: vi.fn(async () => [event]),
    getEvent: vi.fn(async () => event),
    createEvent: vi.fn(async () => event),
    createEventBlock: vi.fn(async () => event),
    previewCalendarCommitment: vi.fn(async () => ({
      authority: "caller_supplied_unverified" as const,
      candidate: commitmentCandidate,
      destination: calendar,
      possibleDuplicateEventId: null,
      fingerprint: "a".repeat(64),
      policy: {
        canApply: false,
        effectivePolicy: "preview" as const,
        reasons: ["Caller-supplied evidence is not authority."],
        requestedPolicy: "approved_rule" as const,
        requiresInteractiveApproval: true,
      },
      providerEffect: "local_write" as const,
      warnings: [],
    })),
    updateEvent: vi.fn(async () => event),
    updateEventBlock: vi.fn(async () => event),
    deleteEvent: vi.fn(async () => undefined),
    deleteEventBlock: vi.fn(async () => event),
    restoreEvent: vi.fn(async () => event),
    trashEvent: vi.fn(async () => ({
      blockUpdatedAtById: {},
      eventId: id,
      updatedAt: now,
    })),
    upsertCalendarAttentionItem: vi.fn(async () => attentionItem),
    listActivity: vi.fn(async () => [
      {
        id,
        action: "reminder.created",
        actorId: id,
        actorType: "agent",
        before: null,
        after: {},
        createdAt: now,
        entityId: id,
        entityType: "reminder",
        requestId: "r",
      },
    ]),
    getDailyBrief: vi.fn(async () => brief),
    listXBookmarks: vi.fn(async () => []),
    syncXBookmarks: vi.fn(async () => 0),
  };
}

describe("ilo MCP server", () => {
  it("discovers the focused task organization surface with truthful annotations and guards", async () => {
    const server = createPersonalOsMcpServer({
      api: mockApi() as unknown as PersonalOsApiClient,
      scopes: new Set(["tasks:read", "tasks:write"]),
      timeZone: "UTC",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = (await client.listTools()).tools;
    const taskTools = tools.filter((tool) => tool._meta?.["ilo/domain"] === "tasks");
    const expectedNames = [
      "list_task_lists",
      "get_task_list",
      "create_task_list",
      "update_task_list",
      "archive_task_list",
      "list_task_projects",
      "get_task_project",
      "create_task_project",
      "update_task_project",
      "complete_task_project",
      "cancel_task_project",
      "archive_task_project",
      "preview_task_project_move",
      "move_task_project",
      "list_tasks",
      "get_task",
      "create_task",
      "update_task",
      "complete_task",
      "reopen_task",
      "cancel_task",
      "trash_task",
      "restore_task",
      "preview_task_move",
      "move_task",
    ];
    expect(taskTools.map((tool) => tool.name).sort()).toEqual(expectedNames.sort());
    expect(taskTools.map((tool) => tool.name)).not.toContain("delete_task");

    const readNames = new Set([
      "list_task_lists",
      "get_task_list",
      "list_task_projects",
      "get_task_project",
      "list_tasks",
      "get_task",
    ]);
    const previewNames = new Set(["preview_task_project_move", "preview_task_move"]);
    const createNames = new Set(["create_task_list", "create_task_project", "create_task"]);
    const destructiveNames = new Set([
      "archive_task_list",
      "archive_task_project",
      "move_task_project",
      "trash_task",
    ]);
    for (const tool of taskTools) {
      const isRead = readNames.has(tool.name);
      const isPreview = previewNames.has(tool.name);
      const isCreate = createNames.has(tool.name);
      expect(tool.annotations).toEqual({
        destructiveHint: destructiveNames.has(tool.name),
        idempotentHint: isRead || isPreview || isCreate,
        openWorldHint: false,
        readOnlyHint: isRead || isPreview,
      });
      expect(tool._meta).toMatchObject({
        "ilo/policy": isPreview ? "preview" : isRead ? "read_only" : "approve_each",
        "ilo/stage": isPreview ? "prepare" : isRead ? "inspect" : "commit",
      });
    }

    for (const name of createNames) {
      const schema = taskTools.find((tool) => tool.name === name)?.inputSchema as {
        required?: string[];
      };
      expect(schema.required).toContain("idempotencyKey");
    }
    for (const name of [
      "update_task_list",
      "archive_task_list",
      "update_task_project",
      "complete_task_project",
      "cancel_task_project",
      "archive_task_project",
      "preview_task_project_move",
      "move_task_project",
      "update_task",
      "complete_task",
      "reopen_task",
      "cancel_task",
      "trash_task",
      "restore_task",
      "preview_task_move",
      "move_task",
    ]) {
      const schema = taskTools.find((tool) => tool.name === name)?.inputSchema as {
        required?: string[];
      };
      expect(schema.required).toContain("expectedRevision");
    }

    const invalidListMove = await client.callTool({
      name: "archive_task_list",
      arguments: { expectedRevision: 1, id: accountId, resolution: "move_active_contents" },
    });
    const invalidProjectCompletion = await client.callTool({
      name: "complete_task_project",
      arguments: { expectedRevision: 1, id: projectId, resolution: "move_open_tasks" },
    });
    expect(invalidListMove).toMatchObject({ isError: true });
    expect(invalidProjectCompletion).toMatchObject({ isError: true });

    await client.close();
    await server.close();
  });

  it("forwards task organization calls and structured revision conflicts through the API client", async () => {
    const api = mockApi();
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      scopes: new Set(["tasks:read", "tasks:write"]),
      timeZone: "UTC",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.callTool({
      name: "list_task_lists",
      arguments: { cursor: "lists-next", limit: 25 },
    });
    await client.callTool({ name: "get_task_list", arguments: { id: accountId } });
    await client.callTool({
      name: "create_task_list",
      arguments: { idempotencyKey: id, name: "Personal" },
    });
    await client.callTool({
      name: "update_task_list",
      arguments: { expectedRevision: 1, id: accountId, name: "Home" },
    });
    await client.callTool({
      name: "archive_task_list",
      arguments: { expectedRevision: 1, id: accountId, resolution: "archive_contents_together" },
    });

    await client.callTool({
      name: "list_task_projects",
      arguments: { cursor: "projects-next", limit: 20 },
    });
    await client.callTool({ name: "get_task_project", arguments: { id: projectId } });
    await client.callTool({
      name: "create_task_project",
      arguments: { idempotencyKey: id, listId: accountId, name: "Bedroom refresh" },
    });
    await client.callTool({
      name: "update_task_project",
      arguments: { expectedRevision: 1, id: projectId, name: "Bedroom reset" },
    });
    await client.callTool({
      name: "complete_task_project",
      arguments: { expectedRevision: 1, id: projectId, resolution: "complete_open_tasks" },
    });
    await client.callTool({
      name: "cancel_task_project",
      arguments: { expectedRevision: 1, id: projectId },
    });
    await client.callTool({
      name: "archive_task_project",
      arguments: { expectedRevision: 1, id: projectId },
    });
    await client.callTool({
      name: "preview_task_project_move",
      arguments: { destinationListId: accountId, expectedRevision: 1, id: projectId },
    });
    await client.callTool({
      name: "move_task_project",
      arguments: {
        destinationListId: accountId,
        expectedRevision: 1,
        id: projectId,
        previewToken: "project-move-preview",
      },
    });

    await client.callTool({
      name: "list_tasks",
      arguments: { lifecycle: "open", limit: 15, listId: accountId, view: "scheduled" },
    });
    await client.callTool({ name: "get_task", arguments: { id } });
    await client.callTool({
      name: "create_task",
      arguments: { idempotencyKey: projectId, listId: accountId, title: "Plan task" },
    });
    await client.callTool({
      name: "update_task",
      arguments: { estimateMinutes: 45, expectedRevision: 1, id },
    });
    for (const name of [
      "complete_task",
      "reopen_task",
      "cancel_task",
      "trash_task",
      "restore_task",
    ]) {
      await client.callTool({ name, arguments: { expectedRevision: 1, id } });
    }
    await client.callTool({
      name: "preview_task_move",
      arguments: {
        destinationListId: accountId,
        destinationProjectId: projectId,
        expectedRevision: 1,
        id,
      },
    });
    await client.callTool({
      name: "move_task",
      arguments: {
        destinationListId: accountId,
        destinationProjectId: projectId,
        expectedRevision: 1,
        id,
        previewToken: "task-move-preview",
      },
    });

    expect(api.listTaskLists).toHaveBeenCalledWith({ cursor: "lists-next", limit: 25 });
    expect(api.getTaskList).toHaveBeenCalledWith(accountId);
    expect(api.createTaskList).toHaveBeenCalledWith({
      color: null,
      description: null,
      idempotencyKey: id,
      name: "Personal",
    });
    expect(api.updateTaskList).toHaveBeenCalledWith(accountId, {
      expectedRevision: 1,
      name: "Home",
    });
    expect(api.archiveTaskList).toHaveBeenCalledWith(accountId, {
      expectedRevision: 1,
      resolution: "archive_contents_together",
    });
    expect(api.listTaskProjects).toHaveBeenCalledWith({ cursor: "projects-next", limit: 20 });
    expect(api.getTaskProject).toHaveBeenCalledWith(projectId);
    expect(api.createTaskProject).toHaveBeenCalledWith({
      idempotencyKey: id,
      listId: accountId,
      name: "Bedroom refresh",
      notes: null,
      targetDate: null,
      why: null,
    });
    expect(api.updateTaskProject).toHaveBeenCalledWith(projectId, {
      expectedRevision: 1,
      name: "Bedroom reset",
    });
    expect(api.completeTaskProject).toHaveBeenCalledWith(projectId, {
      expectedRevision: 1,
      resolution: "complete_open_tasks",
    });
    expect(api.cancelTaskProject).toHaveBeenCalledWith(projectId, { expectedRevision: 1 });
    expect(api.archiveTaskProject).toHaveBeenCalledWith(projectId, { expectedRevision: 1 });
    expect(api.previewTaskProjectMove).toHaveBeenCalledWith(projectId, {
      destinationListId: accountId,
      expectedRevision: 1,
    });
    expect(api.moveTaskProject).toHaveBeenCalledWith(projectId, {
      destinationListId: accountId,
      expectedRevision: 1,
      previewToken: "project-move-preview",
    });
    expect(api.listTasks).toHaveBeenCalledWith({
      lifecycle: "open",
      limit: 15,
      listId: accountId,
      view: "scheduled",
    });
    expect(api.getTask).toHaveBeenCalledWith(id);
    expect(api.createTask).toHaveBeenCalledWith({
      dueAt: null,
      estimateMinutes: null,
      idempotencyKey: projectId,
      lifecycle: "open",
      listId: accountId,
      notes: null,
      priority: "medium",
      scheduledAt: null,
      tags: [],
      timezone: null,
      title: "Plan task",
      why: null,
    });
    expect(api.updateTask).toHaveBeenCalledWith(id, {
      estimateMinutes: 45,
      expectedRevision: 1,
    });
    expect(api.completeTask).toHaveBeenCalledWith(id, { expectedRevision: 1 });
    expect(api.reopenTask).toHaveBeenCalledWith(id, { expectedRevision: 1 });
    expect(api.cancelTask).toHaveBeenCalledWith(id, { expectedRevision: 1 });
    expect(api.trashTask).toHaveBeenCalledWith(id, { expectedRevision: 1 });
    expect(api.restoreTask).toHaveBeenCalledWith(id, { expectedRevision: 1 });
    expect(api.previewTaskMove).toHaveBeenCalledWith(id, {
      destinationListId: accountId,
      destinationProjectId: projectId,
      expectedRevision: 1,
    });
    expect(api.moveTask).toHaveBeenCalledWith(id, {
      destinationListId: accountId,
      destinationProjectId: projectId,
      expectedRevision: 1,
      previewToken: "task-move-preview",
    });

    api.updateTask.mockRejectedValueOnce(
      new ApiClientError({
        code: "conflict",
        details: { currentRevision: 2 },
        message: "The Task changed since it was loaded.",
        requestId: "task-conflict",
        status: 409,
      }),
    );
    const conflict = await client.callTool({
      name: "update_task",
      arguments: { expectedRevision: 1, id, title: "Stale change" },
    });
    expect(conflict).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "conflict",
          details: { currentRevision: 2 },
          message: "The Task changed since it was loaded.",
          requestId: "task-conflict",
          status: 409,
        },
      },
    });

    await client.close();
    await server.close();
  });

  it("exposes and executes the complete agent surface and today resource", async () => {
    const api = mockApi();
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      now: () => new Date("2026-07-13T16:00:00.000Z"),
      timeZone: "America/New_York",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(new Set(tools.tools.map((tool) => tool.name))).toEqual(
      new Set(availableToolNames(new Set(accessScopeSchema.options), false)),
    );
    for (const tool of tools.tools) {
      expect(tool.outputSchema).toMatchObject({
        properties: { _ilo: expect.any(Object) },
        required: ["_ilo"],
        type: "object",
      });
      expect(tool.annotations).toEqual({
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
        readOnlyHint: expect.any(Boolean),
      });
      expect(tool._meta).toMatchObject({
        "ilo/domain": expect.any(String),
        "ilo/policy": expect.any(String),
        "ilo/stage": expect.any(String),
      });
    }
    expect(tools.tools.find((tool) => tool.name === "list_automations")).toBeUndefined();
    expect(tools.tools.find((tool) => tool.name === "run_automation")).toBeUndefined();
    expect(tools.tools.find((tool) => tool.name === "sync_x_bookmarks")?.annotations).toMatchObject(
      {
        readOnlyHint: false,
      },
    );
    expect(tools.tools.find((tool) => tool.name === "delete_event")?.annotations).toMatchObject({
      destructiveHint: true,
    });
    const reminderTools = tools.tools.filter((tool) => tool.name.includes("reminder"));
    expect(reminderTools).toHaveLength(9);
    for (const tool of reminderTools) {
      expect(tool.annotations).toEqual(
        expect.objectContaining({
          destructiveHint: expect.any(Boolean),
          idempotentHint: expect.any(Boolean),
          openWorldHint: false,
          readOnlyHint: expect.any(Boolean),
        }),
      );
    }
    expect(tools.tools.find((tool) => tool.name === "delete_reminder")?.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: false,
      readOnlyHint: false,
    });
    expect(
      tools.tools.find((tool) => tool.name === "propose_finance_categorizations")?.annotations,
    ).toMatchObject({
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    });
    for (const tool of tools.tools.filter(
      (candidate) =>
        candidate.name.includes("finance") &&
        !["create_finance_attention_item", "maintain_finances"].includes(candidate.name),
    )) {
      expect(tool.annotations).toEqual({
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      });
    }
    expect(
      tools.tools.find((tool) => tool.name === "create_finance_attention_item")?.annotations,
    ).toEqual({
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    });
    for (const tool of tools.tools.filter((candidate) =>
      [
        "get_ilo_setup",
        "get_agent_setup_status",
        "get_domain_profile",
        "save_domain_profile",
        "list_attention_items",
        "create_attention_item",
        "update_attention_item",
      ].includes(candidate.name),
    )) {
      expect(tool.annotations).toEqual({
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
        readOnlyHint: expect.any(Boolean),
      });
    }
    for (const tool of tools.tools.filter((candidate) =>
      [
        "list_mailboxes",
        "get_mail_setup_context",
        "list_mail",
        "read_mail",
        "update_mail",
        "bulk_update_mail",
        "snooze_mail",
        "create_mail_draft",
        "send_mail",
        "create_mail_attention_item",
        "list_mail_rules",
        "preview_mail_rule",
        "review_mail_rule",
        "create_mail_rule",
        "update_mail_rule",
      ].includes(candidate.name),
    )) {
      expect(tool.annotations).toEqual({
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
        readOnlyHint: expect.any(Boolean),
      });
    }
    expect(tools.tools.find((tool) => tool.name === "send_mail")?.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
      readOnlyHint: false,
    });
    const sendMailInput = tools.tools.find((tool) => tool.name === "send_mail")?.inputSchema as {
      required?: string[];
    };
    expect(sendMailInput.required).toContain("draftId");
    const updateMailInput = tools.tools.find((tool) => tool.name === "update_mail")
      ?.inputSchema as { required?: string[] };
    expect(updateMailInput.required).toContain("expectedUpdatedAt");
    const bulkMailInput = tools.tools.find((tool) => tool.name === "bulk_update_mail")
      ?.inputSchema as {
      properties?: { items?: { items?: { required?: string[] } } };
      required?: string[];
    };
    expect(bulkMailInput.required).toContain("items");
    expect(bulkMailInput.properties?.items?.items?.required).toEqual(
      expect.arrayContaining(["expectedUpdatedAt", "id"]),
    );
    for (const name of [
      "update_mail",
      "bulk_update_mail",
      "snooze_mail",
      "create_mail_draft",
      "send_mail",
      "create_mail_attention_item",
      "create_mail_rule",
      "update_mail_rule",
    ]) {
      expect(tools.tools.find((tool) => tool.name === name)?.annotations?.idempotentHint).toBe(
        false,
      );
    }
    const calendarAnnotations = new Map(
      tools.tools
        .filter((tool) =>
          [
            "list_calendars",
            "list_events",
            "get_event",
            "create_event",
            "update_event",
            "block_event",
            "set_event_block_privacy",
            "unblock_event",
            "delete_event",
            "restore_event",
            "create_calendar_attention_item",
            "preview_calendar_commitment",
          ].includes(tool.name),
        )
        .map((tool) => [tool.name, tool.annotations]),
    );
    expect(calendarAnnotations).toEqual(
      new Map([
        [
          "list_calendars",
          {
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
            readOnlyHint: true,
          },
        ],
        [
          "list_events",
          {
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
            readOnlyHint: true,
          },
        ],
        [
          "get_event",
          {
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
            readOnlyHint: true,
          },
        ],
        [
          "create_event",
          {
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
        ],
        [
          "update_event",
          {
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
        ],
        [
          "block_event",
          {
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
        ],
        [
          "set_event_block_privacy",
          {
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
        ],
        [
          "unblock_event",
          {
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
        ],
        [
          "delete_event",
          {
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
        ],
        [
          "restore_event",
          {
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
        ],
        [
          "create_calendar_attention_item",
          {
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
            readOnlyHint: false,
          },
        ],
        [
          "preview_calendar_commitment",
          {
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
            readOnlyHint: true,
          },
        ],
      ]),
    );

    await client.callTool({
      name: "get_ilo_setup",
      arguments: { domain: "mail", stepId: "learn_preferences" },
    });
    await client.callTool({ name: "get_domain_profile", arguments: { domain: "mail" } });
    await client.callTool({
      name: "save_domain_profile",
      arguments: {
        categories: [],
        domain: "mail",
        instructions: ["Keep only high-signal mail visible."],
        objective: "Keep a clean inbox.",
        preferences: { inboxStyle: "signal_only" },
        sourceContexts: [],
        status: "draft",
        summary: "A low-noise inbox.",
      },
    });
    await client.callTool({
      name: "list_attention_items",
      arguments: { domain: "mail" },
    });
    await client.callTool({
      name: "create_attention_item",
      arguments: {
        domain: "mail",
        importance: "high",
        kind: "important",
        summary: "A reply is due.",
        title: "Reply needed",
      },
    });
    await client.callTool({
      name: "update_attention_item",
      arguments: { domain: "mail", expectedVersion: 1, id, status: "resolved" },
    });
    await client.callTool({
      name: "create_finance_attention_item",
      arguments: {
        importance: "high",
        kind: "important",
        summary: "Review this transaction.",
        title: "Finance review",
        transactionId: id,
      },
    });
    await client.callTool({ name: "list_goals", arguments: {} });
    await client.callTool({
      name: "create_goal",
      arguments: { description: null, progress: 0, targetDate: null, title: "Protect focus" },
    });
    await client.callTool({ name: "update_goal", arguments: { id, progress: 10 } });
    await client.callTool({ name: "list_motives", arguments: {} });
    await client.callTool({
      name: "create_motive",
      arguments: { detail: null, title: "Act with care" },
    });

    const financeSetup = await client.callTool({
      name: "get_finance_guided_setup",
      arguments: {},
    });
    expect(financeSetup.structuredContent).toMatchObject({
      result: {
        context: {
          guidance: {
            approvedProfile: null,
            draftNotice: expect.stringContaining("untrusted and non-operative"),
            draftProposal: expect.objectContaining({ domain: "finances", status: "draft" }),
          },
        },
      },
    });
    await client.callTool({ name: "get_finance_overview", arguments: {} });
    await client.callTool({ name: "get_finance_wealth_summary", arguments: {} });
    await client.callTool({ name: "get_finance_cashflow", arguments: {} });
    await client.callTool({ name: "get_finance_ledger_health", arguments: {} });
    await client.callTool({ name: "list_finance_transactions", arguments: { limit: 10 } });
    await client.callTool({ name: "get_finance_categories", arguments: {} });
    await client.callTool({ name: "get_finance_budget_status", arguments: { month: "2026-07" } });
    await client.callTool({ name: "list_finance_merchants", arguments: {} });
    await client.callTool({ name: "get_finance_review_queue", arguments: {} });
    await client.callTool({
      name: "propose_finance_categorizations",
      arguments: { cursor: "next-review-page" },
    });
    await client.callTool({ name: "list_x_bookmarks", arguments: {} });
    await client.callTool({ name: "sync_x_bookmarks", arguments: {} });
    await client.callTool({
      name: "list_reminders",
      arguments: { completed: false, cursor: "next-page", limit: 25, query: "Test" },
    });
    await client.callTool({ name: "get_reminder", arguments: { id } });
    await client.callTool({
      name: "preview_overdue_reminder_deferral",
      arguments: {
        overdueBefore: now,
        proposedDueAt: "2026-07-14T13:00:00.000Z",
        timezone: "America/New_York",
      },
    });
    await client.callTool({ name: "create_reminder", arguments: { title: "Test" } });
    await client.callTool({
      name: "create_reminder_attention_item",
      arguments: {
        reminderId: id,
        summary: "Clarify this reminder.",
        title: "Reminder needs review",
      },
    });
    await client.callTool({
      name: "update_reminder",
      arguments: {
        id,
        expectedUpdatedAt: now,
        title: "Changed",
        dueAt: null,
        notes: null,
        timezone: null,
        priority: "high",
      },
    });
    api.updateReminder.mockRejectedValueOnce(
      new ApiClientError({
        code: "conflict",
        details: { currentUpdatedAt: "2026-07-13T12:01:00.000Z" },
        message: "The reminder changed since it was loaded.",
        requestId: "request-conflict",
        status: 409,
      }),
    );
    const conflict = await client.callTool({
      name: "update_reminder",
      arguments: { expectedUpdatedAt: now, id, title: "Stale change" },
    });
    expect(conflict).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "conflict",
          details: { currentUpdatedAt: "2026-07-13T12:01:00.000Z" },
          requestId: "request-conflict",
          status: 409,
        },
      },
    });
    await client.callTool({
      name: "complete_reminder",
      arguments: { expectedUpdatedAt: now, id },
    });
    const deletedReminder = await client.callTool({
      name: "delete_reminder",
      arguments: { expectedUpdatedAt: now, id },
    });
    expect(deletedReminder.structuredContent).toMatchObject({ result: reminder });
    await client.callTool({
      name: "restore_reminder",
      arguments: { expectedUpdatedAt: now, id },
    });
    await client.callTool({ name: "list_tasks", arguments: { view: "scheduled" } });
    await client.callTool({
      name: "create_task",
      arguments: {
        idempotencyKey: projectId,
        title: "Plan task",
        scheduledAt: task.scheduledAt,
        timezone: task.timezone,
      },
    });
    await client.callTool({
      name: "update_task",
      arguments: { expectedRevision: 1, id, estimateMinutes: 45 },
    });
    await client.callTool({ name: "complete_task", arguments: { expectedRevision: 1, id } });
    const trashedTask = await client.callTool({
      name: "trash_task",
      arguments: { expectedRevision: 1, id },
    });
    expect(trashedTask.structuredContent).toMatchObject({ result: task });
    await client.callTool({ name: "list_calendars", arguments: {} });
    await client.callTool({ name: "list_mailboxes", arguments: {} });
    await client.callTool({ name: "get_mail_setup_context", arguments: {} });
    await client.callTool({
      name: "list_mail",
      arguments: { accountIds: [accountId], mailboxId: id, query: "Test", unread: true },
    });
    await client.callTool({ name: "read_mail", arguments: { id } });
    await client.callTool({
      name: "update_mail",
      arguments: { expectedUpdatedAt: now, id, starred: true },
    });
    await client.callTool({
      name: "bulk_update_mail",
      arguments: { items: [{ expectedUpdatedAt: now, id }], unread: false },
    });
    await client.callTool({
      name: "snooze_mail",
      arguments: { id, until: "2026-07-14T12:00:00.000Z" },
    });
    await client.callTool({
      name: "create_mail_draft",
      arguments: {
        accountId,
        body: "Reply body",
        subject: "Re: Test mail",
        to: [{ address: "Recipient@Example.COM", name: null }],
      },
    });
    await client.callTool({
      name: "send_mail",
      arguments: {
        accountId,
        body: "Reply body",
        draftId: id,
        subject: "Re: Test mail",
        to: [{ address: "Recipient@Example.COM", name: null }],
      },
    });
    await client.callTool({
      name: "create_mail_attention_item",
      arguments: {
        importance: "high",
        kind: "important",
        summary: "A reply is due.",
        threadId: id,
        title: "Reply needed",
      },
    });
    await client.callTool({ name: "list_mail_rules", arguments: {} });
    await client.callTool({
      name: "preview_mail_rule",
      arguments: {
        actions: mailRule.actions,
        condition: mailRule.condition,
        description: mailRule.description,
        sourceIds: mailRule.sourceIds,
      },
    });
    await client.callTool({ name: "review_mail_rule", arguments: { id } });
    await client.callTool({
      name: "create_mail_rule",
      arguments: {
        actions: mailRule.actions,
        condition: mailRule.condition,
        description: mailRule.description,
        name: mailRule.name,
        profileId: id,
        sourceIds: mailRule.sourceIds,
      },
    });
    await client.callTool({
      name: "update_mail_rule",
      arguments: { enabled: false, expectedVersion: 1, id },
    });
    await client.callTool({
      name: "list_events",
      arguments: { from: now, to: event.endsAt, calendarIds: [id], query: "Focus" },
    });
    await client.callTool({ name: "get_event", arguments: { id } });
    await client.callTool({
      name: "create_event",
      arguments: {
        calendarId: id,
        title: "Focus",
        startsAt: now,
        endsAt: event.endsAt,
        timezone: "UTC",
      },
    });
    await client.callTool({
      name: "update_event",
      arguments: {
        allDay: true,
        expectedBlockUpdatedAtById: {},
        expectedUpdatedAt: now,
        id,
        location: null,
        notes: null,
        title: "Changed",
      },
    });
    await client.callTool({
      name: "block_event",
      arguments: { calendarId: id, expectedUpdatedAt: now, id },
    });
    await client.callTool({
      name: "set_event_block_privacy",
      arguments: {
        blockId: id,
        expectedBlockUpdatedAt: now,
        expectedUpdatedAt: now,
        id,
        mode: "details",
      },
    });
    await client.callTool({
      name: "unblock_event",
      arguments: {
        blockId: id,
        expectedBlockUpdatedAt: now,
        expectedUpdatedAt: now,
        id,
      },
    });
    const deletedEvent = await client.callTool({
      name: "delete_event",
      arguments: { expectedBlockUpdatedAtById: {}, expectedUpdatedAt: now, id },
    });
    expect(deletedEvent.structuredContent).toMatchObject({
      result: { blockUpdatedAtById: {}, eventId: id, updatedAt: now },
    });
    await client.callTool({
      name: "restore_event",
      arguments: { expectedBlockUpdatedAtById: {}, expectedUpdatedAt: now, id },
    });
    await client.callTool({
      name: "create_calendar_attention_item",
      arguments: {
        eventId: id,
        importance: "high",
        kind: "upcoming",
        summary: "Prepare the agenda.",
        title: "Upcoming focus",
      },
    });
    await client.callTool({
      name: "preview_calendar_commitment",
      arguments: { candidate: commitmentCandidate, requestedPolicy: "approved_rule" },
    });
    await client.callTool({ name: "list_activity", arguments: {} });
    await client.callTool({ name: "get_daily_brief", arguments: {} });

    expect(api.createReminder).toHaveBeenCalledWith({
      title: "Test",
      notes: null,
      dueAt: null,
      timezone: null,
      priority: "medium",
    });
    expect(api.completeReminder).toHaveBeenCalledWith(id, true, now);
    expect(api.getReminder).toHaveBeenCalledWith(id);
    expect(api.previewOverdueReminderDeferral).toHaveBeenCalledWith({
      limit: 100,
      overdueBefore: now,
      priority: undefined,
      proposedDueAt: "2026-07-14T13:00:00.000Z",
      timezone: "America/New_York",
    });
    expect(api.updateReminder).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ expectedUpdatedAt: now, title: "Changed" }),
    );
    expect(api.trashReminder).toHaveBeenCalledWith(id, now);
    expect(api.restoreReminder).toHaveBeenCalledWith(id, now);
    expect(api.createTask).toHaveBeenCalledWith({
      title: "Plan task",
      dueAt: null,
      estimateMinutes: null,
      idempotencyKey: projectId,
      lifecycle: "open",
      notes: null,
      priority: "medium",
      scheduledAt: task.scheduledAt,
      tags: [],
      timezone: task.timezone,
      why: null,
    });
    expect(api.completeTask).toHaveBeenCalledWith(id, { expectedRevision: 1 });
    expect(api.trashTask).toHaveBeenCalledWith(id, { expectedRevision: 1 });
    expect(api.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        allDay: false,
        location: null,
        notes: null,
        visibility: "default",
      }),
    );
    expect(api.getEvent).toHaveBeenCalledWith(id);
    expect(api.createEventBlock).toHaveBeenCalledWith(id, {
      calendarId: id,
      expectedUpdatedAt: now,
      mode: "busy",
    });
    expect(api.updateEventBlock).toHaveBeenCalledWith(id, id, {
      expectedBlockUpdatedAt: now,
      expectedUpdatedAt: now,
      mode: "details",
    });
    expect(api.deleteEventBlock).toHaveBeenCalledWith(id, id, {
      expectedBlockUpdatedAt: now,
      expectedUpdatedAt: now,
    });
    expect(api.trashEvent).toHaveBeenCalledWith(id, {
      expectedBlockUpdatedAtById: {},
      expectedUpdatedAt: now,
    });
    expect(api.restoreEvent).toHaveBeenCalledWith(id, {
      expectedBlockUpdatedAtById: {},
      expectedUpdatedAt: now,
    });
    expect(api.upsertCalendarAttentionItem).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ kind: "upcoming", summary: "Prepare the agenda." }),
    );
    expect(api.previewCalendarCommitment).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: commitmentCandidate,
        requestedPolicy: "approved_rule",
      }),
    );
    expect(api.listActivity).toHaveBeenCalledWith(50);
    expect(api.proposeFinanceCategorizations).toHaveBeenCalledWith({
      cursor: "next-review-page",
      limit: 50,
      review: "needs_review",
    });
    expect(api.upsertFinanceAttentionItem).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ importance: "high", kind: "important" }),
    );
    expect(api.listMailThreads).toHaveBeenCalledWith({
      accountIds: [accountId],
      limit: 100,
      mailboxId: id,
      query: "Test",
      unread: true,
    });
    expect(api.updateMailThread).toHaveBeenCalledWith(id, {
      expectedUpdatedAt: now,
      starred: true,
    });
    expect(api.bulkUpdateMail).toHaveBeenCalledWith({
      items: [{ expectedUpdatedAt: now, id }],
      unread: false,
    });
    expect(api.snoozeMailThread).toHaveBeenCalledWith(id, "2026-07-14T12:00:00.000Z");
    expect(api.sendMail).toHaveBeenCalledWith({
      accountId,
      body: "Reply body",
      cc: [],
      draftId: id,
      subject: "Re: Test mail",
      to: [{ address: "Recipient@Example.COM", name: null }],
    });
    expect(api.upsertDomainProfile).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "mail", status: "draft" }),
    );
    expect(api.previewMailRule).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: [accountId] }),
    );
    expect(api.previewSavedMailRule).toHaveBeenCalledWith(id);
    expect(api.upsertMailAttentionItem).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ importance: "high", kind: "important" }),
    );
    expect(api.updateMailRule).toHaveBeenCalledWith(id, {
      enabled: false,
      expectedVersion: 1,
    });

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toEqual([
      "personal-os://agenda/today",
      "personal-os://brief/daily",
      "ilo://context/self",
      "ui://ilo/work-surface",
    ]);
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      "ilo://setup/{domain}/{step}",
      "ilo://guidance/{domain}",
    ]);
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toEqual([
      "set_up_ilo",
      "plan_today",
      "triage_mail",
      "prepare_calendar_commitment",
      "review_overdue_reminders",
      "review_finances",
      "weekly_review",
    ]);
    const workSurface = await client.readResource({ uri: "ui://ilo/work-surface" });
    expect(workSurface.contents[0]).toMatchObject({
      _meta: { ui: { prefersBorder: true } },
      mimeType: "text/html;profile=mcp-app",
      uri: "ui://ilo/work-surface",
    });
    const workSurfaceContent = workSurface.contents[0];
    expect(workSurfaceContent && "text" in workSurfaceContent && workSurfaceContent.text).toContain(
      "ui/initialize",
    );
    expect(workSurfaceContent && "text" in workSurfaceContent && workSurfaceContent.text).toContain(
      "ui/notifications/tool-result",
    );
    const agenda = await client.readResource({ uri: "personal-os://agenda/today" });
    const agendaContent = agenda.contents[0];
    expect(agendaContent && "text" in agendaContent).toBe(true);
    const value = JSON.parse(
      String(agendaContent && "text" in agendaContent && agendaContent.text),
    );
    expect(value).toMatchObject({
      from: "2026-07-13T04:00:00.000Z",
      to: "2026-07-14T04:00:00.000Z",
    });
    expect(value.events).toHaveLength(1);
    expect(value.reminders).toHaveLength(1);
    expect(api.listEvents).toHaveBeenLastCalledWith({ from: value.from, to: value.to });
    expect(api.listReminders).toHaveBeenLastCalledWith({ completed: false, dueBefore: value.to });
    const dailyBrief = await client.readResource({ uri: "personal-os://brief/daily" });
    const dailyBriefContent = dailyBrief.contents[0];
    expect(
      JSON.parse(
        String(dailyBriefContent && "text" in dailyBriefContent && dailyBriefContent.text),
      ),
    ).toEqual(brief);

    await client.close();
    await server.close();
  });

  it("uses the real current time when a clock is not injected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00.000Z"));
    const api = mockApi();
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      timeZone: "UTC",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const agenda = await client.readResource({ uri: "personal-os://agenda/today" });
    const content = agenda.contents[0];
    expect(content && "text" in content).toBe(true);
    expect(JSON.parse(String(content && "text" in content && content.text)).from).toBe(
      "2026-07-13T00:00:00.000Z",
    );
    await client.close();
    await server.close();
    vi.useRealTimers();
  });

  it("filters task discovery by scopes and read-only posture while keeping typed Ilo metadata", async () => {
    const api = mockApi();
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      appBaseUrl: "https://app.example.com",
      readOnly: true,
      scopes: new Set(["tasks:read"]),
      timeZone: "America/New_York",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toContain("get_ilo_context");
    expect(names).toEqual(
      expect.arrayContaining([
        "list_task_lists",
        "get_task_list",
        "list_task_projects",
        "get_task_project",
        "preview_task_project_move",
        "list_tasks",
        "get_task",
        "preview_task_move",
      ]),
    );
    expect(names).not.toContain("get_daily_brief");
    expect(names).not.toContain("create_task");
    expect(names).not.toContain("archive_task_list");
    expect(names).not.toContain("move_task_project");
    expect(names).not.toContain("trash_task");
    expect(names).not.toContain("list_mail");
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "get_ilo_context")).toMatchObject({
      _meta: { ui: { resourceUri: "ui://ilo/work-surface" } },
      outputSchema: { type: "object" },
    });

    const context = await client.callTool({ arguments: {}, name: "get_ilo_context" });
    expect(context.structuredContent).toMatchObject({
      _ilo: {
        domain: "assistant",
        links: { today: "https://app.example.com/today" },
        policy: "read_only",
        stage: "context",
      },
      result: {
        mcp: {
          availableTools: expect.arrayContaining(["get_ilo_context", "list_tasks"]),
          readOnly: true,
        },
      },
    });

    await client.callTool({
      name: "preview_task_project_move",
      arguments: { destinationListId: accountId, expectedRevision: 1, id: projectId },
    });
    await client.callTool({
      name: "preview_task_move",
      arguments: { destinationListId: accountId, expectedRevision: 1, id },
    });
    expect(api.previewTaskProjectMove).toHaveBeenCalledWith(projectId, {
      destinationListId: accountId,
      expectedRevision: 1,
    });
    expect(api.previewTaskMove).toHaveBeenCalledWith(id, {
      destinationListId: accountId,
      expectedRevision: 1,
    });

    await client.close();
    await server.close();

    const writeOnlyServer = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      scopes: new Set(["tasks:write"]),
      timeZone: "UTC",
    });
    const writeOnlyClient = new Client({ name: "test", version: "1.0.0" });
    const [writeOnlyClientTransport, writeOnlyServerTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      writeOnlyServer.connect(writeOnlyServerTransport),
      writeOnlyClient.connect(writeOnlyClientTransport),
    ]);
    const writeOnlyNames = (await writeOnlyClient.listTools()).tools.map((tool) => tool.name);
    expect(writeOnlyNames).toContain("move_task");
    expect(writeOnlyNames).toContain("move_task_project");
    expect(writeOnlyNames).not.toContain("preview_task_move");
    expect(writeOnlyNames).not.toContain("preview_task_project_move");
    expect(writeOnlyNames).not.toContain("get_task");
    await writeOnlyClient.close();
    await writeOnlyServer.close();
  });

  it("exposes complete-workspace Finance status and maintenance intents", async () => {
    const api = mockApi();
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      appBaseUrl: "https://app.example.com",
      timeZone: "America/New_York",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.find((tool) => tool.name === "get_finance_status")).toMatchObject({
      _meta: {
        "ilo/domain": "finances",
        "ilo/policy": "read_only",
        "ilo/stage": "inspect",
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      inputSchema: { additionalProperties: false, properties: { scope: expect.any(Object) } },
    });
    expect(tools.tools.find((tool) => tool.name === "maintain_finances")).toMatchObject({
      _meta: {
        "ilo/domain": "finances",
        "ilo/policy": "approved_rule",
        "ilo/stage": "commit",
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      inputSchema: { additionalProperties: false, properties: { scope: expect.any(Object) } },
    });

    const maintenance = await client.callTool({ arguments: {}, name: "maintain_finances" });
    expect(api.maintainFinances).toHaveBeenCalledWith({ type: "all_outstanding" });
    expect(maintenance).toMatchObject({
      structuredContent: {
        _ilo: {
          domain: "finances",
          links: { recovery: "https://app.example.com/settings?section=connections" },
          policy: "approved_rule",
          readOnly: false,
          stage: "commit",
        },
        result: { id, status: "queued" },
      },
    });

    await client.callTool({
      arguments: { scope: { end: "2026-08-16", start: "2026-08-01", type: "window" } },
      name: "maintain_finances",
    });
    expect(api.maintainFinances).toHaveBeenLastCalledWith({
      end: "2026-08-16",
      start: "2026-08-01",
      type: "window",
    });
    await client.callTool({
      arguments: { scope: { entityType: "finance_transaction", id, type: "target" } },
      name: "get_finance_status",
    });
    expect(api.getFinanceStatus).toHaveBeenLastCalledWith({
      entityType: "finance_transaction",
      id,
      type: "target",
    });

    const unsupported = await client.callTool({
      arguments: { batch: 5, scope: { type: "all_outstanding" } },
      name: "maintain_finances",
    });
    expect(unsupported.isError).toBe(true);
    expect(api.maintainFinances).toHaveBeenCalledTimes(2);

    await client.close();
    await server.close();
  });

  it("preserves Finance maintenance API errors at the durable handoff boundary", async () => {
    const api = mockApi();
    api.maintainFinances.mockRejectedValueOnce(
      new ApiClientError({
        code: "conflict",
        details: { activeRunId: id },
        message: "A Finance maintenance run is already active.",
        requestId: "finance-maintenance-request-123",
        status: 409,
      }),
    );
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      appBaseUrl: "https://app.example.com",
      timeZone: "America/New_York",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({ arguments: {}, name: "maintain_finances" });
    const expectedError = {
      code: "conflict",
      details: { activeRunId: id },
      message: "A Finance maintenance run is already active.",
      requestId: "finance-maintenance-request-123",
      status: 409,
    };
    expect(response).toMatchObject({
      isError: true,
      structuredContent: {
        _ilo: { domain: "finances", policy: "approved_rule", stage: "commit" },
        error: expectedError,
      },
    });
    expect(response.content).toEqual([
      { text: JSON.stringify({ error: expectedError }, null, 2), type: "text" },
    ]);

    await client.close();
    await server.close();
  });

  it("renders the Finance review prompt without a maintenance handoff on read-only or status-only access", async () => {
    const limitedAccessOptions: Array<{ readOnly: boolean; scopes: Set<AccessScope> }> = [
      { readOnly: true, scopes: new Set(["finances:read", "finances:maintain"]) },
      { readOnly: false, scopes: new Set(["finances:read"]) },
    ];
    for (const options of limitedAccessOptions) {
      const api = mockApi();
      const server = createPersonalOsMcpServer({
        api: api as unknown as PersonalOsApiClient,
        ...options,
        timeZone: "America/New_York",
      });
      const client = new Client({ name: "test", version: "1.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toContain("review_finances");
      const prompt = await client.getPrompt({ arguments: {}, name: "review_finances" });
      const text =
        prompt.messages[0]?.content.type === "text" ? prompt.messages[0].content.text : "";
      expect(text).toContain("get_finance_status");
      expect(text).toContain("Present pending work");
      expect(text).not.toContain("maintain_finances");
      expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain(
        "maintain_finances",
      );

      await client.close();
      await server.close();
    }
  });

  it("uses the hardened Mail send schema for normalization and header injection rejection", async () => {
    const api = mockApi();
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      now: () => new Date("2026-07-13T16:00:00.000Z"),
      timeZone: "America/New_York",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const invalidSubject = await client.callTool({
      arguments: {
        accountId,
        body: "Body",
        draftId: id,
        subject: "Hello\r\nBcc: attacker@example.com",
        to: [{ address: "recipient@example.com", name: null }],
      },
      name: "send_mail",
    });
    const invalidName = await client.callTool({
      arguments: {
        accountId,
        body: "Body",
        draftId: id,
        subject: "Hello",
        to: [
          {
            address: "recipient@example.com",
            name: "Recipient\r\nBcc: attacker@example.com",
          },
        ],
      },
      name: "send_mail",
    });
    expect(invalidSubject).toMatchObject({ isError: true });
    expect(invalidName).toMatchObject({ isError: true });
    expect(api.sendMail).not.toHaveBeenCalled();
    const missingDraft = await client.callTool({
      arguments: {
        accountId,
        body: "Body",
        subject: "Hello",
        to: [{ address: "recipient@example.com", name: null }],
      },
      name: "send_mail",
    });
    expect(missingDraft).toMatchObject({ isError: true });
    expect(api.sendMail).not.toHaveBeenCalled();

    const normalized = await client.callTool({
      arguments: {
        accountId,
        body: "Body",
        draftId: id,
        subject: "Hello",
        to: [{ address: "Recipient@Example.COM", name: null }],
      },
      name: "send_mail",
    });
    expect(normalized.isError).not.toBe(true);
    expect(api.sendMail).toHaveBeenCalledWith({
      accountId,
      body: "Body",
      cc: [],
      draftId: id,
      subject: "Hello",
      to: [{ address: "Recipient@Example.COM", name: null }],
    });

    await client.close();
    await server.close();
  });

  it("preserves structured Mail API partial-effect errors at the tool boundary", async () => {
    const api = mockApi();
    api.updateMailThread.mockRejectedValueOnce(
      new ApiClientError({
        code: "provider_partial_effect",
        details: {
          accountId,
          partialEffect: true,
          remoteThreadId: "remote-thread-1",
          repairAction: "reconnect_then_sync_mail_account",
        },
        message:
          "The provider update may have committed, but Ilo could not persist rotated credentials.",
        requestId: "mail-request-123",
        status: 502,
      }),
    );
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      now: () => new Date("2026-07-13T16:00:00.000Z"),
      timeZone: "America/New_York",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: { expectedUpdatedAt: now, id, unread: false },
      name: "update_mail",
    });
    const expectedError = {
      code: "provider_partial_effect",
      details: {
        accountId,
        partialEffect: true,
        remoteThreadId: "remote-thread-1",
        repairAction: "reconnect_then_sync_mail_account",
      },
      message:
        "The provider update may have committed, but Ilo could not persist rotated credentials.",
      requestId: "mail-request-123",
      status: 502,
    };
    expect(response).toMatchObject({
      isError: true,
      structuredContent: { error: expectedError },
    });
    expect(response.content).toEqual([
      { text: JSON.stringify({ error: expectedError }, null, 2), type: "text" },
    ]);

    await client.close();
    await server.close();
  });

  it("preserves structured Calendar API partial-effect errors at the tool boundary", async () => {
    const api = mockApi();
    api.updateEvent.mockRejectedValueOnce(
      new ApiClientError({
        code: "provider_partial_effect",
        details: {
          completedEffects: [
            {
              action: "update",
              calendarId: id,
              eventId: id,
              provider: "google",
              remoteEventId: "remote-event-1",
              role: "source",
            },
          ],
          operation: "update_event",
          partialEffect: true,
          pendingEffects: [],
          provider: "google",
          recovery: "Synchronize Calendar before retrying.",
          remoteEventId: "remote-event-1",
        },
        message:
          "The provider event changed, but Ilo could not finish its local Calendar projection.",
        requestId: "calendar-request-123",
        status: 502,
      }),
    );
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      now: () => new Date("2026-07-13T16:00:00.000Z"),
      timeZone: "America/New_York",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: {
        expectedBlockUpdatedAtById: {},
        expectedUpdatedAt: now,
        id,
        title: "Updated focus",
      },
      name: "update_event",
    });
    const expectedError = {
      code: "provider_partial_effect",
      details: {
        completedEffects: [
          {
            action: "update",
            calendarId: id,
            eventId: id,
            provider: "google",
            remoteEventId: "remote-event-1",
            role: "source",
          },
        ],
        operation: "update_event",
        partialEffect: true,
        pendingEffects: [],
        provider: "google",
        recovery: "Synchronize Calendar before retrying.",
        remoteEventId: "remote-event-1",
      },
      message:
        "The provider event changed, but Ilo could not finish its local Calendar projection.",
      requestId: "calendar-request-123",
      status: 502,
    };
    expect(response).toMatchObject({
      isError: true,
      structuredContent: { error: expectedError },
    });
    expect(response.content).toEqual([
      { text: JSON.stringify({ error: expectedError }, null, 2), type: "text" },
    ]);

    await client.close();
    await server.close();
  });

  it("preserves structured Finance conflicts at the proposal tool boundary", async () => {
    const api = mockApi();
    api.proposeFinanceCategorizations.mockRejectedValueOnce(
      new ApiClientError({
        code: "conflict",
        details: { currentCursor: "opaque-current" },
        message: "The Finance proposal page changed.",
        requestId: "finance-request-123",
        status: 409,
      }),
    );
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      now: () => new Date("2026-07-13T16:00:00.000Z"),
      timeZone: "America/New_York",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: { cursor: "opaque-stale" },
      name: "propose_finance_categorizations",
    });
    expect(response).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "conflict",
          details: { currentCursor: "opaque-current" },
          message: "The Finance proposal page changed.",
          requestId: "finance-request-123",
          status: 409,
        },
      },
    });

    await client.close();
    await server.close();
  });

  it("preserves domain profile validation errors at the shared setup tool boundary", async () => {
    const api = mockApi();
    api.upsertDomainProfile.mockRejectedValueOnce(
      new ApiClientError({
        code: "invalid_request",
        details: {
          domain: "mail",
          reason: "source_disconnected",
          sourceIds: [accountId],
        },
        message: "Active Mail setup requires an owned connected Mail source.",
        requestId: "profile-request-123",
        status: 400,
      }),
    );
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      now: () => new Date("2026-07-13T16:00:00.000Z"),
      timeZone: "America/New_York",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: {
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep a focused inbox.",
        preferences: {},
        sourceContexts: [
          {
            notes: null,
            purpose: "Primary inbox",
            sourceId: accountId,
            sourceLabel: "Personal",
          },
        ],
        status: "active",
        summary: "Only high-signal mail stays visible.",
      },
      name: "save_domain_profile",
    });
    const expectedError = {
      code: "invalid_request",
      details: {
        domain: "mail",
        reason: "source_disconnected",
        sourceIds: [accountId],
      },
      message: "Active Mail setup requires an owned connected Mail source.",
      requestId: "profile-request-123",
      status: 400,
    };
    expect(response).toMatchObject({
      isError: true,
      structuredContent: { error: expectedError },
    });
    expect(response.content).toEqual([
      { text: JSON.stringify({ error: expectedError }, null, 2), type: "text" },
    ]);

    await client.close();
    await server.close();
  });
});
