import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  automationHostSchedules,
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeConversationCapabilities,
  financeMaintenanceCandidates,
  financeMaintenanceExecutionBindings,
  financeMaintenanceExecutionReceipts,
  financeMutationRecords,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  automationHostScheduleSchema,
  FINANCE_CONVERSATION_PROTOCOL_VERSION,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { createAutomationHostService } from "../automation-host-service.js";
import { createOAuthService } from "../oauth-service.js";
import { hashToken } from "../security.js";
import { createWorkspaceMaintenanceService } from "../workspace-maintenance-service.js";
import { commitFinanceCandidateEffects } from "./candidate-effect-receipt.js";
import { requireFinanceEffectMessageProof } from "./conversation-causality.js";
import { createFinanceConversationEvidenceService } from "./conversation-evidence-service.js";
import { createFinanceConversationService } from "./conversation-persistence.js";
import { hasUsableFinanceConversationConsumer } from "./conversation-service.js";
import {
  initializeFinanceExecutionBinding,
  loadCandidateExecutionPrincipal,
} from "./execution-binding.js";
import { assertFinanceDerivedCompletionClaim } from "./execution-claim-fence.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";
import {
  getCurrentFinanceExecutionProof,
  requireCurrentFinanceExecutionProof,
} from "./execution-proof.js";
import { createFinanceMaintenanceControlRecovery } from "./maintenance-control-recovery.js";
import { createFinanceMaintenanceExecutionService } from "./maintenance-execution-service.js";

/** Authored only: reserved Lead PG slot required. These exercise real constraints and claim fencing. */
describe.sequential("Finance prospective execution binding storage and derived claim", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
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
  async function fixture(oauth = false, initialize = true) {
    const userId = randomUUID();
    let connection: string = randomUUID();
    const scheduleId = randomUUID();
    const claimId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "Execution binding",
      passwordHash: "unused",
    });
    const scopes = [
      "finances:read",
      "finances:write",
      "finances:execute",
      "finances:maintain",
    ] as const;
    const resource = "https://mcp.example.com/mcp";
    const oauthService = createOAuthService({ db: database.db, now: () => new Date(), resource });
    let rotation:
      | (() => Promise<
          ReturnType<typeof oauthService.refresh> extends Promise<infer T> ? T : never
        >)
      | undefined;
    let token: typeof accessTokens.$inferSelect | undefined;
    if (oauth) {
      const client = await oauthService.registerClient("Finance recovery", [
        "https://client.example/callback",
      ]);
      const verifier = "v".repeat(43);
      const code = await oauthService.authorize({
        userId,
        clientId: client.client_id,
        codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
        redirectUri: "https://client.example/callback",
        scopes: [...scopes],
      });
      const issued = await oauthService.exchangeCode({
        clientId: client.client_id,
        code,
        codeVerifier: verifier,
        redirectUri: "https://client.example/callback",
        resource,
      });
      [token] = await database.db
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.tokenHash, hashToken(issued.access_token)));
      rotation = () =>
        oauthService.refresh({
          clientId: client.client_id,
          refreshToken: issued.refresh_token,
          resource,
        });
    } else {
      [token] = await database.db
        .insert(accessTokens)
        .values({
          userId,
          name: "Original",
          tokenHash: randomUUID(),
          authorizationConnectionId: connection,
          scopes: [...scopes],
        })
        .returning();
    }
    if (!token) throw new Error("token");
    if (oauth) {
      if (!token.authorizationConnectionId) throw new Error("OAuth connection");
      connection = token.authorizationConnectionId;
    }
    const stamp = new Date().toISOString();
    await database.db.insert(automationHostSchedules).values({
      id: scheduleId,
      userId,
      authorizationConnectionId: connection,
      schedule: automationHostScheduleSchema.parse({
        id: scheduleId,
        tenantAuthorizationConnectionId: connection,
        hostSurface: "codex_desktop",
        hostAutomationId: "binding-test",
        label: "Binding",
        effectiveScopes: token.scopes,
        trigger: {
          type: "recurring",
          recurrence: { type: "interval", everyMinutes: 2, timeZone: "America/New_York" },
        },
        state: "active",
        lastObservedAt: stamp,
        nextExpectedAt: stamp,
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      }),
    });
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "binding-test",
        authorizationConnectionId: connection,
        automationScheduleId: scheduleId,
        status: "running",
        leaseClaimId: claimId,
        leaseExpiresAt: new Date(Date.now() + 60000),
      })
      .returning();
    if (!run) throw new Error("run");
    const revision = `sha256:${"a".repeat(64)}`;
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({ userId, runId: run.id, revision, state: "committed" })
      .returning();
    if (!candidate) throw new Error("candidate");
    const input = {
      run,
      candidateId: candidate.id,
      candidateRevision: revision,
      submittedFromRevision: `sha256:${"b".repeat(64)}`,
      fingerprint: "actual-submission",
      principal: {
        userId,
        actorId: token.id,
        actorType: "agent" as const,
        authorizationConnectionId: connection,
        scopes: new Set(token.scopes),
      },
      at: new Date(),
    };
    if (initialize)
      await database.db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, userId, { runIds: [run.id] });
        await initializeFinanceExecutionBinding(tx, input);
      });
    return {
      userId,
      token,
      run,
      candidate,
      claimId,
      input,
      rotation,
      scopes,
      scheduleId,
      connection,
    };
  }
  it("rejects host changes for a submitted binding without writes, keeps same-host recovery inert, and preserves unbound legacy recovery", async () => {
    const f = await fixture();
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "awaiting_agent_challenge", leaseClaimId: null, leaseExpiresAt: null })
      .where(eq(workspaceMaintenanceRuns.id, f.run.id));
    const [run] = await database.db
      .select()
      .from(workspaceMaintenanceRuns)
      .where(eq(workspaceMaintenanceRuns.id, f.run.id));
    const [original] = await database.db
      .select()
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.id, f.scheduleId));
    if (!run || !original) throw new Error("host recovery fixture");
    const replacementId = randomUUID();
    await database.db.insert(automationHostSchedules).values({
      ...original,
      id: replacementId,
      schedule: { ...original.schedule, id: replacementId, label: "Replacement" },
    });
    const service = createAutomationHostService({
      db: database.db,
      now: () => new Date(),
      encryptionKey: Buffer.alloc(32, 1).toString("base64"),
    });
    const human = {
      userId: f.userId,
      actorId: f.userId,
      actorType: "user" as const,
      scopes: new Set(["finances:write" as const]),
    };
    const input = {
      scheduleId: replacementId,
      expectedScheduleId: f.scheduleId,
      expectedConnectionId: f.connection,
      expectedUpdatedAt: run.updatedAt.toISOString(),
      hostChecked: true,
    };
    const beforeAudits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, f.userId));
    await expect(service.recoverHostRun(human, run.id, input)).rejects.toThrow(
      "retain its original host",
    );
    expect(
      (
        await database.db
          .select()
          .from(workspaceMaintenanceRuns)
          .where(eq(workspaceMaintenanceRuns.id, run.id))
      )[0],
    ).toEqual(run);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, f.userId)),
    ).toEqual(beforeAudits);
    expect(
      await service.recoverHostRun(human, run.id, { ...input, scheduleId: f.scheduleId }),
    ).toEqual({ id: run.id });
    expect(
      (
        await database.db
          .select()
          .from(workspaceMaintenanceRuns)
          .where(eq(workspaceMaintenanceRuns.id, run.id))
      )[0],
    ).toEqual(run);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, f.userId)),
    ).toEqual(beforeAudits);
    const foreign = await fixture();
    await expect(
      service.recoverHostRun(
        { ...human, userId: foreign.userId, actorId: foreign.userId },
        run.id,
        { ...input, scheduleId: foreign.scheduleId },
      ),
    ).rejects.toBeDefined();
    const legacy = await fixture(false, false);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "awaiting_agent_challenge", leaseClaimId: null, leaseExpiresAt: null })
      .where(eq(workspaceMaintenanceRuns.id, legacy.run.id));
    const [legacyRun] = await database.db
      .select()
      .from(workspaceMaintenanceRuns)
      .where(eq(workspaceMaintenanceRuns.id, legacy.run.id));
    const [legacySchedule] = await database.db
      .select()
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.id, legacy.scheduleId));
    if (!legacyRun || !legacySchedule) throw new Error("legacy fixture");
    const legacyReplacement = randomUUID();
    await database.db.insert(automationHostSchedules).values({
      ...legacySchedule,
      id: legacyReplacement,
      schedule: { ...legacySchedule.schedule, id: legacyReplacement },
    });
    await service.recoverHostRun(
      { ...human, userId: legacy.userId, actorId: legacy.userId },
      legacy.run.id,
      {
        ...input,
        scheduleId: legacyReplacement,
        expectedScheduleId: legacy.scheduleId,
        expectedConnectionId: legacy.connection,
        expectedUpdatedAt: legacyRun.updatedAt.toISOString(),
      },
    );
    expect(
      (
        await database.db
          .select()
          .from(workspaceMaintenanceRuns)
          .where(eq(workspaceMaintenanceRuns.id, legacy.run.id))
      )[0]?.automationScheduleId,
    ).toBe(legacyReplacement);
  });
  it("reuses exact initialization, rejects forged attribution and direct rebinding, and erases with owner", async () => {
    const f = await fixture();
    await database.db.transaction(async (tx) => {
      await guardFinanceExecutionTransaction(tx, f.userId, { runIds: [f.run.id] });
      await initializeFinanceExecutionBinding(tx, f.input);
    });
    expect(
      await database.db
        .select()
        .from(financeMaintenanceExecutionBindings)
        .where(eq(financeMaintenanceExecutionBindings.userId, f.userId)),
    ).toHaveLength(1);
    await expect(
      database.db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, f.userId, { runIds: [f.run.id] });
        await initializeFinanceExecutionBinding(tx, { ...f.input, fingerprint: "changed" });
      }),
    ).rejects.toBeDefined();
    await expect(
      database.db
        .update(financeMaintenanceExecutionBindings)
        .set({ bindingRevision: 2n })
        .where(eq(financeMaintenanceExecutionBindings.userId, f.userId)),
    ).rejects.toBeDefined();
    const foreign = await fixture();
    await expect(
      database.db.transaction(async (tx) => {
        const [foreignBinding] = await tx
          .select()
          .from(financeMaintenanceExecutionBindings)
          .where(eq(financeMaintenanceExecutionBindings.userId, foreign.userId));
        if (!foreignBinding) throw new Error("foreign fixture binding");
        await tx.insert(financeMaintenanceExecutionReceipts).values({
          id: randomUUID(),
          userId: f.userId,
          bindingId: foreignBinding.id,
          fromActorId: f.token.id,
          toActorId: f.token.id,
          fromRevision: 1n,
          toRevision: 2n,
          fingerprint: "foreign",
          createdAt: new Date(),
        });
      }),
    ).rejects.toBeDefined();
    await database.db.delete(users).where(eq(users.id, f.userId));
    expect(
      await database.db
        .select()
        .from(financeMaintenanceExecutionBindings)
        .where(eq(financeMaintenanceExecutionBindings.userId, f.userId)),
    ).toHaveLength(0);
  });
  it("allows exact fresh derived claim but rejects stale binding, foreign claim and post-lock expiry", async () => {
    const f = await fixture();
    const claim = {
      claimId: f.claimId,
      financeExecution: { currentActorId: f.token.id, bindingRevision: "1" },
    };
    const check = (value: typeof claim) =>
      database.db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, f.userId, { runIds: [f.run.id] });
        await assertFinanceDerivedCompletionClaim(tx, f.userId, f.run.id, value);
      });
    await expect(check(claim)).resolves.toBeUndefined();
    await expect(check({ ...claim, claimId: randomUUID() })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      check({ ...claim, financeExecution: { ...claim.financeExecution, bindingRevision: "2" } }),
    ).rejects.toMatchObject({ code: "conflict" });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ leaseExpiresAt: new Date(Date.now() - 1) })
      .where(eq(workspaceMaintenanceRuns.id, f.run.id));
    await expect(check(claim)).rejects.toMatchObject({ code: "conflict" });
  });

  async function successorFixture(initialize = true, committed = false) {
    const f = await fixture(true, initialize);
    await database.db
      .insert(executionPolicySettings)
      .values({ userId: f.userId, reviewBypassEnabled: true });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        status: "awaiting_agent_challenge",
        leaseClaimId: null,
        leaseExpiresAt: null,
        checkpoint: {
          candidateId: f.candidate.id,
          revision: f.candidate.revision,
          phase: "challenge",
        },
      })
      .where(eq(workspaceMaintenanceRuns.id, f.run.id));
    await database.db
      .update(financeMaintenanceCandidates)
      .set({ state: "challenged" })
      .where(eq(financeMaintenanceCandidates.id, f.candidate.id));
    const conversation = createFinanceConversationService({ db: database.db });
    const human = {
      userId: f.userId,
      actorId: f.userId,
      actorType: "user" as const,
      scopes: new Set(f.scopes),
    };
    const challenge = await conversation.issueChallenge(human, f.scheduleId);
    const fetched = await conversation.advanceChallenge(f.input.principal, challenge.challengeId, {
      kind: "fetch",
    });
    if (!fetched.nonce) throw new Error("challenge nonce");
    await conversation.advanceChallenge(f.input.principal, challenge.challengeId, {
      kind: "acknowledge",
      challengeId: challenge.challengeId,
      nonce: fetched.nonce,
    });
    await conversation.advanceChallenge(f.input.principal, challenge.challengeId, {
      kind: "respond",
      challengeId: challenge.challengeId,
      response: "Finance protocol ready",
    });
    const effectApplications = vi.fn(async () => undefined);
    if (committed)
      await database.db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, f.userId, { runIds: [f.run.id] });
        const [run] = await tx
          .select()
          .from(workspaceMaintenanceRuns)
          .where(eq(workspaceMaintenanceRuns.id, f.run.id))
          .for("update");
        if (!run) throw new Error("run");
        const principal = await loadCandidateExecutionPrincipal(
          tx,
          run,
          f.candidate.id,
          f.candidate.revision,
          f.input.principal,
          { requireExecution: true },
        );
        await requireFinanceEffectMessageProof(tx, run, principal, new Date());
        await commitFinanceCandidateEffects({
          db: database.db,
          tx,
          run,
          candidateId: f.candidate.id,
          candidateRevision: f.candidate.revision,
          principal,
          requestId: randomUUID(),
          items: [],
          now: new Date(),
          applyEffects: effectApplications,
        });
        await tx
          .update(financeMaintenanceCandidates)
          .set({ state: "committed" })
          .where(eq(financeMaintenanceCandidates.id, f.candidate.id));
        await tx
          .update(workspaceMaintenanceRuns)
          .set({
            status: "completed",
            checkpoint: { candidateId: f.candidate.id, phase: "health_refresh" },
            updatedAt: new Date(),
          })
          .where(eq(workspaceMaintenanceRuns.id, f.run.id));
      });
    await database.db
      .update(accessTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(accessTokens.id, f.token.id));
    if (!f.rotation) throw new Error("canonical rotation");
    const rotated = await f.rotation();
    const [next] = await database.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.tokenHash, hashToken(rotated.access_token)));
    if (!next) throw new Error("successor");
    const principal = { ...f.input.principal, actorId: next.id, scopes: new Set(next.scopes) };
    const service = createFinanceMaintenanceExecutionService({ db: database.db });
    await service.readMaintenanceExecutionAuthorization(principal, f.run.id);
    const [currentRun] = await database.db
      .select()
      .from(workspaceMaintenanceRuns)
      .where(eq(workspaceMaintenanceRuns.id, f.run.id));
    if (!currentRun) throw new Error("run");
    const command = {
      operationId: randomUUID(),
      candidateId: f.candidate.id,
      candidateRevision: f.candidate.revision,
      expectedCurrentActorId: f.token.id,
      expectedBindingRevision: "1",
      expectedRunUpdatedAt: currentRun.updatedAt.toISOString(),
    };
    return { ...f, principal, service, command, effectApplications };
  }
  it("adopts only canonical successor and replays the actor-bound success before obsolete CAS", async () => {
    const f = await successorFixture();
    const result = await f.service.refreshMaintenanceExecutionAuthorization(
      f.principal,
      f.run.id,
      f.command,
    );
    expect(result).toMatchObject({
      state: "refreshed",
      currentActorId: f.principal.actorId,
      bindingRevision: "2",
    });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(workspaceMaintenanceRuns.id, f.run.id));
    expect(
      await f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
    ).toEqual(result);
    const [binding] = await database.db
      .select()
      .from(financeMaintenanceExecutionBindings)
      .where(eq(financeMaintenanceExecutionBindings.userId, f.userId));
    expect(binding).toMatchObject({
      originalActorId: f.token.id,
      currentActorId: f.principal.actorId,
      bindingRevision: 2n,
    });
    expect(
      await database.db
        .select()
        .from(financeMaintenanceExecutionReceipts)
        .where(eq(financeMaintenanceExecutionReceipts.userId, f.userId)),
    ).toHaveLength(1);
  });
  it("records stable no-effect pending during a live claim; only a fresh NEW command can adopt after release", async () => {
    const f = await successorFixture();
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        status: "running",
        leaseClaimId: f.claimId,
        leaseExpiresAt: new Date(Date.now() + 60000),
      })
      .where(eq(workspaceMaintenanceRuns.id, f.run.id));
    const pending = await f.service.refreshMaintenanceExecutionAuthorization(
      f.principal,
      f.run.id,
      f.command,
    );
    expect(pending).toMatchObject({ state: "pending", reason: "active_claim" });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        status: "awaiting_agent_challenge",
        leaseClaimId: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(workspaceMaintenanceRuns.id, f.run.id));
    expect(
      await f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
    ).toEqual(pending);
    const observed = await f.service.readMaintenanceExecutionAuthorization(f.principal, f.run.id);
    if (observed.state !== "available") throw new Error("observed");
    expect(
      await f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, {
        ...f.command,
        operationId: randomUUID(),
        expectedRunUpdatedAt: observed.runUpdatedAt,
      }),
    ).toMatchObject({ state: "refreshed", bindingRevision: "2" });
    expect(
      await database.db
        .select()
        .from(financeMutationRecords)
        .where(
          and(
            eq(financeMutationRecords.userId, f.userId),
            eq(financeMutationRecords.idempotencyKey, f.command.operationId),
          ),
        ),
    ).toMatchObject([{ status: "completed", response: pending }]);
  });
  it("rolls back binding, immutable receipt and command together if the authorized binding write fails", async () => {
    const f = await successorFixture();
    await database.pool.query(
      "CREATE FUNCTION reject_test_finance_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test binding failure'; END $$; CREATE TRIGGER reject_test_finance_binding BEFORE UPDATE ON finance_maintenance_execution_bindings FOR EACH ROW EXECUTE FUNCTION reject_test_finance_binding()",
    );
    try {
      await expect(
        f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
      ).rejects.toThrow();
    } finally {
      await database.pool.query(
        "DROP TRIGGER reject_test_finance_binding ON finance_maintenance_execution_bindings; DROP FUNCTION reject_test_finance_binding()",
      );
    }
    expect(
      await database.db
        .select()
        .from(financeMaintenanceExecutionReceipts)
        .where(eq(financeMaintenanceExecutionReceipts.userId, f.userId)),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(financeMutationRecords)
        .where(eq(financeMutationRecords.idempotencyKey, f.command.operationId)),
    ).toHaveLength(0);
    const [binding] = await database.db
      .select()
      .from(financeMaintenanceExecutionBindings)
      .where(eq(financeMaintenanceExecutionBindings.userId, f.userId));
    expect(binding).toMatchObject({ currentActorId: f.token.id, bindingRevision: 1n });
  });
  it("safe observation rejects foreign owners, wrong original connection, lost scopes and revoked current grants without adopting", async () => {
    const f = await successorFixture();
    for (const principal of [
      { ...f.principal, userId: randomUUID() },
      { ...f.principal, authorizationConnectionId: randomUUID() },
      { ...f.principal, scopes: new Set(["finances:maintain"] as const) },
    ])
      await expect(
        f.service.readMaintenanceExecutionAuthorization(principal, f.run.id),
      ).rejects.toBeDefined();
    await database.db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(accessTokens.id, f.principal.actorId));
    await expect(
      f.service.readMaintenanceExecutionAuthorization(f.principal, f.run.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
    ).rejects.toMatchObject({ code: "forbidden" });
    const [binding] = await database.db
      .select()
      .from(financeMaintenanceExecutionBindings)
      .where(eq(financeMaintenanceExecutionBindings.userId, f.userId));
    expect(binding).toMatchObject({ currentActorId: f.token.id, bindingRevision: 1n });
  });
  it("reports a prospective pre-submit missing binding without initializing or backfilling it", async () => {
    const f = await successorFixture(false);
    expect(await f.service.readMaintenanceExecutionAuthorization(f.principal, f.run.id)).toEqual({
      state: "unavailable",
      reason: "binding_unavailable",
    });
    expect(
      await f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
    ).toMatchObject({ state: "blocked", reason: "binding_unavailable" });
    expect(
      await database.db
        .select()
        .from(financeMaintenanceExecutionBindings)
        .where(eq(financeMaintenanceExecutionBindings.userId, f.userId)),
    ).toHaveLength(0);
  });
  it("classifies an actual canonical committed no-change receipt as derived completion without replaying effects despite credential loss", async () => {
    const f = await successorFixture(true, true);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "queued" })
      .where(eq(workspaceMaintenanceRuns.id, f.run.id));
    const claimed = await createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date(),
    }).claim(f.run.id);
    if (!claimed) throw new Error("claim");
    const control = createFinanceMaintenanceControlRecovery({ db: database.db });
    const input = {
      kind: "submitted_with_binding" as const,
      runId: f.run.id,
      candidateId: f.candidate.id,
      candidateRevision: f.candidate.revision,
      expectedBindingRevision: "1",
    };
    expect(await control.resumeFinanceMaintenanceControl(input, claimed.claimId)).toEqual({
      state: "continue",
      reason: "committed_derived_completion",
    });
    expect(await control.resumeFinanceMaintenanceControl(input, claimed.claimId)).toEqual({
      state: "continue",
      reason: "committed_derived_completion",
    });
    expect(f.effectApplications).toHaveBeenCalledTimes(1);
    await expect(
      control.resumeFinanceMaintenanceControl(
        { ...input, expectedBindingRevision: "2" },
        claimed.claimId,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      control.resumeFinanceMaintenanceControl(input, randomUUID()),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("serializes competing NEW commands against one observed binding and returns exact same-command concurrency replay", async () => {
    const f = await successorFixture();
    const [one, two] = await Promise.all([
      f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
      f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
    ]);
    expect(one).toEqual(two);
    expect(one).toMatchObject({ state: "refreshed", bindingRevision: "2" });
    expect(
      await database.db
        .select()
        .from(financeMaintenanceExecutionReceipts)
        .where(eq(financeMaintenanceExecutionReceipts.userId, f.userId)),
    ).toHaveLength(1);
    const g = await successorFixture();
    const results = await Promise.allSettled([
      g.service.refreshMaintenanceExecutionAuthorization(g.principal, g.run.id, g.command),
      g.service.refreshMaintenanceExecutionAuthorization(g.principal, g.run.id, {
        ...g.command,
        operationId: randomUUID(),
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(financeMaintenanceExecutionReceipts)
        .where(eq(financeMaintenanceExecutionReceipts.userId, g.userId)),
    ).toHaveLength(1);
  });
  it("revalidates persisted scope, standing policy and a replacement protocol proof before observation or adoption", async () => {
    const f = await successorFixture();
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: false })
      .where(eq(executionPolicySettings.userId, f.userId));
    await expect(
      f.service.readMaintenanceExecutionAuthorization(f.principal, f.run.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: true })
      .where(eq(executionPolicySettings.userId, f.userId));
    await database.db
      .update(accessTokens)
      .set({ scopes: ["finances:maintain", "finances:write"] })
      .where(eq(accessTokens.id, f.principal.actorId));
    await expect(
      f.service.readMaintenanceExecutionAuthorization(f.principal, f.run.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(accessTokens)
      .set({ scopes: [...f.scopes] })
      .where(eq(accessTokens.id, f.principal.actorId));
    const conversation = createFinanceConversationService({ db: database.db });
    await conversation.issueChallenge(
      { userId: f.userId, actorId: f.userId, actorType: "user", scopes: new Set(f.scopes) },
      f.scheduleId,
    );
    await expect(
      f.service.readMaintenanceExecutionAuthorization(f.principal, f.run.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await database.db
        .select()
        .from(financeMaintenanceExecutionReceipts)
        .where(eq(financeMaintenanceExecutionReceipts.userId, f.userId)),
    ).toHaveLength(0);
  });

  it("a same-clock canonical generation deterministically supersedes the previous verified proof", async () => {
    const f = await successorFixture();
    const fixed = new Date();
    const conversation = createFinanceConversationService({ db: database.db, now: () => fixed });
    const human = {
      userId: f.userId,
      actorId: f.userId,
      actorType: "user" as const,
      scopes: new Set(f.scopes),
    };
    const first = await conversation.issueChallenge(human, f.scheduleId);
    const fetched = await conversation.advanceChallenge(f.principal, first.challengeId, {
      kind: "fetch",
    });
    if (!fetched.nonce) throw new Error("nonce");
    await conversation.advanceChallenge(f.principal, first.challengeId, {
      kind: "acknowledge",
      challengeId: first.challengeId,
      nonce: fetched.nonce,
    });
    await conversation.advanceChallenge(f.principal, first.challengeId, {
      kind: "respond",
      challengeId: first.challengeId,
      response: "Protocol verified",
    });
    expect(
      await f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
    ).toMatchObject({ state: "refreshed" });
    const second = await conversation.issueChallenge(human, f.scheduleId);
    const comparison = await database.pool.query(
      "SELECT newer.generation=older.generation+1 AND newer.created_at=older.created_at AND newer.expires_at=newer.created_at+interval '10 minutes' AS monotonic FROM finance_conversation_capabilities newer, finance_conversation_capabilities older WHERE newer.id=$1 AND older.id=$2",
      [second.challengeId, first.challengeId],
    );
    expect(comparison.rows[0]?.monotonic).toBe(true);
    await expect(
      f.service.readMaintenanceExecutionAuthorization(f.principal, f.run.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      conversation.advanceChallenge(f.principal, first.challengeId, { kind: "fetch" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("reads a committed receipt through only the canonical successor without adoption or changing original actor", async () => {
    const f = await successorFixture(true, true);
    const evidence = createFinanceConversationEvidenceService({
      db: database.db,
      cursorSecret: "recovery-test",
    });
    const input = { candidateId: f.candidate.id, candidateRevision: f.candidate.revision };
    expect(await evidence.readRunEvidence(f.principal, f.run.id, input)).toMatchObject({
      state: "available",
      receipt: { actor: { type: "agent", id: f.token.id }, outcome: "committed" },
    });
    const [binding] = await database.db
      .select()
      .from(financeMaintenanceExecutionBindings)
      .where(eq(financeMaintenanceExecutionBindings.userId, f.userId));
    expect(binding).toMatchObject({
      currentActorId: f.token.id,
      bindingRevision: 1n,
      protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
    });
    expect(f.effectApplications).toHaveBeenCalledTimes(1);
    expect(
      await database.db
        .select()
        .from(financeMaintenanceExecutionReceipts)
        .where(eq(financeMaintenanceExecutionReceipts.userId, f.userId)),
    ).toHaveLength(0);
    for (const principal of [
      { ...f.principal, userId: randomUUID() },
      { ...f.principal, authorizationConnectionId: randomUUID() },
    ])
      await expect(evidence.readRunEvidence(principal, f.run.id, input)).rejects.toBeDefined();
    const [unrelated] = await database.db
      .insert(accessTokens)
      .values({
        userId: f.userId,
        name: "Unproven historical token",
        tokenHash: randomUUID(),
        clientId: f.token.clientId,
        audience: f.token.audience,
        authorizationConnectionId: f.connection,
        scopes: [...f.scopes],
      })
      .returning();
    if (!unrelated) throw new Error("token");
    await expect(
      evidence.readRunEvidence({ ...f.principal, actorId: unrelated.id }, f.run.id, input),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(accessTokens.id, f.principal.actorId));
    await expect(evidence.readRunEvidence(f.principal, f.run.id, input)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("retains uniquely latest historical proof only without any generated proof; historical ties fail closed and never get backfilled", async () => {
    const f = await fixture(true, false);
    const stamp = new Date();
    const fields = {
      userId: f.userId,
      automationScheduleId: f.scheduleId,
      authorizationConnectionId: f.connection,
      protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
      nonceDigest: "legacy-fixture",
      challengeText: "legacy-private",
      createdAt: stamp,
      expiresAt: new Date(stamp.getTime() + 600000),
    };
    const [one] = await database.db
      .insert(financeConversationCapabilities)
      .values({
        ...fields,
        fetchedAt: stamp,
        acknowledgedAt: stamp,
        respondedAt: stamp,
        verifiedAt: stamp,
        response: "Real historical verified fixture",
      })
      .returning();
    if (!one) throw new Error("legacy proof");
    const read = () =>
      database.db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, f.userId, { runIds: [f.run.id] });
        return getCurrentFinanceExecutionProof(tx, f.userId, f.scheduleId, f.connection);
      });
    expect((await read())?.id).toBe(one.id);
    await database.db.insert(financeConversationCapabilities).values(fields);
    expect(await read()).toBeNull();
    const [generated] = await database.db
      .insert(financeConversationCapabilities)
      .values({ ...fields, createdAt: new Date(stamp.getTime() - 1000000), generation: 1n })
      .returning();
    if (!generated) throw new Error("generated proof");
    expect(await read()).toMatchObject({ id: generated.id, generation: 1n, verifiedAt: null });
    await expect(
      database.db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, f.userId, { runIds: [f.run.id] });
        return requireCurrentFinanceExecutionProof(tx, f.userId, f.scheduleId, f.connection);
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await database.db
        .select()
        .from(financeConversationCapabilities)
        .where(
          and(
            eq(financeConversationCapabilities.userId, f.userId),
            eq(financeConversationCapabilities.id, one.id),
          ),
        ),
    ).toMatchObject([{ generation: null }]);
  });
  it("serializes concurrent issue generations, blocks old verified eligibility, and denies mutation/deletion/overflow", async () => {
    const f = await successorFixture();
    const conversation = createFinanceConversationService({ db: database.db });
    const human = {
      userId: f.userId,
      actorId: f.userId,
      actorType: "user" as const,
      scopes: new Set(f.scopes),
    };
    const [one, two] = await Promise.all([
      conversation.issueChallenge(human, f.scheduleId),
      conversation.issueChallenge(human, f.scheduleId),
    ]);
    const rows = await database.db
      .select()
      .from(financeConversationCapabilities)
      .where(eq(financeConversationCapabilities.userId, f.userId));
    expect(rows.map((row) => row.generation?.toString()).sort()).toEqual(["1", "2", "3"]);
    await expect(
      database.db
        .update(financeConversationCapabilities)
        .set({ generation: 100n })
        .where(eq(financeConversationCapabilities.id, one.challengeId)),
    ).rejects.toBeDefined();
    await expect(
      database.db
        .delete(financeConversationCapabilities)
        .where(eq(financeConversationCapabilities.id, two.challengeId)),
    ).rejects.toBeDefined();
    expect((await conversation.getReadiness(f.userId)).canSend).toBe(false);
    expect(
      await database.db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, f.userId, { runIds: [f.run.id] });
        return hasUsableFinanceConversationConsumer(tx, f.run, f.principal, new Date());
      }),
    ).toBe(false);
    await database.db.insert(financeConversationCapabilities).values({
      userId: f.userId,
      automationScheduleId: f.scheduleId,
      authorizationConnectionId: f.connection,
      protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
      generation: 9223372036854775807n,
      nonceDigest: "max-fixture",
      challengeText: "private",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 600000),
    });
    await expect(conversation.issueChallenge(human, f.scheduleId)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      await database.db
        .select()
        .from(financeConversationCapabilities)
        .where(eq(financeConversationCapabilities.userId, f.userId)),
    ).toHaveLength(4);
    await database.db.delete(users).where(eq(users.id, f.userId));
    expect(
      await database.db
        .select()
        .from(financeConversationCapabilities)
        .where(eq(financeConversationCapabilities.userId, f.userId)),
    ).toHaveLength(0);
  });

  it("fails closed on an immutable original binding protocol mismatch for observation, adoption and receipt inspection", async () => {
    const f = await successorFixture(false, true);
    await database.db.insert(financeMaintenanceExecutionBindings).values({
      userId: f.userId,
      runId: f.run.id,
      candidateId: f.candidate.id,
      candidateRevision: f.candidate.revision,
      submittedFromRevision: f.input.submittedFromRevision,
      submissionFingerprint: f.input.fingerprint,
      originalActorId: f.token.id,
      currentActorId: f.token.id,
      bindingRevision: 1n,
      authorizationConnectionId: f.connection,
      automationScheduleId: f.scheduleId,
      protocolVersion: "unsupported-test-protocol",
      createdAt: f.input.at,
      updatedAt: f.input.at,
    });
    await expect(
      f.service.readMaintenanceExecutionAuthorization(f.principal, f.run.id),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "The original candidate protocol version changed.",
    });
    await expect(
      f.service.refreshMaintenanceExecutionAuthorization(f.principal, f.run.id, f.command),
    ).rejects.toMatchObject({ code: "forbidden" });
    const evidence = createFinanceConversationEvidenceService({
      db: database.db,
      cursorSecret: "recovery-test",
    });
    await expect(
      evidence.readRunEvidence(f.principal, f.run.id, {
        candidateId: f.candidate.id,
        candidateRevision: f.candidate.revision,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      database.db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, f.userId, {
          runIds: [f.run.id],
          actorIds: [f.principal.actorId],
        });
        return loadCandidateExecutionPrincipal(
          tx,
          f.run,
          f.candidate.id,
          f.candidate.revision,
          f.principal,
          { requireExecution: true },
        );
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "The original candidate protocol version changed.",
    });
    expect(f.effectApplications).toHaveBeenCalledTimes(1);
  });
});
