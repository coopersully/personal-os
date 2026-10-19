import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  automationHostSchedules,
  createDatabaseClient,
  executionPolicySettings,
  financeAgentActionReviews,
  financeConversationBatches,
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
import { createFinanceConversationService } from "./finance/conversation-persistence.js";
import { loadCandidateExecutionPrincipal } from "./finance/execution-binding.js";
import { guardFinanceExecutionTransaction } from "./finance/execution-owner-guard.js";
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

  async function fixture(bound = false, verifyProof = true) {
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
    const connectionId = crypto.randomUUID();
    const [hostToken] = bound
      ? await database.db
          .insert(accessTokens)
          .values({
            userId: owner.id,
            name: "Bound handoff",
            tokenHash: crypto.randomUUID(),
            authorizationConnectionId: connectionId,
            scopes: ["finances:maintain", "finances:write", "finances:execute"],
          })
          .returning()
      : [];
    const agent = hostToken
      ? {
          userId: owner.id,
          actorId: hostToken.id,
          actorType: "agent" as const,
          authorizationConnectionId: connectionId,
          scopes: new Set(hostToken.scopes),
        }
      : null;
    const conversation = createFinanceConversationService({ db: database.db, now: () => now });
    let scheduleId: string | null = null;
    if (agent) {
      scheduleId = crypto.randomUUID();
      const stamp = now.toISOString();
      await database.db.insert(automationHostSchedules).values({
        id: scheduleId,
        userId: owner.id,
        authorizationConnectionId: connectionId,
        schedule: {
          id: scheduleId,
          tenantAuthorizationConnectionId: connectionId,
          hostSurface: "codex_desktop",
          hostAutomationId: "bound-approval-fixture",
          label: "Bound approval",
          effectiveScopes: [...agent.scopes],
          trigger: {
            type: "recurring",
            recurrence: { type: "interval", everyMinutes: 5, timeZone: "UTC" },
          },
          state: "active",
          lastObservedAt: stamp,
          nextExpectedAt: stamp,
          version: 1,
          createdAt: stamp,
          updatedAt: stamp,
        },
      });
      await database.db
        .update(workspaceMaintenanceRuns)
        .set({
          authorizationConnectionId: connectionId,
          automationScheduleId: scheduleId,
        })
        .where(eq(workspaceMaintenanceRuns.id, run.id));
      if (verifyProof) {
        await database.db
          .update(executionPolicySettings)
          .set({ reviewBypassEnabled: true })
          .where(eq(executionPolicySettings.userId, owner.id));
        const human = {
          userId: owner.id,
          actorId: owner.id,
          actorType: "user" as const,
          scopes: new Set(["finances:read", "finances:write"] as const),
        };
        const proof = await conversation.issueChallenge(human, scheduleId);
        const fetched = await conversation.advanceChallenge(agent, proof.challengeId, {
          kind: "fetch",
        });
        if (!("nonce" in fetched)) throw new Error("Missing fetched challenge nonce.");
        await conversation.advanceChallenge(agent, proof.challengeId, {
          kind: "acknowledge",
          challengeId: proof.challengeId,
          nonce: fetched.nonce,
        });
        await conversation.advanceChallenge(agent, proof.challengeId, {
          kind: "respond",
          challengeId: proof.challengeId,
          response: "Verified actual bound protocol.",
        });
        await database.db
          .update(executionPolicySettings)
          .set({ reviewBypassEnabled: false })
          .where(eq(executionPolicySettings.userId, owner.id));
      }
    }
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
        principal: agent ?? {
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
    return {
      actions,
      candidate,
      challenge,
      finances,
      item,
      owner,
      resolution,
      run,
      step,
      agent,
      hostToken,
      conversation,
      scheduleId,
    };
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
  async function boundReview() {
    const setup = await fixture(true);
    if (!setup.agent) throw new Error("Missing bound agent.");
    const context = { principal: setup.agent, requestId: crypto.randomUUID() };
    const queued = await setup.actions.settleFinanceMaintenanceCandidate(
      setup.candidate.id,
      revision(setup),
      context,
    );
    if (queued.status !== "pending_review") throw new Error("Missing canonical pending review.");
    const human = {
      principal: {
        userId: setup.owner.id,
        actorId: setup.owner.id,
        actorType: "user" as const,
        scopes: new Set(["finances:write"] as const),
      },
      requestId: crypto.randomUUID(),
    };
    return { ...setup, context, queued, human };
  }
  async function assertNoBoundEffects(setup: Awaited<ReturnType<typeof fixture>>) {
    expect(await receipts(setup.owner.id)).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(financeProfileVersions)
        .where(eq(financeProfileVersions.userId, setup.owner.id)),
    ).toHaveLength(0);
  }
  it("applies exact canonical human approval with bypass disabled and no chat batch, retaining original actor and approval", async () => {
    const setup = await boundReview();
    expect(
      await database.db
        .select()
        .from(financeConversationBatches)
        .where(eq(financeConversationBatches.userId, setup.owner.id)),
    ).toHaveLength(0);
    expect(
      (
        await database.db
          .select()
          .from(executionPolicySettings)
          .where(eq(executionPolicySettings.userId, setup.owner.id))
      )[0]?.reviewBypassEnabled,
    ).toBe(false);
    expect(await setup.actions.approve(setup.queued.review.id, setup.human)).toMatchObject({
      status: "applied",
    });
    const [record] = await receipts(setup.owner.id);
    const receipt = financeConversationEffectReceiptSchema.parse(
      record?.response?.financeEffectReceipt,
    );
    expect(receipt.actor.id).toBe(setup.context.principal.actorId);
    expect(receipt.humanApproval).toEqual({
      actorId: setup.owner.id,
      reviewId: setup.queued.review.id,
    });
    expect(receipt.sourceMessageIds).toEqual([]);
    expect(
      await database.db.query.executionPolicySettings.findFirst({
        where: eq(executionPolicySettings.userId, setup.owner.id),
      }),
    ).toMatchObject({ reviewBypassEnabled: false });
  });
  it.each([
    "finances:maintain",
    "finances:write",
    "finances:execute",
  ] as const)("exact human approval cannot restore a bound grant that lost %s", async (lostScope) => {
    const setup = await boundReview();
    await database.db
      .update(accessTokens)
      .set({
        scopes: [...setup.context.principal.scopes].filter((scope) => scope !== lostScope),
      })
      .where(eq(accessTokens.id, setup.context.principal.actorId));
    await expect(setup.actions.approve(setup.queued.review.id, setup.human)).rejects.toMatchObject({
      code: "forbidden",
    });
    await assertNoBoundEffects(setup);
    expect(
      await database.db.query.financeAgentActionReviews.findFirst({
        where: eq(financeAgentActionReviews.id, setup.queued.review.id),
      }),
    ).toMatchObject({ status: "pending" });
  });
  it("exact human approval cannot revive a revoked bound token", async () => {
    const setup = await boundReview();
    await database.db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(accessTokens.id, setup.context.principal.actorId));
    await expect(setup.actions.approve(setup.queued.review.id, setup.human)).rejects.toMatchObject({
      code: "forbidden",
    });
    await assertNoBoundEffects(setup);
  });
  it("does not turn missing or stale canonical approval into execution; automated policy remains required", async () => {
    const setup = await boundReview();
    await expect(setup.actions.approve(crypto.randomUUID(), setup.human)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(
      await setup.actions.settleFinanceMaintenanceCandidate(
        setup.candidate.id,
        revision(setup),
        setup.context,
      ),
    ).toMatchObject({ status: "pending_review" });
    const currentRun = await database.db.query.workspaceMaintenanceRuns.findFirst({
      where: eq(workspaceMaintenanceRuns.id, setup.run.id),
    });
    if (!currentRun) throw new Error("Missing bound run.");
    await expect(
      database.db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, setup.owner.id, { runIds: [setup.run.id] });
        return loadCandidateExecutionPrincipal(
          tx,
          currentRun,
          setup.candidate.id,
          revision(setup),
          setup.context.principal,
          { requireExecution: true },
        );
      }),
    ).rejects.toThrow("review bypass");
    // Canonical review fingerprint must still describe the exact prepared item set.
    await database.db
      .update(financeMaintenanceCandidateItems)
      .set({ fingerprint: `sha256:${"f".repeat(64)}` })
      .where(eq(financeMaintenanceCandidateItems.id, setup.item.id));
    await expect(setup.actions.approve(setup.queued.review.id, setup.human)).rejects.toMatchObject({
      code: "conflict",
      message: "The Finance maintenance candidate requires rebuilding.",
    });
    expect(
      (
        await database.db.query.financeMaintenanceCandidates.findFirst({
          where: eq(financeMaintenanceCandidates.id, setup.candidate.id),
        })
      )?.state,
    ).toBe("superseded");
    await assertNoBoundEffects(setup);
  });
  it("rejects a bound no-batch settlement without any protocol proof", async () => {
    const setup = await fixture(true, false);
    if (!setup.agent) throw new Error("Missing bound agent.");
    await expect(
      setup.actions.settleFinanceMaintenanceCandidate(setup.candidate.id, revision(setup), {
        principal: setup.agent,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await assertNoBoundEffects(setup);
  });
  it.each([
    false,
    true,
  ])("latest unverified proof blocks bound no-batch approval even when its handshake expired=%s", async (expired) => {
    const setup = await boundReview();
    if (!setup.scheduleId) throw new Error("Missing bound host.");
    const replacement = createFinanceConversationService({
      db: database.db,
      now: () => new Date(Date.now() - (expired ? 11 * 60_000 : 0)),
    });
    await replacement.issueChallenge(setup.human.principal, setup.scheduleId);
    await expect(setup.actions.approve(setup.queued.review.id, setup.human)).rejects.toMatchObject({
      code: "forbidden",
    });
    await assertNoBoundEffects(setup);
  });
  it("rolls back the actual no-batch approved effect loop if its bound grant loses execute before final receipt commit", async () => {
    const setup = await boundReview();
    await database.db.execute(
      sql.raw(`CREATE FUNCTION drop_bound_execute_for_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      UPDATE access_tokens SET scopes='["finances:maintain","finances:write"]'::jsonb WHERE id='${setup.context.principal.actorId}'::uuid;
      RETURN NEW; END $$`),
    );
    await database.db.execute(
      sql`CREATE TRIGGER drop_bound_execute_test AFTER INSERT ON finance_profile_versions FOR EACH ROW EXECUTE FUNCTION drop_bound_execute_for_test()`,
    );
    try {
      await expect(
        setup.actions.approve(setup.queued.review.id, setup.human),
      ).rejects.toMatchObject({ code: "forbidden" });
      await assertNoBoundEffects(setup);
      expect(
        await database.db.query.financeAgentActionReviews.findFirst({
          where: eq(financeAgentActionReviews.id, setup.queued.review.id),
        }),
      ).toMatchObject({ status: "pending" });
    } finally {
      await database.db.execute(
        sql`DROP TRIGGER drop_bound_execute_test ON finance_profile_versions`,
      );
      await database.db.execute(sql`DROP FUNCTION drop_bound_execute_for_test()`);
    }
  });
});
