import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeContextPack,
  type KnowledgeMutationInput,
  knowledgeContextPackSchema,
  knowledgeReceiptSchema,
  knowledgeWorkflowMemoryMaxBytes,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { type Context, Hono } from "hono";
import { vi } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { AppError, errorResponse } from "../errors.js";
import type { FinanceMaintenanceService } from "../finance-maintenance-service.js";
import type { createFinanceService } from "../finance-service.js";
import type { FinanceStatusService } from "../finance-status-service.js";
import { registerFinanceRoutes } from "../routes/finances.js";
import { registerMailStewardshipRoutes } from "../routes/mail-stewardship.js";
import { hashToken } from "../security.js";
import type { AppEnv, Principal } from "../types.js";
import { createKnowledgeContextService } from "./context-service.js";
import { createKnowledgeRecordService } from "./record-service.js";
import { createKnowledgeWorkflowMemory } from "./workflow-memory.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseClient;
const now = () => new Date("2026-11-15T12:00:00Z");
const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const config = () => ({ db: database.db, now, encryptionKey });

function app() {
  return createApp({
    db: database.db,
    now,
    config: loadConfig({
      APP_BASE_URL: "https://app.example.com",
      API_BASE_URL: "https://api.example.com",
      APP_ENCRYPTION_KEY: encryptionKey,
      MCP_INTERNAL_SECRET: "knowledge-test-internal-secret-32-chars",
      DATABASE_URL: container.getConnectionUri(),
      GOOGLE_REDIRECT_URI: "https://api.example.com/v1/connectors/google/callback",
      X_REDIRECT_URI: "https://api.example.com/v1/x-bookmarks/callback",
    }),
  });
}

function fact(
  value: string,
  overrides: Partial<KnowledgeMutationInput> = {},
  subject = `Subject ${randomUUID()}`,
) {
  return {
    mutationKey: randomUUID(),
    content: {
      kind: "fact",
      value: { subject, predicate: "detail", value: { type: "string", value } },
    },
    scope: { workspace: null },
    tags: ["fixture"],
    evidence: [
      { type: "statement", wording: "I said this myself.", sessionRef: "chat", messageRef: "m" },
    ],
    ...overrides,
  } satisfies KnowledgeMutationInput;
}

async function setUp() {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await database.db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    displayName: "Owner",
    passwordHash: "unused",
    planningTimezone: "UTC",
  });
  await database.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: hashToken(randomUUID()),
    expiresAt: new Date(now().getTime() + 60 * 60_000),
  });
  const owner: Principal = {
    userId,
    actorId: userId,
    actorType: "user",
    sessionId,
    scopes: new Set(),
  };
  const records = createKnowledgeRecordService(config());
  return {
    owner,
    context: createKnowledgeContextService(config()),
    async agent(scopes: AccessScope[]): Promise<Principal & { token: string }> {
      const actorId = randomUUID();
      const token = randomUUID();
      await database.db.insert(accessTokens).values({
        id: actorId,
        userId,
        name: "Maintenance host",
        tokenHash: hashToken(token),
        scopes,
      });
      return { userId, actorId, actorType: "agent", scopes: new Set(scopes), token };
    },
    async save(input: KnowledgeMutationInput) {
      return knowledgeReceiptSchema.parse(await records.create(owner, input)).record;
    },
  };
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const ids = (pack: KnowledgeContextPack) =>
  [...pack.stated, ...pack.inferred, ...pack.tentative, ...pack.conflicts].map(({ id }) => id);

/** Finance and Mail routes with stubbed maintenance, so memory is the only live dependency. */
function maintenanceRoutes(
  principal: Principal,
  workflowMemory: ReturnType<typeof createKnowledgeWorkflowMemory>,
) {
  const hono = new Hono<AppEnv>();
  hono.use("*", async (context, next) => {
    context.set("principal", principal);
    context.set("requestId", "workflow-memory-test");
    await next();
  });
  hono.onError(errorResponse);
  const data = {
    run: null,
    challengeId: null,
    nextAction: null,
    recovery: null,
    conversationBatch: null,
    monthlyWork: null,
  };
  const canonicalFinanceMaintenance = {
    maintainFinances: vi.fn(async () => ({ schemaVersion: 1, data })),
  };
  const mailMaintenance = {
    maintain: vi.fn(async () => ({
      run: { id: randomUUID(), domain: "mail", status: "completed" },
      summary: "Mail is maintained.",
      verification: null,
    })),
  };
  const mutationContext = (context: Context<AppEnv>) => ({
    principal: context.get("principal"),
    requestId: context.get("requestId"),
  });
  registerFinanceRoutes({
    app: hono,
    canonicalFinanceMaintenance: canonicalFinanceMaintenance as never,
    financeMaintenance: {} as FinanceMaintenanceService,
    financeStatus: {} as FinanceStatusService,
    finances: {} as ReturnType<typeof createFinanceService>,
    mutationContext,
    workflowMemory,
  });
  registerMailStewardshipRoutes({
    app: hono,
    maintenance: mailMaintenance as never,
    mutationContext,
    stewardship: {} as never,
    workflowMemory,
  });
  return {
    post(path: string, body: unknown) {
      return hono.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
  };
}

describe("workspace workflow memory", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it("finance_start_includes_workspace_memory", async () => {
    const f = await setUp();
    // Saved for another purpose: purpose only ranks, so it still appears, after the match.
    const general = await f.save(fact("Unscoped preference", { purposes: ["planning"] }));
    const finance = await f.save(
      fact("Rent is split with Sarah", {
        scope: { workspace: "finances" },
        purposes: ["bookkeeping"],
      }),
    );
    const mail = await f.save(fact("Newsletters are skimmed", { scope: { workspace: "mail" } }));
    const host = await f.agent([
      "finances:maintain",
      "finances:read",
      "mail:read",
      "knowledge:read",
    ]);
    const routes = maintenanceRoutes(
      host,
      createKnowledgeWorkflowMemory({ context: f.context, log: vi.fn() }),
    );

    const started = await routes.post("/v1/finances/maintenance", { operation: "start" });
    expect(started.status).toBe(200);
    const body = (await started.json()) as { data: { memory: KnowledgeContextPack | null } };
    const memory = knowledgeContextPackSchema.parse(body.data.memory);
    // Purpose ranks the bookkeeping record first; unscoped memory is included; Mail's is not.
    expect(ids(memory)).toEqual([finance.id, general.id]);
    expect(ids(memory)).not.toContain(mail.id);
    expect(memory.truncated).toBe(false);
    expect(bytes(body.data.memory)).toBeLessThanOrEqual(knowledgeWorkflowMemoryMaxBytes);

    // Resume and continue responses are unchanged.
    const resumed = await routes.post("/v1/finances/maintenance", {
      operation: "resume",
      runId: randomUUID(),
    });
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).not.toHaveProperty("data.memory");
  });

  it("mail_start_includes_workspace_memory", async () => {
    const f = await setUp();
    const general = await f.save(fact("Unscoped preference", { purposes: ["planning"] }));
    const mail = await f.save(
      fact("Reply to the landlord within a day", {
        scope: { workspace: "mail" },
        purposes: ["communication"],
      }),
    );
    const finance = await f.save(fact("Rent is split", { scope: { workspace: "finances" } }));
    const host = await f.agent(["mail:read", "mail:write", "finances:read", "knowledge:read"]);
    const routes = maintenanceRoutes(
      host,
      createKnowledgeWorkflowMemory({ context: f.context, log: vi.fn() }),
    );

    const response = await routes.post("/v1/mail/maintenance", {});
    expect(response.status).toBe(200);
    const body = (await response.json()) as { memory: KnowledgeContextPack | null };
    const memory = knowledgeContextPackSchema.parse(body.memory);
    expect(ids(memory)).toEqual([mail.id, general.id]);
    expect(ids(memory)).not.toContain(finance.id);
    expect(bytes(body.memory)).toBeLessThanOrEqual(knowledgeWorkflowMemoryMaxBytes);
  });

  it("composes workflow memory into both maintenance routes of the app", async () => {
    const f = await setUp();
    const mail = await f.save(fact("Archive receipts", { scope: { workspace: "mail" } }));
    const host = await f.agent(["mail:read", "mail:write", "knowledge:read"]);
    const response = await app().request("https://api.example.com/v1/mail/maintenance", {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { memory: KnowledgeContextPack | null };
    expect(ids(knowledgeContextPackSchema.parse(body.memory))).toEqual([mail.id]);

    const finance = await f.save(fact("Rent is split", { scope: { workspace: "finances" } }));
    const financeHost = await f.agent(["finances:maintain", "finances:read", "knowledge:read"]);
    const started = await app().request("https://api.example.com/v1/finances/maintenance", {
      method: "POST",
      headers: { authorization: `Bearer ${financeHost.token}`, "content-type": "application/json" },
      body: JSON.stringify({ operation: "start" }),
    });
    expect(started.status).toBe(200);
    const result = (await started.json()) as { data: { memory: KnowledgeContextPack | null } };
    expect(ids(knowledgeContextPackSchema.parse(result.data.memory))).toEqual([finance.id]);
  });

  it("workflow_memory_excludes_sensitive", async () => {
    const f = await setUp();
    const included = await f.save(fact("Included", { scope: { workspace: "finances" } }));
    const sensitive = await f.save(
      fact("Salary", { scope: { workspace: "finances" }, sensitivity: "sensitive" }),
    );
    // Standard on its own, but it cites a sensitive record, so it reads as sensitive.
    const derived = await f.save(
      fact("Derived", {
        evidence: [
          {
            type: "domain_record",
            domain: "knowledge",
            id: sensitive.id,
            revision: sensitive.revision,
          },
        ],
      }),
    );
    const host = await f.agent(["finances:maintain", "finances:read", "knowledge:read"]);
    const memory = await f.context.workflowSection(host, {
      workspace: "finances",
      purpose: "bookkeeping",
    });
    expect(memory && ids(memory)).toEqual([included.id]);
    // Sensitive memory stays readable by search and the context pack; it only never loads here.
    const pack = await f.context.context(host, { workspace: "finances", purpose: "bookkeeping" });
    expect(ids(pack)).toEqual(expect.arrayContaining([included.id, sensitive.id, derived.id]));
  });

  it("workflow_memory_null_without_scope", async () => {
    const f = await setUp();
    await f.save(fact("Rent is split", { scope: { workspace: "finances" } }));
    const host = await f.agent(["finances:maintain", "finances:read"]);
    const log = vi.fn();
    const routes = maintenanceRoutes(
      host,
      createKnowledgeWorkflowMemory({ context: f.context, log }),
    );
    const started = await routes.post("/v1/finances/maintenance", { operation: "start" });
    expect(started.status).toBe(200);
    expect(await started.json()).toHaveProperty("data.memory", null);
    expect(
      await f.context.workflowSection(host, { workspace: "finances", purpose: "bookkeeping" }),
    ).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("workflow_memory_fits_16_kib_without_cutting_records", async () => {
    const f = await setUp();
    const value = "é".repeat(1_800);
    for (let i = 0; i < 12; i++)
      await f.save(fact(`${i} ${value}`, { scope: { workspace: "finances" } }));
    const host = await f.agent(["finances:maintain", "finances:read", "knowledge:read"]);
    const memory = await f.context.workflowSection(host, {
      workspace: "finances",
      purpose: "bookkeeping",
    });
    if (!memory) throw new Error("Expected a memory section.");
    expect(bytes(memory)).toBeLessThanOrEqual(knowledgeWorkflowMemoryMaxBytes);
    expect(memory.truncated).toBe(true);
    expect(ids(memory).length).toBeGreaterThan(0);
    expect(ids(memory).length).toBeLessThan(12);
    for (const record of memory.stated)
      expect(record.content).toMatchObject({
        value: { value: { value: expect.stringMatching(/é{1800}$/u) } },
      });
    // The section is not a page; search fetches the rest.
    expect(memory.nextCursor).toBeNull();
  });

  it("a_memory_failure_still_starts_maintenance_with_null_memory", async () => {
    const f = await setUp();
    // A unique value in a real record's content, echoed by the failures below the way a parse
    // error can echo the value it rejected. It must never reach the log.
    const secret = `fixture-${randomUUID()}`;
    const record = await f.save(fact(secret, { scope: { workspace: "finances" } }));
    expect(JSON.stringify(record.content)).toContain(secret);
    const host = await f.agent([
      "finances:maintain",
      "finances:read",
      "mail:read",
      "mail:write",
      "knowledge:read",
    ]);
    const log = vi.fn();
    const failing = {
      workflowSection: vi
        .fn()
        .mockRejectedValueOnce(new AppError("conflict", `Memory changed: ${secret}`))
        // A multi-line message, like a formatted Zod error, keeps every line out of the stack.
        .mockRejectedValueOnce(
          new Error(`Invalid memory:\n${JSON.stringify(record.content, null, 2)}`),
        )
        // Anything thrown is still reported, without a stack.
        .mockRejectedValueOnce(secret),
    };
    const routes = maintenanceRoutes(
      host,
      createKnowledgeWorkflowMemory({ context: failing, log }),
    );

    const started = await routes.post("/v1/finances/maintenance", { operation: "start" });
    expect(started.status).toBe(200);
    expect(await started.json()).toHaveProperty("data.memory", null);
    for (let i = 0; i < 2; i++) {
      const mail = await routes.post("/v1/mail/maintenance", {});
      expect(mail.status).toBe(200);
      expect(await mail.json()).toHaveProperty("memory", null);
    }

    expect(failing.workflowSection).toHaveBeenCalledWith(host, {
      workspace: "finances",
      purpose: "bookkeeping",
    });
    expect(failing.workflowSection).toHaveBeenCalledWith(host, {
      workspace: "mail",
      purpose: "communication",
    });
    expect(log).toHaveBeenCalledTimes(3);
    const [appError, parseError, thrown] = log.mock.calls.map(([entry]) => entry);
    expect(appError).toEqual({
      event: "knowledge_workflow_memory_failed",
      workspace: "finances",
      errorName: "AppError",
      errorCode: "conflict",
      errorStack: expect.stringMatching(/^\s+at /u),
      durationMs: expect.any(Number),
      method: "POST",
      path: "/v1/finances/maintenance",
      requestId: "workflow-memory-test",
      status: 200,
    });
    expect(parseError).toMatchObject({
      workspace: "mail",
      errorName: "Error",
      errorStack: expect.stringMatching(/^\s+at /u),
      path: "/v1/mail/maintenance",
    });
    expect(parseError).not.toHaveProperty("errorCode");
    expect(thrown).toMatchObject({ workspace: "mail", errorName: "NonError" });
    expect(thrown).not.toHaveProperty("errorStack");
    for (const entry of [appError, parseError, thrown]) {
      expect(entry).not.toHaveProperty("errorMessage");
      expect(JSON.stringify(entry)).not.toContain(secret);
      expect(JSON.stringify(entry)).not.toContain("Invalid memory");
    }
  });
});
