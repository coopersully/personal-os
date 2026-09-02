import type {
  Calendar,
  CalendarCommitmentProposal,
  CalendarEvent,
  CalendarReview,
  CalendarStatus,
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
  TaskList,
  TaskMovePreview,
  TaskProject,
  TaskProjectMovePreview,
  User,
} from "@personal-os/domain";
import {
  type FinanceStatus,
  financeStatusSchema,
  type MaintenanceRun,
  maintenanceRunSchema,
} from "@personal-os/domain";
import { ApiClientError, createApiClient } from "./client.js";

const now = "2026-07-13T12:00:00.000Z";
const id = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const financeStatus: FinanceStatus = financeStatusSchema.parse({
  activeRun: null,
  asOf: now,
  details: {
    accountRoles: { missingInputs: ["account_roles"], state: "unavailable" },
    accounts: {
      blocked: 0,
      current: 0,
      items: [],
      providerItems: [],
      retrying: 0,
      stale: 0,
      tracked: 0,
    },
    activeGoals: [],
    activeMotives: [],
    budget: { approved: false, month: "2026-07", total: null },
    cashFlow: {
      net: null,
      projectedLowestBalance: null,
      projectedLowestBalanceDate: null,
      reserveRunwayMonths: null,
    },
    closeReadiness: {
      missingProvenance: 0,
      possibleDuplicates: 0,
      ready: true,
      reconciledThrough: null,
      uncategorized: 0,
      unansweredExceptions: 0,
      unmatchedTransfers: 0,
    },
    evidence: { cutoff: null, current: false },
    health: {
      confidence: "insufficient",
      confidenceEvidence: [],
      dimensions: Object.fromEntries(
        ["borrow", "goals", "invest", "plan", "save", "spend"].map((key) => [
          key,
          {
            evidence: [],
            missingInputs: [],
            nextAction: null,
            rating: "unknown",
            trend: "unknown",
          },
        ]),
      ),
      missingInputs: [],
      month: {
        approvedBudget: null,
        forecastSpending: null,
        postedSpending: null,
        rating: "unknown",
      },
    },
    income: {
      monthly: null,
      observed: { asOf: null, basis: "missing", confidence: null, sourceRefs: [], value: null },
      stated: { asOf: null, basis: "missing", confidence: null, sourceRefs: [], value: null },
    },
    interview: [],
    ledger: {
      candidateTransfers: 0,
      missingProvenance: 0,
      pendingTransactions: 0,
      possibleDuplicates: 0,
    },
    month: { forecast: null, spending: null },
    latestReview: null,
    missingFacts: [],
    plan: { budgetVariance: null, capacity: null, overAllocated: false },
    prioritizedGoals: [],
    proposals: [],
    questions: [],
    reimbursements: {
      anomalies: 0,
      expected: 0,
      needsInput: 0,
      open: 0,
      outstanding: 0,
      overdue: 0,
      received: 0,
      unresolved: 0,
      unmatchedCredits: 0,
    },
    reviewMode: { reviewBypassEnabled: false },
    review: { byReason: {}, total: 0 },
    rulebookVersion: `sha256:${"a".repeat(64)}`,
    wealth: { cash: null, debt: null, investments: null, netWorth: null },
  },
  domain: "finances",
  freshness: { blockers: [], observedAt: now, state: "current" },
  recommendedNextOperation: null,
  state: "clean",
  validNextOperations: [],
  work: {
    actionable: 0,
    awaitingApproval: 0,
    awaitingInput: 0,
    blocked: 0,
    oldestOutstandingAt: null,
  },
});
const financeMaintenanceRun: MaintenanceRun = maintenanceRunSchema.parse({
  checkpoint: null,
  createdAt: now,
  domain: "finances",
  id,
  lastSafeError: null,
  leaseExpiresAt: null,
  retryAt: null,
  rulebookVersion: `sha256:${"a".repeat(64)}`,
  scope: { type: "all_outstanding" },
  settledResult: null,
  sourceSnapshot: null,
  status: "queued",
  updatedAt: now,
  userId: id,
});
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
  id,
  title: "Plan task",
  notes: null,
  dueAt: null,
  scheduledAt: now,
  timezone: "UTC",
  priority: "medium",
  estimateMinutes: 30,
  tags: ["planning"],
  why: null,
  legacyStatus: "scheduled",
  lifecycle: "open",
  listId: id,
  projectId: null,
  revision: 1,
  deletedAt: null,
  source: {
    accountId: null,
    provider: "local",
    remoteId: id,
    revision: "1",
    sourceType: "task",
  },
  createdAt: now,
  updatedAt: now,
};
const taskList: TaskList = {
  archivedAt: null,
  availability: "active",
  color: null,
  createdAt: now,
  deletedAt: null,
  description: null,
  id,
  kind: "standard",
  name: "Personal",
  revision: 1,
  source: {
    accountId: null,
    provider: "local",
    remoteId: id,
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
  id,
  lifecycle: "open",
  listId: id,
  name: "Home refresh",
  notes: null,
  revision: 1,
  source: {
    accountId: null,
    provider: "local",
    remoteId: id,
    revision: "1",
    sourceType: "task_project",
  },
  targetDate: null,
  updatedAt: now,
  why: null,
};
const taskMovePreview: TaskMovePreview = {
  destinationListId: accountId,
  destinationListRevision: 2,
  destinationProjectId: null,
  destinationProjectRevision: null,
  detachedProjectId: null,
  previewToken: "task-move-preview",
  sourceListId: id,
  sourceListRevision: 1,
  sourceProjectId: null,
  taskId: id,
  taskRevision: 1,
};
const taskProjectMovePreview: TaskProjectMovePreview = {
  affectedTaskCount: 2,
  destinationListId: accountId,
  destinationListRevision: 2,
  previewToken: "task-project-move-preview",
  sourceListId: id,
  sourceListRevision: 1,
  taskProjectId: id,
  taskProjectRevision: 1,
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
const calendarReview: CalendarReview = {
  createdAt: now,
  evidenceCutoff: now,
  findings: [],
  health: [],
  id,
  ledgerFingerprint: "a".repeat(64),
  nextMaintenanceAt: "2026-07-13T12:15:00.000Z",
  playbookVersion: "1.0.0",
  profileVersion: null,
  recommendations: [],
  rulebookVersion: "calendar-defaults-v1",
  scope: { type: "all_outstanding" },
  scopeEnd: "2026-11-10T12:00:00.000Z",
  scopeStart: "2026-06-13T12:00:00.000Z",
  sourceFreshness: [],
  state: "maintained",
};
const calendarStatus: CalendarStatus = {
  asOf: now,
  authority: {
    approvedRule: [],
    automatic: ["inspect", "assess"],
    individualApproval: ["create_event", "move_event", "resize_event", "trash_event"],
    unavailable: ["rsvp", "invite", "cancel_attended_event", "book_travel", "send_correspondence"],
  },
  backlog: {
    actionable: 0,
    ambiguousEffects: null,
    awaitingApproval: null,
    awaitingInput: 0,
    blocked: 0,
    failed: null,
    openFindings: 0,
  },
  health: [],
  latestReview: calendarReview,
  lifecycle: "maintained",
  readiness: "ready",
  setupBlockers: [],
  sources: [],
  validNextOperations: ["assess_calendar"],
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
  conferenceStatus: null,
  conferenceUrl: null,
  url: null,
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
  endsAt: event.endsAt,
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
const commitmentProposal: CalendarCommitmentProposal = {
  authority: "caller_supplied_unverified",
  candidate: commitmentCandidate,
  destination: calendar,
  possibleDuplicateEventId: null,
  fingerprint: "a".repeat(64),
  policy: {
    canApply: false,
    effectivePolicy: "preview",
    reasons: ["Caller-supplied evidence is not authority."],
    requestedPolicy: "approved_rule",
    requiresInteractiveApproval: true,
  },
  providerEffect: "local_write",
  warnings: [],
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
  timeZone: "UTC",
  tasks: [],
  completedTasks: [],
  today: [],
  tomorrow: [],
};
const financeAccount: FinanceAccount = {
  balance: 1200,
  createdAt: now,
  currencyCode: null,
  id,
  includeInPlanning: true,
  institution: "Test bank",
  kind: "cash",
  kindSource: "user",
  lastSyncedAt: null,
  name: "Checking",
  ownershipShare: 1,
  ownershipType: "individual",
  provider: "manual",
  providerSubtype: null,
  providerType: null,
  status: "manual",
  synchronization: {
    failureCode: null,
    failureCount: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    message: null,
    nextRetryAt: null,
    recovery: null,
    state: "current",
  },
  updatedAt: now,
};
const financeTransaction: FinanceTransaction = {
  accountId: id,
  amount: 18.5,
  category: null,
  categoryConfidence: null,
  createdAt: now,
  currencyCode: null,
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
  behavior: "unknown",
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
    if (url.pathname === "/v1/connectors/google/start")
      return json({ url: "https://accounts.google.com/o/oauth2/v2/auth" });
    if (url.pathname === `/v1/connectors/authorization-attempts/${id}`)
      return json({
        attempt: {
          accountId,
          code: "RAW_CODE_CANARY",
          provider: "google",
          providerMessage: "RAW_PROVIDER_CANARY",
          retryable: false,
          scope: "RAW_SCOPE_CANARY",
          status: "connected",
        },
      });
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
            calendarEnabled: true,
            health: {
              message: null,
              nextSyncAt: "2026-07-13T12:05:00.000Z",
              recovery: null,
              state: "ready",
            },
            id,
            provider: "google",
            label: "Google",
            email: "test@example.com",
            lastSyncAttemptAt: "2026-07-13T12:00:00.000Z",
            mailEnabled: true,
            nextSyncAt: "2026-07-13T12:05:00.000Z",
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
    if (url.pathname === "/v1/finances/automation-settings")
      return json({
        settings: { reviewBypassEnabled: method === "PATCH" },
      });
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
    if (url.pathname === "/v1/finances/account-connections")
      return json(financeEnvelope({ connectionId: id, status: "pending" }));
    if (url.pathname === "/v1/finances/accounts" && method === "GET")
      return json({
        accounts: [financeAccount],
        accountSemantics: {
          excludedAccountIds: [],
          possibleDuplicateGroups: [],
          trustworthy: true,
          unresolvedOwnershipAccountIds: [],
        },
        totals: { cash: 1200, debt: 0, investments: 0, netWorth: 1200, otherAssets: 0 },
      });
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
      return json({ merchant: financeMerchant });
    if (url.pathname === "/v1/finances/merchants/merge/canonical" && method === "POST")
      return json(financeEnvelope(financeMerchant));
    if (url.pathname === `/v1/finances/merchants/${id}` && method === "PATCH")
      return json({ merchant: { ...financeMerchant, isUserConfirmed: true } });
    if (url.pathname === `/v1/finances/merchants/${id}/canonical` && method === "PATCH")
      return json(financeEnvelope({ ...financeMerchant, isUserConfirmed: true }));
    if (url.pathname === "/v1/finances/review") return json({ reviews: [] });
    if (url.pathname === "/v1/finances/inbox") return json(financeEnvelope([]));
    if (url.pathname === `/v1/finances/inbox/${id}/answer`) return json(financeEnvelope([]));
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
    if (url.pathname === `/v1/finances/transactions/${accountId}/attention`)
      return json({ item: attentionItem });
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
    if (url.pathname === `/v1/finances/transactions/${accountId}/canonical` && method === "PATCH")
      return json(
        financeEnvelope({ ...financeTransaction, category: "Dining", needsReview: false }),
      );
    if (url.pathname === `/v1/finances/accounts/${id}/sync`)
      return json({ result: { changed: 2 } });
    if (url.pathname === `/v1/finances/accounts/${id}/import`)
      return json({ result: { imported: 2, skipped: 1 } }, 201);
    if (url.pathname === `/v1/finances/accounts/${id}/import/canonical`)
      return json(financeEnvelope({ imported: 2, skipped: 1 }), 201);
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
    if (url.pathname === "/v1/assistant/setup-plan")
      return json({
        plan: {
          access: { canRead: true, canWrite: true },
          connection: { lastObservedAt: now, observed: true },
          currentStepId: "learn_preferences",
          domain: "mail",
          nextAction: "Inspect Mail and save a draft.",
          profile: {
            approvedStatus: null,
            approvedVersion: null,
            pendingDraftVersion: null,
            status: null,
            version: null,
          },
          progress: { completed: 1, total: 4 },
          protocolVersion: "1.0",
          selectedStepId: url.searchParams.get("stepId") ?? "learn_preferences",
          status: "in_progress",
          steps: [],
        },
      });
    if (url.pathname === "/v1/assistant/work-items") {
      expect(url.searchParams.get("cursor")).toBe("opaque-next");
      expect(url.searchParams.get("kind")).toBe("review");
      return json({
        filteredTotal: 0,
        items: [],
        nextCursor: null,
        snapshotAt: now,
        summary: {
          byDomain: { calendar: 0, finances: 0, mail: 0, tasks: 0 },
          byKind: { attention: 0, review: 0 },
          total: 0,
        },
        unavailableDomains: [],
      });
    }
    if (url.pathname === "/v1/assistant/context")
      return json({
        context: {
          access: { grantedScopes: ["mail:read", "mail:write"] },
          generatedAt: now,
          identity: { actorType: "agent", displayName: "Test", userId: id },
          links: {
            activity: "https://app.example.com/activity",
            agentAccess: "https://app.example.com/settings?section=workspace-access",
            approvals: "https://app.example.com/reviews",
            recovery: "https://app.example.com/settings?section=connections",
            today: "https://app.example.com/today",
          },
          readiness: { domains: [] },
          time: { timestamp: now, timezone: "UTC" },
        },
      });
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
            displayName: "nohmi Guided Setup",
            installPrompt: "Install the nohmi skill.",
            invocation: "$ilo-setup",
            name: "ilo-setup",
            revision: "release-0.1.0",
            setupPrompt: "Set up nohmi.",
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
    if (url.pathname === "/v1/calendars/status") return json({ status: calendarStatus });
    if (url.pathname === "/v1/calendars/reviews" && method === "POST")
      return json({ review: calendarReview }, 201);
    if (url.pathname === "/v1/calendars/commitments/preview")
      return json({ proposal: commitmentProposal });
    if (url.pathname.includes("/calendars/")) return json({ calendar });
    if (url.pathname === "/v1/events" && method === "POST") return json({ event }, 201);
    if (url.pathname === "/v1/events") return json({ events: [event] });
    if (url.pathname.includes("/blocks/") && url.pathname.endsWith("/trash"))
      return json({ event });
    if (url.pathname.includes("/reminders/") && url.pathname.endsWith("/trash"))
      return json({ reminder });
    if (url.pathname.includes("/tasks/") && url.pathname.endsWith("/trash")) return json({ task });
    if (url.pathname.endsWith("/trash"))
      return json({ revision: { blockUpdatedAtById: {}, eventId: id, updatedAt: now } });
    if (url.pathname.endsWith("/attention") && url.pathname.includes("/events/"))
      return json({ item: attentionItem });
    if (url.pathname.includes("/events/")) return json({ event });
    if (url.pathname === "/v1/reminders/overdue-deferral-preview")
      return json({
        preview: {
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
          policy: "preview",
          previewedAt: now,
        },
      });
    if (url.pathname === "/v1/reminders" && method === "POST") return json({ reminder }, 201);
    if (url.pathname === "/v1/reminders") return json({ items: [reminder], nextCursor: null });
    if (url.pathname.includes("/reminders/") && url.pathname.endsWith("/attention"))
      return json({ item: attentionItem });
    if (url.pathname.includes("/reminders/")) return json({ reminder });
    if (url.pathname === "/v1/task-lists" && method === "POST") return json({ taskList }, 201);
    if (url.pathname === "/v1/task-lists") return json({ items: [taskList], nextCursor: null });
    if (url.pathname.includes("/task-lists/")) return json({ taskList });
    if (url.pathname === "/v1/task-projects" && method === "POST")
      return json({ taskProject }, 201);
    if (url.pathname === "/v1/task-projects")
      return json({ items: [taskProject], nextCursor: null });
    if (url.pathname.includes("/task-projects/") && url.pathname.endsWith("/move/preview"))
      return json({ preview: taskProjectMovePreview });
    if (url.pathname.includes("/task-projects/")) return json({ taskProject });
    if (url.pathname === "/v1/tasks" && method === "POST") return json({ task }, 201);
    if (url.pathname === "/v1/tasks") return json({ items: [task], nextCursor: null });
    if (url.pathname.includes("/tasks/") && url.pathname.endsWith("/move/preview"))
      return json({ preview: taskMovePreview });
    if (url.pathname.includes("/tasks/")) return json({ task });
    throw new Error(`Unhandled ${method} ${url.pathname}`);
  });
}

describe("ilo API client", () => {
  it("uses canonical task organization HTTP transport", async () => {
    const fetch = apiFetch();
    const api = createApiClient({ baseUrl: "https://api.example.com", fetch });
    const createTaskInput = {
      dueAt: null,
      estimateMinutes: null,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      lifecycle: "open" as const,
      listId: id,
      notes: null,
      priority: "medium" as const,
      scheduledAt: null,
      tags: [],
      timezone: null,
      title: "Plan task",
      why: null,
    };
    const createTaskListInput = {
      color: null,
      description: null,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      name: "Personal",
    };
    const createTaskProjectInput = {
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      listId: id,
      name: "Home refresh",
      notes: null,
      targetDate: null,
      why: null,
    };

    await api.listTasks({ lifecycle: "open", limit: 2 });
    await api.createTask(createTaskInput);
    await api.getTask(id);
    await api.updateTask(id, { expectedRevision: 1, title: "Plan today" });
    await api.completeTask(id, { expectedRevision: 1 });
    await api.cancelTask(id, { expectedRevision: 1 });
    await api.reopenTask(id, { expectedRevision: 1 });
    await api.trashTask(id, { expectedRevision: 1 });
    await api.restoreTask(id, { expectedRevision: 1 });
    await api.previewTaskMove(id, {
      destinationListId: accountId,
      destinationProjectId: null,
      expectedRevision: 1,
    });
    await api.moveTask(id, {
      destinationListId: accountId,
      destinationProjectId: null,
      expectedRevision: 1,
      previewToken: "task-move-preview",
    });
    await api.listTaskLists({ cursor: "next", limit: 2 });
    await api.createTaskList(createTaskListInput);
    await api.getTaskList(id);
    await api.updateTaskList(id, { expectedRevision: 1, name: "Home" });
    await api.archiveTaskList(id, { expectedRevision: 1 });
    await api.listTaskProjects({ cursor: "next", limit: 2 });
    await api.createTaskProject(createTaskProjectInput);
    await api.getTaskProject(id);
    await api.updateTaskProject(id, { expectedRevision: 1, name: "Bedroom refresh" });
    await api.completeTaskProject(id, { expectedRevision: 1 });
    await api.cancelTaskProject(id, { expectedRevision: 1 });
    await api.archiveTaskProject(id, { expectedRevision: 1 });
    await api.previewTaskProjectMove(id, { destinationListId: accountId, expectedRevision: 1 });
    await api.moveTaskProject(id, {
      destinationListId: accountId,
      expectedRevision: 1,
      previewToken: "task-project-move-preview",
    });

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        method: init?.method ?? "GET",
        path: `${new URL(String(url)).pathname}${new URL(String(url)).search}`,
      })),
    ).toEqual([
      { method: "GET", path: "/v1/tasks?lifecycle=open&limit=2" },
      { body: createTaskInput, method: "POST", path: "/v1/tasks" },
      { method: "GET", path: `/v1/tasks/${id}` },
      {
        body: { expectedRevision: 1, title: "Plan today" },
        method: "PATCH",
        path: `/v1/tasks/${id}`,
      },
      { body: { expectedRevision: 1 }, method: "POST", path: `/v1/tasks/${id}/complete` },
      { body: { expectedRevision: 1 }, method: "POST", path: `/v1/tasks/${id}/cancel` },
      { body: { expectedRevision: 1 }, method: "POST", path: `/v1/tasks/${id}/reopen` },
      { body: { expectedRevision: 1 }, method: "POST", path: `/v1/tasks/${id}/trash` },
      { body: { expectedRevision: 1 }, method: "POST", path: `/v1/tasks/${id}/restore` },
      {
        body: { destinationListId: accountId, destinationProjectId: null, expectedRevision: 1 },
        method: "POST",
        path: `/v1/tasks/${id}/move/preview`,
      },
      {
        body: {
          destinationListId: accountId,
          destinationProjectId: null,
          expectedRevision: 1,
          previewToken: "task-move-preview",
        },
        method: "POST",
        path: `/v1/tasks/${id}/move`,
      },
      { method: "GET", path: "/v1/task-lists?cursor=next&limit=2" },
      { body: createTaskListInput, method: "POST", path: "/v1/task-lists" },
      { method: "GET", path: `/v1/task-lists/${id}` },
      {
        body: { expectedRevision: 1, name: "Home" },
        method: "PATCH",
        path: `/v1/task-lists/${id}`,
      },
      { body: { expectedRevision: 1 }, method: "POST", path: `/v1/task-lists/${id}/archive` },
      { method: "GET", path: "/v1/task-projects?cursor=next&limit=2" },
      { body: createTaskProjectInput, method: "POST", path: "/v1/task-projects" },
      { method: "GET", path: `/v1/task-projects/${id}` },
      {
        body: { expectedRevision: 1, name: "Bedroom refresh" },
        method: "PATCH",
        path: `/v1/task-projects/${id}`,
      },
      { body: { expectedRevision: 1 }, method: "POST", path: `/v1/task-projects/${id}/complete` },
      { body: { expectedRevision: 1 }, method: "POST", path: `/v1/task-projects/${id}/cancel` },
      { body: { expectedRevision: 1 }, method: "POST", path: `/v1/task-projects/${id}/archive` },
      {
        body: { destinationListId: accountId, expectedRevision: 1 },
        method: "POST",
        path: `/v1/task-projects/${id}/move/preview`,
      },
      {
        body: {
          destinationListId: accountId,
          expectedRevision: 1,
          previewToken: "task-project-move-preview",
        },
        method: "POST",
        path: `/v1/task-projects/${id}/move`,
      },
    ]);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("serializes budget bucket routes with and without a month", async () => {
    const requests: Array<{ body: unknown; method: string; path: string }> = [];
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        requests.push({
          body: init?.body ? JSON.parse(String(init.body)) : null,
          method,
          path: url.pathname + url.search,
        });
        return json(method === "GET" ? { taxonomy: { buckets: [] } } : { buckets: [] });
      },
    });

    await expect(api.listFinanceBudgetBuckets()).resolves.toEqual({ taxonomy: { buckets: [] } });
    await expect(api.listFinanceBudgetBuckets("2026-08")).resolves.toEqual({
      taxonomy: { buckets: [] },
    });
    await expect(
      api.createFinanceBudgetBucket({
        description: null,
        idempotencyKey: "bucket-create",
        name: "Care",
      }),
    ).resolves.toEqual({ buckets: [] });
    await expect(
      api.updateFinanceBudgetBucket("bucket-1", {
        categoryIds: [],
        description: null,
        expectedVersion: 1,
        idempotencyKey: "bucket-update",
      }),
    ).resolves.toEqual({ buckets: [] });
    expect(requests).toEqual([
      { body: null, method: "GET", path: "/v1/finances/budget-buckets" },
      {
        body: null,
        method: "GET",
        path: "/v1/finances/budget-buckets?month=2026-08",
      },
      {
        body: { description: null, idempotencyKey: "bucket-create", name: "Care" },
        method: "POST",
        path: "/v1/finances/budget-buckets",
      },
      {
        body: {
          categoryIds: [],
          description: null,
          expectedVersion: 1,
          idempotencyKey: "bucket-update",
        },
        method: "PATCH",
        path: "/v1/finances/budget-buckets/bucket-1",
      },
    ]);
  });

  it("preserves agent dispositions for budget bucket mutations", async () => {
    const pending = { review: { id, status: "pending" }, status: "pending_review" };
    const needsInput = { question: { id, prompt: "Choose categories." }, status: "needs_input" };
    const responses = [pending, needsInput];
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async () => json(responses.shift()),
    });

    await expect(
      api.createFinanceBudgetBucket({
        description: null,
        idempotencyKey: "bucket-create-agent",
        name: "Care",
      }),
    ).resolves.toEqual(pending);
    await expect(
      api.updateFinanceBudgetBucket("bucket-1", {
        categoryIds: [],
        expectedVersion: 1,
        idempotencyKey: "bucket-update-agent",
      }),
    ).resolves.toEqual(needsInput);
  });

  it("uses typed Finance status and durable-maintenance routes", async () => {
    const requests: Array<{ body: string | null; method: string; path: string }> = [];
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          body: init?.body ? String(init.body) : null,
          method: init?.method ?? "GET",
          path: `${url.pathname}${url.search}`,
        });
        if (url.pathname === "/v1/finances/status") return json({ status: financeStatus });
        if (url.pathname === "/v1/finances/maintenance" && init?.method === "POST")
          return json({ run: financeMaintenanceRun }, 202);
        if (url.pathname === `/v1/finances/maintenance/${id}`)
          return json({ run: financeMaintenanceRun });
        return json({ error: { code: "not_found", message: "Not found" } }, 404);
      },
    });

    await expect(api.getFinanceStatus()).resolves.toEqual(financeStatus);
    await expect(
      api.startFinanceMaintenance({ type: "window", start: "2026-08-01", end: "2026-08-16" }),
    ).resolves.toEqual(financeMaintenanceRun);
    await expect(api.getWorkspaceFinanceMaintenanceRun(id)).resolves.toEqual(financeMaintenanceRun);

    expect(requests).toEqual([
      { body: null, method: "GET", path: "/v1/finances/status" },
      {
        body: JSON.stringify({
          scope: { type: "window", start: "2026-08-01", end: "2026-08-16" },
        }),
        method: "POST",
        path: "/v1/finances/maintenance",
      },
      { body: null, method: "GET", path: `/v1/finances/maintenance/${id}` },
    ]);
  });

  it("serializes Finance scenario comparisons and budget plans", async () => {
    const requests: Array<{ body: string | null; method: string; path: string }> = [];
    const scenarioInput = {
      alternatives: [],
      asOf: "2026-08-01",
      baseline: {
        assumptions: [],
        budgetAllocations: [],
        label: "Baseline",
        monthlyDebtPayment: 0,
        monthlyHousingCost: 0,
        monthlyIncome: 3000,
        monthlyReserveContribution: 250,
        startingCash: 1000,
      },
      horizonMonths: 3,
    };
    const scenario = {
      alternatives: [],
      asOf: "2026-08-01",
      assumptions: [],
      baseline: {
        debtPayoffMonths: null,
        goalDateEffects: [],
        label: "Baseline",
        monthlyCashFlow: 2750,
        projectedLowestBalance: 1000,
        reserveRunwayMonths: 4,
      },
      fingerprint: "scenario-fingerprint",
      goalConflicts: [],
      missingInputs: [],
      sensitivityWarnings: [],
    };
    const budgetPlan = {
      acknowledgeOverAllocation: false,
      allocations: [{ categoryId: id, limit: 250 }],
      assumptions: ["Income remains stable."],
      goalIds: [],
      month: "2026-08",
      rationale: "Allocate within reliable monthly capacity.",
      replace: true,
      scenarioFingerprint: "scenario-fingerprint",
    };
    const breakdown = {
      allocations: [{ amount: 12, categoryId: id, rationale: "Receipt." }],
      expectedTransactionUpdatedAt: now,
      rationale: "One-off receipt breakdown.",
    };
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          body: init?.body ? String(init.body) : null,
          method: init?.method ?? "GET",
          path: `${url.pathname}${url.search}`,
        });
        if (url.pathname === "/v1/finances/scenarios/compare") return json({ scenario });
        if (url.pathname === "/v1/finances/budget-plan") return json({ plan: budgetPlan });
        if (url.pathname === `/v1/finances/transactions/${id}/breakdown`)
          return json({ transaction: { allocations: [], id } });
        return json({ error: { code: "not_found", message: "Not found" } }, 404);
      },
    });

    await expect(api.compareFinanceScenarios(scenarioInput)).resolves.toEqual(scenario);
    await expect(api.setFinanceBudgetPlan(budgetPlan)).resolves.toEqual(budgetPlan);
    await expect(api.setFinanceTransactionBreakdown(id, breakdown)).resolves.toEqual({
      allocations: [],
      id,
    });

    expect(requests).toEqual([
      {
        body: JSON.stringify(scenarioInput),
        method: "POST",
        path: "/v1/finances/scenarios/compare",
      },
      {
        body: JSON.stringify(budgetPlan),
        method: "PUT",
        path: "/v1/finances/budget-plan",
      },
      {
        body: JSON.stringify(breakdown),
        method: "PUT",
        path: `/v1/finances/transactions/${id}/breakdown`,
      },
    ]);
  });

  it("forwards an agent Finance disposition instead of reading a human-only result field", async () => {
    // Returning response.plan here would turn a valid pending review into undefined.
    const pending = { status: "pending_review", review: { id, status: "pending" } };
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async () => json(pending),
    });

    await expect(
      api.setFinanceBudgetPlan({
        acknowledgeOverAllocation: false,
        allocations: [{ categoryId: id, limit: 250 }],
        assumptions: [],
        goalIds: [],
        month: "2026-08",
        rationale: "Allocate within reliable monthly capacity.",
        replace: true,
        scenarioFingerprint: null,
      }),
    ).resolves.toEqual(pending);
  });

  it("preserves root Finance dispositions for budget, profile, and recurring mutations", async () => {
    const applied = { result: { month: "2026-08" }, status: "applied" };
    const pending = { review: { id, status: "pending" }, status: "pending_review" };
    const needsInput = { question: { id, prompt: "Choose status." }, status: "needs_input" };
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        return json(
          path === "/v1/finances/budget-plan"
            ? applied
            : path === "/v1/finances/profile"
              ? pending
              : needsInput,
        );
      },
    });
    await expect(
      api.setFinanceBudgetPlan({
        acknowledgeOverAllocation: false,
        allocations: [{ categoryId: id, limit: 1 }],
        assumptions: [],
        goalIds: [],
        month: "2026-08",
        rationale: "Test",
        replace: true,
        scenarioFingerprint: null,
      }),
    ).resolves.toEqual(applied);
    await expect(
      api.updateFinanceProfile({
        effectiveDate: "2026-08-01",
        employer: null,
        employmentType: null,
        expectedNetPay: null,
        grossAnnualIncome: null,
        nextPayday: null,
        payAccountId: null,
        payFrequency: null,
        role: null,
      }),
    ).resolves.toEqual(pending);
    await expect(api.updateFinanceRecurringObligation(id, { status: "active" })).resolves.toEqual(
      needsInput,
    );
  });

  it("uses exact action-review transport paths and result envelopes", async () => {
    const requests: Array<{ body: string | null; method: string; path: string }> = [];
    const review = { id, status: "dismissed" };
    const outcome = { result: { id }, status: "applied" };
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          body: init?.body ? String(init.body) : null,
          method: init?.method ?? "GET",
          path: `${url.pathname}${url.search}`,
        });
        return json(
          url.pathname.endsWith("/approve")
            ? { outcome }
            : url.pathname.endsWith("/dismiss")
              ? { review }
              : { reviews: [review] },
        );
      },
    });
    await expect(api.listFinanceActionReviews(7)).resolves.toEqual([review]);
    await expect(api.approveFinanceActionReview(id)).resolves.toEqual(outcome);
    await expect(api.dismissFinanceActionReview(id)).resolves.toEqual(review);
    expect(requests).toEqual([
      { body: null, method: "GET", path: "/v1/finances/action-reviews?limit=7" },
      { body: null, method: "POST", path: `/v1/finances/action-reviews/${id}/approve` },
      { body: null, method: "POST", path: `/v1/finances/action-reviews/${id}/dismiss` },
    ]);
  });

  it.each([
    { result: { refreshed: true }, status: "applied" },
    { review: { id, status: "pending" }, status: "pending_review" },
    { question: { id, prompt: "Need evidence." }, status: "needs_input" },
  ])("preserves refresh Finance action disposition $status", async (outcome) => {
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async () => json(outcome),
    });
    await expect(api.refreshFinanceInsights()).resolves.toEqual(outcome);
  });

  it("lists public Finance questions through the dedicated recovery endpoint", async () => {
    const question = {
      id,
      prompt: "Choose a replacement account.",
      why: "The account is unavailable.",
    };
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(`${url.pathname}${url.search}`).toBe("/v1/finances/questions?limit=3");
        return json({ questions: [question] });
      },
    });
    await expect(api.listFinanceQuestions(3)).resolves.toEqual([question]);
  });

  it("forwards typed reimbursement answers through the bounded question envelope", async () => {
    let body: string | null = null;
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async (_input, init) => {
        body = String(init?.body ?? null);
        return json({ outcome: { result: { reimbursementId: id }, status: "applied" } });
      },
    });
    await expect(
      api.answerFinanceQuestion(id, {
        amount: 220,
        dueDate: null,
        kind: "reimbursable",
        payer: "Alex",
        rationale: "Alex owes their share.",
      }),
    ).resolves.toMatchObject({ status: "applied" });
    expect(JSON.parse(body ?? "{}")).toEqual({
      answer: JSON.stringify({
        answer: {
          amount: 220,
          dueDate: null,
          kind: "reimbursable",
          payer: "Alex",
          rationale: "Alex owes their share.",
        },
      }),
    });
  });

  it("preserves Finance maintenance API errors with their request IDs", async () => {
    const api = createApiClient({
      baseUrl: "https://api.example.com",
      fetch: async () =>
        json(
          {
            error: {
              code: "conflict",
              details: { activeRunId: id },
              message: "A Finance maintenance run is already active.",
              requestId: "finance-maintenance-request-123",
            },
          },
          409,
        ),
    });

    await expect(api.startFinanceMaintenance()).rejects.toMatchObject({
      code: "conflict",
      details: { activeRunId: id },
      requestId: "finance-maintenance-request-123",
      status: 409,
    });
  });

  it("calls every API operation and serializes query parameters", async () => {
    const fetch = apiFetch();
    const api = createApiClient({
      baseUrl: "https://api.example.com/",
      fetch,
      headers: { "x-ilo-client": "web" },
      token: "pos_token",
    });
    expect(api).not.toHaveProperty("listAutomations");
    expect(api).not.toHaveProperty("runAutomation");
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
    await expect(api.getCalendarStatus()).resolves.toEqual(calendarStatus);
    await expect(api.createCalendarReview()).resolves.toEqual(calendarReview);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/calendars/reviews",
      expect.objectContaining({
        body: JSON.stringify({ scope: { type: "all_outstanding" } }),
        method: "POST",
      }),
    );
    await expect(
      api.createCalendar({ name: "Personal", color: null, timezone: "UTC" }),
    ).resolves.toEqual(calendar);
    await expect(api.updateCalendar(id, { name: "Home" })).resolves.toEqual(calendar);
    await expect(api.setCalendarSelected(id, false)).resolves.toEqual(calendar);
    await api.deleteCalendar(id);
    await expect(
      api.previewCalendarCommitment({
        candidate: commitmentCandidate,
        requestedPolicy: "approved_rule",
      }),
    ).resolves.toEqual(commitmentProposal);
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
    await expect(api.getEvent(id)).resolves.toEqual(event);
    await expect(api.updateEvent(id, { title: "Deep focus" })).resolves.toEqual(event);
    await expect(api.createEventBlock(id, { calendarId: id, mode: "busy" })).resolves.toEqual(
      event,
    );
    await expect(api.updateEventBlock(id, id, { mode: "details" })).resolves.toEqual(event);
    await expect(api.deleteEventBlock(id, id)).resolves.toEqual(event);
    await expect(
      api.deleteEventBlock(id, id, {
        expectedBlockUpdatedAt: now,
        expectedUpdatedAt: now,
      }),
    ).resolves.toEqual(event);
    await expect(api.restoreEvent(id)).resolves.toEqual(event);
    await expect(
      api.trashEvent(id, { expectedBlockUpdatedAtById: {}, expectedUpdatedAt: now }),
    ).resolves.toEqual({ blockUpdatedAtById: {}, eventId: id, updatedAt: now });
    await expect(
      api.upsertCalendarAttentionItem(id, {
        expiresAt: null,
        importance: "high",
        kind: "upcoming",
        occursAt: now,
        summary: "Prepare.",
        title: "Upcoming event",
      }),
    ).resolves.toEqual(attentionItem);
    await api.deleteEvent(id);
    await api.deleteEvent(id, { expectedBlockUpdatedAtById: {}, expectedUpdatedAt: now });
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
    await expect(api.getReminder(id)).resolves.toEqual(reminder);
    await expect(
      api.previewOverdueReminderDeferral({
        limit: 25,
        overdueBefore: now,
        proposedDueAt: "2026-07-14T13:00:00.000Z",
        timezone: "America/New_York",
      }),
    ).resolves.toMatchObject({ matchedCount: 1, policy: "preview" });
    await expect(api.updateReminder(id, { title: "Changed" })).resolves.toEqual(reminder);
    await expect(api.completeReminder(id, true)).resolves.toEqual(reminder);
    await expect(api.restoreReminder(id)).resolves.toEqual(reminder);
    await expect(api.trashReminder(id, now)).resolves.toEqual(reminder);
    await expect(
      api.upsertReminderAttentionItem(id, {
        expiresAt: null,
        importance: "high",
        kind: "follow_up",
        occursAt: now,
        summary: "Clarify this reminder.",
        title: "Reminder needs review",
      }),
    ).resolves.toEqual(attentionItem);
    await api.deleteReminder(id);
    await expect(api.listTasks({ lifecycle: "open", limit: 10 })).resolves.toEqual({
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
        lifecycle: "open",
        tags: ["planning"],
        why: null,
      }),
    ).resolves.toEqual(task);
    await expect(api.getTask(id)).resolves.toEqual(task);
    await expect(api.updateTask(id, { expectedRevision: 1, title: "Plan today" })).resolves.toEqual(
      task,
    );
    await expect(api.completeTask(id, { expectedRevision: 1 })).resolves.toEqual(task);
    await expect(api.cancelTask(id, { expectedRevision: 1 })).resolves.toEqual(task);
    await expect(api.reopenTask(id, { expectedRevision: 1 })).resolves.toEqual(task);
    await expect(api.trashTask(id, { expectedRevision: 1 })).resolves.toEqual(task);
    await expect(api.restoreTask(id, { expectedRevision: 1 })).resolves.toEqual(task);
    await expect(
      api.previewTaskMove(id, {
        destinationListId: accountId,
        destinationProjectId: null,
        expectedRevision: 1,
      }),
    ).resolves.toEqual(taskMovePreview);
    await expect(
      api.moveTask(id, {
        destinationListId: accountId,
        destinationProjectId: null,
        expectedRevision: 1,
        previewToken: "task-move-preview",
      }),
    ).resolves.toEqual(task);
    await expect(api.listTaskLists({ limit: 10 })).resolves.toEqual({
      items: [taskList],
      nextCursor: null,
    });
    await expect(
      api.createTaskList({ color: null, description: null, name: "Personal" }),
    ).resolves.toEqual(taskList);
    await expect(api.getTaskList(id)).resolves.toEqual(taskList);
    await expect(api.updateTaskList(id, { expectedRevision: 1, name: "Home" })).resolves.toEqual(
      taskList,
    );
    await expect(api.archiveTaskList(id, { expectedRevision: 1 })).resolves.toEqual(taskList);
    await expect(api.listTaskProjects({ limit: 10 })).resolves.toEqual({
      items: [taskProject],
      nextCursor: null,
    });
    await expect(
      api.createTaskProject({
        listId: id,
        name: "Home refresh",
        notes: null,
        targetDate: null,
        why: null,
      }),
    ).resolves.toEqual(taskProject);
    await expect(api.getTaskProject(id)).resolves.toEqual(taskProject);
    await expect(
      api.updateTaskProject(id, { expectedRevision: 1, name: "Bedroom refresh" }),
    ).resolves.toEqual(taskProject);
    await expect(api.completeTaskProject(id, { expectedRevision: 1 })).resolves.toEqual(
      taskProject,
    );
    await expect(api.cancelTaskProject(id, { expectedRevision: 1 })).resolves.toEqual(taskProject);
    await expect(api.archiveTaskProject(id, { expectedRevision: 1 })).resolves.toEqual(taskProject);
    await expect(
      api.previewTaskProjectMove(id, { destinationListId: accountId, expectedRevision: 1 }),
    ).resolves.toEqual(taskProjectMovePreview);
    await expect(
      api.moveTaskProject(id, {
        destinationListId: accountId,
        expectedRevision: 1,
        previewToken: "task-project-move-preview",
      }),
    ).resolves.toEqual(taskProject);
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
    await expect(api.getFinanceAutomationSettings()).resolves.toEqual({
      reviewBypassEnabled: false,
    });
    await expect(
      api.updateFinanceAutomationSettings({ reviewBypassEnabled: true }),
    ).resolves.toEqual({ reviewBypassEnabled: true });
    await expect(api.getFinanceGuidedSetup()).resolves.toMatchObject({
      accountSources: [financeAccount],
      humanOnlyActions: expect.arrayContaining(["create_merchant_rule"]),
    });
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
      api.mergeFinanceMerchants({
        rationale: "Confirmed duplicate aliases.",
        sourceMerchantId: accountId,
        targetMerchantId: id,
      }),
    ).resolves.toEqual(financeMerchant);
    await expect(
      api.mergeFinanceMerchantsCanonical({
        idempotencyKey: "merchant-merge-1",
        rationale: "Confirmed duplicate aliases.",
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
    await expect(api.proposeFinanceCategorizations()).resolves.toEqual({
      items: [],
      nextCursor: "next-review-page",
    });
    await expect(
      api.upsertFinanceAttentionItem(accountId, {
        expiresAt: null,
        importance: "high",
        kind: "important",
        occursAt: null,
        summary: attentionItem.summary,
        title: attentionItem.title,
      }),
    ).resolves.toEqual(attentionItem);
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
      api.startFinanceAccountConnection({ idempotencyKey: "connect-1", provider: "plaid" }),
    ).resolves.toMatchObject({ data: { connectionId: id } });
    await expect(api.getFinanceAccountConnection(id)).resolves.toMatchObject({
      data: { status: "connected" },
    });
    await expect(
      api.listFinanceAccounts({ includeExcluded: false, kind: "cash", query: "Checking" }),
    ).resolves.toMatchObject({ accounts: [financeAccount], totals: { netWorth: 1200 } });
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
    await expect(
      api.splitFinanceTransaction({
        expectedVersion: 1,
        idempotencyKey: "split-1",
        parts: [
          { amount: 1, categoryId: id, meaning: "First", notes: null },
          { amount: 1, categoryId: accountId, meaning: "Second", notes: null },
        ],
        transactionId: id,
      }),
    ).resolves.toMatchObject({ data: [financeTransaction] });
    await expect(
      api.classifyFinanceTransactions({
        classifications: [
          {
            categoryId: id,
            confidence: 0.9,
            meaning: "Dining",
            rationale: "Restaurant purchase",
            transactionId: accountId,
          },
        ],
        idempotencyKey: "classify-1",
      }),
    ).resolves.toMatchObject({ data: [financeTransaction] });
    await expect(
      api.linkFinanceTransactions({
        idempotencyKey: "link-1",
        rationale: "Matching transfer",
        relationship: "transfer",
        transactionIds: [id, accountId],
      }),
    ).resolves.toMatchObject({ data: { relationship: "transfer" } });
    await expect(api.listFinanceRules()).resolves.toMatchObject({ data: [] });
    await expect(
      api.manageFinanceRule({
        category: "Dining",
        idempotencyKey: "rule-1",
        merchant: "Cafe",
        operation: "create",
      }),
    ).resolves.toMatchObject({ data: { id } });
    await expect(api.listFinanceRecurringItems()).resolves.toMatchObject({
      data: { income: [], obligations: [] },
    });
    await expect(
      api.manageFinanceRecurringItem({
        idempotencyKey: "recurring-1",
        itemId: id,
        itemType: "obligation",
        operation: "pause",
      }),
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
    await expect(api.listConnectors()).resolves.toEqual([
      expect.objectContaining({
        health: {
          message: null,
          nextSyncAt: "2026-07-13T12:05:00.000Z",
          recovery: null,
          state: "ready",
        },
      }),
    ]);
    await expect(api.getConnectorAuthorizationAttempt(id)).resolves.toEqual({
      accountId,
      provider: "google",
      retryable: false,
      status: "connected",
    });
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
    await expect(api.getIloContext()).resolves.toMatchObject({
      access: { grantedScopes: ["mail:read", "mail:write"] },
      identity: { actorType: "agent", displayName: "Test" },
      links: { today: "https://app.example.com/today" },
      time: { timezone: "UTC" },
    });
    await expect(
      api.getIloSetup({ domain: "mail", stepId: "learn_preferences" }),
    ).resolves.toMatchObject({
      currentStepId: "learn_preferences",
      domain: "mail",
      selectedStepId: "learn_preferences",
    });
    await expect(api.getAgentConnectionGuide()).resolves.toMatchObject({
      mcpUrl: "https://mcp.example.com/mcp",
      skill: { name: "ilo-setup" },
    });
    await expect(
      api.listAgentAccessWorkItems({ cursor: "opaque-next", kind: "review", limit: 10 }),
    ).resolves.toMatchObject({ items: [], nextCursor: null, summary: { total: 0 } });
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
      api.updateAttentionItem("mail", id, { expectedVersion: 1, status: "resolved" }),
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
    const guardedEventDelete = fetch.mock.calls.find(
      ([url, init]) =>
        new URL(String(url)).pathname === `/v1/events/${id}/trash` && init?.method === "POST",
    );
    expect(JSON.parse(String(guardedEventDelete?.[1]?.body))).toEqual({
      expectedBlockUpdatedAtById: {},
      expectedUpdatedAt: now,
    });
    const legacyEventDelete = fetch.mock.calls.find(
      ([url, init]) =>
        new URL(String(url)).pathname === `/v1/events/${id}` && init?.method === "DELETE",
    );
    expect(legacyEventDelete?.[1]?.body).toBeUndefined();
    const guardedBlockDelete = fetch.mock.calls.find(
      ([url, init]) =>
        new URL(String(url)).pathname === `/v1/events/${id}/blocks/${id}/trash` &&
        init?.method === "POST",
    );
    expect(JSON.parse(String(guardedBlockDelete?.[1]?.body))).toEqual({
      expectedBlockUpdatedAt: now,
      expectedUpdatedAt: now,
    });
    const legacyBlockDelete = fetch.mock.calls.find(
      ([url, init]) =>
        new URL(String(url)).pathname === `/v1/events/${id}/blocks/${id}` &&
        init?.method === "DELETE",
    );
    expect(legacyBlockDelete?.[1]?.body).toBeUndefined();
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
