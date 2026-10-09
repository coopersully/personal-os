import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { TwilioConnector } from "@personal-os/connectors";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeAgentActionReviews,
  financeCategories,
  financeCategoryRules,
  financeContextRevisions,
  financeContexts,
  financeMutationRecords,
  financeSmsCompletions,
  financeTransactions,
  migrateDatabase,
  notificationPreferences,
  textInboundClaims,
  textingConnections,
  textMessages,
  textReplyBindings,
  users,
} from "@personal-os/database";
import { defaultNotificationPreferences } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceActionService } from "../finance-action-service.js";
import { createFinanceService } from "../finance-service.js";
import { createFinanceSmsAcknowledgementDispatcher } from "../finance-sms-acknowledgement.js";
import { createNotificationService } from "../notification-service.js";
import { encryptJson } from "../security.js";
import { createTextingRecoveryService } from "../texting-recovery-service.js";
import { bindInboundReply, createTextReplyBindings } from "../texting-reply-binding.js";
import { createTextingService } from "../texting-service.js";
import { createSmsAdmission, createSmsApprovalAdmission } from "../texting-sms-admission.js";
import type { Principal } from "../types.js";
import { createFinanceContextService } from "./context-service.js";
import { createFinanceSmsPort } from "./sms-answer-port.js";
import {
  createFinanceSmsApprovalService,
  resolveSmsApproval,
  smsCategorizationSummary,
} from "./sms-approval-service.js";
import { createFinanceSmsContextDispatcher } from "./sms-context-dispatcher.js";
import { resolveFinanceWorks } from "./work-resolver.js";

const encryptionKey = Buffer.alloc(32, 9).toString("base64");
const now = () => new Date("2026-10-09T15:00:00Z");
describe.sequential("signed Finance context SMS and durable completion", () => {
  let database: DatabaseClient;
  let container: StartedPostgreSqlContainer;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  beforeEach(async () => {
    await database.db.delete(users);
  });
  async function fixture(
    body = "Finance: Sam will reimburse my concert ticket next month",
    deferClaim = false,
  ) {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Context owner",
      passwordHash: "unused",
      planningTimezone: "America/New_York",
    });
    const [connection] = await database.db
      .insert(textingConnections)
      .values({
        userId,
        encryptedPhoneNumber: encryptJson({ e164: "+12125550123" }, encryptionKey),
        phoneFingerprint: userId,
        phoneLastFour: "0123",
        country: "US",
        state: "active",
        consentVersion: "test",
        verifiedAt: now(),
      })
      .returning();
    if (!connection) throw new Error("connection");
    const [message] = await database.db
      .insert(textMessages)
      .values({
        userId,
        connectionId: connection.id,
        direction: "inbound",
        body,
        status: "delivered",
        occurredAt: now(),
        occurredAtSource: "provider",
        providerMessageSid: `SM${randomUUID()}`,
      })
      .returning();
    if (!message) throw new Error("message");
    const claim = {
      id: randomUUID(),
      userId,
      connectionId: connection.id,
      messageId: message.id,
      consentEpoch: connection.consentEpoch,
    };
    if (!deferClaim) await database.db.insert(textInboundClaims).values(claim);
    return { userId, connection, message, claim };
  }
  const dispatch = (enabled: () => boolean = () => true) =>
    createFinanceSmsContextDispatcher({ db: database.db, enabled, now });
  function acknowledge(
    send = vi.fn(async () => ({ sid: `SM${randomUUID()}`, status: "queued" })),
    enabled: () => boolean = () => true,
    recovery: Pick<ReturnType<typeof createTextingRecoveryService>, "inspectClaim"> = {
      inspectClaim: async () => null,
    },
  ) {
    const texting = createTextingService({
      db: database.db,
      apiBaseUrl: "https://nohmi.test",
      enabled: true,
      encryptionKey,
      senderPhoneNumber: "+12125550124",
      now,
      twilio: { sendMessage: send } as unknown as TwilioConnector,
    });
    return {
      send,
      run: createFinanceSmsAcknowledgementDispatcher({
        db: database.db,
        recovery,
        texting,
        enabled,
        now,
      }),
    };
  }
  it.each([
    "\u200B",
    "\u200D",
    "\uFE0F",
    "paid\u0001",
  ])("terminalizes invalid context with one clarification and no financial evidence %j", async (text) => {
    await fixture(`Finance: ${text}`);
    const run = dispatch();
    await run();
    await run();
    await dispatch()();
    expect(await database.db.select().from(financeContexts)).toEqual([]);
    expect(await database.db.select().from(financeSmsCompletions)).toMatchObject([
      { disposition: "clarification_required", contextId: null },
    ]);
    const ack = acknowledge();
    await ack.run();
    await ack.run();
    expect(ack.send).toHaveBeenCalledTimes(1);
    expect(ack.send.mock.calls[0]?.[0].body).toContain("could not safely attach");
    expect(await database.db.select().from(financeMutationRecords)).toEqual([]);
  });
  it("captures verbatim prospective context once with SMS provenance and no inferred financial fields", async () => {
    const f = await fixture();
    const run = dispatch();
    await run();
    await run();
    await dispatch()();
    expect(await database.db.select().from(financeContexts)).toHaveLength(1);
    expect(await database.db.select().from(financeContextRevisions)).toMatchObject([
      {
        text: "Sam will reimburse my concert ticket next month",
        sourceKind: "sms",
        actorId: f.userId,
        requestId: f.message.id,
        operationId: f.claim.id,
        expectedCents: null,
        paymentChannel: null,
        validFrom: null,
        validThrough: null,
        participants: [],
        transactionIds: [],
      },
    ]);
    expect(await database.db.select().from(financeTransactions)).toHaveLength(0);
    expect(await database.db.select().from(financeSmsCompletions)).toMatchObject([
      { disposition: "context_captured", contextId: expect.any(String) },
    ]);
    const ack = acknowledge();
    await ack.run();
    await ack.run();
    await acknowledge(ack.send).run();
    expect(ack.send).toHaveBeenCalledTimes(1);
    const messages = await database.db.select().from(textMessages);
    expect(messages.find((item) => item.direction === "outbound")?.body).toContain(
      "No transaction, amount or bookkeeping change was assumed",
    );
    expect(
      (await database.db.select().from(financeSmsCompletions))[0]?.acknowledgementMessageId,
    ).toBeTruthy();
  });
  it.each([
    "disabled",
    "revoked",
    "epoch_changed",
  ])("does not capture under %s transport authority", async (mode) => {
    const f = await fixture();
    if (mode === "revoked")
      await database.db
        .update(textingConnections)
        .set({ state: "opted_out" })
        .where(eq(textingConnections.id, f.connection.id));
    if (mode === "epoch_changed")
      await database.db
        .update(textingConnections)
        .set({ consentEpoch: f.connection.consentEpoch + 1 })
        .where(eq(textingConnections.id, f.connection.id));
    if (mode === "disabled") await dispatch(() => false)();
    else await dispatch()();
    expect(await database.db.select().from(financeContexts)).toHaveLength(0);
    expect(await database.db.select().from(financeContextRevisions)).toHaveLength(0);
    expect(await database.db.select().from(financeSmsCompletions)).toHaveLength(0);
    const ack = acknowledge();
    await ack.run();
    expect(ack.send).not.toHaveBeenCalled();
  });

  it("skips a revoked epoch while capturing another owner and retries a locked owner without starving healthy work", async () => {
    const revoked = await fixture();
    await database.db
      .update(textingConnections)
      .set({ consentEpoch: revoked.connection.consentEpoch + 1 })
      .where(eq(textingConnections.id, revoked.connection.id));
    const locked = await fixture();
    const healthy = await fixture();
    const held = await database.pool.connect();
    try {
      await held.query("BEGIN");
      await held.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [locked.userId]);
      await expect(dispatch()()).rejects.toThrow(
        "Finance SMS context reconciliation failed for 1 claims",
      );
      expect(await database.db.select().from(financeContexts)).toMatchObject([
        { userId: healthy.userId },
      ]);
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
    await dispatch()();
    expect(await database.db.select().from(financeContexts)).toHaveLength(2);
    expect(
      await database.db
        .select()
        .from(financeContexts)
        .where(eq(financeContexts.userId, revoked.userId)),
    ).toHaveLength(0);
    expect(await database.db.select().from(financeSmsCompletions)).toHaveLength(2);
  });
  it("clarifies unbound yes rather than approving or capturing it", async () => {
    await fixture("yes");
    await dispatch()();
    expect(await database.db.select().from(financeContexts)).toHaveLength(0);
    expect(await database.db.select().from(financeSmsCompletions)).toMatchObject([
      { disposition: "clarification_required" },
    ]);
    const ack = acknowledge();
    await ack.run();
    await ack.run();
    expect(ack.send).toHaveBeenCalledTimes(1);
    expect(
      (await database.db.select().from(textMessages)).find((item) => item.direction === "outbound")
        ?.body,
    ).toContain("could not safely attach");
  });
  it("honors notification disablement and consent at acknowledgment time", async () => {
    const f = await fixture();
    await dispatch()();
    await database.db.insert(notificationPreferences).values({
      userId: f.userId,
      scope: "global",
      revision: 1,
      preferences: { ...defaultNotificationPreferences, enabled: false },
    });
    const ack = acknowledge();
    await ack.run();
    expect(ack.send).not.toHaveBeenCalled();
    await database.db.delete(notificationPreferences);
    await database.db
      .update(textingConnections)
      .set({ consentEpoch: f.connection.consentEpoch + 1 })
      .where(eq(textingConnections.id, f.connection.id));
    await ack.run();
    await ack.run();
    expect(ack.send).not.toHaveBeenCalled();
  });
  it("never sends a second acknowledgment after ambiguous provider acceptance", async () => {
    await fixture();
    await dispatch()();
    const send = vi.fn(async () => {
      throw new Error("provider timeout");
    });
    const ack = acknowledge(send);
    await expect(ack.run()).rejects.toThrow("provider timeout");
    await ack.run();
    await acknowledge(send).run();
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await database.db.select().from(financeSmsCompletions))[0]?.acknowledgementMessageId,
    ).toBeTruthy();
  });
  it("rejects forged inbound evidence even from the same user's app principal", async () => {
    const f = await fixture();
    const service = createFinanceContextService({
      db: database.db,
      principal: {
        userId: f.userId,
        actorId: f.userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
      },
      requestId: f.message.id,
      now,
      smsEvidence: { claimId: f.claim.id, inboundMessageId: f.message.id, enabled: () => true },
    });
    await expect(
      database.db.transaction((tx) =>
        service.captureContext(
          {
            type: "create",
            operationId: f.claim.id,
            text: "A forged financial instruction",
            validFrom: null,
            validThrough: null,
            participants: [],
            expectedCents: null,
            paymentChannel: null,
            categoryId: null,
            transactionIds: [],
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await database.db.select().from(financeContexts)).toHaveLength(0);
  });
  async function approvalFixture(text: "approve" | "reject" = "approve") {
    const f = await fixture(`1 ${text}`, true);
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId: f.userId, provider: "manual", institution: "Cash", name: "Cash" })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({ userId: f.userId, group: "Expenses", name: "Dining", slug: "dining" })
      .returning();
    if (!account || !category) throw new Error("Finance targets");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.userId,
        accountId: account.id,
        amount: 1200,
        merchant: "Cafe",
        transactionDate: "2026-10-09",
        direction: "expense",
      })
      .returning();
    if (!transaction) throw new Error("transaction");
    await database.db
      .insert(financeCategoryRules)
      .values({ userId: f.userId, merchantNormalized: "cafe", category: category.name });
    const actions = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now }),
      now,
    });
    const principal: Principal = {
      userId: f.userId,
      actorId: f.userId,
      actorType: "user" as const,
      scopes: new Set(["finances:read", "finances:write"]),
    };
    const proposal = await actions.performDirect(
      "categorization",
      {
        decisions: [
          {
            transactionId: transaction.id,
            categoryId: category.id,
            expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
            confidence: 1,
            rationale: "Confirmed meal",
            learnMerchant: "never",
          },
        ],
      },
      {
        principal: { ...principal, actorType: "agent", actorId: "sms-test-agent" },
        requestId: "prepare-sms-approval",
      },
    );
    if (proposal.status !== "pending_review")
      throw new Error(`Expected approval; received ${JSON.stringify(proposal)}`);
    const [review] = await database.db
      .select()
      .from(financeAgentActionReviews)
      .where(eq(financeAgentActionReviews.id, proposal.review.id));
    if (!review) throw new Error("review");
    const version = review.updatedAt.getTime().toString();
    const work = {
      domain: "finances" as const,
      kind: "approval" as const,
      id: review.id,
      revision: version,
      actionRevision: version,
    };
    const outboundAt = new Date(now().getTime() - 120000);
    const [outbound] = await database.db
      .insert(textMessages)
      .values({
        userId: f.userId,
        connectionId: f.connection.id,
        direction: "outbound",
        body: "1. Categorize Cafe as Dining. Reply 1 approve or 1 reject.",
        status: "sent",
        providerMessageSid: `SM${randomUUID()}`,
        providerSubmittedAt: outboundAt,
        occurredAt: outboundAt,
        occurredAtSource: "nohmi",
      })
      .returning();
    if (!outbound) throw new Error("outbound");
    const operationId = randomUUID();
    const [binding] = await database.db.transaction((tx) =>
      createTextReplyBindings(
        tx,
        f.userId,
        f.connection,
        outbound.id,
        [
          {
            outboundMessageId: outbound.id,
            itemNumber: 1,
            work,
            answerMode: "choices",
            answerVocabulary: ["approve", "reject"],
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            operationId,
          },
        ],
        outboundAt,
      ),
    );
    if (!binding) throw new Error("binding");
    // The signed inbound receipt must arrive after the outbound binding was issued.
    await database.db.insert(textInboundClaims).values(f.claim);
    expect((await bindInboundReply(database.db, f.userId, f.message.id, () => true)).state).toBe(
      "pending",
    );
    const command = {
      operationId,
      work,
      text,
      inboundMessageId: f.message.id,
      replyBindingId: binding.id,
    };
    const context = { principal, requestId: operationId };
    const decide = createFinanceSmsApprovalService({
      db: database.db,
      actions,
      now,
      admit: createSmsApprovalAdmission({ enabled: () => true }),
    });
    const port = createFinanceSmsPort({
      db: database.db,
      now,
      admitSmsAnswer: createSmsAdmission({ enabled: () => true }),
      decideSmsApproval: decide,
    });
    const recovery = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      now,
      finance: {
        inspectSmsReceipt: port.inspectSmsReceipt,
        executeAnswer: async (_userId, command) =>
          database.db.transaction((tx) => port.answerSmsWork(command, context, tx)),
      },
    });
    return {
      ...f,
      recovery,
      actions,
      review,
      work,
      command,
      context,
      decide,
      transaction,
      category,
      binding,
    };
  }
  it.each([
    "approve",
    "reject",
  ] as const)("applies only the exact reversible %s decision and replays its immutable receipt", async (decision) => {
    const f = await approvalFixture(decision);
    const result = await database.db.transaction((tx) => f.decide(f.command, f.context, tx));
    expect(result.state).toBe("accepted");
    expect(await database.db.transaction((tx) => f.decide(f.command, f.context, tx))).toEqual(
      result,
    );
    expect(
      await database.db
        .select()
        .from(financeMutationRecords)
        .where(eq(financeMutationRecords.idempotencyKey, f.command.operationId)),
    ).toHaveLength(1);
    expect(
      (
        await database.db
          .select()
          .from(financeAgentActionReviews)
          .where(eq(financeAgentActionReviews.id, f.review.id))
      )[0]?.status,
    ).toBe(decision === "approve" ? "applied" : "dismissed");
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, f.binding.id))
      )[0]?.state,
    ).toBe("accepted");
    const [transaction] = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.id, f.transaction.id));
    expect(transaction?.categoryId).toBe(decision === "approve" ? f.category.id : null);
  });
  it.each([
    "accepted",
    "blocked",
    "mixed",
    "multiple_accepted",
    "multiple_blocked",
    "waiting",
  ] as const)("acknowledges %s receipt state once without claiming financial completion", async (mode) => {
    const f = await approvalFixture();
    await database.db.transaction((tx) => f.decide(f.command, f.context, tx));
    const child = (state: "accepted" | "blocked" | "waiting", itemNumber: number) => ({
      bindingId: randomUUID(),
      operationId: randomUUID(),
      itemNumber,
      state,
      reason: null,
      terminal: state !== "waiting",
    });
    const children =
      mode === "waiting"
        ? [child("accepted", 1), child("waiting", 2)]
        : mode === "blocked"
          ? [child("blocked", 1)]
          : mode === "mixed"
            ? [child("accepted", 1), child("blocked", 2)]
            : mode === "multiple_accepted"
              ? [child("accepted", 1), child("accepted", 2)]
              : mode === "multiple_blocked"
                ? [child("accepted", 1), child("blocked", 2), child("blocked", 3)]
                : [child("accepted", 1)];
    const ack = acknowledge(undefined, undefined, {
      inspectClaim: async () => ({
        inboundMessageId: f.message.id,
        state: "attached",
        reason: null,
        children,
      }),
    });
    await ack.run();
    await ack.run();
    expect(ack.send).toHaveBeenCalledTimes(mode === "waiting" ? 0 : 1);
    const outbound = (await database.db.select().from(textMessages)).filter(
      (row) => row.direction === "outbound" && row.id !== f.binding.outboundMessageId,
    );
    if (mode === "waiting") {
      expect(outbound).toEqual([]);
      return;
    }
    const body = outbound[0]?.body;
    expect(body).not.toContain("completed");
    if (mode === "blocked") expect(body).toContain("No decision was applied");
    else {
      expect(body).toContain("maintenance may still be waiting");
      if (mode === "multiple_accepted") expect(body).toContain("Saved 2 replies");
      if (mode === "mixed") expect(body).toContain("1 other reply needs review");
      if (mode === "multiple_blocked") expect(body).toContain("2 other replies need review");
    }
  });
  it.each([
    "missing",
    "empty",
    "unavailable",
  ] as const)("keeps acknowledgment pending without a terminal decision receipt: %s", async (mode) => {
    const f = await approvalFixture();
    await database.db.transaction((tx) => f.decide(f.command, f.context, tx));
    const ack = acknowledge(undefined, undefined, {
      inspectClaim: async () =>
        mode === "missing"
          ? null
          : {
              inboundMessageId: f.message.id,
              state: "attached",
              reason: null,
              children:
                mode === "empty"
                  ? []
                  : [
                      {
                        bindingId: f.binding.id,
                        operationId: f.command.operationId,
                        itemNumber: 1,
                        state: "unavailable",
                        reason: null,
                        terminal: true,
                      },
                    ],
            },
    });
    await ack.run();
    expect(ack.send).not.toHaveBeenCalled();
    expect(await database.db.select().from(financeSmsCompletions)).toEqual([]);
  });
  it.each([
    "before_scan",
    "after_scan",
    "before_write",
  ] as const)("stops context capture and acknowledgments at the %s shutdown boundary", async (mode) => {
    const f = await fixture();
    let checks = 0;
    const stopAt = mode === "before_scan" ? 1 : mode === "after_scan" ? 2 : 3;
    await dispatch()(() => ++checks < stopAt);
    expect(await database.db.select().from(financeContexts)).toEqual([]);
    expect(await database.db.select().from(financeSmsCompletions)).toEqual([]);
    await dispatch()();
    const ack = acknowledge();
    checks = 0;
    await ack.run(() => ++checks < stopAt);
    expect(ack.send).not.toHaveBeenCalled();
    expect(
      (await database.db.select().from(financeSmsCompletions))[0]?.acknowledgementMessageId,
    ).toBeNull();
    await ack.run();
    await ack.run();
    expect(ack.send).toHaveBeenCalledTimes(1);
    expect((await database.db.select().from(financeContexts))[0]?.userId).toBe(f.userId);
  });
  it.each([
    "disabled",
    "new_consent_epoch",
  ] as const)("rechecks %s after receipt inspection before queuing the acknowledgment", async (mode) => {
    const f = await approvalFixture();
    await f.recovery.recoverClaim(f.userId, f.claim.id);
    let enabled = true;
    const ack = acknowledge(undefined, () => enabled, {
      inspectClaim: async (userId, messageId) => {
        const receipt = await f.recovery.inspectClaim(userId, messageId);
        if (mode === "disabled") enabled = false;
        else
          await database.db
            .update(textingConnections)
            .set({ consentEpoch: f.connection.consentEpoch + 1 })
            .where(eq(textingConnections.id, f.connection.id));
        return receipt;
      },
    });
    await ack.run();
    expect(ack.send).not.toHaveBeenCalled();
    expect(await database.db.select().from(financeSmsCompletions)).toEqual([]);
    expect((await database.db.select().from(textReplyBindings))[0]?.state).toBe("accepted");
  });
  it("honors Finance-specific notification disablement over an enabled global preference", async () => {
    await fixture();
    await dispatch()();
    const [context] = await database.db.select().from(financeContexts);
    if (!context) throw new Error("context");
    await database.db.insert(notificationPreferences).values({
      userId: context.userId,
      scope: "finances",
      revision: 1,
      preferences: { ...defaultNotificationPreferences, enabled: false },
    });
    const ack = acknowledge();
    await ack.run();
    expect(ack.send).not.toHaveBeenCalled();
    expect(
      (await database.db.select().from(financeSmsCompletions))[0]?.acknowledgementMessageId,
    ).toBeNull();
  });
  it("revalidates the proposal's transaction and never accepts bare yes or stale approval", async () => {
    const f = await approvalFixture();
    expect(
      (
        await database.db.transaction((tx) =>
          f.decide({ ...f.command, text: "yes" }, f.context, tx),
        )
      ).state,
    ).toBe("unavailable");
    await database.db
      .update(financeTransactions)
      .set({ amount: 1500, updatedAt: new Date(now().getTime() + 1000) })
      .where(eq(financeTransactions.id, f.transaction.id));
    const result = await database.db.transaction((tx) => f.decide(f.command, f.context, tx));
    expect(result.state).toBe("blocked");
    expect(
      (
        await database.db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.id, f.transaction.id))
      )[0]?.categoryId,
    ).toBeNull();
  });
  it.each([
    "accepted",
    "blocked",
  ] as const)("acknowledges the real immutable %s approval receipt once", async (expected) => {
    const f = await approvalFixture();
    if (expected === "blocked")
      await database.db
        .update(financeTransactions)
        .set({ amount: 1500, updatedAt: new Date(now().getTime() + 1000) })
        .where(eq(financeTransactions.id, f.transaction.id));
    const recovered = await f.recovery.recoverClaim(f.userId, f.claim.id);
    expect(recovered?.children).toMatchObject([{ state: expected, terminal: true }]);
    const send = vi.fn(async () => ({ sid: `SM${randomUUID()}`, status: "queued" }));
    const ack = acknowledge(send, () => true, f.recovery);
    await ack.run();
    await ack.run();
    await acknowledge(send, () => true, f.recovery).run();
    expect(send).toHaveBeenCalledTimes(1);
    const [completion] = await database.db.select().from(financeSmsCompletions);
    if (!completion?.acknowledgementMessageId) throw new Error("missing acknowledgment evidence");
    const [message] = await database.db
      .select()
      .from(textMessages)
      .where(eq(textMessages.id, completion.acknowledgementMessageId));
    expect(message?.body).toContain(
      expected === "accepted" ? "Saved your reply" : "No decision was applied",
    );
  });
  it.each([
    "context",
    "minimal",
  ] as const)("publishes complete approval choices only under %s disclosure", async (detail) => {
    const f = await approvalFixture();
    const send = vi.fn(async () => ({ sid: `SM${randomUUID()}`, status: "queued" }));
    const texting = createTextingService({
      db: database.db,
      apiBaseUrl: "https://nohmi.test",
      enabled: true,
      encryptionKey,
      senderPhoneNumber: "+12125550124",
      now,
      twilio: { sendMessage: send } as unknown as TwilioConnector,
    });
    const notifications = createNotificationService({
      db: database.db,
      origin: "https://nohmi.test",
      transport: texting,
      now,
      resolveWork: resolveFinanceWorks,
    });
    await database.db.insert(notificationPreferences).values({
      userId: f.userId,
      scope: "global",
      revision: 1,
      preferences: { ...defaultNotificationPreferences, detail },
    });
    const principal: Principal = {
      ...f.context.principal,
      scopes: new Set(["finances:read", "finances:write", "texting:read", "texting:write"]),
    };
    await notifications.publish(principal, { work: [f.work] });
    await notifications.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    const [sent] = (await database.db.select().from(textMessages)).filter(
      (message) => message.direction === "outbound" && message.id !== f.binding.outboundMessageId,
    );
    if (!sent) throw new Error("missing notification");
    const bindings = await database.db
      .select()
      .from(textReplyBindings)
      .where(eq(textReplyBindings.outboundMessageId, sent.id));
    if (detail === "context") {
      expect(sent.body).toContain(f.review.safeChanges[0]?.summary);
      expect(sent.body).toContain("1 approve or 1 reject");
      expect(bindings).toMatchObject([
        {
          workKind: "approval",
          workId: f.review.id,
          answerMode: "choices",
          answerVocabulary: ["approve", "reject"],
        },
      ]);
    } else {
      expect(sent.body).not.toContain("approve or");
      expect(sent.body).not.toContain("Cafe");
      expect(bindings).toHaveLength(0);
    }
  });
  it("rolls back the writer, receipt and consumed binding together before a successful retry", async () => {
    const f = await approvalFixture();
    await expect(
      database.db.transaction(async (tx) => {
        expect((await f.decide(f.command, f.context, tx)).state).toBe("accepted");
        throw new Error("crash before commit");
      }),
    ).rejects.toThrow("crash before commit");
    expect(
      (
        await database.db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.id, f.transaction.id))
      )[0]?.categoryId,
    ).toBeNull();
    expect(
      (
        await database.db
          .select()
          .from(financeAgentActionReviews)
          .where(eq(financeAgentActionReviews.id, f.review.id))
      )[0]?.status,
    ).toBe("pending");
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, f.binding.id))
      )[0]?.state,
    ).toBe("pending");
    expect(
      await database.db
        .select()
        .from(financeMutationRecords)
        .where(eq(financeMutationRecords.idempotencyKey, f.command.operationId)),
    ).toHaveLength(0);
    expect((await database.db.transaction((tx) => f.decide(f.command, f.context, tx))).state).toBe(
      "accepted",
    );
  });
  it.each([
    "expired",
    "opted_out",
    "epoch_changed",
  ])("does not apply under %s authority", async (mode) => {
    const f = await approvalFixture();
    if (mode === "expired")
      await database.db
        .update(financeAgentActionReviews)
        .set({ createdAt: new Date(now().getTime() - 86400001) })
        .where(eq(financeAgentActionReviews.id, f.review.id));
    else
      await database.db
        .update(textingConnections)
        .set(
          mode === "opted_out"
            ? { state: "opted_out" }
            : { consentEpoch: f.connection.consentEpoch + 1 },
        )
        .where(eq(textingConnections.id, f.connection.id));
    expect((await database.db.transaction((tx) => f.decide(f.command, f.context, tx))).state).toBe(
      mode === "expired" ? "blocked" : "unavailable",
    );
    expect(
      (
        await database.db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.id, f.transaction.id))
      )[0]?.categoryId,
    ).toBeNull();
  });
  it("withholds private or malformed categorization details from SMS and requires app review", async () => {
    const f = await approvalFixture();
    expect(smsCategorizationSummary(f.review)).toBeTruthy();
    const safeChange = f.review.safeChanges[0];
    if (!safeChange) throw new Error("Missing categorization summary");
    for (const summary of [
      "Private transaction",
      "Categorize private@example.com as Dining",
      "Categorize https://private.example as Dining",
      "Categorize 123456 as Dining",
      "Categorize Café as Dining",
      "Categorize Cafe\n as Dining",
      `Categorize ${"x".repeat(130)} as Dining`,
    ]) {
      const row = { ...f.review, safeChanges: [{ ...safeChange, summary }] };
      expect(smsCategorizationSummary(row)).toBeNull();
    }
    for (const patch of [
      { entityType: "finance_account" },
      { entityId: "" },
      { summary: undefined },
    ]) {
      expect(
        smsCategorizationSummary({
          ...f.review,
          safeChanges: [{ ...safeChange, ...patch }],
        } as typeof f.review),
      ).toBeNull();
    }
    for (const privatePayload of [
      {},
      { input: {} },
      { input: { decisions: [] } },
      { input: { decisions: [{ learnMerchant: "never" }, { learnMerchant: "never" }] } },
    ])
      expect(smsCategorizationSummary({ ...f.review, privatePayload })).toBeNull();
    expect(smsCategorizationSummary({ ...f.review, safeChanges: [] })).toBeNull();
    expect(
      await database.db.transaction((tx) =>
        resolveSmsApproval(f.userId, { ...f.work, kind: "question" }, tx),
      ),
    ).toEqual({ state: "unavailable" });
    expect(
      await database.db.transaction((tx) => resolveSmsApproval(randomUUID(), f.work, tx)),
    ).toEqual({ state: "unavailable" });
    await database.db.transaction((tx) => f.decide(f.command, f.context, tx));
    expect(await database.db.transaction((tx) => resolveSmsApproval(f.userId, f.work, tx))).toEqual(
      { state: "resolved" },
    );
  });
  it("keeps future merchant rules and stronger approvals in the authenticated app", async () => {
    const f = await approvalFixture();
    const payload = f.review.privatePayload as {
      input: { decisions: Array<Record<string, unknown>> };
    };
    await database.db
      .update(financeAgentActionReviews)
      .set({
        privatePayload: {
          ...payload,
          input: {
            ...payload.input,
            decisions: payload.input.decisions.map((item) => ({
              ...item,
              learnMerchant: "always",
            })),
          },
        },
      })
      .where(eq(financeAgentActionReviews.id, f.review.id));
    const resolved = await database.db.transaction((tx) =>
      resolveSmsApproval(f.userId, f.work, tx),
    );
    expect(resolved).toMatchObject({
      state: "current",
      value: { context: null, disclosure: "minimal" },
    });
    expect((await database.db.transaction((tx) => f.decide(f.command, f.context, tx))).state).toBe(
      "blocked",
    );
    expect(
      (
        await database.db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.id, f.transaction.id))
      )[0]?.categoryId,
    ).toBeNull();
  });
});
