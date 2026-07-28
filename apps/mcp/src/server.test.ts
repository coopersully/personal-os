import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import type {
  AutomationRoutine,
  AutomationRun,
  Calendar,
  CalendarEvent,
  DailyBrief,
  Mailbox,
  MailThread,
  Reminder,
  Task,
} from "@personal-os/domain";
import { createPersonalOsMcpServer } from "./server.js";

const now = "2026-07-13T12:00:00.000Z";
const id = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
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
  id,
  title: "Plan task",
  notes: null,
  dueAt: null,
  scheduledAt: "2026-07-13T13:00:00.000Z",
  timezone: "America/New_York",
  priority: "medium",
  estimateMinutes: 30,
  tags: ["planning"],
  status: "scheduled",
  completedAt: null,
  createdAt: now,
  updatedAt: now,
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
const automation: AutomationRoutine = {
  id,
  template: "morning_brief",
  title: "Morning brief",
  schedule: "Weekdays at 8:00 AM",
  timezone: "America/New_York",
  enabled: true,
  lastRunAt: null,
  createdAt: now,
  updatedAt: now,
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
const automationRun: AutomationRun = {
  id: accountId,
  routineId: id,
  status: "dry_run",
  summary: "Morning brief previewed.",
  brief,
  startedAt: now,
  completedAt: now,
};

function mockApi() {
  return {
    getAssistantSetupStatus: vi.fn(async () => ({
      domains: [
        {
          canRead: true,
          canWrite: true,
          domain: "mail" as const,
          profileStatus: "draft" as const,
          profileVersion: 1,
        },
      ],
    })),
    getDomainProfile: vi.fn(async () => domainProfile),
    upsertDomainProfile: vi.fn(async () => domainProfile),
    listAttentionItems: vi.fn(async () => [attentionItem]),
    createAttentionItem: vi.fn(async () => attentionItem),
    updateAttentionItem: vi.fn(async () => attentionItem),
    completeReminder: vi.fn(async () => reminder),
    completeTask: vi.fn(async () => task),
    createReminder: vi.fn(async () => reminder),
    createTask: vi.fn(async () => task),
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
    proposeFinanceCategorizations: vi.fn(async () => []),
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
    deleteReminder: vi.fn(async () => undefined),
    deleteTask: vi.fn(async () => undefined),
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
    })),
    restoreReminder: vi.fn(async () => reminder),
    listTasks: vi.fn(async () => ({ items: [task], nextCursor: null })),
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
    listMailThreads: vi.fn(async () => [mailThread]),
    getMailThread: vi.fn(async () => mailThread),
    listMailMessages: vi.fn(async () => []),
    listMailRules: vi.fn(async () => [mailRule]),
    previewMailRule: vi.fn(async () => ({
      candidates: [],
      matchedCount: 0,
      scannedCount: 1,
    })),
    createMailRule: vi.fn(async () => mailRule),
    updateMailRule: vi.fn(async () => ({ ...mailRule, enabled: true, version: 2 })),
    updateMailThread: vi.fn(async () => mailThread),
    snoozeMailThread: vi.fn(async () => undefined),
    sendMail: vi.fn(async () => undefined),
    listEvents: vi.fn(async () => [event]),
    createEvent: vi.fn(async () => event),
    createEventBlock: vi.fn(async () => event),
    updateEvent: vi.fn(async () => event),
    updateEventBlock: vi.fn(async () => event),
    deleteEvent: vi.fn(async () => undefined),
    deleteEventBlock: vi.fn(async () => event),
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
    listAutomations: vi.fn(async () => [automation]),
    runAutomation: vi.fn(async () => automationRun),
    listXBookmarks: vi.fn(async () => []),
    syncXBookmarks: vi.fn(async () => 0),
  };
}

describe("ilo MCP server", () => {
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
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "get_agent_setup_status",
      "get_domain_profile",
      "save_domain_profile",
      "list_attention_items",
      "create_attention_item",
      "update_attention_item",
      "get_finance_wealth_summary",
      "get_finance_cashflow",
      "review_finance_recurring_payment",
      "resolve_finance_alert",
      "get_finance_ledger_health",
      "list_finance_transactions",
      "get_finance_categories",
      "get_finance_budget_status",
      "list_finance_merchants",
      "rename_finance_merchant",
      "merge_finance_merchants",
      "get_finance_review_queue",
      "propose_finance_categorizations",
      "apply_finance_categorizations",
      "resolve_finance_review",
      "get_finance_overview",
      "add_finance_transaction",
      "categorize_finance_transaction",
      "list_reminders",
      "get_reminder",
      "preview_overdue_reminder_deferral",
      "create_reminder",
      "update_reminder",
      "complete_reminder",
      "delete_reminder",
      "restore_reminder",
      "list_x_bookmarks",
      "sync_x_bookmarks",
      "list_tasks",
      "create_task",
      "update_task",
      "complete_task",
      "delete_task",
      "list_calendars",
      "list_mailboxes",
      "list_mail",
      "read_mail",
      "update_mail",
      "bulk_update_mail",
      "snooze_mail",
      "send_mail",
      "list_mail_rules",
      "preview_mail_rule",
      "create_mail_rule",
      "update_mail_rule",
      "list_events",
      "create_event",
      "update_event",
      "block_event",
      "set_event_block_privacy",
      "unblock_event",
      "delete_event",
      "list_goals",
      "create_goal",
      "update_goal",
      "list_motives",
      "create_motive",
      "list_activity",
      "get_daily_brief",
      "list_automations",
      "run_automation",
    ]);
    expect(tools.tools.find((tool) => tool.name === "delete_event")?.annotations).toMatchObject({
      destructiveHint: true,
    });
    const reminderTools = tools.tools.filter((tool) => tool.name.includes("reminder"));
    expect(reminderTools).toHaveLength(8);
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

    await client.callTool({ name: "get_agent_setup_status", arguments: {} });
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
      arguments: { domain: "mail", id, status: "resolved" },
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

    await client.callTool({ name: "get_finance_overview", arguments: {} });
    await client.callTool({ name: "get_finance_wealth_summary", arguments: {} });
    await client.callTool({ name: "get_finance_cashflow", arguments: {} });
    await client.callTool({
      name: "review_finance_recurring_payment",
      arguments: { id, status: "active" },
    });
    await client.callTool({
      name: "resolve_finance_alert",
      arguments: { action: "resolve", id, rationale: "Reviewed in the dashboard." },
    });
    await client.callTool({ name: "get_finance_ledger_health", arguments: {} });
    await client.callTool({ name: "list_finance_transactions", arguments: { limit: 10 } });
    await client.callTool({ name: "get_finance_categories", arguments: {} });
    await client.callTool({ name: "get_finance_budget_status", arguments: { month: "2026-07" } });
    await client.callTool({ name: "list_finance_merchants", arguments: {} });
    await client.callTool({
      name: "rename_finance_merchant",
      arguments: { displayName: "Test", id },
    });
    await client.callTool({
      name: "merge_finance_merchants",
      arguments: { sourceMerchantId: accountId, targetMerchantId: id },
    });
    await client.callTool({ name: "get_finance_review_queue", arguments: {} });
    await client.callTool({ name: "propose_finance_categorizations", arguments: {} });
    await client.callTool({
      name: "apply_finance_categorizations",
      arguments: {
        decisions: [
          {
            categoryId: id,
            confidence: 0.99,
            rationale: "Known merchant history.",
            transactionId: accountId,
          },
        ],
      },
    });
    await client.callTool({
      name: "resolve_finance_review",
      arguments: { action: "defer", id },
    });
    await client.callTool({ name: "list_x_bookmarks", arguments: {} });
    await client.callTool({ name: "sync_x_bookmarks", arguments: {} });
    await client.callTool({
      name: "add_finance_transaction",
      arguments: {
        accountId,
        amount: 1,
        date: "2026-07-13",
        direction: "expense",
        merchant: "Test",
      },
    });
    await client.callTool({
      name: "add_finance_transaction",
      arguments: {
        accountId,
        amount: 2,
        category: null,
        date: "2026-07-13",
        direction: "expense",
        merchant: "Uncategorized",
      },
    });
    await client.callTool({
      name: "add_finance_transaction",
      arguments: {
        accountId,
        amount: 3,
        category: "Dining",
        date: "2026-07-13",
        direction: "expense",
        merchant: "Categorized",
      },
    });
    await client.callTool({
      name: "categorize_finance_transaction",
      arguments: { id, category: "Dining" },
    });

    await client.callTool({
      name: "list_reminders",
      arguments: { completed: false, limit: 25, query: "Test" },
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
    await client.callTool({ name: "complete_reminder", arguments: { id } });
    const deletedReminder = await client.callTool({ name: "delete_reminder", arguments: { id } });
    expect(deletedReminder.structuredContent).toEqual({ ok: true });
    await client.callTool({ name: "restore_reminder", arguments: { id } });
    await client.callTool({ name: "list_tasks", arguments: { status: "scheduled" } });
    await client.callTool({
      name: "create_task",
      arguments: {
        title: "Plan task",
        status: "scheduled",
        scheduledAt: task.scheduledAt,
        timezone: task.timezone,
      },
    });
    await client.callTool({
      name: "update_task",
      arguments: { id, estimateMinutes: 45, status: "next" },
    });
    await client.callTool({ name: "complete_task", arguments: { id } });
    const deletedTask = await client.callTool({ name: "delete_task", arguments: { id } });
    expect(deletedTask.structuredContent).toEqual({ ok: true });
    await client.callTool({ name: "list_calendars", arguments: {} });
    await client.callTool({ name: "list_mailboxes", arguments: {} });
    await client.callTool({
      name: "list_mail",
      arguments: { accountIds: [accountId], mailboxId: id, query: "Test", unread: true },
    });
    await client.callTool({ name: "read_mail", arguments: { id } });
    await client.callTool({ name: "update_mail", arguments: { id, starred: true } });
    await client.callTool({ name: "bulk_update_mail", arguments: { ids: [id], unread: false } });
    await client.callTool({
      name: "snooze_mail",
      arguments: { id, until: "2026-07-14T12:00:00.000Z" },
    });
    await client.callTool({
      name: "send_mail",
      arguments: {
        accountId,
        body: "Reply body",
        subject: "Re: Test mail",
        to: [{ address: "recipient@example.com", name: null }],
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
      arguments: { enabled: true, expectedVersion: 1, id },
    });
    await client.callTool({
      name: "list_events",
      arguments: { from: now, to: event.endsAt, calendarIds: [id], query: "Focus" },
    });
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
      arguments: { id, title: "Changed", notes: null, location: null, allDay: true },
    });
    await client.callTool({
      name: "block_event",
      arguments: { calendarId: id, id },
    });
    await client.callTool({
      name: "set_event_block_privacy",
      arguments: { blockId: id, id, mode: "details" },
    });
    await client.callTool({ name: "unblock_event", arguments: { blockId: id, id } });
    const deletedEvent = await client.callTool({ name: "delete_event", arguments: { id } });
    expect(deletedEvent.content).toEqual([{ type: "text", text: "Event moved to trash." }]);
    await client.callTool({ name: "list_activity", arguments: {} });
    await client.callTool({ name: "get_daily_brief", arguments: {} });
    await client.callTool({ name: "list_automations", arguments: {} });
    await client.callTool({ name: "run_automation", arguments: { id, dryRun: true } });

    expect(api.createReminder).toHaveBeenCalledWith({
      title: "Test",
      notes: null,
      dueAt: null,
      timezone: null,
      priority: "medium",
    });
    expect(api.completeReminder).toHaveBeenCalledWith(id, true);
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
    expect(api.restoreReminder).toHaveBeenCalledWith(id);
    expect(api.createTask).toHaveBeenCalledWith({
      title: "Plan task",
      dueAt: null,
      estimateMinutes: null,
      notes: null,
      priority: "medium",
      scheduledAt: task.scheduledAt,
      status: "scheduled",
      tags: [],
      timezone: task.timezone,
    });
    expect(api.completeTask).toHaveBeenCalledWith(id, true);
    expect(api.deleteTask).toHaveBeenCalledWith(id);
    expect(api.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ allDay: false, notes: null, location: null }),
    );
    expect(api.createEventBlock).toHaveBeenCalledWith(id, { calendarId: id, mode: "busy" });
    expect(api.updateEventBlock).toHaveBeenCalledWith(id, id, { mode: "details" });
    expect(api.deleteEventBlock).toHaveBeenCalledWith(id, id);
    expect(api.listActivity).toHaveBeenCalledWith(50);
    expect(api.runAutomation).toHaveBeenCalledWith(id, true);
    expect(api.listMailThreads).toHaveBeenCalledWith({
      accountIds: [accountId],
      limit: 100,
      mailboxId: id,
      query: "Test",
      unread: true,
    });
    expect(api.updateMailThread).toHaveBeenCalledWith(id, { starred: true });
    expect(api.updateMailThread).toHaveBeenCalledWith(id, { unread: false });
    expect(api.snoozeMailThread).toHaveBeenCalledWith(id, "2026-07-14T12:00:00.000Z");
    expect(api.sendMail).toHaveBeenCalledWith({
      accountId,
      body: "Reply body",
      cc: [],
      subject: "Re: Test mail",
      to: [{ address: "recipient@example.com", name: null }],
    });
    expect(api.upsertDomainProfile).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "mail", status: "draft" }),
    );
    expect(api.previewMailRule).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: [accountId] }),
    );
    expect(api.updateMailRule).toHaveBeenCalledWith(id, {
      enabled: true,
      expectedVersion: 1,
    });

    const resources = await client.listResources();
    expect(resources.resources).toHaveLength(2);
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
});
