import { resolve } from "node:path";
import {
  auditEvents,
  calendarWorkspaceSettings,
  createDatabaseClient,
  migrateDatabase,
  reminders,
  taskLists,
  todaySettings,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { createTodayCommitmentsService } from "./commitments-service.js";
import { createTodaySettingsService } from "./settings-service.js";

describe("Today owner settings and commitments", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  let owner: string;
  let other: string;
  const now = () => new Date("2026-10-14T16:00:00Z");
  const context = (userId = owner, actorType: "user" | "agent" = "user") => ({
    principal: {
      userId,
      actorId: userId,
      actorType,
      scopes: new Set(["tasks:read", "reminders:read"]),
    } as Principal,
    requestId: "today-test",
  });
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
    const rows = await database.db
      .insert(users)
      .values(
        ["owner", "other"].map((name) => ({
          email: `${name}@example.com`,
          displayName: name,
          passwordHash: "unused",
          planningTimezone: "America/New_York",
        })),
      )
      .returning();
    owner = rows[0]!.id;
    other = rows[1]!.id;
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it("reads defaults without writing, saves exact revisions and audits atomically", async () => {
    const service = createTodaySettingsService(database.db, now);
    expect(await service.get(owner)).toMatchObject({
      revision: 0,
      preferences: { background: "default" },
    });
    expect(await database.db.select().from(todaySettings)).toHaveLength(0);
    const saved = await service.update(
      { expectedRevision: 0, preferences: { background: "weather" } },
      context(),
    );
    expect(saved).toMatchObject({
      revision: 1,
      preferences: { background: "weather", showSpending: false },
    });
    expect(await service.get(owner)).toEqual(saved);
    await expect(
      service.update({ expectedRevision: 0, preferences: { background: "map" } }, context()),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.update(
        { expectedRevision: 1, preferences: { background: "map" } },
        context(owner, "agent"),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await service.get(other)).toMatchObject({ revision: 0 });
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "today.preferences_updated")),
    ).toHaveLength(1);
  });
  it("returns this calendar week plus overdue with complete counts and bounded owner-scoped pages", async () => {
    await database.db.insert(reminders).values([
      { userId: owner, title: "Old overdue", dueAt: new Date("2026-10-01T16:00:00Z") },
      { userId: owner, title: "Today", dueAt: new Date("2026-10-14T17:00:00Z") },
      { userId: owner, title: "Saturday", dueAt: new Date("2026-10-17T17:00:00Z") },
      { userId: owner, title: "Next week", dueAt: new Date("2026-10-18T17:00:00Z") },
      { userId: owner, title: "Undated" },
      { userId: other, title: "Other account", dueAt: new Date("2026-10-14T17:00:00Z") },
    ]);
    const service = createTodayCommitmentsService(database.db, now, "test-signing-key");
    const query = { filter: "all" as const, includeUndated: false, limit: 2 };
    const first = await service.list(context().principal, query);
    expect(first).toMatchObject({
      weekStart: "2026-10-11",
      weekEndExclusive: "2026-10-18",
      counts: { all: 3, overdue: 1, tasks: 0, reminders: 3 },
    });
    expect(first.items.map((item) => item.material.title)).toEqual(["Old overdue", "Today"]);
    const second = await service.list(context().principal, { ...query, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.material.title)).toEqual(["Saturday"]);
    expect(second.nextCursor).toBeNull();
    await expect(
      service.list(context(other).principal, { ...query, cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(
      (await service.list(context().principal, { ...query, includeUndated: true })).counts.all,
    ).toBe(4);
    expect(
      (await service.list({ ...context().principal, scopes: new Set() }, query)).counts.all,
    ).toBeNull();
  });
  it("unions deadlines and reservations, excludes inactive tasks, and honors Monday boundaries", async () => {
    const [inbox] = await database.db.select().from(taskLists).where(eq(taskLists.userId, other));
    if (!inbox) throw new Error("Missing test inbox");
    await database.db
      .insert(calendarWorkspaceSettings)
      .values({ userId: other, weekStartsOn: "monday" });
    await database.db.insert(reminders).values([
      {
        userId: other,
        kind: "task",
        taskRevision: 1n,
        taskLifecycle: "open",
        taskListId: inbox.id,
        title: "Carry forward",
        scheduledAt: new Date("2026-10-12T12:00:00Z"),
      },
      {
        userId: other,
        kind: "task",
        taskRevision: 1n,
        taskLifecycle: "open",
        taskListId: inbox.id,
        title: "Both dates",
        dueAt: new Date("2026-10-15T12:00:00Z"),
        scheduledAt: new Date("2026-10-16T12:00:00Z"),
      },
      {
        userId: other,
        kind: "task",
        taskRevision: 1n,
        taskLifecycle: "open",
        taskListId: inbox.id,
        title: "Overdue with reservation",
        dueAt: new Date("2026-10-10T12:00:00Z"),
        scheduledAt: new Date("2026-10-16T12:00:00Z"),
      },
      {
        userId: other,
        kind: "task",
        taskRevision: 1n,
        taskLifecycle: "open",
        taskListId: inbox.id,
        title: "Sunday included",
        dueAt: new Date("2026-10-18T12:00:00Z"),
      },
      {
        userId: other,
        kind: "task",
        taskRevision: 1n,
        taskLifecycle: "open",
        taskListId: inbox.id,
        title: "Monday excluded",
        dueAt: new Date("2026-10-19T04:00:00Z"),
      },
      {
        userId: other,
        kind: "task",
        taskRevision: 1n,
        taskLifecycle: "open",
        taskListId: inbox.id,
        title: "Undated task",
      },
      {
        userId: other,
        kind: "task",
        taskRevision: 1n,
        taskListId: inbox.id,
        title: "Completed",
        dueAt: new Date("2026-10-15T12:00:00Z"),
        completedAt: now(),
        taskLifecycle: "completed",
      },
    ]);
    const service = createTodayCommitmentsService(database.db, now, "test-signing-key");
    const query = { filter: "tasks" as const, includeUndated: false, limit: 100 };
    const result = await service.list(context(other).principal, query);
    expect(result.weekStart).toBe("2026-10-12");
    expect(result.items.map((item) => [item.material.title, item.group])).toEqual([
      ["Overdue with reservation", "overdue"],
      ["Carry forward", "today"],
      ["Both dates", "later_this_week"],
      ["Sunday included", "later_this_week"],
    ]);
    expect(
      (await service.list(context(other).principal, { ...query, includeUndated: true })).counts
        .tasks,
    ).toBe(5);
    const partial = await service.list(
      { ...context(other).principal, scopes: new Set(["tasks:read"]) },
      query,
    );
    expect(partial.counts).toEqual({ all: null, overdue: null, tasks: 4, reminders: null });
    const first = await service.list(context(other).principal, { ...query, limit: 1 });
    await expect(
      service.list(context(other).principal, {
        ...query,
        filter: "overdue",
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.list(context(other).principal, { ...query, cursor: "tampered" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("allows exactly one simultaneous update at an observed revision", async () => {
    const service = createTodaySettingsService(database.db, now);
    const results = await Promise.allSettled([
      service.update({ expectedRevision: 0, preferences: { background: "map" } }, context(other)),
      service.update({ expectedRevision: 0, preferences: { showRitual: true } }, context(other)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await service.get(other)).revision).toBe(1);
  });
});
