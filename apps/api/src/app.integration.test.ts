import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
  GoogleConnector,
  GoogleCredentials,
  ICloudConnector,
  XConnector,
} from "@personal-os/connectors";
import {
  auditEvents,
  automationRoutines,
  automationRuns,
  calendarAccounts,
  calendarEvents,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  financeTransactions,
  mailThreads,
  migrateDatabase,
  reminders,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, inArray } from "drizzle-orm";
import { createApp, type PersonalOsApp } from "./app.js";
import { createAuthService } from "./auth-service.js";
import { createAutomationService } from "./automation-service.js";
import type { EmailMessage } from "./email-delivery.js";
import { DEMO_QA_PASSWORD, loadQaFixtures, qaFixtureAccounts } from "./qa-fixtures.js";
import { createRuntimeLifecycle } from "./runtime-lifecycle.js";
import { verifyPassword } from "./security.js";

const invalidLowercasePassword = ["alllowercase", "123", "!"].join("");

type RequestOptions = {
  auth?: "agent" | "none" | "session";
  body?: unknown;
  headers?: Record<string, string>;
  method?: string;
  rawBody?: string;
};

describe.sequential("ilo API", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let app: PersonalOsApp;
  let sessionToken = "";
  let agentToken = "";
  const logs = vi.fn();
  const weatherFetch = vi.fn();
  const deliveredEmails: EmailMessage[] = [];
  const icloudConnector: ICloudConnector = {
    createEvent: vi.fn(),
    deleteEvent: vi.fn(),
    listCalendars: vi.fn(async () => []),
    syncCalendar: vi.fn(),
    syncMail: vi.fn(async () => ({
      mailboxes: [
        { id: "INBOX", name: "Inbox", role: "inbox" as const, totalCount: 1, unreadCount: 1 },
      ],
      threads: [
        {
          bodyText: "Integration mail body",
          from: { address: "sender@icloud.com", name: "Sender" },
          mailboxIds: ["INBOX"],
          messageCount: 1,
          receivedAt: new Date("2026-07-13T12:00:00.000Z"),
          remoteThreadId: "integration-thread",
          snippet: "Integration mail",
          starred: false,
          subject: "Integration mail",
          to: [],
          unread: true,
        },
      ],
    })),
    updateEvent: vi.fn(),
  };
  const xConnector: XConnector = {
    authorizationUrl: vi.fn((state) => `https://x.example.com/auth?state=${state}`),
    exchangeCode: vi.fn(async () => ({
      accessToken: "x-access",
      expiresAt: "2026-07-13T13:00:00.000Z",
      refreshToken: "x-refresh",
      scope: "bookmark.read",
      tokenType: "Bearer",
    })),
    getProfile: vi.fn(async (credentials) => ({
      credentials,
      value: { id: "x-user", name: "X User", username: "xuser" },
    })),
    listBookmarkFolders: vi.fn(async (credentials) => ({
      credentials,
      value: [{ id: "x-folder", name: "Calendar" }],
    })),
    listFolderBookmarks: vi.fn(async (credentials) => ({
      credentials,
      value: [
        {
          authorId: "x-author",
          authorName: "X Author",
          authorUsername: "xauthor",
          postedAt: new Date("2026-07-13T11:00:00.000Z"),
          raw: { id: "x-post" },
          remotePostId: "x-post",
          text: "Save the date",
          url: "https://x.com/xauthor/status/x-post",
        },
      ],
    })),
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    app = createApp({
      config: {
        allowedOrigins: ["https://app.example.com"],
        apiBaseUrl: "https://api.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://app.example.com",
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 1).toString("base64"),
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: "https://api.example.com/v1/connectors/google/callback",
        logLevel: "info",
        port: 8787,
        plaidClientId: "",
        plaidEnvironment: "sandbox",
        plaidSecret: "",
        production: false,
        resendApiKey: "",
        sessionCookieName: "personal_os_session",
        sessionTtlDays: 30,
        trustProxy: true,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
      fetch: weatherFetch,
      email: { send: async (message) => void deliveredEmails.push(message) },
      icloud: icloudConnector,
      log: logs,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      runtimeLifecycle: createRuntimeLifecycle(),
      x: xConnector,
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  async function request(path: string, options: RequestOptions = {}) {
    const headers = new Headers(options.headers);
    if (options.auth === "session" || (options.auth === undefined && sessionToken)) {
      headers.set("authorization", `Session ${sessionToken}`);
    }
    if (options.auth === "agent") headers.set("authorization", `Bearer ${agentToken}`);
    const hasBody = options.body !== undefined || options.rawBody !== undefined;
    if (hasBody) headers.set("content-type", "application/json");
    return app.request(path, {
      ...(hasBody ? { body: options.rawBody ?? JSON.stringify(options.body) } : {}),
      headers,
      method: options.method ?? (hasBody ? "POST" : "GET"),
    });
  }

  async function payload(response: Response) {
    return response.status === 204 ? null : response.json();
  }

  it("runs the Finance maintenance entry points", async () => {
    await expect(app.backfillFinanceCashflowInsights()).resolves.toEqual({ processed: 0 });
    await expect(app.backfillFinanceLedgerIntegrity()).resolves.toMatchObject({ processed: 0 });
    await expect(app.backfillFinanceLearning()).resolves.toEqual({ processed: 0 });
    await expect(app.backfillFinanceSetupIntegrity()).resolves.toMatchObject({
      categoriesComplete: true,
      categoriesInserted: 0,
      claimed: true,
      profilesComplete: true,
      profilesDemoted: 0,
    });
    await expect(app.syncDueFinances()).resolves.toEqual({ failed: 0, reasons: [], synced: 0 });
  });

  it("enforces owner-issued, one-time invitations for private beta sign-up", async () => {
    const betaApp = createApp({
      config: {
        allowedOrigins: ["https://beta.example.com"],
        apiBaseUrl: "https://api.beta.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://beta.example.com",
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 3).toString("base64"),
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: "https://api.beta.example.com/v1/connectors/google/callback",
        logLevel: "info",
        ownerEmails: ["beta-owner@example.com"],
        plaidClientId: "",
        plaidEnvironment: "sandbox",
        plaidSecret: "",
        port: 8787,
        production: true,
        registrationMode: "invite",
        resendApiKey: "",
        sessionCookieName: "beta_session",
        sessionTtlDays: 7,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.beta.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
    });
    expect((await betaApp.request("/health/ready")).headers.get("x-ilo-drain-protocol")).toBeNull();
    const signUp = (email: string, inviteCode?: string) =>
      betaApp.request("/v1/auth/register", {
        body: JSON.stringify({
          displayName: email.split("@")[0],
          email,
          ...(inviteCode ? { inviteCode } : {}),
          password: "LocalTestOnly123!",
          planningTimezone: "UTC",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    const validateInvitation = async (inviteCode: string) => {
      const response = await betaApp.request("/v1/auth/invitations/validate", {
        body: JSON.stringify({ inviteCode }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return (await response.json()).valid as boolean;
    };

    expect((await signUp("beta-friend@example.com")).status).toBe(403);
    expect(await validateInvitation("BAD12345")).toBe(false);
    const ownerRegistration = await signUp("beta-owner@example.com");
    expect(ownerRegistration.status).toBe(201);
    const ownerSession = (await ownerRegistration.json()).sessionToken as string;
    const invitationResponse = await betaApp.request("/v1/invitations", {
      body: JSON.stringify({ email: "beta-friend@example.com", expiresInDays: 14 }),
      headers: { authorization: `Session ${ownerSession}`, "content-type": "application/json" },
      method: "POST",
    });
    expect(invitationResponse.status).toBe(201);
    const invitation = (await invitationResponse.json()).invitation as { code: string };
    expect(invitation.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await validateInvitation(invitation.code)).toBe(true);
    expect((await signUp("beta-friend@example.com", invitation.code)).status).toBe(201);
    expect(await validateInvitation(invitation.code)).toBe(false);
    expect((await signUp("another-friend@example.com", invitation.code)).status).toBe(403);

    const recoveryApp = createApp({
      config: {
        allowedOrigins: ["https://beta.example.com"],
        apiBaseUrl: "https://api.beta.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://beta.example.com",
        authRateLimitMaxRequests: 1,
        authRateLimitWindowSeconds: 300,
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 4).toString("base64"),
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: "https://api.beta.example.com/v1/connectors/google/callback",
        logLevel: "info",
        plaidClientId: "",
        plaidEnvironment: "sandbox",
        plaidSecret: "",
        port: 8787,
        production: false,
        resendApiKey: "",
        sessionCookieName: "recovery_session",
        sessionTtlDays: 7,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.beta.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
    });
    const recovery = () =>
      recoveryApp.request("/v1/auth/recovery", {
        body: JSON.stringify({ email: "beta-friend@example.com" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    expect((await recovery()).status).toBe(204);
    const limitedRecovery = await recovery();
    expect(limitedRecovery.status).toBe(429);
    expect(limitedRecovery.headers.get("retry-after")).toBe("300");
  });

  it("loads repeatable QA personas without touching ordinary accounts", async () => {
    const fixtureNow = new Date("2026-07-28T14:00:00.000Z");
    await database.db.insert(users).values({
      displayName: "Unrelated account",
      email: "qa-unrelated@example.com",
      passwordHash: "not-a-fixture",
      planningTimezone: "UTC",
    });
    await expect(loadQaFixtures(database.db, { now: fixtureNow })).resolves.toMatchObject({
      accountCount: qaFixtureAccounts.length,
    });
    const fixtureEmails = qaFixtureAccounts.map((account) => account.email);
    const fixtureUsers = await database.db
      .select()
      .from(users)
      .where(inArray(users.email, fixtureEmails));
    expect(fixtureUsers).toHaveLength(qaFixtureAccounts.length);
    const demo = fixtureUsers.find((record) => record.email === "demo+full@ilo.test");
    const onboarding = fixtureUsers.find((record) => record.email === "qa+onboarding-new@ilo.test");
    const resumed = fixtureUsers.find((record) => record.email === "qa+onboarding-google@ilo.test");
    const apple = fixtureUsers.find((record) => record.email === "qa+onboarding-apple@ilo.test");
    const finances = fixtureUsers.find(
      (record) => record.email === "qa+onboarding-finances@ilo.test",
    );
    const ready = fixtureUsers.find((record) => record.email === "qa+onboarding-ready@ilo.test");
    const empty = fixtureUsers.find((record) => record.email === "qa+empty@ilo.test");
    const degraded = fixtureUsers.find((record) => record.email === "qa+recovery@ilo.test");
    expect(demo).toBeDefined();
    expect(onboarding).toMatchObject({ emailVerifiedAt: null, setupStatus: "not_started" });
    expect(resumed).toMatchObject({ setupCurrentStep: "google", setupStatus: "in_progress" });
    expect(apple).toMatchObject({ setupCurrentStep: "icloud", setupStatus: "in_progress" });
    expect(finances).toMatchObject({
      setupCurrentStep: "finances",
      setupStatus: "in_progress",
    });
    expect(ready).toMatchObject({ setupCurrentStep: "ready", setupStatus: "in_progress" });
    expect(empty).toMatchObject({ setupStatus: "complete" });
    expect(degraded).toBeDefined();
    expect(await verifyPassword(DEMO_QA_PASSWORD, demo?.passwordHash ?? "")).toBe(true);

    const [events, messages, transactions, profiles, emptyTasks, degradedAccounts] =
      await Promise.all([
        database.db
          .select()
          .from(calendarEvents)
          .where(eq(calendarEvents.userId, demo?.id ?? "")),
        database.db
          .select()
          .from(mailThreads)
          .where(eq(mailThreads.userId, demo?.id ?? "")),
        database.db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.userId, demo?.id ?? "")),
        database.db
          .select()
          .from(domainProfiles)
          .where(eq(domainProfiles.userId, demo?.id ?? "")),
        database.db
          .select()
          .from(reminders)
          .where(eq(reminders.userId, empty?.id ?? "")),
        database.db
          .select()
          .from(calendarAccounts)
          .where(eq(calendarAccounts.userId, degraded?.id ?? "")),
      ]);
    expect(events).toHaveLength(7);
    expect(messages).toHaveLength(5);
    expect(transactions).toHaveLength(9);
    expect(profiles).toContainEqual(expect.objectContaining({ domain: "mail", status: "active" }));
    expect(emptyTasks).toEqual([]);
    expect(degradedAccounts).toContainEqual(
      expect.objectContaining({ provider: "google", syncStatus: "error" }),
    );

    await loadQaFixtures(database.db, { now: new Date("2026-07-29T14:00:00.000Z") });
    expect(
      await database.db.select().from(users).where(inArray(users.email, fixtureEmails)),
    ).toHaveLength(qaFixtureAccounts.length);
    expect(
      await database.db.select().from(users).where(eq(users.email, "qa-unrelated@example.com")),
    ).toHaveLength(1);
  });

  it("serves health, registration, sessions, tokens, reminders, calendars, events, and audit", async () => {
    await app.dispatchDueAutomations();
    const live = await request("/health/live", { auth: "none" });
    expect(await payload(live)).toEqual({
      status: "ok",
    });
    expect(live.headers.get("x-ilo-drain-protocol")).toBeNull();
    const ready = await request("/health/ready", { auth: "none" });
    expect(await payload(ready)).toEqual({
      status: "ready",
    });
    expect(ready.headers.get("x-ilo-drain-protocol")).toBe("quiesce-v1");
    expect((await payload(await request("/openapi.json", { auth: "none" }))).servers).toEqual([
      { url: "https://api.example.com" },
    ]);
    expect((await request("/missing", { auth: "none" })).status).toBe(404);
    expect((await request("/v1/auth/register", { auth: "none", rawBody: "{" })).status).toBe(400);

    const registration = await request("/v1/auth/register", {
      auth: "none",
      body: {
        displayName: "Test User",
        email: "test@example.com",
        password: "LocalTestOnly123!",
        planningTimezone: "America/New_York",
      },
      headers: { origin: "https://app.example.com", "x-request-id": "register-request" },
    });
    expect(registration.status).toBe(201);
    expect(registration.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(registration.headers.get("x-request-id")).toBe("register-request");
    const registrationBody = await payload(registration);
    sessionToken = registrationBody.sessionToken;
    expect(sessionToken).toMatch(/^sess_/);
    expect(registrationBody.user).toMatchObject({
      email: "test@example.com",
      displayName: "Test User",
      setup: {
        completedAt: null,
        currentStep: "welcome",
        dismissedAt: null,
        selectedWorkspaces: ["calendar", "tasks", "mail", "finances"],
        startedAt: null,
        status: "not_started",
      },
    });
    expect((await request("/v1/setup", { auth: "none", method: "PATCH" })).status).toBe(401);
    expect(
      (
        await payload(
          await request("/v1/setup", {
            body: {
              action: "progress",
              currentStep: "google",
              selectedWorkspaces: ["calendar", "mail"],
            },
            method: "PATCH",
          }),
        )
      ).user.setup,
    ).toEqual({
      completedAt: null,
      currentStep: "google",
      dismissedAt: null,
      selectedWorkspaces: ["calendar", "mail"],
      startedAt: "2026-07-13T12:00:00.000Z",
      status: "in_progress",
    });
    expect(
      (
        await payload(
          await request("/v1/setup", {
            body: { action: "dismiss" },
            method: "PATCH",
          }),
        )
      ).user.setup,
    ).toMatchObject({
      currentStep: "google",
      dismissedAt: "2026-07-13T12:00:00.000Z",
      status: "dismissed",
    });
    expect((await request("/v1/weather")).status).toBe(400);
    weatherFetch.mockResolvedValueOnce(
      Response.json({
        results: [
          {
            admin1: "New York",
            country: "United States",
            latitude: 40.7128,
            longitude: -74.006,
            name: "New York",
          },
        ],
      }),
    );
    expect(
      (await payload(await request("/v1/weather/locations?query=New%20York"))).locations,
    ).toEqual([
      {
        coordinates: { latitude: 40.7128, longitude: -74.006 },
        label: "New York, New York, United States",
      },
    ]);
    expect((await request("/v1/weather/locations?query=N")).status).toBe(400);
    expect((await request("/v1/weather/locations?query=New%20York", { auth: "none" })).status).toBe(
      401,
    );
    weatherFetch.mockResolvedValueOnce(
      Response.json({
        address: { city: "New York", country: "United States", state: "New York" },
      }),
    );
    weatherFetch.mockResolvedValueOnce(
      Response.json({
        current: { precipitation: 0.1, temperature_2m: 72, weather_code: 63 },
      }),
    );
    weatherFetch.mockResolvedValueOnce(Response.json({ current: { us_aqi: 125 } }));
    expect(
      (await payload(await request("/v1/weather?latitude=40.7&longitude=-74"))).weather,
    ).toEqual({
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
      observedAt: "2026-07-13T12:00:00.000Z",
      temperatureF: 72,
      usAqi: 125,
    });

    const financeAccountResponse = await request("/v1/finances/accounts", {
      body: { balance: 125, institution: "Cash", name: "Wallet", provider: "manual" },
    });
    expect(financeAccountResponse.status).toBe(201);
    const financeAccount = (await payload(financeAccountResponse)).account;
    const financeTransactionResponse = await request("/v1/finances/transactions", {
      body: {
        accountId: financeAccount.id,
        amount: 12.5,
        category: null,
        categoryConfidence: null,
        date: "2026-07-13",
        direction: "expense",
        merchant: "Trader Joe's",
        notes: null,
      },
    });
    expect(financeTransactionResponse.status).toBe(201);
    const financeTransaction = (await payload(financeTransactionResponse)).transaction;
    expect(
      (
        await request(`/v1/finances/transactions/${financeTransaction.id}`, {
          body: { category: "Groceries" },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    const categories = (await payload(await request("/v1/finances/categories"))).categories;
    const shopping = categories.find((item: { slug: string }) => item.slug === "shopping");
    if (!shopping) throw new Error("Shopping category was not seeded.");
    const [merchant] = (await payload(await request("/v1/finances/merchants"))).merchants;
    expect(merchant).toMatchObject({ aliases: ["Trader Joe's"], isUserConfirmed: false });
    expect(
      (
        await request(`/v1/finances/merchants/${merchant.id}`, {
          body: { displayName: "Trader Joe's Market" },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect((await payload(await request("/v1/finances/merchants"))).merchants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: "Trader Joe's Market", isUserConfirmed: true }),
      ]),
    );
    const variantResponse = await request("/v1/finances/transactions", {
      body: {
        accountId: financeAccount.id,
        amount: 6,
        category: null,
        categoryConfidence: null,
        date: "2026-07-13",
        direction: "expense",
        merchant: "TRADER JOES EXPRESS",
        notes: null,
      },
    });
    expect(variantResponse.status).toBe(201);
    const merchantsBeforeMerge = (await payload(await request("/v1/finances/merchants"))).merchants;
    const sourceMerchant = merchantsBeforeMerge.find(
      (item: { id: string }) => item.id !== merchant.id,
    );
    if (!sourceMerchant) throw new Error("Variant merchant was not created.");
    expect(
      (
        await request("/v1/finances/merchants/merge", {
          body: {
            rationale: "Confirmed duplicate aliases.",
            sourceMerchantId: sourceMerchant.id,
            targetMerchantId: merchant.id,
          },
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect((await payload(await request("/v1/finances/merchants"))).merchants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ aliases: expect.arrayContaining(["TRADER JOES EXPRESS"]) }),
      ]),
    );
    expect((await payload(await request("/v1/finances/transactions?limit=10"))).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: financeTransaction.id })]),
    );
    const reviewCandidateResponse = await request("/v1/finances/transactions", {
      body: {
        accountId: financeAccount.id,
        amount: 4,
        category: null,
        categoryConfidence: null,
        date: "2026-07-13",
        direction: "expense",
        merchant: "Mystery Agent Review",
        notes: null,
      },
    });
    expect(reviewCandidateResponse.status).toBe(201);
    const reviewCandidate = (await payload(reviewCandidateResponse)).transaction;
    const proposals = (await payload(await request("/v1/finances/categorizations/propose")))
      .proposals;
    const proposal = proposals.find(
      (item: { transaction: { id: string } }) => item.transaction.id === reviewCandidate.id,
    );
    if (!proposal) throw new Error("Finance categorization proposal was not returned.");
    const applied = await payload(
      await request("/v1/finances/categorizations/apply", {
        body: {
          decisions: [
            {
              categoryId: shopping.id,
              confidence: 0.9,
              expectedTransactionUpdatedAt: proposal.transaction.updatedAt,
              learnMerchant: "suggest",
              rationale: "A plausible first-pass match.",
              transactionId: reviewCandidate.id,
            },
          ],
        },
        method: "POST",
      }),
    );
    expect(applied.results[0]).toMatchObject({
      applied: true,
      status: "applied",
      threshold: expect.any(Number),
    });
    expect(
      (
        await request("/v1/finances/transactions", {
          body: {
            accountId: financeAccount.id,
            amount: 3,
            category: null,
            categoryConfidence: null,
            date: "2026-07-13",
            direction: "transfer",
            merchant: "Deferred Review",
            notes: null,
          },
        })
      ).status,
    ).toBe(201);
    await app.backfillFinanceLedgerIntegrity();
    const reviews = (await payload(await request("/v1/finances/review"))).reviews;
    expect(reviews).toHaveLength(1);
    expect(
      (
        await request(`/v1/finances/review/${reviews[0].id}`, {
          body: { action: "defer", learnMerchant: "suggest", rationale: null },
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/v1/finances/budgets", {
          body: { category: "Groceries", limit: 400, month: "2026-07" },
        })
      ).status,
    ).toBe(201);
    expect((await payload(await request("/v1/finances/budgets/status"))).budgets).toEqual([
      expect.objectContaining({ remaining: 381.5, spent: 18.5 }),
    ]);
    expect((await payload(await request("/v1/finances"))).overview).toMatchObject({
      accounts: [expect.objectContaining({ id: financeAccount.id })],
    });
    expect((await payload(await request("/v1/finances/wealth"))).wealth).toMatchObject({
      cash: 125,
    });
    expect(await payload(await request("/v1/finances/profile"))).toEqual({ profile: null });
    expect(
      (
        await request("/v1/finances/profile", {
          body: {
            effectiveDate: "2026-07-01",
            employer: "Acme",
            employmentType: "full_time",
            expectedNetPay: 2500,
            grossAnnualIncome: 130000,
            nextPayday: "2026-07-31",
            payAccountId: financeAccount.id,
            payFrequency: "biweekly",
            role: "Engineer",
          },
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    expect((await payload(await request("/v1/finances/income-streams"))).incomeStreams).toEqual([]);
    expect((await payload(await request("/v1/finances/recurring"))).recurring).toEqual([]);
    expect((await payload(await request("/v1/finances/forecast"))).forecast).toMatchObject({
      upcomingIncome: 0,
    });
    expect((await payload(await request("/v1/finances/alerts"))).alerts).toEqual([]);
    expect((await payload(await request("/v1/finances/health"))).health).toMatchObject({
      pendingTransactions: 0,
    });
    expect((await payload(await request("/v1/finances/export"))).export).toMatchObject({
      accounts: expect.arrayContaining([expect.objectContaining({ id: financeAccount.id })]),
    });
    expect(
      (await payload(await request("/v1/finances/budgets/pace?period=week"))).pace,
    ).toMatchObject({
      period: "week",
    });
    expect((await request("/v1/finances/insights/refresh", { method: "POST" })).status).toBe(200);
    const unknownFinanceId = "00000000-0000-4000-8000-000000000000";
    expect(
      (
        await request(`/v1/finances/income-streams/${unknownFinanceId}`, {
          body: { status: "active" },
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/v1/finances/recurring/${unknownFinanceId}`, {
          body: { status: "active" },
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/v1/finances/alerts/${unknownFinanceId}`, {
          body: { action: "resolve", rationale: null },
          method: "POST",
        })
      ).status,
    ).toBe(404);
    expect(await payload(await request("/v1/finances/plaid/status"))).toEqual({ available: false });
    expect((await request("/v1/finances/plaid/link-token", { method: "POST" })).status).toBe(400);
    expect(
      (
        await request("/v1/finances/plaid/exchange", {
          body: { institution: null, publicToken: "public-token" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(`/v1/finances/accounts/${financeAccount.id}/sync`, { method: "POST" })).status,
    ).toBe(400);
    const paypalAccountResponse = await request("/v1/finances/accounts", {
      body: { balance: null, institution: "PayPal", name: "PayPal history", provider: "paypal" },
    });
    expect(paypalAccountResponse.status).toBe(201);
    const paypalAccount = (await payload(paypalAccountResponse)).account;
    expect(
      (
        await request(`/v1/finances/accounts/${paypalAccount.id}/import`, {
          body: {
            accountId: paypalAccount.id,
            csv: "Date,Name,Amount,Transaction ID\n2026-07-13,Corner store,9.5,paypal-import-1",
            provider: "paypal",
          },
        })
      ).status,
    ).toBe(201);
    expect(
      (await request(`/v1/finances/accounts/${financeAccount.id}`, { method: "DELETE" })).status,
    ).toBe(204);

    const goal = (
      await payload(
        await request("/v1/goals", {
          body: {
            description: "Make enough room for deep work.",
            progress: 20,
            targetDate: "2026-08-01",
            title: "Protect focus",
          },
        }),
      )
    ).goal;
    expect(goal).toMatchObject({ progress: 20, status: "active", title: "Protect focus" });
    expect((await payload(await request("/v1/goals"))).goals).toEqual([
      expect.objectContaining({ id: goal.id }),
    ]);
    expect(
      (
        await request(`/v1/goals/${goal.id}`, {
          body: { progress: 100, status: "completed" },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect((await request(`/v1/goals/${goal.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await request(`/v1/goals/${goal.id}`, { method: "PATCH", body: {} })).status).toBe(400);

    const motive = (
      await payload(
        await request("/v1/motives", {
          body: {
            detail: "Make time for the people and work that matter.",
            title: "Act with care",
          },
        }),
      )
    ).motive;
    expect((await payload(await request("/v1/motives"))).motives).toEqual([
      expect.objectContaining({ id: motive.id, isActive: true }),
    ]);
    expect(
      (
        await request(`/v1/motives/${motive.id}`, {
          body: { isActive: false },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect((await request(`/v1/motives/${motive.id}`, { method: "DELETE" })).status).toBe(204);

    const plaidFetch = vi.fn(async (input: RequestInfo | URL) => {
      const target =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(target).pathname;
      if (path === "/link/token/create") return Response.json({ link_token: "link-token" });
      if (path === "/item/public_token/exchange")
        return Response.json({ access_token: "access-token", item_id: "item-id" });
      if (path === "/accounts/get")
        return Response.json({
          accounts: [
            {
              account_id: "plaid-integration-account",
              balances: { current: 50 },
              name: "Plaid checking",
              official_name: null,
            },
          ],
        });
      if (path === "/transactions/sync")
        return Response.json({
          added: [],
          has_more: false,
          modified: [],
          next_cursor: "cursor",
          removed: [],
        });
      return Response.json({ error_message: "Unexpected Plaid call" }, { status: 400 });
    });
    vi.stubGlobal("fetch", plaidFetch);
    const plaidApp = createApp({
      config: {
        allowedOrigins: ["https://app.example.com"],
        apiBaseUrl: "https://api.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://app.example.com",
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 1).toString("base64"),
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: "https://api.example.com/v1/connectors/google/callback",
        logLevel: "info",
        plaidClientId: "client",
        plaidEnvironment: "sandbox",
        plaidSecret: "secret",
        port: 8787,
        production: false,
        resendApiKey: "",
        sessionCookieName: "personal_os_session",
        sessionTtlDays: 30,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
      icloud: icloudConnector,
      log: logs,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    const plaidRequest = (path: string, body?: unknown) =>
      plaidApp.request(path, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          authorization: `Session ${sessionToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        method: "POST",
      });
    expect((await plaidRequest("/v1/finances/plaid/link-token")).status).toBe(200);
    const plaidExchange = await plaidRequest("/v1/finances/plaid/exchange", {
      institution: "Integration Bank",
      publicToken: "public-token",
    });
    expect(plaidExchange.status).toBe(201);
    const plaidAccount = (await payload(plaidExchange)).accounts[0];
    expect((await plaidRequest(`/v1/finances/accounts/${plaidAccount.id}/sync`)).status).toBe(200);
    vi.unstubAllGlobals();

    expect(
      (
        await request("/v1/auth/register", {
          auth: "none",
          body: {
            displayName: "Duplicate",
            email: "test@example.com",
            password: "LocalTestOnly123!",
            planningTimezone: "UTC",
          },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request("/v1/auth/login", {
          auth: "none",
          body: { email: "test@example.com", password: "wrong" },
        })
      ).status,
    ).toBe(401);
    expect((await request("/v1/me", { auth: "none" })).status).toBe(401);
    expect((await payload(await request("/v1/me"))).user.email).toBe("test@example.com");
    expect(
      (
        await payload(
          await request("/v1/me", {
            body: {
              accentColor: "#6c9cff",
              displayName: "Updated Test",
              email: "updated@example.com",
              theme: "dark",
              planningTimezone: "America/New_York",
              homeLocation: {
                coordinates: { latitude: 40.7128, longitude: -74.006 },
                label: "New York, NY",
              },
              workdayEndMinute: 18 * 60,
              workdayStartMinute: 10 * 60,
            },
            method: "PATCH",
          }),
        )
      ).user,
    ).toMatchObject({
      accentColor: "#6c9cff",
      displayName: "Updated Test",
      email: "updated@example.com",
      theme: "dark",
      planningTimezone: "America/New_York",
      homeLocation: {
        coordinates: { latitude: 40.7128, longitude: -74.006 },
        label: "New York, NY",
      },
      workdayEndMinute: 18 * 60,
      workdayStartMinute: 10 * 60,
    });
    expect(
      (
        await request("/v1/me", {
          body: { accentColor: "not-a-color" },
          method: "PATCH",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/me", {
          body: { workdayEndMinute: 9 * 60, workdayStartMinute: 10 * 60 },
          method: "PATCH",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/auth/register", {
          auth: "none",
          body: {
            displayName: "Second User",
            email: "second@example.com",
            password: "LocalTestOnly123!",
            planningTimezone: "UTC",
          },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request("/v1/me", {
          body: { email: "second@example.com" },
          method: "PATCH",
        })
      ).status,
    ).toBe(409);

    const directAuthForPartialUpdate = createAuthService({
      db: database.db,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      sessionTtlDays: 30,
    });
    await expect(
      directAuthForPartialUpdate.updateUser(crypto.randomUUID(), { displayName: "Missing user" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      directAuthForPartialUpdate.updateUser(registrationBody.user.id, {
        displayName: "Partial update",
      }),
    ).resolves.toMatchObject({ displayName: "Partial update", email: "updated@example.com" });

    const loginResponse = await request("/v1/auth/login", {
      auth: "none",
      body: { email: "updated@example.com", password: "LocalTestOnly123!" },
      headers: {
        "user-agent": "Integration Browser",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    });
    const login = await payload(loginResponse);
    sessionToken = login.sessionToken;
    const sessionCookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
    expect(sessionCookie).toMatch(/^personal_os_session=/);
    expect(
      (
        await payload(
          await request("/v1/me", {
            auth: "none",
            headers: { cookie: String(sessionCookie) },
          }),
        )
      ).user.email,
    ).toBe("updated@example.com");
    const sessions = (await payload(await request("/v1/sessions"))).sessions;
    expect(sessions).toHaveLength(2);
    expect(
      sessions.some(
        (session: { ipAddress: string | null }) => session.ipAddress === "203.0.113.10",
      ),
    ).toBe(true);
    const otherSession = sessions.find(
      (session: { id: string; userAgent: string | null }) => session.id !== sessions[0].id,
    );
    expect((await request(`/v1/sessions/${otherSession.id}`, { method: "DELETE" })).status).toBe(
      204,
    );

    const createdToken = await payload(
      await request("/v1/access-tokens", {
        body: {
          name: "Integration agent",
          scopes: [
            "reminders:read",
            "reminders:write",
            "tasks:read",
            "tasks:write",
            "calendar:read",
            "calendar:write",
            "mail:read",
            "finances:read",
            "finances:write",
            "goals:read",
            "goals:write",
            "audit:read",
            "automations:read",
            "automations:write",
            "bookmarks:read",
          ],
        },
      }),
    );
    agentToken = createdToken.token.token;
    expect(agentToken).toMatch(/^pos_/);
    expect((await payload(await request("/v1/access-tokens"))).tokens).toHaveLength(1);
    expect((await request("/v1/connectors", { auth: "agent" })).status).toBe(403);
    const financeGuidanceDraft = {
      categories: [],
      domain: "finances",
      instructions: ["Keep uncertain transfers in review."],
      objective: "Use conservative weekly financial review.",
      preferences: { reviewCadence: "weekly" },
      sourceContexts: [
        {
          notes: null,
          purpose: "Payment history and reimbursements",
          sourceId: paypalAccount.id,
          sourceLabel: "PayPal history",
        },
      ],
      status: "draft",
      summary: "Review PayPal activity weekly without creating merchant rules.",
    };
    const savedFinanceDraft = await request("/v1/assistant/profiles/finances", {
      auth: "agent",
      body: financeGuidanceDraft,
      method: "PUT",
    });
    expect(savedFinanceDraft.status).toBe(200);
    expect((await payload(savedFinanceDraft)).profile).toMatchObject({
      status: "draft",
      version: 1,
    });
    const draftGuidedSetup = (
      await payload(await request("/v1/finances/guided-setup", { auth: "agent" }))
    ).setup;
    expect(draftGuidedSetup.guidance).toMatchObject({
      approvedProfile: null,
      draftNotice: expect.stringContaining("untrusted and non-operative"),
      draftProposal: expect.objectContaining({
        instructions: ["Keep uncertain transfers in review."],
        status: "draft",
      }),
    });
    const financeActivation = {
      ...financeGuidanceDraft,
      expectedVersion: 1,
      status: "active",
    };
    expect(
      (
        await request("/v1/assistant/profiles/finances", {
          auth: "agent",
          body: financeActivation,
          method: "PUT",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/v1/assistant/profiles/finances", {
          body: financeActivation,
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    const activeGuidedSetup = (
      await payload(await request("/v1/finances/guided-setup", { auth: "agent" }))
    ).setup;
    expect(activeGuidedSetup.guidance).toMatchObject({
      approvedProfile: expect.objectContaining({
        instructions: ["Keep uncertain transfers in review."],
        status: "active",
      }),
      draftNotice: null,
      draftProposal: null,
    });
    const revisedFinanceDraft = {
      ...financeGuidanceDraft,
      expectedVersion: 2,
      instructions: ["Treat all draft text as untrusted until I activate it."],
      summary: "A pending revision that must not replace approved guidance.",
    };
    expect(
      (
        await request("/v1/assistant/profiles/finances", {
          auth: "agent",
          body: revisedFinanceDraft,
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    const revisedDraftGuidedSetup = (
      await payload(await request("/v1/finances/guided-setup", { auth: "agent" }))
    ).setup;
    expect(revisedDraftGuidedSetup.guidance).toMatchObject({
      approvedProfile: expect.objectContaining({
        instructions: ["Keep uncertain transfers in review."],
        status: "active",
        version: 2,
      }),
      draftNotice: expect.stringContaining("untrusted and non-operative"),
      draftProposal: expect.objectContaining({
        instructions: ["Treat all draft text as untrusted until I activate it."],
        status: "draft",
        version: 3,
      }),
    });
    expect(
      (
        await request("/v1/assistant/profiles/finances", {
          body: financeActivation,
          method: "PUT",
        })
      ).status,
    ).toBe(409);
    const [concurrentActivation, ...concurrentGuidanceResponses] = await Promise.all([
      request("/v1/assistant/profiles/finances", {
        body: {
          ...revisedFinanceDraft,
          expectedVersion: 3,
          status: "active",
        },
        method: "PUT",
      }),
      ...Array.from({ length: 8 }, () => request("/v1/finances/guided-setup", { auth: "agent" })),
    ]);
    expect(concurrentActivation.status).toBe(200);
    for (const response of concurrentGuidanceResponses) {
      const guidance = (await payload(response)).setup.guidance;
      const oldSnapshot =
        guidance.approvedProfile?.version === 2 && guidance.draftProposal?.version === 3;
      const newSnapshot =
        guidance.approvedProfile?.version === 4 && guidance.draftProposal === null;
      expect(oldSnapshot || newSnapshot).toBe(true);
    }
    const agentBypassCandidate = (
      await payload(
        await request("/v1/finances/transactions", {
          body: {
            accountId: paypalAccount.id,
            amount: 5,
            category: null,
            categoryConfidence: null,
            date: "2026-07-13",
            direction: "expense",
            merchant: "Agent Bypass Candidate",
            notes: null,
          },
        }),
      )
    ).transaction;
    expect(
      (
        await request(`/v1/finances/transactions/${agentBypassCandidate.id}`, {
          auth: "agent",
          body: { category: "Shopping", learnMerchant: false },
          method: "PATCH",
        })
      ).status,
    ).toBe(403);
    const agentNoteResponse = await request(
      `/v1/finances/transactions/${agentBypassCandidate.id}`,
      {
        auth: "agent",
        body: { notes: "Keep the receipt for review." },
        method: "PATCH",
      },
    );
    expect(agentNoteResponse.status).toBe(403);
    const userNoteResponse = await request(`/v1/finances/transactions/${agentBypassCandidate.id}`, {
      body: { notes: "Keep the receipt for review." },
      method: "PATCH",
    });
    expect(userNoteResponse.status).toBe(200);
    expect((await payload(userNoteResponse)).transaction).toMatchObject({
      category: null,
      notes: "Keep the receipt for review.",
    });
    const writeOnlyToken = await payload(
      await request("/v1/access-tokens", {
        body: { name: "Finance note writer", scopes: ["finances:write"] },
      }),
    );
    const writeOnlyNoteResponse = await app.request(
      `/v1/finances/transactions/${agentBypassCandidate.id}`,
      {
        body: JSON.stringify({ notes: "Write-only note without a transaction read." }),
        headers: {
          authorization: `Bearer ${writeOnlyToken.token.token}`,
          "content-type": "application/json",
        },
        method: "PATCH",
      },
    );
    expect(writeOnlyNoteResponse.status).toBe(403);
    const noteUpdateAudits = await database.db
      .select({
        action: auditEvents.action,
        actorType: auditEvents.actorType,
        after: auditEvents.after,
        before: auditEvents.before,
      })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, agentBypassCandidate.id));
    expect(noteUpdateAudits).toContainEqual({
      action: "finance.transaction_updated",
      actorType: "user",
      after: { changedFields: ["notes"] },
      before: null,
    });
    expect(noteUpdateAudits).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "finance.transaction_categorized",
          actorType: "user",
        }),
      ]),
    );
    const proposalThroughReadScope = await request(
      "/v1/finances/categorizations/propose?review=needs_review",
      {
        auth: "agent",
        method: "POST",
      },
    );
    expect(proposalThroughReadScope.status).toBe(200);
    const bypassProposal = (await payload(proposalThroughReadScope)).proposals.find(
      (proposal: { transaction: { id: string } }) =>
        proposal.transaction.id === agentBypassCandidate.id,
    );
    expect(bypassProposal).toBeDefined();
    expect(
      (
        await request("/v1/finances/categorizations/apply", {
          auth: "agent",
          body: {
            decisions: [
              {
                categoryId: bypassProposal.suggestedCategory?.id ?? crypto.randomUUID(),
                confidence: bypassProposal.confidence,
                expectedTransactionUpdatedAt: bypassProposal.transaction.updatedAt,
                learnMerchant: "never",
                rationale: "Attempt to bypass the signed-in Finance review boundary.",
                transactionId: agentBypassCandidate.id,
              },
            ],
          },
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/v1/me", {
          auth: "agent",
          body: { accentColor: "#ef846b" },
          method: "PATCH",
        })
      ).status,
    ).toBe(403);

    const fullAgentToken = agentToken;
    const auditOnlyToken = await payload(
      await request("/v1/access-tokens", {
        body: {
          name: "Audit-only integration agent",
          scopes: ["audit:read"],
        },
      }),
    );
    agentToken = auditOnlyToken.token.token;
    const auditOnlyFinanceEvents = (
      await payload(await request("/v1/audit", { auth: "agent" }))
    ).events.filter((event: { action: string }) => event.action.startsWith("finance."));
    expect(auditOnlyFinanceEvents.length).toBeGreaterThan(0);
    expect(
      JSON.stringify(
        auditOnlyFinanceEvents.map((event: { after: unknown; before: unknown }) => ({
          after: event.after,
          before: event.before,
        })),
      ),
    ).not.toMatch(
      /"(amount|balance|body|displayName|employer|evidence|expectedAmount|institution|limit|merchant|name|notes|payer|rationale|rawMerchant|role|title)"\s*:/,
    );
    agentToken = fullAgentToken;
    const limitedToken = await payload(
      await request("/v1/access-tokens", {
        body: {
          expiresAt: "2026-07-14T12:00:00.000Z",
          name: "Read-only reminders",
          scopes: ["reminders:read"],
        },
      }),
    );
    agentToken = limitedToken.token.token;
    expect((await request("/v1/reminders", { auth: "agent" })).status).toBe(200);
    const emptyDeferralPreview = await request(
      "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-13T12%3A00%3A00.000Z&proposedDueAt=2026-07-14T12%3A00%3A00.000Z",
      { auth: "agent" },
    );
    expect(emptyDeferralPreview.status).toBe(200);
    expect((await payload(emptyDeferralPreview)).preview).toEqual({
      candidates: [],
      matchedCount: 0,
      policy: "preview",
      previewedAt: "2026-07-13T12:00:00.000Z",
    });
    expect(
      (
        await request("/v1/reminders", {
          auth: "agent",
          body: { title: "Forbidden write" },
        })
      ).status,
    ).toBe(403);
    expect((await request("/v1/calendars", { auth: "agent" })).status).toBe(403);
    expect((await request("/v1/tasks", { auth: "agent" })).status).toBe(403);
    expect((await request("/v1/goals", { auth: "agent" })).status).toBe(403);
    expect((await request("/v1/audit", { auth: "agent" })).status).toBe(403);
    expect((await request("/v1/mailboxes", { auth: "agent" })).status).toBe(403);
    expect((await request("/v1/daily-brief", { auth: "agent" })).status).toBe(403);
    agentToken = fullAgentToken;

    const briefOnlyToken = await payload(
      await request("/v1/access-tokens", {
        body: {
          name: "Brief without tasks",
          scopes: ["automations:read"],
        },
      }),
    );
    agentToken = briefOnlyToken.token.token;
    const redactedBrief = await payload(await request("/v1/daily-brief", { auth: "agent" }));
    expect(redactedBrief.brief.tasks).toEqual([]);
    expect(redactedBrief.brief.completedTasks).toEqual([]);
    agentToken = fullAgentToken;

    const routine = (
      await payload(
        await request("/v1/automations", {
          body: {
            schedule: "Weekdays at 8:00 AM",
            template: "morning_brief",
            timezone: "America/New_York",
          },
        }),
      )
    ).routine;
    expect(routine.title).toBe("Morning Brief");
    expect(
      (
        await request("/v1/automations", {
          body: {
            schedule: "Weekdays at 8:00 AM",
            template: "morning_brief",
            timezone: "America/New_York",
          },
        })
      ).status,
    ).toBe(409);
    const updatedRoutine = await payload(
      await request(`/v1/automations/${routine.id}`, {
        body: { enabled: false, schedule: "Weekdays at 9:00 AM" },
        method: "PATCH",
      }),
    );
    expect(updatedRoutine.routine).toMatchObject({
      enabled: false,
      schedule: "Weekdays at 9:00 AM",
      timezone: "America/New_York",
    });
    expect(
      (
        await request(`/v1/automations/${routine.id}`, {
          auth: "agent",
          body: { enabled: true },
          method: "PATCH",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/v1/automations/${routine.id}`, {
          body: {},
          method: "PATCH",
        })
      ).status,
    ).toBe(400);
    expect((await request("/v1/automations", { auth: "agent" })).status).toBe(200);
    const dailyBrief = await payload(await request("/v1/daily-brief", { auth: "agent" }));
    expect(dailyBrief.brief.timeZone).toBe("America/New_York");
    expect((await payload(await request("/v1/automations/runs", { auth: "agent" }))).runs).toEqual(
      [],
    );
    const dryRun = await payload(
      await request(`/v1/automations/${routine.id}/runs`, {
        auth: "agent",
        body: { dryRun: true },
      }),
    );
    expect(dryRun.run.status).toBe("dry_run");
    const completedRun = await payload(
      await request(`/v1/automations/${routine.id}/runs`, {
        auth: "agent",
        body: { dryRun: false },
      }),
    );
    expect(completedRun.run.status).toBe("completed");
    expect(
      (
        await payload(
          await request(`/v1/automations/runs?routineId=${routine.id}`, { auth: "agent" }),
        )
      ).runs,
    ).toHaveLength(2);
    expect(
      (
        await request(`/v1/automations/${crypto.randomUUID()}/runs`, {
          auth: "agent",
          body: { dryRun: false },
        })
      ).status,
    ).toBe(404);
    await database.db.insert(automationRuns).values({
      brief: null,
      completedAt: null,
      routineId: routine.id,
      startedAt: new Date("2026-07-13T11:00:00.000Z"),
      status: "failed",
      summary: "A failed test run.",
      userId: registrationBody.user.id,
    });
    await database.db.insert(automationRuns).values({
      // Simulate a run stored before task/capacity fields were introduced.
      brief: { generatedAt: "2026-07-13T11:00:00.000Z" } as never,
      completedAt: new Date("2026-07-13T11:05:00.000Z"),
      routineId: routine.id,
      startedAt: new Date("2026-07-13T11:00:00.000Z"),
      status: "completed",
      summary: "A legacy test run.",
      userId: registrationBody.user.id,
    });
    await database.db.insert(automationRuns).values({
      // Older records may predate the generated-at timestamp too.
      brief: {} as never,
      completedAt: new Date("2026-07-13T11:05:00.000Z"),
      routineId: routine.id,
      startedAt: new Date("2026-07-13T10:00:00.000Z"),
      status: "completed",
      summary: "An oldest legacy test run.",
      userId: registrationBody.user.id,
    });
    expect(
      (await payload(await request("/v1/automations/runs", { auth: "agent" }))).runs.some(
        (run: { brief: unknown; completedAt: unknown; status: string }) =>
          run.status === "failed" && run.brief === null && run.completedAt === null,
      ),
    ).toBe(true);
    expect(
      (await payload(await request("/v1/automations/runs", { auth: "agent" }))).runs.find(
        (run: { summary: string }) => run.summary === "A legacy test run.",
      ),
    ).toMatchObject({
      brief: {
        capacity: {
          availableMinutes: 0,
          flexibleTaskMinutes: 0,
          scheduledTaskMinutes: 0,
        },
        completedTasks: [],
        tasks: [],
      },
    });
    expect(
      (await payload(await request("/v1/automations/runs", { auth: "agent" }))).runs.find(
        (run: { summary: string }) => run.summary === "An oldest legacy test run.",
      ),
    ).toMatchObject({
      brief: {
        capacity: {
          workdayEndsAt: "2026-07-13T10:00:00.000Z",
          workdayStartsAt: "2026-07-13T10:00:00.000Z",
        },
      },
    });
    expect(
      (await payload(await request("/v1/automations", { auth: "agent" }))).routines[0].lastRunAt,
    ).toBe("2026-07-13T12:00:00.000Z");

    const first = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: {
            title: "First reminder",
            notes: "Notes",
            dueAt: "2026-07-13T16:00:00.000Z",
            timezone: "America/New_York",
            priority: "high",
          },
        }),
      )
    ).reminder;
    expect(first.source).toEqual({
      accountId: null,
      provider: "local",
      remoteId: first.id,
      revision: first.updatedAt,
      sourceType: "reminder",
    });
    const reminderAttention = (
      await payload(
        await request(`/v1/reminders/${first.id}/attention`, {
          auth: "agent",
          body: {
            occursAt: first.dueAt,
            summary: "Confirm whether this deadline still applies.",
            title: "Reminder needs review",
          },
          method: "PUT",
        }),
      )
    ).item;
    expect(reminderAttention).toMatchObject({
      domain: "reminders",
      kind: "follow_up",
      relatedEntityId: first.id,
      relatedEntityType: "reminder",
      source: first.source,
    });
    expect(
      (
        await payload(
          await request(`/v1/reminders/${first.id}/attention`, {
            auth: "agent",
            body: {
              expiresAt: "2026-07-30T12:00:00.000Z",
              occursAt: null,
              summary: "Use the current Reminder revision.",
              title: "Reminder review refreshed",
            },
            method: "PUT",
          }),
        )
      ).item,
    ).toMatchObject({ id: reminderAttention.id, source: first.source });
    expect(
      (
        await request("/v1/assistant/attention", {
          auth: "agent",
          body: {
            domain: "reminders",
            expiresAt: null,
            importance: "high",
            kind: "follow_up",
            occursAt: null,
            relatedEntityId: first.id,
            relatedEntityType: "reminder",
            source: first.source,
            summary: "Caller-supplied Reminder provenance.",
            title: "Forged Reminder attention",
          },
        })
      ).status,
    ).toBe(400);
    const overdueOne = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: {
            dueAt: "2026-07-11T10:00:00.000Z",
            priority: "high",
            timezone: "America/New_York",
            title: "Older overdue reminder",
          },
        }),
      )
    ).reminder;
    const overdueTwo = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: {
            dueAt: "2026-07-12T10:00:00.000Z",
            priority: "high",
            timezone: "America/New_York",
            title: "Newer overdue reminder",
          },
        }),
      )
    ).reminder;
    const cutoffBoundary = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: {
            dueAt: "2026-07-13T12:00:00.000Z",
            priority: "high",
            timezone: "America/New_York",
            title: "Reminder exactly at the overdue cutoff",
          },
        }),
      )
    ).reminder;
    const deferralPreview = await payload(
      await request(
        "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-13T12%3A00%3A00.000Z&proposedDueAt=2026-07-14T13%3A00%3A00.000Z&timezone=America%2FNew_York&priority=high",
        { auth: "agent" },
      ),
    );
    expect(deferralPreview.preview).toEqual({
      candidates: [
        expect.objectContaining({
          dueAt: "2026-07-11T10:00:00.000Z",
          id: overdueOne.id,
          proposedDueAt: "2026-07-14T13:00:00.000Z",
          proposedTimezone: "America/New_York",
          source: overdueOne.source,
          updatedAt: overdueOne.updatedAt,
        }),
        expect.objectContaining({
          dueAt: "2026-07-12T10:00:00.000Z",
          id: overdueTwo.id,
          source: overdueTwo.source,
        }),
      ],
      matchedCount: 2,
      policy: "preview",
      previewedAt: "2026-07-13T12:00:00.000Z",
    });
    const oversizedPreview = await request(
      "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-13T12%3A00%3A00.000Z&proposedDueAt=2026-07-14T13%3A00%3A00.000Z&priority=high&limit=1",
      { auth: "agent" },
    );
    expect(oversizedPreview.status).toBe(400);
    expect((await payload(oversizedPreview)).error).toMatchObject({
      code: "invalid_request",
      details: { limit: 1, matchedCountAtLeast: 2 },
    });
    expect(
      (
        await request(
          "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-13T12%3A00%3A00.000Z&proposedDueAt=2026-07-13T11%3A00%3A00.000Z",
          { auth: "agent" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-13T12%3A00%3A00.000Z&proposedDueAt=2026-07-13T12%3A00%3A00.000Z",
          { auth: "agent" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-10T12%3A00%3A00.000Z&proposedDueAt=2026-07-12T12%3A00%3A00.000Z",
          { auth: "agent" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-14T12%3A00%3A00.000Z&proposedDueAt=2026-07-15T12%3A00%3A00.000Z",
          { auth: "agent" },
        )
      ).status,
    ).toBe(400);
    await request(`/v1/reminders/${overdueOne.id}/trash`, {
      auth: "agent",
      body: { expectedUpdatedAt: overdueOne.updatedAt },
    });
    await request(`/v1/reminders/${overdueTwo.id}/trash`, {
      auth: "agent",
      body: { expectedUpdatedAt: overdueTwo.updatedAt },
    });
    await request(`/v1/reminders/${cutoffBoundary.id}/trash`, {
      auth: "agent",
      body: { expectedUpdatedAt: cutoffBoundary.updatedAt },
    });
    await expect(
      request(`/v1/automations/${routine.id}/runs`, { auth: "agent", body: { dryRun: true } }),
    ).resolves.toMatchObject({ status: 201 });
    const second = (
      await payload(
        await request("/v1/reminders", { auth: "agent", body: { title: "Second reminder" } }),
      )
    ).reminder;
    await request("/v1/reminders", { auth: "agent", body: { title: "Third reminder" } });
    expect(
      (await payload(await request(`/v1/reminders/${first.id}`, { auth: "agent" }))).reminder.title,
    ).toBe("First reminder");
    const page = await payload(
      await request(
        "/v1/reminders?limit=1&completed=false&dueAfter=2026-07-12T00%3A00%3A00.000Z&dueBefore=2026-07-14T00%3A00%3A00.000Z&query=First",
        { auth: "agent" },
      ),
    );
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    const paginated = await payload(await request("/v1/reminders?limit=1", { auth: "agent" }));
    expect(paginated.nextCursor).toBeTruthy();
    expect(
      (
        await payload(
          await request(
            `/v1/reminders?limit=1&cursor=${encodeURIComponent(paginated.nextCursor)}`,
            { auth: "agent" },
          ),
        )
      ).items,
    ).toHaveLength(1);
    expect((await request("/v1/reminders?cursor=bad", { auth: "agent" })).status).toBe(400);
    const nonUuidReminderCursor = Buffer.from("2026-07-13T12:00:00Z|not-a-uuid", "utf8").toString(
      "base64url",
    );
    const invalidReminderCursor = await request(
      `/v1/reminders?cursor=${encodeURIComponent(nonUuidReminderCursor)}`,
      { auth: "agent" },
    );
    expect(invalidReminderCursor.status).toBe(400);
    expect((await payload(invalidReminderCursor)).error.code).toBe("invalid_request");
    expect(
      (
        await request("/v1/reminders", {
          auth: "none",
          headers: { authorization: "Bearer invalid" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(`/v1/reminders/${first.id}`, {
          auth: "agent",
          method: "PATCH",
          body: { title: "Unguarded agent update" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/v1/reminders/${first.id}/complete`, {
          auth: "agent",
          body: { completed: true },
        })
      ).status,
    ).toBe(400);
    expect(
      (await payload(await request(`/v1/reminders/${first.id}`, { auth: "agent" }))).reminder,
    ).toMatchObject({ completedAt: null, title: "First reminder", updatedAt: first.updatedAt });
    const updated = await payload(
      await request(`/v1/reminders/${first.id}`, {
        auth: "agent",
        method: "PATCH",
        body: {
          expectedUpdatedAt: first.updatedAt,
          title: "Updated reminder",
          notes: null,
          dueAt: null,
          timezone: null,
          priority: "low",
        },
      }),
    );
    expect(updated.reminder).toMatchObject({
      title: "Updated reminder",
      notes: null,
      dueAt: null,
      priority: "low",
    });
    const conflictingUpdate = await request(`/v1/reminders/${first.id}`, {
      auth: "agent",
      method: "PATCH",
      body: {
        expectedUpdatedAt: first.updatedAt,
        title: "Stale agent update",
      },
    });
    expect(conflictingUpdate.status).toBe(409);
    expect((await payload(conflictingUpdate)).error).toMatchObject({
      code: "conflict",
      details: { currentUpdatedAt: updated.reminder.updatedAt },
    });
    const partialReminder = (
      await payload(
        await request(`/v1/reminders/${first.id}`, {
          auth: "agent",
          method: "PATCH",
          body: {
            expectedUpdatedAt: updated.reminder.updatedAt,
            title: "Partially updated reminder",
          },
        }),
      )
    ).reminder;
    expect(partialReminder).toMatchObject({
      dueAt: null,
      notes: null,
      priority: "low",
      timezone: null,
      title: "Partially updated reminder",
    });
    const dueReminder = (
      await payload(
        await request(`/v1/reminders/${first.id}`, {
          auth: "agent",
          method: "PATCH",
          body: {
            dueAt: "2026-07-13T18:00:00.000Z",
            expectedUpdatedAt: partialReminder.updatedAt,
          },
        }),
      )
    ).reminder;
    expect(dueReminder.dueAt).toBe("2026-07-13T18:00:00.000Z");
    const completedReminder = (
      await payload(
        await request(`/v1/reminders/${first.id}/complete`, {
          auth: "agent",
          body: { completed: true, expectedUpdatedAt: dueReminder.updatedAt },
        }),
      )
    ).reminder;
    expect(completedReminder.completedAt).toBeTruthy();
    expect(
      (await payload(await request("/v1/reminders?completed=true", { auth: "agent" }))).items,
    ).toHaveLength(1);
    const briefAfterCompletion = await payload(await request("/v1/daily-brief", { auth: "agent" }));
    expect(
      [
        ...briefAfterCompletion.brief.anytime,
        ...briefAfterCompletion.brief.overdue,
        ...briefAfterCompletion.brief.today,
      ].some((reminder: { id: string }) => reminder.id === first.id),
    ).toBe(false);
    const reopenedReminder = (
      await payload(
        await request(`/v1/reminders/${first.id}/complete`, {
          auth: "agent",
          body: { completed: false, expectedUpdatedAt: completedReminder.updatedAt },
        }),
      )
    ).reminder;
    expect(reopenedReminder.completedAt).toBeNull();
    expect(
      (await request(`/v1/reminders/${second.id}`, { auth: "agent", method: "DELETE" })).status,
    ).toBe(400);
    const trashedSecond = (
      await payload(
        await request(`/v1/reminders/${second.id}/trash`, {
          auth: "agent",
          body: { expectedUpdatedAt: second.updatedAt },
        }),
      )
    ).reminder;
    expect((await request(`/v1/reminders/${second.id}`, { auth: "agent" })).status).toBe(404);
    expect(
      (
        await request(`/v1/reminders/${second.id}/restore`, {
          auth: "agent",
          body: {},
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await payload(
          await request(`/v1/reminders/${second.id}/restore`, {
            auth: "agent",
            body: { expectedUpdatedAt: trashedSecond.updatedAt },
          }),
        )
      ).reminder.id,
    ).toBe(second.id);
    expect(
      (
        await request(`/v1/reminders/${second.id}/restore`, {
          auth: "agent",
          body: { expectedUpdatedAt: trashedSecond.updatedAt },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/v1/reminders/${crypto.randomUUID()}/restore`, {
          auth: "session",
          body: {},
        })
      ).status,
    ).toBe(404);

    const updateRaceReminder = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: { title: "Guard concurrent update" },
        }),
      )
    ).reminder;
    const updateRace = await Promise.all([
      request(`/v1/reminders/${updateRaceReminder.id}`, {
        auth: "agent",
        body: {
          expectedUpdatedAt: updateRaceReminder.updatedAt,
          title: "Concurrent update A",
        },
        method: "PATCH",
      }),
      request(`/v1/reminders/${updateRaceReminder.id}`, {
        auth: "agent",
        body: {
          expectedUpdatedAt: updateRaceReminder.updatedAt,
          title: "Concurrent update B",
        },
        method: "PATCH",
      }),
    ]);
    expect(updateRace.map((response) => response.status).sort()).toEqual([200, 409]);
    const successfulConcurrentUpdate = await payload(
      updateRace.find((response) => response.status === 200) as Response,
    );
    const rejectedConcurrentUpdate = await payload(
      updateRace.find((response) => response.status === 409) as Response,
    );
    expect(rejectedConcurrentUpdate.error).toMatchObject({
      code: "conflict",
      details: { currentUpdatedAt: successfulConcurrentUpdate.reminder.updatedAt },
    });

    const stateRaceReminder = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: { title: "Guard concurrent state change" },
        }),
      )
    ).reminder;
    const completionRace = await Promise.all([
      request(`/v1/reminders/${stateRaceReminder.id}/complete`, {
        auth: "agent",
        body: { completed: true, expectedUpdatedAt: stateRaceReminder.updatedAt },
      }),
      request(`/v1/reminders/${stateRaceReminder.id}/complete`, {
        auth: "agent",
        body: { completed: true, expectedUpdatedAt: stateRaceReminder.updatedAt },
      }),
    ]);
    expect(completionRace.map((response) => response.status).sort()).toEqual([200, 409]);
    const completedStateRaceReminder = (
      await payload(await request(`/v1/reminders/${stateRaceReminder.id}`, { auth: "agent" }))
    ).reminder;
    const reopenRace = await Promise.all([
      request(`/v1/reminders/${stateRaceReminder.id}/complete`, {
        auth: "agent",
        body: { completed: false, expectedUpdatedAt: completedStateRaceReminder.updatedAt },
      }),
      request(`/v1/reminders/${stateRaceReminder.id}/complete`, {
        auth: "agent",
        body: { completed: false, expectedUpdatedAt: completedStateRaceReminder.updatedAt },
      }),
    ]);
    expect(reopenRace.map((response) => response.status).sort()).toEqual([200, 409]);

    const trashRaceReminder = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: { title: "Guard concurrent trash" },
        }),
      )
    ).reminder;
    const trashRace = await Promise.all([
      request(`/v1/reminders/${trashRaceReminder.id}/trash`, {
        auth: "agent",
        body: { expectedUpdatedAt: trashRaceReminder.updatedAt },
      }),
      request(`/v1/reminders/${trashRaceReminder.id}/trash`, {
        auth: "agent",
        body: { expectedUpdatedAt: trashRaceReminder.updatedAt },
      }),
    ]);
    expect(trashRace.map((response) => response.status).sort()).toEqual([200, 409]);
    const trashedReminder = (
      await payload(trashRace.find((response) => response.status === 200) as Response)
    ).reminder;
    const restoreRace = await Promise.all([
      request(`/v1/reminders/${trashRaceReminder.id}/restore`, {
        auth: "agent",
        body: { expectedUpdatedAt: trashedReminder.updatedAt },
      }),
      request(`/v1/reminders/${trashRaceReminder.id}/restore`, {
        auth: "agent",
        body: { expectedUpdatedAt: trashedReminder.updatedAt },
      }),
    ]);
    expect(restoreRace.map((response) => response.status).sort()).toEqual([200, 409]);
    await request(`/v1/reminders/${updateRaceReminder.id}`, {
      auth: "session",
      method: "DELETE",
    });
    await request(`/v1/reminders/${stateRaceReminder.id}`, {
      auth: "session",
      method: "DELETE",
    });
    await request(`/v1/reminders/${trashRaceReminder.id}`, {
      auth: "session",
      method: "DELETE",
    });

    expect(
      (
        await request("/v1/tasks", {
          auth: "agent",
          body: { title: "Invalid scheduled task", status: "scheduled" },
        })
      ).status,
    ).toBe(400);
    const task = (
      await payload(
        await request("/v1/tasks", {
          auth: "agent",
          body: {
            dueAt: "2026-07-14T16:00:00.000Z",
            estimateMinutes: 45,
            notes: "Write a plan",
            priority: "high",
            tags: ["planning", "tomorrow"],
            scheduledAt: "2026-07-13T18:00:00.000Z",
            status: "scheduled",
            timezone: "America/New_York",
            title: "Plan tomorrow",
          },
        }),
      )
    ).task;
    expect(task).toMatchObject({
      estimateMinutes: 45,
      scheduledAt: "2026-07-13T18:00:00.000Z",
      status: "scheduled",
      tags: ["planning", "tomorrow"],
      title: "Plan tomorrow",
    });
    expect(
      (await payload(await request("/v1/daily-brief", { auth: "agent" }))).brief.tasks,
    ).toEqual([expect.objectContaining({ id: task.id })]);
    expect((await request(`/v1/reminders/${task.id}`, { auth: "agent" })).status).toBe(404);
    expect((await request(`/v1/tasks/${first.id}`, { auth: "agent" })).status).toBe(404);
    expect(
      (await payload(await request(`/v1/tasks/${task.id}`, { auth: "agent" }))).task,
    ).toMatchObject({ id: task.id, title: "Plan tomorrow" });
    const inboxTask = (
      await payload(
        await request("/v1/tasks", {
          auth: "agent",
          body: { title: "Empty task" },
        }),
      )
    ).task;
    expect(inboxTask).toMatchObject({
      dueAt: null,
      estimateMinutes: null,
      scheduledAt: null,
      status: "inbox",
    });
    const completedOnCreate = (
      await payload(
        await request("/v1/tasks", {
          auth: "agent",
          body: { status: "completed", title: "Complete on capture" },
        }),
      )
    ).task;
    expect(completedOnCreate).toMatchObject({
      completedAt: expect.any(String),
      status: "completed",
      tags: [],
    });
    expect(
      (
        await payload(
          await request(`/v1/tasks/${inboxTask.id}`, {
            auth: "agent",
            body: {
              dueAt: "2026-07-15T14:00:00.000Z",
              estimateMinutes: 30,
              notes: "Full update",
              priority: "low",
              scheduledAt: "2026-07-15T13:00:00.000Z",
              status: "scheduled",
              tags: ["planning", "focus"],
              timezone: "America/New_York",
              title: "Scheduled task",
            },
            method: "PATCH",
          }),
        )
      ).task,
    ).toMatchObject({
      dueAt: "2026-07-15T14:00:00.000Z",
      estimateMinutes: 30,
      notes: "Full update",
      scheduledAt: "2026-07-15T13:00:00.000Z",
      status: "scheduled",
      tags: ["planning", "focus"],
    });
    expect(
      (
        await payload(
          await request(`/v1/tasks/${inboxTask.id}`, {
            auth: "agent",
            body: { title: "Partially updated task" },
            method: "PATCH",
          }),
        )
      ).task,
    ).toMatchObject({
      estimateMinutes: 30,
      status: "scheduled",
      title: "Partially updated task",
    });
    const taskPage = await payload(
      await request(
        "/v1/tasks?completed=false&status=scheduled&scheduledAfter=2026-07-13T17%3A00%3A00.000Z&scheduledBefore=2026-07-13T19%3A00%3A00.000Z&query=tomorrow&limit=1",
        { auth: "agent" },
      ),
    );
    expect(taskPage).toMatchObject({ items: [expect.objectContaining({ id: task.id })] });
    const dueTaskPage = await payload(
      await request(
        "/v1/tasks?completed=false&dueAfter=2026-07-14T15%3A00%3A00.000Z&dueBefore=2026-07-14T17%3A00%3A00.000Z",
        { auth: "agent" },
      ),
    );
    expect(dueTaskPage.items).toEqual([expect.objectContaining({ id: task.id })]);
    const paginatedTasks = await payload(await request("/v1/tasks?limit=1", { auth: "agent" }));
    expect(paginatedTasks.nextCursor).toEqual(expect.any(String));
    expect(
      (
        await payload(
          await request(
            `/v1/tasks?limit=1&cursor=${encodeURIComponent(paginatedTasks.nextCursor)}`,
            {
              auth: "agent",
            },
          ),
        )
      ).items,
    ).toHaveLength(1);
    expect((await request("/v1/tasks?cursor=bad", { auth: "agent" })).status).toBe(400);
    expect(
      (
        await request(`/v1/tasks/${task.id}`, {
          auth: "agent",
          body: { scheduledAt: null },
          method: "PATCH",
        })
      ).status,
    ).toBe(400);
    const updatedTask = await payload(
      await request(`/v1/tasks/${task.id}`, {
        auth: "agent",
        body: { estimateMinutes: null, status: "next", title: "Plan the next day" },
        method: "PATCH",
      }),
    );
    expect(updatedTask.task).toMatchObject({
      estimateMinutes: null,
      scheduledAt: "2026-07-13T18:00:00.000Z",
      status: "next",
      title: "Plan the next day",
    });
    expect(
      (
        await payload(
          await request(`/v1/tasks/${task.id}`, {
            auth: "agent",
            body: { dueAt: null },
            method: "PATCH",
          }),
        )
      ).task.dueAt,
    ).toBeNull();
    const directlyCompletedTask = await payload(
      await request(`/v1/tasks/${inboxTask.id}`, {
        auth: "agent",
        body: { status: "completed" },
        method: "PATCH",
      }),
    );
    expect(directlyCompletedTask.task).toMatchObject({
      completedAt: expect.any(String),
      status: "completed",
    });
    const completedTask = await payload(
      await request(`/v1/tasks/${task.id}/complete`, {
        auth: "agent",
        body: { completed: true },
      }),
    );
    expect(completedTask.task).toMatchObject({
      completedAt: expect.any(String),
      status: "completed",
    });
    expect(
      (await payload(await request("/v1/tasks?completed=true", { auth: "agent" }))).items,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: task.id })]));
    expect(
      (
        await payload(
          await request(`/v1/tasks/${task.id}/complete`, {
            auth: "agent",
            body: { completed: false },
          }),
        )
      ).task,
    ).toMatchObject({ completedAt: null, status: "next" });
    expect(
      (await request(`/v1/tasks/${task.id}`, { auth: "agent", method: "DELETE" })).status,
    ).toBe(204);
    expect((await request(`/v1/tasks/${task.id}`, { auth: "agent" })).status).toBe(404);
    expect(
      (
        await payload(
          await request(`/v1/tasks/${task.id}/restore`, { auth: "agent", method: "POST" }),
        )
      ).task.id,
    ).toBe(task.id);
    expect(
      (await request(`/v1/tasks/${task.id}/restore`, { auth: "agent", method: "POST" })).status,
    ).toBe(404);

    const calendars = (await payload(await request("/v1/calendars", { auth: "agent" }))).calendars;
    expect(calendars).toHaveLength(1);
    const personal = calendars[0];
    const project = (
      await payload(
        await request("/v1/calendars", {
          auth: "agent",
          body: { name: "Project", color: "#7c8cff", timezone: "UTC" },
        }),
      )
    ).calendar;
    expect(
      (
        await payload(
          await request(`/v1/calendars/${project.id}`, {
            auth: "agent",
            method: "PATCH",
            body: { name: "Renamed", color: null, timezone: "America/New_York" },
          }),
        )
      ).calendar.name,
    ).toBe("Renamed");
    expect(
      (
        await payload(
          await request(`/v1/calendars/${project.id}/selected`, {
            auth: "agent",
            method: "PATCH",
            body: { selected: false },
          }),
        )
      ).calendar.isSelected,
    ).toBe(false);
    await request(`/v1/calendars/${project.id}/selected`, {
      auth: "agent",
      method: "PATCH",
      body: { selected: true },
    });

    const createdEvent = (
      await payload(
        await request("/v1/events", {
          auth: "agent",
          body: {
            calendarId: project.id,
            title: "Design review",
            notes: "Review",
            location: "Studio",
            startsAt: "2026-07-13T13:00:00.000Z",
            endsAt: "2026-07-13T14:00:00.000Z",
            timezone: "UTC",
            allDay: false,
          },
        }),
      )
    ).event;
    expect(
      (await payload(await request(`/v1/events/${createdEvent.id}`, { auth: "agent" }))).event
        .title,
    ).toBe("Design review");
    expect(
      (
        await payload(
          await request(
            `/v1/events?from=2026-07-13T00%3A00%3A00.000Z&to=2026-07-14T00%3A00%3A00.000Z&calendarIds=${project.id}&query=Design`,
            { auth: "agent" },
          ),
        )
      ).events,
    ).toHaveLength(1);
    expect(
      (
        await request(`/v1/events/${createdEvent.id}`, {
          auth: "agent",
          method: "PATCH",
          body: { title: "Stale agent update" },
        })
      ).status,
    ).toBe(400);
    const changedEvent = await payload(
      await request(`/v1/events/${createdEvent.id}`, {
        auth: "session",
        method: "PATCH",
        body: {
          title: "Updated review",
          notes: null,
          location: null,
          startsAt: "2026-07-13T14:00:00.000Z",
          endsAt: "2026-07-13T15:00:00.000Z",
          timezone: "America/New_York",
          allDay: true,
        },
      }),
    );
    expect(changedEvent.event).toMatchObject({
      title: "Updated review",
      notes: null,
      location: null,
      allDay: true,
    });
    const existingBusy = (
      await payload(
        await request("/v1/events", {
          auth: "agent",
          body: {
            calendarId: personal.id,
            title: "Busy",
            notes: null,
            location: null,
            startsAt: "2026-07-13T14:00:00.000Z",
            endsAt: "2026-07-13T15:00:00.000Z",
            timezone: "America/New_York",
            allDay: true,
          },
        }),
      )
    ).event;
    const blockedEvent = (
      await payload(
        await request(`/v1/events/${createdEvent.id}/blocks`, {
          auth: "session",
          body: { calendarId: personal.id },
        }),
      )
    ).event;
    expect(blockedEvent.blocks).toEqual([
      expect.objectContaining({ eventId: existingBusy.id, mode: "busy" }),
    ]);
    const unifiedBlockedEvents = (
      await payload(
        await request(
          "/v1/events?from=2026-07-13T00%3A00%3A00.000Z&to=2026-07-14T00%3A00%3A00.000Z",
          { auth: "agent" },
        ),
      )
    ).events;
    expect(unifiedBlockedEvents.map((value: { title: string }) => value.title)).toEqual([
      "Updated review",
    ]);
    await request(`/v1/calendars/${project.id}/selected`, {
      auth: "agent",
      method: "PATCH",
      body: { selected: false },
    });
    const destinationOnlyEvents = (
      await payload(
        await request(
          "/v1/events?from=2026-07-13T00%3A00%3A00.000Z&to=2026-07-14T00%3A00%3A00.000Z",
          { auth: "agent" },
        ),
      )
    ).events;
    expect(destinationOnlyEvents).toEqual([
      expect.objectContaining({ blockSourceEventId: createdEvent.id, title: "Busy" }),
    ]);
    await request(`/v1/calendars/${project.id}/selected`, {
      auth: "agent",
      method: "PATCH",
      body: { selected: true },
    });
    expect(
      (
        await payload(
          await request(`/v1/events/${createdEvent.id}/blocks/${existingBusy.id}`, {
            auth: "session",
            method: "PATCH",
            body: { mode: "details" },
          }),
        )
      ).event.blocks[0].mode,
    ).toBe("details");
    await request(`/v1/events/${createdEvent.id}`, {
      auth: "session",
      method: "PATCH",
      body: { title: "Updated linked review" },
    });
    expect(
      (await payload(await request(`/v1/events/${existingBusy.id}`, { auth: "agent" }))).event,
    ).toMatchObject({ notes: null, title: "Updated linked review" });
    expect(
      (
        await request(`/v1/events/${existingBusy.id}`, {
          auth: "session",
          method: "PATCH",
          body: { title: "Detached" },
        })
      ).status,
    ).toBe(409);
    await request(`/v1/events/${createdEvent.id}/blocks/${existingBusy.id}`, {
      auth: "session",
      method: "PATCH",
      body: { mode: "busy" },
    });
    expect(
      (await payload(await request(`/v1/events/${existingBusy.id}`, { auth: "agent" }))).event
        .title,
    ).toBe("Busy");
    expect(
      (
        await request(`/v1/events/${createdEvent.id}`, {
          auth: "session",
          method: "PATCH",
          body: { endsAt: "2026-07-13T12:00:00.000Z" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(`/v1/events/${createdEvent.id}`, { auth: "session", method: "DELETE" }))
        .status,
    ).toBe(204);
    const restoredEvent = (
      await payload(
        await request(`/v1/events/${createdEvent.id}/restore`, {
          auth: "session",
          method: "POST",
        }),
      )
    ).event;
    expect(restoredEvent).toMatchObject({
      blocks: [expect.objectContaining({ eventId: existingBusy.id, mode: "busy" })],
      id: createdEvent.id,
    });
    expect(
      (
        await payload(
          await request(`/v1/events/${createdEvent.id}/blocks/${existingBusy.id}`, {
            auth: "session",
            method: "DELETE",
          }),
        )
      ).event.blocks,
    ).toEqual([]);
    const detailedBlock = (
      await payload(
        await request(`/v1/events/${createdEvent.id}/blocks`, {
          auth: "session",
          body: { calendarId: personal.id, mode: "details" },
        }),
      )
    ).event.blocks[0];
    expect(detailedBlock).toMatchObject({ calendarId: personal.id, mode: "details" });
    await request(`/v1/events/${createdEvent.id}/blocks/${detailedBlock.eventId}`, {
      auth: "session",
      method: "DELETE",
    });
    expect(
      (await request(`/v1/events/${createdEvent.id}/restore`, { auth: "session", method: "POST" }))
        .status,
    ).toBe(404);

    expect((await payload(await request("/v1/connectors"))).accounts).toEqual([]);
    expect((await request("/v1/x-bookmarks/account", { auth: "agent" })).status).toBe(403);
    const xStart = await payload(
      await request("/v1/x-bookmarks/connect/start", { method: "POST" }),
    );
    expect(xStart.url).toContain("https://x.example.com/auth");
    const xState = String(new URL(xStart.url).searchParams.get("state"));
    const xCallback = await request(
      `/v1/x-bookmarks/callback?state=${encodeURIComponent(xState)}&code=x-code`,
      { auth: "none" },
    );
    expect(xCallback.status).toBe(302);
    expect(xCallback.headers.get("location")).toBe(
      "https://app.example.com/settings/connectors?x=connected",
    );
    expect((await request("/v1/x-bookmarks/callback?state=x", { auth: "none" })).status).toBe(400);
    expect(
      (
        await request("/v1/x-bookmarks/callback?state=x&error=access_denied", {
          auth: "none",
        })
      ).status,
    ).toBe(400);
    expect((await payload(await request("/v1/x-bookmarks/folders"))).folders).toMatchObject([
      { name: "Calendar", remoteFolderId: "x-folder" },
    ]);
    expect(
      (
        await payload(
          await request("/v1/x-bookmarks/folder", {
            body: { folderId: "x-folder" },
            method: "PUT",
          }),
        )
      ).result,
    ).toEqual({ changed: 1 });
    expect(
      (await payload(await request("/v1/x-bookmarks", { auth: "agent" }))).bookmarks,
    ).toMatchObject([
      { postUrl: "https://x.com/xauthor/status/x-post", source: { provider: "x" } },
    ]);
    expect(
      (await payload(await request("/v1/x-bookmarks/sync", { auth: "agent", method: "POST" })))
        .result,
    ).toEqual({ changed: 0 });
    expect((await request("/v1/x-bookmarks/account", { method: "DELETE" })).status).toBe(204);
    expect(
      (await request(`/v1/connectors/${personal.accountId}/sync`, { method: "POST" })).status,
    ).toBe(404);
    expect(
      (await request(`/v1/connectors/${personal.accountId}`, { method: "DELETE" })).status,
    ).toBe(404);
    const initialVerificationUrl = deliveredEmails
      .findLast((message) => message.to === "updated@example.com")
      ?.text.match(/https:\/\/[^\s]+/)?.[0];
    const initialVerificationToken = initialVerificationUrl
      ? new URL(initialVerificationUrl).searchParams.get("verifyEmail")
      : null;
    expect(initialVerificationToken).toBeTruthy();
    expect(
      (
        await request("/v1/auth/email-verification/confirm", {
          auth: "none",
          body: { token: initialVerificationToken },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/v1/connectors/icloud", {
          body: {
            appSpecificPassword: "password",
            calendar: false,
            email: "test@icloud.com",
            mail: false,
          },
        })
      ).status,
    ).toBe(400);
    const icloudConnection = await payload(
      await request("/v1/connectors/icloud", {
        body: {
          appSpecificPassword: "xxxx-xxxx-xxxx-xxxx",
          calendar: false,
          email: "test@icloud.com",
          mail: true,
        },
      }),
    );
    expect(icloudConnection.account.email).toBe("test@icloud.com");
    await vi.waitFor(async () => {
      const connectorPayload = await payload(await request("/v1/connectors"));
      expect(connectorPayload.accounts).toEqual([expect.objectContaining({ syncStatus: "idle" })]);
    });
    const mailboxPayload = await payload(await request("/v1/mailboxes", { auth: "agent" }));
    expect(mailboxPayload.mailboxes).toEqual([
      expect.objectContaining({ name: "Inbox", unreadCount: 1 }),
    ]);
    const mailboxId = mailboxPayload.mailboxes[0].id;
    const mailPayload = await payload(
      await request(
        `/v1/mail/threads?mailboxId=${mailboxId}&query=Integration&unread=true&limit=10`,
        { auth: "agent" },
      ),
    );
    expect(mailPayload.threads).toEqual([
      expect.objectContaining({ bodyText: "Integration mail body", subject: "Integration mail" }),
    ]);
    expect(
      (
        await payload(
          await request(`/v1/mail/threads/${mailPayload.threads[0].id}`, { auth: "agent" }),
        )
      ).thread.id,
    ).toBe(mailPayload.threads[0].id);
    expect(
      (await request(`/v1/mail/threads/${crypto.randomUUID()}`, { auth: "agent" })).status,
    ).toBe(404);
    const unavailableGoogle = await request("/v1/connectors/google/start", { method: "POST" });
    expect(unavailableGoogle.status).toBe(503);
    expect((await payload(unavailableGoogle)).error.message).toBe(
      "Google Calendar is not configured.",
    );
    expect((await request("/v1/connectors/google/callback?state=x", { auth: "none" })).status).toBe(
      400,
    );
    expect(
      (
        await request("/v1/connectors/google/callback?state=x&error=access_denied", {
          auth: "none",
        })
      ).status,
    ).toBe(400);

    const audit = (await payload(await request("/v1/audit?limit=100", { auth: "agent" }))).events;
    expect(
      audit.find(
        (entry: { action: string; actorType: string }) =>
          entry.action === "reminder.created" && entry.actorType === "agent",
      ),
    ).toMatchObject({
      after: {
        authorization: {
          kind: "scoped_agent_permission",
        },
        notes: "[redacted]",
        policy: "approved_rule",
        source: {
          accountId: null,
          provider: "local",
          sourceType: "reminder",
        },
        title: "[redacted]",
      },
    });
    expect(
      audit.find(
        (entry: { action: string; entityId: string }) =>
          entry.action === "assistant.attention.updated" && entry.entityId === reminderAttention.id,
      ),
    ).toMatchObject({
      after: {
        relatedEntityId: first.id,
        relatedEntityType: "reminder",
        source: first.source,
      },
    });
    expect(audit.some((entry: { action: string }) => entry.action === "task.created")).toBe(true);
    expect(logs).toHaveBeenCalled();
    expect(
      logs.mock.calls.some(([entry]) => entry.status === 404 && entry.path === "/missing"),
    ).toBe(true);

    const tokensBeforeRevoke = (await payload(await request("/v1/access-tokens"))).tokens;
    expect(
      tokensBeforeRevoke.find((token: { id: string }) => token.id === limitedToken.token.id),
    ).toMatchObject({
      expiresAt: "2026-07-14T12:00:00.000Z",
      lastUsedAt: "2026-07-13T12:00:00.000Z",
      revokedAt: null,
    });
    expect(
      (await request(`/v1/access-tokens/${limitedToken.token.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect(
      (await request(`/v1/access-tokens/${limitedToken.token.id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect(
      (await payload(await request("/v1/access-tokens"))).tokens.find(
        (token: { id: string }) => token.id === limitedToken.token.id,
      ).revokedAt,
    ).toBe("2026-07-13T12:00:00.000Z");
    expect(
      (await request(`/v1/sessions/${crypto.randomUUID()}`, { method: "DELETE" })).status,
    ).toBe(404);

    const directAuth = createAuthService({
      db: database.db,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      sessionTtlDays: 30,
    });
    await expect(directAuth.getUser(crypto.randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
    const directAutomations = createAutomationService({
      db: database.db,
      listEvents: async () => [],
      listReminders: async () => [],
      listTasks: async () => [],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    await expect(
      directAutomations.create(crypto.randomUUID(), {
        schedule: "Daily",
        template: "nightly_review",
        timezone: "UTC",
      }),
    ).rejects.toBeTruthy();
    const brokenAutomations = createAutomationService({
      db: {
        insert: () => {
          throw "unexpected database failure";
        },
      } as never,
      listEvents: async () => [],
      listReminders: async () => [],
      listTasks: async () => [],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    await expect(
      brokenAutomations.create(registrationBody.user.id, {
        schedule: "Daily",
        template: "nightly_review",
        timezone: "UTC",
      }),
    ).rejects.toBe("unexpected database failure");
    const scheduledUser = (
      await database.db
        .insert(users)
        .values({
          displayName: "Scheduler Test",
          email: "scheduler@example.com",
          passwordHash: "not-used-by-scheduler",
          planningTimezone: "UTC",
        })
        .returning()
    )[0];
    if (!scheduledUser) throw new Error("Scheduler test user was not created.");
    const scheduledRoutine = (
      await database.db
        .insert(automationRoutines)
        .values({
          schedule: "Daily at 11:00 AM",
          template: "morning_brief",
          timezone: "UTC",
          title: "Morning Brief",
          userId: scheduledUser.id,
        })
        .returning()
    )[0];
    if (!scheduledRoutine) throw new Error("Scheduler test routine was not created.");
    const dispatchAutomations = createAutomationService({
      db: database.db,
      listEvents: async () => [],
      listReminders: async () => [],
      listTasks: async () => [],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(await dispatchAutomations.dispatchDue()).toEqual([
      expect.objectContaining({ routineId: scheduledRoutine.id, status: "completed" }),
    ]);
    expect(await dispatchAutomations.dispatchDue()).toEqual([]);
    const nowBriefAutomations = createAutomationService({
      db: database.db,
      listEvents: async () => [
        {
          ...createdEvent,
          endsAt: "2026-07-13T13:00:00.000Z",
          startsAt: "2026-07-13T11:00:00.000Z",
        },
      ],
      listReminders: async () => [],
      listTasks: async () => [],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    const timeAwareBrief = await nowBriefAutomations.dailyBrief(registrationBody.user.id, "UTC");
    expect(timeAwareBrief.now).toHaveLength(1);
    expect(timeAwareBrief.capacity).toMatchObject({ availableMinutes: 300, busyMinutes: 60 });

    const capacityAutomations = createAutomationService({
      db: database.db,
      listEvents: async () => [
        { ...createdEvent, allDay: true },
        {
          ...createdEvent,
          endsAt: "2026-07-13T14:00:00.000Z",
          id: crypto.randomUUID(),
          startsAt: "2026-07-13T12:30:00.000Z",
        },
        {
          ...createdEvent,
          endsAt: "2026-07-13T15:00:00.000Z",
          id: crypto.randomUUID(),
          startsAt: "2026-07-13T13:30:00.000Z",
        },
      ],
      listReminders: async () => [],
      listTasks: async () => [
        {
          ...task,
          estimateMinutes: 90,
          scheduledAt: "2026-07-13T13:00:00.000Z",
          status: "scheduled" as const,
        },
        {
          ...inboxTask,
          estimateMinutes: 25,
          status: "next" as const,
        },
        {
          ...inboxTask,
          estimateMinutes: null,
          id: crypto.randomUUID(),
          scheduledAt: "2026-07-13T14:00:00.000Z",
          status: "scheduled" as const,
        },
        {
          ...inboxTask,
          estimateMinutes: null,
          id: crypto.randomUUID(),
          status: "inbox" as const,
        },
      ],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    const allDayBrief = await capacityAutomations.dailyBrief(registrationBody.user.id, "UTC");
    expect(allDayBrief.capacity).toMatchObject({
      availableMinutes: 0,
      busyMinutes: 360,
      flexibleTaskMinutes: 25,
      overcommitted: true,
      scheduledTaskMinutes: 90,
    });
    expect(allDayBrief.recommendedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capacity: "does_not_fit", urgency: "next" }),
        expect.objectContaining({ capacity: "needs_estimate", urgency: "inbox" }),
      ]),
    );

    const reservedCapacityAutomations = createAutomationService({
      db: database.db,
      listEvents: async () => [
        {
          ...createdEvent,
          endsAt: "2026-07-13T14:00:00.000Z",
          startsAt: "2026-07-13T13:00:00.000Z",
        },
      ],
      listReminders: async () => [],
      listTasks: async () => [
        {
          ...task,
          estimateMinutes: 60,
          scheduledAt: "2026-07-13T14:00:00.000Z",
          status: "scheduled" as const,
        },
        {
          ...task,
          estimateMinutes: 90,
          id: crypto.randomUUID(),
          scheduledAt: "2026-07-13T10:00:00.000Z",
          status: "scheduled" as const,
        },
      ],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    const reservedCapacityBrief = await reservedCapacityAutomations.dailyBrief(
      registrationBody.user.id,
      "UTC",
    );
    expect(reservedCapacityBrief.capacity).toMatchObject({
      availableMinutes: 240,
      busyMinutes: 60,
      overcommitted: false,
      scheduledTaskMinutes: 60,
    });

    const recommendationAutomations = createAutomationService({
      db: database.db,
      listEvents: async () => [],
      listReminders: async () => [],
      listTasks: async () => [
        {
          ...task,
          dueAt: "2026-07-13T11:00:00.000Z",
          estimateMinutes: 15,
          id: crypto.randomUUID(),
          priority: "high" as const,
          status: "next" as const,
        },
        {
          ...task,
          dueAt: "2026-07-13T16:00:00.000Z",
          estimateMinutes: 20,
          id: crypto.randomUUID(),
          priority: "medium" as const,
          status: "next" as const,
        },
        {
          ...task,
          dueAt: null,
          estimateMinutes: 25,
          id: crypto.randomUUID(),
          priority: "low" as const,
          status: "next" as const,
        },
        {
          ...task,
          dueAt: null,
          estimateMinutes: 30,
          id: crypto.randomUUID(),
          priority: "high" as const,
          status: "next" as const,
        },
        {
          ...task,
          dueAt: null,
          estimateMinutes: 35,
          id: crypto.randomUUID(),
          priority: "low" as const,
          status: "next" as const,
        },
      ],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(
      (
        await recommendationAutomations.dailyBrief(registrationBody.user.id, "UTC")
      ).recommendedTasks.map((recommendation) => recommendation.urgency),
    ).toEqual(["overdue", "due_today", "next", "next", "next"]);
    const fallbackPlanningBrief = await capacityAutomations.dailyBrief(crypto.randomUUID(), "UTC");
    expect(fallbackPlanningBrief.capacity.workdayStartsAt).toBe("2026-07-13T09:00:00.000Z");

    const googleCredentials: GoogleCredentials = {
      accessToken: "access",
      expiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "refresh",
      scope: "calendar",
      tokenType: "Bearer",
    };
    const googleConnector: GoogleConnector = {
      authorizationUrl: (state) => `https://accounts.example.com/auth?state=${state}`,
      createEvent: vi.fn(),
      deleteEvent: vi.fn(),
      exchangeCode: vi.fn(async () => googleCredentials),
      getProfile: vi.fn(async (credentials) => ({
        credentials,
        value: { email: "production-google@example.com", id: "production-google", name: null },
      })),
      listCalendars: vi.fn(async (credentials) => ({ credentials, value: [] })),
      syncCalendar: vi.fn(),
      updateEvent: vi.fn(),
    };

    const productionApp = createApp({
      config: {
        allowedOrigins: ["https://app.production.example.com"],
        apiBaseUrl: "https://api.production.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://app.production.example.com",
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 2).toString("base64"),
        googleClientId: "google-client",
        googleClientSecret: "google-secret",
        googleRedirectUri: "https://api.production.example.com/v1/connectors/google/callback",
        logLevel: "info",
        port: 8787,
        plaidClientId: "",
        plaidEnvironment: "sandbox",
        plaidSecret: "",
        ownerEmails: ["production@example.com"],
        production: true,
        registrationMode: "invite",
        resendApiKey: "",
        sessionCookieName: "production_session",
        sessionTtlDays: 7,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.production.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
      google: googleConnector,
    });
    const productionRegistration = await productionApp.request("/v1/auth/register", {
      body: JSON.stringify({
        displayName: "Production Test",
        email: "production@example.com",
        password: "LocalTestOnly123!",
        planningTimezone: "UTC",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(productionRegistration.headers.get("set-cookie")).toContain("Secure");
    const productionSession = (await productionRegistration.json()).sessionToken;
    await database.db
      .update(users)
      .set({ emailVerifiedAt: new Date("2026-07-13T12:00:00.000Z") })
      .where(eq(users.email, "production@example.com"));
    const googleStart = await productionApp.request(
      "/v1/connectors/google/start?returnTo=%2Fsetup&services=calendar",
      {
        headers: { authorization: `Session ${productionSession}` },
        method: "POST",
      },
    );
    const googleUrl = (await googleStart.json()).url;
    expect(googleUrl).toContain("accounts.example.com");
    const callback = await productionApp.request(
      `/v1/connectors/google/callback?state=${encodeURIComponent(
        String(new URL(googleUrl).searchParams.get("state")),
      )}&code=authorization-code`,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(
      "https://app.production.example.com/setup?google=connected",
    );
    const connectedAccounts = await productionApp.request("/v1/connectors", {
      headers: { authorization: `Session ${productionSession}` },
    });
    const [productionAccount] = (await connectedAccounts.json()).accounts;
    expect(productionAccount.email).toBe("production-google@example.com");
    const productionSync = await productionApp.request(
      `/v1/connectors/${productionAccount.id}/sync`,
      {
        headers: { authorization: `Session ${productionSession}` },
        method: "POST",
      },
    );
    expect((await productionSync.json()).result.changed).toBe(0);
    expect(
      (
        await productionApp.request(`/v1/connectors/${productionAccount.id}`, {
          headers: { authorization: `Session ${productionSession}` },
          method: "DELETE",
        })
      ).status,
    ).toBe(204);

    expect(
      (await request(`/v1/calendars/${project.id}`, { auth: "agent", method: "DELETE" })).status,
    ).toBe(204);
    expect((await request(`/v1/events/${createdEvent.id}`, { auth: "agent" })).status).toBe(404);
    expect((await request("/v1/auth/logout", { method: "POST" })).status).toBe(204);
    expect((await request("/v1/me")).status).toBe(401);
    agentToken = fullAgentToken;
    expect((await request("/v1/auth/logout", { auth: "agent", method: "POST" })).status).toBe(204);
    expect(
      (
        await request("/v1/me", {
          auth: "none",
          headers: { authorization: "Session invalid" },
        })
      ).status,
    ).toBe(401);
  }, 120_000);

  it("verifies email addresses and resets passwords through one-time email links", async () => {
    expect(
      (
        await request("/v1/auth/register", {
          auth: "none",
          body: {
            displayName: "Weak Password",
            email: "weak-password@example.com",
            password: invalidLowercasePassword,
            planningTimezone: "UTC",
          },
        })
      ).status,
    ).toBe(400);
    const registration = await request("/v1/auth/register", {
      auth: "none",
      body: {
        displayName: "Recovery Test",
        email: "recovery@example.com",
        password: "LocalTestOnly123!",
        planningTimezone: "UTC",
      },
    });
    expect(registration.status).toBe(201);
    const verificationEmail = deliveredEmails.at(-1);
    if (!verificationEmail) throw new Error("Expected a verification email.");
    const verificationUrl = verificationEmail.text.match(/https:\/\/[^\s]+/)?.[0];
    if (!verificationUrl) throw new Error("Expected a verification URL.");
    const verificationToken = new URL(verificationUrl).searchParams.get("verifyEmail");
    if (!verificationToken) throw new Error("Expected a verification token.");

    const confirmation = await request("/v1/auth/email-verification/confirm", {
      auth: "none",
      body: { token: verificationToken },
    });
    expect(confirmation.status).toBe(200);
    expect((await payload(confirmation)).user.emailVerified).toBe(true);
    expect(
      (
        await request("/v1/auth/email-verification/confirm", {
          auth: "none",
          body: { token: verificationToken },
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await request("/v1/auth/recovery", {
          auth: "none",
          body: { email: "recovery@example.com" },
        })
      ).status,
    ).toBe(204);
    const resetEmail = deliveredEmails.at(-1);
    if (!resetEmail) throw new Error("Expected a recovery email.");
    const resetUrl = resetEmail.text.match(/https:\/\/[^\s]+/)?.[0];
    if (!resetUrl) throw new Error("Expected a reset URL.");
    const resetToken = new URL(resetUrl).searchParams.get("resetPassword");
    if (!resetToken) throw new Error("Expected a reset token.");

    expect(
      (
        await request("/v1/auth/password-reset", {
          auth: "none",
          body: { password: invalidLowercasePassword, token: resetToken },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/auth/password-reset", {
          auth: "none",
          body: { password: "DifferentPassword123!", token: resetToken },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await request("/v1/auth/login", {
          auth: "none",
          body: { email: "recovery@example.com", password: "LocalTestOnly123!" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/v1/auth/login", {
          auth: "none",
          body: { email: "recovery@example.com", password: "DifferentPassword123!" },
        })
      ).status,
    ).toBe(200);
  });

  it("rejects HTTP work after runtime quiesce", async () => {
    const lifecycle = createRuntimeLifecycle();
    const drainingApp = createApp({
      config: {
        allowedOrigins: ["https://app.example.com"],
        apiBaseUrl: "https://api.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://app.example.com",
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 5).toString("base64"),
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: "https://api.example.com/v1/connectors/google/callback",
        logLevel: "info",
        plaidClientId: "",
        plaidEnvironment: "sandbox",
        plaidSecret: "",
        port: 8787,
        production: false,
        resendApiKey: "",
        sessionCookieName: "personal_os_session",
        sessionTtlDays: 30,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
      runtimeLifecycle: lifecycle,
    });

    lifecycle.beginQuiesce(Date.now() + 105_000);
    const response = await drainingApp.request("/health/ready");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable" },
    });
  });

  it("issues and rotates ilo MCP OAuth tokens with PKCE", async () => {
    const userRegistration = await request("/v1/auth/register", {
      auth: "none",
      body: {
        displayName: "OAuth Protocol User",
        email: "oauth-protocol@example.com",
        password: "LocalTestOnly123!",
        planningTimezone: "UTC",
      },
    });
    expect(userRegistration.status).toBe(201);
    const oauthSessionToken = (await userRegistration.json()).sessionToken as string;
    const verificationUrl = deliveredEmails.at(-1)?.text.match(/https:\/\/[^\s]+/)?.[0];
    const verificationToken = verificationUrl
      ? new URL(verificationUrl).searchParams.get("verifyEmail")
      : null;
    expect(verificationToken).toBeTruthy();
    expect(
      (
        await app.request("/v1/auth/email-verification/confirm", {
          body: JSON.stringify({ token: verificationToken }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(200);
    const registration = await app.request("/oauth/register", {
      body: JSON.stringify({
        client_name: "Protocol test client",
        redirect_uris: ["http://127.0.0.1:4312/callback"],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(registration.status).toBe(201);
    const client = (await registration.json()) as { client_id: string };
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL("https://api.example.com/oauth/authorize");
    authorize.search = new URLSearchParams({
      client_id: client.client_id,
      code_challenge: challenge,
      code_challenge_method: "S256",
      redirect_uri: "http://127.0.0.1:4312/callback",
      resource: "https://api.example.com/mcp",
      scope: "tasks:read",
      state: "test-state",
    }).toString();
    const consent = await app.request(authorize.pathname + authorize.search, {
      headers: { authorization: `Session ${oauthSessionToken}` },
    });
    expect(consent.status).toBe(200);
    const consentPage = await consent.text();
    expect(consentPage).toContain("Connect Protocol test client");
    expect(consentPage).toContain("Read tasks");
    expect(consentPage).toContain("Connected provider credentials remain inside Ilo");
    expect(consentPage).toContain('class="oauth-card"');
    expect(consentPage).toContain("Requested access");
    expect(consentPage).toContain('class="oauth-cancel"');
    const approved = await app.request("/oauth/authorize", {
      body: new URLSearchParams(Object.fromEntries(authorize.searchParams)).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Session ${oauthSessionToken}`,
      },
      method: "POST",
    });
    const code = new URL(approved.headers.get("location") ?? "").searchParams.get("code");
    expect(code).toMatch(/^oauth_code_/);
    const exchange = await app.request("/oauth/token", {
      body: new URLSearchParams({
        client_id: client.client_id,
        code: code ?? "",
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: "http://127.0.0.1:4312/callback",
        resource: "https://api.example.com/mcp",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect(exchange.status).toBe(200);
    const tokens = (await exchange.json()) as { access_token: string; refresh_token: string };
    expect(
      (
        await (
          await app.request("/v1/access-tokens", {
            headers: { authorization: `Session ${oauthSessionToken}` },
          })
        ).json()
      ).tokens,
    ).toEqual([]);
    expect(
      (
        await (
          await app.request("/v1/oauth/clients", {
            headers: { authorization: `Session ${oauthSessionToken}` },
          })
        ).json()
      ).clients,
    ).toEqual([
      expect.objectContaining({
        id: client.client_id,
        name: "Protocol test client",
        scopes: ["tasks:read"],
      }),
    ]);
    expect(
      (await app.request("/v1/me", { headers: { authorization: `Bearer ${tokens.access_token}` } }))
        .status,
    ).toBe(401);
    const refreshed = await app.request("/oauth/token", {
      body: new URLSearchParams({
        client_id: client.client_id,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        resource: "https://api.example.com/mcp",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect(refreshed.status).toBe(200);
    expect(
      (
        await app.request("/oauth/token", {
          body: new URLSearchParams({
            client_id: client.client_id,
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
            resource: "https://api.example.com/mcp",
          }).toString(),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        })
      ).status,
    ).toBe(401);
  });
});
