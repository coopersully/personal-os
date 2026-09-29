import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeMaintenanceCandidates,
  financePeriodReviews,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  type FinanceMaintenanceLineage,
  lockActiveFinanceMaintenanceRun,
  lockFinanceMaintenanceLineage,
  supersedeFinanceMaintenanceLineage,
} from "./maintenance-rebuild.js";

const now = new Date("2026-09-15T12:00:00.000Z");

describe.sequential("Finance maintenance rebuild", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;

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

  async function createOwner() {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Maintenance rebuild owner",
        email: `maintenance-rebuild-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!owner) throw new Error("Maintenance rebuild owner was not created.");
    return owner;
  }

  async function createLineage(
    userId: string,
    status: "queued" | "completed_with_questions" = "queued",
  ) {
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        domain: "finances",
        rulebookVersion: "finance-rules:v1",
        scope: { type: "all_outstanding" },
        status,
        userId,
      })
      .returning();
    if (!run) throw new Error("Maintenance rebuild run was not created.");
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({
        revision: `sha256:${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`,
        runId: run.id,
        state: "challenged",
        userId,
      })
      .returning();
    if (!candidate) throw new Error("Maintenance rebuild candidate was not created.");
    const lineage: FinanceMaintenanceLineage = {
      candidateId: candidate.id,
      candidateRevision: candidate.revision,
      runId: run.id,
    };
    return { candidate, lineage, run };
  }

  it("rejects missing lineage and returns only an exact challenged candidate", async () => {
    const owner = await createOwner();
    const missingLineage: FinanceMaintenanceLineage = {
      candidateId: crypto.randomUUID(),
      candidateRevision: `sha256:${"0".repeat(64)}`,
      runId: crypto.randomUUID(),
    };

    await expect(
      database.db.transaction((tx) => lockFinanceMaintenanceLineage(tx, owner.id, missingLineage)),
    ).resolves.toBeNull();
    await expect(
      database.db.transaction((tx) =>
        supersedeFinanceMaintenanceLineage(tx, owner.id, missingLineage, now),
      ),
    ).resolves.toEqual({ rebuilt: false, successorRunId: null });

    const { lineage, run } = await createLineage(owner.id);
    await expect(
      database.db.transaction((tx) => lockFinanceMaintenanceLineage(tx, owner.id, lineage)),
    ).resolves.toMatchObject({ id: run.id, status: "queued" });
    await expect(
      database.db.transaction((tx) => lockActiveFinanceMaintenanceRun(tx, owner.id, run.id)),
    ).resolves.toBeNull();
  });

  it("retires a reviewed active run and creates a durable successor", async () => {
    const owner = await createOwner();
    const { candidate, lineage, run } = await createLineage(owner.id);
    await database.db.insert(financePeriodReviews).values({
      cutoff: now,
      periodEnd: "2026-09-15",
      periodStart: "2026-09-01",
      report: {},
      runId: run.id,
      sourceIds: [],
      status: "completed_with_questions",
      userId: owner.id,
    });

    const result = await database.db.transaction((tx) =>
      supersedeFinanceMaintenanceLineage(tx, owner.id, lineage, now),
    );

    expect(result).toEqual({ rebuilt: true, successorRunId: expect.any(String) });
    await expect(
      database.db
        .select({ id: workspaceMaintenanceRuns.id, status: workspaceMaintenanceRuns.status })
        .from(workspaceMaintenanceRuns)
        .where(eq(workspaceMaintenanceRuns.userId, owner.id)),
    ).resolves.toEqual(
      expect.arrayContaining([
        { id: run.id, status: "failed_terminal" },
        { id: result.successorRunId, status: "queued" },
      ]),
    );
    await expect(
      database.db
        .select({ state: financeMaintenanceCandidates.state })
        .from(financeMaintenanceCandidates)
        .where(eq(financeMaintenanceCandidates.id, candidate.id)),
    ).resolves.toEqual([{ state: "superseded" }]);
  });

  it("reuses an active all-outstanding successor with the same rulebook", async () => {
    const owner = await createOwner();
    const { lineage, run } = await createLineage(owner.id, "completed_with_questions");
    const [activeSuccessor] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        domain: "finances",
        rulebookVersion: run.rulebookVersion,
        scope: { type: "all_outstanding" },
        status: "queued",
        userId: owner.id,
      })
      .returning();
    if (!activeSuccessor) throw new Error("Active maintenance successor was not created.");

    await expect(
      database.db.transaction((tx) =>
        supersedeFinanceMaintenanceLineage(tx, owner.id, lineage, now),
      ),
    ).resolves.toEqual({ rebuilt: true, successorRunId: activeSuccessor.id });
    await expect(
      database.db
        .select({ status: workspaceMaintenanceRuns.status })
        .from(workspaceMaintenanceRuns)
        .where(eq(workspaceMaintenanceRuns.id, activeSuccessor.id)),
    ).resolves.toEqual([{ status: "queued" }]);
  });
});
