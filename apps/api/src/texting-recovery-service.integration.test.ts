import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  textInboundClaims,
  textingConnections,
  textMessages,
  textReplyBindings,
  users,
} from "@personal-os/database";
import type { FinanceDomainOutcome } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { encryptJson } from "./security.js";
import {
  createTextingRecoveryService,
  type FinanceSmsRecoveryCommand,
} from "./texting-recovery-service.js";
import { bindInboundReply, createTextReplyBindings } from "./texting-reply-binding.js";
import { createSmsAdmission } from "./texting-sms-admission.js";

describe.sequential("Texting signed-claim recovery", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture(children = 1, claimId?: string, claimCreatedAt?: Date) {
    const userId = randomUUID();
    const operationId = randomUUID();
    const work = {
      domain: "finances" as const,
      kind: "question" as const,
      id: randomUUID(),
      revision: "1",
      actionRevision: "1",
    };
    const anchor = Date.now();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "Recovery",
      passwordHash: "unused",
    });
    const [connection] = await database.db
      .insert(textingConnections)
      .values({
        userId,
        encryptedPhoneNumber: encryptJson(
          { e164: "+12025550123" },
          Buffer.alloc(32, 7).toString("base64"),
        ),
        phoneFingerprint: randomUUID(),
        phoneLastFour: "0001",
        country: "US",
        state: "active",
        consentVersion: "test",
        verifiedAt: new Date(),
      })
      .returning();
    if (!connection) throw new Error("Missing connection");
    const [outbound] = await database.db
      .insert(textMessages)
      .values({
        userId,
        connectionId: connection.id,
        body: children === 1 ? "What was this transaction for?" : "1) Purpose? 2) Purpose?",
        direction: "outbound",
        status: "sent",
        providerMessageSid: randomUUID(),
        providerSubmittedAt: new Date(anchor - 30_000),
        occurredAt: new Date(anchor - 30_000),
        occurredAtSource: "nohmi",
      })
      .returning();
    const [inbound] = await database.db
      .insert(textMessages)
      .values({
        userId,
        connectionId: connection.id,
        body: children === 1 ? "Dinner with Sam" : "1: Dinner with Sam\n---\n2: Taxi",
        direction: "inbound",
        status: "delivered",
        providerMessageSid: randomUUID(),
        occurredAt: new Date(anchor + 30_000),
        occurredAtSource: "provider",
      })
      .returning();
    if (!outbound || !inbound) throw new Error("Missing message");
    const bindings = await database.db.transaction(async (tx) =>
      createTextReplyBindings(tx, userId, connection, outbound.id, [
        {
          outboundMessageId: outbound.id,
          itemNumber: 1,
          answerMode: "free_text",
          answerVocabulary: null,
          operationId,
          expiresAt: new Date(anchor + 3_600_000).toISOString(),
          work,
        },
        ...(children === 2
          ? [
              {
                outboundMessageId: outbound.id,
                itemNumber: 2,
                answerMode: "free_text" as const,
                answerVocabulary: null,
                operationId: randomUUID(),
                expiresAt: new Date(anchor + 3_600_000).toISOString(),
                work: { ...work, id: randomUUID() },
              },
            ]
          : []),
      ]),
    );
    const [binding, secondBinding] = bindings;
    if (!binding) throw new Error("Missing binding");
    await database.db.insert(textInboundClaims).values({
      id: claimId,
      userId,
      connectionId: connection.id,
      messageId: inbound.id,
      consentEpoch: connection.consentEpoch,
      createdAt: claimCreatedAt ?? new Date(anchor + 5_000),
    });
    expect((await bindInboundReply(database.db, userId, inbound.id, () => true)).state).toBe(
      "pending",
    );
    const command: FinanceSmsRecoveryCommand = {
      operationId,
      work,
      text: "Dinner with Sam",
      inboundMessageId: inbound.id,
      replyBindingId: binding.id,
    };
    return { userId, operationId, connection, inbound, binding, secondBinding, command };
  }

  it("uses the original operation and exact receipt before executing a pending child", async () => {
    const f = await fixture();
    const calls: string[] = [];
    let receipt: FinanceDomainOutcome | null = null;
    const accepted: FinanceDomainOutcome & { state: "accepted" } = {
      operationId: f.operationId,
      state: "accepted",
      work: [f.command.work],
      resultRevision: "result-1",
      reasonCode: null,
    };
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async (_owner, command) => {
          calls.push(`inspect:${command.operationId}`);
          return receipt ? { state: "completed", outcome: receipt } : { state: "absent" };
        },
        executeAnswer: async (owner, command) => {
          calls.push(`execute:${command.operationId}`);
          expect(owner).toBe(f.userId);
          expect(command).toEqual(f.command);
          await database.db.transaction(async (tx) => {
            const admission = await createSmsAdmission({ enabled: () => true })(tx, {
              ...command,
              userId: owner,
            });
            if (admission.state !== "verified") throw new Error("Expected verified admission");
            await admission.consume(accepted);
          });
          receipt = accepted;
          return accepted;
        },
      },
    });

    const first = await service.runPage(f.userId, { limit: 10 });
    expect(first.claims).toEqual([
      expect.objectContaining({
        inboundMessageId: f.inbound.id,
        children: [expect.objectContaining({ bindingId: f.binding.id, state: "accepted" })],
      }),
    ]);
    expect(calls).toEqual([
      `inspect:${f.operationId}`,
      `execute:${f.operationId}`,
      `inspect:${f.operationId}`,
    ]);
    const [stored] = await database.db
      .select()
      .from(textReplyBindings)
      .where(eq(textReplyBindings.id, f.binding.id));
    expect(stored?.state).toBe("accepted");
    const status = await service.inspectClaim(f.userId, f.inbound.id);
    expect(status?.children).toEqual([
      {
        itemNumber: 1,
        bindingId: f.binding.id,
        operationId: f.operationId,
        state: "accepted",
        reason: null,
        terminal: true,
      },
    ]);
  });

  it("returns no owner status for another owner's signed message", async () => {
    const f = await fixture();
    let inspections = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async () => {
          inspections += 1;
          return { state: "absent" };
        },
        executeAnswer: async () => {
          throw new Error("must not execute");
        },
      },
    });
    expect(await service.inspectClaim(randomUUID(), f.inbound.id)).toBeNull();
    expect(inspections).toBe(0);
  });

  it.each([
    "started",
    "failed",
  ] as const)("never invokes Finance again for an incomplete %s receipt", async (status) => {
    const f = await fixture();
    let executions = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async () => ({ state: "incomplete", status }),
        executeAnswer: async () => {
          executions += 1;
          throw new Error("must not execute");
        },
      },
    });
    const first = await service.runPage(f.userId, { limit: 10 });
    const second = await service.runPage(f.userId, { limit: 10 });
    expect(executions).toBe(0);
    expect(first.claims[0]?.children).toEqual([
      {
        bindingId: f.binding.id,
        operationId: f.operationId,
        state: "uncertain",
        reason: `finance_receipt_${status}`,
        terminal: false,
      },
    ]);
    expect(second.claims[0]?.children).toEqual(first.claims[0]?.children);
    const [stored] = await database.db
      .select()
      .from(textReplyBindings)
      .where(eq(textReplyBindings.id, f.binding.id));
    expect(stored?.state).toBe("pending");
  });

  it("preserves accepted sibling evidence after STOP while withholding an unresolved child", async () => {
    const f = await fixture(2);
    if (!f.secondBinding) throw new Error("Missing second child");
    const accepted: FinanceDomainOutcome & { state: "accepted" } = {
      operationId: f.operationId,
      state: "accepted",
      work: [f.command.work],
      resultRevision: "result-1",
      reasonCode: null,
    };
    await database.db.transaction(async (tx) => {
      const admission = await createSmsAdmission({ enabled: () => true })(tx, {
        ...f.command,
        userId: f.userId,
      });
      if (admission.state !== "verified") throw new Error("Missing admission");
      await admission.consume(accepted);
    });
    await database.db
      .update(textingConnections)
      .set({ state: "opted_out", consentEpoch: f.connection.consentEpoch + 1 })
      .where(eq(textingConnections.id, f.connection.id));
    let executions = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async (_owner, command) =>
          command.operationId === f.operationId
            ? { state: "completed", outcome: accepted }
            : { state: "absent" },
        executeAnswer: async () => {
          executions += 1;
          throw new Error("must not execute after STOP");
        },
      },
    });
    const result = await service.runPage(f.userId, { limit: 10 });
    expect(executions).toBe(0);
    expect(result.claims[0]?.children).toEqual([
      {
        bindingId: f.binding.id,
        operationId: f.operationId,
        state: "accepted",
        reason: null,
        terminal: true,
      },
      {
        bindingId: f.secondBinding.id,
        operationId: f.secondBinding.operationId,
        state: "blocked",
        reason: "consent_revoked",
        terminal: false,
      },
    ]);
  });

  it.each([
    "absent",
    "blocked",
    "mismatched",
  ] as const)("reports persisted acceptance as uncertain when the Finance receipt is %s", async (receiptCase) => {
    const f = await fixture(2);
    if (!f.secondBinding) throw new Error("Missing second child");
    const accepted: FinanceDomainOutcome & { state: "accepted" } = {
      operationId: f.operationId,
      state: "accepted",
      work: [f.command.work],
      resultRevision: "result-1",
      reasonCode: null,
    };
    await database.db.transaction(async (tx) => {
      const admission = await createSmsAdmission({ enabled: () => true })(tx, {
        ...f.command,
        userId: f.userId,
      });
      if (admission.state !== "verified") throw new Error("Missing admission");
      await admission.consume(accepted);
    });
    let executions = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async (_owner, command) => {
          if (command.operationId !== f.operationId)
            return { state: "incomplete", status: "started" };
          if (receiptCase === "absent") return { state: "absent" };
          if (receiptCase === "blocked")
            return {
              state: "completed",
              outcome: { ...accepted, state: "blocked", reasonCode: "stale_revision" },
            };
          return { state: "completed", outcome: { ...accepted, operationId: randomUUID() } };
        },
        executeAnswer: async () => {
          executions += 1;
          throw new Error("must not execute");
        },
      },
    });
    const result = await service.runPage(f.userId, { limit: 10 });
    expect(result.claims[0]?.children[0]).toEqual({
      bindingId: f.binding.id,
      operationId: f.operationId,
      state: "uncertain",
      reason:
        receiptCase === "absent"
          ? "terminal_receipt_missing"
          : receiptCase === "blocked"
            ? "terminal_receipt_mismatch"
            : "receipt_inspection_failed",
      terminal: false,
    });
    expect(result.claims[0]?.children[1]).toMatchObject({
      bindingId: f.secondBinding.id,
      state: "uncertain",
      terminal: false,
    });
    expect(executions).toBe(0);
    const [stored] = await database.db
      .select()
      .from(textReplyBindings)
      .where(eq(textReplyBindings.id, f.binding.id));
    expect(stored?.state).toBe("accepted");
  });

  it.each([
    "absent",
    "blocked",
    "revision_mismatch",
  ] as const)("inspects a lone terminal child without replaying Finance when the receipt is %s", async (receiptCase) => {
    const f = await fixture();
    const accepted: FinanceDomainOutcome & { state: "accepted" } = {
      operationId: f.operationId,
      state: "accepted",
      work: [f.command.work],
      resultRevision: "result-1",
      reasonCode: null,
    };
    await database.db.transaction(async (tx) => {
      const admission = await createSmsAdmission({ enabled: () => true })(tx, {
        ...f.command,
        userId: f.userId,
      });
      if (admission.state !== "verified") throw new Error("Missing admission");
      await admission.consume(accepted);
    });
    let executions = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async () => {
          if (receiptCase === "absent") return { state: "absent" };
          return {
            state: "completed",
            outcome:
              receiptCase === "blocked"
                ? { ...accepted, state: "blocked", reasonCode: "stale_revision" }
                : { ...accepted, resultRevision: "result-2" },
          };
        },
        executeAnswer: async () => {
          executions += 1;
          throw new Error("must not execute");
        },
      },
    });
    expect((await service.runPage(f.userId, { limit: 10 })).claims).toEqual([]);
    const status = await service.inspectClaim(f.userId, f.inbound.id);
    expect(status?.children).toEqual([
      {
        itemNumber: 1,
        bindingId: f.binding.id,
        operationId: f.operationId,
        state: "uncertain",
        reason: receiptCase === "absent" ? "terminal_receipt_missing" : "terminal_receipt_mismatch",
        terminal: false,
      },
    ]);
    expect(executions).toBe(0);
  });

  it("does not report a just-consumed acceptance whose receipt revision differs", async () => {
    const f = await fixture();
    const accepted: FinanceDomainOutcome & { state: "accepted" } = {
      operationId: f.operationId,
      state: "accepted",
      work: [f.command.work],
      resultRevision: "result-1",
      reasonCode: null,
    };
    let receipt: FinanceDomainOutcome | null = null;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async () =>
          receipt ? { state: "completed", outcome: receipt } : { state: "absent" },
        executeAnswer: async (owner, command) => {
          await database.db.transaction(async (tx) => {
            const admission = await createSmsAdmission({ enabled: () => true })(tx, {
              ...command,
              userId: owner,
            });
            if (admission.state !== "verified") throw new Error("Missing admission");
            await admission.consume(accepted);
          });
          receipt = { ...accepted, resultRevision: "result-2" };
          return receipt;
        },
      },
    });
    const result = await service.runPage(f.userId, { limit: 10 });
    expect(result.claims[0]?.children[0]).toMatchObject({
      state: "uncertain",
      reason: "accepted_binding_mismatch",
      terminal: false,
    });
  });

  it.each([
    { financeState: "blocked", bindingState: "blocked", reasonCode: "stale_revision" },
    {
      financeState: "unavailable",
      bindingState: "unavailable",
      reasonCode: "producer_not_registered",
    },
    { financeState: "failed", bindingState: "blocked", reasonCode: "dispatch_uncertain" },
  ] as const)("projects a completed $financeState receipt to a durable $bindingState child", async ({
    financeState,
    bindingState,
    reasonCode,
  }) => {
    const f = await fixture();
    const outcome: FinanceDomainOutcome = {
      operationId: f.operationId,
      state: financeState,
      work: [f.command.work],
      resultRevision: null,
      reasonCode,
    };
    let executions = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async () => ({ state: "completed", outcome }),
        executeAnswer: async () => {
          executions += 1;
          throw new Error("must not execute");
        },
      },
    });
    const result = await service.runPage(f.userId, { limit: 10 });
    expect(result.claims[0]?.children).toEqual([
      {
        bindingId: f.binding.id,
        operationId: f.operationId,
        state: bindingState,
        reason: reasonCode,
        terminal: true,
      },
    ]);
    expect(executions).toBe(0);
    const [stored] = await database.db
      .select()
      .from(textReplyBindings)
      .where(eq(textReplyBindings.id, f.binding.id));
    expect(stored?.state).toBe(bindingState);
    expect(stored?.reasonCode).toBe(reasonCode);
  });

  it("holds a disabled child and later resumes with the same operation key", async () => {
    const f = await fixture();
    let enabled = false;
    const accepted: FinanceDomainOutcome & { state: "accepted" } = {
      operationId: f.operationId,
      state: "accepted",
      work: [f.command.work],
      resultRevision: "result-1",
      reasonCode: null,
    };
    let receipt: FinanceDomainOutcome | null = null;
    const executed: string[] = [];
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => enabled,
      finance: {
        inspectSmsReceipt: async () =>
          receipt ? { state: "completed", outcome: receipt } : { state: "absent" },
        executeAnswer: async (owner, command) => {
          executed.push(command.operationId);
          await database.db.transaction(async (tx) => {
            const admission = await createSmsAdmission({ enabled: () => enabled })(tx, {
              ...command,
              userId: owner,
            });
            if (admission.state !== "verified") throw new Error("Missing admission");
            await admission.consume(accepted);
          });
          receipt = accepted;
          return accepted;
        },
      },
    });
    const held = await service.runPage(f.userId, { limit: 10 });
    expect(held.claims[0]?.children).toEqual([
      {
        bindingId: f.binding.id,
        operationId: f.operationId,
        state: "waiting",
        reason: "texting_disabled",
        terminal: false,
      },
    ]);
    expect(executed).toEqual([]);
    enabled = true;
    const resumed = await service.runPage(f.userId, { limit: 10 });
    expect(resumed.claims[0]?.children[0]).toMatchObject({
      bindingId: f.binding.id,
      operationId: f.operationId,
      state: "accepted",
    });
    expect(executed).toEqual([f.operationId]);
  });

  it.each([
    { status: "failed", state: "blocked", reason: "delivery_failed" },
    { status: "unknown", state: "waiting", reason: "delivery_unconfirmed" },
  ] as const)("does not execute an attached child after outbound status becomes $status", async ({
    status,
    state,
    reason,
  }) => {
    const f = await fixture();
    await database.db
      .update(textMessages)
      .set({ status })
      .where(eq(textMessages.id, f.binding.outboundMessageId));
    let executions = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async () => ({ state: "absent" }),
        executeAnswer: async () => {
          executions += 1;
          throw new Error("must not execute");
        },
      },
    });
    const result = await service.runPage(f.userId, { limit: 10 });
    expect(result.claims[0]?.children[0]).toEqual({
      bindingId: f.binding.id,
      operationId: f.operationId,
      state,
      reason,
      terminal: false,
    });
    expect(executions).toBe(0);
    const [stored] = await database.db
      .select()
      .from(textReplyBindings)
      .where(eq(textReplyBindings.id, f.binding.id));
    expect(stored?.state).toBe("pending");
  });

  it("keeps a policy-check failure nonterminal for both attached children", async () => {
    const f = await fixture(2);
    if (!f.secondBinding) throw new Error("Missing second child");
    let executions = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => {
        throw new Error("flag store unavailable");
      },
      finance: {
        inspectSmsReceipt: async () => ({ state: "absent" }),
        executeAnswer: async () => {
          executions += 1;
          throw new Error("must not execute");
        },
      },
    });
    const result = await service.runPage(f.userId, { limit: 10 });
    expect(result.claims[0]?.children).toEqual([
      {
        bindingId: f.binding.id,
        operationId: f.operationId,
        state: "waiting",
        reason: "policy_check_failed",
        terminal: false,
      },
      {
        bindingId: f.secondBinding.id,
        operationId: f.secondBinding.operationId,
        state: "waiting",
        reason: "policy_check_failed",
        terminal: false,
      },
    ]);
    expect(executions).toBe(0);
  });

  it("does not execute an expired attached child without a Finance receipt", async () => {
    const f = await fixture();
    let executions = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      now: () => new Date(f.binding.expiresAt.getTime() + 1),
      finance: {
        inspectSmsReceipt: async () => ({ state: "absent" }),
        executeAnswer: async () => {
          executions += 1;
          throw new Error("must not execute");
        },
      },
    });
    const result = await service.runPage(f.userId, { limit: 10 });
    expect(result.claims[0]?.children[0]).toEqual({
      bindingId: f.binding.id,
      operationId: f.operationId,
      state: "blocked",
      reason: "source_unavailable",
      terminal: false,
    });
    expect(executions).toBe(0);
  });

  it("does not turn a receipt read failure into absence or execute Finance", async () => {
    const f = await fixture();
    let executions = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async () => {
          throw new Error("database unavailable");
        },
        executeAnswer: async () => {
          executions += 1;
          throw new Error("must not execute");
        },
      },
    });
    const result = await service.runPage(f.userId, { limit: 10 });
    expect(result.claims[0]?.children[0]).toEqual({
      bindingId: f.binding.id,
      operationId: f.operationId,
      state: "uncertain",
      reason: "receipt_inspection_failed",
      terminal: false,
    });
    expect(executions).toBe(0);
    const [stored] = await database.db
      .select()
      .from(textReplyBindings)
      .where(eq(textReplyBindings.id, f.binding.id));
    expect(stored?.state).toBe("pending");
  });

  it("retries an aborted Finance mutation only with the original child operation", async () => {
    const f = await fixture();
    const accepted: FinanceDomainOutcome & { state: "accepted" } = {
      operationId: f.operationId,
      state: "accepted",
      work: [f.command.work],
      resultRevision: "result-1",
      reasonCode: null,
    };
    let receipt: FinanceDomainOutcome | null = null;
    const executed: string[] = [];
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async () =>
          receipt ? { state: "completed", outcome: receipt } : { state: "absent" },
        executeAnswer: async (owner, command) => {
          executed.push(command.operationId);
          if (executed.length === 1) throw new Error("transaction aborted before receipt");
          await database.db.transaction(async (tx) => {
            const admission = await createSmsAdmission({ enabled: () => true })(tx, {
              ...command,
              userId: owner,
            });
            if (admission.state !== "verified") throw new Error("Missing admission");
            await admission.consume(accepted);
          });
          receipt = accepted;
          return accepted;
        },
      },
    });
    const first = await service.runPage(f.userId, { limit: 10 });
    expect(first.claims[0]?.children[0]).toMatchObject({
      operationId: f.operationId,
      state: "uncertain",
      reason: "answer_uncertain",
      terminal: false,
    });
    const second = await service.runPage(f.userId, { limit: 10 });
    expect(second.claims[0]?.children[0]).toMatchObject({
      operationId: f.operationId,
      state: "accepted",
      terminal: true,
    });
    expect(executed).toEqual([f.operationId, f.operationId]);
  });

  it("reinspects after a lost Finance response and preserves its committed acceptance", async () => {
    const f = await fixture();
    const accepted: FinanceDomainOutcome & { state: "accepted" } = {
      operationId: f.operationId,
      state: "accepted",
      work: [f.command.work],
      resultRevision: "result-1",
      reasonCode: null,
    };
    let receipt: FinanceDomainOutcome | null = null;
    let executions = 0;
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async () =>
          receipt ? { state: "completed", outcome: receipt } : { state: "absent" },
        executeAnswer: async (owner, command) => {
          executions += 1;
          await database.db.transaction(async (tx) => {
            const admission = await createSmsAdmission({ enabled: () => true })(tx, {
              ...command,
              userId: owner,
            });
            if (admission.state !== "verified") throw new Error("Missing admission");
            await admission.consume(accepted);
          });
          receipt = accepted;
          throw new Error("response lost after commit");
        },
      },
    });
    const result = await service.runPage(f.userId, { limit: 10 });
    expect(result.claims[0]?.children[0]).toMatchObject({
      state: "accepted",
      operationId: f.operationId,
    });
    expect(executions).toBe(1);
    expect((await service.runPage(f.userId, { limit: 10 })).claims).toEqual([]);
  });

  it("isolates a busy child so its sibling still gets an exact receipt status", async () => {
    const f = await fixture(2);
    if (!f.secondBinding) throw new Error("Missing second child");
    await database.db
      .update(textReplyBindings)
      .set({ state: "waiting", reasonCode: "delivery_unconfirmed" })
      .where(eq(textReplyBindings.id, f.binding.id));
    let releaseLock: (() => void) | undefined;
    let signalLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const locker = database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from text_reply_bindings where id = ${f.binding.id} for update`,
      );
      signalLocked?.();
      await held;
    });
    try {
      await locked;
      let executions = 0;
      const service = createTextingRecoveryService({
        db: database.db,
        enabled: () => true,
        finance: {
          inspectSmsReceipt: async (_owner, command) =>
            command.operationId === f.operationId
              ? { state: "absent" }
              : { state: "incomplete", status: "failed" },
          executeAnswer: async () => {
            executions += 1;
            throw new Error("must not execute");
          },
        },
      });
      const result = await service.runPage(f.userId, { limit: 10 });
      expect(result.claims[0]?.children).toEqual([
        {
          bindingId: f.binding.id,
          operationId: f.operationId,
          state: "uncertain",
          reason: "child_recovery_failed",
          terminal: false,
        },
        {
          bindingId: f.secondBinding.id,
          operationId: f.secondBinding.operationId,
          state: "uncertain",
          reason: "finance_receipt_failed",
          terminal: false,
        },
      ]);
      expect(executions).toBe(0);
    } finally {
      releaseLock?.();
      await locker;
    }
  }, 15_000);

  it("retains a projected child when the independent expiration sweep is locked", async () => {
    const f = await fixture();
    const [unsent] = await database.db
      .insert(textMessages)
      .values({
        userId: f.userId,
        connectionId: f.connection.id,
        body: "Unanswered prompt",
        direction: "outbound",
        status: "queued",
        occurredAt: new Date(Date.now() - 120_000),
        occurredAtSource: "nohmi",
      })
      .returning();
    if (!unsent) throw new Error("Missing outbound");
    const [open] = await database.db
      .insert(textReplyBindings)
      .values({
        userId: f.userId,
        connectionId: f.connection.id,
        outboundMessageId: unsent.id,
        consentEpoch: f.connection.consentEpoch,
        itemNumber: 1,
        workKind: "question",
        workId: randomUUID(),
        workRevision: "1",
        actionRevision: "1",
        answerMode: "free_text",
        answerVocabulary: null,
        expiresAt: new Date(Date.now() - 60_000),
        operationId: randomUUID(),
        state: "open",
      })
      .returning();
    if (!open) throw new Error("Missing open binding");
    let releaseLock: (() => void) | undefined;
    let signalLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const locker = database.db.transaction(async (tx) => {
      await tx.execute(sql`select id from text_reply_bindings where id = ${open.id} for update`);
      signalLocked?.();
      await held;
    });
    try {
      await locked;
      const service = createTextingRecoveryService({
        db: database.db,
        enabled: () => true,
        finance: {
          inspectSmsReceipt: async () => ({
            state: "completed",
            outcome: {
              operationId: f.operationId,
              state: "blocked",
              work: [f.command.work],
              resultRevision: null,
              reasonCode: "stale_revision",
            },
          }),
          executeAnswer: async () => {
            throw new Error("must not execute");
          },
        },
      });
      const result = await service.runPage(f.userId, { limit: 10 });
      expect(result.claims[0]?.children[0]).toMatchObject({
        bindingId: f.binding.id,
        state: "blocked",
        terminal: true,
      });
      expect(result.expirationSweep).toEqual({
        state: "uncertain",
        reason: "expiration_sweep_failed",
      });
      const [stored] = await database.db
        .select()
        .from(textReplyBindings)
        .where(eq(textReplyBindings.id, f.binding.id));
      expect(stored?.state).toBe("blocked");
    } finally {
      releaseLock?.();
      await locker;
    }
  }, 15_000);

  it("pages same-time claims by exact UUID and restarts to see a lower new ID", async () => {
    const [lowerId, middleId, upperId] = [randomUUID(), randomUUID(), randomUUID()].sort();
    if (!lowerId || !middleId || !upperId) throw new Error("Missing page IDs");
    const timestamp = new Date(Date.now() + 5_000);
    const f = await fixture(1, middleId, timestamp);
    const addClaim = async (id: string) => {
      const [message] = await database.db
        .insert(textMessages)
        .values({
          userId: f.userId,
          connectionId: f.connection.id,
          body: "Another reply",
          direction: "inbound",
          status: "delivered",
          providerMessageSid: randomUUID(),
          occurredAt: new Date(timestamp.getTime() + 30_000),
          occurredAtSource: "provider",
        })
        .returning();
      if (!message) throw new Error("Missing inbound message");
      await database.db.insert(textInboundClaims).values({
        id,
        userId: f.userId,
        connectionId: f.connection.id,
        messageId: message.id,
        consentEpoch: f.connection.consentEpoch,
        createdAt: timestamp,
      });
      return message.id;
    };
    await addClaim(upperId);
    const service = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: async () => ({ state: "incomplete", status: "started" }),
        executeAnswer: async () => {
          throw new Error("must not execute");
        },
      },
    });
    const first = await service.runPage(f.userId, { limit: 1 });
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual({ claimId: middleId });
    const laterMessageId = await addClaim(lowerId);
    if (!first.nextCursor) throw new Error("Missing page cursor");
    const second = await service.runPage(f.userId, { limit: 1, after: first.nextCursor });
    expect(second.claims[0]?.inboundMessageId).not.toBe(laterMessageId);
    const fresh = await service.runPage(f.userId, { limit: 3 });
    expect(fresh.claims).toHaveLength(3);
    expect(fresh.claims.some((claim) => claim.inboundMessageId === laterMessageId)).toBe(true);
  });
});
