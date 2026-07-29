// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { UpdateAccountSetupInput, User } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App, formatTimelineTimeRange, isNavigator, positionTimelineEvents } from "./app.js";
import {
  getWorkspaceCalendarEntry,
  workspaceCalendarSummary,
  workspaceIndicatorOffset,
  workspaceTodaySummary,
} from "./components/workspace-switching.js";

const now = "2026-07-13T12:00:00.000Z";
const capacity = {
  availableMinutes: 240,
  busyMinutes: 0,
  flexibleTaskMinutes: 30,
  overcommitted: false,
  scheduledTaskMinutes: 0,
  workdayEndsAt: "2026-07-13T17:00:00.000Z",
  workdayStartsAt: "2026-07-13T09:00:00.000Z",
};
const id = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const thirdId = "33333333-3333-4333-8333-333333333333";
const fakeAppleAppPassword = ["xxxx", "xxxx", "xxxx", "xxxx"].join("-");
const user: User = {
  accentColor: "#c7d23c",
  emailVerified: true,
  id,
  setup: {
    completedAt: now,
    currentStep: "ready" as const,
    dismissedAt: null,
    selectedWorkspaces: ["calendar", "tasks", "mail", "finances"],
    startedAt: now,
    status: "complete" as const,
  },
  displayName: "Test User",
  email: "test@example.com",
  theme: "system" as const,
  planningTimezone: "UTC",
  homeLocation: null,
  workdayStartMinute: 9 * 60,
  workdayEndMinute: 17 * 60,
  createdAt: now,
  updatedAt: now,
};
const calendar = {
  id,
  accountId: secondId,
  provider: "local" as const,
  name: "Personal",
  color: "#5b6cff",
  timezone: "UTC",
  isPrimary: true,
  isSelected: true,
  isWritable: true,
  lastSyncedAt: null,
};
const googleCalendar = {
  ...calendar,
  id: secondId,
  accountId: thirdId,
  provider: "google" as const,
  name: "Readonly Google",
  color: null,
  isPrimary: false,
  isSelected: false,
  isWritable: false,
  lastSyncedAt: now,
};
const event = {
  id,
  calendarId: id,
  provider: "local" as const,
  remoteEventId: null,
  blockSourceEventId: null,
  blockMode: null,
  blocks: [],
  title: "Focus block",
  notes: null,
  location: "Studio",
  startsAt: "2026-07-13T13:00:00.000Z",
  endsAt: "2026-07-13T14:00:00.000Z",
  timezone: "UTC",
  allDay: false,
  status: "confirmed" as const,
  recurrence: [],
  createdAt: now,
  updatedAt: now,
};
const allDayEvent = {
  ...event,
  id: secondId,
  title: "Quiet day",
  location: null,
  startsAt: "2026-07-13T00:00:00.000Z",
  endsAt: "2026-07-14T00:00:00.000Z",
  allDay: true,
};
const reminder = {
  id,
  title: "Test reminder",
  notes: "A note",
  dueAt: "2026-07-13T15:00:00.000Z",
  timezone: "UTC",
  priority: "high" as const,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};
const completedReminder = {
  ...reminder,
  id: secondId,
  title: "Finished reminder",
  notes: null,
  dueAt: null,
  completedAt: now,
  priority: "low" as const,
};
const overdueReminder = {
  ...reminder,
  id: thirdId,
  title: "Overdue reminder",
  dueAt: "2026-07-12T15:00:00.000Z",
};
const task = {
  id: "88888888-8888-4888-8888-888888888888",
  title: "Draft brief",
  notes: "Keep it concise",
  dueAt: "2026-07-13T16:00:00.000Z",
  scheduledAt: null,
  timezone: "UTC",
  priority: "high" as const,
  estimateMinutes: 30,
  tags: ["planning"],
  status: "next" as const,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};
const nullColorCalendar = {
  ...googleCalendar,
  id: "44444444-4444-4444-8444-444444444444",
  name: "Selected Google",
  isSelected: true,
  isWritable: true,
};
const mailbox = {
  accountId: secondId,
  id: "55555555-5555-4555-8555-555555555555",
  name: "Inbox",
  provider: "google" as const,
  role: "inbox" as const,
  totalCount: 2,
  unreadCount: 1,
};
const mailThread = {
  accountId: secondId,
  bodyText: "Hello Example User. This is the full message.",
  from: { address: "ada@example.com", name: "Ada" },
  id: "66666666-6666-4666-8666-666666666666",
  mailboxIds: [mailbox.id],
  messageCount: 2,
  provider: "google" as const,
  receivedAt: now,
  remoteThreadId: "remote-thread",
  snippet: "Hello Example User",
  starred: true,
  subject: "Project update",
  to: [{ address: "test@example.com", name: null }],
  unread: true,
};
const secondMailThread = {
  ...mailThread,
  bodyText: "",
  from: { address: "", name: null },
  id: "77777777-7777-4777-8777-777777777777",
  messageCount: 1,
  snippet: "",
  starred: false,
  subject: "No body",
  unread: false,
};

const mocks = vi.hoisted(() => ({
  completeReminder: vi.fn(),
  completeTask: vi.fn(),
  confirmEmailVerification: vi.fn(),
  connectICloud: vi.fn(),
  createAccessToken: vi.fn(),
  createInvitation: vi.fn(),
  createCalendar: vi.fn(),
  createMailDraft: vi.fn(),
  createEvent: vi.fn(),
  createEventBlock: vi.fn(),
  createGoal: vi.fn(),
  createMotive: vi.fn(),
  createFinanceAccount: vi.fn(),
  createFinanceBudget: vi.fn(),
  createFinanceTransaction: vi.fn(),
  exchangePlaidToken: vi.fn(),
  createReminder: vi.fn(),
  createTask: vi.fn(),
  deleteAccessToken: vi.fn(),
  deleteCalendar: vi.fn(),
  deleteConnector: vi.fn(),
  deleteXBookmarkAccount: vi.fn(),
  deleteEvent: vi.fn(),
  deleteEventBlock: vi.fn(),
  deleteReminder: vi.fn(),
  deleteTask: vi.fn(),
  deleteGoal: vi.fn(),
  deleteMotive: vi.fn(),
  createAutomation: vi.fn(),
  getDailyBrief: vi.fn(),
  getAgentConnectionGuide: vi.fn(),
  getAssistantSetupStatus: vi.fn(),
  getDomainProfile: vi.fn(),
  getWeather: vi.fn(),
  searchWeatherLocations: vi.fn(),
  getGoogleAuthorizationUrl: vi.fn(),
  getXBookmarkAccount: vi.fn(),
  getXBookmarkAuthorizationUrl: vi.fn(),
  getPinterestWallpaperSettings: vi.fn(),
  getMailSetupContext: vi.fn(),
  getMailThread: vi.fn(),
  getMe: vi.fn(),
  isTauri: vi.fn(),
  listAccessTokens: vi.fn(),
  listActivity: vi.fn(),
  listAutomations: vi.fn(),
  listAutomationRuns: vi.fn(),
  listCalendars: vi.fn(),
  listConnectors: vi.fn(),
  listXBookmarkFolders: vi.fn(),
  listXBookmarks: vi.fn(),
  listEvents: vi.fn(),
  listMailboxes: vi.fn(),
  listMailDrafts: vi.fn(),
  listMailMessages: vi.fn(),
  listMailRules: vi.fn(),
  listMailThreads: vi.fn(),
  listInvitations: vi.fn(),
  listOAuthClients: vi.fn(),
  reconcileMailDraft: vi.fn(),
  sendMail: vi.fn(),
  snoozeMailThread: vi.fn(),
  listGoals: vi.fn(),
  listMotives: vi.fn(),
  listPinterestPins: vi.fn(),
  getFinanceOverview: vi.fn(),
  getFinanceOverviewForMonth: vi.fn(),
  getFinanceBudgetPace: vi.fn(),
  getFinanceLedgerHealth: vi.fn(),
  getFinanceGuidedSetup: vi.fn(),
  getFinanceProfile: vi.fn(),
  listFinanceIncomeStreams: vi.fn(),
  listFinanceRecurringObligations: vi.fn(),
  listFinanceAlerts: vi.fn(),
  getFinanceForecast: vi.fn(),
  getFinanceWealthSummary: vi.fn(),
  exportFinanceData: vi.fn(),
  getFinanceCategories: vi.fn(),
  getFinanceReviewQueue: vi.fn(),
  listFinanceTransactions: vi.fn(),
  importFinanceCsv: vi.fn(),
  getPlaidLinkToken: vi.fn(),
  getPlaidStatus: vi.fn(),
  invoke: vi.fn(),
  updateFinanceTransaction: vi.fn(),
  updateGoal: vi.fn(),
  updateMotive: vi.fn(),
  updatePinterestWallpaperSettings: vi.fn(),
  listReminders: vi.fn(),
  listTasks: vi.fn(),
  listSessions: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  openUrl: vi.fn(),
  plaidLink: {
    onSuccess: null as ((publicToken: string | null) => void) | null,
    open: vi.fn(),
    ready: false,
  },
  register: vi.fn(),
  recordPinterestWallpaperApplied: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendEmailVerification: vi.fn(),
  resetPassword: vi.fn(),
  resolveFinanceReview: vi.fn(),
  restoreEvent: vi.fn(),
  restoreReminder: vi.fn(),
  runAutomation: vi.fn(),
  revokeSession: vi.fn(),
  revokeOAuthClient: vi.fn(),
  setCalendarSelected: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  syncConnector: vi.fn(),
  syncXBookmarks: vi.fn(),
  selectXBookmarkFolder: vi.fn(),
  syncFinanceAccount: vi.fn(),
  updateCalendar: vi.fn(),
  updateMailThread: vi.fn(),
  updateEvent: vi.fn(),
  updateEventBlock: vi.fn(),
  updateAutomation: vi.fn(),
  updateAccountSetup: vi.fn(),
  updateReminder: vi.fn(),
  updateTask: vi.fn(),
  upsertDomainProfile: vi.fn(),
  updateUser: vi.fn(),
  validateInvitation: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setAlwaysOnTop: mocks.setAlwaysOnTop }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: mocks.isTauri,
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mocks.openUrl,
}));

vi.mock("react-plaid-link", () => ({
  usePlaidLink: ({ onSuccess }: { onSuccess: (publicToken: string | null) => void }) => {
    mocks.plaidLink.onSuccess = onSuccess;
    return { open: mocks.plaidLink.open, ready: mocks.plaidLink.ready };
  },
}));

vi.mock("./api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Fallback error"),
  isUnauthorized: (error: unknown) => error instanceof Error && error.message === "unauthorized",
}));

function setup(path = "/today") {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

async function findSettingsLink(name: string) {
  return within(await screen.findByRole("complementary", { name: "Settings Sidebar" })).findByRole(
    "link",
    { name },
  );
}

function defaults() {
  mocks.plaidLink.onSuccess = null;
  mocks.plaidLink.ready = false;
  mocks.getMe.mockResolvedValue(user);
  mocks.listCalendars.mockResolvedValue([calendar, googleCalendar, nullColorCalendar]);
  mocks.listEvents.mockResolvedValue([event, allDayEvent]);
  mocks.listReminders.mockResolvedValue({
    items: [reminder, completedReminder, overdueReminder],
    nextCursor: null,
  });
  mocks.listTasks.mockResolvedValue({ items: [task], nextCursor: null });
  mocks.getDailyBrief.mockResolvedValue({
    allDay: [allDayEvent],
    anytime: [
      {
        ...reminder,
        dueAt: null,
        id: "88888888-8888-4888-8888-888888888888",
        title: "Anytime reminder",
      },
    ],
    capacity,
    generatedAt: now,
    laterToday: [
      { ...event, id: "99999999-9999-4999-8999-999999999999", title: "Later focus" },
      event,
    ],
    next: event,
    now: [
      {
        ...event,
        endsAt: "2026-07-13T13:00:00.000Z",
        id: "77777777-7777-4777-8777-777777777777",
        startsAt: "2026-07-13T11:00:00.000Z",
        title: "Live focus",
      },
    ],
    overdue: [overdueReminder],
    timeZone: "UTC",
    tasks: [task],
    completedTasks: [],
    today: [reminder, completedReminder],
    tomorrow: [],
  });
  mocks.getWeather.mockResolvedValue({
    alerts: [],
    condition: "Clear",
    location: {
      city: "New York",
      coordinates: { latitude: 40.7, longitude: -74 },
      country: "United States",
      label: "New York, New York, United States",
      mapUrl: "https://www.openstreetmap.org/?mlat=40.7&mlon=-74#map=12/40.7/-74",
      region: "New York",
      shortLabel: "NYC",
      source: "device",
    },
    observedAt: now,
    temperatureF: 72,
    usAqi: 42,
  });
  mocks.searchWeatherLocations.mockResolvedValue([
    {
      coordinates: { latitude: 40.7128, longitude: -74.006 },
      label: "New York, New York, United States",
      timezone: "America/New_York",
    },
  ]);
  mocks.listAutomations.mockResolvedValue([]);
  mocks.listGoals.mockResolvedValue([]);
  mocks.listMotives.mockResolvedValue([]);
  mocks.getFinanceOverview.mockResolvedValue({
    accounts: [],
    budgets: [],
    pendingSpendThisMonth: 0,
    refundCreditsThisMonth: 0,
    reviewCount: 0,
    spendingThisMonth: 0,
    transactions: [],
  });
  mocks.getFinanceOverviewForMonth.mockResolvedValue({
    accounts: [],
    budgets: [],
    pendingSpendThisMonth: 0,
    refundCreditsThisMonth: 0,
    reviewCount: 0,
    spendingThisMonth: 0,
    transactions: [],
  });
  mocks.getFinanceWealthSummary.mockResolvedValue({
    annualIncome: 0,
    cash: 0,
    debt: 0,
    incomeBasis: "none",
    investments: 0,
    monthlyIncome: 0,
    monthlyPlanRemaining: null,
    netWorth: 0,
    observedAnnualIncome: 0,
    otherAssets: 0,
    plannedThisMonth: 0,
    statedAnnualIncome: null,
  });
  mocks.getFinanceBudgetPace.mockResolvedValue({
    asOf: "2026-07-13",
    cells: [
      {
        date: "2026-07-13",
        planned: 50,
        spent: 42.5,
        status: "ahead",
      },
    ],
    period: "week",
  });
  mocks.getFinanceLedgerHealth.mockResolvedValue({
    asOf: now,
    balanceOnlyAccounts: 0,
    candidateTransfers: 0,
    missingProvenance: 0,
    pendingTransactions: 0,
    possibleDuplicates: 0,
    staleAccounts: 0,
    unresolvedReviews: 0,
  });
  mocks.getFinanceGuidedSetup.mockResolvedValue({
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
      draftNotice: null,
      draftProposal: null,
    },
    humanOnlyActions: [
      "connect_or_disconnect_source",
      "import_transactions",
      "manage_accounts",
      "manage_budgets",
      "manage_financial_profile",
      "refresh_provider_data",
      "confirm_ambiguous_transfer",
      "create_merchant_rule",
      "apply_categorization",
      "review_recurring_obligation",
      "resolve_alert",
      "manage_merchants",
      "add_manual_transaction",
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
    suggestedWorkflows: [
      {
        available: true,
        key: "capture_preferences",
        policy: "preview",
        summary: "Capture durable preferences.",
        unavailableReason: null,
      },
    ],
  });
  mocks.getDomainProfile.mockResolvedValue(null);
  mocks.getFinanceProfile.mockResolvedValue(null);
  mocks.listFinanceIncomeStreams.mockResolvedValue([]);
  mocks.listFinanceRecurringObligations.mockResolvedValue([]);
  mocks.listFinanceAlerts.mockResolvedValue([]);
  mocks.getFinanceForecast.mockResolvedValue({
    asOf: now,
    lowestProjectedBalance: 0,
    lowestProjectedDate: null,
    projectedBalanceAtNextPayday: null,
    safeToSpend: 0,
    upcomingIncome: 0,
    upcomingObligations: 0,
  });
  mocks.exportFinanceData.mockResolvedValue({
    accounts: [],
    asOf: now,
    budgets: [],
    categories: [],
    transactions: [],
  });
  mocks.getFinanceCategories.mockResolvedValue([]);
  mocks.getFinanceReviewQueue.mockResolvedValue([]);
  mocks.listFinanceTransactions.mockResolvedValue({ items: [], nextCursor: null });
  mocks.getPlaidStatus.mockResolvedValue({ available: false });
  mocks.listAutomationRuns.mockResolvedValue([]);
  mocks.listActivity.mockResolvedValue([
    {
      id: "1",
      action: "reminder.created",
      actorId: id,
      actorType: "agent",
      before: null,
      after: {},
      createdAt: new Date(Date.now() - 30_000).toISOString(),
      entityId: id,
      entityType: "reminder",
      requestId: "r",
    },
    {
      id: "2",
      action: "calendar_event.updated",
      actorId: id,
      actorType: "connector",
      before: {},
      after: {},
      createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      entityId: id,
      entityType: "event",
      requestId: "r",
    },
    {
      id: "3",
      action: "calendar.created",
      actorId: id,
      actorType: "system",
      before: null,
      after: {},
      createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      entityId: id,
      entityType: "calendar",
      requestId: "r",
    },
    {
      id: "4",
      action: "reminder.completed",
      actorId: id,
      actorType: "user",
      before: {},
      after: {},
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      entityId: id,
      entityType: "reminder",
      requestId: "r",
    },
  ]);
  mocks.listConnectors.mockResolvedValue([
    {
      id: secondId,
      calendarEnabled: true,
      provider: "google",
      label: "Google",
      email: "test@example.com",
      syncStatus: "idle",
      syncError: null,
      lastSyncedAt: now,
      mailEnabled: true,
    },
    {
      id: thirdId,
      calendarEnabled: true,
      provider: "google",
      label: "Broken Google",
      email: null,
      syncStatus: "error",
      syncError: "Authorization expired",
      lastSyncedAt: null,
      mailEnabled: false,
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      calendarEnabled: true,
      provider: "google",
      label: "Ready Google",
      email: "ready@example.com",
      syncStatus: "idle",
      syncError: null,
      lastSyncedAt: null,
      mailEnabled: false,
    },
  ]);
  mocks.getXBookmarkAccount.mockResolvedValue(null);
  mocks.getAgentConnectionGuide.mockResolvedValue({
    domains: [
      {
        domain: "mail",
        readScope: "mail:read",
        support: "executable_rules",
        writeScope: "mail:write",
      },
      {
        domain: "calendar",
        readScope: "calendar:read",
        support: "profile_and_attention",
        writeScope: "calendar:write",
      },
    ],
    mcpUrl: "https://mcp.example.com/mcp",
    skill: {
      displayName: "Ilo Guided Setup",
      installPrompt: "Install Ilo Guided Setup from https://example.com/ilo-setup.",
      invocation: "$ilo-setup",
      name: "ilo-setup",
      revision: "release-0.1.0",
      setupPrompt: "Use $ilo-setup to set up Ilo.",
      sourceUrl: "https://example.com/ilo-setup",
      version: "0.1.0",
    },
  });
  mocks.getAssistantSetupStatus.mockResolvedValue({
    domains: [
      {
        approvedProfileStatus: null,
        approvedProfileVersion: null,
        canRead: true,
        canWrite: true,
        domain: "mail",
        pendingDraftVersion: null,
        profileStatus: null,
        profileVersion: null,
      },
    ],
  });
  mocks.listXBookmarkFolders.mockResolvedValue([]);
  mocks.listMailboxes.mockResolvedValue([mailbox]);
  mocks.getMailSetupContext.mockResolvedValue({
    accounts: [
      {
        accountId: secondId,
        automation: {
          failedCount: 0,
          inProgressCount: 0,
          lastCompletedAt: null,
          pendingCount: 0,
          reconciliationCount: 0,
        },
        automaticRuleExecution: true,
        email: "test@example.com",
        label: "Google",
        lastSyncedAt: now,
        mailboxes: [mailbox],
        provider: "google",
        syncError: null,
        syncStatus: "idle",
      },
    ],
    automation: {
      executionLimitPerRun: 6,
      failedCount: 0,
      inProgressCount: 0,
      lastCompletedAt: null,
      oldestDueAt: null,
      pendingCount: 0,
      reconciliationCount: 0,
    },
    safety: {
      delayedRetentionAutomation: true,
      permanentDeletion: false,
      providerFilterCreation: false,
      spamClassification: false,
      unsubscribeAutomation: false,
    },
  });
  mocks.listMailDrafts.mockResolvedValue([]);
  mocks.listMailThreads.mockResolvedValue([mailThread, secondMailThread]);
  mocks.listMailMessages.mockResolvedValue([]);
  mocks.listMailRules.mockResolvedValue([]);
  mocks.getMailThread.mockResolvedValue(mailThread);
  mocks.sendMail.mockResolvedValue(undefined);
  mocks.createMailDraft.mockResolvedValue({ id });
  mocks.reconcileMailDraft.mockResolvedValue({ id, sendStatus: "draft" });
  mocks.snoozeMailThread.mockResolvedValue(undefined);
  mocks.updateMailThread.mockResolvedValue(mailThread);
  mocks.listAccessTokens.mockResolvedValue([
    {
      id,
      name: "Active agent",
      scopes: ["audit:read"],
      createdAt: now,
      expiresAt: null,
      lastUsedAt: now,
      revokedAt: null,
    },
    {
      id: secondId,
      name: "Old agent",
      scopes: ["audit:read"],
      createdAt: now,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: now,
    },
  ]);
  mocks.listInvitations.mockResolvedValue([]);
  mocks.listOAuthClients.mockResolvedValue([]);
  mocks.listSessions.mockResolvedValue([
    {
      id,
      createdAt: now,
      expiresAt: now,
      lastSeenAt: now,
      ipAddress: "127.0.0.1",
      userAgent: "Test Browser 1.0 Extra Words",
    },
    {
      id: secondId,
      createdAt: now,
      expiresAt: now,
      lastSeenAt: now,
      ipAddress: null,
      userAgent: null,
    },
  ]);
  mocks.createReminder.mockResolvedValue(reminder);
  mocks.createTask.mockResolvedValue(task);
  mocks.createAutomation.mockResolvedValue({
    id,
    template: "morning_brief",
    title: "Morning brief",
    schedule: "Weekdays at 8:00 AM",
    timezone: "UTC",
    enabled: true,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  });
  mocks.updateReminder.mockResolvedValue(reminder);
  mocks.updateTask.mockResolvedValue(task);
  mocks.completeReminder.mockResolvedValue(reminder);
  mocks.completeTask.mockResolvedValue(task);
  mocks.deleteReminder.mockResolvedValue(undefined);
  mocks.deleteTask.mockResolvedValue(undefined);
  mocks.createEvent.mockResolvedValue(event);
  mocks.createEventBlock.mockResolvedValue(event);
  mocks.updateEvent.mockResolvedValue(event);
  mocks.updateEventBlock.mockResolvedValue(event);
  mocks.updateAutomation.mockResolvedValue({
    createdAt: now,
    enabled: false,
    id,
    lastRunAt: null,
    schedule: "Weekdays at 9:00 AM",
    template: "morning_brief",
    timezone: "UTC",
    title: "Morning Brief",
    updatedAt: now,
  });
  mocks.deleteEvent.mockResolvedValue(undefined);
  mocks.deleteEventBlock.mockResolvedValue(event);
  mocks.createCalendar.mockResolvedValue(calendar);
  mocks.deleteCalendar.mockResolvedValue(undefined);
  mocks.setCalendarSelected.mockResolvedValue(calendar);
  mocks.getGoogleAuthorizationUrl.mockResolvedValue("/settings?google=started");
  mocks.getXBookmarkAuthorizationUrl.mockResolvedValue("https://x.com/i/oauth2/authorize");
  mocks.getPinterestWallpaperSettings.mockResolvedValue({
    backgroundColor: "#ffffff",
    backgroundMode: "white",
    boardUrl: "https://www.pinterest.com/example/mindset/",
    cornerRadius: 0,
    enabled: false,
    frameSpacing: 16,
    lastAppliedAt: null,
    layout: "grid",
    mosaicFit: "preserve",
    paddingBottom: 16,
    paddingEnd: 16,
    paddingLinked: true,
    paddingStart: 16,
    paddingTop: 16,
    rotationDegrees: 0,
    tileSize: 64,
  });
  mocks.listPinterestPins.mockResolvedValue([]);
  mocks.updatePinterestWallpaperSettings.mockResolvedValue({
    backgroundColor: "#ffffff",
    backgroundMode: "white",
    boardUrl: "https://www.pinterest.com/example/mindset/",
    cornerRadius: 0,
    enabled: false,
    frameSpacing: 16,
    lastAppliedAt: null,
    layout: "grid",
    mosaicFit: "preserve",
    paddingBottom: 16,
    paddingEnd: 16,
    paddingLinked: true,
    paddingStart: 16,
    paddingTop: 16,
    rotationDegrees: 0,
    tileSize: 64,
  });
  mocks.isTauri.mockReturnValue(false);
  mocks.invoke.mockImplementation((command: string) =>
    command === "desktop_preview_environment"
      ? {
          hasNotch: false,
          platform: "macos",
          safeArea: { bottom: 0, end: 0, start: 0, top: 24 },
          screen: { height: 900, width: 1440 },
        }
      : undefined,
  );
  mocks.openUrl.mockResolvedValue(undefined);
  mocks.setAlwaysOnTop.mockResolvedValue(undefined);
  mocks.syncConnector.mockResolvedValue(1);
  mocks.selectXBookmarkFolder.mockResolvedValue(1);
  mocks.syncXBookmarks.mockResolvedValue(2);
  mocks.deleteXBookmarkAccount.mockResolvedValue(undefined);
  mocks.deleteConnector.mockResolvedValue(undefined);
  mocks.connectICloud.mockResolvedValue({ accountId: secondId, email: "test@icloud.com" });
  mocks.createAccessToken.mockResolvedValue({
    id,
    token: "pos_secret",
    name: "My agent",
    scopes: ["audit:read"],
    createdAt: now,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
  });
  mocks.deleteAccessToken.mockResolvedValue(undefined);
  mocks.createInvitation.mockResolvedValue({
    code: "invite-code",
    createdAt: now,
    createdBy: id,
    email: "friend@example.com",
    expiresAt: "2026-07-27T12:00:00.000Z",
    id,
    redeemedAt: null,
    redeemedBy: null,
  });
  mocks.confirmEmailVerification.mockResolvedValue(user);
  mocks.validateInvitation.mockResolvedValue(true);
  mocks.requestPasswordReset.mockResolvedValue(undefined);
  mocks.resendEmailVerification.mockResolvedValue(undefined);
  mocks.resetPassword.mockResolvedValue(undefined);
  mocks.recordPinterestWallpaperApplied.mockResolvedValue(undefined);
  mocks.revokeOAuthClient.mockResolvedValue(undefined);
  mocks.revokeSession.mockResolvedValue(undefined);
  mocks.updateUser.mockResolvedValue(user);
  mocks.updateAccountSetup.mockImplementation(
    async (input: {
      action: "complete" | "dismiss" | "progress";
      currentStep?: string;
      selectedWorkspaces?: string[];
    }) => ({
      ...user,
      setup: {
        ...user.setup,
        ...(input.action === "progress"
          ? {
              currentStep: input.currentStep,
              selectedWorkspaces: input.selectedWorkspaces ?? user.setup.selectedWorkspaces,
              status: "in_progress",
            }
          : input.action === "dismiss"
            ? { status: "dismissed" }
            : { currentStep: "ready", status: "complete" }),
      },
    }),
  );
  mocks.runAutomation.mockResolvedValue({
    id: secondId,
    routineId: id,
    status: "completed",
    summary: "Done",
    brief: null,
    startedAt: now,
    completedAt: now,
  });
  mocks.logout.mockResolvedValue(undefined);
}

function dragDataTransfer(persist = true): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => {
      if (persist) values.set(type, value);
    },
  } as DataTransfer;
}

function configureFinanceWorkspace() {
  const transactions = [
    {
      accountId: id,
      amount: 15,
      category: null,
      categoryConfidence: null,
      createdAt: now,
      date: "2026-07-13",
      direction: "expense" as const,
      id,
      merchant: "Unfamiliar charge",
      needsReview: true,
      notes: null,
      updatedAt: now,
    },
    {
      accountId: id,
      amount: 27.5,
      category: "Dining",
      categoryConfidence: 0.95,
      createdAt: now,
      date: "2026-07-13",
      direction: "expense" as const,
      id: secondId,
      merchant: "Cafe",
      merchantId: secondId,
      needsReview: false,
      notes: null,
      updatedAt: now,
    },
    {
      accountId: id,
      amount: 100,
      category: "TRANSFER_OUT",
      categoryConfidence: 0.95,
      createdAt: now,
      date: "2026-07-12",
      direction: "income" as const,
      id: thirdId,
      merchant: "Savings transfer",
      merchantId: thirdId,
      needsReview: false,
      notes: null,
      updatedAt: now,
    },
  ];
  mocks.getFinanceOverview.mockResolvedValue({
    accounts: [
      {
        balance: 250,
        createdAt: now,
        id,
        institution: "Local Credit Union",
        lastSyncedAt: now,
        name: "Checking",
        provider: "plaid",
        status: "connected",
        updatedAt: now,
      },
      {
        balance: null,
        createdAt: now,
        id: secondId,
        institution: "Cash",
        lastSyncedAt: null,
        name: "Wallet",
        provider: "paypal",
        status: "needs_reauth",
        updatedAt: now,
      },
    ],
    budgets: [
      { category: "Dining", createdAt: now, id, limit: 100, month: "2026-07", updatedAt: now },
    ],
    reviewCount: 1,
    spendingThisMonth: 42.5,
    transactions,
  });
  mocks.getFinanceOverviewForMonth.mockImplementation(() => mocks.getFinanceOverview());
  mocks.getPlaidStatus.mockResolvedValue({ available: true });
  mocks.getPlaidLinkToken.mockResolvedValue("link-token");
  mocks.importFinanceCsv.mockResolvedValue({ imported: 1, skipped: 0 });
  mocks.syncFinanceAccount.mockResolvedValue(1);
  mocks.plaidLink.ready = true;
  mocks.listFinanceTransactions.mockImplementation(
    async (query?: { cursor?: string; sortBy?: string }) => {
      if (query?.cursor) return { items: [transactions[0]], nextCursor: null };
      return {
        items:
          query?.sortBy === "amount"
            ? [...transactions].sort((left, right) => right.amount - left.amount)
            : transactions,
        nextCursor: "finance-page-2",
      };
    },
  );
}

function dropCalendarEvent(target: HTMLElement, dataTransfer: DataTransfer, clientY?: number) {
  const dropEvent = createEvent.drop(target, { dataTransfer });
  if (clientY !== undefined) Object.defineProperty(dropEvent, "clientY", { value: clientY });
  fireEvent(target, dropEvent);
}

function dragOverCalendarEvent(target: HTMLElement, dataTransfer: DataTransfer, clientY: number) {
  const dragEvent = createEvent.dragOver(target, { dataTransfer });
  Object.defineProperty(dragEvent, "clientY", { value: clientY });
  fireEvent(target, dragEvent);
}

function dragLeaveCalendarEvent(target: HTMLElement, relatedTarget: EventTarget | null) {
  const dragEvent = createEvent.dragLeave(target);
  Object.defineProperty(dragEvent, "relatedTarget", { value: relatedTarget });
  fireEvent(target, dragEvent);
}

beforeEach(() => {
  // Test-specific `mockResolvedValueOnce` and pending promises must not leak into
  // the next rendered route. `clearAllMocks` only clears call history; it keeps
  // queued one-off implementations, which made later calendar tests render an
  // unrelated prior state instead of their documented defaults.
  vi.resetAllMocks();
  const NativeDate = Date;
  class TestDate extends NativeDate {
    constructor(value?: string | number | Date) {
      super(value ?? now);
    }

    static override now() {
      return new NativeDate(now).getTime();
    }
  }
  vi.stubGlobal("Date", TestDate);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn().mockReturnValue(true),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
  defaults();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ilo web app", () => {
  it("uses the destination calendar state when warming its workspace preview", () => {
    expect(getWorkspaceCalendarEntry(user, "?view=day&date=2026-07-13&weekends=0")).toEqual({
      range: {
        from: "2026-07-13T00:00:00.000Z",
        to: "2026-07-14T00:00:00.000Z",
      },
      view: "day",
    });
    expect(getWorkspaceCalendarEntry(user, "?view=month&date=not-a-date").view).toBe("month");
    expect(workspaceTodaySummary(undefined, "Brooklyn")).toBe("Weather · Brooklyn");
    expect(workspaceCalendarSummary([], user)).toBe("No events today");
  });

  it("accepts only complete router navigators for inert workspace previews", () => {
    const navigator = {
      createHref: vi.fn(),
      go: vi.fn(),
      push: vi.fn(),
      replace: vi.fn(),
    };
    expect(isNavigator(navigator)).toBe(true);
    expect(isNavigator(null)).toBe(false);
    expect(isNavigator("navigator")).toBe(false);
    expect(isNavigator({ ...navigator, replace: undefined })).toBe(false);
  });

  it("lays out transitive overlaps in stable columns and preserves repeated DST hours", () => {
    const timelineEvent = { ...event, conferenceUrl: null };
    const overlappingEvents = [
      {
        ...timelineEvent,
        endsAt: "2026-07-13T11:00:00.000Z",
        startsAt: "2026-07-13T09:00:00.000Z",
      },
      {
        ...timelineEvent,
        endsAt: "2026-07-13T12:00:00.000Z",
        id: secondId,
        startsAt: "2026-07-13T10:00:00.000Z",
      },
      {
        ...timelineEvent,
        endsAt: "2026-07-13T13:00:00.000Z",
        id: thirdId,
        startsAt: "2026-07-13T11:00:00.000Z",
      },
    ];
    const layouts = positionTimelineEvents(
      overlappingEvents,
      { day: 13, month: 7, year: 2026 },
      "UTC",
    );
    expect(layouts.map(({ column, columns }) => ({ column, columns }))).toEqual([
      { column: 0, columns: 2 },
      { column: 1, columns: 2 },
      { column: 0, columns: 2 },
    ]);

    const [fallbackHour] = positionTimelineEvents(
      [
        {
          ...timelineEvent,
          endsAt: "2026-11-01T06:30:00.000Z",
          startsAt: "2026-11-01T05:30:00.000Z",
        },
      ],
      { day: 1, month: 11, year: 2026 },
      "America/New_York",
    );
    if (!fallbackHour) throw new Error("Expected the fallback-hour event to be positioned.");
    expect(fallbackHour.endMinute - fallbackHour.startMinute).toBe(60);
    expect(
      formatTimelineTimeRange(
        {
          ...timelineEvent,
          endsAt: "2026-11-01T06:30:00.000Z",
          startsAt: "2026-11-01T05:30:00.000Z",
        },
        "America/New_York",
      ),
    ).toBe("1:30 AM EDT–1:30 AM EST");
  });

  it("uses device location for header weather controls and shows their popover details", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({ coords: { latitude: 40.7, longitude: -74 } } as GeolocationPosition),
    );
    const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    try {
      mocks.getWeather.mockResolvedValueOnce({
        alerts: [
          { kind: "rain", label: "Rain now" },
          { kind: "air_quality", label: "Air quality: sensitive groups" },
        ],
        condition: "Rain",
        location: {
          city: "New York",
          coordinates: { latitude: 40.7, longitude: -74 },
          country: "United States",
          label: "New York, New York, United States",
          mapUrl: "https://www.openstreetmap.org/?mlat=40.7&mlon=-74#map=12/40.7/-74",
          region: "New York",
          shortLabel: "NYC",
          source: "device",
        },
        observedAt: now,
        temperatureF: 72,
        usAqi: 125,
      });

      const view = setup();
      const browser = userEvent.setup();
      const weatherControl = await screen.findByRole("button", { name: "Rain, 72°F" });
      await browser.click(weatherControl);
      expect(screen.getByText("Updated")).toBeInTheDocument();
      expect(screen.getAllByText("12:00 PM")).not.toHaveLength(0);
      expect(screen.getByText("AQI 125")).toBeInTheDocument();
      await browser.click(screen.getByRole("button", { name: "Weather location: NYC" }));
      expect(screen.getByTitle("Map of New York, New York, United States")).toBeInTheDocument();
      expect(screen.getAllByText("Using this device")).not.toHaveLength(0);
      expect(screen.getByText("40.7000, -74.0000")).toBeInTheDocument();
      expect(
        screen.getByRole("link", {
          name: "Open New York, New York, United States in OpenStreetMap",
        }),
      ).toHaveAttribute(
        "href",
        "https://www.openstreetmap.org/?mlat=40.7&mlon=-74#map=12/40.7/-74",
      );
      expect(getCurrentPosition).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function),
        expect.objectContaining({ maximumAge: 5 * 60_000 }),
      );
      expect(mocks.getWeather).toHaveBeenCalledWith({ latitude: 40.7, longitude: -74 });
      view.unmount();
    } finally {
      if (originalGeolocation) Object.defineProperty(navigator, "geolocation", originalGeolocation);
      else Reflect.deleteProperty(navigator, "geolocation");
    }
  });

  it("does not request device location outside the Today workspace", () => {
    const getCurrentPosition = vi.fn();
    const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    try {
      const view = setup("/mail");
      expect(getCurrentPosition).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      if (originalGeolocation) Object.defineProperty(navigator, "geolocation", originalGeolocation);
      else Reflect.deleteProperty(navigator, "geolocation");
    }
  });

  it("keeps Today usable when device location is denied", async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, failure: PositionErrorCallback) =>
      failure({} as GeolocationPositionError),
    );
    const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    try {
      const view = setup("/today");
      await screen.findByRole("heading", { name: "Your commitments" });
      expect(getCurrentPosition).toHaveBeenCalled();
      view.unmount();
    } finally {
      if (originalGeolocation) Object.defineProperty(navigator, "geolocation", originalGeolocation);
      else Reflect.deleteProperty(navigator, "geolocation");
    }
  });

  it("supports failed login, registration, and authentication errors", async () => {
    mocks.getMe.mockRejectedValueOnce(new Error("unauthorized"));
    mocks.login.mockRejectedValueOnce(new Error("Wrong password"));
    mocks.register.mockResolvedValue(user);
    setup();
    const browser = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    await browser.type(screen.getByLabelText("Email"), "test@example.com");
    await browser.type(screen.getByLabelText("Password"), "wrong-password");
    await browser.click(screen.getByRole("button", { name: "Open ilo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong password");
    await browser.click(screen.getByRole("button", { name: "I have an invite code" }));
    await browser.click(screen.getByRole("button", { name: "Already have an account? Sign in" }));
    await browser.click(screen.getByRole("button", { name: "I have an invite code" }));
    const inviteCode = screen.getByLabelText("Invite code");
    const displayName = screen.getByLabelText("Name");
    expect(inviteCode).toBeRequired();
    expect(inviteCode.compareDocumentPosition(displayName) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await browser.type(inviteCode, "ABCD2345");
    expect(mocks.validateInvitation).not.toHaveBeenCalled();
    await browser.type(displayName, "Test User");
    expect(await screen.findByText("Invitation accepted.")).toBeInTheDocument();
    await browser.clear(screen.getByLabelText("Password"));
    await browser.type(screen.getByLabelText("Password"), "LocalTestOnly123!");
    await browser.type(screen.getByLabelText("Confirm password"), "LocalTestOnly123!");
    await browser.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Your commitments" })).toBeInTheDocument();
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Test User",
        email: "test@example.com",
        inviteCode: "ABCD2345",
      }),
    );
  }, 15_000);

  it("opens setup immediately for a new account and lets the user exit into Today", async () => {
    const newUser = {
      ...user,
      emailVerified: false,
      setup: {
        completedAt: null,
        currentStep: "welcome" as const,
        dismissedAt: null,
        selectedWorkspaces: ["calendar", "tasks", "mail", "finances"] as const,
        startedAt: null,
        status: "not_started" as const,
      },
    };
    mocks.getMe.mockRejectedValueOnce(new Error("unauthorized"));
    mocks.register.mockResolvedValue(newUser);
    mocks.updateAccountSetup.mockResolvedValue({
      ...newUser,
      setup: { ...newUser.setup, dismissedAt: now, status: "dismissed" },
    });
    setup();
    const browser = userEvent.setup();
    await browser.click(await screen.findByRole("button", { name: "I have an invite code" }));
    await browser.type(screen.getByLabelText("Invite code"), "ABCD2345");
    await browser.type(screen.getByLabelText("Name"), "Test User");
    expect(await screen.findByText("Invitation accepted.")).toBeInTheDocument();
    await browser.type(screen.getByLabelText("Email"), "new@example.com");
    await browser.type(screen.getByLabelText("Password"), "LocalTestOnly123!");
    await browser.type(screen.getByLabelText("Confirm password"), "LocalTestOnly123!");
    await browser.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Hi, Test." })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Exit setup" }));
    await waitFor(() =>
      expect(mocks.updateAccountSetup).toHaveBeenCalledWith(
        { action: "dismiss" },
        expect.anything(),
      ),
    );
  });

  it("rejects an invalid invitation on blur before account creation can proceed", async () => {
    mocks.getMe.mockRejectedValueOnce(new Error("unauthorized"));
    mocks.validateInvitation.mockResolvedValueOnce(false);
    setup();
    const browser = userEvent.setup();

    await browser.click(await screen.findByRole("button", { name: "I have an invite code" }));
    const inviteCode = screen.getByLabelText("Invite code");
    await browser.type(inviteCode, "BAD12345");
    expect(mocks.validateInvitation).not.toHaveBeenCalled();
    await browser.click(screen.getByLabelText("Name"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This invitation is invalid or expired.",
    );
    expect(mocks.validateInvitation).toHaveBeenCalledWith({ inviteCode: "BAD12345" });
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("resumes saved setup progress and can finish a local-only workspace quickly", async () => {
    const setupUser: User = {
      ...user,
      setup: {
        completedAt: null,
        currentStep: "workspaces" as const,
        dismissedAt: null,
        selectedWorkspaces: ["tasks"] as const,
        startedAt: now,
        status: "in_progress" as const,
      },
    };
    mocks.getMe.mockResolvedValue(setupUser);
    mocks.updateAccountSetup
      .mockResolvedValueOnce({
        ...setupUser,
        setup: { ...setupUser.setup, currentStep: "ready", status: "in_progress" },
      })
      .mockResolvedValueOnce({
        ...setupUser,
        setup: {
          ...setupUser.setup,
          completedAt: now,
          currentStep: "ready",
          status: "complete",
        },
      });
    setup("/today");
    const browser = userEvent.setup();
    expect(
      await screen.findByRole("heading", { name: "What should ilo help with?" }),
    ).toHaveFocus();
    expect(screen.getByLabelText("Tasks")).toBeChecked();
    expect(screen.getByLabelText("Calendar")).not.toBeChecked();
    await browser.tab();
    expect(screen.getByLabelText("Calendar")).toHaveFocus();
    await browser.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your workspace is ready." })).toHaveFocus();
    await browser.click(screen.getByRole("button", { name: "Open Today" }));
    await waitFor(() => {
      expect(mocks.updateAccountSetup).toHaveBeenNthCalledWith(
        1,
        {
          action: "progress",
          currentStep: "ready",
          selectedWorkspaces: ["tasks"],
        },
        expect.anything(),
      );
      expect(mocks.updateAccountSetup).toHaveBeenNthCalledWith(
        2,
        { action: "complete" },
        expect.anything(),
      );
    });
  });

  it("completes setup before handing a ready account to agent access", async () => {
    const setupUser: User = {
      ...user,
      setup: {
        completedAt: null,
        currentStep: "ready" as const,
        dismissedAt: null,
        selectedWorkspaces: ["mail"] as const,
        startedAt: now,
        status: "in_progress" as const,
      },
    };
    mocks.getMe.mockResolvedValue(setupUser);
    mocks.updateAccountSetup.mockResolvedValue({
      ...setupUser,
      setup: { ...setupUser.setup, completedAt: now, status: "complete" },
    });
    setup("/setup");
    const browser = userEvent.setup();

    expect(
      await screen.findByRole("heading", { name: "Your workspace is ready." }),
    ).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Connect an agent" }));

    expect(
      await screen.findByRole("heading", { name: "Connect an agent" }, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(mocks.updateAccountSetup).toHaveBeenCalledWith(
      { action: "complete" },
      expect.anything(),
    );
  });

  it("uses the real provider flows while progressing through full setup", async () => {
    const setupUser: User = {
      ...user,
      setup: {
        completedAt: null,
        currentStep: "google" as const,
        dismissedAt: null,
        selectedWorkspaces: ["calendar", "tasks", "mail", "finances"],
        startedAt: now,
        status: "in_progress" as const,
      },
    };
    let setupState = setupUser.setup;
    configureFinanceWorkspace();
    mocks.getMe.mockResolvedValue(setupUser);
    mocks.isTauri.mockReturnValue(true);
    mocks.listConnectors.mockReset().mockResolvedValue([
      {
        calendarEnabled: true,
        email: "test@example.com",
        id: secondId,
        label: "Google",
        lastSyncedAt: now,
        mailEnabled: true,
        provider: "google",
        syncError: null,
        syncStatus: "idle",
      },
    ]);
    mocks.updateAccountSetup.mockImplementation(async (input: UpdateAccountSetupInput) => {
      setupState =
        input.action === "progress"
          ? {
              ...setupState,
              currentStep: input.currentStep ?? setupState.currentStep,
              selectedWorkspaces: input.selectedWorkspaces ?? setupState.selectedWorkspaces,
              status: "in_progress",
            }
          : input.action === "complete"
            ? { ...setupState, completedAt: now, currentStep: "ready", status: "complete" }
            : { ...setupState, dismissedAt: now, status: "dismissed" };
      return { ...setupUser, setup: setupState };
    });

    setup("/setup");
    const browser = userEvent.setup();
    expect(
      await screen.findByRole("heading", { name: "Connect your Google accounts" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("test@example.com")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("heading", { name: "What should ilo help with?" }),
    ).toBeInTheDocument();
    await browser.click(screen.getByLabelText("Calendar"));
    expect(screen.getByLabelText("Calendar")).not.toBeChecked();
    await browser.click(screen.getByLabelText("Calendar"));
    expect(screen.getByLabelText("Calendar")).toBeChecked();
    await browser.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Hi, Test." })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Set up ilo" }));
    await browser.click(await screen.findByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("heading", { name: "Connect your Google accounts" }),
    ).toBeInTheDocument();
    await browser.click(screen.getByLabelText("Mail"));
    await browser.click(screen.getByLabelText("Mail"));
    await browser.click(await screen.findByRole("button", { name: "Add Google account" }));
    await waitFor(() =>
      expect(mocks.getGoogleAuthorizationUrl).toHaveBeenCalledWith({
        returnTo: "/setup",
        services: ["calendar", "mail"],
      }),
    );
    expect(mocks.openUrl).toHaveBeenCalledWith("/settings?google=started");

    await browser.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("heading", { name: "Connect your Apple accounts" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Apple Account email")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText("Apple Account email")).toHaveValue("");
    expect(screen.getByLabelText("App-specific password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("App-specific password")).toHaveValue("");
    await browser.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("heading", { name: "Connect your Google accounts" }),
    ).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("heading", { name: "Connect your Apple accounts" }),
    ).toBeInTheDocument();
    await browser.type(screen.getByLabelText("Apple Account email"), "person@icloud.com");
    await browser.type(screen.getByLabelText("App-specific password"), fakeAppleAppPassword);
    await browser.click(screen.getByRole("button", { name: "Connect Apple" }));
    await waitFor(() =>
      expect(mocks.connectICloud).toHaveBeenCalledWith({
        appSpecificPassword: fakeAppleAppPassword,
        calendar: true,
        email: "person@icloud.com",
        mail: true,
      }),
    );
    await browser.click(await screen.findByRole("button", { name: "Add another Apple account" }));
    await browser.click(screen.getByRole("button", { name: "Skip Apple" }));

    expect(
      await screen.findByRole("heading", { name: "Connect the accounts you track" }),
    ).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("heading", { name: "Connect your Apple accounts" }),
    ).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Skip Apple" }));
    expect(
      await screen.findByRole("heading", { name: "Connect the accounts you track" }),
    ).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Add institution" }));
    await waitFor(() => expect(mocks.getPlaidLinkToken).toHaveBeenCalled());
    await waitFor(() => expect(mocks.plaidLink.open).toHaveBeenCalled());
    mocks.plaidLink.onSuccess?.("setup-public-token");
    await waitFor(() =>
      expect(mocks.exchangePlaidToken).toHaveBeenCalledWith({
        institution: null,
        publicToken: "setup-public-token",
      }),
    );
    await browser.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "Your workspace is ready." }),
    ).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Review setup" }));
    expect(
      await screen.findByRole("heading", { name: "Connect the accounts you track" }),
    ).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Continue" }));
    await browser.click(screen.getByRole("button", { name: "Open Today" }));
    expect(
      await screen.findByRole("heading", { name: "Your commitments" }, { timeout: 5_000 }),
    ).toBeInTheDocument();
  }, 15_000);

  it("keeps setup verification and connection failures recoverable", async () => {
    const setupUser: User = {
      ...user,
      emailVerified: false,
      setup: {
        completedAt: null,
        currentStep: "google",
        dismissedAt: null,
        selectedWorkspaces: ["calendar", "mail"],
        startedAt: now,
        status: "in_progress",
      },
    };
    mocks.getMe.mockResolvedValue(setupUser);
    mocks.listConnectors.mockResolvedValue([]);
    const verification = setup("/setup");
    const browser = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Connect your Google accounts" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Calendar")).not.toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Send another email" }));
    await waitFor(() => expect(mocks.resendEmailVerification).toHaveBeenCalled());
    await browser.click(screen.getByRole("button", { name: "I’ve verified" }));
    expect(await screen.findByText("Still waiting for verification")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Connect your Google accounts" }),
    ).not.toBeInTheDocument();
    verification.unmount();

    const verifiedUser = { ...setupUser, emailVerified: true };
    mocks.getMe.mockReset().mockResolvedValueOnce(setupUser).mockResolvedValueOnce(verifiedUser);
    mocks.updateAccountSetup.mockResolvedValueOnce({
      ...verifiedUser,
      setup: { ...verifiedUser.setup, currentStep: "google" },
    });
    const verifiedGate = setup("/setup");
    await browser.click(
      await screen.findByRole("button", {
        name: "I’ve verified",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Connect your Google accounts" }),
    ).toBeInTheDocument();
    expect(mocks.updateAccountSetup).toHaveBeenCalledWith(
      {
        action: "progress",
        currentStep: "google",
        selectedWorkspaces: ["calendar", "mail"],
      },
      expect.anything(),
    );
    verifiedGate.unmount();

    mocks.getMe.mockResolvedValue({
      ...verifiedUser,
      setup: { ...verifiedUser.setup, currentStep: "verify_email" },
    });
    const verifiedResume = setup("/setup");
    expect(
      await screen.findByRole("heading", { name: "Connect your Google accounts" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Verify your email" })).not.toBeInTheDocument();
    verifiedResume.unmount();

    mocks.getMe.mockResolvedValue({ ...setupUser, emailVerified: true });
    mocks.getGoogleAuthorizationUrl.mockRejectedValueOnce(new Error("Google unavailable"));
    const google = setup("/setup");
    expect(
      await screen.findByRole("heading", { name: "Connect your Google accounts" }),
    ).toBeInTheDocument();
    await browser.click(screen.getByLabelText("Calendar"));
    await browser.click(screen.getByLabelText("Mail"));
    expect(screen.getByRole("button", { name: "Connect Google" })).toBeDisabled();
    await browser.click(screen.getByLabelText("Mail"));
    await browser.click(screen.getByRole("button", { name: "Connect Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Google unavailable");
    google.unmount();

    let resolveGoogle: ((value: string) => void) | undefined;
    mocks.getGoogleAuthorizationUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGoogle = resolve;
        }),
    );
    const googlePending = setup("/setup");
    await browser.click(await screen.findByLabelText("Calendar"));
    await browser.click(screen.getByRole("button", { name: "Connect Google" }));
    expect(screen.getByRole("button", { name: "Opening Google" })).toBeDisabled();
    resolveGoogle?.("/setup?google=started");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect Google" })).toBeEnabled(),
    );
    googlePending.unmount();

    const appleUser: User = {
      ...setupUser,
      setup: { ...setupUser.setup, currentStep: "icloud" },
    };
    mocks.getMe.mockResolvedValue(appleUser);
    const appleVerification = setup("/setup");
    expect(await screen.findByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Apple Account email")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Connect your Apple accounts" }),
    ).not.toBeInTheDocument();
    appleVerification.unmount();

    mocks.getMe.mockResolvedValue({ ...appleUser, emailVerified: true });
    let rejectApple: ((error: Error) => void) | undefined;
    mocks.connectICloud.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectApple = reject;
        }),
    );
    const apple = setup("/setup");
    await browser.type(await screen.findByLabelText("Apple Account email"), "person@icloud.com");
    await browser.type(screen.getByLabelText("App-specific password"), fakeAppleAppPassword);
    await browser.click(screen.getByLabelText("Calendar"));
    await browser.click(screen.getByLabelText("Mail"));
    expect(screen.getByRole("button", { name: "Connect Apple" })).toBeDisabled();
    await browser.click(screen.getByLabelText("Calendar"));
    await browser.click(screen.getByRole("button", { name: "Connect Apple" }));
    expect(screen.getByRole("button", { name: "Connecting Apple" })).toBeDisabled();
    rejectApple?.(new Error("Apple unavailable"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Apple unavailable");
    apple.unmount();

    mocks.getMe.mockResolvedValue({
      ...setupUser,
      displayName: "",
      setup: { ...setupUser.setup, currentStep: "welcome" },
    });
    mocks.updateAccountSetup.mockRejectedValueOnce(new Error("Setup unavailable"));
    const saveError = setup("/setup");
    expect(await screen.findByRole("heading", { name: "Hi, there." })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Set up ilo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Setup unavailable");
    saveError.unmount();
  }, 15_000);

  it("summarizes a connected setup source with sparse provider data", async () => {
    mocks.getMe.mockResolvedValue({
      ...user,
      setup: {
        completedAt: null,
        currentStep: "icloud",
        dismissedAt: null,
        selectedWorkspaces: ["calendar"],
        startedAt: now,
        status: "in_progress",
      },
    });
    mocks.listConnectors.mockResolvedValue([
      {
        calendarEnabled: false,
        email: null,
        id: secondId,
        label: "Apple",
        lastSyncedAt: now,
        mailEnabled: false,
        provider: "icloud",
        syncError: null,
        syncStatus: "idle",
      },
    ]);

    setup("/setup");
    const browser = userEvent.setup();

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getAllByText("Apple")).toHaveLength(1);
    await browser.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("1 account connected")).toBeInTheDocument();
  });

  it("recovers accounts and completes one-time authentication links", async () => {
    const browser = userEvent.setup();
    mocks.getMe.mockRejectedValueOnce(new Error("unauthorized"));
    const recovery = setup();
    await browser.click(await screen.findByRole("button", { name: "Forgot your password?" }));
    await browser.type(screen.getByLabelText("Email"), "test@example.com");
    await browser.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "password-reset link is on its way",
    );
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith({ email: "test@example.com" });
    await browser.click(screen.getByRole("button", { name: "Back to sign in" }));
    recovery.unmount();

    window.history.replaceState({}, "", "/?verifyEmail=verification-token");
    mocks.getMe.mockRejectedValueOnce(new Error("unauthorized"));
    const verification = setup();
    await browser.click(await screen.findByRole("button", { name: "Confirm email" }));
    await waitFor(() =>
      expect(mocks.confirmEmailVerification).toHaveBeenCalledWith({
        token: "verification-token",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Your commitments" })).toBeInTheDocument();
    verification.unmount();

    window.history.replaceState({}, "", "/?resetPassword=reset-token");
    mocks.getMe.mockRejectedValueOnce(new Error("unauthorized"));
    const passwordReset = setup();
    await browser.type(await screen.findByLabelText("New password"), "LocalTestOnly123!");
    await browser.type(screen.getByLabelText("Confirm password"), "LocalTestOnly123!");
    await browser.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Your password has been reset");
    expect(mocks.resetPassword).toHaveBeenCalledWith({
      password: "LocalTestOnly123!",
      token: "reset-token",
    });
    passwordReset.unmount();
    window.history.replaceState({}, "", "/");
  });

  it("renders fatal and inline failures", async () => {
    mocks.getMe.mockRejectedValueOnce(new TypeError("Load failed"));
    const offline = setup();
    expect(await screen.findByText("ilo service is offline.")).toBeInTheDocument();
    expect(screen.getByText(/Start environment action/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    offline.unmount();
    mocks.getMe.mockRejectedValueOnce(new Error("database unavailable"));
    const first = setup();
    expect(await screen.findByText("Couldn’t load this material.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    first.unmount();
    mocks.getMe.mockResolvedValueOnce(user);
    mocks.getDailyBrief.mockRejectedValue(new Error("calendar unavailable"));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("calendar unavailable");
  });

  it("organizes and opens the full navigation across screen sizes", async () => {
    setup();
    const browser = userEvent.setup();
    await screen.findByRole("heading", { name: "Your commitments" });
    const topNavigation = screen.getByRole("navigation", { name: "Top navigation" });
    expect(
      within(topNavigation).getByRole("heading", { name: "Monday, July 13th" }),
    ).toBeInTheDocument();
    expect(within(topNavigation).queryByRole("link", { name: "Journal" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).queryByRole("heading", { name: "Monday, July 13th" }),
    ).not.toBeInTheDocument();
    const sidebar = screen.getByRole("complementary", { name: "Application Sidebar" });

    expect(sidebar).toHaveAttribute("data-state", "expanded");
    expect(screen.getByRole("navigation", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Personal" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Reminders" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Automations$/ })).not.toBeInTheDocument();
    const todayLink = within(sidebar).getByRole("link", { name: "Today" });
    const goalsLink = within(sidebar).getByRole("link", { name: "Goals" });
    expect(todayLink.querySelector("svg")).toHaveAttribute("data-navigation-icon-weight", "fill");
    expect(goalsLink.querySelector("svg")).toHaveAttribute(
      "data-navigation-icon-weight",
      "regular",
    );
    expect(within(sidebar).getByRole("button", { name: "Switch workspace" })).toHaveTextContent(
      "Today at a Glance",
    );
    expect(within(sidebar).queryByText(user.email)).not.toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Switch workspace" }));
    const workspaceMenu = screen.getByRole("menu", { name: "Switch workspace" });
    expect(
      within(workspaceMenu).getByRole("menuitem", { name: "Today at a Glance" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      workspaceMenu.querySelector('[data-slot="dropdown-menu-separator"]'),
    ).toBeInTheDocument();
    expect(within(workspaceMenu).getByRole("menuitem", { name: "Finances" })).toBeInTheDocument();
    await browser.click(within(workspaceMenu).getByRole("menuitem", { name: "Finances" }));
    expect(await screen.findByText("Spent this month")).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Switch workspace" })).toHaveTextContent(
      "Finances",
    );
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Account menu" }));
    const accountMenu = screen.getByRole("menu", { name: "Account menu" });
    expect(within(accountMenu).getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    expect(within(accountMenu).getByRole("menuitem", { name: "Activity" })).toBeInTheDocument();
    expect(within(accountMenu).getByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
    await browser.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Account menu" })).not.toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "Account menu" })).not.toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Switch workspace" }));
    await browser.click(screen.getByRole("menuitem", { name: "Today at a Glance" }));
    const more = screen.getByRole("button", { name: "More" });
    await browser.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(sidebar).toHaveClass("sidebar--mobile-open");
    expect(document.body).toHaveStyle({ overflow: "hidden" });
    await browser.click(screen.getByRole("link", { name: "Goals" }));
    expect(await screen.findByRole("heading", { name: "Goals" })).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Today" }).querySelector("svg"),
    ).toHaveAttribute("data-navigation-icon-weight", "regular");
    expect(
      within(sidebar).getByRole("link", { name: "Goals" }).querySelector("svg"),
    ).toHaveAttribute("data-navigation-icon-weight", "fill");
    await browser.click(screen.getByRole("link", { name: "Motives" }));
    expect(await screen.findByRole("heading", { name: "Motives" })).toBeInTheDocument();
    await browser.click(screen.getByRole("link", { name: "Finances" }));
    expect(await screen.findByText("Spent this month")).toBeInTheDocument();

    await browser.click(more);
    await browser.click(
      screen.getAllByRole("button", { name: "Close Navigation" }).at(-1) as HTMLElement,
    );
    expect(more).toHaveAttribute("aria-expanded", "false");
    await browser.click(more);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(more).toHaveAttribute("aria-expanded", "false");
  }, 15_000);

  it("warms workspace caches, shows live summaries, and previews loaded destinations", async () => {
    const openBrief = await mocks.getDailyBrief();
    mocks.getDailyBrief.mockClear();
    mocks.getDailyBrief.mockResolvedValue({
      ...openBrief,
      allDay: [],
      laterToday: [],
      next: null,
      now: [],
    });
    configureFinanceWorkspace();
    const view = setup("/goals");
    const browser = userEvent.setup();
    await screen.findByRole("heading", { name: "Goals" });

    await browser.click(screen.getByRole("button", { name: "Switch workspace" }));
    const workspaceMenu = screen.getByRole("menu", { name: "Switch workspace" });
    await waitFor(() => {
      expect(mocks.listEvents).toHaveBeenCalled();
      expect(mocks.listTasks).toHaveBeenCalledWith({ completed: false, status: "inbox" });
      expect(mocks.listMailThreads).toHaveBeenCalledWith({});
    });
    expect(mocks.getFinanceWealthSummary).not.toHaveBeenCalled();
    expect(mocks.getFinanceLedgerHealth).not.toHaveBeenCalled();
    expect(mocks.getFinanceBudgetPace).not.toHaveBeenCalled();
    expect(within(workspaceMenu).getByText("Weather · Set location")).toBeInTheDocument();
    expect(within(workspaceMenu).getByText("2 events today · 2 left")).toBeInTheDocument();
    expect(within(workspaceMenu).getByText("1 in inbox")).toBeInTheDocument();
    expect(within(workspaceMenu).getByText("1 unread")).toBeInTheDocument();
    expect(within(workspaceMenu).getByText("1 to review")).toBeInTheDocument();
    expect(view.queryClient.getQueryData(["tasks", "inbox"])).toEqual({
      items: [task],
      nextCursor: null,
    });

    fireEvent.pointerMove(
      within(workspaceMenu).getByRole("menuitem", { name: "Today at a Glance" }),
    );
    await waitFor(() =>
      expect(
        view.container.querySelector('.workspace-preview[data-workspace="today"]'),
      ).toBeInTheDocument(),
    );
    await waitFor(() => {
      expect(view.container.querySelector(".workspace-preview")).toHaveTextContent(
        "The day is open",
      );
      expect(view.container.querySelector(".workspace-preview")).toHaveTextContent("4 hr free");
    });
    expect(workspaceMenu).toHaveStyle({
      "--workspace-indicator-y": `${workspaceIndicatorOffset(0)}px`,
    });

    fireEvent.pointerMove(within(workspaceMenu).getByRole("menuitem", { name: "Calendar" }));

    await waitFor(() =>
      expect(
        view.container.querySelector('.workspace-preview[data-workspace="calendar"]'),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(view.container.querySelector(".workspace-preview")).toHaveTextContent("Focus block"),
    );
    expect(workspaceMenu).toHaveStyle({
      "--workspace-indicator-y": `${workspaceIndicatorOffset(1)}px`,
    });

    fireEvent.pointerMove(within(workspaceMenu).getByRole("menuitem", { name: "Tasks" }));
    await waitFor(() =>
      expect(
        view.container.querySelector('.workspace-preview[data-workspace="tasks"]'),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(view.container.querySelector(".workspace-preview")).toHaveTextContent("Draft brief"),
    );
    expect(workspaceMenu).toHaveStyle({
      "--workspace-indicator-y": `${workspaceIndicatorOffset(2)}px`,
    });

    fireEvent.pointerMove(within(workspaceMenu).getByRole("menuitem", { name: "Mail" }));
    await waitFor(() =>
      expect(
        view.container.querySelector('.workspace-preview[data-workspace="mail"]'),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(view.container.querySelector(".workspace-preview")).toHaveTextContent(
        "Project update",
      ),
    );
    expect(workspaceMenu).toHaveStyle({
      "--workspace-indicator-y": `${workspaceIndicatorOffset(3)}px`,
    });

    fireEvent.pointerMove(within(workspaceMenu).getByRole("menuitem", { name: "Finances" }));
    await waitFor(() =>
      expect(
        view.container.querySelector('.workspace-preview[data-workspace="finances"]'),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(view.container.querySelector(".workspace-preview")).toHaveTextContent(
        "Spent this month",
      ),
    );
    await waitFor(() => {
      expect(mocks.getFinanceWealthSummary).toHaveBeenCalled();
      expect(mocks.getFinanceLedgerHealth).toHaveBeenCalled();
      expect(mocks.getFinanceBudgetPace).toHaveBeenCalledWith("week");
    });
    expect(workspaceMenu).toHaveStyle({
      "--workspace-indicator-y": `${workspaceIndicatorOffset(4)}px`,
    });

    await browser.keyboard("{Escape}");
    expect(view.container.querySelector(".workspace-preview")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Goals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch workspace" })).not.toHaveTextContent(
      "Calendar",
    );
    expect(view.container.querySelector(".workspace-route")).toHaveAttribute(
      "data-direction",
      "none",
    );
  });

  it("moves workspace pages in the same direction as the menu selection", async () => {
    const view = setup();
    const browser = userEvent.setup();
    await screen.findByRole("heading", { name: "Your commitments" });

    await browser.click(screen.getByRole("button", { name: "Switch workspace" }));
    await waitFor(() =>
      expect(mocks.listTasks).toHaveBeenCalledWith({ completed: false, status: "inbox" }),
    );
    const taskEntryCallsBeforeNavigation = mocks.listTasks.mock.calls.filter(
      ([query]) => query?.status === "inbox",
    ).length;
    await browser.click(screen.getByRole("menuitem", { name: "Tasks" }));

    expect(await screen.findByText("Task inbox")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        mocks.listTasks.mock.calls.filter(([query]) => query?.status === "inbox").length,
      ).toBeGreaterThan(taskEntryCallsBeforeNavigation),
    );
    expect(view.container.querySelector(".workspace-route")).toHaveAttribute(
      "data-direction",
      "down",
    );

    await browser.click(screen.getByRole("button", { name: "Switch workspace" }));
    await browser.click(screen.getByRole("menuitem", { name: "Calendar" }));

    expect(
      await screen.findByRole("complementary", { name: "Calendar Sidebar" }),
    ).toBeInTheDocument();
    expect(view.container.querySelector(".workspace-route")).toHaveAttribute(
      "data-direction",
      "up",
    );
  });

  it("captures, completes, and organizes tasks", async () => {
    const browser = userEvent.setup();
    const { queryClient } = setup("/tasks");
    expect(await screen.findByText("Task inbox")).toBeInTheDocument();
    expect(await screen.findByText("Draft brief")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Task tags")).getByText("planning")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "New task" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Capture a task");
    await browser.type(screen.getByLabelText("Task"), "Write task coverage");
    await browser.type(screen.getByLabelText("Estimate in minutes"), "25");
    await browser.type(screen.getByLabelText("Tags"), "quality, coverage");
    await browser.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(mocks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          estimateMinutes: 25,
          status: "inbox",
          tags: ["quality", "coverage"],
          timezone: null,
          title: "Write task coverage",
        }),
      ),
    );
    await browser.click(screen.getByRole("checkbox", { name: "Complete Draft brief" }));
    await waitFor(() => expect(mocks.completeTask).toHaveBeenCalledWith(task.id, true));
    await waitFor(() => expect(mocks.listTasks.mock.calls.length).toBeGreaterThan(1));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await browser.click(screen.getByRole("button", { name: "Remove Draft brief" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["daily-brief"] }));
    invalidate.mockRestore();
    await browser.click(screen.getByRole("link", { name: "Next" }));
    expect(await screen.findByText("Next tasks")).toBeInTheDocument();
    expect(mocks.listTasks).toHaveBeenCalledWith({ completed: false, status: "next" });
  });

  it("captures unscheduled tasks cleanly and communicates a pending save", async () => {
    const browser = userEvent.setup();
    const view = setup("/tasks");
    await screen.findByText("Task inbox");
    await browser.click(screen.getByRole("button", { name: "New task" }));
    await browser.type(screen.getByLabelText("Task"), "Unscheduled capture");
    let resolveCreate: ((value: typeof task) => void) | undefined;
    mocks.createTask.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    await browser.click(screen.getByRole("button", { name: "Create task" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        dueAt: null,
        estimateMinutes: null,
        scheduledAt: null,
        timezone: null,
      }),
    );
    resolveCreate?.(task);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await browser.click(screen.getByRole("button", { name: "New task" }));
    await browser.type(screen.getByLabelText("Task"), "Reserved capture");
    await browser.selectOptions(screen.getByLabelText("Status"), "scheduled");
    fireEvent.change(screen.getByLabelText("Reserved time"), {
      target: { value: "2026-07-14T09:00" },
    });
    await browser.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(mocks.createTask).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scheduledAt: "2026-07-14T09:00:00.000Z",
          timezone: "UTC",
        }),
      ),
    );
    view.unmount();
  });

  it("edits tasks and renders task failures without hiding task metadata", async () => {
    const browser = userEvent.setup();
    const first = setup("/tasks");
    await screen.findByText("Draft brief");
    await browser.click(screen.getByRole("button", { name: "Edit Draft brief" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Refine task");
    expect(screen.getByLabelText("Task")).toHaveValue("Draft brief");
    expect(screen.getByLabelText("Notes")).toHaveValue("Keep it concise");
    expect(screen.getByLabelText("Tags")).toHaveValue("planning");
    await browser.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Edit Draft brief" }));
    mocks.updateTask.mockRejectedValueOnce(new Error("Task update failed"));
    await browser.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Task update failed");
    first.unmount();

    mocks.listTasks.mockResolvedValue({ items: [{ ...task, tags: [] }], nextCursor: null });
    mocks.deleteTask.mockRejectedValue(new Error("Task delete failed"));
    const second = setup("/tasks");
    await screen.findByText("Draft brief");
    expect(screen.queryByLabelText("Task tags")).not.toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Remove Draft brief" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Task delete failed");
    second.unmount();
  });

  it("keeps task views useful when loading fails or there is nothing to organize", async () => {
    mocks.listTasks.mockRejectedValueOnce(new Error("Tasks are temporarily unavailable"));
    const failed = setup("/tasks");
    expect(await screen.findByRole("alert")).toHaveTextContent("Tasks are temporarily unavailable");
    failed.unmount();

    mocks.listTasks.mockResolvedValueOnce({ items: [], nextCursor: null });
    const empty = setup("/tasks?view=scheduled");
    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
    expect(
      screen.getByText("Schedule a task when it needs a specific time block."),
    ).toBeInTheDocument();
    empty.unmount();

    mocks.listTasks.mockResolvedValueOnce({ items: [], nextCursor: null });
    const completed = setup("/tasks?view=completed");
    expect(await screen.findByText("Completed tasks")).toBeInTheDocument();
    expect(mocks.listTasks).toHaveBeenCalledWith({ completed: true });
    completed.unmount();
  });

  it("does not invent an up-next event when something is already happening", async () => {
    mocks.getDailyBrief.mockResolvedValueOnce({
      allDay: [],
      anytime: [],
      capacity,
      completedTasks: [],
      generatedAt: now,
      laterToday: [],
      next: null,
      now: [event],
      overdue: [],
      tasks: [],
      timeZone: "UTC",
      today: [],
      tomorrow: [],
    });
    const view = setup();
    expect(await screen.findByText("Focus block")).toBeInTheDocument();
    expect(screen.queryByText("Up next")).not.toBeInTheDocument();
    view.unmount();
  });

  it("keeps the legacy account settings URL compatible", async () => {
    const view = setup("/settings?section=account");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    view.unmount();
  });

  it("keeps the settings return link quiet and personal", async () => {
    const view = setup("/settings?section=appearance");
    const sidebar = await screen.findByRole("complementary", { name: "Settings Sidebar" });
    const topNavigation = screen.getByRole("navigation", { name: "Top navigation" });

    expect(within(sidebar).getByRole("link", { name: "Back to Test's Workspace" })).toHaveAttribute(
      "href",
      "/today",
    );
    expect(within(topNavigation).queryByRole("heading")).not.toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("heading", { name: "Settings" })).toHaveClass(
      "sr-only",
    );
    expect(within(sidebar).queryByText("Settings")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();

    view.unmount();
  });

  it("shows budget pace and changes its contribution-graph horizon", async () => {
    mocks.getFinanceOverview.mockResolvedValueOnce({
      accounts: [],
      budgets: [],
      pendingSpendThisMonth: 0,
      refundCreditsThisMonth: 0,
      reviewCount: 0,
      spendingThisMonth: 0,
      transactions: [],
    });
    const view = setup("/finances");
    const browser = userEvent.setup();

    expect(await screen.findByText("Budget pace")).toBeInTheDocument();
    expect(mocks.getFinanceBudgetPace).toHaveBeenCalledWith("week");
    expect(screen.getByText("Ahead of pace")).toBeInTheDocument();
    await browser.click(screen.getByText("Month"));
    await waitFor(() => expect(mocks.getFinanceBudgetPace).toHaveBeenLastCalledWith("month"));
    expect(await screen.findByText("Budget pace")).toBeInTheDocument();
    view.unmount();
  });

  it("reviews and inspects finance transactions", async () => {
    configureFinanceWorkspace();
    const view = setup("/finances/review");
    const browser = userEvent.setup();

    expect(await screen.findByText("Unfamiliar charge")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Categorize" }));
    await browser.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await browser.click(screen.getByRole("button", { name: "Categorize" }));
    await browser.click(screen.getByRole("button", { name: "Cancel" }));
    await browser.click(screen.getByRole("button", { name: "Categorize" }));
    await browser.type(within(screen.getByRole("dialog")).getByLabelText("Category"), "Utilities");
    await browser.click(screen.getByRole("button", { name: "Save category" }));
    await waitFor(() =>
      expect(mocks.updateFinanceTransaction).toHaveBeenCalledWith(id, { category: "Utilities" }),
    );
    await browser.click(screen.getByRole("link", { name: "Transactions" }));
    expect(await screen.findByText("Cafe")).toBeInTheDocument();
    const transactionTable = screen.getByRole("table", { name: "Transactions" });
    expect(transactionTable).toHaveTextContent("Jul 13, 2026");
    expect(transactionTable).toHaveTextContent("Transfers");
    expect(transactionTable).not.toHaveTextContent("TRANSFER_OUT");
    expect(screen.getAllByRole("img", { name: "Merchant entity found" })).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Merchant entity needs review" })).toBeInTheDocument();
    const transactionRows = within(transactionTable).getAllByRole("row");
    const firstTransactionRow = transactionRows.at(1);
    expect(firstTransactionRow).toBeDefined();
    if (!firstTransactionRow) throw new Error("Expected a transaction row");
    await browser.click(within(firstTransactionRow).getByRole("button", { name: "Details" }));
    expect(await screen.findByText("Raw description")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Sort by amount" }));
    await waitFor(() =>
      expect(mocks.listFinanceTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ sortBy: "amount" }),
      ),
    );
    expect(screen.getByText("+$100.00")).toHaveClass("text-success");
    expect(screen.getByText("−$15.00")).toHaveClass("text-destructive");
    await browser.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mocks.listFinanceTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "finance-page-2" }),
      ),
    );
    view.unmount();
  });

  it("syncs accounts and imports account history", async () => {
    configureFinanceWorkspace();
    const view = setup("/finances");
    const browser = userEvent.setup();

    await browser.click(
      await screen.findByRole("button", { name: "Spent this month: configure included accounts" }),
    );
    const scopeDialog = await screen.findByRole("dialog", {
      name: "Accounts included in spending",
    });
    expect(within(scopeDialog).getByLabelText("Checking · $42.50")).toBeInTheDocument();
    expect(within(scopeDialog).getByLabelText("Wallet · $0.00")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Close" }));
    await browser.click(screen.getByRole("link", { name: "Open accounts" }));
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() => expect(mocks.syncFinanceAccount).toHaveBeenCalledWith(id));
    await browser.click(screen.getByRole("button", { name: "Connect bank" }));
    await waitFor(() => expect(mocks.getPlaidLinkToken).toHaveBeenCalled());
    await waitFor(() => expect(mocks.plaidLink.open).toHaveBeenCalled());
    act(() => mocks.plaidLink.onSuccess?.(null));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Plaid completed without a bank connection",
    );
    act(() => mocks.plaidLink.onSuccess?.("public-token"));
    await waitFor(() =>
      expect(mocks.exchangePlaidToken).toHaveBeenCalledWith({
        institution: null,
        publicToken: "public-token",
      }),
    );

    await browser.click(screen.getByRole("link", { name: "Import history" }));
    expect(await screen.findByRole("heading", { name: "Import history" })).toBeInTheDocument();
    await browser.selectOptions(screen.getByLabelText("Export provider"), "venmo");
    expect(screen.getByLabelText("Destination account")).toHaveValue("");
    await browser.selectOptions(screen.getByLabelText("Export provider"), "paypal");
    await browser.selectOptions(screen.getByLabelText("Destination account"), secondId);
    fireEvent.change(screen.getByLabelText("CSV export"), { target: { files: [] } });
    const csvFile = new File(["Date,Amount\n2026-07-13,10"], "paypal-history.csv", {
      type: "text/csv",
    });
    Object.defineProperty(csvFile, "text", {
      value: async () => "Date,Amount\n2026-07-13,10",
    });
    fireEvent.change(screen.getByLabelText("CSV export"), { target: { files: [csvFile] } });
    expect(await screen.findByText("paypal-history.csv ready to import")).toBeInTheDocument();
    let resolveImport: ((value: { imported: number; skipped: number }) => void) | undefined;
    mocks.importFinanceCsv.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );
    await browser.click(screen.getByRole("button", { name: "Import CSV" }));
    expect(await screen.findByRole("button", { name: "Importing" })).toBeDisabled();
    await waitFor(() =>
      expect(mocks.importFinanceCsv).toHaveBeenCalledWith({
        accountId: secondId,
        csv: "Date,Amount\n2026-07-13,10",
        provider: "paypal",
      }),
    );
    resolveImport?.({ imported: 1, skipped: 0 });
    expect(await screen.findByText("Imported 1; skipped 0 duplicates.")).toBeInTheDocument();

    view.unmount();
  }, 10_000);

  it("tracks manual accounts and transactions", async () => {
    configureFinanceWorkspace();
    const view = setup("/finances/accounts");
    const browser = userEvent.setup();

    await browser.click(await screen.findByRole("button", { name: "Track account" }));
    await browser.type(screen.getByLabelText("Institution"), "PayPal");
    await browser.type(screen.getByLabelText("Account name"), "Export");
    await browser.selectOptions(screen.getByLabelText("Source"), "paypal");
    await browser.type(screen.getByLabelText("Current balance"), "21.50");
    await browser.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() =>
      expect(mocks.createFinanceAccount).toHaveBeenCalledWith({
        balance: 21.5,
        institution: "PayPal",
        kind: "cash",
        name: "Export",
        provider: "paypal",
      }),
    );
    await browser.click(screen.getByRole("button", { name: "Track account" }));
    await browser.type(screen.getByLabelText("Institution"), "Venmo");
    await browser.type(screen.getByLabelText("Account name"), "Manual balance");
    await browser.selectOptions(screen.getByLabelText("Source"), "venmo");
    await browser.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() =>
      expect(mocks.createFinanceAccount).toHaveBeenLastCalledWith({
        balance: null,
        institution: "Venmo",
        kind: "cash",
        name: "Manual balance",
        provider: "venmo",
      }),
    );
    await browser.click(screen.getByRole("link", { name: "Transactions" }));
    await browser.click(screen.getByRole("button", { name: "New transaction" }));
    await browser.selectOptions(screen.getByLabelText("Account"), id);
    await browser.type(screen.getByLabelText("Merchant"), "Bookstore");
    await browser.type(screen.getByLabelText("Amount"), "19.25");
    await browser.type(screen.getByLabelText("Category (optional)"), "Books");
    await browser.click(screen.getByRole("button", { name: "Add transaction" }));
    await waitFor(() =>
      expect(mocks.createFinanceTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: id,
          amount: 19.25,
          category: "Books",
          merchant: "Bookstore",
        }),
      ),
    );
    await browser.click(screen.getByRole("button", { name: "New transaction" }));
    await browser.type(screen.getByLabelText("Merchant"), "Uncategorized item");
    await browser.type(screen.getByLabelText("Amount"), "3");
    await browser.click(screen.getByRole("button", { name: "Add transaction" }));
    await waitFor(() =>
      expect(mocks.createFinanceTransaction).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: null, merchant: "Uncategorized item" }),
      ),
    );
    view.unmount();
  }, 30_000);

  it("plans budgets and inspects their contributing activity", async () => {
    configureFinanceWorkspace();
    const view = setup("/finances/budgets");
    const browser = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Budgets" })).toBeInTheDocument();
    expect(await screen.findByText("July 2026 · $27.50 spent · $72.50 left")).toBeInTheDocument();
    await browser.click(
      screen.getByRole("button", { name: "Planned: view contributing transactions" }),
    );
    expect(await screen.findByRole("dialog", { name: "Planned allocation" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Planned allocation by category" })).toHaveTextContent(
      "Dining",
    );
    await browser.click(screen.getByRole("button", { name: "Close" }));
    await browser.click(screen.getByRole("button", { name: "Export data" }));
    expect(await screen.findByText("Raw finance data (CSV)")).toBeInTheDocument();
    await browser.keyboard("{Escape}");
    mocks.getFinanceOverviewForMonth.mockResolvedValueOnce({
      accounts: [],
      budgets: [],
      reviewCount: 0,
      spendingThisMonth: 0,
      transactions: [],
    });
    await browser.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() =>
      expect(mocks.getFinanceOverviewForMonth).toHaveBeenLastCalledWith("2026-08"),
    );
    expect(await screen.findByText("No budget for August 2026")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByText("July 2026 · $27.50 spent · $72.50 left")).toBeInTheDocument();
    await browser.click(
      screen.getByRole("button", { name: "Spent: view contributing transactions" }),
    );
    expect(await screen.findByRole("dialog", { name: "Spending this month" })).toBeInTheDocument();
    expect(screen.getByText("Potential allocation issues")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Close" }));
    await browser.click(screen.getByRole("button", { name: "Dining" }));
    expect(await screen.findByRole("dialog", { name: "Dining activity" })).toBeInTheDocument();
    expect(screen.getByText("Cafe")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Close" }));
    await browser.click(screen.getByRole("button", { name: "Edit budget" }));
    await browser.type(screen.getByLabelText("Category"), "Dining");
    await browser.type(screen.getByLabelText("Monthly limit"), "250");
    await browser.click(screen.getByRole("button", { name: "Save budget" }));
    await waitFor(() =>
      expect(mocks.createFinanceBudget).toHaveBeenCalledWith({
        category: "Dining",
        limit: 250,
        month: "2026-07",
      }),
    );
    mocks.createFinanceBudget.mockRejectedValueOnce(new Error("Budget rejected"));
    await browser.click(screen.getByRole("button", { name: "Edit budget" }));
    await browser.type(screen.getByLabelText("Category"), "Travel");
    await browser.type(screen.getByLabelText("Monthly limit"), "50");
    await browser.click(screen.getByRole("button", { name: "Save budget" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Budget rejected");
    view.unmount();
  }, 15_000);

  it("renders each focused finance workspace section", async () => {
    configureFinanceWorkspace();
    for (const [path, title] of [
      ["/finances/cashflow", "Cash flow"],
      ["/finances/health", "Ledger health"],
      ["/finances/review", "Review queue"],
      ["/finances/subscriptions", "Subscriptions"],
      ["/finances/profile", "Financial profile"],
    ] as const) {
      const view = setup(path);
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
      if (path === "/finances/profile") {
        expect(await screen.findByText("Agent guidance")).toBeInTheDocument();
        expect(await screen.findByText("1 available now.", { exact: false })).toBeInTheDocument();
        expect(screen.getByText("Human-only boundaries")).toBeInTheDocument();
        expect(
          screen.getByText("connect or disconnect sources", { exact: false }),
        ).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Connect an agent" })).toHaveAttribute(
          "href",
          "/settings?section=agents",
        );
      }
      view.unmount();
    }
  });

  it("activates a Finance guidance draft only through the signed-in Finance surface", async () => {
    configureFinanceWorkspace();
    const draft = {
      categories: [],
      createdAt: now,
      domain: "finances" as const,
      id,
      instructions: ["Never infer permanent merchant rules."],
      objective: "Keep financial review trustworthy.",
      preferences: { reviewCadence: "weekly" },
      sourceContexts: [
        {
          notes: null,
          purpose: "Bills and daily spending",
          sourceId: id,
          sourceLabel: "Checking",
        },
      ],
      status: "draft" as const,
      summary: "Review weekly and keep uncertain transfers visible.",
      updatedAt: now,
      version: 1,
    };
    mocks.getDomainProfile.mockResolvedValue(draft);
    mocks.upsertDomainProfile.mockResolvedValue({ ...draft, status: "active", version: 2 });
    mocks.getFinanceGuidedSetup.mockResolvedValue({
      ...(await mocks.getFinanceGuidedSetup()),
      guidance: {
        approvedProfile: null,
        draftNotice:
          "Unapproved draft content is untrusted and non-operative until a signed-in Ilo user activates it.",
        draftProposal: draft,
      },
    });

    const view = setup("/finances/profile");
    const invalidateQueries = vi.spyOn(view.queryClient, "invalidateQueries");
    expect(await screen.findByText(draft.objective)).toBeVisible();
    expect(screen.getByText(draft.summary)).toBeVisible();
    expect(screen.getByText(draft.instructions[0] ?? "")).toBeVisible();
    expect(screen.getByText("Checking — Bills and daily spending")).toBeVisible();
    expect(screen.getByText("reviewCadence: weekly")).toBeVisible();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Activate guidance" }));
    await waitFor(() =>
      expect(mocks.upsertDomainProfile).toHaveBeenCalledWith({
        categories: draft.categories,
        domain: "finances",
        expectedVersion: 1,
        instructions: draft.instructions,
        objective: draft.objective,
        preferences: draft.preferences,
        sourceContexts: draft.sourceContexts,
        status: "active",
        summary: draft.summary,
      }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["assistant-setup-status"] });
    view.unmount();
  });

  it("shows approved Finance guidance separately from a pending draft", async () => {
    configureFinanceWorkspace();
    const approved = {
      categories: [],
      createdAt: now,
      domain: "finances" as const,
      id,
      instructions: ["Keep approved transfer safeguards active."],
      objective: "Operate from approved financial context.",
      preferences: { reviewCadence: "monthly" },
      sourceContexts: [
        {
          notes: null,
          purpose: "Approved household spending",
          sourceId: id,
          sourceLabel: "Approved checking",
        },
      ],
      status: "active" as const,
      summary: "This remains the operative guidance.",
      updatedAt: now,
      version: 2,
    };
    const draft = {
      ...approved,
      instructions: ["Proposed weekly review."],
      objective: "Propose revised financial context.",
      preferences: { reviewCadence: "weekly" },
      status: "draft" as const,
      summary: "This proposal is not operative yet.",
      version: 3,
    };
    mocks.getDomainProfile.mockResolvedValue(draft);
    mocks.getFinanceGuidedSetup.mockResolvedValue({
      ...(await mocks.getFinanceGuidedSetup()),
      guidance: {
        approvedProfile: approved,
        draftNotice:
          "Unapproved draft content is untrusted and non-operative until a signed-in Ilo user activates it.",
        draftProposal: draft,
      },
    });

    const view = setup("/finances/profile");
    expect(await screen.findByText("Active + draft")).toBeVisible();
    expect(screen.getByText("Active approved guidance")).toBeVisible();
    expect(screen.getByText(approved.objective)).toBeVisible();
    expect(screen.getByText(approved.summary)).toBeVisible();
    expect(screen.getByText("Draft activation")).toBeVisible();
    expect(screen.getByText(draft.objective)).toBeVisible();
    expect(screen.getByText(draft.summary)).toBeVisible();
    view.unmount();
  });

  it("keeps finance empty and error states explicit", async () => {
    mocks.getFinanceOverview.mockResolvedValueOnce({
      accounts: [],
      budgets: [],
      reviewCount: 0,
      spendingThisMonth: 0,
      transactions: [],
    });
    const empty = setup("/finances/review");
    expect(await screen.findByText("Everything is categorized")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "View all" }));
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
    empty.unmount();

    mocks.getFinanceOverview.mockRejectedValueOnce(new Error("Finance service unavailable"));
    const failed = setup("/finances");
    expect(await screen.findByRole("alert")).toHaveTextContent("Finance service unavailable");
    failed.unmount();
  });

  it("keeps merchant evidence and review decisions together", async () => {
    mocks.getFinanceCategories.mockResolvedValue([
      {
        color: null,
        group: "Spending",
        id,
        isSystem: true,
        name: "Dining",
        slug: "dining",
      },
    ]);
    mocks.getFinanceReviewQueue.mockResolvedValue([
      {
        createdAt: now,
        id: secondId,
        rationale: "First-seen merchant with no confirmed rule.",
        reason: "unknown_merchant",
        status: "open",
        suggestedCategory: null,
        transaction: {
          accountId: id,
          amount: 8.5,
          category: null,
          categoryConfidence: null,
          createdAt: now,
          date: "2026-07-13",
          direction: "expense",
          id,
          merchant: "Blue Bottle Coffee",
          merchantId: id,
          needsReview: true,
          notes: null,
          pending: false,
          rawMerchant: "SQ *BLUE BOTTLE 0234",
          updatedAt: now,
        },
      },
    ]);
    mocks.resolveFinanceReview.mockResolvedValue({ deferred: true });
    const review = setup("/finances/review");
    const browser = userEvent.setup();

    expect(await screen.findByText("Blue Bottle Coffee")).toBeInTheDocument();
    expect(screen.getByText(/SQ \*BLUE BOTTLE 0234/)).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Set aside" }));
    await waitFor(() =>
      expect(mocks.resolveFinanceReview).toHaveBeenCalledWith(secondId, {
        action: "defer",
        categoryId: undefined,
        expectedTransactionUpdatedAt: undefined,
        learnMerchant: "suggest",
        rationale: null,
      }),
    );
    await browser.click(screen.getByRole("button", { name: "Change" }));
    await browser.type(within(screen.getByRole("dialog")).getByLabelText("Category"), "Dining");
    await browser.click(
      screen.getByRole("switch", { name: /always use this category for blue bottle coffee/i }),
    );
    await browser.click(screen.getByRole("button", { name: "Save category" }));
    await waitFor(() =>
      expect(mocks.resolveFinanceReview).toHaveBeenLastCalledWith(secondId, {
        action: "recategorize",
        categoryId: id,
        expectedTransactionUpdatedAt: now,
        learnMerchant: "always",
        rationale: "Reviewed and recategorized by the user.",
      }),
    );
    review.unmount();
  });

  it("submits the displayed transaction revision when approving a Finance review", async () => {
    mocks.getFinanceReviewQueue.mockResolvedValue([
      {
        createdAt: now,
        id: secondId,
        rationale: "Provider category needs confirmation.",
        reason: "low_confidence",
        status: "open",
        suggestedCategory: null,
        transaction: {
          accountId: id,
          amount: 27.5,
          category: "Dining",
          categoryConfidence: 0.95,
          categoryId: id,
          createdAt: now,
          date: "2026-07-13",
          direction: "expense",
          id: thirdId,
          merchant: "Cafe",
          needsReview: true,
          notes: null,
          pending: false,
          updatedAt: now,
        },
      },
    ]);
    mocks.resolveFinanceReview.mockResolvedValue({ applied: true });
    const view = setup("/finances/review");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(mocks.resolveFinanceReview).toHaveBeenCalledWith(secondId, {
        action: "approve",
        categoryId: undefined,
        expectedTransactionUpdatedAt: now,
        learnMerchant: "suggest",
        rationale: null,
      }),
    );
    view.unmount();
  });

  it("requires an explicit transfer confirmation for possible-transfer reviews", async () => {
    mocks.getFinanceReviewQueue.mockResolvedValue([
      {
        createdAt: now,
        id: secondId,
        rationale: "This may be movement between owned accounts.",
        reason: "possible_transfer",
        status: "open",
        suggestedCategory: "Transfers",
        transaction: {
          accountId: id,
          amount: 250,
          category: "Transfers",
          categoryConfidence: 0.95,
          categoryId: id,
          createdAt: now,
          date: "2026-07-13",
          direction: "expense",
          id: thirdId,
          merchant: "Account movement",
          needsReview: true,
          notes: null,
          pending: false,
          updatedAt: now,
        },
      },
    ]);
    mocks.resolveFinanceReview.mockResolvedValue({ applied: true });
    const view = setup("/finances/review");

    expect(await screen.findByRole("button", { name: "Confirm transfer" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Confirm transfer" }));
    await waitFor(() =>
      expect(mocks.resolveFinanceReview).toHaveBeenCalledWith(secondId, {
        action: "confirm_transfer",
        categoryId: undefined,
        expectedTransactionUpdatedAt: now,
        learnMerchant: "suggest",
        rationale: null,
      }),
    );
    view.unmount();
  });

  it("keeps global badges and calendar date navigation deterministic", async () => {
    mocks.listTasks.mockResolvedValue({
      items: [{ ...task, dueAt: now, status: "cancelled" }],
      nextCursor: null,
    });
    const today = setup("/today");
    await screen.findByRole("heading", { name: "Your commitments" });
    await waitFor(() => expect(mocks.listTasks).toHaveBeenCalled());
    today.unmount();

    const calendar = setup("/calendar");
    await screen.findByRole("radio", { name: "Week", checked: true });
    const calendarSidebar = screen.getByRole("complementary", { name: "Calendar Sidebar" });
    const datePicker = within(calendarSidebar).getByRole("region", {
      name: "Calendar date picker",
    });
    expect(datePicker.querySelector('[data-selected-single="true"]')).toBeInTheDocument();
    expect(datePicker.querySelectorAll(".bg-secondary")).toHaveLength(7);
    const nextDate = [...datePicker.querySelectorAll<HTMLButtonElement>("button[data-day]")].find(
      (button) => button.dataset.selectedSingle !== "true",
    );
    expect(nextDate).toBeDefined();
    await userEvent.setup().click(nextDate as HTMLButtonElement);
    expect(datePicker.querySelector('[data-selected-single="true"]')).toBeInTheDocument();
    expect(await screen.findByText("Focus block")).toBeInTheDocument();
    calendar.unmount();
  });

  it("keeps the calendar stable if its current-day marker is temporarily absent", async () => {
    const browser = userEvent.setup();
    const view = setup("/calendar?view=week");
    await screen.findByRole("radio", { name: "Week", checked: true });
    await screen.findByText("Focus block");
    const weekCalendar = document.querySelector(".week-calendar") as HTMLDivElement;
    weekCalendar.querySelector('button[aria-current="date"]')?.remove();
    await browser.click(screen.getByRole("button", { name: "Today" }));
    expect(
      within(screen.getByRole("navigation", { name: "Top navigation" })).queryByRole("heading"),
    ).not.toBeInTheDocument();
    view.unmount();
  });

  it("describes task material with scheduled, note-only, and blank states", async () => {
    mocks.listTasks.mockResolvedValueOnce({
      items: [
        { ...task, dueAt: null, estimateMinutes: null, notes: null, scheduledAt: null },
        {
          ...task,
          dueAt: null,
          estimateMinutes: null,
          id: "99999999-9999-4999-8999-999999999999",
          scheduledAt: "2026-07-13T14:00:00.000Z",
          title: "Reserved work",
        },
      ],
      nextCursor: null,
    });
    const view = setup("/tasks");
    expect(await screen.findByText("No date or estimate yet")).toBeInTheDocument();
    expect(screen.getByText(/Reserved Jul 13/)).toBeInTheDocument();
    view.unmount();
  });

  it("formats all planning-window capacity states", async () => {
    mocks.getDailyBrief.mockResolvedValueOnce({
      allDay: [],
      anytime: [],
      capacity: { ...capacity, availableMinutes: 0 },
      completedTasks: [],
      generatedAt: now,
      laterToday: [],
      next: null,
      now: [],
      overdue: [],
      tasks: [],
      timeZone: "UTC",
      today: [],
      tomorrow: [],
    });
    const noTime = setup();
    expect(await screen.findByText(/No time free until/)).toBeInTheDocument();
    noTime.unmount();

    mocks.getDailyBrief.mockResolvedValueOnce({
      allDay: [],
      anytime: [],
      capacity: { ...capacity, availableMinutes: 30 },
      completedTasks: [],
      generatedAt: now,
      laterToday: [],
      next: null,
      now: [],
      overdue: [],
      tasks: [],
      timeZone: "UTC",
      today: [],
      tomorrow: [],
    });
    const minutes = setup();
    expect(await screen.findByText(/30 min free until/)).toBeInTheDocument();
    minutes.unmount();

    mocks.getDailyBrief.mockResolvedValueOnce({
      allDay: [],
      anytime: [],
      capacity: { ...capacity, availableMinutes: 90 },
      completedTasks: [],
      generatedAt: now,
      laterToday: [],
      next: null,
      now: [],
      overdue: [],
      tasks: [],
      timeZone: "UTC",
      today: [],
      tomorrow: [],
    });
    const mixed = setup();
    expect(await screen.findByText(/1 hr 30 min free until/)).toBeInTheDocument();
    mixed.unmount();
  });

  it("shows profile saving and failure feedback", async () => {
    const browser = userEvent.setup();
    const view = setup("/settings?section=profile");
    await screen.findByRole("heading", { name: "Profile" });
    mocks.updateUser.mockRejectedValueOnce(new Error("Profile update unavailable"));
    await browser.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Profile update unavailable");

    let resolveUpdate: ((value: typeof user) => void) | undefined;
    mocks.updateUser.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    await browser.click(screen.getByRole("button", { name: "Save profile" }));
    expect(screen.getByRole("button", { name: "Saving profile…" })).toBeDisabled();
    resolveUpdate?.(user);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save profile" })).not.toBeDisabled(),
    );
    view.unmount();
  });

  it("keeps the email confirmation action in the alert flow", async () => {
    mocks.getMe.mockResolvedValue({ ...user, emailVerified: false });
    const view = setup("/settings?section=profile");

    await screen.findByText("Email confirmation needed");
    const alert = screen
      .getAllByRole("status")
      .find((status) => status.textContent?.includes("Email confirmation needed"));
    expect(alert).toBeDefined();
    if (!alert) {
      throw new Error("Email confirmation alert did not render");
    }
    expect(alert).toHaveTextContent("Email confirmation needed");
    expect(alert).toHaveTextContent("Confirm this address to keep account recovery available");
    expect(
      screen
        .getByRole("button", { name: "Resend confirmation" })
        .closest("[data-slot='alert-action']"),
    ).not.toBeNull();
    expect(alert.querySelector("[data-slot='alert-action']")).toHaveClass("col-span-full");

    view.unmount();
  });

  it("keeps the global toast host outside the app shell grid", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
      }),
    });
    const view = setup("/settings?section=profile");

    const toaster = await screen.findByRole("region", { name: /notifications/i });
    expect(toaster.closest(".app-shell")).toBeNull();

    view.unmount();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("searches for a home location and saves only a selected place", async () => {
    const browser = userEvent.setup();
    const view = setup("/settings?section=profile");
    const location = await screen.findByLabelText("Home Location");

    await browser.type(location, "New York");
    await waitFor(() => expect(mocks.searchWeatherLocations).toHaveBeenCalledWith("New York"));
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
    await browser.click(
      await screen.findByRole("option", { name: "New York, New York, United States" }),
    );
    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled();
    await browser.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled();
    await browser.type(location, "New York");
    await browser.click(
      await screen.findByRole("option", { name: "New York, New York, United States" }),
    );
    await browser.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          planningTimezone: "America/New_York",
          homeLocation: {
            coordinates: { latitude: 40.7128, longitude: -74.006 },
            label: "New York, New York, United States",
            timezone: "America/New_York",
          },
        }),
      ),
    );
    mocks.searchWeatherLocations.mockRejectedValue(new Error("Location search unavailable"));
    await browser.clear(location);
    await browser.type(location, "Boston");
    expect(await screen.findByRole("alert")).toHaveTextContent("Location search unavailable");
    view.unmount();
  });

  it("keeps an existing saved home location valid when its label is restored", async () => {
    const savedLocation = {
      coordinates: { latitude: 40.7128, longitude: -74.006 },
      label: "New York, New York, United States",
      timezone: "America/New_York",
    };
    mocks.getMe.mockResolvedValue({ ...user, homeLocation: savedLocation });
    const browser = userEvent.setup();
    const view = setup("/settings?section=profile");
    const location = await screen.findByLabelText("Home Location");

    await browser.clear(location);
    await browser.type(location, savedLocation.label);

    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled();
    view.unmount();
  });

  it("keeps Today useful through no-event, overloaded, and task-only states", async () => {
    const browser = userEvent.setup();
    const overdueTask = {
      ...task,
      dueAt: "2026-07-13T11:00:00.000Z",
      id: "55555555-5555-4555-8555-555555555555",
      status: "next" as const,
    };
    const scheduledTask = {
      ...task,
      dueAt: null,
      id: "66666666-6666-4666-8666-666666666666",
      scheduledAt: "2026-07-13T14:00:00.000Z",
      status: "scheduled" as const,
    };
    const suggestedTask = {
      ...task,
      dueAt: null,
      id: "88888888-8888-4888-8888-888888888889",
      title: "Suggested follow-up",
    };
    const completedTask = {
      ...task,
      completedAt: now,
      id: "77777777-7777-4777-8777-777777777777",
      status: "completed" as const,
    };
    mocks.getDailyBrief.mockResolvedValue({
      allDay: [],
      anytime: [],
      capacity: { ...capacity, availableMinutes: 0, overcommitted: true },
      completedTasks: [completedTask],
      generatedAt: now,
      laterToday: [],
      next: null,
      now: [],
      overdue: [],
      recommendedTasks: [
        {
          capacity: "fits_remaining_time" as const,
          task: suggestedTask,
          urgency: "next" as const,
        },
      ],
      tasks: [overdueTask, task, scheduledTask, suggestedTask],
      timeZone: "UTC",
      today: [],
      tomorrow: [],
    });
    mocks.listReminders.mockResolvedValue({ items: [], nextCursor: null });
    const view = setup();
    expect(await screen.findByText("The day is open")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Next commitment" })).toBeInTheDocument();
    expect(screen.getByText("Nothing else is fixed on the calendar.")).toBeInTheDocument();
    expect(screen.queryByText("Decision queue")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your commitments" })).toBeInTheDocument();
    expect(screen.getByText(/No free time before/)).toBeInTheDocument();
    expect(screen.getByText("Overdue tasks")).toBeInTheDocument();
    expect(screen.getByText("Due today")).toBeInTheDocument();
    expect(screen.getByText("Next tasks")).toBeInTheDocument();
    expect(
      screen.getByText("Ready next · fits in the remaining planning window"),
    ).toBeInTheDocument();
    await browser.click(
      within(screen.getByText("Next tasks").closest("section") as HTMLElement).getByRole("button", {
        name: "Edit Draft brief",
      }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const doneToday = screen.getByText("Done today").closest("button");
    expect(doneToday).toHaveAttribute("aria-expanded", "false");
    await browser.click(doneToday as HTMLButtonElement);
    expect(doneToday).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Completed tasks")).toBeInTheDocument();
    view.unmount();
  });

  it("explains a completed-reminder query failure on Today", async () => {
    mocks.listReminders.mockRejectedValueOnce(new Error("Completed reminders unavailable"));
    const view = setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Completed reminders unavailable");
    view.unmount();
  });

  it("installs, previews, and runs scoped automation routines", async () => {
    const browser = userEvent.setup();
    const empty = setup("/automations");
    expect(await screen.findByText("No routines yet")).toBeInTheDocument();
    await browser.click(screen.getAllByRole("button", { name: "Install" })[0] as HTMLElement);
    await waitFor(() =>
      expect(mocks.createAutomation).toHaveBeenCalledWith({
        schedule: "Weekdays at 8:00 AM",
        template: "morning_brief",
        timezone: "UTC",
      }),
    );
    mocks.createAutomation.mockRejectedValueOnce(new Error("install unavailable"));
    await browser.click(screen.getAllByRole("button", { name: "Install" })[1] as HTMLElement);
    expect(await screen.findByRole("alert")).toHaveTextContent("install unavailable");
    empty.unmount();

    const routine = {
      id,
      template: "morning_brief" as const,
      title: "Morning Brief",
      schedule: "Weekdays at 8:00 AM",
      timezone: "UTC",
      enabled: true,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const nightlyRoutine = {
      ...routine,
      id: thirdId,
      schedule: "Daily at 8:00 PM",
      template: "nightly_review" as const,
      title: "Nightly Review",
    };
    const unrunRoutine = {
      ...routine,
      id: "55555555-5555-4555-8555-555555555555",
      title: "Unrun routine",
    };
    mocks.listAutomations.mockResolvedValue([routine, nightlyRoutine, unrunRoutine]);
    mocks.listAutomationRuns.mockResolvedValue([
      {
        id: secondId,
        routineId: id,
        status: "dry_run" as const,
        summary: "Previewed",
        brief: null,
        startedAt: now,
        completedAt: now,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        routineId: thirdId,
        status: "completed" as const,
        summary: "Completed",
        brief: null,
        startedAt: now,
        completedAt: now,
      },
    ]);
    const installed = setup("/automations");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByText("Morning Brief")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Installed" })[0]).toBeDisabled();
    await browser.clear(screen.getByLabelText("Morning Brief schedule"));
    expect(screen.getAllByRole("button", { name: "Save" })[0]).toBeDisabled();
    await browser.type(screen.getByLabelText("Morning Brief schedule"), "Weekdays at 9:00 AM");
    await browser.click(screen.getAllByRole("checkbox")[0] as HTMLElement);
    mocks.updateAutomation.mockRejectedValueOnce(new Error("schedule unavailable"));
    await browser.click(screen.getAllByRole("button", { name: "Save" })[0] as HTMLElement);
    await waitFor(() =>
      expect(mocks.updateAutomation).toHaveBeenCalledWith(id, {
        enabled: false,
        schedule: "Weekdays at 9:00 AM",
        timezone: "UTC",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("schedule unavailable");
    expect(screen.getAllByRole("button", { name: "Preview" })[0]).toBeDisabled();
    await browser.click(screen.getAllByRole("checkbox")[0] as HTMLElement);
    await browser.click(screen.getAllByRole("button", { name: "Save" })[0] as HTMLElement);
    await waitFor(() =>
      expect(mocks.updateAutomation).toHaveBeenLastCalledWith(id, {
        enabled: true,
        schedule: "Weekdays at 9:00 AM",
        timezone: "UTC",
      }),
    );
    await browser.click(screen.getAllByRole("button", { name: "Preview" })[0] as HTMLElement);
    await waitFor(() => expect(mocks.runAutomation).toHaveBeenCalledWith(id, true));
    await browser.click(screen.getAllByRole("button", { name: "Run now" })[0] as HTMLElement);
    await waitFor(() => expect(mocks.runAutomation).toHaveBeenCalledWith(id, false));
    mocks.runAutomation.mockRejectedValueOnce(new Error("run unavailable"));
    await browser.click(screen.getAllByRole("button", { name: "Run now" })[1] as HTMLElement);
    expect(await screen.findByText("run unavailable")).toBeInTheDocument();
    installed.unmount();

    mocks.listAutomations.mockRejectedValueOnce(new Error("routines unavailable"));
    const failed = setup("/automations");
    expect(await screen.findByRole("alert")).toHaveTextContent("routines unavailable");
    failed.unmount();

    mocks.listAutomationRuns.mockRejectedValueOnce(new Error("runs unavailable"));
    const runsFailed = setup("/automations");
    expect(await screen.findByRole("alert")).toHaveTextContent("runs unavailable");
    runsFailed.unmount();
  });

  it("directly manipulates reminders and events from today", async () => {
    setup();
    const browser = userEvent.setup();
    expect(await screen.findByText("Focus block")).toBeInTheDocument();
    expect(screen.getByText("Test reminder")).toBeInTheDocument();

    await browser.click(screen.getByRole("button", { name: /Live focus/ }));
    expect(await screen.findByRole("heading", { name: "Live focus" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await browser.click(screen.getByRole("button", { name: /Later focus/ }));
    expect(await screen.findByRole("heading", { name: "Later focus" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await browser.click(screen.getByRole("button", { name: /All day Quiet day/ }));
    expect(await screen.findByRole("heading", { name: "Quiet day" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });

    await browser.click(screen.getByRole("button", { name: "Add" }));
    await browser.click(screen.getByRole("menuitem", { name: /Reminder/ }));
    await browser.type(screen.getByLabelText("What needs attention?"), "A new reminder");
    expect(screen.getByLabelText("Deadline")).toHaveValue("");
    screen.getByLabelText("Notes").remove();
    await browser.click(screen.getByRole("button", { name: "Create reminder" }));
    await waitFor(() =>
      expect(mocks.createReminder).toHaveBeenCalledWith(
        expect.objectContaining({ dueAt: null, title: "A new reminder" }),
      ),
    );

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await browser.click(screen.getByRole("button", { name: /^Test reminder Jul/ }));
    await browser.clear(screen.getByLabelText("What needs attention?"));
    await browser.type(screen.getByLabelText("What needs attention?"), "Refined reminder");
    await browser.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.updateReminder).toHaveBeenCalled());
    await browser.click(screen.getByRole("button", { name: "Complete Test reminder" }));
    await waitFor(() => expect(mocks.completeReminder).toHaveBeenCalledWith(id, true));
    await browser.click(screen.getByRole("button", { name: "Delete Test reminder" }));
    await waitFor(() => expect(mocks.deleteReminder).toHaveBeenCalledWith(id));

    await browser.click(screen.getByRole("button", { name: /^1:00 PM Focus block/ }));
    expect(await screen.findByRole("heading", { name: "Focus block" })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Edit Event" }));
    await browser.clear(screen.getByLabelText("Event"));
    await browser.type(screen.getByLabelText("Event"), "Refined focus");
    await browser.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.updateEvent).toHaveBeenCalled());

    await browser.click(screen.getByRole("button", { name: "Add" }));
    await browser.click(screen.getByRole("menuitem", { name: "Event" }));
    await browser.type(screen.getByLabelText("Event"), "New event");
    await browser.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() =>
      expect(mocks.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ title: "New event", calendarId: id }),
      ),
    );

    await browser.click(screen.getByRole("button", { name: "Add" }));
    await browser.click(screen.getByRole("menuitem", { name: "Reminder" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Cancel" }));
    await browser.click(screen.getByText("Done today"));
    await browser.click(screen.getByRole("button", { name: "Reopen Finished reminder" }));
    await waitFor(() => expect(mocks.completeReminder).toHaveBeenCalledWith(secondId, false));

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    fireEvent(window, new Event("offline"));
    expect(await screen.findByText(/Offline/)).toBeInTheDocument();
    fireEvent(window, new Event("online"));
  }, 30_000);

  it("shows an honest in-progress meeting state and a provider join action", async () => {
    mocks.getDailyBrief.mockResolvedValueOnce({
      allDay: [],
      anytime: [],
      capacity,
      generatedAt: now,
      laterToday: [],
      next: null,
      now: [
        {
          ...event,
          conferenceUrl: "https://meet.google.com/abc-defg-hij",
          endsAt: "2026-07-13T13:00:00.000Z",
          id: "77777777-7777-4777-8777-777777777777",
          startsAt: "2026-07-13T11:00:00.000Z",
          title: "Engineering Meeting",
        },
      ],
      overdue: [],
      timeZone: "UTC",
      tasks: [],
      completedTasks: [],
      today: [],
      tomorrow: [],
    });

    setup();

    expect(await screen.findByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Started 1 hr ago · 1 hr left")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join Google Meet" })).toHaveAttribute(
      "href",
      "https://meet.google.com/abc-defg-hij",
    );
    expect(screen.queryByText("In meeting")).not.toBeInTheDocument();
  });

  it("labels supported and generic conference links without inferring attendance", async () => {
    const meeting = (id: string, conferenceUrl: string, title: string) => ({
      ...event,
      conferenceUrl,
      endsAt: "2026-07-13T13:00:00.000Z",
      id,
      startsAt: "2026-07-13T11:00:00.000Z",
      title,
    });
    mocks.getDailyBrief.mockResolvedValueOnce({
      allDay: [],
      anytime: [],
      capacity,
      generatedAt: now,
      laterToday: [],
      next: null,
      now: [
        meeting("77777777-7777-4777-8777-777777777777", "https://teams.live.com/meet/123", "Teams"),
        meeting("88888888-8888-4888-8888-888888888888", "https://sub.zoom.us/j/123", "Zoom"),
        meeting("99999999-9999-4999-8999-999999999999", "https://meetings.webex.com/123", "Webex"),
        meeting("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "https://video.example.com/123", "Other"),
      ],
      overdue: [],
      timeZone: "UTC",
      tasks: [],
      completedTasks: [],
      today: [],
      tomorrow: [],
    });

    setup();

    expect(await screen.findByRole("link", { name: "Join Microsoft Teams" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join Zoom" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join Webex" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join meeting" })).toBeInTheDocument();
    expect(screen.queryByText("In meeting")).not.toBeInTheDocument();
  });

  it("toggles calendar visibility and recovers when the provider rejects it", async () => {
    let resolveVisibility: (value: typeof googleCalendar) => void = () => undefined;
    mocks.setCalendarSelected.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveVisibility = resolve;
      }),
    );
    const view = setup("/calendar");
    const browser = userEvent.setup();
    await screen.findByText("Focus block");
    const accountToggle = screen.getByRole("button", { name: "Toggle Broken Google calendars" });
    expect(accountToggle).toHaveAttribute("aria-expanded", "true");
    expect(accountToggle).toHaveAttribute("data-sidebar", "menu-button");
    expect(accountToggle.querySelector(".provider-emblem svg")).toBeInTheDocument();
    expect(document.querySelector('[data-sidebar="group-label"]')).toHaveTextContent(
      /Calendars \d+\/\d+/,
    );
    const initialGoogleToggle = screen.getByRole("checkbox", { name: /Readonly Google/ });
    expect(initialGoogleToggle).toHaveStyle({ "--calendar-color": "var(--sidebar-primary)" });
    expect(document.querySelector(".context-sidebar__calendar-dot")).not.toBeInTheDocument();
    await browser.click(accountToggle);
    expect(accountToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: /Readonly Google/ })).not.toBeInTheDocument();
    await browser.click(accountToggle);
    expect(accountToggle).toHaveAttribute("aria-expanded", "true");
    const googleToggle = screen.getByRole("checkbox", { name: /Readonly Google/ });
    const cancelQueries = vi
      .spyOn(view.queryClient, "cancelQueries")
      .mockRejectedValueOnce(new Error("Calendar cache unavailable"));
    await browser.click(googleToggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("Calendar cache unavailable");
    expect(mocks.setCalendarSelected).not.toHaveBeenCalled();
    cancelQueries.mockRestore();
    await browser.click(googleToggle);
    expect(googleToggle).toBeDisabled();
    expect(screen.getByText("Calendars 3/3")).toBeInTheDocument();
    resolveVisibility({ ...googleCalendar, isSelected: true });
    await waitFor(() => expect(mocks.setCalendarSelected).toHaveBeenCalledWith(secondId, true));

    mocks.setCalendarSelected.mockRejectedValueOnce(new Error("Visibility update failed"));
    await browser.click(screen.getByRole("checkbox", { name: /Personal/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Visibility update failed");
    expect(screen.getByRole("checkbox", { name: /Personal/ })).toBeChecked();
    view.unmount();

    mocks.listCalendars.mockResolvedValueOnce([]);
    const emptyView = setup("/calendar");
    await screen.findByRole("radio", { name: "Week", checked: true });
    expect(screen.getByText("No calendars are available.")).toBeInTheDocument();
    emptyView.unmount();

    mocks.listCalendars.mockResolvedValue([
      { ...googleCalendar, accountId: secondId },
      { ...calendar, accountId: "local-account" },
    ]);
    mocks.listConnectors.mockResolvedValue([
      {
        calendarEnabled: true,
        email: "connected@example.com",
        id: secondId,
        label: "Connected",
        lastSyncedAt: null,
        mailEnabled: false,
        provider: "google",
        syncError: null,
        syncStatus: "idle",
      },
    ]);
    const localView = setup("/calendar");
    const localToggle = await screen.findByRole("button", {
      name: "Toggle My calendars calendars",
    });
    const accountToggles = screen.getAllByRole("button", { name: /^Toggle .* calendars$/ });
    expect(accountToggles[0]).toBe(localToggle);
    localView.unmount();

    mocks.listCalendars.mockResolvedValue([
      { ...googleCalendar, accountId: "missing-connected-account" },
    ]);
    mocks.listConnectors.mockResolvedValue([]);
    const connectedView = setup("/calendar");
    expect(
      await screen.findByRole("button", { name: "Toggle Connected calendars calendars" }),
    ).toBeInTheDocument();
    connectedView.unmount();

    mocks.listCalendars.mockResolvedValue([
      { ...calendar, accountId: "icloud-account", provider: "icloud" },
    ]);
    mocks.listConnectors.mockResolvedValue([
      {
        calendarEnabled: true,
        email: "person@icloud.com",
        id: "icloud-account",
        label: "person@icloud.com",
        lastSyncedAt: null,
        mailEnabled: false,
        provider: "icloud",
        syncError: null,
        syncStatus: "idle",
      },
    ]);
    const icloudView = setup("/calendar");
    expect(
      await screen.findByRole("button", { name: "Toggle person@icloud.com calendars" }),
    ).toBeInTheDocument();
    icloudView.unmount();
  }, 15_000);

  it("renders rich event notes safely and confirms write-through deletion", async () => {
    const richEvent = {
      ...event,
      notes:
        "## Agenda\n\n- Review **launch plan**\n- Open <a href=\"https://example.com/brief\">the brief</a>\n\n<script>alert('no')</script>",
    };
    mocks.listEvents.mockResolvedValue([richEvent]);
    mocks.getDailyBrief.mockResolvedValue({
      allDay: [],
      anytime: [],
      capacity,
      generatedAt: now,
      laterToday: [richEvent],
      next: richEvent,
      now: [],
      overdue: [],
      timeZone: "UTC",
      tasks: [],
      completedTasks: [],
      today: [reminder, completedReminder],
      tomorrow: [],
    });
    const view = setup();
    const browser = userEvent.setup();
    await browser.click(await screen.findByRole("button", { name: /^1:00 PM Focus block/ }));
    expect(await screen.findByRole("heading", { name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByText("launch plan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /the brief/ })).toHaveAttribute(
      "href",
      "https://example.com/brief",
    );
    expect(view.container.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText(/stored in ilo/)).toBeInTheDocument();

    await browser.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete this event everywhere?")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Keep Event" }));
    await browser.click(screen.getByRole("button", { name: "Delete" }));
    mocks.deleteEvent.mockRejectedValueOnce(new Error("Delete failed"));
    await browser.click(screen.getByRole("button", { name: "Delete Event" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Delete failed");

    let resolveDelete: () => void = () => undefined;
    mocks.deleteEvent.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    await browser.click(screen.getByRole("button", { name: "Delete Event" }));
    expect(await screen.findByText("Deleting")).toBeInTheDocument();
    resolveDelete();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.deleteEvent).toHaveBeenCalledWith(id);
  });

  it("links one visible event to private or detailed destination blocks", async () => {
    const block = {
      calendarId: nullColorCalendar.id,
      eventId: thirdId,
      mode: "busy" as const,
      provider: "google" as const,
    };
    const linkedEvent = { ...event, blocks: [block] };
    mocks.listEvents.mockResolvedValue([linkedEvent]);
    mocks.getDailyBrief.mockResolvedValue({
      allDay: [],
      anytime: [],
      capacity,
      generatedAt: now,
      laterToday: [linkedEvent],
      next: linkedEvent,
      now: [],
      overdue: [],
      timeZone: "UTC",
      tasks: [],
      completedTasks: [],
      today: [reminder, completedReminder],
      tomorrow: [],
    });
    mocks.createEventBlock.mockResolvedValue(linkedEvent);
    mocks.updateEventBlock.mockResolvedValue({
      ...linkedEvent,
      blocks: [{ ...block, mode: "details" as const }],
    });
    mocks.deleteEventBlock.mockResolvedValue(event);
    const view = setup();
    const browser = userEvent.setup();
    await browser.click(await screen.findByRole("button", { name: /^1:00 PM Focus block/ }));
    expect(screen.getByRole("heading", { name: "Blocked time" })).toBeInTheDocument();
    expect(screen.getByText("1 linked")).toBeInTheDocument();
    const destination = screen.getByRole("checkbox", { name: /Selected Google/ });
    expect(destination).toBeChecked();
    await browser.selectOptions(screen.getByLabelText("Privacy on Selected Google"), "details");
    await waitFor(() =>
      expect(mocks.updateEventBlock).toHaveBeenCalledWith(id, thirdId, { mode: "details" }),
    );
    await browser.click(destination);
    await waitFor(() => expect(mocks.deleteEventBlock).toHaveBeenCalledWith(id, thirdId));

    mocks.createEventBlock.mockRejectedValueOnce(new Error("Block failed"));
    await browser.click(destination);
    expect(await screen.findByRole("alert")).toHaveTextContent("Block failed");
    mocks.createEventBlock.mockResolvedValue(linkedEvent);
    await browser.click(destination);
    await waitFor(() =>
      expect(mocks.createEventBlock).toHaveBeenCalledWith(id, {
        calendarId: nullColorCalendar.id,
        mode: "busy",
      }),
    );
    view.unmount();

    mocks.listEvents.mockResolvedValue([
      linkedEvent,
      { ...allDayEvent, blocks: [block], id: "88888888-8888-4888-8888-888888888888" },
    ]);
    const calendarView = setup("/calendar");
    expect(await screen.findAllByLabelText("Blocks another calendar")).toHaveLength(2);
    await browser.click(screen.getByRole("radio", { name: "Month" }));
    expect(await screen.findAllByLabelText("Blocks another calendar")).toHaveLength(2);
    calendarView.unmount();
  });

  it("describes all-day, multi-day, and overnight event ranges", async () => {
    const multiDay = {
      ...allDayEvent,
      endsAt: "2026-07-16T00:00:00.000Z",
      id: "66666666-6666-4666-8666-666666666666",
      title: "Retreat",
    };
    const overnight = {
      ...event,
      endsAt: "2026-07-14T01:00:00.000Z",
      id: "77777777-7777-4777-8777-777777777777",
      location: null,
      startsAt: "2026-07-13T23:00:00.000Z",
      title: "Overnight work",
    };
    mocks.listEvents.mockResolvedValue([allDayEvent, multiDay, overnight]);
    mocks.getDailyBrief.mockResolvedValue({
      allDay: [allDayEvent, multiDay],
      anytime: [],
      capacity,
      generatedAt: now,
      laterToday: [overnight],
      next: overnight,
      now: [],
      overdue: [],
      timeZone: "UTC",
      tasks: [],
      completedTasks: [],
      today: [reminder, completedReminder],
      tomorrow: [],
    });
    setup();
    const browser = userEvent.setup();
    await browser.click(await screen.findByRole("button", { name: /All day Quiet day/ }));
    expect(screen.getByText("Monday, July 13, 2026 · All day")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await browser.click(screen.getByRole("button", { name: /All day Retreat/ }));
    expect(
      screen.getByText("Monday, July 13, 2026 – Wednesday, July 15, 2026 · All day"),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await browser.click(screen.getByRole("button", { name: /^11:00 PM Overnight work/ }));
    expect(screen.getByText("Jul 13, 11:00 PM – Jul 14, 1:00 AM")).toBeInTheDocument();
  });

  it("reschedules writable events by drag and rolls back rejected moves", async () => {
    const readonlyEvent = {
      ...event,
      calendarId: googleCalendar.id,
      id: "55555555-5555-4555-8555-555555555555",
      provider: "google" as const,
      title: "Readonly block",
    };
    mocks.listEvents.mockResolvedValue([event, allDayEvent, readonlyEvent]);
    const view = setup("/calendar");
    await screen.findByText("Focus block");
    const focusBlock = screen.getByRole("button", { name: /^1:00 PM Focus block/ });
    const monday = screen.getByRole("region", { name: "Monday timeline" });
    const transfer = dragDataTransfer();
    fireEvent.dragOver(monday, { dataTransfer: transfer });
    fireEvent.dragStart(focusBlock, { dataTransfer: transfer });
    expect(focusBlock).toHaveAttribute("draggable", "true");
    expect(monday).toHaveClass("is-drag-target");
    Object.defineProperty(monday, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 1536, height: 1536, left: 0, right: 200, top: 0, width: 200 }),
    });
    const cancelQueries = vi
      .spyOn(view.queryClient, "cancelQueries")
      .mockRejectedValueOnce(new Error("Event cache unavailable"));
    fireEvent.dragOver(monday, { dataTransfer: transfer });
    dropCalendarEvent(monday, transfer, 640);
    expect(await screen.findByRole("alert")).toHaveTextContent("Event cache unavailable");
    expect(mocks.updateEvent).not.toHaveBeenCalled();
    cancelQueries.mockRestore();

    const successfulTransfer = dragDataTransfer();
    fireEvent.dragStart(focusBlock, { dataTransfer: successfulTransfer });
    dropCalendarEvent(monday, successfulTransfer, 640);
    await waitFor(() =>
      expect(mocks.updateEvent).toHaveBeenCalledWith(id, {
        endsAt: "2026-07-13T11:00:00.000Z",
        startsAt: "2026-07-13T10:00:00.000Z",
      }),
    );
    fireEvent.dragEnd(focusBlock, { dataTransfer: successfulTransfer });

    let rejectMove: (error: Error) => void = () => undefined;
    mocks.updateEvent.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectMove = reject;
      }),
    );
    const secondTransfer = dragDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: /^1:00 PM Focus block/ }), {
      dataTransfer: secondTransfer,
    });
    dropCalendarEvent(monday, secondTransfer, 768);
    expect(mocks.updateEvent).toHaveBeenCalled();
    rejectMove(new Error("Provider rejected move"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider rejected move");

    const callsBeforeReadonlyDrop = mocks.updateEvent.mock.calls.length;
    const readonly = screen.getByRole("button", { name: /^1:00 PM Readonly block/ });
    expect(readonly).toHaveAttribute("draggable", "false");
    const readonlyTransfer = dragDataTransfer();
    fireEvent.dragStart(readonly, { dataTransfer: readonlyTransfer });
    dropCalendarEvent(monday, readonlyTransfer, 900);
    expect(mocks.updateEvent).toHaveBeenCalledTimes(callsBeforeReadonlyDrop);
    fireEvent.click(readonly);
    expect(await screen.findByText(/write through to Google Calendar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Event" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });

    const browser = userEvent.setup();
    await browser.click(screen.getByRole("button", { name: "View Monday, July 13, 2026" }));
    const dayTimeline = screen.getByRole("region", {
      name: "24-hour schedule with 15-minute marks",
    });
    Object.defineProperty(dayTimeline, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 1536, height: 1536, left: 0, right: 400, top: 0, width: 400 }),
    });
    const dayTransfer = dragDataTransfer();
    const dayEvent = screen.getByRole("button", { name: /^1:00 PM Focus block/ });
    fireEvent.dragStart(dayEvent, { dataTransfer: dayTransfer });
    dragOverCalendarEvent(dayTimeline, dayTransfer, 704);
    expect(screen.getByRole("status")).toHaveTextContent("Drop at 11 AM");
    dragLeaveCalendarEvent(dayTimeline, dayTimeline);
    expect(screen.getByRole("status")).toHaveTextContent("Drop at 11 AM");
    dragLeaveCalendarEvent(dayTimeline, null);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    dragOverCalendarEvent(dayTimeline, dayTransfer, 704);
    dropCalendarEvent(dayTimeline, dayTransfer, 704);
    await waitFor(() =>
      expect(mocks.updateEvent).toHaveBeenCalledTimes(callsBeforeReadonlyDrop + 1),
    );
    fireEvent.contextMenu(dayTimeline, { clientY: 704 });
    expect(await screen.findByRole("menuitem", { name: "New event here" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Paste event" })).toBeEnabled();
    await browser.keyboard("{Escape}");
    fireEvent.contextMenu(dayEvent);
    expect(await screen.findByRole("menuitem", { name: "Copy event" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete event" })).toBeInTheDocument();
    await browser.keyboard("{Escape}");

    await browser.click(screen.getByRole("radio", { name: "Month" }));
    const allDay = await screen.findByRole("button", { name: "All day Quiet day" });
    const targetDay = screen
      .getByRole("button", { name: "View Tuesday, July 14, 2026" })
      .closest("section") as HTMLElement;
    const monthTransfer = dragDataTransfer(false);
    fireEvent.dragOver(targetDay, { dataTransfer: monthTransfer });
    fireEvent.dragStart(allDay, { dataTransfer: monthTransfer });
    fireEvent.dragOver(targetDay, { dataTransfer: monthTransfer });
    dropCalendarEvent(targetDay, monthTransfer);
    await waitFor(() =>
      expect(mocks.updateEvent).toHaveBeenCalledWith(secondId, {
        endsAt: "2026-07-15T00:00:00.000Z",
        startsAt: "2026-07-14T00:00:00.000Z",
      }),
    );
    fireEvent.dragEnd(allDay, { dataTransfer: monthTransfer });
    view.unmount();
  }, 15_000);

  it("navigates calendar, reminders, activity, and settings workflows", async () => {
    setup("/calendar");
    const browser = userEvent.setup();
    expect(await screen.findByRole("radio", { name: "Week", checked: true })).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Top navigation" })).queryByRole("heading"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Calendar controls" })).toBeInTheDocument();
    await screen.findByText("Focus block");
    expect(screen.getByText("Calendars 2/3")).toBeInTheDocument();
    expect(document.querySelector(".context-sidebar__calendar-count")).toBeInTheDocument();
    expect(document.querySelector('[aria-current="date"]')).toBeInTheDocument();
    const weekCalendar = document.querySelector(".week-calendar") as HTMLDivElement;
    const weekToday = weekCalendar.querySelector(
      'button[aria-current="date"]',
    ) as HTMLButtonElement;
    Object.defineProperty(weekCalendar, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(weekCalendar, "clientWidth", { configurable: true, value: 900 });
    Object.defineProperty(weekCalendar, "scrollLeft", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(weekCalendar, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 400, height: 400, left: 0, right: 900, top: 0, width: 900 }),
    });
    Object.defineProperty(weekToday, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 30, height: 30, left: 760, right: 800, top: 0, width: 40 }),
    });
    await browser.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(weekCalendar.scrollLeft).toBeGreaterThan(0));
    const todayButton = screen.getByRole("button", { name: "Today" });
    expect(todayButton).toHaveAttribute("aria-pressed", "true");
    expect(todayButton).toHaveAttribute("data-following", "true");
    fireEvent.scroll(weekCalendar, { target: { scrollTop: 0 } });
    await waitFor(() => expect(todayButton).toHaveAttribute("aria-pressed", "false"));
    fireEvent.scroll(weekCalendar, { target: { scrollTop: 0 } });
    expect(screen.getByText("12 AM")).toBeInTheDocument();
    expect(screen.getByText("11 PM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Weekends", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Current time"),
    );
    const focusBlock = screen.getByRole("button", { name: /^1:00 PM Focus block/ });
    expect(focusBlock).toHaveStyle({ height: "64px", top: "832px" });
    await browser.click(screen.getByRole("button", { name: "Weekends", pressed: true }));
    expect(screen.getByRole("button", { name: "Weekends", pressed: false })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View Sunday, July 19, 2026" }),
    ).not.toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Weekends", pressed: false }));
    expect(screen.getByRole("button", { name: "Weekends", pressed: true })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "All day Quiet day" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await browser.click(screen.getByRole("button", { name: "New event" }));
    await browser.click(screen.getByRole("button", { name: "Cancel" }));
    await browser.click(screen.getByRole("button", { name: /^1:00 PM Focus block/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    const datePicker = screen.getByRole("region", { name: "Calendar date picker" });
    await browser.click(within(datePicker).getByLabelText("Choose the month"));
    await browser.click(screen.getByRole("menuitem", { name: "July" }));
    expect(
      within(screen.getByRole("region", { name: "Calendar date picker" })).getByLabelText(
        "Choose the month",
      ),
    ).toHaveTextContent("July");
    await browser.click(within(datePicker).getByLabelText("Choose the year"));
    await browser.click(screen.getByRole("menuitem", { name: "2027" }));
    expect(within(datePicker).getByLabelText("Choose the year")).toHaveTextContent("2027");
    await browser.click(within(datePicker).getByLabelText("Choose the year"));
    await browser.click(screen.getByRole("menuitem", { name: "2026" }));
    const firstCalendarDay = screen
      .getAllByRole("button")
      .find((button) => button.getAttribute("aria-label")?.startsWith("View "));
    expect(firstCalendarDay).toBeDefined();
    await browser.click(firstCalendarDay as HTMLButtonElement);
    expect(await screen.findByRole("radio", { name: "Day", checked: true })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "24-hour schedule with 15-minute marks" }),
    ).toBeInTheDocument();
    const anotherDate = [
      ...screen
        .getByRole("region", { name: "Calendar date picker" })
        .querySelectorAll<HTMLButtonElement>("button[data-day]"),
    ].find((button) => button.dataset.selectedSingle !== "true");
    expect(anotherDate).toBeDefined();
    await browser.click(anotherDate as HTMLButtonElement);
    expect(
      await screen.findByRole("region", { name: "24-hour schedule with 15-minute marks" }),
    ).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByText("Now")).toBeInTheDocument();
    const dayTimelineScroll = document.querySelector(".calendar-timeline-scroll") as HTMLDivElement;
    Object.defineProperty(dayTimelineScroll, "clientHeight", { configurable: true, value: 400 });
    fireEvent.scroll(dayTimelineScroll, { target: { scrollTop: 0 } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    fireEvent.scroll(dayTimelineScroll, { target: { scrollTop: 0 } });
    await browser.click(screen.getByRole("radio", { name: "Week" }));
    await browser.click(
      within(datePicker).getByRole("button", { name: "Wednesday, July 29th, 2026" }),
    );
    expect(await screen.findByRole("region", { name: "Wednesday timeline" })).toBeInTheDocument();

    mocks.listEvents.mockResolvedValue([
      event,
      allDayEvent,
      {
        ...event,
        id: thirdId,
        title: "Planning",
        location: null,
        startsAt: "2026-07-12T23:30:00.000Z",
        endsAt: "2026-07-13T00:30:00.000Z",
      },
      {
        ...event,
        id: "44444444-4444-4444-8444-444444444444",
        title: "Review",
        startsAt: "2026-07-13T23:30:00.000Z",
        endsAt: "2026-07-14T00:30:00.000Z",
      },
    ]);
    await browser.click(screen.getByRole("radio", { name: "Month" }));
    expect(await screen.findByText("+1 more")).toBeInTheDocument();
    await browser.click(
      within(screen.getByRole("region", { name: "Calendar date picker" })).getByRole("button", {
        name: "Go to the Previous Month",
      }),
    );
    await browser.click(
      within(screen.getByRole("region", { name: "Calendar date picker" })).getByRole("button", {
        name: "Go to the Next Month",
      }),
    );
    await browser.click(screen.getByRole("button", { name: "All day Quiet day" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await browser.click(screen.getByRole("button", { name: "View Monday, July 13, 2026" }));
    expect(await screen.findByRole("radio", { name: "Day", checked: true })).toBeInTheDocument();

    await browser.click(screen.getAllByRole("link", { name: "Reminders" })[0] as HTMLElement);
    expect(await screen.findByRole("heading", { name: "Reminders" })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Add" }));
    await browser.click(screen.getByRole("menuitem", { name: "Reminder" }));
    await browser.click(screen.getByRole("button", { name: "Cancel" }));
    await browser.click(screen.getByRole("link", { name: "Completed" }));
    expect(await screen.findByRole("heading", { name: "Completed reminders" })).toBeInTheDocument();
    await browser.click(screen.getByRole("link", { name: "Open" }));
    expect(await screen.findByRole("heading", { name: "Reminders" })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: /^Test reminder Jul/ }));
    await browser.click(screen.getByRole("button", { name: "Cancel" }));

    await browser.click(screen.getByRole("button", { name: "Account menu" }));
    await browser.click(screen.getByRole("menuitem", { name: "Activity" }));
    expect(await screen.findByText("Reminder · created")).toBeInTheDocument();
    expect(screen.getByText(/Agent ·/)).toBeInTheDocument();
    expect(screen.getByText(/Connector ·/)).toBeInTheDocument();
    expect(screen.getByText(/System ·/)).toBeInTheDocument();
    expect(screen.getByText(/You ·/)).toBeInTheDocument();
    const activitySearch = screen.getByRole("searchbox", { name: "Search activity" });
    await browser.type(activitySearch, "system");
    expect(await screen.findByText(/System ·/)).toBeInTheDocument();
    expect(screen.queryByText(/Agent ·/)).not.toBeInTheDocument();
    await browser.clear(activitySearch);
    expect(await screen.findByText(/Agent ·/)).toBeInTheDocument();
    await browser.type(activitySearch, "no matching audit material");
    expect(await screen.findByText("No matching activity")).toBeInTheDocument();
    await browser.clear(activitySearch);

    await browser.click(screen.getByRole("button", { name: "Account menu" }));
    await browser.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    const settingsSidebar = screen.getByRole("complementary", { name: "Settings Sidebar" });
    const settingsNavigation = within(settingsSidebar);
    expect(settingsNavigation.queryByRole("link", { name: "Invitations" })).not.toBeInTheDocument();
    await browser.click(settingsNavigation.getByRole("link", { name: "Calendars" }));
    await browser.click(screen.getByRole("checkbox", { name: "Hide Personal" }));
    await waitFor(() => expect(mocks.setCalendarSelected).toHaveBeenCalledWith(id, false));
    await browser.click(screen.getByRole("button", { name: "Delete Personal" }));
    await waitFor(() => expect(mocks.deleteCalendar).toHaveBeenCalledWith(id, expect.anything()));
    await browser.click(screen.getByRole("button", { name: "Local calendar" }));
    await browser.type(screen.getByLabelText("Calendar name"), "Side project");
    await browser.click(screen.getByRole("button", { name: "Create calendar" }));
    await waitFor(() => expect(mocks.createCalendar).toHaveBeenCalled());

    await browser.click(settingsNavigation.getByRole("link", { name: "Connections" }));
    await browser.click(screen.getByRole("button", { name: "Sync Google" }));
    await waitFor(() =>
      expect(mocks.syncConnector).toHaveBeenCalledWith(secondId, expect.anything()),
    );
    await browser.click(screen.getByRole("button", { name: "Disconnect Google" }));
    await waitFor(() =>
      expect(mocks.deleteConnector).toHaveBeenCalledWith(secondId, expect.anything()),
    );

    await browser.click(settingsNavigation.getByRole("link", { name: "Agent access" }));
    expect(await screen.findByDisplayValue("https://mcp.example.com/mcp")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Set up a local token" }));
    await browser.clear(screen.getByLabelText("Token name"));
    expect(screen.getByRole("button", { name: "Create local token" })).toBeDisabled();
    await browser.type(screen.getByLabelText("Token name"), "Codex morning");
    await browser.click(screen.getByRole("radio", { name: /Daily brief/ }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /Daily brief/ })).toHaveAttribute(
        "data-state",
        "on",
      ),
    );
    await browser.click(screen.getByText(/Fine-tune permissions/));
    await browser.click(screen.getByLabelText("Read mail"));
    await browser.click(screen.getByRole("button", { name: "Create local token" }));
    await waitFor(() =>
      expect(mocks.createAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Codex morning" }),
      ),
    );
    expect(await screen.findByText("pos_secret")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Dismiss token" }));
    await browser.click(screen.getByRole("button", { name: "Revoke Active agent" }));
    await waitFor(() =>
      expect(mocks.deleteAccessToken).toHaveBeenCalledWith(id, expect.anything()),
    );
    await browser.click(settingsNavigation.getByRole("link", { name: "Profile" }));
    await browser.clear(screen.getByLabelText("First name"));
    await browser.type(screen.getByLabelText("First name"), "Updated");
    await browser.clear(screen.getByLabelText("Last name"));
    await browser.type(screen.getByLabelText("Last name"), "profile");
    await browser.selectOptions(screen.getByLabelText("Planning time zone"), "America/Chicago");
    await browser.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith({
        displayName: "Updated profile",
        email: user.email,
        planningTimezone: "America/Chicago",
        homeLocation: null,
        workdayEndMinute: 17 * 60,
        workdayStartMinute: 9 * 60,
      }),
    );
    await browser.click(settingsNavigation.getByRole("link", { name: "Appearance" }));
    expect(screen.queryByRole("radiogroup", { name: "Accent color" })).not.toBeInTheDocument();
    await browser.click(screen.getByRole("radio", { name: "Dark" }));
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ theme: "dark" }));
    mocks.updateUser.mockRejectedValueOnce(new Error("Appearance unavailable"));
    await browser.click(screen.getByRole("radio", { name: "Light" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Appearance unavailable");
    await browser.click(settingsNavigation.getByRole("link", { name: "Sessions" }));
    await browser.click(
      screen.getAllByRole("button", { name: "Revoke session" })[0] as HTMLElement,
    );
    await waitFor(() => expect(mocks.revokeSession).toHaveBeenCalled());
    await browser.click(settingsNavigation.getByRole("link", { name: "Connections" }));
    await browser.click(screen.getByRole("button", { name: "Connect" }));
    await browser.click(screen.getByRole("menuitem", { name: "Google" }));
    await waitFor(() => expect(mocks.getGoogleAuthorizationUrl).toHaveBeenCalled());
    let resolveLogout: (() => void) | undefined;
    mocks.logout.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    await browser.click(screen.getByRole("button", { name: "Account menu" }));
    await browser.click(screen.getByRole("menuitem", { name: "Log out" }));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalled());
    expect(screen.getByRole("menuitem", { name: "Signing out…" })).toHaveAttribute(
      "data-disabled",
      "",
    );
    resolveLogout?.();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Log out" })).toBeEnabled());
  }, 30_000);

  it("defaults to a compact calendar view on small screens and preserves view navigation", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn(),
      }),
    });
    const view = setup("/calendar");
    const browser = userEvent.setup();
    expect(await screen.findByRole("radio", { name: "Day", checked: true })).toBeInTheDocument();
    await browser.click(screen.getByRole("radio", { name: "Week" }));
    expect(await screen.findByRole("radio", { name: "Week", checked: true })).toBeInTheDocument();
    await browser.click(screen.getByRole("radio", { name: "Day" }));
    expect(await screen.findByRole("radio", { name: "Day", checked: true })).toBeInTheDocument();
    view.unmount();
    mocks.listEvents.mockResolvedValue([event]);
    const singularView = setup("/calendar?view=day&date=2026-07-13");
    expect(await screen.findByRole("button", { name: /^1:00 PM Focus block/ })).toBeInTheDocument();
    singularView.unmount();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  }, 10_000);

  it("follows a system appearance change for system-mode accounts", async () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      addEventListener: vi.fn((_type: string, callback: (event: MediaQueryListEvent) => void) => {
        listeners.add(callback);
      }),
      matches: false,
      removeEventListener: vi.fn(
        (_type: string, callback: (event: MediaQueryListEvent) => void) => {
          listeners.delete(callback);
        },
      ),
    };
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(media));
    const view = setup("/settings?section=appearance");
    await screen.findByRole("heading", { name: "Appearance" });
    expect(document.documentElement).not.toHaveClass("dark");

    media.matches = true;
    for (const listener of listeners) listener(new Event("change") as MediaQueryListEvent);
    expect(document.documentElement).toHaveClass("dark");

    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    mocks.getMe.mockResolvedValue({ ...user, theme: "dark" });
    const fixedView = setup("/settings?section=appearance");
    await screen.findByRole("heading", { name: "Appearance" });
    expect(document.documentElement).toHaveClass("dark");
    fixedView.unmount();
  });

  it("opens both global creation paths and groups repeated agent activity", async () => {
    mocks.listActivity.mockResolvedValue([
      {
        id: "1",
        action: "reminder.created",
        actorId: id,
        actorType: "agent",
        before: null,
        after: {},
        createdAt: now,
        entityId: id,
        entityType: "reminder",
        requestId: "batch-request",
      },
      {
        id: "2",
        action: "reminder.created",
        actorId: id,
        actorType: "agent",
        before: null,
        after: {},
        createdAt: now,
        entityId: secondId,
        entityType: "reminder",
        requestId: "batch-request",
      },
    ]);
    const view = setup();
    const browser = userEvent.setup();
    await screen.findByRole("heading", { name: "Your commitments" });
    await browser.click(screen.getByRole("button", { name: "Add" }));
    await browser.click(screen.getByRole("menuitem", { name: "Task" }));
    expect(await screen.findByRole("heading", { name: "Capture a task" })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Cancel" }));
    await browser.click(screen.getByRole("button", { name: "Add" }));
    await browser.click(screen.getByRole("menuitem", { name: /Event/ }));
    expect(
      await screen.findByRole("heading", { name: "Shape a block of time" }),
    ).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Cancel" }));
    await browser.click(screen.getByRole("button", { name: "Account menu" }));
    await browser.click(screen.getByRole("menuitem", { name: "Activity" }));
    expect(await screen.findByText(/Agent · 2 changes/)).toBeInTheDocument();
    expect(screen.getAllByText("Reminder · created")).toHaveLength(3);
    view.unmount();
  });

  it("reads, filters, and synchronizes the unified mailbox", async () => {
    mocks.listMailMessages.mockImplementation(async (threadId: string) =>
      threadId === secondMailThread.id
        ? []
        : [
            {
              attachments: [
                {
                  contentType: "application/pdf",
                  filename: "brief.pdf",
                  id: "attachment",
                  size: 42,
                },
              ],
              bodyText: "Hello there. This is the full message.",
              cc: [],
              from: mailThread.from,
              id: "message-1",
              receivedAt: now,
              threadId: mailThread.id,
              to: mailThread.to,
            },
          ],
    );
    const view = setup("/mail");
    const browser = userEvent.setup();
    const topNavigation = await screen.findByRole("navigation", { name: "Top navigation" });
    expect(within(topNavigation).queryByRole("heading")).not.toBeInTheDocument();
    const composeButton = within(topNavigation).getByRole("button", { name: "Compose" });
    expect(composeButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText("Search conversations")).not.toBeInTheDocument();
    expect(screen.queryByText("Unified mail · synced every five minutes")).not.toBeInTheDocument();
    await browser.click(await screen.findByRole("button", { name: /Project update/ }));
    expect(
      await screen.findByText("Hello Example User. This is the full message."),
    ).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Attachments" })).toHaveTextContent("brief.pdf");
    expect(screen.getByLabelText("Starred")).toBeInTheDocument();
    expect(screen.getByText("2 messages")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Mark conversation read" }));
    await waitFor(() =>
      expect(mocks.updateMailThread).toHaveBeenCalledWith(mailThread.id, { unread: false }),
    );
    await browser.click(screen.getByRole("button", { name: "Unstar conversation" }));
    await waitFor(() =>
      expect(mocks.updateMailThread).toHaveBeenCalledWith(mailThread.id, { starred: false }),
    );
    await browser.click(screen.getByRole("button", { name: "Archive conversation" }));
    await waitFor(() =>
      expect(mocks.updateMailThread).toHaveBeenCalledWith(mailThread.id, { mailboxIds: [] }),
    );
    await browser.click(screen.getByRole("button", { name: "Snooze conversation until tomorrow" }));
    await waitFor(() =>
      expect(mocks.snoozeMailThread).toHaveBeenCalledWith(mailThread.id, expect.any(String)),
    );
    await browser.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByLabelText("To")).toHaveValue("ada@example.com");
    expect(screen.getByLabelText("Subject")).toHaveValue("Re: Project update");
    await browser.click(screen.getByRole("button", { name: "Discard" }));
    await browser.click(composeButton);
    expect(composeButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("To")).toBeInTheDocument();
    await browser.click(composeButton);
    expect(composeButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText("To")).not.toBeInTheDocument();
    await browser.click(composeButton);
    await browser.type(screen.getByLabelText("To"), "to@example.com");
    await browser.type(screen.getByLabelText("Subject"), "Subject");
    await browser.type(screen.getByLabelText("Message"), "Hello");
    await browser.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(mocks.createMailDraft).toHaveBeenCalledWith({
        accountId: secondId,
        body: "Hello",
        cc: [],
        subject: "Subject",
        to: [{ address: "to@example.com", name: null }],
      }),
    );
    await waitFor(() => expect(composeButton).toHaveAttribute("aria-pressed", "false"));
    await browser.click(composeButton);
    await browser.type(await screen.findByLabelText("To"), "to@example.com");
    await browser.type(screen.getByLabelText("Subject"), "Subject");
    await browser.type(screen.getByLabelText("Message"), "Hello");
    await browser.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(mocks.sendMail).toHaveBeenCalledWith({
        accountId: secondId,
        body: "Hello",
        cc: [],
        subject: "Subject",
        to: [{ address: "to@example.com", name: null }],
      }),
    );

    await browser.click(screen.getByRole("button", { name: /No body/ }));
    expect(
      await screen.findByText("This message has no plain-text body.", {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
    await browser.type(screen.getByLabelText("Search mail"), "Project");
    await browser.keyboard("{Enter}");
    await waitFor(() =>
      expect(mocks.listMailThreads).toHaveBeenCalledWith(
        expect.objectContaining({ query: "Project" }),
      ),
    );
    await browser.click(
      within(screen.getByRole("navigation", { name: "Top navigation" })).getByRole("button", {
        name: "Unread",
      }),
    );
    await waitFor(() =>
      expect(mocks.listMailThreads).toHaveBeenCalledWith(expect.objectContaining({ unread: true })),
    );
    const mailboxButtons = within(
      screen.getByRole("navigation", { name: "Mailboxes" }),
    ).getAllByRole("button", { name: /^Inbox/ });
    await browser.click(mailboxButtons.at(-1) as HTMLElement);
    await waitFor(() =>
      expect(mocks.listMailThreads).toHaveBeenCalledWith(
        expect.objectContaining({ mailboxId: mailbox.id }),
      ),
    );
    await browser.click(screen.getByRole("button", { name: /Unified inbox/ }));
    await browser.click(screen.getByRole("button", { name: "Sync all mail accounts" }));
    await waitFor(() => expect(mocks.syncConnector).toHaveBeenCalledWith(secondId));
    view.unmount();
  }, 10_000);

  it("keeps uncertain draft recovery human-readable and keyboard-accessible", async () => {
    const recentAndReconcileDrafts = [
      {
        accountId: secondId,
        body: "Private body",
        cc: [],
        createdAt: now,
        id,
        reconciliationState: "sent_mail_review_required" as const,
        sendClaimedAt: now,
        sendStatus: "reconcile",
        sentAt: null,
        subject: "Quarterly reply",
        threadId: null,
        to: [{ address: "to@example.com", name: null }],
        updatedAt: now,
      },
      {
        accountId: secondId,
        body: "Another body",
        cc: [],
        createdAt: now,
        id: secondId,
        reconciliationState: "in_progress" as const,
        sendClaimedAt: now,
        sendStatus: "sending",
        sentAt: null,
        subject: "Travel details",
        threadId: null,
        to: [{ address: "to@example.com", name: null }],
        updatedAt: now,
      },
    ];
    mocks.listMailDrafts.mockResolvedValueOnce(recentAndReconcileDrafts).mockResolvedValue([
      {
        ...recentAndReconcileDrafts[1],
        reconciliationState: "sent_mail_review_required",
      },
    ]);
    mocks.reconcileMailDraft.mockResolvedValue({ id, sendStatus: "sent" });
    setup("/mail");
    const browser = userEvent.setup();
    const recovery = await screen.findByRole("region", { name: "Resolve an uncertain send" });
    expect(recovery).toHaveTextContent("First inspect this account’s provider Sent Mail");
    expect(
      within(recovery).queryByRole("button", {
        name: "It was not sent: Travel details",
      }),
    ).not.toBeInTheDocument();
    expect(within(recovery).getByText("Waiting for the provider result…")).toBeInTheDocument();
    await browser.click(
      within(recovery).getByRole("button", {
        name: "I found it in Sent Mail: Quarterly reply",
      }),
    );
    await waitFor(() =>
      expect(mocks.reconcileMailDraft).toHaveBeenCalledWith(id, { outcome: "sent" }),
    );
    await browser.click(
      await within(recovery).findByRole("button", {
        name: "It was not sent: Travel details",
      }),
    );
    await waitFor(() =>
      expect(mocks.reconcileMailDraft).toHaveBeenCalledWith(secondId, {
        outcome: "not_sent",
      }),
    );
    expect(mocks.reconcileMailDraft).toHaveBeenCalledTimes(2);
  });

  it("keeps uncertain send recovery errors visible without hiding the draft", async () => {
    mocks.listMailDrafts.mockResolvedValue([
      {
        accountId: secondId,
        body: "Untitled body",
        cc: [],
        createdAt: now,
        id,
        reconciliationState: "sent_mail_review_required",
        sendClaimedAt: now,
        sendStatus: "reconcile",
        sentAt: null,
        subject: "",
        threadId: null,
        to: [{ address: "to@example.com", name: null }],
        updatedAt: now,
      },
    ]);
    mocks.reconcileMailDraft.mockRejectedValueOnce(new Error("Recovery unavailable"));
    setup("/mail");
    const browser = userEvent.setup();

    const recovery = await screen.findByRole("region", { name: "Resolve an uncertain send" });
    expect(within(recovery).getByText("(No subject)")).toBeInTheDocument();
    await browser.click(
      within(recovery).getByRole("button", {
        name: "I found it in Sent Mail: this message",
      }),
    );
    expect(await within(recovery).findByRole("alert")).toHaveTextContent("Recovery unavailable");
    expect(
      within(recovery).getByRole("button", {
        name: "It was not sent: this message",
      }),
    ).toBeInTheDocument();
  });

  it("shows progress and query failures while checking uncertain sends", async () => {
    let rejectDrafts: ((error: Error) => void) | undefined;
    mocks.listMailDrafts.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectDrafts = reject;
        }),
    );
    setup("/mail");

    expect(await screen.findByText("Checking uncertain sends…")).toBeInTheDocument();
    rejectDrafts?.(new Error("Draft recovery unavailable"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Draft recovery unavailable");
  });

  it("keeps uncertain send recovery visible without an enabled Mail connector", async () => {
    mocks.listConnectors.mockResolvedValue([]);
    mocks.listMailDrafts.mockResolvedValue([
      {
        accountId: secondId,
        body: "Disconnected body",
        cc: [],
        createdAt: now,
        id,
        reconciliationState: "sent_mail_review_required",
        sendClaimedAt: now,
        sendStatus: "reconcile",
        sentAt: null,
        subject: "Disconnected send",
        threadId: null,
        to: [{ address: "to@example.com", name: null }],
        updatedAt: now,
      },
    ]);
    setup("/mail");
    expect(
      await screen.findByRole("region", { name: "Resolve an uncertain send" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Connect a mailbox")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "I found it in Sent Mail: Disconnected send",
      }),
    ).toBeInTheDocument();
  });

  it("moves a conversation to the account trash", async () => {
    const trash = {
      ...mailbox,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Trash",
      role: "trash" as const,
    };
    mocks.listMailboxes.mockResolvedValue([mailbox, trash]);
    setup("/mail");
    const browser = userEvent.setup();
    await browser.click(await screen.findByRole("button", { name: /Project update/ }));
    await browser.click(screen.getByRole("button", { name: "Move conversation to trash" }));
    await waitFor(() =>
      expect(mocks.updateMailThread).toHaveBeenCalledWith(mailThread.id, {
        mailboxIds: [trash.id],
      }),
    );
  });

  it("keeps an existing reply subject when replying", async () => {
    mocks.listMailThreads.mockResolvedValue([{ ...mailThread, subject: "Re: Project update" }]);
    setup("/mail");
    const browser = userEvent.setup();
    await browser.click(await screen.findByRole("button", { name: /Re: Project update/ }));
    await browser.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByLabelText("Subject")).toHaveValue("Re: Project update");
  });

  it("presents provider mailboxes as friendly, collapsible account groups", async () => {
    const iCloudAccountId = "88888888-8888-4888-8888-888888888880";
    const unnamedAccountId = "88888888-8888-4888-8888-888888888890";
    mocks.listConnectors.mockResolvedValue([
      ...(await mocks.listConnectors()),
      {
        calendarEnabled: false,
        email: "icloud@example.com",
        id: iCloudAccountId,
        label: "",
        lastSyncedAt: null,
        mailEnabled: true,
        provider: "icloud",
        syncError: null,
        syncStatus: "idle",
      },
      {
        calendarEnabled: false,
        email: null,
        id: unnamedAccountId,
        label: "",
        lastSyncedAt: null,
        mailEnabled: true,
        provider: "icloud",
        syncError: null,
        syncStatus: "idle",
      },
    ]);
    mocks.listMailboxes.mockResolvedValue([
      mailbox,
      {
        ...mailbox,
        id: "88888888-8888-4888-8888-888888888881",
        name: "CATEGORY_PERSONAL",
        role: "archive",
        unreadCount: 2,
      },
      {
        ...mailbox,
        id: "88888888-8888-4888-8888-888888888882",
        name: "CATEGORY_PROMOTIONS",
        role: "custom",
        unreadCount: 0,
      },
      {
        ...mailbox,
        id: "88888888-8888-4888-8888-888888888883",
        name: "project_alpha",
        role: "custom",
        unreadCount: 0,
      },
      {
        ...mailbox,
        id: "88888888-8888-4888-8888-888888888884",
        name: "team_alpha",
        role: "custom",
        unreadCount: 0,
      },
      {
        ...mailbox,
        id: "88888888-8888-4888-8888-888888888885",
        name: "Outbound",
        role: "sent",
        unreadCount: 0,
      },
      {
        ...mailbox,
        id: "88888888-8888-4888-8888-888888888886",
        name: "Working copies",
        role: "drafts",
        unreadCount: 0,
      },
      {
        ...mailbox,
        id: "88888888-8888-4888-8888-888888888887",
        name: "Stored",
        role: "archive",
        unreadCount: 0,
      },
      {
        ...mailbox,
        id: "88888888-8888-4888-8888-888888888888",
        name: "Junk",
        role: "spam",
        unreadCount: 0,
      },
      {
        ...mailbox,
        id: "88888888-8888-4888-8888-888888888889",
        name: "Deleted",
        role: "trash",
        unreadCount: 0,
      },
      {
        ...mailbox,
        accountId: iCloudAccountId,
        id: "99999999-9999-4999-8999-999999999991",
        name: "Reference",
        provider: "icloud",
        role: "custom",
        unreadCount: 0,
      },
    ]);
    mocks.listMailThreads.mockResolvedValue([
      mailThread,
      secondMailThread,
      {
        ...mailThread,
        accountId: iCloudAccountId,
        from: { address: "apple@example.com", name: "Apple sender" },
        id: "99999999-9999-4999-8999-999999999992",
        provider: "icloud",
        subject: "iCloud note",
        to: [],
      },
    ]);
    setup("/mail");
    const browser = userEvent.setup();

    expect(await screen.findByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Promotions")).toBeInTheDocument();
    expect(screen.queryByText("CATEGORY_PERSONAL")).not.toBeInTheDocument();
    const accountToggle = screen.getByRole("button", { name: /Google Google Mail/ });
    expect(accountToggle).toHaveAttribute("aria-expanded", "true");

    await browser.click(accountToggle);
    expect(accountToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Primary")).not.toBeInTheDocument();
    await browser.click(accountToggle);
    await browser.click(screen.getByText("Labels"));
    expect(screen.getByRole("button", { name: "Project Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drafts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    await browser.click(
      within(screen.getByRole("navigation", { name: "Mailboxes" })).getByText("More"),
    );
    expect(screen.getByRole("button", { name: "Spam" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trash" })).toBeInTheDocument();

    await browser.click(screen.getAllByRole("button", { name: "All mail" })[0] as HTMLElement);
    expect(
      within(screen.getByRole("navigation", { name: "Top navigation" })).queryByRole("heading"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.listMailThreads).toHaveBeenCalledWith(
        expect.objectContaining({ accountIds: [secondId] }),
      ),
    );
    const topNavigation = screen.getByRole("navigation", { name: "Top navigation" });
    await browser.click(within(topNavigation).getByRole("button", { name: "Unread" }));
    await browser.click(within(topNavigation).getByRole("button", { name: "Unread" }));
    const search = screen.getByLabelText("Search mail");
    await browser.clear(search);
    await browser.keyboard("{Enter}");

    await browser.click(screen.getByRole("button", { name: /iCloud note/ }));
    expect((await screen.findAllByText("iCloud Mail")).length).toBeGreaterThan(0);
    expect(screen.getByText("You")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Inbox" }));

    const iCloudToggle = screen.getByRole("button", { name: /icloud@example.com iCloud Mail/ });
    await browser.click(iCloudToggle);
    await browser.click(screen.getAllByRole("button", { name: "All mail" })[1] as HTMLElement);
    expect(
      within(screen.getByRole("navigation", { name: "Top navigation" })).queryByRole("heading"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Connected account iCloud Mail/ }),
    ).toBeInTheDocument();
  });

  it("loads a mail conversation addressed directly by URL", async () => {
    const deepLinkedId = "99999999-9999-4999-8999-999999999999";
    mocks.getMailThread.mockResolvedValue({ ...mailThread, id: deepLinkedId });
    mocks.listMailMessages.mockResolvedValue([
      {
        attachments: [],
        bodyText: mailThread.bodyText,
        cc: [],
        from: mailThread.from,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        receivedAt: now,
        threadId: deepLinkedId,
        to: mailThread.to,
      },
    ]);
    setup(`/mail?thread=${deepLinkedId}`);
    expect(
      await screen.findByText("Hello Example User. This is the full message."),
    ).toBeInTheDocument();
    expect(mocks.getMailThread).toHaveBeenCalledWith(deepLinkedId);
  });

  it("deduplicates the thread summary while retaining distinct provider messages", async () => {
    mocks.listMailMessages.mockResolvedValue([
      {
        attachments: [],
        bodyText: mailThread.bodyText,
        cc: [],
        from: mailThread.from,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        receivedAt: now,
        threadId: mailThread.id,
        to: mailThread.to,
      },
      {
        attachments: [],
        bodyText: "A distinct provider message.",
        cc: [],
        from: mailThread.from,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        receivedAt: now,
        threadId: mailThread.id,
        to: mailThread.to,
      },
    ]);
    setup(`/mail?thread=${mailThread.id}`);

    expect(await screen.findByText("A distinct provider message.")).toBeInTheDocument();
    expect(screen.getByText(mailThread.bodyText)).toBeInTheDocument();
  });

  it("sets up iCloud services and upgrades Google Mail permissions", async () => {
    mocks.listConnectors.mockResolvedValue([
      ...(await mocks.listConnectors()),
      {
        calendarEnabled: true,
        email: "person@icloud.com",
        id: "88888888-8888-4888-8888-888888888888",
        label: "person@icloud.com",
        lastSyncedAt: null,
        mailEnabled: true,
        provider: "icloud",
        syncError: null,
        syncStatus: "idle",
      },
    ]);
    setup("/settings");
    const browser = userEvent.setup();
    await browser.click(await findSettingsLink("Connections"));
    await browser.click(
      await screen.findByRole("button", { name: "Enable Mail for Broken Google" }),
    );
    await waitFor(() =>
      expect(mocks.getGoogleAuthorizationUrl).toHaveBeenCalledWith({ accountId: thirdId }),
    );

    await browser.click(screen.getByRole("button", { name: "Connect" }));
    await browser.click(screen.getByRole("menuitem", { name: "iCloud" }));
    expect(
      await screen.findByText(/app-specific password—not your Apple Account password/),
    ).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Apple Account email")).not.toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Connect" }));
    await browser.click(screen.getByRole("menuitem", { name: "iCloud" }));
    await browser.type(screen.getByLabelText("Apple Account email"), "test@icloud.com");
    await browser.type(screen.getByLabelText("App-specific password"), "xxxx-xxxx");
    await browser.click(screen.getByRole("checkbox", { name: /Calendar/ }));
    await browser.click(screen.getByRole("button", { name: "Add iCloud" }));
    await waitFor(() =>
      expect(mocks.connectICloud).toHaveBeenCalledWith({
        appSpecificPassword: "xxxx-xxxx",
        calendar: false,
        email: "test@icloud.com",
        mail: true,
      }),
    );
    expect(screen.getAllByText("person@icloud.com").length).toBeGreaterThan(0);
  });

  it("renders mailbox loading, empty, and error alternatives", async () => {
    mocks.listConnectors.mockResolvedValueOnce([]);
    const emptyAccountView = setup("/mail");
    expect(await screen.findByText("Connect a mailbox")).toBeInTheDocument();
    emptyAccountView.unmount();

    mocks.listConnectors.mockRejectedValueOnce(new Error("accounts unavailable"));
    const accountErrorView = setup("/mail");
    expect((await screen.findAllByText("accounts unavailable")).length).toBeGreaterThan(0);
    accountErrorView.unmount();

    mocks.listMailboxes.mockRejectedValueOnce(new Error("mailboxes unavailable"));
    const mailboxErrorView = setup("/mail");
    expect((await screen.findAllByText("mailboxes unavailable")).length).toBeGreaterThan(0);
    mailboxErrorView.unmount();

    mocks.listMailThreads.mockRejectedValueOnce(new Error("mail unavailable"));
    const threadErrorView = setup("/mail");
    expect(await screen.findByRole("alert")).toHaveTextContent("mail unavailable");
    threadErrorView.unmount();

    mocks.listMailThreads.mockResolvedValueOnce([]);
    const noThreadsView = setup("/mail");
    expect(await screen.findByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Select a conversation")).toBeInTheDocument();
    noThreadsView.unmount();
  });

  it("renders iCloud mail and calendar states while connector work is pending or fails", async () => {
    const icloudAccount = {
      calendarEnabled: false,
      email: "person@icloud.com",
      id: secondId,
      label: "person@icloud.com",
      lastSyncedAt: null,
      mailEnabled: true,
      provider: "icloud" as const,
      syncError: null,
      syncStatus: "idle" as const,
    };
    mocks.listConnectors.mockResolvedValue([icloudAccount]);
    mocks.listMailboxes.mockResolvedValue([
      { ...mailbox, accountId: secondId, provider: "icloud", unreadCount: 0 },
    ]);
    mocks.listMailThreads.mockResolvedValue([
      { ...mailThread, accountId: secondId, provider: "icloud" },
    ]);
    let rejectSync: (error: Error) => void = () => undefined;
    mocks.syncConnector.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectSync = reject;
      }),
    );
    const mailView = setup("/mail");
    const browser = userEvent.setup();
    expect(await screen.findByText("iCloud Mail")).toBeInTheDocument();
    const syncButton = screen.getByRole("button", { name: "Sync all mail accounts" });
    await browser.click(syncButton);
    expect(syncButton).toBeDisabled();
    expect(syncButton.querySelector(".spin")).toBeInTheDocument();
    rejectSync(new Error("iCloud sync unavailable"));
    expect(await screen.findByRole("alert")).toHaveTextContent("iCloud sync unavailable");
    mailView.unmount();

    mocks.listConnectors.mockResolvedValue([icloudAccount]);
    mocks.listCalendars.mockResolvedValue([
      {
        ...calendar,
        accountId: secondId,
        name: "Family",
        provider: "icloud",
      },
    ]);
    let resolveConnect: (value: { accountId: string; email: string }) => void = () => undefined;
    mocks.connectICloud.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );
    const settingsView = setup("/settings");
    await browser.click(await findSettingsLink("Calendars"));
    expect(await screen.findByText(/iCloud Calendar/)).toBeInTheDocument();
    await browser.click(await findSettingsLink("Connections"));
    await browser.click(screen.getByRole("button", { name: "Connect" }));
    await browser.click(screen.getByRole("menuitem", { name: "iCloud" }));
    await browser.type(screen.getByLabelText("Apple Account email"), "new@icloud.com");
    await browser.type(screen.getByLabelText("App-specific password"), "xxxx-xxxx");
    await browser.click(screen.getByRole("button", { name: "Add iCloud" }));
    expect(await screen.findByText("Connecting iCloud")).toBeInTheDocument();
    resolveConnect({ accountId: secondId, email: "new@icloud.com" });
    await waitFor(() => expect(mocks.connectICloud).toHaveBeenCalled());
    settingsView.unmount();
  });

  it("shows pending mutations, desktop pinning, redirects, and page-level alternatives", async () => {
    mocks.getMe.mockRejectedValueOnce(new Error("unauthorized"));
    let rejectLogin: (error: Error) => void = () => undefined;
    mocks.login.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectLogin = reject;
      }),
    );
    const authView = setup();
    const browser = userEvent.setup();
    await browser.type(await screen.findByLabelText("Email"), "test@example.com");
    await browser.type(screen.getByLabelText("Password"), "LocalTestOnly123!");
    await browser.click(screen.getByRole("button", { name: "Open ilo" }));
    expect(await screen.findByText("Signing in")).toBeInTheDocument();
    rejectLogin(new Error("Later failure"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Later failure");
    authView.unmount();

    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const desktopView = setup("/unknown");
    expect(await screen.findByRole("heading", { name: "Your commitments" })).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Keep window on top" }));
    await waitFor(() => expect(mocks.setAlwaysOnTop).toHaveBeenCalledWith(true));
    await browser.click(screen.getByRole("button", { name: "Keep window on top" }));
    await waitFor(() => expect(mocks.setAlwaysOnTop).toHaveBeenCalledWith(false));
    desktopView.unmount();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");

    mocks.listEvents.mockRejectedValueOnce(new Error("week unavailable"));
    const calendarView = setup("/calendar");
    expect(await screen.findByRole("alert")).toHaveTextContent("week unavailable");
    calendarView.unmount();

    mocks.listReminders.mockRejectedValueOnce(new Error("reminders unavailable"));
    const remindersErrorView = setup("/reminders");
    expect(await screen.findByRole("alert")).toHaveTextContent("reminders unavailable");
    remindersErrorView.unmount();

    mocks.listReminders.mockResolvedValue({ items: [], nextCursor: null });
    const remindersView = setup("/reminders");
    expect(await screen.findByText("A clear slate")).toBeInTheDocument();
    await browser.click(screen.getByRole("link", { name: "Completed" }));
    expect(await screen.findByText("No completed reminders")).toBeInTheDocument();
    remindersView.unmount();

    mocks.listActivity.mockRejectedValueOnce(new Error("activity unavailable"));
    const activityView = setup("/activity");
    expect(await screen.findByRole("alert")).toHaveTextContent("activity unavailable");
    activityView.unmount();

    mocks.listActivity.mockResolvedValue([]);
    const emptyActivityView = setup("/activity");
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
    emptyActivityView.unmount();

    mocks.listEvents.mockResolvedValue([event]);
    mocks.listReminders.mockResolvedValue({ items: [reminder], nextCursor: null });
    mocks.listCalendars.mockReturnValueOnce(new Promise(() => undefined));
    const calendarPendingView = setup("/calendar");
    expect(await screen.findByText("Focus block")).toBeInTheDocument();
    await browser.click(screen.getByRole("radio", { name: "Month" }));
    await browser.click(await screen.findByRole("button", { name: /^1:00 PM Focus block/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Calendar");
    expect(screen.getByRole("button", { name: "Edit Event" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    await browser.click(screen.getByRole("button", { name: "New event" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    calendarPendingView.unmount();

    mocks.listCalendars.mockResolvedValue([calendar, googleCalendar, nullColorCalendar]);
    let resolveReminder: (value: typeof reminder) => void = () => undefined;
    mocks.createReminder.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReminder = resolve;
      }),
    );
    const pendingEditorView = setup();
    expect(await screen.findByText("Focus block")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Add" }));
    await browser.click(screen.getByRole("menuitem", { name: /Reminder/ }));
    await browser.type(screen.getByLabelText("What needs attention?"), "Pending reminder");
    await browser.click(screen.getByRole("button", { name: "Create reminder" }));
    expect(await screen.findByText("Saving")).toBeInTheDocument();
    resolveReminder(reminder);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    pendingEditorView.unmount();

    let resolveSync: (value: number) => void = () => undefined;
    mocks.syncConnector.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );
    const syncingView = setup("/settings");
    await browser.click(await findSettingsLink("Connections"));
    await browser.click(await screen.findByRole("button", { name: "Sync Google" }));
    await waitFor(() => expect(syncingView.container.querySelector(".spin")).toBeInTheDocument());
    resolveSync(1);
    syncingView.unmount();
  }, 15_000);

  it("renders the empty branches and catches mutation failures", async () => {
    mocks.getDailyBrief.mockResolvedValue({
      allDay: [],
      anytime: [],
      capacity,
      generatedAt: now,
      laterToday: [],
      next: null,
      now: [],
      overdue: [],
      timeZone: "UTC",
      tasks: [],
      completedTasks: [],
      today: [],
      tomorrow: [],
    });
    mocks.listConnectors.mockResolvedValue([]);
    mocks.listTasks.mockResolvedValue({ items: [], nextCursor: null });
    mocks.createReminder.mockRejectedValue(new Error("Could not save"));
    setup();
    const browser = userEvent.setup();
    expect(await screen.findByText("The day is open")).toBeInTheDocument();
    expect(screen.getByText("Nothing pulling at you")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Add" }));
    await browser.click(screen.getByRole("menuitem", { name: /Reminder/ }));
    await browser.type(screen.getByLabelText("What needs attention?"), "Failing reminder");
    await browser.click(screen.getByRole("button", { name: "Create reminder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    await browser.click(screen.getByRole("button", { name: "Close" }));
    await browser.click(screen.getByRole("button", { name: "Account menu" }));
    await browser.click(screen.getByRole("menuitem", { name: "Settings" }));
    await browser.click(await findSettingsLink("Connections"));
    expect(await screen.findByText(/No external calendars connected/)).toBeInTheDocument();
  });

  it("surfaces connector mutation failures", async () => {
    mocks.getGoogleAuthorizationUrl.mockRejectedValueOnce(
      new Error("Google Calendar is not configured."),
    );
    mocks.syncConnector.mockRejectedValueOnce(new Error("Google sync failed."));
    mocks.deleteConnector.mockRejectedValueOnce(new Error("Google disconnect failed."));
    mocks.connectICloud.mockRejectedValueOnce(new Error("iCloud connection failed."));
    setup("/settings");
    const browser = userEvent.setup();

    await browser.click(await findSettingsLink("Connections"));
    await browser.click(await screen.findByRole("button", { name: "Connect" }));
    await browser.click(screen.getByRole("menuitem", { name: "Google" }));
    expect(await screen.findByText("Google Calendar is not configured.")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Sync Google" }));
    expect(await screen.findByText("Google sync failed.")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Disconnect Google" }));
    expect(await screen.findByText("Google disconnect failed.")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Connect" }));
    await browser.click(screen.getByRole("menuitem", { name: "iCloud" }));
    await browser.type(screen.getByLabelText("Apple Account email"), "test@icloud.com");
    await browser.type(screen.getByLabelText("App-specific password"), "bad-password");
    await browser.click(screen.getByRole("button", { name: "Add iCloud" }));
    expect(await screen.findByText("iCloud connection failed.")).toBeInTheDocument();
  });

  it("opens Google authorization in the system browser on desktop", async () => {
    const authorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=test";
    mocks.isTauri.mockReturnValue(true);
    mocks.getGoogleAuthorizationUrl.mockResolvedValue(authorizationUrl);
    setup("/settings");
    const browser = userEvent.setup();

    await browser.click(await findSettingsLink("Connections"));
    await browser.click(await screen.findByRole("button", { name: "Connect" }));
    await browser.click(screen.getByRole("menuitem", { name: "Google" }));

    await waitFor(() => expect(mocks.openUrl).toHaveBeenCalledWith(authorizationUrl));
  });

  it("creates and maintains goals and motives as agent-ready decision context", async () => {
    const goal = {
      createdAt: now,
      description: "Make room for meaningful work.",
      id,
      progress: 20,
      status: "active" as const,
      targetDate: "2026-08-01",
      title: "Protect focus",
      updatedAt: now,
    };
    const motive = {
      createdAt: now,
      detail: "Choose people and durable work over urgency.",
      id: secondId,
      isActive: true,
      title: "Act with care",
      updatedAt: now,
    };
    mocks.listGoals.mockResolvedValue([goal]);
    mocks.listMotives.mockResolvedValue([motive]);
    mocks.createGoal.mockResolvedValue(goal);
    mocks.updateGoal.mockResolvedValue(goal);
    mocks.deleteGoal.mockResolvedValue(undefined);
    mocks.createMotive.mockResolvedValue(motive);
    mocks.updateMotive.mockResolvedValue(motive);
    mocks.deleteMotive.mockResolvedValue(undefined);
    const browser = userEvent.setup();
    const goals = setup("/goals");
    expect(await screen.findByText("Protect focus")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "20%" }));
    await waitFor(() => expect(mocks.updateGoal).toHaveBeenCalledWith(id, { progress: 30 }));
    await browser.type(screen.getByLabelText("Outcome"), "Build a calmer week");
    await browser.type(
      screen.getByLabelText("What does success look like?"),
      "Leave enough margin.",
    );
    await browser.click(screen.getByRole("button", { name: "Create goal" }));
    await waitFor(() =>
      expect(mocks.createGoal).toHaveBeenCalledWith({
        description: "Leave enough margin.",
        progress: 0,
        targetDate: null,
        title: "Build a calmer week",
      }),
    );
    await browser.click(screen.getByRole("button", { name: "Remove Protect focus" }));
    await waitFor(() => expect(mocks.deleteGoal).toHaveBeenCalledWith(id));
    goals.unmount();
    const motives = setup("/motives");
    expect(await screen.findByText("Act with care")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(mocks.updateMotive).toHaveBeenCalledWith(secondId, { isActive: false }),
    );
    await browser.type(screen.getByLabelText("Motive"), "Keep learning");
    await browser.type(screen.getByLabelText("Context"), "Favor experiments over certainty.");
    await browser.click(screen.getByRole("button", { name: "Create motive" }));
    await waitFor(() =>
      expect(mocks.createMotive).toHaveBeenCalledWith({
        detail: "Favor experiments over certainty.",
        title: "Keep learning",
      }),
    );
    await browser.click(screen.getByRole("button", { name: "Remove Act with care" }));
    await waitFor(() => expect(mocks.deleteMotive).toHaveBeenCalledWith(secondId));
    motives.unmount();
  });

  it("keeps goal and motive edge states explicit", async () => {
    const completed = {
      createdAt: now,
      description: null,
      id,
      progress: 90,
      status: "completed" as const,
      targetDate: null,
      title: "Completed goal",
      updatedAt: now,
    };
    const paused = {
      ...completed,
      id: secondId,
      progress: 0,
      status: "paused" as const,
      title: "Paused goal",
    };
    const inactive = {
      createdAt: now,
      detail: null,
      id,
      isActive: false,
      title: "Paused motive",
      updatedAt: now,
    };
    mocks.listGoals.mockResolvedValue([completed, paused]);
    mocks.listMotives.mockResolvedValue([inactive]);
    mocks.updateGoal.mockResolvedValue(completed);
    mocks.updateMotive.mockResolvedValue(inactive);
    mocks.createGoal.mockRejectedValueOnce(new Error("Goal rejected"));
    mocks.createMotive.mockRejectedValueOnce(new Error("Motive rejected"));
    const browser = userEvent.setup();
    const goals = setup("/goals");
    expect(await screen.findAllByText("No supporting context yet.")).toHaveLength(2);
    await browser.click(screen.getByRole("button", { name: "90%" }));
    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith(id, { progress: 100, status: "completed" }),
    );
    await browser.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(mocks.updateGoal).toHaveBeenCalledWith(id, { status: "paused" }));
    await browser.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith(secondId, { status: "active" }),
    );
    await browser.type(screen.getByLabelText("Outcome"), "Rejected goal");
    await browser.type(screen.getByLabelText("Target date"), "2026-09-01");
    await browser.click(screen.getByRole("button", { name: "Create goal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Goal rejected");
    goals.unmount();
    const motives = setup("/motives");
    expect(await screen.findByText("No additional context.")).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
    await browser.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(mocks.updateMotive).toHaveBeenCalledWith(id, { isActive: true }));
    await browser.type(screen.getByLabelText("Motive"), "Rejected motive");
    await browser.click(screen.getByRole("button", { name: "Create motive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Motive rejected");
    motives.unmount();
    mocks.listGoals.mockRejectedValueOnce(new Error("Goals unavailable"));
    const brokenGoals = setup("/goals");
    expect(await screen.findByRole("alert")).toHaveTextContent("Goals unavailable");
    brokenGoals.unmount();
    mocks.listMotives.mockRejectedValueOnce(new Error("Motives unavailable"));
    setup("/motives");
    expect(await screen.findByRole("alert")).toHaveTextContent("Motives unavailable");
  });

  it("manages private invitations from the admin-only settings surface", async () => {
    mocks.getMe.mockResolvedValue({ ...user, canManageInvitations: true });
    mocks.listInvitations.mockResolvedValue([
      {
        createdAt: now,
        createdBy: id,
        email: "active@example.com",
        expiresAt: "2026-07-27T12:00:00.000Z",
        id,
        redeemedAt: null,
        redeemedBy: null,
      },
      {
        createdAt: now,
        createdBy: id,
        email: null,
        expiresAt: "2026-07-01T12:00:00.000Z",
        id: secondId,
        redeemedAt: null,
        redeemedBy: null,
      },
      {
        createdAt: now,
        createdBy: id,
        email: "used@example.com",
        expiresAt: "2026-07-27T12:00:00.000Z",
        id: thirdId,
        redeemedAt: "2026-07-12T12:00:00.000Z",
        redeemedBy: secondId,
      },
    ]);
    const browser = userEvent.setup();
    setup("/settings?section=invitations");

    expect(await screen.findByRole("heading", { name: "Invitations" })).toBeInTheDocument();
    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(screen.getByText(/Redeemed/)).toBeInTheDocument();
    expect(screen.getByText("Expires in 14 days")).toBeInTheDocument();
    await browser.type(screen.getByLabelText("Friend’s email (optional)"), "friend@example.com");
    await browser.selectOptions(screen.getByLabelText("Expires after"), "30");
    await browser.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByText("Invitation ready")).toBeInTheDocument();
    expect(mocks.createInvitation).toHaveBeenCalledWith({
      email: "friend@example.com",
      expiresInDays: 30,
    });
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await browser.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("invite-code");
  });

  it("connects and manages the selected X bookmark folder", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.getXBookmarkAccount.mockResolvedValue({
      displayName: null,
      id,
      lastSyncedAt: null,
      selectedFolderId: "folder-1",
      selectedFolderName: "Planning",
      syncError: null,
      syncStatus: "idle",
      username: "cooper",
    });
    mocks.listXBookmarkFolders.mockResolvedValue([
      { id, name: "Planning", remoteFolderId: "folder-1" },
      { id: secondId, name: "Reading", remoteFolderId: "folder-2" },
    ]);
    const browser = userEvent.setup();
    setup("/settings?section=connections");

    const folder = await screen.findByLabelText("X bookmark folder");
    await browser.selectOptions(folder, "folder-2");
    await waitFor(() =>
      expect(mocks.selectXBookmarkFolder).toHaveBeenCalledWith("folder-2", expect.anything()),
    );
    await browser.click(screen.getByRole("button", { name: "Sync X bookmarks for cooper" }));
    await waitFor(() => expect(mocks.syncXBookmarks).toHaveBeenCalled());
    await browser.click(screen.getByRole("button", { name: "Disconnect X bookmarks for cooper" }));
    await waitFor(() => expect(mocks.deleteXBookmarkAccount).toHaveBeenCalled());

    await browser.click(screen.getByRole("button", { name: "Connect" }));
    await browser.click(screen.getByRole("menuitem", { name: "X bookmarks" }));
    await waitFor(() =>
      expect(mocks.openUrl).toHaveBeenCalledWith("https://x.com/i/oauth2/authorize"),
    );
  });

  it("keeps Pinterest wallpaper desktop-only and exposes its desktop controls intentionally", async () => {
    const webView = setup("/settings?section=wallpaper");
    expect(await screen.findByText("Available in ilo for macOS")).toBeInTheDocument();
    expect(screen.queryByLabelText("Public board URL")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh now" })).not.toBeInTheDocument();
    expect(mocks.getPinterestWallpaperSettings).not.toHaveBeenCalled();
    webView.unmount();

    mocks.isTauri.mockReturnValue(true);
    mocks.listPinterestPins.mockRejectedValueOnce(new Error("Pinterest is unavailable"));
    const failedPreview = setup("/settings?section=wallpaper");
    expect(await screen.findByLabelText("Mosaic fit")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Fine-tune collage appearance" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("Pinterest is unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Pinterest image preview could not load" }),
    ).toHaveTextContent("Pinterest images could not load.");
    failedPreview.unmount();

    let finishSave: (() => void) | undefined;
    mocks.listPinterestPins.mockResolvedValue([
      { id: "pin-1", imageUrl: "https://i.pinimg.com/736x/example-1.jpg", title: null },
      { id: "pin-2", imageUrl: "https://i.pinimg.com/736x/example-2.jpg", title: null },
      { id: "pin-3", imageUrl: "https://i.pinimg.com/736x/example-3.jpg", title: null },
      { id: "pin-4", imageUrl: "https://i.pinimg.com/736x/example-4.jpg", title: null },
    ]);
    mocks.updatePinterestWallpaperSettings.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const pendingSave = setup("/settings?section=wallpaper");
    const browser = userEvent.setup();
    await browser.click(await screen.findByRole("radio", { name: "Overlapping stack" }));
    expect(screen.getByRole("button", { name: "Refresh now" })).toBeDisabled();
    finishSave?.();
    pendingSave.unmount();
  });

  it("previews, tunes, and applies a Pinterest desktop wallpaper", async () => {
    mocks.isTauri.mockReturnValue(true);
    let settings = {
      backgroundColor: "#ffffff",
      backgroundMode: "white" as const,
      boardUrl: "https://www.pinterest.com/example/mindset/",
      cornerRadius: 0,
      enabled: false,
      frameSpacing: 16,
      lastAppliedAt: null,
      layout: "grid" as const,
      mosaicFit: "preserve" as const,
      paddingBottom: 16,
      paddingEnd: 16,
      paddingLinked: true,
      paddingStart: 16,
      paddingTop: 16,
      rotationDegrees: 0,
      tileSize: 64,
    };
    const pins = Array.from({ length: 5 }, (_, index) => ({
      id: `pin-${index}`,
      imageUrl: `https://i.pinimg.com/736x/example-${index}.jpg`,
      title: null,
    }));
    mocks.getPinterestWallpaperSettings.mockImplementation(async () => settings);
    mocks.updatePinterestWallpaperSettings.mockImplementation(async (input) => {
      settings = { ...settings, ...input };
      return settings;
    });
    mocks.listPinterestPins.mockResolvedValue(pins);
    const browser = userEvent.setup();
    const view = setup("/settings?section=wallpaper");

    const boardUrl = await screen.findByLabelText("Public board URL");
    fireEvent.change(boardUrl, {
      target: { value: "https://www.pinterest.com/example/new-board/" },
    });
    fireEvent.blur(boardUrl);
    await waitFor(() =>
      expect(mocks.updatePinterestWallpaperSettings).toHaveBeenCalledWith(
        expect.objectContaining({ boardUrl: expect.any(String) }),
        expect.anything(),
      ),
    );

    await browser.click(screen.getByRole("radio", { name: "Overlapping stack" }));
    await browser.click(screen.getByRole("radio", { name: "Tiled grid" }));
    await browser.click(screen.getByRole("radio", { name: "Fill the rectangular frame" }));
    await browser.click(screen.getByRole("radio", { name: "Color-matched backdrop" }));
    await browser.click(screen.getByRole("radio", { name: "Daily random backdrop" }));
    await browser.click(screen.getByRole("radio", { name: "Custom backdrop" }));
    const color = await screen.findByLabelText("Custom backdrop color");
    fireEvent.change(color, { target: { value: "#123456" } });
    fireEvent.blur(color);

    for (const slider of screen.getAllByRole("slider")) {
      slider.focus();
      await browser.keyboard("{ArrowRight}");
    }

    await browser.click(screen.getByRole("checkbox", { name: "Link edge padding" }));
    for (const slider of screen.getAllByRole("slider").slice(-4)) {
      slider.focus();
      await browser.keyboard("{ArrowRight}");
    }
    await browser.click(screen.getByRole("checkbox", { name: "Link edge padding" }));
    await browser.click(screen.getByRole("checkbox", { name: "Show desktop safe areas" }));

    const previewImage = view.container.querySelector<HTMLImageElement>(
      ".pinterest-wallpaper-preview__tile",
    );
    expect(previewImage).not.toBeNull();
    if (previewImage) {
      fireEvent.load(previewImage);
      Object.defineProperties(previewImage, {
        naturalHeight: { configurable: true, value: 200 },
        naturalWidth: { configurable: true, value: 100 },
      });
      fireEvent.load(previewImage);
      fireEvent.load(previewImage);
    }

    await browser.click(screen.getByRole("checkbox", { name: "Refresh every day" }));
    await waitFor(() =>
      expect(mocks.updatePinterestWallpaperSettings).toHaveBeenCalledWith(
        { enabled: true },
        expect.anything(),
      ),
    );
    await browser.click(screen.getByRole("button", { name: "Refresh now" }));
    await waitFor(() => expect(mocks.recordPinterestWallpaperApplied).toHaveBeenCalled());
    expect(mocks.invoke).toHaveBeenCalledWith(
      "apply_pinterest_wallpaper",
      expect.objectContaining({
        boardLabel: "Mindset",
        imageUrls: pins.map((pin) => pin.imageUrl),
      }),
    );
  }, 10_000);
});
