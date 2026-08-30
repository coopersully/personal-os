import { resolve } from "node:path";
import {
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  mailThreads,
  migrateDatabase,
  users,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { AppError } from "./errors.js";
import {
  createMailMaintenanceService,
  MAIL_MAINTENANCE_STEPS,
} from "./mail-maintenance-service.js";
import { createMailStewardshipService } from "./mail-stewardship-service.js";
import { createWorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

describe.sequential("Mail maintenance service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let now: Date;
  let userId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  beforeEach(async () => {
    await database.db.delete(users);
    now = new Date("2026-08-25T16:00:00.000Z");
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Mail maintenance owner",
        email: "mail-maintenance@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("User fixture was not created.");
    userId = user.id;
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        label: "Mail account",
        lastSyncedAt: now,
        mailEnabled: true,
        provider: "google",
        providerAccountId: "mail-maintenance-owner",
        syncStatus: "idle",
        userId,
      })
      .returning();
    if (!account) throw new Error("Account fixture was not created.");
    await database.db.insert(mailThreads).values({
      accountId: account.id,
      bodyText: "Private source content",
      from: { address: "sender@example.com", name: "Sender" },
      provider: "google",
      receivedAt: now,
      remoteThreadId: "maintenance-thread",
      snippet: "Private snippet",
      starred: true,
      subject: "Private subject",
      to: [],
      updatedAt: now,
      userId,
    });
  });

  function createService(options?: {
    dispatchApprovedRules?: () => Promise<{ dispatched: number }>;
    refreshSources?: () => Promise<{
      enqueued: number;
      readiness: "current" | "pending" | "unavailable";
    }>;
  }) {
    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const stewardship = createMailStewardshipService({ db: database.db, now: () => now });
    return {
      service: createMailMaintenanceService({
        dispatchApprovedRules: options?.dispatchApprovedRules ?? (async () => ({ dispatched: 0 })),
        now: () => now,
        refreshSources:
          options?.refreshSources ?? (async () => ({ enqueued: 0, readiness: "current" })),
        stewardship,
        workspace,
      }),
      workspace,
    };
  }

  it("settles with questions instead of guessing and records the fixed step graph", async () => {
    const { service, workspace } = createService();

    const result = await service.maintain(userId, { scope: { type: "all_outstanding" } });

    expect(result.run.status).toBe("completed_with_questions");
    expect(result.verification).toMatchObject({ status: "questions" });
    expect(result.summary).toContain("1 question");
    await expect(workspace.listStepRecords(result.run.id)).resolves.toEqual(
      MAIL_MAINTENANCE_STEPS.map(([step, idempotencyKey]) =>
        expect.objectContaining({ idempotencyKey, status: "completed", step }),
      ),
    );
    expect(JSON.stringify(result)).not.toContain("Private source content");
    expect(JSON.stringify(result)).not.toContain("Private subject");
  });

  it("resumes after a recoverable dispatcher failure without repeating completed steps", async () => {
    let attempts = 0;
    const { service } = createService({
      dispatchApprovedRules: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary dispatcher failure");
        return { dispatched: 0 };
      },
    });

    const first = await service.maintain(userId, { scope: { type: "all_outstanding" } });
    expect(first.run.status).toBe("failed_recoverable");
    await database.pool.query(
      `UPDATE workspace_maintenance_runs SET retry_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [first.run.id],
    );

    const resumed = await service.runDue(10);

    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.run.status).toBe("completed_with_questions");
    const snapshotSteps = await database.db
      .select()
      .from(workspaceMaintenanceSteps)
      .where(eq(workspaceMaintenanceSteps.idempotencyKey, "mail:snapshot:v1"));
    expect(snapshotSteps).toEqual([
      expect.objectContaining({ attemptCount: 1, status: "completed", stepName: "snapshot" }),
    ]);
    expect(attempts).toBe(2);
  });

  it("settles blocked instead of treating stale source evidence as empty", async () => {
    await database.db
      .update(calendarAccounts)
      .set({ lastSyncedAt: new Date("2026-08-25T12:00:00.000Z") })
      .where(eq(calendarAccounts.userId, userId));
    const { service } = createService();

    const result = await service.maintain(userId, { scope: { type: "all_outstanding" } });

    expect(result.run.status).toBe("blocked");
    expect(result.verification).toMatchObject({
      blockers: [expect.objectContaining({ code: "source_evidence_stale" })],
      status: "blocked",
    });
  });

  it("settles a clean empty workspace and pluralizes multiple bounded questions", async () => {
    await database.db.delete(mailThreads);
    const { service } = createService();

    const clean = await service.maintain(userId, { scope: { type: "all_outstanding" } });
    expect(clean.run.status).toBe("completed");
    expect(clean.verification).toMatchObject({ status: "passed" });
    expect(clean.summary).toContain("no outstanding questions or effects");

    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.userId, userId));
    if (!account) throw new Error("Account fixture was not found.");
    await database.db.insert(mailThreads).values([
      {
        accountId: account.id,
        bodyText: "First private source",
        from: { address: "first@example.com", name: "First" },
        provider: "google",
        receivedAt: now,
        remoteThreadId: "question-one",
        snippet: "First private snippet",
        starred: true,
        subject: "First private subject",
        to: [],
        updatedAt: now,
        userId,
      },
      {
        accountId: account.id,
        bodyText: "Second private source",
        from: { address: "second@example.com", name: "Second" },
        provider: "google",
        receivedAt: now,
        remoteThreadId: "question-two",
        snippet: "Second private snippet",
        starred: true,
        subject: "Second private subject",
        to: [],
        updatedAt: now,
        userId,
      },
    ]);
    now = new Date(now.getTime() + 1_000);

    const questioned = await service.maintain(userId, { scope: { type: "all_outstanding" } });
    expect(questioned.run.status).toBe("completed_with_questions");
    expect(questioned.summary).toContain("2 questions");
  });

  it("classifies safe request failures separately from temporary internal failures", async () => {
    const invalid = createService({
      refreshSources: async () => {
        throw new AppError("invalid_request", "The requested Mail scope is invalid.");
      },
    }).service;
    const rejected = await invalid.maintain(userId, { scope: { type: "all_outstanding" } });
    expect(rejected.run.status).toBe("failed_terminal");
    expect(rejected.summary).toBe("The requested Mail scope is invalid.");

    now = new Date(now.getTime() + 1_000);
    const temporary = createService({
      refreshSources: async () => {
        throw new Error("private provider failure");
      },
    }).service;
    const retryable = await temporary.maintain(userId, { scope: { type: "all_outstanding" } });
    expect(retryable.run.status).toBe("failed_recoverable");
    expect(retryable.summary).toBe("Mail maintenance encountered a temporary internal failure.");
    expect(retryable.summary).not.toContain("private provider failure");
  });

  it("returns no work when no Mail maintenance run is due", async () => {
    const { service } = createService();
    await expect(service.runDue(10)).resolves.toEqual([]);
    await expect(service.dispatchDue(10)).resolves.toEqual([]);
  });
});
