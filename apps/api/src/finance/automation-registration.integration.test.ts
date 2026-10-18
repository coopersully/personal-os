import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  automationHostPromptIssues,
  automationHostSchedules,
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";
import { createAutomationHostService } from "../automation-host-service.js";
import type { Principal } from "../types.js";

const template = vi.hoisted(() => ({ version: 1 }));
vi.mock("./automation-prompts.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./automation-prompts.js")>();
  return {
    get FINANCE_AUTOMATION_PROMPT_VERSION() {
      return template.version;
    },
    renderFinanceAutomationPrompt: (
      schedule: Parameters<typeof original.renderFinanceAutomationPrompt>[0],
    ) => `${original.renderFinanceAutomationPrompt(schedule)} Template ${template.version}.`,
  };
});

const now = () => new Date("2026-10-18T15:00:00.000Z");
describe.sequential("immutable Finance host prompt issuance", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  beforeEach(async () => {
    template.version = 1;
    await database.db.delete(users);
  });
  async function fixture() {
    const userId = randomUUID(),
      connectionId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "Prompt owner",
      passwordHash: "unused",
    });
    const [token] = await database.db
      .insert(accessTokens)
      .values({
        userId,
        name: "Original host",
        authorizationConnectionId: connectionId,
        tokenHash: randomUUID(),
        scopes: ["finances:maintain"],
        expiresAt: new Date("2026-10-19T15:00:00Z"),
      })
      .returning();
    if (!token) throw new Error("fixture token missing");
    const human: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      scopes: new Set(["finances:read", "finances:write"]),
    };
    const agent: Principal = {
      userId,
      actorId: token.id,
      actorType: "agent",
      authorizationConnectionId: connectionId,
      scopes: new Set(["finances:maintain"]),
    };
    const service = createAutomationHostService({
      db: database.db,
      now,
      encryptionKey: Buffer.alloc(32, 7).toString("base64"),
    });
    const input = {
      tenantAuthorizationConnectionId: connectionId,
      label: "Finance",
      requestedScopes: ["finances:maintain"],
      hostSurface: "codex_desktop",
      trigger: {
        type: "recurring",
        recurrence: { type: "interval", everyMinutes: 15, timeZone: "America/New_York" },
      },
    };
    return { userId, connectionId, human, agent, service, input, token };
  }
  async function legacy(f: Awaited<ReturnType<typeof fixture>>) {
    const created = await f.service.create(f.human, f.input);
    // Simulate a pre-expansion registration: it genuinely has no stored issuance history.
    await database.db
      .delete(automationHostPromptIssues)
      .where(eq(automationHostPromptIssues.scheduleId, created.schedule.id));
    return created.schedule;
  }
  it("atomically issues identity-bound instructions for independent registrations", async () => {
    const f = await fixture();
    const first = await f.service.create(f.human, f.input);
    const second = await f.service.create(f.human, { ...f.input, label: "Other schedule" });
    expect(first.prompt.latestIssued).toMatchObject({
      scheduleId: first.schedule.id,
      templateVersion: 1,
      scheduleVersionAtIssue: 1,
      issuedAt: now().toISOString(),
    });
    expect(first.prompt.latestIssued?.text).toContain(first.schedule.id);
    expect(first.prompt.latestIssued?.text).not.toContain(second.schedule.id);
    expect(second.prompt.latestIssued?.text).toContain(second.schedule.id);
    expect(first.prompt.externalAdoption).toBe("unknown");
    expect(first.chatCapability).toEqual({
      state: "unverified",
      reason: "message_protocol_unavailable",
    });
    const edited = await f.service.update(f.human, first.schedule.id, {
      expectedVersion: 1,
      label: "Changed",
    });
    expect(edited.prompt.latestIssued).toEqual(first.prompt.latestIssued);
    expect(await f.service.getPrompt(f.human, first.schedule.id, 1)).toEqual(
      first.prompt.latestIssued,
    );
    const history = await f.service.promptHistory(f.human, first.schedule.id, {});
    expect(history).toEqual({
      issues: [first.prompt.latestIssued],
      nextCursor: null,
      currentTemplateVersion: 1,
    });
  });
  it("rolls back registration and issued text when prompt audit persistence fails", async () => {
    const f = await fixture();
    await database.db.execute(
      sql`CREATE FUNCTION fail_prompt_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='finance.host_prompt.issued' THEN RAISE EXCEPTION 'test prompt audit failure'; END IF; RETURN NEW; END $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER fail_prompt_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_prompt_audit()`,
    );
    try {
      await expect(f.service.create(f.human, f.input)).rejects.toThrow();
      expect(await database.db.select().from(automationHostSchedules)).toEqual([]);
      expect(await database.db.select().from(automationHostPromptIssues)).toEqual([]);
      expect(await database.db.select().from(auditEvents)).toEqual([]);
    } finally {
      await database.db.execute(sql`DROP TRIGGER fail_prompt_audit ON audit_events`);
      await database.db.execute(sql`DROP FUNCTION fail_prompt_audit()`);
    }
  });
  it("serializes concurrent first issuance and replays without changing history or schedule version", async () => {
    const f = await fixture(),
      schedule = await legacy(f);
    const before = (await database.db.select().from(auditEvents)).length;
    const [a, b] = await Promise.all([
      f.service.issuePrompt(f.human, schedule.id, 1, { expectedScheduleVersion: 1 }),
      f.service.issuePrompt(f.human, schedule.id, 1, { expectedScheduleVersion: 1 }),
    ]);
    expect(a).toEqual(b);
    expect((await database.db.select().from(auditEvents)).length).toBe(before + 1);
    expect((await f.service.list(f.human))[0]?.schedule.version).toBe(1);
    await f.service.update(f.human, schedule.id, { expectedVersion: 1, label: "Later edit" });
    expect(
      await f.service.issuePrompt(f.human, schedule.id, 1, { expectedScheduleVersion: 1 }),
    ).toEqual(a);
    await f.service.cancel(f.human, schedule.id, {
      expectedVersion: 2,
      expectedState: "setup_pending",
    });
    expect(
      await f.service.issuePrompt(f.human, schedule.id, 1, { expectedScheduleVersion: 1 }),
    ).toEqual(a);
    expect(await f.service.getPrompt(f.human, schedule.id, 1)).toEqual(a);
  });
  it("reports missing legacy history honestly and guards new issuance versions/state", async () => {
    const f = await fixture(),
      schedule = await legacy(f);
    expect((await f.service.list(f.human))[0]?.prompt).toMatchObject({
      latestIssued: null,
      upgradeAvailable: true,
    });
    expect((await f.service.promptHistory(f.human, schedule.id, {})).issues).toEqual([]);
    await expect(f.service.getPrompt(f.human, schedule.id, 1)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      f.service.issuePrompt(f.human, schedule.id, 2, { expectedScheduleVersion: 1 }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.issuePrompt(f.human, schedule.id, 1, { expectedScheduleVersion: 2 }),
    ).rejects.toMatchObject({ code: "conflict" });
    await f.service.cancel(f.human, schedule.id, {
      expectedVersion: 1,
      expectedState: "setup_pending",
    });
    await expect(
      f.service.issuePrompt(f.human, schedule.id, 1, { expectedScheduleVersion: 2 }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("preserves historical text while appending the current template and paging without duplicates", async () => {
    const f = await fixture(),
      schedule = await legacy(f);
    await f.service.issuePrompt(f.human, schedule.id, 1, { expectedScheduleVersion: 1 });
    const original = await f.service.getPrompt(f.human, schedule.id, 1);
    template.version = 2;
    expect((await f.service.list(f.human))[0]?.prompt.upgradeAvailable).toBe(true);
    const upgrade = await f.service.issuePrompt(f.human, schedule.id, 2, {
      expectedScheduleVersion: 1,
    });
    expect(upgrade.text).toContain(schedule.id);
    expect(upgrade.text).toContain("Template 2.");
    expect(upgrade.text).not.toEqual(original.text);
    const page = await f.service.promptHistory(f.human, schedule.id, { limit: 1 });
    expect(page.issues[0]?.templateVersion).toBe(2);
    expect(page.nextCursor).toBe(2);
    const next = await f.service.promptHistory(f.human, schedule.id, {
      beforeVersion: page.nextCursor,
      limit: 1,
    });
    expect(next).toMatchObject({ issues: [original], nextCursor: null });
    expect(await f.service.getPrompt(f.human, schedule.id, 1)).toEqual(original);
  });
  it("isolates history and issuance by owner/connection and requires live authority for new effects", async () => {
    const f = await fixture(),
      other = await fixture(),
      schedule = await legacy(f);
    await expect(other.service.promptHistory(other.human, schedule.id, {})).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      other.service.issuePrompt(other.human, schedule.id, 1, { expectedScheduleVersion: 1 }),
    ).rejects.toMatchObject({ code: "not_found" });
    const wrong = { ...f.agent, authorizationConnectionId: randomUUID() };
    await expect(f.service.getPrompt(wrong, schedule.id, 1)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      f.service.issuePrompt(wrong, schedule.id, 1, { expectedScheduleVersion: 1 }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.issuePrompt({ ...f.agent, scopes: new Set(["finances:read"]) }, schedule.id, 1, {
        expectedScheduleVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.issuePrompt(f.agent, schedule.id, 1, { expectedScheduleVersion: 1 }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, f.token.id));
    await expect(
      f.service.issuePrompt(f.human, schedule.id, 1, { expectedScheduleVersion: 1 }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("enforces composite owner foreign keys and cascades privacy deletion while retaining cancelled history", async () => {
    const f = await fixture(),
      other = await fixture(),
      created = await f.service.create(f.human, f.input);
    await expect(
      database.db.insert(automationHostPromptIssues).values({
        userId: other.userId,
        scheduleId: created.schedule.id,
        templateVersion: 2,
        scheduleVersionAtIssue: 1,
        text: "wrong owner",
        issuedAt: now(),
      }),
    ).rejects.toThrow();
    await f.service.cancel(f.human, created.schedule.id, {
      expectedVersion: 1,
      expectedState: "setup_pending",
    });
    expect((await f.service.promptHistory(f.human, created.schedule.id, {})).issues).toHaveLength(
      1,
    );
    await database.db.delete(users).where(eq(users.id, f.userId));
    expect(
      await database.db
        .select()
        .from(automationHostPromptIssues)
        .where(
          and(
            eq(automationHostPromptIssues.userId, f.userId),
            eq(automationHostPromptIssues.scheduleId, created.schedule.id),
          ),
        ),
    ).toEqual([]);
  });
});
