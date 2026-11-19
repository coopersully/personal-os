import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  knowledgeRecords,
  knowledgeTombstones,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { knowledgeTrashRetentionMs } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { AppError } from "../errors.js";
import { createRuntimeLifecycle, type RuntimeLifecycle } from "../runtime-lifecycle.js";
import { knowledgePurgeFailureLine } from "./purge-service.js";

const hour = 60 * 60 * 1000;
const trashedAt = new Date("2026-10-01T00:00:00Z");

describe("knowledge purge failure line", () => {
  it("reports the error's name, code and stack frames, never its message", () => {
    const secret = "private-memory-value";
    const plain = knowledgePurgeFailureLine(new Error(`Invalid memory: ${secret}`));
    expect(plain).toMatch(/^\[personal-os\] Memory Trash purge pass failed: \{.*\}\n$/u);
    const fields = JSON.parse(plain.slice(plain.indexOf("{")));
    expect(fields).toEqual({ errorName: "Error", errorStack: expect.stringMatching(/^\s+at /u) });
    const coded = JSON.parse(
      knowledgePurgeFailureLine(new AppError("internal_error", secret))
        .split(": ")
        .slice(1)
        .join(": "),
    );
    expect(coded).toMatchObject({ errorName: "AppError", errorCode: "internal_error" });
    expect(knowledgePurgeFailureLine(secret)).toContain('{"errorName":"NonError"}');
    for (const line of [plain, knowledgePurgeFailureLine(new AppError("conflict", secret))])
      expect(line).not.toContain(secret);
  });
});

describe("knowledge purge runner", () => {
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

  async function setUp() {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Owner",
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    let clock = trashedAt.getTime() + knowledgeTrashRetentionMs + hour;
    let controller = new AbortController();
    // The runner reads the lifecycle's signal on every pass; a fresh controller ends a shutdown.
    const runtimeLifecycle: RuntimeLifecycle = Object.defineProperty(
      { ...createRuntimeLifecycle() },
      "signal",
      { get: () => controller.signal },
    );
    const app = createApp({
      db: database.db,
      now: () => new Date(clock),
      runtimeLifecycle,
      config: loadConfig({
        APP_BASE_URL: "https://app.example.com",
        API_BASE_URL: "https://api.example.com",
        APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
        MCP_INTERNAL_SECRET: "knowledge-test-internal-secret-32-chars",
        DATABASE_URL: container.getConnectionUri(),
        GOOGLE_REDIRECT_URI: "https://api.example.com/v1/connectors/google/callback",
        X_REDIRECT_URI: "https://api.example.com/v1/x-bookmarks/callback",
      }),
    });
    /** Trashed records with no content, enough for the purge to select and erase. */
    async function trash(count: number, at = trashedAt) {
      const ids = Array.from({ length: count }, () => randomUUID());
      await database.db.insert(knowledgeRecords).values(
        ids.map((id) => ({
          id,
          userId,
          trashedAt: at,
          trashGroupId: id,
          statusBeforeTrash: "active",
        })),
      );
      return ids;
    }
    async function remaining() {
      return (
        await database.db
          .select({ id: knowledgeRecords.id })
          .from(knowledgeRecords)
          .where(eq(knowledgeRecords.userId, userId))
      ).length;
    }
    async function tombstones() {
      return (
        await database.db
          .select({ id: knowledgeTombstones.recordId })
          .from(knowledgeTombstones)
          .where(eq(knowledgeTombstones.userId, userId))
      ).length;
    }
    return {
      app,
      trash,
      remaining,
      tombstones,
      advance: (ms: number) => {
        clock += ms;
      },
      abort: () => controller.abort(),
      resume: () => {
        controller = new AbortController();
      },
    };
  }

  it("runs at most once every six hours", async () => {
    const f = await setUp();
    await f.trash(1);
    await f.trash(1, new Date(trashedAt.getTime() + 2 * hour));
    await f.app.runKnowledgePurge();
    expect(await f.remaining()).toBe(1);
    // The second record passes retention an hour later, but the pass waits out six hours.
    f.advance(2 * hour);
    await f.app.runKnowledgePurge();
    expect(await f.remaining()).toBe(1);
    f.advance(4 * hour);
    await f.app.runKnowledgePurge();
    expect(await f.remaining()).toBe(0);
    expect(await f.tombstones()).toBe(2);
  });

  it("purges more than one batch in a pass", async () => {
    const f = await setUp();
    await f.trash(150);
    await f.app.runKnowledgePurge();
    expect(await f.remaining()).toBe(0);
    expect(await f.tombstones()).toBe(150);
  });

  it("leaves a tick that arrives during a pass alone", async () => {
    const f = await setUp();
    await f.trash(3);
    let firstDone = false;
    const first = f.app.runKnowledgePurge().then(() => {
      firstDone = true;
    });
    await f.app.runKnowledgePurge();
    // The overlapping tick returned while the first pass was still purging.
    expect(firstDone).toBe(false);
    await first;
    expect(await f.remaining()).toBe(0);
    expect(await f.tombstones()).toBe(3);
  });

  it("stops at shutdown without recording a completed pass", async () => {
    const f = await setUp();
    await f.trash(2);
    f.abort();
    await f.app.runKnowledgePurge();
    expect(await f.remaining()).toBe(2);
    // The aborted pass did not start the six-hour wait, so the next tick purges at once.
    f.resume();
    await f.app.runKnowledgePurge();
    expect(await f.remaining()).toBe(0);
  });
});
