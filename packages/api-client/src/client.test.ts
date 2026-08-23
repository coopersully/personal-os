import type {
  AutomationRoutine,
  AutomationRun,
  Calendar,
  CalendarEvent,
  DailyBrief,
  FinanceAccount,
  FinanceBudget,
  FinanceMerchant,
  FinanceTransaction,
  Goal,
  Mailbox,
  MailThread,
  Motive,
  Reminder,
  Task,
  User,
} from "@personal-os/domain";
import { ApiClientError, createApiClient } from "./client.js";

const now = "2026-07-13T12:00:00.000Z";
const id = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const user: User = {
  accentColor: "#c7d23c",
  emailVerified: true,
  id,
  displayName: "Test",
  email: "test@example.com",
  theme: "system",
  planningTimezone: "UTC",
  homeLocation: null,
  workdayEndMinute: 17 * 60,
  workdayStartMinute: 9 * 60,
  createdAt: now,
  updatedAt: now,
};
const reminder: Reminder = {
  id,
  title: "Test",
  notes: null,
  dueAt: null,
  timezone: null,
  priority: "medium",
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};
const task: Task = {
  id,
  title: "Plan task",
  notes: null,
  dueAt: null,
  scheduledAt: now,
  timezone: "UTC",
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
const automation: AutomationRoutine = {
  id,
  template: "morning_brief",
  title: "Morning brief",
  schedule: "Weekdays at 8:00 AM",
  timezone: "UTC",
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
  timeZone: "UTC",
  tasks: [],
  completedTasks: [],
  today: [],
  tomorrow: [],
};
const automationRun: AutomationRun = {
  id: accountId,
  routineId: id,
  status: "completed",
  summary: "Morning brief completed.",
  brief,
  startedAt: now,
  completedAt: now,
};
const financeAccount: FinanceAccount = {
  balance: 1200,
  createdAt: now,
  id,
  institution: "Test bank",
  kind: "cash",
  lastSyncedAt: null,
  name: "Checking",
  provider: "manual",
  status: "manual",
  updatedAt: now,
};
const financeTransaction: FinanceTransaction = {
  accountId: id,
  amount: 18.5,
  category: null,
  categoryConfidence: null,
  createdAt: now,
  date: "2026-07-13",
  direction: "expense",
  id: accountId,
  merchant: "Corner store",
  needsReview: true,
  notes: null,
  updatedAt: now,
};
const financeBudget: FinanceBudget = {
  category: "Dining",
  createdAt: now,
  id: accountId,
  limit: 250,
  month: "2026-07",
  updatedAt: now,
};
const canonicalFinanceBudget = {
  allocatedTotal: 8000,
  allocations: [{ amount: 8000, key: "buffer", kind: "buffer" as const }],
  approvedAt: null,
  assumptions: [],
  balanceDelta: 0,
  createdAt: now,
  effectiveFrom: "2026-09",
  expectedResources: 8000,
  id: accountId,
  planId: id,
  rationale: "Balanced fixture",
  resources: [{ amount: 8000, key: "income", kind: "income" as const }],
  status: "proposed" as const,
  version: 1,
};
const financeEnvelope = (data: unknown) => ({
  changes: [],
  communication: { headline: "Done", optionalDetails: [], requiredDisclosures: [] },
  data,
  outcome: "completed",
  remainingWork: { categories: [], count: 0 },
  schemaVersion: 1,
});
const financeMerchant: FinanceMerchant = {
  aliases: ["CORNER STORE #102"],
  displayName: "Corner Store",
  id,
  isUserConfirmed: false,
};
const goal: Goal = {
  createdAt: now,
  description: null,
  id,
  progress: 0,
  status: "active",
  targetDate: null,
  title: "Protect focus",
  updatedAt: now,
};
const motive: Motive = {
  createdAt: now,
  detail: null,
  id,
  isActive: true,
  title: "Act with care",
  updatedAt: now,
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function apiFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "DELETE" && url.pathname.includes("/blocks/")) return json({ event });
    if (method === "DELETE" || url.pathname === "/v1/auth/logout")
      return new Response(null, { status: 204 });
    if (url.pathname === "/v1/auth/login" || url.pathname === "/v1/auth/register")
      return json(
        { sessionToken: "sess_new", user },
        url.pathname.endsWith("register") ? 201 : 200,
      );
    if (url.pathname === "/v1/auth/email-verification/confirm") return json({ user });
    if (
      url.pathname === "/v1/auth/recovery" ||
      url.pathname === "/v1/auth/password-reset" ||
      url.pathname === "/v1/auth/email-verification"
    )
      return new Response(null, { status: 204 });
    if (url.pathname === "/v1/me" && method === "PATCH")
      return json({ user: { ...user, ...JSON.parse(String(init?.body)) } });
    if (url.pathname === "/v1/me") return json({ user });
    if (url.pathname === "/v1/sessions")
      return json({
        sessions: [
          { id, createdAt: now, expiresAt: now, lastSeenAt: now, ipAddress: null, userAgent: null },
        ],
      });
    if (url.pathname === "/v1/access-tokens" && method === "POST")
      return json(
        {
          token: {
            id,
            token: "pos_secret",
            name: "Agent",
            scopes: ["audit:read"],
            createdAt: now,
            expiresAt: null,
            lastUsedAt: null,
            revokedAt: null,
          },
        },
        201,
      );
    if (url.pathname === "/v1/access-tokens")
      return json({
        tokens: [
          {
            id,
            name: "Agent",
            scopes: ["audit:read"],
            createdAt: now,
            expiresAt: null,
            lastUsedAt: null,
            revokedAt: null,
          },
        ],
      });
    if (url.pathname === "/v1/oauth/clients")
      return json({
        clients: [
          {
            id,
            lastUsedAt: now,
            name: "Codex",
            redirectUris: ["http://127.0.0.1/callback"],
            scopes: ["audit:read"],
          },
        ],
      });
    if (url.pathname === "/v1/invitations" && method === "POST")
      return json(
        {
          invitation: {
            code: "invite-code",
            createdAt: now,
            createdBy: id,
            email: "friend@example.com",
            expiresAt: now,
            id,
            redeemedAt: null,
            redeemedBy: null,
          },
        },
        201,
      );
    if (url.pathname === "/v1/invitations")
      return json({
        invitations: [
          {
            createdAt: now,
            createdBy: id,
            email: "friend@example.com",
            expiresAt: now,
            id,
            redeemedAt: null,
            redeemedBy: null,
          },
        ],
      });
    if (url.pathname === "/v1/audit")
      return json({
        events: [
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
        ],
      });
    if (url.pathname === "/v1/daily-brief") return json({ brief });
    if (url.pathname === "/v1/weather/locations")
      return json({ locations: [{ label: "New York, New York, United States" }] });
    if (url.pathname === "/v1/weather")
      return json({
        weather: {
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
        },
      });
    if (url.pathname === "/v1/goals" && method === "POST") return json({ goal }, 201);
    if (url.pathname === "/v1/motives" && method === "POST") return json({ motive }, 201);
    if (url.pathname === "/v1/goals") return json({ goals: [goal] });
    if (url.pathname === "/v1/motives") return json({ motives: [motive] });
    if (url.pathname === `/v1/goals/${id}`) return json({ goal });
    if (url.pathname === `/v1/motives/${id}`) return json({ motive });
    if (url.pathname === "/v1/automations" && method === "POST")
      return json({ routine: automation }, 201);
    if (url.pathname === `/v1/automations/${id}` && method === "PATCH")
      return json({ routine: automation });
    if (url.pathname === "/v1/automations") return json({ routines: [automation] });
    if (url.pathname === "/v1/automations/runs") return json({ runs: [automationRun] });
    if (url.pathname.endsWith("/runs")) return json({ run: automationRun }, 201);
    if (url.pathname === "/v1/connectors/google/start")
      return json({ url: "https://accounts.google.com/o/oauth2/v2/auth" });
    if (url.pathname === "/v1/x-bookmarks/connect/start")
      return json({ url: "https://x.com/i/oauth2/authorize" });
    if (url.pathname === "/v1/x-bookmarks/account" && method === "GET")
      return json({
        account: {
          displayName: "Test",
          id,
          lastSyncedAt: null,
          selectedFolderId: "folder",
          selectedFolderName: "Calendar",
          syncError: null,
          syncStatus: "idle",
          username: "test",
        },
      });
    if (url.pathname === "/v1/x-bookmarks/folders")
      return json({ folders: [{ id, name: "Calendar", remoteFolderId: "folder" }] });
    if (url.pathname === "/v1/x-bookmarks" && method === "GET")
      return json({
        bookmarks: [
          {
            authorName: "Author",
            authorUsername: "author",
            id,
            postUrl: "https://x.com/author/status/post",
            postedAt: now,
            remotePostId: "post",
            source: {
              accountId,
              provider: "x",
              remoteId: "post",
              revision: null,
              sourceType: "bookmark",
            },
            syncedAt: now,
            text: "Event",
          },
        ],
      });
    if (url.pathname === "/v1/x-bookmarks/folder" || url.pathname === "/v1/x-bookmarks/sync")
      return json({ result: { changed: 2 } });
    if (url.pathname === "/v1/x-bookmarks/account" && method === "DELETE")
      return new Response(null, { status: 204 });
    if (url.pathname === "/v1/pinterest/applied") return new Response(null, { status: 204 });
    if (url.pathname === "/v1/pinterest/pins")
      return json({
        pins: [
          {
            id,
            imageUrl: "https://i.pinimg.com/example.jpg",
            title: "Example",
          },
        ],
      });
    if (url.pathname === "/v1/pinterest" && method === "PATCH")
      return json({
        settings: {
          backgroundColor: "#ffffff",
          backgroundMode: "white",
          boardUrl: "https://www.pinterest.com/example/board/",
          cornerRadius: 0,
          enabled: true,
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
        },
      });
    if (url.pathname === "/v1/pinterest")
      return json({
        settings: {
          backgroundColor: "#ffffff",
          backgroundMode: "white",
          boardUrl: "https://www.pinterest.com/example/board/",
          cornerRadius: 0,
          enabled: true,
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
        },
      });
    if (url.pathname === "/v1/connectors/icloud")
      return json({ account: { accountId, email: "test@icloud.com" } }, 201);
    if (url.pathname === "/v1/connectors")
      return json({
        accounts: [
          {
            id,
            provider: "google",
            label: "Google",
            email: "test@example.com",
            syncStatus: "idle",
            syncError: null,
            lastSyncedAt: null,
          },
        ],
      });
    if (url.pathname === "/v1/finances/plaid/status") return json({ available: true });
    if (url.pathname === "/v1/finances/setup")
      return json(
        financeEnvelope({
          budgetVersionId: null,
          maintenanceRunId: null,
          question: null,
          sessionId: id,
          stage: "collecting_profile",
          version: 1,
        }),
      );
    if (url.pathname === "/v1/finances/profile/current") return json(financeEnvelope(null));
    if (url.pathname === "/v1/finances/profile" && method === "PATCH")
      return json(
        financeEnvelope({
          createdAt: now,
          debts: [],
          dependents: 0,
          expectedMonthlyTakeHome: 8000,
          householdSize: 1,
          id,
          incomeStability: "stable",
          insurance: [],
          jurisdiction: null,
          liquidReserves: null,
          preferences: {
            bufferTarget: null,
            debtPriority: null,
            emergencyReserveMonths: null,
            notes: [],
          },
          provenance: {},
          userId: id,
          version: 1,
        }),
      );
    if (url.pathname === "/v1/finances/profile")
      return json({
        profile: {
          effectiveDate: "2026-07-01",
          employer: "Acme",
          employmentType: "full_time",
          expectedNetPay: 2500,
          grossAnnualIncome: 130000,
          nextPayday: "2026-07-31",
          payAccountId: id,
          payFrequency: "biweekly",
          role: "Engineer",
          updatedAt: now,
        },
      });
    if (url.pathname === "/v1/finances/income-streams") return json({ incomeStreams: [] });
    if (url.pathname === `/v1/finances/income-streams/${id}`)
      return json({ incomeStream: { id, status: "active" } });
    if (url.pathname === "/v1/finances/recurring") return json({ recurring: [] });
    if (url.pathname === `/v1/finances/recurring/${id}`)
      return json({ recurring: { id, status: "active" } });
    if (url.pathname === "/v1/finances/forecast")
      return json({
        forecast: {
          asOf: now,
          lowestProjectedBalance: 100,
          lowestProjectedDate: "2026-07-21",
          projectedBalanceAtNextPayday: 200,
          safeToSpend: 100,
          upcomingIncome: 2500,
          upcomingObligations: 20,
        },
      });
    if (url.pathname === "/v1/finances/alerts") return json({ alerts: [] });
    if (url.pathname === `/v1/finances/alerts/${id}`)
      return json({ alert: { id, status: "resolved" } });
    if (url.pathname === "/v1/finances/insights/refresh")
      return json({ result: { refreshed: true } });
    if (url.pathname === "/v1/finances/wealth")
      return json({
        wealth: {
          annualIncome: 130000,
          cash: 1000,
          debt: 0,
          investments: 0,
          netWorth: 1000,
          otherAssets: 0,
        },
      });
    if (url.pathname === "/v1/finances/budgets/pace")
      return json({ pace: { asOf: "2026-07-21", cells: [], period: "week" } });
    if (url.pathname === "/v1/finances/health")
      return json({
        health: {
          asOf: now,
          balanceOnlyAccounts: 0,
          candidateTransfers: 0,
          missingProvenance: 0,
          pendingTransactions: 0,
          possibleDuplicates: 0,
          staleAccounts: 0,
          unresolvedReviews: 0,
        },
      });
    if (url.pathname === "/v1/finances/export")
      return json({
        export: {
          accounts: [financeAccount],
          asOf: now,
          budgets: [financeBudget],
          categories: [],
          transactions: [financeTransaction],
        },
      });
    if (url.pathname === "/v1/finances/plaid/link-token") return json({ linkToken: "link-token" });
    if (url.pathname === "/v1/finances/plaid/exchange") return json({ accounts: [financeAccount] });
    if (url.pathname === "/v1/finances/account-connections")
      return json(financeEnvelope({ connectionId: id, status: "pending" }));
    if (url.pathname === `/v1/finances/account-connections/${id}`)
      return json(financeEnvelope({ id, status: "connected" }));
    if (url.pathname === `/v1/finances/accounts/${id}` && method === "PATCH")
      return json(financeEnvelope(financeAccount));
    if (url.pathname === `/v1/finances/accounts/${id}/disconnect`)
      return json(financeEnvelope(financeAccount));
    if (url.pathname === `/v1/finances/transactions/${id}` && method === "GET")
      return json(financeEnvelope(financeTransaction));
    if (url.pathname === `/v1/finances/transactions/${id}/remove`)
      return json(financeEnvelope({ id, removed: true }));
    if (url.pathname === "/v1/finances/transactions/split")
      return json(financeEnvelope([financeTransaction]));
    if (url.pathname === "/v1/finances/transactions/classify")
      return json(financeEnvelope([financeTransaction]));
    if (url.pathname === "/v1/finances/transactions/link")
      return json(financeEnvelope({ relationship: "transfer" }));
    if (url.pathname === "/v1/finances/rules")
      return json(financeEnvelope(method === "GET" ? [] : { id }));
    if (url.pathname === "/v1/finances/recurring-items")
      return json(financeEnvelope(method === "GET" ? { income: [], obligations: [] } : { id }));
    if (url.pathname === "/v1/finances/categories")
      return json({
        categories: [
          { color: null, group: "Spending", id, isSystem: true, name: "Dining", slug: "dining" },
        ],
      });
    if (url.pathname === "/v1/finances/budgets/status")
      return json({ budgets: [{ budget: financeBudget, remaining: 231.5, spent: 18.5 }] });
    if (url.pathname === "/v1/finances/budget-plans")
      return json(financeEnvelope(canonicalFinanceBudget), method === "POST" ? 201 : 200);
    if (url.pathname === `/v1/finances/budget-plans/${id}/revisions`)
      return json(financeEnvelope({ ...canonicalFinanceBudget, version: 2 }), 201);
    if (url.pathname === `/v1/finances/budget-versions/${accountId}/approve`)
      return json(financeEnvelope({ ...canonicalFinanceBudget, status: "active" }));
    if (url.pathname === "/v1/finances/budget-status")
      return json(financeEnvelope({ ...canonicalFinanceBudget, status: "active" }));
    if (url.pathname === "/v1/finances/goals")
      return json(
        financeEnvelope(
          method === "GET"
            ? []
            : {
                createdAt: now,
                currentAmount: 0,
                deadline: null,
                id,
                name: "Reserve",
                priority: "high",
                status: "active",
                targetAmount: 12000,
                updatedAt: now,
                version: 1,
              },
        ),
        method === "POST" ? 201 : 200,
      );
    if (url.pathname === "/v1/finances/merchants" && method === "GET")
      return json({ merchants: [financeMerchant] });
    if (url.pathname === "/v1/finances/merchants/merge" && method === "POST")
      return json(
        String(init?.body).includes("idempotencyKey")
          ? financeEnvelope(financeMerchant)
          : { merchant: financeMerchant },
      );
    if (url.pathname === `/v1/finances/merchants/${id}` && method === "PATCH")
      return json(
        String(init?.body).includes("idempotencyKey")
          ? financeEnvelope({ ...financeMerchant, isUserConfirmed: true })
          : { merchant: { ...financeMerchant, isUserConfirmed: true } },
      );
    if (url.pathname === "/v1/finances/review") return json({ reviews: [] });
    if (url.pathname === "/v1/finances/inbox") return json(financeEnvelope([]));
    if (url.pathname === `/v1/finances/inbox/${id}/answer`) return json(financeEnvelope([]));
    if (url.pathname === "/v1/finances/categorizations/propose") return json({ proposals: [] });
    if (url.pathname === "/v1/finances/categorizations/apply")
      return json({
        results: [{ applied: true, threshold: 0.985, transaction: financeTransaction }],
      });
    if (url.pathname === `/v1/finances/review/${id}`)
      return json({ result: { applied: true, threshold: 0.985, transaction: financeTransaction } });
    if (url.pathname === "/v1/finances/transactions" && method === "GET")
      return json({ items: [financeTransaction], nextCursor: null });
    if (url.pathname === "/v1/finances/accounts" && method === "POST")
      return json({ account: financeAccount }, 201);
    if (url.pathname === "/v1/finances/budgets" && method === "POST")
      return json({ budget: financeBudget }, 201);
    if (url.pathname === "/v1/finances/transactions" && method === "POST")
      return json({ transaction: financeTransaction }, 201);
    if (url.pathname === `/v1/finances/transactions/${accountId}` && method === "PATCH")
      return json(
        String(init?.body).includes("idempotencyKey")
          ? financeEnvelope({ ...financeTransaction, category: "Dining", needsReview: false })
          : {
              transaction: { ...financeTransaction, category: "Dining", needsReview: false },
            },
      );
    if (url.pathname === `/v1/finances/accounts/${id}/sync`)
      return json({ result: { changed: 2 } });
    if (url.pathname === `/v1/finances/accounts/${id}/import`)
      return json(
        String(init?.body).includes("idempotencyKey")
          ? financeEnvelope({ imported: 2, skipped: 1 })
          : { result: { imported: 2, skipped: 1 } },
        201,
      );
    if (url.pathname === "/v1/finances")
      return json({
        overview: {
          accounts: [financeAccount],
          budgets: [financeBudget],
          reviewCount: 1,
          spendingThisMonth: 18.5,
          transactions: [financeTransaction],
        },
      });
    if (url.pathname.endsWith("/sync")) return json({ result: { changed: 3 } });
    if (url.pathname === "/v1/mail/drafts" && method === "POST")
      return json({ draft: { id } }, 201);
    if (url.pathname === "/v1/mail/drafts")
      return json({ drafts: [{ body: "Draft", id, subject: "Subject" }] });
    if (url.pathname === "/v1/mail/rules" && method === "POST") return json({ rule: { id } }, 201);
    if (url.pathname === "/v1/mail/rules")
      return json({
        rules: [{ action: "archive", enabled: true, id, name: "Archive", query: "news" }],
      });
    if (url.pathname === "/v1/mail/send" || url.pathname.endsWith("/snooze"))
      return new Response(null, { status: 204 });
    if (url.pathname === `/v1/mail/threads/${id}/messages`)
      return json({
        messages: [
          {
            attachments: [],
            bodyText: "Hello",
            cc: [],
            from: mailThread.from,
            id,
            receivedAt: now,
            threadId: id,
            to: [],
          },
        ],
      });
    if (url.pathname === `/v1/mail/threads/${id}`) return json({ thread: mailThread });
    if (url.pathname === "/v1/mail/threads") return json({ threads: [mailThread] });
    if (url.pathname === "/v1/mailboxes") return json({ mailboxes: [mailbox] });
    if (url.pathname === "/v1/calendars" && method === "POST") return json({ calendar }, 201);
    if (url.pathname === "/v1/calendars") return json({ calendars: [calendar] });
    if (url.pathname.includes("/calendars/")) return json({ calendar });
    if (url.pathname === "/v1/events" && method === "POST") return json({ event }, 201);
    if (url.pathname === "/v1/events") return json({ events: [event] });
    if (url.pathname.includes("/events/")) return json({ event });
    if (url.pathname === "/v1/reminders" && method === "POST") return json({ reminder }, 201);
    if (url.pathname === "/v1/reminders") return json({ items: [reminder], nextCursor: null });
    if (url.pathname.includes("/reminders/")) return json({ reminder });
    if (url.pathname === "/v1/tasks" && method === "POST") return json({ task }, 201);
    if (url.pathname === "/v1/tasks") return json({ items: [task], nextCursor: null });
    if (url.pathname.includes("/tasks/")) return json({ task });
    throw new Error(`Unhandled ${method} ${url.pathname}`);
  });
}

describe("ilo API client", () => {
  it("calls every API operation and serializes query parameters", async () => {
    const fetch = apiFetch();
    const api = createApiClient({
      baseUrl: "https://api.example.com/",
      fetch,
      headers: { "x-ilo-client": "web" },
      token: "pos_token",
    });
    await expect(api.getMe()).resolves.toEqual(user);
    await expect(api.listGoals()).resolves.toEqual([goal]);
    await expect(
      api.createGoal({ description: null, progress: 0, targetDate: null, title: "Protect focus" }),
    ).resolves.toEqual(goal);
    await expect(api.updateGoal(id, { progress: 10 })).resolves.toEqual(goal);
    await api.deleteGoal(id);
    await expect(api.listMotives()).resolves.toEqual([motive]);
    await expect(api.createMotive({ detail: null, title: "Act with care" })).resolves.toEqual(
      motive,
    );
    await expect(api.updateMotive(id, { isActive: false })).resolves.toEqual(motive);
    await api.deleteMotive(id);
    await expect(api.listCalendars()).resolves.toEqual([calendar]);
    await expect(
      api.createCalendar({ name: "Personal", color: null, timezone: "UTC" }),
    ).resolves.toEqual(calendar);
    await expect(api.updateCalendar(id, { name: "Home" })).resolves.toEqual(calendar);
    await expect(api.setCalendarSelected(id, false)).resolves.toEqual(calendar);
    await api.deleteCalendar(id);
    await expect(
      api.listEvents({ from: now, to: event.endsAt, calendarIds: [id], query: "" }),
    ).resolves.toEqual([event]);
    await expect(
      api.createEvent({
        calendarId: id,
        title: "Focus",
        startsAt: now,
        endsAt: event.endsAt,
        timezone: "UTC",
        allDay: false,
        notes: null,
        location: null,
      }),
    ).resolves.toEqual(event);
    await expect(api.updateEvent(id, { title: "Deep focus" })).resolves.toEqual(event);
    await expect(api.createEventBlock(id, { calendarId: id, mode: "busy" })).resolves.toEqual(
      event,
    );
    await expect(api.updateEventBlock(id, id, { mode: "details" })).resolves.toEqual(event);
    await expect(api.deleteEventBlock(id, id)).resolves.toEqual(event);
    await expect(api.restoreEvent(id)).resolves.toEqual(event);
    await api.deleteEvent(id);
    await expect(api.listReminders({ completed: false, query: "", limit: 10 })).resolves.toEqual({
      items: [reminder],
      nextCursor: null,
    });
    await expect(
      api.createReminder({
        title: "Test",
        notes: null,
        dueAt: null,
        timezone: null,
        priority: "medium",
      }),
    ).resolves.toEqual(reminder);
    await expect(api.updateReminder(id, { title: "Changed" })).resolves.toEqual(reminder);
    await expect(api.completeReminder(id, true)).resolves.toEqual(reminder);
    await expect(api.restoreReminder(id)).resolves.toEqual(reminder);
    await api.deleteReminder(id);
    await expect(api.listTasks({ status: "scheduled", limit: 10 })).resolves.toEqual({
      items: [task],
      nextCursor: null,
    });
    await expect(
      api.createTask({
        title: "Plan task",
        notes: null,
        dueAt: null,
        scheduledAt: now,
        timezone: "UTC",
        priority: "medium",
        estimateMinutes: 30,
        tags: ["planning"],
        status: "scheduled",
      }),
    ).resolves.toEqual(task);
    await expect(api.updateTask(id, { status: "next" })).resolves.toEqual(task);
    await expect(api.completeTask(id, true)).resolves.toEqual(task);
    await expect(api.restoreTask(id)).resolves.toEqual(task);
    await api.deleteTask(id);
    await expect(api.listActivity(25)).resolves.toHaveLength(1);
    await expect(api.getDailyBrief()).resolves.toEqual(brief);
    await expect(api.getWeather({ latitude: 40.7, longitude: -74 })).resolves.toEqual({
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
    await expect(api.searchWeatherLocations("New York")).resolves.toEqual([
      { label: "New York, New York, United States" },
    ]);
    await expect(
      api.createFinanceAccount({
        balance: 1200,
        institution: "Test bank",
        name: "Checking",
        provider: "manual",
      }),
    ).resolves.toEqual(financeAccount);
    await expect(api.setupFinances({ operation: "start" })).resolves.toMatchObject({
      data: { sessionId: id },
    });
    await expect(
      api.createFinanceTransaction({
        accountId: id,
        amount: 18.5,
        category: null,
        categoryConfidence: null,
        date: "2026-07-13",
        direction: "expense",
        merchant: "Corner store",
        notes: null,
      }),
    ).resolves.toEqual(financeTransaction);
    await expect(
      api.createFinanceBudget({ category: "Dining", limit: 250, month: "2026-07" }),
    ).resolves.toEqual(financeBudget);
    await expect(
      api.createFinanceBudget({
        allocations: [{ amount: 8000, key: "buffer", kind: "buffer" }],
        assumptions: [],
        effectiveFrom: "2026-09",
        idempotencyKey: "budget-1",
        name: "Monthly plan",
        rationale: "Balanced fixture",
        resources: [{ amount: 8000, key: "income", kind: "income" }],
      }),
    ).resolves.toMatchObject({ data: { balanceDelta: 0, planId: id } });
    await expect(api.getFinanceBudget()).resolves.toMatchObject({ data: { planId: id } });
    await expect(
      api.reviseFinanceBudget({
        allocations: [{ amount: 8000, key: "buffer", kind: "buffer" }],
        assumptions: [],
        effectiveFrom: "2026-09",
        expectedVersion: 1,
        idempotencyKey: "budget-2",
        name: "Monthly plan",
        planId: id,
        rationale: "Balanced fixture",
        resources: [{ amount: 8000, key: "income", kind: "income" }],
      }),
    ).resolves.toMatchObject({ data: { version: 2 } });
    await expect(
      api.approveFinanceBudget({
        approvalSource: "user_instruction",
        budgetVersionId: accountId,
        expectedVersion: 1,
        idempotencyKey: "approve-1",
      }),
    ).resolves.toMatchObject({ data: { status: "active" } });
    await expect(api.getCanonicalFinanceBudgetStatus()).resolves.toMatchObject({
      data: { status: "active" },
    });
    await expect(api.getFinanceOverview()).resolves.toMatchObject({ reviewCount: 1 });
    await expect(api.getFinanceOverviewForMonth("2026-07")).resolves.toMatchObject({
      reviewCount: 1,
    });
    await expect(
      api.getFinanceOverviewForAccounts("2026-07", [id, accountId]),
    ).resolves.toMatchObject({
      reviewCount: 1,
    });
    await expect(api.getFinanceBudgetPace("week")).resolves.toMatchObject({ period: "week" });
    await expect(api.getFinanceWealthSummary()).resolves.toMatchObject({ netWorth: 1000 });
    await expect(api.getFinanceProfile()).resolves.toMatchObject({ employer: "Acme" });
    await expect(api.getFinancialProfile()).resolves.toMatchObject({ data: null });
    await expect(
      api.updateFinancialProfile({
        changes: { expectedMonthlyTakeHome: 8000 },
        expectedVersion: 0,
        idempotencyKey: "profile-1",
      }),
    ).resolves.toMatchObject({ data: { version: 1 } });
    await expect(api.listFinanceGoals()).resolves.toMatchObject({ data: [] });
    await expect(
      api.manageFinanceGoal({
        deadline: null,
        idempotencyKey: "goal-1",
        name: "Reserve",
        operation: "create",
        priority: "high",
        targetAmount: 12000,
      }),
    ).resolves.toMatchObject({ data: { name: "Reserve" } });
    await expect(
      api.updateFinanceProfile({
        effectiveDate: "2026-07-01",
        employer: "Acme",
        employmentType: "full_time",
        expectedNetPay: 2500,
        grossAnnualIncome: 130000,
        nextPayday: "2026-07-31",
        payAccountId: id,
        payFrequency: "biweekly",
        role: "Engineer",
      }),
    ).resolves.toMatchObject({ employer: "Acme" });
    await expect(api.listFinanceIncomeStreams()).resolves.toEqual([]);
    await expect(api.updateFinanceIncomeStream(id, { status: "active" })).resolves.toMatchObject({
      status: "active",
    });
    await expect(api.listFinanceRecurringObligations()).resolves.toEqual([]);
    await expect(
      api.updateFinanceRecurringObligation(id, { status: "active" }),
    ).resolves.toMatchObject({
      status: "active",
    });
    await expect(api.getFinanceForecast()).resolves.toMatchObject({ upcomingIncome: 2500 });
    await expect(api.listFinanceAlerts()).resolves.toEqual([]);
    await expect(
      api.resolveFinanceAlert(id, { action: "resolve", rationale: null }),
    ).resolves.toMatchObject({
      status: "resolved",
    });
    await expect(api.refreshFinanceInsights()).resolves.toEqual({ refreshed: true });
    await expect(api.getFinanceLedgerHealth()).resolves.toMatchObject({ candidateTransfers: 0 });
    await expect(api.exportFinanceData()).resolves.toMatchObject({
      accounts: [financeAccount],
      transactions: [financeTransaction],
    });
    await expect(api.getFinanceCategories()).resolves.toHaveLength(1);
    await expect(api.getFinanceBudgetStatus("2026-07")).resolves.toEqual([
      { budget: financeBudget, remaining: 231.5, spent: 18.5 },
    ]);
    await expect(api.listFinanceMerchants()).resolves.toEqual([financeMerchant]);
    await expect(
      api.updateFinanceMerchant(id, { displayName: "Corner Store" }),
    ).resolves.toMatchObject({ isUserConfirmed: true });
    await expect(
      api.updateFinanceMerchantCanonical(id, {
        displayName: "Corner Store",
        idempotencyKey: "merchant-update-1",
      }),
    ).resolves.toMatchObject({ data: { isUserConfirmed: true } });
    await expect(
      api.mergeFinanceMerchants({ sourceMerchantId: accountId, targetMerchantId: id }),
    ).resolves.toEqual(financeMerchant);
    await expect(
      api.mergeFinanceMerchantsCanonical({
        idempotencyKey: "merchant-merge-1",
        sourceMerchantId: accountId,
        targetMerchantId: id,
      }),
    ).resolves.toMatchObject({ data: financeMerchant });
    await expect(api.getFinanceReviewQueue()).resolves.toEqual([]);
    await expect(api.getFinanceInbox()).resolves.toMatchObject({ data: [] });
    await expect(
      api.answerFinanceReview(id, {
        answer: "Legitimate",
        idempotencyKey: "review-1",
        resolution: { rationale: "Confirmed", type: "dismiss" },
      }),
    ).resolves.toMatchObject({ data: [] });
    await expect(api.listFinanceTransactions({ review: "needs_review" })).resolves.toMatchObject({
      nextCursor: null,
    });
    await expect(api.proposeFinanceCategorizations()).resolves.toEqual([]);
    await expect(
      api.applyFinanceCategorizations({
        decisions: [
          {
            categoryId: id,
            confidence: 0.99,
            learnMerchant: "suggest",
            rationale: "Known merchant history.",
            transactionId: accountId,
          },
        ],
      }),
    ).resolves.toHaveLength(1);
    await expect(
      api.resolveFinanceReview(id, {
        action: "approve",
        learnMerchant: "never",
        rationale: null,
      }),
    ).resolves.toMatchObject({ applied: true });
    await expect(api.getPlaidStatus()).resolves.toEqual({ available: true });
    await expect(api.getPlaidLinkToken()).resolves.toBe("link-token");
    await expect(
      api.startFinanceAccountConnection({ idempotencyKey: "connect-1", provider: "plaid" }),
    ).resolves.toMatchObject({ data: { connectionId: id } });
    await expect(api.getFinanceAccountConnection(id)).resolves.toMatchObject({
      data: { status: "connected" },
    });
    await expect(
      api.updateFinanceAccount(id, { idempotencyKey: "account-1", name: "Primary" }),
    ).resolves.toMatchObject({ data: financeAccount });
    await expect(
      api.disconnectFinanceAccount(id, { idempotencyKey: "disconnect-1" }),
    ).resolves.toMatchObject({ data: financeAccount });
    await expect(
      api.exchangePlaidToken({ institution: "Test bank", publicToken: "public-token" }),
    ).resolves.toEqual([financeAccount]);
    await expect(
      api.updateFinanceTransaction(accountId, { category: "Dining" }),
    ).resolves.toMatchObject({
      category: "Dining",
      needsReview: false,
    });
    await expect(
      api.updateFinanceTransactionCanonical(accountId, {
        category: "Dining",
        idempotencyKey: "transaction-update-1",
      }),
    ).resolves.toMatchObject({ data: { category: "Dining" } });
    await expect(api.getFinanceTransaction(id)).resolves.toMatchObject({
      data: financeTransaction,
    });
    await expect(
      api.removeFinanceTransaction(id, { idempotencyKey: "remove-1" }),
    ).resolves.toMatchObject({ data: { removed: true } });
    await expect(api.splitFinanceTransaction({ idempotencyKey: "split-1" })).resolves.toMatchObject(
      { data: [financeTransaction] },
    );
    await expect(
      api.classifyFinanceTransactions({ idempotencyKey: "classify-1" }),
    ).resolves.toMatchObject({ data: [financeTransaction] });
    await expect(api.linkFinanceTransactions({ idempotencyKey: "link-1" })).resolves.toMatchObject({
      data: { relationship: "transfer" },
    });
    await expect(api.listFinanceRules()).resolves.toMatchObject({ data: [] });
    await expect(
      api.manageFinanceRule({ idempotencyKey: "rule-1", operation: "create" }),
    ).resolves.toMatchObject({ data: { id } });
    await expect(api.listFinanceRecurringItems()).resolves.toMatchObject({
      data: { income: [], obligations: [] },
    });
    await expect(
      api.manageFinanceRecurringItem({ idempotencyKey: "recurring-1", operation: "pause" }),
    ).resolves.toMatchObject({ data: { id } });
    await expect(api.syncFinanceAccount(id)).resolves.toBe(2);
    await expect(
      api.importFinanceCsv({
        accountId: id,
        csv: "Date,Amount\n2026-07-13,10",
        provider: "paypal",
      }),
    ).resolves.toEqual({ imported: 2, skipped: 1 });
    await expect(
      api.importFinanceTransactions({
        accountId: id,
        csv: "Date,Amount\n2026-07-13,10",
        idempotencyKey: "import-1",
        provider: "paypal",
      }),
    ).resolves.toMatchObject({ data: { imported: 2, skipped: 1 } });
    await api.deleteFinanceAccount(id);
    await expect(api.listAutomations()).resolves.toEqual([automation]);
    await expect(
      api.createAutomation({ ...automation, schedule: automation.schedule }),
    ).resolves.toEqual(automation);
    await expect(api.updateAutomation(id, { enabled: false })).resolves.toEqual(automation);
    await expect(api.listAutomationRuns(id)).resolves.toEqual([automationRun]);
    await expect(api.runAutomation(id, true)).resolves.toEqual(automationRun);
    await expect(api.listConnectors()).resolves.toHaveLength(1);
    await expect(api.getGoogleAuthorizationUrl()).resolves.toContain("accounts.google.com");
    await expect(api.getGoogleAuthorizationUrl(accountId)).resolves.toContain(
      "accounts.google.com",
    );
    await expect(api.getXBookmarkAuthorizationUrl()).resolves.toContain("x.com");
    await expect(api.getXBookmarkAccount()).resolves.toMatchObject({ username: "test" });
    await expect(api.listXBookmarkFolders()).resolves.toMatchObject([{ remoteFolderId: "folder" }]);
    await expect(api.selectXBookmarkFolder("folder")).resolves.toBe(2);
    await expect(api.syncXBookmarks()).resolves.toBe(2);
    await expect(api.listXBookmarks()).resolves.toMatchObject([{ remotePostId: "post" }]);
    await api.deleteXBookmarkAccount();
    await expect(
      api.connectICloud({
        appSpecificPassword: "xxxx-xxxx",
        calendar: true,
        email: "test@icloud.com",
        mail: true,
      }),
    ).resolves.toEqual({ accountId, email: "test@icloud.com" });
    await expect(api.listMailboxes()).resolves.toEqual([mailbox]);
    await expect(
      api.listMailThreads({
        accountIds: [accountId],
        mailboxId: id,
        query: "Test",
        unread: true,
      }),
    ).resolves.toEqual([mailThread]);
    await expect(api.getMailThread(id)).resolves.toEqual(mailThread);
    await expect(api.listMailMessages(id)).resolves.toEqual([
      {
        attachments: [],
        bodyText: "Hello",
        cc: [],
        from: mailThread.from,
        id,
        receivedAt: now,
        threadId: id,
        to: [],
      },
    ]);
    await expect(
      api.createMailDraft({
        accountId,
        body: "Draft",
        cc: [],
        subject: "Subject",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).resolves.toEqual({ id });
    await expect(api.listMailDrafts()).resolves.toEqual([
      { body: "Draft", id, subject: "Subject" },
    ]);
    await expect(
      api.createMailRule({ action: "archive", enabled: true, name: "Archive", query: "news" }),
    ).resolves.toEqual({ id });
    await expect(api.listMailRules()).resolves.toEqual([
      { action: "archive", enabled: true, id, name: "Archive", query: "news" },
    ]);
    await expect(api.updateMailThread(id, { unread: false })).resolves.toEqual(mailThread);
    await api.snoozeMailThread(id, "2026-07-14T12:00:00.000Z");
    await api.sendMail({
      accountId,
      body: "Hello",
      cc: [],
      subject: "Subject",
      to: [{ address: "to@example.com", name: null }],
    });
    await expect(api.syncConnector(id)).resolves.toBe(3);
    await api.deleteConnector(id);
    await expect(api.listAccessTokens()).resolves.toHaveLength(1);
    await expect(
      api.createAccessToken({ name: "Agent", scopes: ["audit:read"] }),
    ).resolves.toMatchObject({ token: "pos_secret" });
    await api.deleteAccessToken(id);
    await expect(api.listOAuthClients()).resolves.toHaveLength(1);
    await api.revokeOAuthClient(id);
    await expect(
      api.createInvitation({ email: "friend@example.com", expiresInDays: 14 }),
    ).resolves.toMatchObject({ code: "invite-code" });
    await expect(api.listInvitations()).resolves.toHaveLength(1);
    await expect(api.listSessions()).resolves.toHaveLength(1);
    await api.revokeSession(id);
    await expect(api.confirmEmailVerification({ token: "verification-token" })).resolves.toEqual(
      user,
    );
    await api.requestPasswordReset({ email: "test@example.com" });
    await api.resetPassword({ password: "LocalTestOnly123!", token: "reset-token" });
    await api.resendEmailVerification();
    await expect(api.getPinterestWallpaperSettings()).resolves.toMatchObject({ enabled: true });
    await expect(api.listPinterestPins()).resolves.toHaveLength(1);
    await expect(
      api.updatePinterestWallpaperSettings({ backgroundMode: "matched" }),
    ).resolves.toMatchObject({ enabled: true });
    await api.recordPinterestWallpaperApplied();

    const eventCall = fetch.mock.calls.find(([url]) => String(url).includes("/v1/events?"));
    expect(String(eventCall?.[0])).toContain(`calendarIds=${encodeURIComponent(id)}`);
    expect(String(eventCall?.[0])).not.toContain("query=");
    const googleAccountCall = fetch.mock.calls.find(([url]) =>
      String(url).includes(`accountId=${encodeURIComponent(accountId)}`),
    );
    expect(googleAccountCall).toBeTruthy();
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer pos_token",
    );
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-ilo-client")).toBe("web");
  });

  it("adopts, persists, uses, and clears a desktop session token", async () => {
    const fetch = apiFetch();
    const onSessionToken = vi.fn();
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch,
      onSessionToken,
      sessionToken: "sess_old",
    });
    await api.getMe();
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Session sess_old",
    );
    await expect(
      api.login({ email: "test@example.com", password: "LocalTestOnly123!" }),
    ).resolves.toEqual(user);
    expect(onSessionToken).toHaveBeenCalledWith("sess_new");
    await api.getMe();
    expect(new Headers(fetch.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBe(
      "Session sess_new",
    );
    await api.logout();
    expect(onSessionToken).toHaveBeenLastCalledWith(null);
    await expect(
      api.register({
        displayName: "Test",
        email: "test@example.com",
        password: "LocalTestOnly123!",
        planningTimezone: "UTC",
      }),
    ).resolves.toEqual(user);
  });

  it("updates the current user's account preferences", async () => {
    const fetch = apiFetch();
    const api = createApiClient({ baseUrl: "https://api.example.com", fetch });

    await expect(api.updateUser({ accentColor: "#6c9cff" })).resolves.toMatchObject({
      accentColor: "#6c9cff",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/me",
      expect.objectContaining({
        body: JSON.stringify({ accentColor: "#6c9cff" }),
        method: "PATCH",
      }),
    );
    await expect(api.updateUser({ theme: "dark" })).resolves.toMatchObject({
      theme: "dark",
    });
  });

  it("normalizes structured and unstructured HTTP errors", async () => {
    const structured = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(async () =>
        json(
          {
            error: {
              code: "conflict",
              message: "Already exists",
              details: { field: "email" },
              requestId: "r1",
            },
          },
          409,
        ),
      ),
    });
    const error = await structured.getMe().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      name: "ApiClientError",
      code: "conflict",
      message: "Already exists",
      details: { field: "email" },
      requestId: "r1",
      status: 409,
    });

    const plain = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(async () => new Response("not json", { status: 502 })),
    });
    await expect(plain.getMe()).rejects.toMatchObject({
      code: "http_error",
      message: "Request failed with status 502.",
      details: undefined,
      requestId: null,
    });
  });
});
