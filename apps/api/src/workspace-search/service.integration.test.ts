import { resolve } from "node:path";
import {
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeTransactions,
  mailboxes,
  mailMessages,
  mailThreads,
  migrateDatabase,
  reminders,
  taskLists,
  taskProjects,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  featureAccessPolicies,
  type SearchableWorkspace,
  updateWorkspaceSettingsSchema,
  workspaceSearchQuerySchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createAgentAccessWorkItemService } from "../agent-access-work-items.js";
import { errorResponse } from "../errors.js";
import { registerWorkspaceSearchRoutes } from "../routes/workspace-search.js";
import type { AppEnv, Principal } from "../types.js";
import { createWorkspaceSearchService } from "./service.js";
import { createWorkspaceSettingsService } from "./settings.js";

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
  it("finds hidden historical events and preserves their date", async () => {
    const page = await search.search(
      userId,
      "calendar",
      workspaceSearchQuerySchema.parse({ q: "needle" }),
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
      .where(eq(auditEvents.entityType, `${workspace}_workspace_settings`));
    expect(audits).toHaveLength(1);
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
    expect((await settings.get(otherId, "tasks")).preferences.taskSort).toBeUndefined();
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
    expect((await settings.get(otherId, "mail")).preferences.mailListWidth).toBeUndefined();
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
      pinnedListIds: [],
      pinnedProjectIds: [],
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
    ).rejects.toThrow(/belong to Tasks/);
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
