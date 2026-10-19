import { createApiClient } from "@personal-os/api-client";
import { financeConversationReadCursors, workspaceMaintenanceRuns } from "@personal-os/database";
import { eq, sql } from "drizzle-orm";
import { createAuthService } from "../../apps/api/src/auth-service.js";
import {
  captureFinanceConversationBatch,
  postgresConversationBatchStore,
} from "../../apps/api/src/finance/conversation-service.js";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

/** Actual authenticated HTTP/MCP transport. Canonical run creation is covered by the core suite. */
describe("verified Finance conversation transport", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("keeps delivery, human reads, proof and original connection authority distinct", async () => {
    await f.setBypass(true);
    const auth = createAuthService({
      db: f.db,
      now: () => new Date("2026-10-11T15:00:00Z"),
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
    const scopes = [
      "finances:read",
      "finances:maintain",
      "finances:write",
      "finances:execute",
    ] as const;
    const a = await f.connectAgent([...scopes], { credentialKind: "oauth" });
    const b = await f.connectAgent([...scopes]);
    const other = await f.connectAgent([...scopes], { ownerId: f.otherOwner.id });
    const [connection] = await a.api.listAutomationHostConnections();
    if (!connection) throw new Error("Missing host connection.");
    const created = await a.api.createAutomationHostSchedule({
      tenantAuthorizationConnectionId: connection.id,
      label: "Conversation host",
      requestedScopes: ["finances:maintain"],
      hostSurface: "codex_desktop",
      trigger: {
        type: "recurring",
        recurrence: { type: "interval", everyMinutes: 5, timeZone: "America/New_York" },
      },
    });
    await a.api.bindAutomationHostSchedule(created.schedule.id, {
      hostSurface: "codex_desktop",
      expectedVersion: created.schedule.version,
      expectedState: "setup_pending",
      hostAutomationId: "actual-fixture-host",
      nextExpectedAt: "2026-10-11T15:05:00Z",
    });
    expect(await human.getFinanceConversationReadiness()).toMatchObject({ canSend: false });
    await expect(a.api.getFinanceConversationHistory()).rejects.toMatchObject({ status: 403 });
    const challenge = await human.issueFinanceConversationChallenge(created.schedule.id);
    async function call(name: string, args: Record<string, unknown>) {
      const response = await a.client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      return (response.structuredContent as { result: Record<string, unknown> }).result;
    }
    const onboarding = await call("get_finance_onboarding", {});
    if (typeof onboarding.revision !== "number") throw new Error("Missing onboarding revision.");
    const reviewInput = {
      expectedRevision: onboarding.revision,
      idempotencyKey: "actual-onboarding-review",
      answers: [],
      displayPreferencesReviewed: false,
      automationChoice: "later",
    };
    const reviewed = await call("save_finance_onboarding_answers", reviewInput);
    expect(reviewed.completedAt).toBeNull();
    expect(await call("save_finance_onboarding_answers", reviewInput)).toEqual(reviewed);
    if (typeof reviewed.revision !== "number") throw new Error("Missing saved revision.");
    const incomplete = await a.client.callTool({
      name: "complete_finance_onboarding",
      arguments: {
        expectedRevision: reviewed.revision,
        idempotencyKey: "incomplete-onboarding",
        automationChoice: "later",
      },
    });
    expect(incomplete.isError).toBe(true);
    const fetched = await call("exchange_finance_conversation_challenge", {
      challengeId: challenge.challengeId,
      operation: { kind: "fetch" },
    });
    if (typeof fetched.nonce !== "string") throw new Error("Missing actual fetched nonce.");
    await call("exchange_finance_conversation_challenge", {
      challengeId: challenge.challengeId,
      operation: { kind: "acknowledge", challengeId: challenge.challengeId, nonce: fetched.nonce },
    });
    await call("exchange_finance_conversation_challenge", {
      challengeId: challenge.challengeId,
      operation: {
        kind: "respond",
        challengeId: challenge.challengeId,
        response: "Harmless message protocol response",
      },
    });
    expect(await human.getFinanceConversationReadiness()).toMatchObject({ canSend: true });
    expect(await human.getFinanceConversationHostReadiness(created.schedule.id)).toMatchObject({
      canSend: true,
    });
    await expect(human.getFinanceConversationHostReadiness(f.otherOwner.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await human.getFinanceConversationHistory()).messages).toHaveLength(0);
    const first = await human.sendFinanceConversationMessage({
      text: "First context",
      idempotencyKey: "first-context",
      caseId: null,
      recordRefs: [],
    });
    const second = await human.sendFinanceConversationMessage({
      text: "Undelivered second page",
      idempotencyKey: "second-context",
      caseId: null,
      recordRefs: [],
    });
    const [run] = await f.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: f.owner.id,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "conversation-transport-fixture",
        automationScheduleId: created.schedule.id,
        authorizationConnectionId: connection.id,
      })
      .returning();
    if (!run) throw new Error("Missing canonical run fixture.");
    await f.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`finance-maintenance:${f.owner.id}`}, 0))`,
      );
      await captureFinanceConversationBatch({
        tx,
        store: postgresConversationBatchStore,
        userId: f.owner.id,
        runId: run.id,
        automationScheduleId: created.schedule.id,
        authorizationConnectionId: connection.id,
        now: new Date("2026-10-11T15:00:00Z"),
      });
    });
    expect(
      await call("get_finance_maintenance_execution_authorization", { runId: run.id }),
    ).toEqual({ state: "unavailable", reason: "binding_unavailable" });
    const recoveryInput = {
      runId: run.id,
      operationId: first.id,
      candidateId: first.id,
      candidateRevision: `sha256:${"a".repeat(64)}`,
      expectedCurrentActorId: a.credential.id,
      expectedBindingRevision: "1",
      expectedRunUpdatedAt: run.updatedAt.toISOString(),
    };
    const blockedRecovery = await call(
      "refresh_finance_maintenance_execution_authorization",
      recoveryInput,
    );
    expect(blockedRecovery).toMatchObject({
      state: "blocked",
      reason: "binding_unavailable",
      operationId: first.id,
    });
    expect(
      await call("refresh_finance_maintenance_execution_authorization", recoveryInput),
    ).toEqual(blockedRecovery);
    for (const alien of [b, other]) {
      for (const name of [
        "get_finance_maintenance_execution_authorization",
        "refresh_finance_maintenance_execution_authorization",
      ]) {
        expect(
          (
            await alien.client.callTool({
              name,
              arguments: name.startsWith("get_") ? { runId: run.id } : recoveryInput,
            })
          ).isError,
        ).toBe(true);
      }
    }
    const forgedRecovery = await a.client.callTool({
      name: "refresh_finance_maintenance_execution_authorization",
      arguments: { ...recoveryInput, claimId: run.id },
    });
    expect(forgedRecovery.isError).toBe(true);
    const evidenceInput = {
      runId: run.id,
      candidateId: first.id,
      candidateRevision: `sha256:${"a".repeat(64)}`,
    };
    expect(await call("get_finance_conversation_evidence", evidenceInput)).toEqual({
      state: "unavailable",
      reason: "no_committed_effect_receipt",
    });
    for (const alien of [b, other]) {
      const deniedEvidence = await alien.client.callTool({
        name: "get_finance_conversation_evidence",
        arguments: evidenceInput,
      });
      expect(deniedEvidence.isError).toBe(true);
    }
    const later = await human.sendFinanceConversationMessage({
      text: "Next run only",
      idempotencyKey: "later-context",
      caseId: null,
      recordRefs: [],
    });
    const premature = await a.client.callTool({
      name: "reply_to_finance_conversation_batch",
      arguments: {
        runId: run.id,
        text: "Not delivered yet",
        idempotencyKey: "premature-reply",
        sourceMessageIds: [first.id],
        caseId: null,
      },
    });
    expect(premature.isError).toBe(true);
    expect((await human.getFinanceConversationHistory()).messages).toHaveLength(3);
    const page = await call("get_finance_conversation_batch", { runId: run.id, limit: 1 });
    expect(page).toMatchObject({ messages: [{ id: first.id }], nextCursor: expect.any(String) });
    const undelivered = await a.client.callTool({
      name: "reply_to_finance_conversation_batch",
      arguments: {
        runId: run.id,
        text: "Second page not delivered",
        idempotencyKey: "undelivered-page",
        sourceMessageIds: [second.id],
        caseId: null,
      },
    });
    expect(undelivered.isError).toBe(true);
    expect((await human.getFinanceConversationHistory()).messages).toHaveLength(3);
    await call("acknowledge_finance_conversation_batch", { runId: run.id, messageIds: [first.id] });
    expect(
      await f.db
        .select()
        .from(financeConversationReadCursors)
        .where(eq(financeConversationReadCursors.userId, f.owner.id)),
    ).toHaveLength(0);
    const guessed = await a.client.callTool({
      name: "acknowledge_finance_conversation_batch",
      arguments: { runId: run.id, messageIds: [later.id] },
    });
    expect(guessed.isError).toBe(true);
    const replyInput = {
      runId: run.id,
      text: "Reply to first context",
      idempotencyKey: "causal-reply",
      sourceMessageIds: [first.id],
      caseId: null,
    };
    const reply = await call("reply_to_finance_conversation_batch", replyInput);
    expect(await call("reply_to_finance_conversation_batch", replyInput)).toEqual(reply);
    for (const alien of [b, other]) {
      const denied = await alien.client.callTool({
        name: "get_finance_conversation_batch",
        arguments: { runId: run.id },
      });
      expect(denied.isError).toBe(true);
    }
    const readOnly = await f.connectAgent([...scopes], { readOnly: true });
    expect(
      (await readOnly.client.listTools()).tools.some(
        (tool) => tool.name === "get_finance_conversation_batch",
      ),
    ).toBe(false);
    await human.markFinanceConversationRendered(first.sequence);
    expect(
      (
        await f.db
          .select()
          .from(financeConversationReadCursors)
          .where(eq(financeConversationReadCursors.userId, f.owner.id))
      )[0]?.readThroughSequence.toString(),
    ).toBe(first.sequence);
    for (const name of [
      "get_finance_maintenance_execution_authorization",
      "refresh_finance_maintenance_execution_authorization",
    ]) {
      expect((await readOnly.client.listTools()).tools.some((tool) => tool.name === name)).toBe(
        name.startsWith("get_"),
      );
    }
    await a.revoke();
    expect(
      (
        await a.client.callTool({
          name: "get_finance_conversation_batch",
          arguments: { runId: run.id },
        })
      ).isError,
    ).toBe(true);
    expect(await human.getFinanceConversationReadiness()).toMatchObject({ canSend: false });
    const history = await human.getFinanceConversationHistory();
    expect(history.messages.map((message) => message.id)).toEqual([
      first.id,
      second.id,
      later.id,
      reply.id,
    ]);
  });
});
