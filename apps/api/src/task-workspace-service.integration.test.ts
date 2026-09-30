import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  reminders,
  taskLists,
  taskProjects,
  users,
} from "@personal-os/database";
import { type AccessScope, taskWorkspaceQuerySchema } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { errorResponse } from "./errors.js";
import { registerTaskWorkspaceRoutes } from "./routes/task-workspace.js";
import { createTaskService } from "./task-service.js";
import { createTaskWorkspaceService } from "./task-workspace-service.js";
import type { AppEnv } from "./types.js";

const instant = new Date("2026-09-03T02:00:00.000Z"); // September 2 in New York.

describe.sequential("shared task workspace PostgreSQL projection", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  let otherUserId: string;
  let inboxId: string;
  let archivedListId: string;
  let projectId: string;
  let service: ReturnType<typeof createTaskWorkspaceService>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const created = await database.db
      .insert(users)
      .values([
        {
          displayName: "Workspace",
          email: "workspace@example.com",
          passwordHash: "unused",
          planningTimezone: "America/New_York",
        },
        {
          displayName: "Other",
          email: "other-workspace@example.com",
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
      ])
      .returning();
    const [user, otherUser] = created;
    if (!user || !otherUser) throw new Error("Fixture users were not created");
    userId = user.id;
    otherUserId = otherUser.id;
    const [inbox] = await database.db.select().from(taskLists).where(eq(taskLists.userId, userId));
    const lists = await database.db
      .insert(taskLists)
      .values([
        {
          userId,
          name: "Archive",
          normalizedName: "archive",
          availability: "archived",
          archivedAt: instant,
        },
      ])
      .returning();
    const [archivedList] = lists;
    if (!inbox || !archivedList) throw new Error("Fixture lists were not created");
    inboxId = inbox.id;
    archivedListId = archivedList.id;
    const [project] = await database.db
      .insert(taskProjects)
      .values({
        userId,
        listId: inboxId,
        name: "Finished",
        normalizedName: "finished",
        lifecycle: "completed",
        completedAt: instant,
      })
      .returning();
    if (!project) throw new Error("Fixture project was not created");
    projectId = project.id;
    service = createTaskWorkspaceService({
      db: database.db,
      now: () => instant,
      cursorSecret: "workspace-test-secret",
    });
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  beforeEach(async () => {
    await database.db.delete(reminders).where(eq(reminders.userId, userId));
  });

  async function insert(title: string, options: Partial<typeof reminders.$inferInsert> = {}) {
    const task = options.kind === "task";
    const [record] = await database.db
      .insert(reminders)
      .values({
        userId,
        title,
        createdAt: instant,
        updatedAt: instant,
        ...(task ? { taskListId: inboxId, taskLifecycle: "open" as const, taskRevision: 1 } : {}),
        ...options,
      })
      .returning();
    if (!record) throw new Error("Fixture record was not created");
    return record;
  }

  const list = (query: Record<string, unknown> = {}) =>
    service.list(userId, taskWorkspaceQuerySchema.parse(query));

  it("preserves canonical kinds, excludes other users, and keeps Inbox task-owned", async () => {
    await insert("Task", { kind: "task" });
    await insert("Reminder");
    await insert("Private", { userId: otherUserId });
    const page = await list({ sort: "title" });
    expect(page.total).toBe(2);
    expect(page.items.map((item) => [item.kind, item.record.title])).toEqual([
      ["reminder", "Reminder"],
      ["task", "Task"],
    ]);
    expect(page.items[0]?.record).not.toHaveProperty("listId");
    expect(page.items[1]?.record).toMatchObject({
      lifecycle: "open",
      listId: inboxId,
      revision: 1,
    });
    expect((await list({ kind: "task", listId: inboxId })).total).toBe(1);
  });

  it("uses the planning day, includes overdue Today and ignores stale reserved dates for Upcoming", async () => {
    await insert("Overdue", { dueAt: new Date("2026-09-01T12:00:00Z") });
    await insert("Tonight", { kind: "task", scheduledAt: new Date("2026-09-03T03:00:00Z") });
    await insert("Tomorrow", {
      kind: "task",
      scheduledAt: new Date("2026-09-01T12:00:00Z"),
      dueAt: new Date("2026-09-03T04:00:00Z"),
    });
    expect((await list({ view: "today" })).items.map((item) => item.record.title)).toEqual([
      "Overdue",
      "Tonight",
    ]);
    const upcoming = await list({ view: "upcoming", group: "date" });
    expect(upcoming.items).toHaveLength(1);
    expect(upcoming.items[0]).toMatchObject({
      relevantAt: "2026-09-03T04:00:00.000Z",
      groupKey: "2026-09-03",
    });
    expect((await list({ due: "overdue" })).items.map((item) => item.record.title)).toEqual([
      "Overdue",
    ]);
  });

  it("paginates mixed Today default results in overdue, reserved, then due-today tiers", async () => {
    await insert("Overdue reminder", { dueAt: new Date("2026-09-01T10:00:00-04:00") });
    await insert("Overdue task with reservation", {
      kind: "task",
      dueAt: new Date("2026-09-01T11:00:00-04:00"),
      scheduledAt: new Date("2026-09-02T18:00:00-04:00"),
    });
    await insert("Reserved 13:00", {
      kind: "task",
      dueAt: new Date("2026-09-02T09:00:00-04:00"),
      scheduledAt: new Date("2026-09-02T13:00:00-04:00"),
    });
    await insert("Reserved 14:00", {
      kind: "task",
      scheduledAt: new Date("2026-09-02T14:00:00-04:00"),
    });
    await insert("Due-only task 08:00", {
      kind: "task",
      dueAt: new Date("2026-09-02T08:00:00-04:00"),
    });
    await insert("Due-only reminder 09:00", { dueAt: new Date("2026-09-02T09:00:00-04:00") });
    const titles: string[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 7; pageNumber++) {
      const page = await list({ view: "today", sort: "default", group: "none", limit: 1, cursor });
      expect(page.total).toBe(6);
      titles.push(...page.items.map((item) => item.record.title));
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(cursor).toBeUndefined();
    expect(titles).toEqual([
      "Overdue reminder",
      "Overdue task with reservation",
      "Reserved 13:00",
      "Reserved 14:00",
      "Due-only task 08:00",
      "Due-only reminder 09:00",
    ]);
    expect(
      (await list({ view: "today", sort: "date" })).items.map((item) => item.record.title),
    ).toEqual([
      "Overdue reminder",
      "Overdue task with reservation",
      "Due-only task 08:00",
      "Due-only reminder 09:00",
      "Reserved 13:00",
      "Reserved 14:00",
    ]);
  });

  it("separates active, History, archived context and recoverable trash", async () => {
    await insert("Open task", { kind: "task" });
    await insert("Done", { completedAt: instant });
    await insert("Cancelled", {
      kind: "task",
      taskLifecycle: "cancelled",
      taskCancelledAt: instant,
    });
    await insert("Archived", { kind: "task", taskListId: archivedListId });
    await insert("Finished project", { kind: "task", taskProjectId: projectId });
    await insert("Deleted reminder", { deletedAt: instant });
    expect((await list()).items.map((item) => item.record.title)).toEqual(["Open task"]);
    const history = await list({ view: "history", sort: "title" });
    expect(history.items.map((item) => [item.record.title, item.readOnly])).toEqual([
      ["Archived", true],
      ["Cancelled", false],
      ["Done", false],
      ["Finished project", true],
    ]);
    expect((await list({ status: "archived" })).total).toBe(2);
    expect((await list({ listId: archivedListId })).items[0]).toMatchObject({ readOnly: true });
    expect((await list({ projectId })).items[0]).toMatchObject({ readOnly: true });
    expect((await list({ view: "trash" })).items[0]).toMatchObject({
      kind: "reminder",
      deletedAt: instant.toISOString(),
    });
    expect((await list({ view: "history", status: "completed" })).total).toBe(1);
  });

  it("keeps Trash restorable when the former container is unavailable", async () => {
    const archived = await insert("Archived deleted task", {
      kind: "task",
      taskListId: archivedListId,
      deletedAt: instant,
    });
    const terminal = await insert("Terminal project deleted task", {
      kind: "task",
      taskProjectId: projectId,
      deletedAt: instant,
    });
    await insert("Deleted reminder", { deletedAt: instant });
    const trash = await list({ view: "trash" });
    expect(trash.total).toBe(3);
    expect(trash.items.every((item) => item.readOnly === false)).toBe(true);
    const tasks = createTaskService({
      db: database.db,
      now: () => instant,
      movePreviewSecret: "test",
    });
    for (const row of [archived, terminal]) {
      const restored = await tasks.restore(
        row.id,
        { expectedRevision: 1 },
        {
          principal: {
            actorType: "user",
            actorId: userId,
            userId,
            scopes: new Set(["tasks:read", "tasks:write"]),
          },
          requestId: "workspace-restore-test",
        },
      );
      expect(restored).toMatchObject({
        deletedAt: null,
        listId: inboxId,
        projectId: null,
        revision: 2,
      });
    }
  });

  it("filters globally before counts and paging, with literal search and exact bounds", async () => {
    for (let index = 0; index < 6; index++) await insert(`Noise ${index}`);
    await insert("Target 100%", {
      kind: "task",
      priority: "high",
      tags: ["work"],
      dueAt: instant,
      scheduledAt: instant,
      estimateMinutes: 25,
    });
    await insert("Target 100x", { priority: "high", dueAt: instant });
    const page = await list({
      limit: 1,
      query: "100%",
      priority: "high",
      tag: "work",
      due: "dated",
      reserved: "scheduled",
      dueAfter: instant.toISOString(),
      dueBefore: instant.toISOString(),
      scheduledAfter: instant.toISOString(),
      scheduledBefore: instant.toISOString(),
    });
    expect(page).toMatchObject({ total: 1, nextCursor: null });
    expect(page.items[0]?.record.title).toBe("Target 100%");
    expect((await list({ due: "none", reserved: "none" })).total).toBe(6);
  });

  it.each([
    "date",
    "priority",
    "newest",
    "oldest",
    "title",
    "estimate",
    "default",
  ])("paginates globally with ties and nulls for %s", async (sort) => {
    await insert("Same", { kind: "task", priority: "high", dueAt: instant, estimateMinutes: 30 });
    await insert("Same", { priority: "high", dueAt: instant });
    await insert("Last", { kind: "task", priority: "low", estimateMinutes: 10 });
    await insert("Undated");
    const full = await list({ sort, group: "date" });
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ sort, group: "date", limit: 1, cursor });
      expect(page.total).toBe(4);
      ids.push(...page.items.map((item) => item.record.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual(full.items.map((item) => item.record.id));
    expect(new Set(ids).size).toBe(4);
    expect(full.items.map((item) => item.groupKey)).toEqual([
      "2026-09-02",
      "2026-09-02",
      "none",
      "none",
    ]);
  });

  it("orders the entire mixed collection by each requested sort before taking a page", async () => {
    await insert("Alpha", {
      kind: "task",
      priority: "high",
      estimateMinutes: 30,
      dueAt: new Date("2026-10-01T12:00:00Z"),
      createdAt: new Date("2026-08-01T12:00:00Z"),
    });
    await insert("Beta", {
      kind: "task",
      priority: "low",
      estimateMinutes: 10,
      dueAt: new Date("2026-08-01T12:00:00Z"),
      createdAt: new Date("2026-08-02T12:00:00Z"),
    });
    await insert("Zulu", { priority: "medium", createdAt: new Date("2026-08-03T12:00:00Z") });
    for (const [sort, expected] of [
      ["date", ["Beta", "Alpha", "Zulu"]],
      ["default", ["Beta", "Alpha", "Zulu"]],
      ["priority", ["Alpha", "Zulu", "Beta"]],
      ["estimate", ["Beta", "Alpha", "Zulu"]],
      ["newest", ["Zulu", "Beta", "Alpha"]],
      ["oldest", ["Alpha", "Beta", "Zulu"]],
      ["title", ["Alpha", "Beta", "Zulu"]],
    ] as const) {
      const titles: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ sort, cursor, limit: 1 });
        titles.push(...page.items.map((item) => item.record.title));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(titles, sort).toEqual(expected);
    }
  });

  it("sorts and paginates reserved time independently of due dates, with null reservations last", async () => {
    await insert("Due yesterday, reserved next week", {
      kind: "task",
      dueAt: new Date("2026-09-01T12:00:00Z"),
      scheduledAt: new Date("2026-09-09T12:00:00Z"),
    });
    await insert("Reserved tomorrow", {
      kind: "task",
      dueAt: new Date("2026-09-30T12:00:00Z"),
      scheduledAt: new Date("2026-09-03T12:00:00Z"),
    });
    await insert("Unreserved task", { kind: "task", dueAt: new Date("2026-08-30T12:00:00Z") });
    await insert("Reminder without reservation", { dueAt: new Date("2026-08-29T12:00:00Z") });
    const first = await list({ reserved: "scheduled", sort: "reserved", limit: 1 });
    expect(first.total).toBe(2);
    expect(first.items[0]?.record.title).toBe("Reserved tomorrow");
    const next = await list({
      reserved: "scheduled",
      sort: "reserved",
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(next).toMatchObject({ total: 2, nextCursor: null });
    expect(next.items[0]?.record.title).toBe("Due yesterday, reserved next week");
    const withNulls = await list({ sort: "reserved" });
    expect(withNulls.items.slice(0, 2).map((item) => item.record.title)).toEqual([
      "Reserved tomorrow",
      "Due yesterday, reserved next week",
    ]);
    expect(
      withNulls.items
        .slice(2)
        .map((item) => item.record.title)
        .sort(),
    ).toEqual(["Reminder without reservation", "Unreserved task"]);
  });

  it("groups by actual list/project ownership with reminders and unassigned tasks in none", async () => {
    const [project] = await database.db
      .insert(taskProjects)
      .values({
        userId,
        listId: inboxId,
        name: "Active grouping",
        normalizedName: "active grouping",
      })
      .returning();
    if (!project) throw new Error("Expected active project");
    await insert("Project task", { kind: "task", taskProjectId: project.id });
    await insert("Inbox task", { kind: "task" });
    await insert("Reminder");
    expect(
      (await list({ group: "list", sort: "title" })).items.map((item) => [
        item.record.title,
        item.groupKey,
      ]),
    ).toEqual([
      ["Inbox task", inboxId],
      ["Project task", inboxId],
      ["Reminder", "none"],
    ]);
    expect(
      (await list({ group: "project", sort: "title" })).items.map((item) => [
        item.record.title,
        item.groupKey,
      ]),
    ).toEqual([
      ["Project task", project.id],
      ["Inbox task", "none"],
      ["Reminder", "none"],
    ]);
  });

  it("keeps a cursor's Today planning window when the clock crosses local midnight", async () => {
    await insert("First", { dueAt: new Date("2026-09-03T03:00:00Z") });
    await insert("Second", { dueAt: new Date("2026-09-03T03:30:00Z") });
    await insert("Tomorrow", { dueAt: new Date("2026-09-03T04:30:00Z") });
    const first = await list({ view: "today", limit: 1 });
    const tomorrow = createTaskWorkspaceService({
      db: database.db,
      now: () => new Date("2026-09-03T05:00:00Z"),
      cursorSecret: "workspace-test-secret",
    });
    const next = await tomorrow.list(
      userId,
      taskWorkspaceQuerySchema.parse({ view: "today", limit: 1, cursor: first.nextCursor }),
    );
    expect(next).toMatchObject({ total: 2, nextCursor: null });
    expect(next.items[0]?.record.title).toBe("Second");
    expect(
      (await tomorrow.list(userId, taskWorkspaceQuerySchema.parse({ view: "today" }))).total,
    ).toBe(3);
  });

  it("binds cursors to the user, query and planning timezone and rejects tampering", async () => {
    await insert("First");
    await insert("Second");
    const cursor = (await list({ limit: 1 })).nextCursor;
    if (!cursor) throw new Error("Expected a continuation cursor");
    await expect(list({ cursor, kind: "reminder" })).rejects.toThrow("cursor");
    await expect(
      service.list(otherUserId, taskWorkspaceQuerySchema.parse({ cursor })),
    ).rejects.toThrow("cursor");
    await expect(list({ cursor: "invalid" })).rejects.toThrow("cursor");
    await expect(list({ cursor: `${cursor}tampered` })).rejects.toThrow("cursor");
    await database.db.update(users).set({ planningTimezone: "UTC" }).where(eq(users.id, userId));
    await expect(list({ cursor })).rejects.toThrow("cursor");
    await database.db
      .update(users)
      .set({ planningTimezone: "America/New_York" })
      .where(eq(users.id, userId));
  });

  it("authorizes mixed reads with both scopes and single-kind reads with only their scope", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", async (context, next) => {
      context.set("requestId", "workspace-test");
      context.set("principal", {
        userId,
        actorId: userId,
        actorType: "agent",
        scopes: new Set((context.req.header("x-test-scopes") ?? "").split(",") as AccessScope[]),
      });
      await next();
    });
    app.onError((error, context) => errorResponse(error, context));
    registerTaskWorkspaceRoutes({ app, taskWorkspace: service });
    const request = (query: string, scopes: string) =>
      app.request(`/v1/task-workspace${query}`, { headers: { "x-test-scopes": scopes } });
    expect((await request("", "tasks:read")).status).toBe(403);
    expect((await request("", "reminders:read")).status).toBe(403);
    expect((await request("", "tasks:read,reminders:read")).status).toBe(200);
    expect((await request("?kind=task", "tasks:read")).status).toBe(200);
    expect((await request("?kind=reminder", "reminders:read")).status).toBe(200);
    expect((await request("?kind=task", "reminders:read")).status).toBe(403);
    expect((await request("?dueAfter=bad", "tasks:read,reminders:read")).status).toBe(400);
  });
});
