import { resolve } from "node:path";
import {
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  calendarWorkspaceSettings,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financesWorkspaceSettings,
  financeTransactions,
  mailboxes,
  mailMessages,
  mailThreads,
  mailWorkspaceSettings,
  migrateDatabase,
  reminders,
  taskLists,
  taskProjects,
  tasksWorkspaceSettings,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  agentAccessWorkItemSchema,
  featureAccessPolicies,
  getDefaultWorkspacePreferences,
  type SearchableWorkspace,
  updateWorkspaceSettingsSchema,
  workspaceSearchQuerySchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createAgentAccessWorkItemService } from "../agent-access-work-items.js";
import { errorResponse } from "../errors.js";
import { registerWorkspaceSearchRoutes } from "../routes/workspace-search.js";
import type { AppEnv, Principal } from "../types.js";
import { createWorkspaceSettingsService } from "../workspace-settings/service.js";
import { createWorkspaceSearchService } from "./service.js";

const instant = new Date("2026-10-03T12:00:00Z");
describe.sequential("workspace discovery and account preferences", () => {
  let database: DatabaseClient;
  let container: StartedPostgreSqlContainer;
  let userId: string;
  let otherId: string;
  let principal: Principal;
  let app: Hono<AppEnv>;
  let search: ReturnType<typeof createWorkspaceSearchService>;
  let settings: ReturnType<typeof createWorkspaceSettingsService>;
  it("returns resolved defaults and identical first-save/read representations", async () => {
    const [fresh] = await database.db
      .insert(users)
      .values({
        email: "settings-defaults@example.com",
        displayName: "Defaults",
        passwordHash: "unused",
      })
      .returning();
    if (!fresh) throw new Error("Missing settings user");
    const context = { principal: { ...principal, userId: fresh.id }, requestId: "default-parity" };
    for (const workspace of ["calendar", "tasks", "mail", "finances"] as const) {
      expect(await settings.get(fresh.id, workspace)).toEqual({
        workspace,
        revision: 0,
        preferences: getDefaultWorkspacePreferences(workspace),
      });
      const saved = await settings.update(
        workspace,
        { expectedRevision: 0, preferences: { includeArchivedInSearch: false } },
        context,
      );
      expect(saved).toEqual(await settings.get(fresh.id, workspace));
      expect(saved.preferences).toEqual({
        ...getDefaultWorkspacePreferences(workspace),
        includeArchivedInSearch: false,
      });
    }
  });
  it("accepts one concurrent exact-revision winner and audits only that owner-bound write", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({ email: "settings-race@example.com", displayName: "Race", passwordHash: "unused" })
      .returning();
    if (!owner) throw new Error("Missing race owner");
    const context = { principal: { ...principal, userId: owner.id }, requestId: "settings-race" };
    const results = await Promise.allSettled([
      settings.update(
        "tasks",
        { expectedRevision: 0, preferences: { taskSort: "title" } },
        context,
      ),
      settings.update(
        "tasks",
        { expectedRevision: 0, preferences: { taskSort: "priority" } },
        context,
      ),
    ]);
    const winners = results.filter((result) => result.status === "fulfilled");
    const losers = results.filter((result) => result.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.reason).toMatchObject({ code: "conflict" });
    expect(await settings.get(owner.id, "tasks")).toEqual(winners[0]?.value);
    expect((await settings.get(otherId, "tasks")).revision).toBe(0);
    const events = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, owner.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "workspace.preferences_updated",
      requestId: "settings-race",
      before: null,
      after: expect.objectContaining({ revision: 1, userId: owner.id }),
    });
  });
  it("deduplicates repeated search terms and rejects excessive unique terms", async () => {
    const repeated = await search.search(
      userId,
      "tasks",
      workspaceSearchQuerySchema.parse({ q: "needle ".repeat(20) }),
    );
    const single = await search.search(
      userId,
      "tasks",
      workspaceSearchQuerySchema.parse({ q: "needle" }),
    );
    expect(repeated.items).toEqual(single.items);
    await expect(
      search.search(
        userId,
        "tasks",
        workspaceSearchQuerySchema.parse({
          q: "one two three four five six seven eight nine ten eleven twelve thirteen",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("bounds blocked database searches and leaves other queries usable", async () => {
    let release!: () => void;
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const lock = database.db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE reminders IN ACCESS EXCLUSIVE MODE`);
      acquired();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await ready;
    try {
      await expect(
        search.search(userId, "tasks", workspaceSearchQuerySchema.parse({ q: "needle" })),
      ).rejects.toThrow();
    } finally {
      release();
      await lock;
    }
    await expect(
      search.search(userId, "tasks", workspaceSearchQuerySchema.parse({ q: "needle" })),
    ).resolves.toMatchObject({ coverage: "synced" });
  });
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const created = await database.db
      .insert(users)
      .values([
        { email: "search@example.com", displayName: "Search", passwordHash: "unused" },
        { email: "other-search@example.com", displayName: "Other", passwordHash: "unused" },
      ])
      .returning();
    if (!created[0] || !created[1]) throw new Error("Missing test users");
    userId = created[0].id;
    otherId = created[1].id;
    principal = {
      userId,
      actorId: userId,
      actorType: "user",
      scopes: new Set<AccessScope>([
        "calendar:read",
        "calendar:write",
        "tasks:read",
        "tasks:write",
        "reminders:read",
        "mail:read",
        "mail:write",
        "finances:read",
        "finances:write",
      ]),
    };
    await database.db.insert(reminders).values([
      { userId, title: "Search needle completed", status: "completed", completedAt: instant },
      { userId, title: "Search needle deleted", deletedAt: instant },
      { userId: otherId, title: "Search needle private" },
      { userId, title: "100% literal_needle" },
    ]);
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({ userId, provider: "google", label: "Search account", mailEnabled: true })
      .returning();
    if (!account) throw new Error("Missing test account");
    const [calendar] = await database.db
      .insert(calendars)
      .values({
        userId,
        accountId: account.id,
        provider: "google",
        name: "Hidden calendar",
        timezone: "UTC",
        isSelected: false,
      })
      .returning();
    if (!calendar) throw new Error("Missing test calendar");
    await database.db.insert(calendarEvents).values({
      userId,
      calendarId: calendar.id,
      provider: "google",
      title: "Search needle 2020",
      startsAt: new Date("2020-01-01T12:00:00Z"),
      endsAt: new Date("2020-01-01T13:00:00Z"),
      timezone: "UTC",
    });
    const [thread] = await database.db
      .insert(mailThreads)
      .values({
        userId,
        accountId: account.id,
        provider: "google",
        remoteThreadId: "test",
        subject: "A conversation",
        snippet: "Preview",
        bodyText: "First message",
        from: { address: "sender@example.com", name: "Sender" },
        receivedAt: instant,
      })
      .returning();
    if (!thread) throw new Error("Missing test thread");
    await database.db.insert(mailMessages).values({
      threadId: thread.id,
      remoteMessageId: "message",
      bodyText: "Search needle in an older reply",
      from: { address: "sender@example.com", name: "Sender" },
      receivedAt: instant,
    });
    await database.db.insert(mailboxes).values({
      userId,
      accountId: account.id,
      provider: "google",
      remoteMailboxId: "TRASH",
      name: "Trash",
      role: "trash",
    });
    await database.db.insert(mailThreads).values({
      userId,
      accountId: account.id,
      provider: "google",
      remoteThreadId: "trash",
      subject: "Search needle trash",
      snippet: "Trash",
      bodyText: "Search needle",
      from: { address: "sender@example.com", name: "Sender" },
      receivedAt: instant,
      remoteMailboxIds: ["TRASH"],
    });
    const [bank] = await database.db
      .insert(financeAccounts)
      .values({
        userId,
        provider: "manual",
        institution: "Example bank",
        name: "Checking",
        kind: "cash",
      })
      .returning();
    if (!bank) throw new Error("Missing test bank");
    await database.db.insert(financeTransactions).values({
      userId,
      accountId: bank.id,
      merchant: "Search needle merchant",
      amount: 12345,
      transactionDate: "2026-10-03",
      direction: "expense",
    });
    search = createWorkspaceSearchService(database.db);
    settings = createWorkspaceSettingsService(database.db);
    app = new Hono<AppEnv>();
    app.use("*", async (context, next) => {
      context.set("principal", principal);
      context.set("requestId", "search-test");
      await next();
    });
    app.onError(errorResponse);
    registerWorkspaceSearchRoutes({
      app,
      db: database.db,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: "search-test",
      }),
      workItems: createAgentAccessWorkItemService({
        db: database.db,
        now: () => instant,
        cursorSigningKey: "search-test-key",
      }),
    });
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it.each([
    "calendar",
    "tasks",
    "mail",
    "finances",
  ] as SearchableWorkspace[])("finds %s records outside the visible view with bounded previews", async (workspace) => {
    const page = await search.search(
      userId,
      workspace,
      workspaceSearchQuerySchema.parse({ q: "search needle" }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.href).toMatch(/^\/(?!\/)/);
    expect(page.items[0]?.preview.length).toBeLessThanOrEqual(240);
    expect(page.items.map((item) => item.title).join()).not.toMatch(/deleted|private|trash/);
  });
  it("formats deadlines in the owner's planning timezone", async () => {
    await database.db
      .update(users)
      .set({ planningTimezone: "America/New_York" })
      .where(eq(users.id, userId));
    await database.db
      .insert(reminders)
      .values({ userId, title: "Midnight deadline", dueAt: new Date("2026-10-07T01:00:00Z") });
    const result = await search.search(
      userId,
      "tasks",
      workspaceSearchQuerySchema.parse({ q: "Midnight deadline" }),
    );
    expect(result.items[0]?.preview).toContain("Due Oct 06, 2026");
  });
  it("preserves Unicode at the review preview boundary", async () => {
    const review = agentAccessWorkItemSchema.parse({
      id: "attention:unicode",
      domain: "tasks",
      kind: "attention",
      priority: "normal",
      title: "Unicode review",
      summary: "a".repeat(239) + "😀 remainder",
      action: null,
      actionAt: null,
      source: null,
      updatedAt: instant.toISOString(),
    });
    const result = await search.search(
      userId,
      "tasks",
      workspaceSearchQuerySchema.parse({ q: "Unicode review" }),
      [review],
    );
    expect(result.items[0]?.preview).toBe("a".repeat(239) + "😀");
    expect(result.items[0]?.href).toBe("/tasks?review=attention%3Aunicode");
  });
  it("labels archived conversations and honors active-only Mail search", async () => {
    const archived = await search.search(
      userId,
      "mail",
      workspaceSearchQuerySchema.parse({ q: "needle" }),
    );
    expect(archived.items[0]?.state).toBe("Archived");
    const active = await search.search(
      userId,
      "mail",
      workspaceSearchQuerySchema.parse({ q: "needle", includeArchived: "false" }),
    );
    expect(active.items).toEqual([]);
  });
  it.each([
    true,
    false,
  ])("finds hidden historical events independent of archive inclusion (%s)", async (includeArchived) => {
    const page = await search.search(
      userId,
      "calendar",
      workspaceSearchQuerySchema.parse({ q: "needle", includeArchived: String(includeArchived) }),
    );
    expect(page.items[0]).toMatchObject({ state: "Hidden calendar" });
    expect(page.items[0]?.href).toContain("date=2020-01-01");
  });
  it("respects archived/completed filter and treats wildcard punctuation literally", async () => {
    expect(
      (
        await search.search(
          userId,
          "tasks",
          workspaceSearchQuerySchema.parse({ q: "needle", includeArchived: "false" }),
        )
      ).items.map((item) => item.title),
    ).toEqual(["100% literal_needle"]);
    expect(
      (await search.search(userId, "tasks", workspaceSearchQuerySchema.parse({ q: "%" }))).items,
    ).toHaveLength(1);
    expect(
      (await search.search(userId, "tasks", workspaceSearchQuerySchema.parse({ q: "' OR 1=1 --" })))
        .items,
    ).toHaveLength(0);
    const first = await search.search(
      userId,
      "tasks",
      workspaceSearchQuerySchema.parse({ q: "needle", limit: 1 }),
    );
    const second = await search.search(
      userId,
      "tasks",
      workspaceSearchQuerySchema.parse({ q: "needle", limit: 1, offset: first.nextOffset }),
    );
    expect(first.nextOffset).toBe(1);
    expect(second.nextOffset).toBeNull();
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
  });
  it.each([
    "calendar",
    "tasks",
    "mail",
    "finances",
  ] as SearchableWorkspace[])("persists %s preferences without overwriting account defaults", async (workspace) => {
    expect((await settings.get(userId, workspace)).revision).toBe(0);
    const context = { principal, requestId: "preferences-test" };
    const saved = await settings.update(
      workspace,
      { expectedRevision: 0, preferences: { includeArchivedInSearch: false } },
      context,
    );
    expect(saved.revision).toBe(1);
    expect((await settings.get(userId, workspace)).preferences.includeArchivedInSearch).toBe(false);
    expect((await settings.get(otherId, workspace)).preferences.includeArchivedInSearch).toBe(true);
    await expect(
      settings.update(workspace, { expectedRevision: 0, preferences: {} }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, `${workspace}_workspace_settings`),
          eq(auditEvents.entityId, userId),
        ),
      );
    expect(audits).toHaveLength(1);
    const table = {
      calendar: calendarWorkspaceSettings,
      tasks: tasksWorkspaceSettings,
      mail: mailWorkspaceSettings,
      finances: financesWorkspaceSettings,
    }[workspace];
    const [persisted] = await database.db.select().from(table).where(eq(table.userId, userId));
    expect(audits[0]?.before).toBeNull();
    expect(audits[0]?.after).toEqual(JSON.parse(JSON.stringify(persisted)));
  });
  it("persists Finance view and grouping with partial updates and workspace isolation", async () => {
    const context = { principal, requestId: "finance-display" };
    const before = await settings.get(userId, "finances");
    const saved = await settings.update(
      "finances",
      {
        expectedRevision: before.revision,
        preferences: { financeTransactionView: "cards", financeTransactionGroup: "merchant" },
      },
      context,
    );
    await settings.update(
      "finances",
      {
        expectedRevision: saved.revision,
        preferences: { financeTransactionGroup: "none" },
      },
      context,
    );
    expect((await settings.get(userId, "finances")).preferences).toMatchObject({
      financeTransactionView: "cards",
      financeTransactionGroup: "none",
    });
    expect((await settings.get(otherId, "finances")).preferences.financeTransactionView).not.toBe(
      "cards",
    );
    await expect(
      settings.update(
        "tasks",
        { expectedRevision: 0, preferences: { financeTransactionView: "cards" } },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(
      updateWorkspaceSettingsSchema.safeParse({
        expectedRevision: 0,
        preferences: { financeTransactionGroup: "invalid" },
      }).success,
    ).toBe(false);
  });
  it("persists Tasks display defaults, preserves partial updates, and isolates workspaces", async () => {
    const context = { principal, requestId: "task-display" };
    const before = await settings.get(userId, "tasks");
    const saved = await settings.update(
      "tasks",
      {
        expectedRevision: before.revision,
        preferences: {
          taskSort: "title",
          taskGroup: "project",
          taskRowDetails: [],
          taskContainerSort: "name",
        },
      },
      context,
    );
    await settings.update(
      "tasks",
      { expectedRevision: saved.revision, preferences: { taskGroup: "date" } },
      context,
    );
    expect((await settings.get(userId, "tasks")).preferences).toMatchObject({
      taskSort: "title",
      taskGroup: "date",
      taskRowDetails: [],
      taskContainerSort: "name",
    });
    expect((await settings.get(otherId, "tasks")).preferences.taskSort).toBe("default");
    await expect(
      settings.update("mail", { expectedRevision: 0, preferences: { taskSort: "title" } }, context),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(
      updateWorkspaceSettingsSchema.safeParse({
        expectedRevision: 0,
        preferences: { taskGroup: "bogus" },
      }).success,
    ).toBe(false);
    expect(
      updateWorkspaceSettingsSchema.safeParse({
        expectedRevision: 0,
        preferences: { taskRowDetails: ["bogus"] },
      }).success,
    ).toBe(false);
  });
  it("stores Mail layout in account preferences with partial updates and validation", async () => {
    const context = { principal, requestId: "mail-layout" };
    const before = await settings.get(userId, "mail");
    const saved = await settings.update(
      "mail",
      {
        expectedRevision: before.revision,
        preferences: {
          mailListDensity: "compact",
          mailListWidth: 42,
          mailConversationLayout: "single",
        },
      },
      context,
    );
    await settings.update(
      "mail",
      { expectedRevision: saved.revision, preferences: { mailListDensity: "expanded" } },
      context,
    );
    expect((await settings.get(userId, "mail")).preferences).toMatchObject({
      mailListDensity: "expanded",
      mailListWidth: 42,
      mailConversationLayout: "single",
    });
    expect((await settings.get(otherId, "mail")).preferences.mailListWidth).toBe(34);
    await expect(
      settings.update(
        "tasks",
        { expectedRevision: 0, preferences: { mailListDensity: "compact" } },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    for (const preferences of [
      { mailListWidth: 0 },
      { mailListWidth: 101 },
      { mailListDensity: "unknown" },
      { mailConversationLayout: "unknown" },
    ]) {
      expect(
        updateWorkspaceSettingsSchema.safeParse({ expectedRevision: 0, preferences }).success,
      ).toBe(false);
    }
  });
  it("preserves unrelated calendar preferences on a partial update", async () => {
    await settings.update(
      "calendar",
      {
        expectedRevision: 1,
        preferences: {
          calendarView: "month",
          showWeekends: false,
          autoFollowToday: false,
          snapToFollow: false,
          followSnapSensitivity: "generous",
        },
      },
      { principal, requestId: "calendar" },
    );
    const result = await settings.update(
      "calendar",
      updateWorkspaceSettingsSchema.parse({
        expectedRevision: 2,
        preferences: { includeArchivedInSearch: true },
      }),
      { principal, requestId: "calendar" },
    );
    expect(result.preferences).toEqual({
      weekStartsOn: "sunday",
      defaultEventDurationMinutes: 60,
      includeArchivedInSearch: true,
      calendarView: "month",
      showWeekends: false,
      autoFollowToday: false,
      snapToFollow: false,
      followSnapSensitivity: "generous",
    });
  });
  it("persists owner-scoped task pins and rejects stale or foreign writes", async () => {
    const [list, foreign] = await database.db
      .insert(taskLists)
      .values([
        { userId, name: "Pinned list", normalizedName: "pinned list" },
        { userId: otherId, name: "Private", normalizedName: "private" },
      ])
      .returning();
    if (!list || !foreign) throw new Error("Missing lists");
    const [project] = await database.db
      .insert(taskProjects)
      .values({ userId, listId: list.id, name: "Pinned project", normalizedName: "pinned project" })
      .returning();
    if (!project) throw new Error("Missing project");
    const context = { principal, requestId: "pins-test" };
    const before = await settings.get(userId, "tasks");
    const saved = await settings.update(
      "tasks",
      {
        expectedRevision: before.revision,
        preferences: { pinnedListIds: [list.id], pinnedProjectIds: [project.id] },
      },
      context,
    );
    expect((await settings.get(userId, "tasks")).preferences.pinnedProjectIds).toEqual([
      project.id,
    ]);
    expect((await settings.get(otherId, "tasks")).preferences.pinnedListIds).toEqual([]);
    await expect(
      settings.update(
        "tasks",
        { expectedRevision: before.revision, preferences: { pinnedListIds: [] } },
        context,
      ),
    ).rejects.toThrow(/changed/);
    await expect(
      settings.update(
        "tasks",
        { expectedRevision: saved.revision, preferences: { pinnedListIds: [foreign.id] } },
        context,
      ),
    ).rejects.toThrow(/own lists/);
    await expect(
      settings.update(
        "mail",
        { expectedRevision: 1, preferences: { pinnedListIds: [list.id] } },
        context,
      ),
    ).rejects.toThrow(/belong to this workspace/);
    const unpinned = await settings.update(
      "tasks",
      { expectedRevision: saved.revision, preferences: { pinnedListIds: [] } },
      context,
    );
    expect(unpinned.preferences.pinnedListIds).toEqual([]);
    expect(unpinned.preferences.pinnedProjectIds).toEqual([project.id]);
    expect(unpinned.preferences.includeArchivedInSearch).toBe(
      before.preferences.includeArchivedInSearch,
    );
  });
  it("validates Finance account ownership and kind while preserving null and empty selections", async () => {
    const [cash, investment, debt, foreignCash, foreignInvestment] = await database.db
      .insert(financeAccounts)
      .values([
        { userId, provider: "manual", institution: "Example", name: "Owned cash", kind: "cash" },
        {
          userId,
          provider: "manual",
          institution: "Example",
          name: "Owned investment",
          kind: "investment",
        },
        { userId, provider: "manual", institution: "Example", name: "Owned debt", kind: "debt" },
        {
          userId: otherId,
          provider: "manual",
          institution: "Example",
          name: "Foreign cash",
          kind: "cash",
        },
        {
          userId: otherId,
          provider: "manual",
          institution: "Example",
          name: "Foreign investment",
          kind: "investment",
        },
      ])
      .returning();
    if (!cash || !investment || !debt || !foreignCash || !foreignInvestment)
      throw new Error("Missing Finance fixtures");
    const context = { principal, requestId: "finance-account-selection" };
    const before = await settings.get(userId, "finances");
    const isolated = await settings.get(otherId, "finances");
    const saved = await settings.update(
      "finances",
      {
        expectedRevision: before.revision,
        preferences: {
          spendAccountIds: [cash.id, investment.id, debt.id],
          cashAccountIds: [cash.id],
          investmentAccountIds: [investment.id],
        },
      },
      context,
    );
    expect(saved).toEqual(await settings.get(userId, "finances"));
    expect(saved.preferences).toMatchObject({
      spendAccountIds: [cash.id, investment.id, debt.id],
      cashAccountIds: [cash.id],
      investmentAccountIds: [investment.id],
    });
    for (const preferences of [
      { spendAccountIds: [cash.id, foreignCash.id] },
      { cashAccountIds: [foreignCash.id] },
      { investmentAccountIds: [foreignInvestment.id] },
      { cashAccountIds: [investment.id] },
      { investmentAccountIds: [cash.id] },
    ]) {
      await expect(
        settings.update("finances", { expectedRevision: saved.revision, preferences }, context),
      ).rejects.toMatchObject({ code: "invalid_request" });
      expect(await settings.get(userId, "finances")).toEqual(saved);
    }
    const empty = await settings.update(
      "finances",
      {
        expectedRevision: saved.revision,
        preferences: { spendAccountIds: [], cashAccountIds: [], investmentAccountIds: [] },
      },
      context,
    );
    expect(empty).toEqual(await settings.get(userId, "finances"));
    expect(empty.preferences).toMatchObject({
      spendAccountIds: [],
      cashAccountIds: [],
      investmentAccountIds: [],
    });
    await expect(
      settings.update(
        "finances",
        {
          expectedRevision: saved.revision,
          preferences: { spendAccountIds: null, cashAccountIds: null, investmentAccountIds: null },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await settings.get(userId, "finances")).toEqual(empty);
    const automatic = await settings.update(
      "finances",
      {
        expectedRevision: empty.revision,
        preferences: { spendAccountIds: null, cashAccountIds: null, investmentAccountIds: null },
      },
      context,
    );
    expect(automatic).toEqual(await settings.get(userId, "finances"));
    expect(automatic.preferences).toMatchObject({
      spendAccountIds: null,
      cashAccountIds: null,
      investmentAccountIds: null,
    });
    expect(automatic.preferences.financeTransactionView).toBe(
      before.preferences.financeTransactionView,
    );
    expect(await settings.get(otherId, "finances")).toEqual(isolated);
  });
  it("accepts only owned active capture lists and keeps failed or stale writes isolated", async () => {
    const [active, foreign, archived, deleted] = await database.db
      .insert(taskLists)
      .values([
        { userId, name: "Default capture", normalizedName: "default capture" },
        { userId: otherId, name: "Private capture", normalizedName: "private capture" },
        {
          userId,
          name: "Archived capture",
          normalizedName: "archived capture",
          availability: "archived",
          archivedAt: instant,
        },
        { userId, name: "Deleted capture", normalizedName: "deleted capture", deletedAt: instant },
      ])
      .returning();
    if (!active || !foreign || !archived || !deleted) throw new Error("Missing capture lists");
    const context = { principal, requestId: "default-capture" };
    const before = await settings.get(userId, "tasks");
    const isolated = await settings.get(otherId, "tasks");
    const saved = await settings.update(
      "tasks",
      {
        expectedRevision: before.revision,
        preferences: { defaultCaptureListId: active.id, showCompletedTasks: true },
      },
      context,
    );
    expect(saved).toEqual(await settings.get(userId, "tasks"));
    expect(saved.preferences).toMatchObject({
      defaultCaptureListId: active.id,
      showCompletedTasks: true,
    });
    for (const invalid of [foreign, archived, deleted]) {
      await expect(
        settings.update(
          "tasks",
          {
            expectedRevision: saved.revision,
            preferences: { defaultCaptureListId: invalid.id },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
      expect(await settings.get(userId, "tasks")).toEqual(saved);
    }
    await expect(
      settings.update(
        "tasks",
        {
          expectedRevision: before.revision,
          preferences: { defaultCaptureListId: null },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await settings.get(userId, "tasks")).toEqual(saved);
    const inbox = await settings.update(
      "tasks",
      {
        expectedRevision: saved.revision,
        preferences: { defaultCaptureListId: null },
      },
      context,
    );
    expect(inbox).toEqual(await settings.get(userId, "tasks"));
    expect(inbox.preferences).toMatchObject({
      defaultCaptureListId: null,
      showCompletedTasks: true,
    });
    expect(inbox.preferences.pinnedListIds).toEqual(before.preferences.pinnedListIds);
    expect(await settings.get(otherId, "tasks")).toEqual(isolated);
  });
  it("requires workspace scopes, including reminders for mixed Tasks search", async () => {
    const original = principal;
    principal = { ...principal, scopes: new Set([featureAccessPolicies.tasks.readScope]) };
    expect((await app.request("/v1/workspaces/tasks/search?q=needle")).status).toBe(403);
    expect((await app.request("/v1/workspaces/mail/search?q=needle")).status).toBe(403);
    principal = original;
    expect((await app.request("/v1/workspaces/mail/search?q=needle")).status).toBe(200);
    expect((await app.request("/v1/workspaces/mail/search?q=needle&limit=1000")).status).toBe(400);
    expect((await app.request("/v1/workspaces/unknown/search?q=needle")).status).toBe(400);
  });
  it("rejects agent preference writes and cross-workspace calendar settings", async () => {
    await expect(
      settings.update(
        "mail",
        { expectedRevision: 1, preferences: { calendarView: "day" } },
        { principal, requestId: "wrong" },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      settings.update(
        "mail",
        { expectedRevision: 1, preferences: {} },
        { principal: { ...principal, actorType: "agent" }, requestId: "agent" },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
