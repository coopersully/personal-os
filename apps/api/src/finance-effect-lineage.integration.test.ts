import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  createDatabaseClient,
  executionPolicySettings,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financeMutationRecords,
  financeProfileVersions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import {
  financeConversationEffectReceiptSchema,
  financeLedgerChallengeChecks,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, inArray, sql } from "drizzle-orm";
import { financeCandidateEffectKey } from "./finance/candidate-effect-receipt.js";
import { createFinanceActionService } from "./finance-action-service.js";
import { createFinanceChallengeService } from "./finance-challenge-service.js";
import { createFinanceService } from "./finance-service.js";
import { createWorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

const now = new Date("2026-08-21T12:00:00.000Z");
const staleRevision = `sha256:${"0".repeat(64)}`;

describe.sequential("Finance whole-candidate effect lineage", () => {
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
    try {
      await database?.close();
    } finally {
      await container?.stop();
    }
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
      .insert(executionPolicySettings)
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

  async function effectContext(setup: Awaited<ReturnType<typeof fixture>>) {
    const [token] = await database.db
      .insert(accessTokens)
      .values({
        userId: setup.owner.id,
        name: "Effect lineage fixture",
        tokenHash: crypto.randomUUID(),
        scopes: ["finances:write", "finances:execute", "finances:maintain"],
      })
      .returning();
    if (!token) throw new Error("token");
    return {
      principal: {
        userId: setup.owner.id,
        actorId: token.id,
        actorType: "agent" as const,
        scopes: new Set(["finances:write", "finances:execute", "finances:maintain"] as const),
      },
      requestId: `effect:${setup.run.id}`,
    };
  }
  function revision(setup: Awaited<ReturnType<typeof fixture>>) {
    if (!setup.resolution.candidateRevision) throw new Error("revision");
    return setup.resolution.candidateRevision;
  }
  async function receipts(userId: string) {
    return database.db
      .select()
      .from(financeMutationRecords)
      .where(
        and(
          eq(financeMutationRecords.userId, userId),
          eq(financeMutationRecords.operation, "commit_finance_candidate_effect_v1"),
        ),
      );
  }
  it("commits the actual candidate loop, canonical audit and one receipt; lost-reply retry cannot repeat effects", async () => {
    const setup = await fixture();
    const context = await effectContext(setup);
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: true })
      .where(eq(executionPolicySettings.userId, setup.owner.id));
    expect(
      (
        await setup.actions.settleFinanceMaintenanceCandidate(
          setup.candidate.id,
          revision(setup),
          context,
        )
      ).status,
    ).toBe("committed");
    expect(
      (
        await setup.actions.settleFinanceMaintenanceCandidate(setup.candidate.id, revision(setup), {
          ...context,
          requestId: "lost-reply-retry",
        })
      ).status,
    ).toBe("committed");
    const stored = await receipts(setup.owner.id);
    expect(stored).toHaveLength(1);
    const receipt = financeConversationEffectReceiptSchema.parse(
      stored[0]?.response?.financeEffectReceipt,
    );
    expect(receipt.sourceMessageIds).toEqual([]);
    expect(receipt.humanApproval).toBeNull();
    expect(receipt.auditEventIds.length).toBeGreaterThan(0);
    expect(stored[0]?.idempotencyKey).toBe(
      financeCandidateEffectKey(setup.candidate.id, revision(setup)),
    );
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.userId, setup.owner.id), inArray(auditEvents.id, receipt.auditEventIds)),
      );
    expect(audits).toHaveLength(receipt.auditEventIds.length);
    expect(audits.every((audit) => audit.actorId === context.principal.actorId)).toBe(true);
    expect(
      await database.db
        .select()
        .from(financeProfileVersions)
        .where(eq(financeProfileVersions.userId, setup.owner.id)),
    ).toHaveLength(1);
  });
  it("rolls back actual financial writes, audits, receipt and candidate transition if receipt completion fails", async () => {
    const setup = await fixture();
    const context = await effectContext(setup);
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: true })
      .where(eq(executionPolicySettings.userId, setup.owner.id));
    await database.db.execute(
      sql`CREATE FUNCTION reject_effect_receipt_for_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'commit_finance_candidate_effect_v1' THEN RAISE EXCEPTION 'forced evidence failure'; END IF; RETURN NEW; END; $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER reject_effect_receipt_test BEFORE UPDATE ON finance_mutation_records FOR EACH ROW EXECUTE FUNCTION reject_effect_receipt_for_test()`,
    );
    try {
      await expect(
        setup.actions.settleFinanceMaintenanceCandidate(
          setup.candidate.id,
          revision(setup),
          context,
        ),
      ).rejects.toThrow();
      expect(await receipts(setup.owner.id)).toHaveLength(0);
      expect(
        await database.db
          .select()
          .from(financeProfileVersions)
          .where(eq(financeProfileVersions.userId, setup.owner.id)),
      ).toHaveLength(0);
      const [candidate] = await database.db
        .select()
        .from(financeMaintenanceCandidates)
        .where(eq(financeMaintenanceCandidates.id, setup.candidate.id));
      expect(candidate?.state).toBe("challenged");
      expect(
        await database.db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.userId, setup.owner.id),
              eq(auditEvents.requestId, context.requestId),
            ),
          ),
      ).toHaveLength(0);
    } finally {
      await database.db.execute(
        sql`DROP TRIGGER reject_effect_receipt_test ON finance_mutation_records`,
      );
      await database.db.execute(sql`DROP FUNCTION reject_effect_receipt_for_test()`);
    }
    expect(
      (
        await setup.actions.settleFinanceMaintenanceCandidate(
          setup.candidate.id,
          revision(setup),
          context,
        )
      ).status,
    ).toBe("committed");
  });
  it("serializes concurrent exact human approval and automated settlement without duplicate effects or lock inversion", async () => {
    const setup = await fixture();
    const context = await effectContext(setup);
    const queued = await setup.actions.settleFinanceMaintenanceCandidate(
      setup.candidate.id,
      revision(setup),
      context,
    );
    if (queued.status !== "pending_review") throw new Error("review");
    const human = {
      principal: {
        userId: setup.owner.id,
        actorId: setup.owner.id,
        actorType: "user" as const,
        scopes: new Set(["finances:write"] as const),
      },
      requestId: "human-approval",
    };
    await Promise.all([
      setup.actions.approve(queued.review.id, human),
      setup.actions.settleFinanceMaintenanceCandidate(setup.candidate.id, revision(setup), context),
    ]);
    expect(await receipts(setup.owner.id)).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(financeProfileVersions)
        .where(eq(financeProfileVersions.userId, setup.owner.id)),
    ).toHaveLength(1);
    const [stored] = await receipts(setup.owner.id);
    const receipt = financeConversationEffectReceiptSchema.parse(
      stored?.response?.financeEffectReceipt,
    );
    expect(receipt.humanApproval).toEqual({ actorId: setup.owner.id, reviewId: queued.review.id });
  });
  it("retains exact human budget denial even with agent execution authority and an empty chat source set", async () => {
    const setup = await fixture();
    const context = await effectContext(setup);
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: true })
      .where(eq(executionPolicySettings.userId, setup.owner.id));
    await database.db
      .update(financeMaintenanceCandidateItems)
      .set({
        actionKind: "budget_plan",
        privatePayload: { actionKind: "budget_plan", input: { operation: "activate" } },
      })
      .where(eq(financeMaintenanceCandidateItems.id, setup.item.id));
    const queued = await setup.actions.settleFinanceMaintenanceCandidate(
      setup.candidate.id,
      revision(setup),
      context,
    );
    if (queued.status !== "pending_review") throw new Error("budget review");
    await expect(setup.actions.approve(queued.review.id, context)).rejects.toThrow(
      "Every active budget change requires exact authenticated human approval",
    );
    expect(await receipts(setup.owner.id)).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(financeProfileVersions)
        .where(eq(financeProfileVersions.userId, setup.owner.id)),
    ).toHaveLength(0);
  });
});
