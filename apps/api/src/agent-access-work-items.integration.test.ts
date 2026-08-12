import { resolve } from "node:path";
import {
  accessTokens,
  attentionItems,
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  financeAccounts,
  financeReviewCases,
  financeTransactions,
  mailRules,
  migrateDatabase,
  users,
} from "@personal-os/database";
import type { AccessScope, AgentConnectionGuide } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { AppError } from "./errors.js";
import { createAgentAccessWorkItemService } from "./agent-access-work-items.js";
import type { Principal } from "./types.js";

const snapshot = new Date("2026-08-11T18:00:00.000Z");
const publishedDomains: AgentConnectionGuide["domains"] = [
  {
    domain: "mail",
    readScope: "mail:read",
    support: "executable_rules",
    writeScope: "mail:write",
  },
  {
    domain: "finances",
    readScope: "finances:read",
    support: "profile_and_attention",
    writeScope: "finances:write",
  },
  {
    domain: "calendar",
    readScope: "calendar:read",
    support: "profile_and_attention",
    writeScope: "calendar:write",
  },
  {
    domain: "tasks",
    readScope: "tasks:read",
    support: "profile_and_attention",
    writeScope: "tasks:write",
  },
];
const humanScopes = new Set<AccessScope>([
  "mail:read",
  "mail:write",
  "finances:read",
  "finances:write",
  "calendar:read",
  "calendar:write",
  "tasks:read",
  "tasks:write",
]);

describe.sequential("Agent Access work-item projection", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let otherPrincipal: Principal;
  let principal: Principal;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const [user, otherUser] = await database.db
      .insert(users)
      .values([
        {
          displayName: "Queue User",
          email: "queue@example.com",
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
        {
          displayName: "Other User",
          email: "other-queue@example.com",
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
      ])
      .returning();
    if (!user || !otherUser) throw new Error("Queue fixture users were not created.");
    principal = { actorId: user.id, actorType: "user", scopes: humanScopes, userId: user.id };
    otherPrincipal = {
      actorId: otherUser.id,
      actorType: "user",
      scopes: humanScopes,
      userId: otherUser.id,
    };

    await database.db.insert(accessTokens).values({
      lastUsedAt: new Date("2026-08-11T17:00:00.000Z"),
      name: "Mail host",
      scopes: ["mail:read", "mail:write"],
      tokenHash: "queue-observed-token",
      userId: user.id,
    });
    await database.db.insert(domainProfiles).values({
      categories: [],
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
      domain: "finances",
      instructions: [],
      objective: "Keep finances reviewed.",
      preferences: {},
      sourceContexts: [],
      status: "draft",
      summary: "Review the current Finance guidance.",
      updatedAt: new Date("2026-08-11T10:00:00.000Z"),
      userId: user.id,
    });
    await database.db.insert(mailRules).values({
      actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
      condition: { field: "sender", operator: "equals", value: "statements@example.test" },
      createdAt: new Date("2026-08-11T09:00:00.000Z"),
      description: "Mark monthly statements read.",
      enabled: false,
      name: "Statements",
      policy: "preview",
      updatedAt: new Date("2026-08-11T09:00:00.000Z"),
      userId: user.id,
    });
    const [financeAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Test Bank",
        name: "Checking",
        provider: "manual",
        status: "manual",
        userId: user.id,
      })
      .returning();
    if (!financeAccount) throw new Error("Finance account fixture was not created.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: financeAccount.id,
        amount: 4200,
        createdAt: new Date("2026-08-11T08:00:00.000Z"),
        direction: "expense",
        merchant: "Private merchant",
        transactionDate: "2026-08-10",
        updatedAt: new Date("2026-08-11T08:00:00.000Z"),
        userId: user.id,
      })
      .returning();
    if (!transaction) throw new Error("Finance transaction fixture was not created.");
    await database.db.insert(financeReviewCases).values({
      createdAt: new Date("2026-08-11T08:00:00.000Z"),
      reason: "unknown_merchant",
      status: "open",
      transactionId: transaction.id,
      updatedAt: new Date("2026-08-11T08:00:00.000Z"),
      userId: user.id,
    });
    await database.db.insert(calendarAccounts).values({
      calendarEnabled: true,
      createdAt: new Date("2026-08-11T11:00:00.000Z"),
      label: "Work",
      mailEnabled: true,
      provider: "google",
      providerAccountId: "queue-google-account",
      syncError: "redacted fixture failure",
      syncErrorCategory: "authorization",
      syncErrorCode: "authorization_required",
      syncFailureCount: 1,
      syncRecovery: "reconnect",
      syncStatus: "error",
      updatedAt: new Date("2026-08-11T11:00:00.000Z"),
      userId: user.id,
    });
    await database.db.insert(attentionItems).values([
      ...Array.from({ length: 13 }, (_, index) => ({
        createdAt: new Date(`2026-08-11T12:${String(index).padStart(2, "0")}:00.000Z`),
        domain: index === 0 ? ("mail" as const) : ("tasks" as const),
        importance: index === 0 ? ("critical" as const) : ("normal" as const),
        kind: "important" as const,
        status: "open" as const,
        summary: `Queue attention summary ${index}.`,
        title: `Queue attention ${index}`,
        updatedAt: new Date(`2026-08-11T12:${String(index).padStart(2, "0")}:00.000Z`),
        userId: user.id,
      })),
      {
        createdAt: new Date("2026-08-11T12:30:00.000Z"),
        domain: "mail",
        importance: "critical",
        kind: "important",
        status: "open",
        summary: "This belongs to the other user.",
        title: "Other user attention",
        updatedAt: new Date("2026-08-11T12:30:00.000Z"),
        userId: otherUser.id,
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("orders, summarizes, filters, and cursor-paginates owned work", async () => {
    const service = createAgentAccessWorkItemService({ db: database.db, now: () => snapshot });

    const first = await service.list(principal, { limit: 10 }, publishedDomains);
    expect(first.items).toHaveLength(10);
    expect(first.items.slice(0, 3).map((item) => item.kind)).toEqual([
      "review",
      "review",
      "review",
    ]);
    expect(first.items.map((item) => item.title)).not.toContain("Private merchant");
    expect(first.items.map((item) => item.title)).not.toContain("Other user attention");
    expect(first.items.some((item) => item.title === "Reconnect Work for Mail")).toBe(true);
    expect(first.items.some((item) => item.title === "Reconnect Work for Calendar")).toBe(true);
    expect(first.summary.byKind.review).toBe(3);
    expect(first.summary.total).toBe(21);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await service.list(
      principal,
      { cursor: first.nextCursor as string, limit: 10 },
      publishedDomains,
    );
    expect(second.items).toHaveLength(10);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(20);
    expect(second.nextCursor).toEqual(expect.any(String));
    const third = await service.list(
      principal,
      { cursor: second.nextCursor as string, limit: 10 },
      publishedDomains,
    );
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();

    const reviews = await service.list(principal, { kind: "review", limit: 10 }, publishedDomains);
    expect(reviews.items).toHaveLength(3);
    expect(reviews.items.every((item) => item.kind === "review")).toBe(true);
    expect(reviews.summary.total).toBe(21);

    await expect(
      service.list(
        principal,
        { cursor: first.nextCursor as string, kind: "review", limit: 10 },
        publishedDomains,
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("shows one account-level connection action without leaking other-user work", async () => {
    const service = createAgentAccessWorkItemService({ db: database.db, now: () => snapshot });
    const page = await service.list(otherPrincipal, { limit: 10 }, publishedDomains);

    expect(page.items[0]).toMatchObject({
      domain: null,
      id: "setup:connect-agent",
      kind: "setup",
      title: "Connect an agent",
    });
    expect(page.items.map((item) => item.title)).toContain("Other user attention");
    expect(page.items.map((item) => item.title)).not.toContain("Statements");
  });

  it("keeps successful work visible when one domain projection is unavailable", async () => {
    const service = createAgentAccessWorkItemService({
      db: database.db,
      now: () => snapshot,
      sourceReaders: {
        mailRules: async () => {
          throw new Error("Mail rules unavailable");
        },
      },
    });
    const page = await service.list(principal, { limit: 10 }, publishedDomains);

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.unavailableDomains).toContain("mail");
    expect(page.summary.total).toBeNull();
    expect(page.summary.byDomain.mail).toBeNull();
    expect(page.summary.byDomain.tasks).toBeGreaterThan(0);
  });
});
