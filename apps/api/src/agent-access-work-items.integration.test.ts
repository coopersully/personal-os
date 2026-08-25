import { resolve } from "node:path";
import {
  agentAccessWorkItemSnapshots,
  attentionItems,
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  financeAccounts,
  financeReviewCases,
  financeTransactions,
  mailRules,
  mailStewardshipQuestions,
  mailThreads,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type { AccessScope, AgentConnectionGuide } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { asc, eq } from "drizzle-orm";
import { createAgentAccessWorkItemService } from "./agent-access-work-items.js";
import { AppError } from "./errors.js";
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
      ...Array.from({ length: 25 }, (_, index) => ({
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
    const service = createAgentAccessWorkItemService({
      cursorSigningKey: "agent-access-test-signing-key",
      db: database.db,
      now: () => snapshot,
    });

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
    expect(first.summary.total).toBe(30);
    expect(first.filteredTotal).toBe(30);
    expect(first.nextCursor).toEqual(expect.any(String));

    await database.db
      .update(attentionItems)
      .set({ status: "resolved", updatedAt: new Date("2026-08-11T19:00:00.000Z") })
      .where(eq(attentionItems.title, "Queue attention 12"));

    const second = await service.list(
      principal,
      { cursor: first.nextCursor as string, limit: 10 },
      publishedDomains,
    );
    expect(second.items).toHaveLength(10);
    expect(second.nextCursor).toEqual(expect.any(String));
    const third = await service.list(
      principal,
      { cursor: second.nextCursor as string, limit: 10 },
      publishedDomains,
    );
    expect(third.items).toHaveLength(10);
    expect(
      new Set([...first.items, ...second.items, ...third.items].map((item) => item.id)).size,
    ).toBe(30);
    expect(third.nextCursor).toBeNull();
    await expect(
      service.list(
        { ...principal, actorId: "another-agent", actorType: "agent" },
        { cursor: first.nextCursor as string, limit: 10 },
        publishedDomains,
      ),
    ).rejects.toBeInstanceOf(AppError);
    await database.db
      .update(attentionItems)
      .set({ status: "open", updatedAt: new Date("2026-08-11T12:12:00.000Z") })
      .where(eq(attentionItems.title, "Queue attention 12"));

    const reviews = await service.list(principal, { kind: "review", limit: 10 }, publishedDomains);
    expect(reviews.items).toHaveLength(3);
    expect(reviews.items.every((item) => item.kind === "review")).toBe(true);
    expect(reviews.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: expect.objectContaining({
            label: "Review rule",
            to: expect.stringMatching(/^\/settings\?section=mail&reviewRule=/),
          }),
          title: "Review Statements",
        }),
        expect.objectContaining({
          action: { label: "Review guidance", to: "/settings?section=finances#guidance" },
          title: "Review Finances guidance",
        }),
      ]),
    );
    expect(reviews.filteredTotal).toBe(3);
    expect(reviews.summary.total).toBe(30);
    const persistedSnapshots = await database.db
      .select()
      .from(agentAccessWorkItemSnapshots)
      .where(eq(agentAccessWorkItemSnapshots.userId, principal.userId));
    expect(persistedSnapshots).toHaveLength(1);

    const mail = await service.list(principal, { domain: "mail", limit: 10 }, publishedDomains);
    expect(mail.items.every((item) => item.domain === "mail")).toBe(true);

    await expect(
      service.list(
        principal,
        { cursor: first.nextCursor as string, kind: "review", limit: 10 },
        publishedDomains,
      ),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      service.list(principal, { cursor: "not-a-cursor", limit: 10 }, publishedDomains),
    ).rejects.toBeInstanceOf(AppError);
    const cursorPayload = JSON.parse(
      Buffer.from(first.nextCursor as string, "base64url").toString("utf8"),
    ) as { cursor: { id: string } };
    cursorPayload.cursor.id = "attention:tampered";
    const tamperedCursor = Buffer.from(JSON.stringify(cursorPayload)).toString("base64url");
    await expect(
      service.list(principal, { cursor: tamperedCursor, limit: 10 }, publishedDomains),
    ).rejects.toBeInstanceOf(AppError);

    const laterService = createAgentAccessWorkItemService({
      cursorSigningKey: "agent-access-test-signing-key",
      db: database.db,
      now: () => new Date(snapshot.getTime() + 16 * 60_000),
    });
    await laterService.list(principal, { kind: "review", limit: 10 }, publishedDomains);
    const snapshotsAfterCleanup = await database.db
      .select()
      .from(agentAccessWorkItemSnapshots)
      .where(eq(agentAccessWorkItemSnapshots.userId, principal.userId));
    expect(snapshotsAfterCleanup).toHaveLength(0);
    await expect(
      laterService.list(
        principal,
        { cursor: first.nextCursor as string, limit: 10 },
        publishedDomains,
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "The Agent Access cursor has expired.",
    });
  });

  it("does not leak other-user work", async () => {
    const service = createAgentAccessWorkItemService({
      cursorSigningKey: "agent-access-test-signing-key",
      db: database.db,
      now: () => snapshot,
    });
    const page = await service.list(otherPrincipal, { limit: 10 }, publishedDomains);

    expect(page.items.map((item) => item.title)).toContain("Other user attention");
    expect(page.items.map((item) => item.title)).not.toContain("Statements");
  });

  it("keeps successful work visible when one domain projection is unavailable", async () => {
    const service = createAgentAccessWorkItemService({
      cursorSigningKey: "agent-access-test-signing-key",
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
    expect(page.filteredTotal).toBeNull();
    expect(page.summary.byDomain.mail).toBeNull();
    expect(page.summary.byDomain.tasks).toBeGreaterThan(0);
  });

  it("projects mixed authority and source edge cases without inventing work", async () => {
    const [attention] = await database.db
      .select()
      .from(attentionItems)
      .where(eq(attentionItems.userId, principal.userId))
      .orderBy(asc(attentionItems.id))
      .limit(1);
    const [rule] = await database.db
      .select()
      .from(mailRules)
      .where(eq(mailRules.userId, principal.userId))
      .orderBy(asc(mailRules.id))
      .limit(1);
    const [profile] = await database.db
      .select()
      .from(domainProfiles)
      .where(eq(domainProfiles.userId, principal.userId))
      .orderBy(asc(domainProfiles.id))
      .limit(1);
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.userId, principal.userId))
      .orderBy(asc(calendarAccounts.id))
      .limit(1);
    if (!attention || !rule || !profile || !account) {
      throw new Error("Agent Access edge-case fixtures were not found.");
    }

    const service = createAgentAccessWorkItemService({
      cursorSigningKey: "agent-access-test-signing-key",
      db: database.db,
      now: () => snapshot,
      sourceReaders: {
        accounts: async () => [
          { ...account, calendarEnabled: false, mailEnabled: false },
          { ...account, id: `${account.id}-calendar`, mailEnabled: false },
        ],
        attention: async () => [
          {
            ...attention,
            domain: "unsupported-domain" as (typeof attention)["domain"],
          },
          {
            ...attention,
            id: `${attention.id}-scheduled`,
            occursAt: new Date("2026-08-11T13:00:00.000Z"),
          },
        ],
        financeReviews: async () => [],
        mailRules: async () => [{ ...rule, description: "" }],
        profiles: async () => [{ ...profile, domain: "mail" }],
      },
    });
    const page = await service.list(principal, { limit: 10 }, publishedDomains);

    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "mail",
          id: `mail-rule:${rule.id}`,
          summary: "Review the current bounded sample before activation.",
        }),
        expect.objectContaining({
          actionAt: "2026-08-11T13:00:00.000Z",
          id: `attention:${attention.id}-scheduled`,
        }),
      ]),
    );
    expect(page.items.some((item) => item.id.startsWith("profile:"))).toBe(false);
    expect(page.items.some((item) => item.id.startsWith("reconnect:mail:"))).toBe(false);
    expect(page.items.some((item) => item.id.includes("unsupported-domain"))).toBe(false);
  });

  it("marks every affected summary unavailable when core projections fail", async () => {
    const service = createAgentAccessWorkItemService({
      cursorSigningKey: "agent-access-test-signing-key",
      db: database.db,
      now: () => snapshot,
      sourceReaders: {
        attention: async () => {
          throw new Error("Attention unavailable");
        },
      },
    });
    const page = await service.list(principal, { limit: 10 }, publishedDomains);

    expect(page.unavailableDomains).toEqual(["calendar", "finances", "mail", "tasks"]);
    expect(page.summary).toMatchObject({
      byDomain: { calendar: null, finances: null, mail: null, tasks: null },
      byKind: { attention: null },
      total: null,
    });
  });

  it("does not hide an available kind when a failed source belongs only to inaccessible workspaces", async () => {
    const service = createAgentAccessWorkItemService({
      cursorSigningKey: "agent-access-test-signing-key",
      db: database.db,
      now: () => snapshot,
      sourceReaders: {
        mailRules: async () => {
          throw new Error("Mail rules unavailable");
        },
      },
    });
    const calendarOnly: Principal = {
      ...principal,
      scopes: new Set<AccessScope>(["calendar:read"]),
    };

    const page = await service.list(calendarOnly, { limit: 10 }, publishedDomains);

    expect(page.unavailableDomains).not.toContain("mail");
    expect(page.summary.byKind.review).toBe(0);
  });

  it("projects redacted Mail questions and deduplicates a represented maintenance block", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.userId, principal.userId))
      .limit(1);
    if (!account) throw new Error("Mail account fixture was not found.");
    const privateSubject = "Acquisition terms for Private Company";
    const privateBody = "The confidential offer is 12.7 million dollars.";
    const privateAddress = "counsel@private-company.example";
    const [thread] = await database.db
      .insert(mailThreads)
      .values({
        accountId: account.id,
        bodyText: privateBody,
        from: { address: privateAddress, name: "Private Counsel" },
        provider: "google",
        receivedAt: new Date("2026-08-11T14:00:00.000Z"),
        remoteThreadId: "private-review-thread",
        snippet: privateBody,
        subject: privateSubject,
        to: [],
        userId: principal.userId,
      })
      .returning();
    if (!thread) throw new Error("Mail thread fixture was not created.");
    const [question] = await database.db
      .insert(mailStewardshipQuestions)
      .values({
        accountId: account.id,
        createdAt: new Date("2026-08-11T14:05:00.000Z"),
        evidence: [],
        fingerprint: "a".repeat(64),
        kind: "needs_disposition",
        options: [
          { label: "Keep active", value: "active" },
          { label: "Reference", value: "reference" },
        ],
        reason: "Choose the durable disposition for this thread.",
        threadId: thread.id,
        updatedAt: new Date("2026-08-11T14:05:00.000Z"),
        userId: principal.userId,
      })
      .returning();
    if (!question) throw new Error("Mail question fixture was not created.");

    const service = createAgentAccessWorkItemService({
      cursorSigningKey: "agent-access-test-signing-key",
      db: database.db,
      now: () => snapshot,
    });
    const questionPage = await service.list(
      principal,
      { domain: "mail", kind: "review", limit: 10 },
      publishedDomains,
    );
    expect(questionPage.items).toContainEqual(
      expect.objectContaining({
        action: { label: "Answer in Mail", to: `/mail/review?question=${question.id}` },
        domain: "mail",
        id: `mail-question:${question.id}`,
        kind: "review",
        priority: "person_review",
      }),
    );
    const serialized = JSON.stringify(questionPage.items);
    expect(serialized).not.toContain(privateSubject);
    expect(serialized).not.toContain(privateBody);
    expect(serialized).not.toContain(privateAddress);
    expect(serialized).toContain(account.id);
    expect(serialized).toContain(thread.id);

    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        createdAt: new Date("2026-08-11T14:10:00.000Z"),
        domain: "mail",
        rulebookVersion: "mail-playbook@1.0.0",
        scope: { type: "all_outstanding" },
        status: "blocked",
        updatedAt: new Date("2026-08-11T14:10:00.000Z"),
        userId: principal.userId,
      })
      .returning();
    if (!run) throw new Error("Mail maintenance fixture was not created.");

    const blockedPage = await service.list(
      principal,
      { domain: "mail", kind: "review", limit: 10 },
      publishedDomains,
    );
    expect(blockedPage.items).toContainEqual(
      expect.objectContaining({
        action: { label: "Review Mail", to: "/mail/review" },
        id: `mail-run:${run.id}`,
        priority: "blocked",
      }),
    );
    expect(blockedPage.items.some((item) => item.id === `mail-question:${question.id}`)).toBe(
      false,
    );
  });
});
