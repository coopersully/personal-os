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
  MailRule,
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
  setup: {
    completedAt: now,
    currentStep: "ready",
    dismissedAt: null,
    selectedWorkspaces: ["calendar", "tasks", "mail", "finances"],
    startedAt: now,
    status: "complete",
  },
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
  updatedAt: now,
};
const mailRule: MailRule = {
  actions: [{ afterDays: 1, mailboxId: null, type: "archive" }],
  condition: { field: "any", operator: "contains", value: "news" },
  confidenceThreshold: null,
  createdAt: now,
  description: "Archive routine newsletters after one day.",
  domain: "mail",
  enabled: false,
  id,
  name: "Archive",
  policy: "preview",
  profileId: null,
  sourceIds: [accountId],
  updatedAt: now,
  version: 1,
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
  summary: "A high-signal inbox.",
  updatedAt: now,
  version: 1,
};
const attentionItem = {
  createdAt: now,
  domain: "mail" as const,
  expiresAt: null,
  id,
  importance: "normal" as const,
  kind: "important" as const,
  occursAt: null,
  relatedEntityId: null,
  relatedEntityType: null,
  source: null,
  status: "open" as const,
  summary: "Important mail.",
  title: "Important",
  updatedAt: now,
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
    if (url.pathname === "/v1/auth/invitations/validate") return json({ valid: true });
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
    if (url.pathname === "/v1/setup" && method === "PATCH")
      return json({
        user: {
          ...user,
          setup: {
            ...user.setup,
            ...JSON.parse(String(init?.body)),
            status: "in_progress",
          },
        },
      });
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
    if (url.pathname === "/v1/finances/guided-setup")
      return json({
        setup: {
          accountSources: [financeAccount],
          alertSummary: { open: 0, warnings: 0 },
          asOf: now,
          budgetSummary: { count: 1, month: "2026-07", planned: 250 },
          cashflowSummary: {
            financialProfileConfigured: true,
            incomeStreams: 0,
            recurringNeedsReview: 0,
            recurringObligations: 0,
          },
          humanOnlyActions: ["manage_financial_profile", "create_merchant_rule"],
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
        },
      });
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
    if (url.pathname === "/v1/finances/categories")
      return json({
        categories: [
          { color: null, group: "Spending", id, isSystem: true, name: "Dining", slug: "dining" },
        ],
      });
    if (url.pathname === "/v1/finances/budgets/status")
      return json({ budgets: [{ budget: financeBudget, remaining: 231.5, spent: 18.5 }] });
    if (url.pathname === "/v1/finances/merchants" && method === "GET")
      return json({ merchants: [financeMerchant] });
    if (url.pathname === "/v1/finances/merchants/merge" && method === "POST")
      return json({ merchant: financeMerchant });
    if (url.pathname === `/v1/finances/merchants/${id}` && method === "PATCH")
      return json({ merchant: { ...financeMerchant, isUserConfirmed: true } });
    if (url.pathname === "/v1/finances/review") return json({ reviews: [] });
    if (url.pathname === "/v1/finances/categorizations/propose")
      return json({ nextCursor: "next-review-page", proposals: [] });
    if (url.pathname === "/v1/finances/categorizations/apply")
      return json({
        results: [
          {
            applied: true,
            error: null,
            replayed: false,
            status: "applied",
            threshold: 0.985,
            transaction: financeTransaction,
            transactionId: financeTransaction.id,
          },
        ],
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
      return json({
        transaction: { ...financeTransaction, category: "Dining", needsReview: false },
      });
    if (url.pathname === `/v1/finances/accounts/${id}/sync`)
      return json({ result: { changed: 2 } });
    if (url.pathname === `/v1/finances/accounts/${id}/import`)
      return json({ result: { imported: 2, skipped: 1 } }, 201);
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
    if (url.pathname === "/v1/assistant/setup-status")
      return json({
        setup: {
          domains: [
            {
              approvedProfileStatus: null,
              approvedProfileVersion: null,
              canRead: true,
              canWrite: true,
              domain: "mail",
              pendingDraftVersion: null,
              profileStatus: "draft",
              profileVersion: 1,
            },
          ],
        },
      });
    if (url.pathname === "/v1/assistant/connection-guide")
      return json({
        guide: {
          domains: [
            {
              domain: "mail",
              readScope: "mail:read",
              support: "executable_rules",
              writeScope: "mail:write",
            },
          ],
          mcpUrl: "https://mcp.example.com/mcp",
          skill: {
            displayName: "Ilo Guided Setup",
            installPrompt: "Install the Ilo skill.",
            invocation: "$ilo-setup",
            name: "ilo-setup",
            setupPrompt: "Set up Ilo.",
            sourceUrl: "https://example.com/ilo-setup",
            version: "0.1.0",
          },
        },
      });
    if (url.pathname === "/v1/assistant/profiles/mail") return json({ profile: domainProfile });
    if (url.pathname === `/v1/assistant/attention/mail/${id}`)
      return json({ item: { ...attentionItem, status: "resolved" } });
    if (url.pathname === "/v1/assistant/attention" && method === "POST")
      return json({ item: attentionItem }, 201);
    if (url.pathname === "/v1/assistant/attention") return json({ items: [attentionItem] });
    if (url.pathname === "/v1/mail/drafts" && method === "POST")
      return json({ draft: { id } }, 201);
    if (url.pathname === `/v1/mail/drafts/${id}/reconcile`)
      return json({ draft: { id, sendStatus: "draft" } });
    if (url.pathname === "/v1/mail/drafts")
      return json({
        drafts: [
          {
            accountId,
            body: "Draft",
            cc: [],
            createdAt: now,
            id,
            reconciliationState: "none",
            sendClaimedAt: null,
            sendStatus: "draft",
            sentAt: null,
            subject: "Subject",
            threadId: null,
            to: [{ address: "to@example.com", name: null }],
            updatedAt: now,
          },
        ],
      });
    if (url.pathname === "/v1/mail/setup-context")
      return json({
        setup: {
          accounts: [],
          safety: {
            delayedRetentionAutomation: false,
            permanentDeletion: false,
            providerFilterCreation: false,
            spamClassification: false,
            unsubscribeAutomation: false,
          },
        },
      });
    if (url.pathname === `/v1/mail/rules/${id}/activate`)
      return json({
        preview: {
          candidates: [],
          matchedCount: 0,
          previewedAt: now,
          ruleId: id,
          ruleVersion: 1,
          scannedCount: 1,
          window: {
            limit: 200,
            newestReceivedAt: now,
            oldestReceivedAt: now,
            truncated: false,
          },
        },
        rule: { ...mailRule, enabled: true, policy: "approved_rule", version: 2 },
      });
    if (url.pathname === `/v1/mail/rules/${id}/preview`)
      return json({
        preview: {
          candidates: [],
          matchedCount: 0,
          previewedAt: now,
          ruleId: id,
          ruleVersion: 1,
          scannedCount: 1,
          window: {
            limit: 200,
            newestReceivedAt: now,
            oldestReceivedAt: now,
            truncated: false,
          },
        },
      });
    if (url.pathname === "/v1/mail/rules/preview")
      return json({
        preview: { candidates: [], matchedCount: 0, scannedCount: 1 },
      });
    if (url.pathname === `/v1/mail/rules/${id}` && method === "PATCH")
      return json({ rule: { ...mailRule, enabled: false, version: 2 } });
    if (url.pathname === "/v1/mail/rules" && method === "POST")
      return json({ rule: mailRule }, 201);
    if (url.pathname === "/v1/mail/rules") return json({ rules: [mailRule] });
    if (url.pathname === "/v1/mail/send") return new Response(null, { status: 202 });
    if (url.pathname.endsWith("/snooze")) return new Response(null, { status: 204 });
    if (url.pathname === "/v1/mail/threads/bulk")
      return json({
        result: {
          failedCount: 0,
          failures: [],
          updatedCount: 1,
          updatedIds: [id],
        },
      });
    if (url.pathname === `/v1/mail/threads/${id}/attention`) return json({ item: attentionItem });
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
    await expect(api.getFinanceGuidedSetup()).resolves.toMatchObject({
      accountSources: [financeAccount],
      humanOnlyActions: expect.arrayContaining(["create_merchant_rule"]),
    });
    await expect(api.getFinanceProfile()).resolves.toMatchObject({ employer: "Acme" });
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
      api.mergeFinanceMerchants({
        rationale: "Confirmed duplicate aliases.",
        sourceMerchantId: accountId,
        targetMerchantId: id,
      }),
    ).resolves.toEqual(financeMerchant);
    await expect(api.getFinanceReviewQueue()).resolves.toEqual([]);
    await expect(api.listFinanceTransactions({ review: "needs_review" })).resolves.toMatchObject({
      nextCursor: null,
    });
    await expect(api.proposeFinanceCategorizations()).resolves.toEqual({
      items: [],
      nextCursor: "next-review-page",
    });
    await expect(
      api.applyFinanceCategorizations({
        decisions: [
          {
            categoryId: id,
            confidence: 0.99,
            expectedTransactionUpdatedAt: now,
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
        expectedTransactionUpdatedAt: now,
        learnMerchant: "never",
        rationale: null,
      }),
    ).resolves.toMatchObject({ applied: true });
    await expect(api.getPlaidStatus()).resolves.toEqual({ available: true });
    await expect(api.getPlaidLinkToken()).resolves.toBe("link-token");
    await expect(
      api.exchangePlaidToken({ institution: "Test bank", publicToken: "public-token" }),
    ).resolves.toEqual([financeAccount]);
    await expect(
      api.updateFinanceTransaction(accountId, { category: "Dining" }),
    ).resolves.toMatchObject({
      category: "Dining",
      needsReview: false,
    });
    await expect(api.syncFinanceAccount(id)).resolves.toBe(2);
    await expect(
      api.importFinanceCsv({
        accountId: id,
        csv: "Date,Amount\n2026-07-13,10",
        provider: "paypal",
      }),
    ).resolves.toEqual({ imported: 2, skipped: 1 });
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
    await expect(
      api.getGoogleAuthorizationUrl({
        accountId,
        returnTo: "/setup",
        services: ["mail"],
      }),
    ).resolves.toContain("accounts.google.com");
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
    await expect(api.getMailSetupContext()).resolves.toMatchObject({ accounts: [] });
    await expect(api.getAssistantSetupStatus()).resolves.toMatchObject({
      domains: [expect.objectContaining({ domain: "mail" })],
    });
    await expect(api.getAgentConnectionGuide()).resolves.toMatchObject({
      mcpUrl: "https://mcp.example.com/mcp",
      skill: { name: "ilo-setup" },
    });
    await expect(api.getDomainProfile("mail")).resolves.toEqual(domainProfile);
    await expect(
      api.upsertDomainProfile({
        categories: [],
        domain: "mail",
        instructions: domainProfile.instructions,
        objective: domainProfile.objective,
        preferences: domainProfile.preferences,
        sourceContexts: [],
        status: "draft",
        summary: domainProfile.summary,
      }),
    ).resolves.toEqual(domainProfile);
    await expect(
      api.listAttentionItems({ domain: "mail", limit: 50, status: "open" }),
    ).resolves.toEqual([attentionItem]);
    await expect(
      api.createAttentionItem({
        domain: "mail",
        expiresAt: null,
        importance: "normal",
        kind: "important",
        occursAt: null,
        relatedEntityId: null,
        relatedEntityType: null,
        source: null,
        summary: attentionItem.summary,
        title: attentionItem.title,
      }),
    ).resolves.toEqual(attentionItem);
    await expect(
      api.updateAttentionItem("mail", id, { status: "resolved" }),
    ).resolves.toMatchObject({ status: "resolved" });
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
      expect.objectContaining({ body: "Draft", id, reconciliationState: "none" }),
    ]);
    await expect(api.reconcileMailDraft(id, { outcome: "not_sent" })).resolves.toEqual({
      id,
      sendStatus: "draft",
    });
    await expect(
      api.createMailRule({
        actions: mailRule.actions,
        condition: mailRule.condition,
        confidenceThreshold: null,
        description: mailRule.description,
        enabled: false,
        name: mailRule.name,
        policy: "preview",
        profileId: null,
        sourceIds: [accountId],
      }),
    ).resolves.toEqual(mailRule);
    await expect(api.listMailRules()).resolves.toEqual([mailRule]);
    await expect(
      api.previewMailRule({
        actions: mailRule.actions,
        condition: mailRule.condition,
        confidenceThreshold: null,
        description: mailRule.description,
        sourceIds: [accountId],
      }),
    ).resolves.toMatchObject({ matchedCount: 0 });
    await expect(api.previewSavedMailRule(id)).resolves.toMatchObject({
      ruleId: id,
      ruleVersion: 1,
    });
    await expect(
      api.activateMailRule(id, {
        expectedCandidateIds: [],
        expectedPreviewFingerprint: "a".repeat(64),
        expectedPreviewedAt: now,
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({
      rule: { enabled: true, policy: "approved_rule", version: 2 },
    });
    await expect(
      api.updateMailRule(id, { enabled: false, expectedVersion: 1 }),
    ).resolves.toMatchObject({ enabled: false, version: 2 });
    await expect(
      api.updateMailThread(id, { expectedUpdatedAt: now, unread: false }),
    ).resolves.toEqual(mailThread);
    await expect(
      api.bulkUpdateMail({
        items: [{ expectedUpdatedAt: now, id }],
        unread: false,
      }),
    ).resolves.toEqual({
      failedCount: 0,
      failures: [],
      updatedCount: 1,
      updatedIds: [id],
    });
    await expect(
      api.upsertMailAttentionItem(id, {
        expiresAt: null,
        importance: "high",
        kind: "important",
        occursAt: null,
        summary: attentionItem.summary,
        title: attentionItem.title,
      }),
    ).resolves.toEqual(attentionItem);
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
    const updateMailCall = fetch.mock.calls.find(
      ([url, init]) =>
        new URL(String(url)).pathname === `/v1/mail/threads/${id}` && init?.method === "PATCH",
    );
    expect(JSON.parse(String(updateMailCall?.[1]?.body))).toEqual({
      expectedUpdatedAt: now,
      unread: false,
    });
    const bulkUpdateMailCall = fetch.mock.calls.find(
      ([url]) => new URL(String(url)).pathname === "/v1/mail/threads/bulk",
    );
    expect(JSON.parse(String(bulkUpdateMailCall?.[1]?.body))).toEqual({
      items: [{ expectedUpdatedAt: now, id }],
      unread: false,
    });
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
    await expect(api.validateInvitation({ inviteCode: "ABCD2345" })).resolves.toBe(true);
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
    await expect(
      api.updateAccountSetup({
        action: "progress",
        currentStep: "google",
        selectedWorkspaces: ["calendar", "mail"],
      }),
    ).resolves.toMatchObject({
      setup: { currentStep: "google", status: "in_progress" },
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
