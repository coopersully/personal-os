import { createHash, randomUUID } from "node:crypto";
import { createApiClient } from "@personal-os/api-client";
import {
  accessTokens,
  financeLedgerChallenges,
  financeMaintenanceCandidates,
  financeMaintenanceExecutionBindings,
  financeMaintenanceExecutionReceipts,
  financeMutationRecords,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  FINANCE_CONVERSATION_PROTOCOL_VERSION,
  financeLedgerChallengePageSchema,
  financeMaintenanceExecutionObservationSchema,
  financeMaintenanceExecutionRefreshResultSchema,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { createAuthService } from "../../apps/api/src/auth-service.js";
import { createFinanceService } from "../../apps/api/src/finance-service.js";
import { createOAuthService } from "../../apps/api/src/oauth-service.js";
import { createWorkspaceMaintenanceService } from "../../apps/api/src/workspace-maintenance-service.js";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

type Agent = Awaited<ReturnType<WorkspaceFixture["connectAgent"]>>;
const scopes = [
  "finances:read",
  "finances:maintain",
  "finances:write",
  "finances:execute",
] as const;

/** Authored only. Real HTTP authentication, MCP transport, OAuth rotation and challenge submission.
 * The scheduler boundary uses its actual claim/release service; dispatcher progression is separate.
 */
describe("candidate execution authorization through authenticated HTTP and MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
    // Recovery checks the database's actual clock. Do not extend or forge OAuth token expiry.
    f.advanceTime(Date.now() - new Date("2026-10-11T15:00:00Z").getTime());
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });

  async function call(agent: Agent, name: string, args: Record<string, unknown>) {
    const response = await agent.client.callTool({ name, arguments: args });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return (response.structuredContent as { result: unknown }).result;
  }

  it("initializes only at real submit, persists claim-pending, adopts a canonical successor once and rejects lost grants", async () => {
    await f.setBypass(true);
    const oauth = createOAuthService({
      db: f.db,
      now: () => new Date(),
      resource: `${f.config.apiBaseUrl}/mcp`,
    });
    const redirectUri = "http://127.0.0.1:4312/callback";
    const client = await oauth.registerClient("Recovery transport", [redirectUri]);
    const verifier = "v".repeat(64);
    const code = await oauth.authorize({
      userId: f.owner.id,
      clientId: client.client_id,
      redirectUri,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      scopes: [...scopes],
    });
    const issued = await oauth.exchangeCode({
      clientId: client.client_id,
      redirectUri,
      code,
      codeVerifier: verifier,
      resource: `${f.config.apiBaseUrl}/mcp`,
    });
    const original = await f.connectAgent([...scopes], {
      credentialKind: "oauth",
      clientId: client.client_id,
      oauthToken: issued.access_token,
      refreshToken: issued.refresh_token,
    });
    const auth = createAuthService({
      db: f.db,
      now: () => new Date(),
      sessionTtlDays: 30,
      registrationMode: "open",
    });
    const session = await auth.login(
      { email: f.owner.email, password: "FixtureOnly123!" },
      { ipAddress: null, userAgent: "test" },
    );
    const human = createApiClient({
      baseUrl: f.config.apiBaseUrl,
      sessionToken: session.token,
      fetch: async (input, init) => f.app.request(new Request(input, init)),
    });
    const [connection] = await original.api.listAutomationHostConnections();
    if (!connection) throw new Error("Missing canonical OAuth connection.");
    const created = await original.api.createAutomationHostSchedule({
      tenantAuthorizationConnectionId: connection.id,
      label: "Recovery transport host",
      requestedScopes: ["finances:maintain"],
      hostSurface: "codex_desktop",
      trigger: {
        type: "recurring",
        recurrence: { type: "interval", everyMinutes: 5, timeZone: "America/New_York" },
      },
    });
    await original.api.bindAutomationHostSchedule(created.schedule.id, {
      hostSurface: "codex_desktop",
      expectedVersion: created.schedule.version,
      expectedState: "setup_pending",
      hostAutomationId: "recovery-transport-host",
      nextExpectedAt: new Date(Date.now() + 300_000).toISOString(),
    });
    const proof = await human.issueFinanceConversationChallenge(created.schedule.id);
    const fetched = (await call(original, "exchange_finance_conversation_challenge", {
      challengeId: proof.challengeId,
      operation: { kind: "fetch" },
    })) as { nonce: string };
    expect(typeof fetched.nonce).toBe("string");
    await call(original, "exchange_finance_conversation_challenge", {
      challengeId: proof.challengeId,
      operation: { kind: "acknowledge", challengeId: proof.challengeId, nonce: fetched.nonce },
    });
    await call(original, "exchange_finance_conversation_challenge", {
      challengeId: proof.challengeId,
      operation: { kind: "respond", challengeId: proof.challengeId, response: "Protocol works." },
    });
    expect(await human.getFinanceConversationReadiness()).toMatchObject({ canSend: true });

    const finances = createFinanceService({ db: f.db, now: () => new Date() });
    const scope = { type: "all_outstanding" as const };
    const snapshot = await finances.maintenanceCandidateSnapshot(f.owner.id, scope, [], null);
    const candidateId = randomUUID();
    // Prepared packet fixture only. No execution binding, adoption receipt or lineage is inserted.
    const [run] = await f.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: f.owner.id,
        domain: "finances",
        scope,
        rulebookVersion: "recovery-transport",
        status: "awaiting_agent_challenge",
        checkpoint: { candidateId, phase: "challenge", revision: snapshot.revision },
        automationScheduleId: created.schedule.id,
        authorizationConnectionId: connection.id,
      })
      .returning();
    if (!run) throw new Error("Missing prepared run.");
    await f.db.insert(financeMaintenanceCandidates).values({
      id: candidateId,
      userId: f.owner.id,
      runId: run.id,
      revision: snapshot.revision,
      projection: snapshot.projection,
      state: "ready_for_challenge",
    });
    const [challenge] = await f.db
      .insert(financeLedgerChallenges)
      .values({
        userId: f.owner.id,
        runId: run.id,
        candidateId,
        candidateRevision: snapshot.revision,
        cutoff: new Date(),
        rubricVersion: "finance-ledger-challenge-v1",
      })
      .returning();
    if (!challenge) throw new Error("Missing prepared challenge.");
    expect(await original.api.getFinanceMaintenanceExecutionAuthorization(run.id)).toEqual({
      state: "unavailable",
      reason: "binding_unavailable",
    });
    const page = financeLedgerChallengePageSchema.parse(
      await call(original, "get_finance_ledger_challenge", { challengeId: challenge.id }),
    );
    expect(page.items).toEqual([]);
    const submission = {
      challengeId: challenge.id,
      candidateRevision: page.challenge.candidateRevision,
      rubricVersion: page.challenge.rubricVersion,
      checked: page.checks,
      reviewedItemIds: [],
      findings: [],
    };
    const submitted = await call(original, "submit_finance_ledger_challenge", submission);
    expect(await call(original, "submit_finance_ledger_challenge", submission)).toEqual(submitted);
    const bindings = await f.db
      .select()
      .from(financeMaintenanceExecutionBindings)
      .where(eq(financeMaintenanceExecutionBindings.candidateId, candidateId));
    expect(bindings).toHaveLength(1);
    const binding = bindings[0];
    if (!binding) throw new Error("Real challenge submission did not initialize its binding.");
    expect(binding).toMatchObject({
      originalActorId: original.credential.id,
      currentActorId: original.credential.id,
      bindingRevision: 1n,
      submittedFromRevision: submission.candidateRevision,
      protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
    });
    const rotated = await oauth.refresh({
      clientId: client.client_id,
      refreshToken: issued.refresh_token,
      resource: `${f.config.apiBaseUrl}/mcp`,
    });
    const successor = await f.connectAgent([...scopes], {
      credentialKind: "oauth",
      clientId: client.client_id,
      oauthToken: rotated.access_token,
      refreshToken: rotated.refresh_token,
    });
    expect(successor.credential.id).not.toBe(original.credential.id);
    const maintenance = createWorkspaceMaintenanceService({ db: f.db, now: () => new Date() });
    const claim = await maintenance.claim(run.id);
    if (!claim) throw new Error("Submitted run was not claimable.");
    const observed = financeMaintenanceExecutionObservationSchema.parse(
      await call(successor, "get_finance_maintenance_execution_authorization", { runId: run.id }),
    );
    if (observed.state !== "available") throw new Error("Missing successor CAS observation.");
    expect(observed).toMatchObject({
      currentActorId: original.credential.id,
      bindingRevision: "1",
    });
    const pendingInput = {
      operationId: randomUUID(),
      candidateId,
      candidateRevision: observed.candidateRevision,
      expectedCurrentActorId: observed.currentActorId,
      expectedBindingRevision: observed.bindingRevision,
      expectedRunUpdatedAt: observed.runUpdatedAt,
    };
    const pending = financeMaintenanceExecutionRefreshResultSchema.parse(
      await call(successor, "refresh_finance_maintenance_execution_authorization", {
        runId: run.id,
        ...pendingInput,
      }),
    );
    expect(pending).toMatchObject({ state: "pending", reason: "active_claim" });
    expect(
      await successor.api.refreshFinanceMaintenanceExecutionAuthorization(run.id, pendingInput),
    ).toEqual(pending);
    // Actual server scheduler claim/release boundary. No economic dispatcher is invoked here.
    await maintenance.checkpointAndRelease({
      runId: run.id,
      claimId: claim.claimId,
      status: "awaiting_agent_challenge",
      checkpoint: { candidateId, revision: binding.candidateRevision, phase: "challenge" },
    });
    expect(
      await call(successor, "refresh_finance_maintenance_execution_authorization", {
        runId: run.id,
        ...pendingInput,
      }),
    ).toEqual(pending);
    expect(await f.db.select().from(financeMaintenanceExecutionReceipts)).toHaveLength(0);
    const fresh = await successor.api.getFinanceMaintenanceExecutionAuthorization(run.id);
    if (fresh.state !== "available") throw new Error("Missing fresh unleased observation.");
    const adoption = {
      ...pendingInput,
      operationId: randomUUID(),
      expectedRunUpdatedAt: fresh.runUpdatedAt,
    };
    const refreshed = financeMaintenanceExecutionRefreshResultSchema.parse(
      await call(successor, "refresh_finance_maintenance_execution_authorization", {
        runId: run.id,
        ...adoption,
      }),
    );
    expect(refreshed).toMatchObject({
      state: "refreshed",
      bindingId: binding.id,
      bindingRevision: "2",
      currentActorId: successor.credential.id,
    });
    expect(
      await successor.api.refreshFinanceMaintenanceExecutionAuthorization(run.id, adoption),
    ).toEqual(refreshed);
    expect(
      await call(successor, "refresh_finance_maintenance_execution_authorization", {
        runId: run.id,
        ...adoption,
      }),
    ).toEqual(refreshed);
    expect(await f.db.select().from(financeMaintenanceExecutionReceipts)).toHaveLength(1);
    expect(
      await f.db.query.financeMaintenanceExecutionBindings.findFirst({
        where: eq(financeMaintenanceExecutionBindings.id, binding.id),
      }),
    ).toMatchObject({
      originalActorId: original.credential.id,
      currentActorId: successor.credential.id,
      bindingRevision: 2n,
    });
    const commands = await f.db
      .select()
      .from(financeMutationRecords)
      .where(
        and(
          eq(financeMutationRecords.userId, f.owner.id),
          eq(financeMutationRecords.operation, "refresh_finance_maintenance_execution_v1"),
        ),
      );
    expect(commands).toHaveLength(2);
    expect(commands.every((row) => row.status === "completed")).toBe(true);
    expect(
      await f.db
        .select()
        .from(financeMutationRecords)
        .where(eq(financeMutationRecords.operation, "commit_finance_candidate_effect_v1")),
    ).toHaveLength(0);

    const foreign = await f.connectAgent([...scopes], {
      credentialKind: "oauth",
      ownerId: f.otherOwner.id,
    });
    const wrongConnection = await f.connectAgent([...scopes], { credentialKind: "oauth" });
    for (const denied of [foreign, wrongConnection]) {
      await expect(
        denied.api.getFinanceMaintenanceExecutionAuthorization(run.id),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (
          await denied.client.callTool({
            name: "refresh_finance_maintenance_execution_authorization",
            arguments: { runId: run.id, ...adoption, operationId: randomUUID() },
          })
        ).isError,
      ).toBe(true);
    }
    // A cached MCP scope inventory cannot preserve authority after the actual grant loses execute.
    await f.db
      .update(accessTokens)
      .set({ scopes: ["finances:read", "finances:maintain", "finances:write"] })
      .where(eq(accessTokens.id, successor.credential.id));
    await expect(
      successor.api.getFinanceMaintenanceExecutionAuthorization(run.id),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await successor.client.callTool({
          name: "refresh_finance_maintenance_execution_authorization",
          arguments: { runId: run.id, ...adoption },
        })
      ).isError,
    ).toBe(true);
    await successor.revoke();
    await expect(
      successor.api.getFinanceMaintenanceExecutionAuthorization(run.id),
    ).rejects.toMatchObject({ status: 401 });
    expect(await f.db.select().from(financeMaintenanceExecutionReceipts)).toHaveLength(1);
  });
});
