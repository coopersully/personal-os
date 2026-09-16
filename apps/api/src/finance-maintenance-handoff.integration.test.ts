import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAgentActionReviews,
  financeAgentSettings,
  financeLedgerChallenges,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financeProfileVersions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import { financeLedgerChallengeChecks } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceActionService } from "./finance-action-service.js";
import { createFinanceChallengeService } from "./finance-challenge-service.js";
import { createFinanceService } from "./finance-service.js";
import { createWorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

const now = new Date("2026-08-21T12:00:00.000Z");
const staleRevision = `sha256:${"0".repeat(64)}`;

describe.sequential("Finance maintenance handoff recovery", () => {
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

  async function fixture() {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Handoff owner",
        email: `handoff-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!owner) throw new Error("Missing handoff owner.");
    await database.db
      .insert(financeAgentSettings)
      .values({ userId: owner.id, reviewBypassEnabled: false });
    const finances = createFinanceService({ db: database.db, now: () => now });
    const actions = createFinanceActionService({ db: database.db, finances, now: () => now });
    const maintenance = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const run = await maintenance.createOrResume(
      owner.id,
      "finances",
      { type: "all_outstanding" },
      `sha256:${"a".repeat(64)}`,
    );
    const draft = await actions.prepareMaintenanceCandidateDraft(
      "profile",
      {
        effectiveDate: "2026-08-17",
        employer: "Handoff employer",
      },
      owner.id,
    );
    expect(draft.disposition).toBe("prepared");
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({
        userId: owner.id,
        runId: run.id,
        revision: staleRevision,
        state: "preparing",
      })
      .returning();
    if (!candidate) throw new Error("Missing handoff candidate.");
    const [item] = await database.db
      .insert(financeMaintenanceCandidateItems)
      .values({ ...draft, candidateId: candidate.id, ordinal: 0 })
      .returning();
    if (!item) throw new Error("Missing handoff item.");
    const snapshot = await finances.maintenanceCandidateSnapshot(owner.id, run.scope, [item], null);
    await database.db
      .update(financeMaintenanceCandidates)
      .set({
        revision: snapshot.revision,
        projection: snapshot.projection,
        state: "ready_for_challenge",
      })
      .where(eq(financeMaintenanceCandidates.id, candidate.id));
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        status: "awaiting_agent_challenge",
        checkpoint: { candidateId: candidate.id, phase: "challenge", revision: snapshot.revision },
      })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const challenges = createFinanceChallengeService({
      actions,
      db: database.db,
      finances,
      now: () => now,
    });
    const challenge = await challenges.prepare(owner.id, run.id, candidate.id);
    await challenges.submit(
      {
        candidateRevision: snapshot.revision,
        challengeId: challenge.id,
        checked: [...financeLedgerChallengeChecks],
        findings: [],
        reviewedItemIds: [item.id],
        rubricVersion: "finance-ledger-challenge-v1",
      },
      {
        principal: {
          actorId: "handoff-agent",
          actorType: "agent",
          scopes: new Set(["finances:maintain", "finances:write"]),
          userId: owner.id,
        },
        requestId: "handoff-challenge",
      },
    );
    const resolution = await challenges.resolve(owner.id, run.id);
    const [step] = await database.db
      .insert(workspaceMaintenanceSteps)
      .values({
        runId: run.id,
        stepName: "challenge_resolve",
        status: "completed",
        safeResult: resolution,
        idempotencyKey: `resolve:${run.id}`,
        attemptClaimId: crypto.randomUUID(),
      })
      .returning();
    if (!step) throw new Error("Missing resolve step.");
    // Crash boundary: completed resolve is durable; settlement has not started.
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        status: "awaiting_agent_challenge",
        checkpoint: {
          candidateId: candidate.id,
          revision: resolution.candidateRevision,
          phase: "challenge",
        },
        leaseClaimId: null,
        leaseExpiresAt: null,
      })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    return { actions, candidate, challenge, finances, item, owner, resolution, run, step };
  }

  async function assertNoEffects(setup: Awaited<ReturnType<typeof fixture>>) {
    const profiles = await database.db
      .select()
      .from(financeProfileVersions)
      .where(eq(financeProfileVersions.userId, setup.owner.id));
    expect(profiles).toEqual([]);
    const [item] = await database.db
      .select()
      .from(financeMaintenanceCandidateItems)
      .where(eq(financeMaintenanceCandidateItems.id, setup.item.id));
    expect(item?.disposition).toBe("prepared");
  }

  it("recovers a crashed resolved handoff once, queuing approval under persisted authority", async () => {
    const setup = await fixture();
    const outcomes = await Promise.all([
      setup.actions.recoverFinanceMaintenanceHandoff(setup.owner.id, setup.run.id),
      setup.actions.recoverFinanceMaintenanceHandoff(setup.owner.id, setup.run.id),
    ]);
    expect(outcomes.filter((outcome) => outcome.recovered)).toHaveLength(1);
    await expect(
      setup.actions.recoverFinanceMaintenanceHandoff(setup.owner.id, setup.run.id),
    ).resolves.toEqual({ recovered: false });
    const reviews = await database.db
      .select()
      .from(financeAgentActionReviews)
      .where(eq(financeAgentActionReviews.maintenanceRunId, setup.run.id));
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      actionKind: "maintenance_turn",
      status: "pending",
      userId: setup.owner.id,
      expectedRevision: setup.resolution.candidateRevision,
    });
    const [run] = await database.db
      .select()
      .from(workspaceMaintenanceRuns)
      .where(eq(workspaceMaintenanceRuns.id, setup.run.id));
    expect(run).toMatchObject({ status: "awaiting_approval", checkpoint: { phase: "approval" } });
    await assertNoEffects(setup);
  });

  it.each([
    "missing_resolve",
    "stale_resolution",
    "stale_candidate",
    "stale_challenge",
    "stale_source",
    "foreign_tenant",
    "live_claim",
  ] as const)("recovers safely for %s", async (scenario) => {
    const setup = await fixture();
    let userId = setup.owner.id;
    if (scenario === "missing_resolve")
      await database.db
        .delete(workspaceMaintenanceSteps)
        .where(eq(workspaceMaintenanceSteps.id, setup.step.id));
    if (scenario === "stale_resolution")
      await database.db
        .update(workspaceMaintenanceSteps)
        .set({ safeResult: { ...setup.resolution, candidateRevision: staleRevision } })
        .where(eq(workspaceMaintenanceSteps.id, setup.step.id));
    if (scenario === "stale_candidate")
      await database.db
        .update(financeMaintenanceCandidates)
        .set({ revision: staleRevision })
        .where(eq(financeMaintenanceCandidates.id, setup.candidate.id));
    if (scenario === "stale_challenge")
      await database.db
        .update(financeLedgerChallenges)
        .set({ candidateRevision: staleRevision })
        .where(eq(financeLedgerChallenges.id, setup.challenge.id));
    if (scenario === "stale_source")
      await setup.finances.createAccount(
        {
          balance: 100,
          institution: "Changed source",
          kind: "cash",
          name: "New account",
          provider: "manual",
        },
        {
          principal: {
            actorId: setup.owner.id,
            actorType: "user",
            scopes: new Set(["finances:write"]),
            userId: setup.owner.id,
          },
          requestId: "source-drift",
        },
      );
    if (scenario === "foreign_tenant") {
      const [other] = await database.db
        .insert(users)
        .values({
          displayName: "Other owner",
          email: `other-handoff-${crypto.randomUUID()}@example.com`,
          passwordHash: "unused",
        })
        .returning();
      if (!other) throw new Error("Missing other owner.");
      userId = other.id;
    }
    if (scenario === "live_claim")
      await database.db
        .update(workspaceMaintenanceRuns)
        .set({
          status: "running",
          leaseClaimId: crypto.randomUUID(),
          leaseExpiresAt: new Date(now.getTime() + 60_000),
        })
        .where(eq(workspaceMaintenanceRuns.id, setup.run.id));
    await expect(
      setup.actions.recoverFinanceMaintenanceHandoff(userId, setup.run.id),
    ).resolves.toMatchObject({ recovered: scenario === "stale_source" });
    expect(
      await database.db
        .select()
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.maintenanceRunId, setup.run.id)),
    ).toEqual([]);
    const [candidate] = await database.db
      .select()
      .from(financeMaintenanceCandidates)
      .where(eq(financeMaintenanceCandidates.id, setup.candidate.id));
    expect(candidate?.state).toBe(scenario === "stale_source" ? "superseded" : "challenged");
    if (scenario === "stale_source") {
      const [run] = await database.db
        .select()
        .from(workspaceMaintenanceRuns)
        .where(eq(workspaceMaintenanceRuns.id, setup.run.id));
      expect(run).toMatchObject({
        status: "queued",
        checkpoint: {
          candidateId: setup.candidate.id,
          phase: "prepare",
          reason: "candidate_drift",
        },
        leaseClaimId: null,
        leaseExpiresAt: null,
        retryAt: null,
      });
      expect(
        await database.db
          .select()
          .from(workspaceMaintenanceSteps)
          .where(eq(workspaceMaintenanceSteps.runId, setup.run.id)),
      ).toEqual([]);
    }
    await assertNoEffects(setup);
  });
  it.each([
    false,
    true,
  ])("restarts stale preparation once without economic apply when bypass=%s", async (bypass) => {
    const setup = await fixture();
    await database.db
      .update(financeAgentSettings)
      .set({ reviewBypassEnabled: bypass })
      .where(eq(financeAgentSettings.userId, setup.owner.id));
    await setup.finances.createAccount(
      {
        balance: 100,
        institution: "Changed source",
        kind: "cash",
        name: "Source drift",
        provider: "manual",
      },
      {
        principal: {
          actorId: setup.owner.id,
          actorType: "user",
          scopes: new Set(["finances:write"]),
          userId: setup.owner.id,
        },
        requestId: "stale-handoff-source",
      },
    );
    const results = await Promise.all([
      setup.actions.recoverFinanceMaintenanceHandoff(setup.owner.id, setup.run.id),
      setup.actions.recoverFinanceMaintenanceHandoff(setup.owner.id, setup.run.id),
    ]);
    expect(results.filter((result) => result.recovered)).toEqual([
      { recovered: true, outcome: { candidateId: setup.candidate.id, status: "superseded" } },
    ]);
    await assertNoEffects(setup);
    expect(
      await database.db
        .select()
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.maintenanceRunId, setup.run.id)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(workspaceMaintenanceSteps)
        .where(eq(workspaceMaintenanceSteps.runId, setup.run.id)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(financeLedgerChallenges)
        .where(eq(financeLedgerChallenges.id, setup.challenge.id)),
    ).toEqual([expect.objectContaining({ state: "resolved" })]);
    const next = await setup.finances.beginMaintenanceCandidatePreparation({
      runId: setup.run.id,
      userId: setup.owner.id,
    });
    expect(next.candidateId).not.toBe(setup.candidate.id);
    expect(next.complete).toBe(false);
    const context: Parameters<typeof setup.actions.settleFinanceMaintenanceCandidate>[2] = {
      principal: {
        actorId: "handoff-agent",
        actorType: "agent" as const,
        scopes: new Set(["finances:maintain", "finances:write"]),
        userId: setup.owner.id,
      },
      requestId: "must-challenge-fresh-candidate",
    };
    await expect(
      setup.actions.settleFinanceMaintenanceCandidate(
        next.candidateId,
        setup.resolution.candidateRevision ?? staleRevision,
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      setup.actions.settleFinanceMaintenanceCandidate(
        setup.candidate.id,
        setup.resolution.candidateRevision ?? staleRevision,
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await assertNoEffects(setup);
  });

  it("does not erase checkpoints for a candidate containing committed work", async () => {
    const setup = await fixture();
    await database.db
      .update(financeMaintenanceCandidateItems)
      .set({ disposition: "committed" })
      .where(eq(financeMaintenanceCandidateItems.id, setup.item.id));
    await expect(
      setup.actions.recoverFinanceMaintenanceHandoff(setup.owner.id, setup.run.id),
    ).resolves.toEqual({ recovered: false });
    expect(
      await database.db
        .select()
        .from(workspaceMaintenanceSteps)
        .where(eq(workspaceMaintenanceSteps.runId, setup.run.id)),
    ).toEqual([expect.objectContaining({ id: setup.step.id, status: "completed" })]);
    expect(
      await database.db
        .select()
        .from(financeMaintenanceCandidates)
        .where(eq(financeMaintenanceCandidates.id, setup.candidate.id)),
    ).toEqual([expect.objectContaining({ state: "challenged" })]);
  });
});
