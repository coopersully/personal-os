import { randomUUID } from "node:crypto";
import {
  accessTokens,
  automationHostSchedules,
  financeAccounts,
  financeConversationMessages,
  financeTransactions,
  nativePushEvents,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  automationHostScheduleSchema,
  type FinanceBudgetReadResult,
  type FinanceBudgetVersion,
  type FinanceConversationMessage,
  type FinanceConversationTurnPage,
  type FinanceToolResult,
} from "@personal-os/domain";
import { eq } from "drizzle-orm";
import { createMcpWorkspaceFixture } from "./fixture.js";
import { connectHumanFinanceClient } from "./human-finance.js";

it("budgets through the original host and owner Chat flow, preserves history and discovers next-month work", async () => {
  const f = await createMcpWorkspaceFixture();
  let instant = new Date("2026-10-11T15:00:00Z");
  const advance = (iso: string) => {
    const next = new Date(iso);
    f.advanceTime(next.getTime() - instant.getTime());
    instant = next;
  };
  try {
    advance("2026-11-12T17:00:00Z");
    const human = await connectHumanFinanceClient(f);
    const scopes = ["finances:read", "finances:write", "finances:maintain", "finances:execute"] as const;
    await f.setBypass(true);
    const agent = await f.connectAgent([...scopes]);
    const connectionId = randomUUID(),
      scheduleId = randomUUID();
    await f.db
      .update(accessTokens)
      .set({ authorizationConnectionId: connectionId })
      .where(eq(accessTokens.id, agent.credential.id));
    const stamp = instant.toISOString();
    await f.db.insert(automationHostSchedules).values({
      id: scheduleId,
      userId: f.owner.id,
      authorizationConnectionId: connectionId,
      schedule: automationHostScheduleSchema.parse({
        id: scheduleId,
        tenantAuthorizationConnectionId: connectionId,
        hostSurface: "codex_desktop",
        hostAutomationId: "synthetic-monthly-host",
        label: "Synthetic monthly host",
        effectiveScopes: [...scopes],
        trigger: {
          type: "recurring",
          recurrence: { type: "interval", everyMinutes: 120, timeZone: "America/New_York" },
        },
        state: "active",
        lastObservedAt: stamp,
        nextExpectedAt: stamp,
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      }),
    });
    async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const result = await agent.client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const structured = result.structuredContent as Record<string, unknown>;
      return ("result" in structured ? structured.result : structured) as T;
    }
    const [account] = await f.db
      .insert(financeAccounts)
      .values({
        userId: f.owner.id,
        institution: "Synthetic Bank",
        name: "Checking",
        provider: "manual",
        status: "manual",
        currencyCode: "USD",
        ownershipType: "individual",
        ownershipShareBps: 10000,
        includeInPlanning: true,
      })
      .returning();
    if (!account) throw new Error("Missing account");
    await f.db.insert(financeTransactions).values({
      userId: f.owner.id,
      accountId: account.id,
      merchant: "Independent October purchase",
      amount: 1000,
      direction: "expense",
      transactionDate: "2026-10-20",
      needsReview: true,
    });
    await human.confirmFinanceOpeningStatement({
      accountId: account.id,
      month: "2026-11",
      expectedAccountRevision: account.contextualRevision.toString(),
      expectedStatementRevision: 0,
      signedOpeningBalanceCents: 100000,
      idempotencyKey: "november-opening",
    });
    const preview = await agent.api.previewFinanceBudgetStart({
      firstMonth: "2026-11",
      expectedPolicyRevision: 0,
      idempotencyKey: "november-start",
    });
    await human.applyFinanceBudgetStart({
      previewId: preview.id,
      fingerprint: preview.fingerprint,
    });
    const [old] = await f.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: f.owner.id,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "synthetic-old-rulebook",
        status: "blocked",
        settledResult: { code: "historical_source_missing" },
      })
      .returning();
    if (!old) throw new Error("Missing historical run");

    const planning = await call<FinanceBudgetReadResult>("get_finance_budget", {
      month: "2026-11",
    });
    const proposal = await call<FinanceToolResult<FinanceBudgetVersion>>("create_finance_budget", {
      name: "November",
      effectiveFrom: "2026-11",
      expectedInputFingerprint: planning.planningInputs?.fingerprint,
      resources: [{ key: "Expected pay", kind: "income", amount: 1000, sourceId: account.id }],
      allocations: [{ key: "Buffer", kind: "buffer", amount: 1000 }],
      assumptions: ["The owner expects $1,000 of pay this month; this is not received cash."],
      rationale: "Reserve expected income until spending is planned.",
      idempotencyKey: "november-proposal",
    });
    const card = {
      text: "Review November’s expected funding and plan here.",
      idempotencyKey: "november-card",
      recordRefs: [
        { kind: "budget_plan", id: proposal.data.planId, budgetVersionId: proposal.data.id },
      ],
    };
    const first = await call<FinanceConversationMessage>("publish_finance_chat_card", card);
    expect((await call<FinanceConversationMessage>("publish_finance_chat_card", card)).id).toBe(
      first.id,
    );
    await expect(
      agent.api.approveFinanceBudget({
        budgetVersionId: proposal.data.id,
        expectedVersion: proposal.data.version,
        approvalSource: "agent_self_approval",
        confirmExpectedResources: true,
        idempotencyKey: "not-owner",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const approval = {
      budgetVersionId: proposal.data.id,
      expectedVersion: proposal.data.version,
      expectedProfileVersionId: proposal.data.profileVersionId ?? null,
      approvalSource: "user_instruction" as const,
      confirmExpectedResources: true,
      idempotencyKey: "owner-november",
    };
    const accepted = await human.approveFinanceBudget(approval);
    expect(await human.approveFinanceBudget(approval)).toEqual(accepted);
    expect(accepted.data.resourcesConfirmed).toBe(true);
    expect(await agent.api.getFinanceAttention()).toMatchObject({
      activeDecisionCount: 0,
      historicalRecordCount: 1,
      budgetReady: true,
    });

    // The same original host handles conversation even while its old financial run is blocked.
    const challenge = await human.issueFinanceConversationChallenge(scheduleId);
    const fetched = await agent.api.exchangeFinanceConversationChallenge(challenge.challengeId, {
      kind: "fetch",
    });
    if (!fetched.nonce) throw new Error("Missing challenge nonce");
    await agent.api.exchangeFinanceConversationChallenge(challenge.challengeId, {
      kind: "acknowledge",
      challengeId: challenge.challengeId,
      nonce: fetched.nonce,
    });
    await agent.api.exchangeFinanceConversationChallenge(challenge.challengeId, {
      kind: "respond",
      challengeId: challenge.challengeId,
      response: "Synthetic Finance chat ready",
    });
    const message = await human.sendFinanceConversationMessage({
      text: "Is November ready now?",
      recordRefs: [],
      idempotencyKey: "owner-question",
      caseId: null,
    });
    const turn = await call<FinanceConversationTurnPage>("begin_finance_conversation_turn", {
      scheduleId,
    });
    expect(turn.messages.map((item) => item.id)).toContain(message.id);
    if (!turn.turn) throw new Error("Missing turn");
    await call("acknowledge_finance_conversation_turn", {
      turnId: turn.turn.id,
      messageIds: [message.id],
    });
    const priorPushes = await f.db
      .select()
      .from(nativePushEvents)
      .where(eq(nativePushEvents.userId, f.owner.id));
    const reply = {
      turnId: turn.turn.id,
      text: "November is budget-ready. Your older cleanup is separate.",
      sourceMessageIds: [message.id],
      caseId: null,
      idempotencyKey: "november-reply",
      recordRefs: card.recordRefs,
    };
    const replied = await call<FinanceConversationMessage>(
      "reply_to_finance_conversation_turn",
      reply,
    );
    expect(
      (await call<FinanceConversationMessage>("reply_to_finance_conversation_turn", reply)).id,
    ).toBe(replied.id);
    expect(replied.sourceMessageIds).toEqual([message.id]);
    expect(
      (await f.db.select().from(nativePushEvents).where(eq(nativePushEvents.userId, f.owner.id)))
        .length,
    ).toBe(priorPushes.length + 1);
    expect(
      (
        await f.db
          .select()
          .from(financeConversationMessages)
          .where(eq(financeConversationMessages.id, replied.id))
      ).length,
    ).toBe(1);

    advance("2026-12-01T13:00:00Z");
    const december = await call<FinanceBudgetReadResult>("get_finance_budget", {
      month: "2026-12",
    });
    expect(december.planningInputs?.month).toBe("2026-12");
    expect(december.planContext).toMatchObject({
      month: "2026-12",
      state: "missing",
      recovery: "create_proposal",
      previous: { id: proposal.data.id },
    });
    await f.db.insert(financeTransactions).values({
      userId: f.owner.id,
      accountId: account.id,
      merchant: "Late November purchase",
      amount: 2500,
      direction: "expense",
      transactionDate: "2026-11-30",
      needsReview: true,
    });
    expect(await agent.api.getFinanceAttention()).toMatchObject({
      period: "2026-12",
      activeTransactionCount: 1,
      historicalRecordCount: 1,
      processingCount: 1,
      budgetReady: false,
    });
    const maintained = await call<{
      data: { monthlyWork: { period: string; carryover: string }; run: { id: string } };
    }>("maintain_finances", { operation: "start", scope: { type: "all_outstanding" } });
    expect(maintained.data.monthlyWork).toMatchObject({ period: "2026-12", carryover: "none" });
    expect(maintained.data.run.id).toBe(old.id);
    expect(
      (
        await f.db
          .select()
          .from(workspaceMaintenanceRuns)
          .where(eq(workspaceMaintenanceRuns.id, old.id))
      )[0]?.settledResult,
    ).toEqual({ code: "historical_source_missing" });
  } finally {
    await f.close();
  }
}, 120_000);
