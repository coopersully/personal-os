import { resolve } from "node:path";
import type { TwilioConnector } from "@personal-os/connectors";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeAgentActionReviews,
  financeCategories,
  financeContextualQuestions,
  financeMaintenanceCandidates,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  notificationAttemptItems,
  notificationDeliveryAttempts,
  notificationIntents,
  textingConnections,
  textingConsentEvents,
  textMessages,
  textReplyBindings,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  defaultNotificationPreferences,
  type FinanceHumanWorkRef,
  financePositionFactNames,
  type NotificationWork,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { createFinanceContextualQuestionService } from "./finance/contextual-question-service.js";
import { guardFinanceExecutionTransaction } from "./finance/execution-owner-guard.js";
import { issueMaintenanceReviewQuestion } from "./finance/review-action-service.js";
import { financeRunAttentionWork, resolveFinanceWorks } from "./finance/work-resolver.js";
import { createFinanceNotificationDispatcher } from "./finance-notification-runtime.js";
import { createNotificationService } from "./notification-service.js";
import type { NotificationWorkResolver } from "./notification-work-resolver.js";
import { encryptJson } from "./security.js";
import { createTextingService } from "./texting-service.js";
import type { Principal } from "./types.js";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const ref: FinanceHumanWorkRef = {
  id: "33333333-3333-4333-8333-333333333333",
  domain: "finances",
  kind: "question",
  revision: "r1",
  actionRevision: "a1",
};
const secondRef: FinanceHumanWorkRef = {
  ...ref,
  id: "44444444-4444-4444-8444-444444444444",
};
const principal: Principal = {
  userId: owner,
  actorId: owner,
  actorType: "user",
  scopes: new Set(["texting:read", "texting:write", "finances:read"]),
};
const encryptionKey = Buffer.alloc(32, 7).toString("base64");

describe.sequential("durable notifications", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let current = new Date("2026-03-08T12:00:00Z");
  let send: ReturnType<typeof vi.fn>;
  let service: ReturnType<typeof createNotificationService>;
  let texting: ReturnType<typeof createTextingService>;
  let resolver: NotificationWorkResolver;
  const now = () => current;
  const makeService = (resolveWork: NotificationWorkResolver | undefined = resolver) =>
    createNotificationService({
      db: database.db,
      origin: "https://nohmi.test",
      transport: texting,
      now,
      resolveWork,
    });
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    // An injected domain fixture with real PostgreSQL locking proves the adapter's transactional
    // handoff. This is not a claim that the future Finance producer's mutation paths are wired.
    await database.db.execute(
      sql`CREATE TABLE notification_test_work (id uuid PRIMARY KEY, user_id uuid NOT NULL, value jsonb NOT NULL)`,
    );
    resolver = async (userId, works, tx) => {
      const values = new Map<string, NotificationWork>();
      for (const work of [...works].sort((a, b) => a.id.localeCompare(b.id))) {
        const result = await tx.execute(
          sql`SELECT value FROM notification_test_work WHERE id=${work.id} AND user_id=${userId} FOR UPDATE NOWAIT`,
        );
        const value = result.rows[0]?.value as NotificationWork | undefined;
        if (value) values.set(work.id, value);
      }
      return works.map((work) => {
        const value = values.get(work.id);
        return value ? { state: "current", value } : { state: "unavailable" };
      });
    };
  }, 120_000);
  afterAll(async () => {
    await database.close();
    await container.stop();
  });
  beforeEach(async () => {
    await database.db.execute(sql`DELETE FROM notification_test_work`);
    await database.db.delete(users);
    current = new Date("2026-03-08T12:00:00Z");
    for (const userId of [owner, other]) {
      await database.db.insert(users).values({
        id: userId,
        email: `${userId}@example.test`,
        displayName: "Test",
        passwordHash: "unused",
        planningTimezone: "America/New_York",
      });
      await database.db.insert(textingConnections).values({
        userId,
        encryptedPhoneNumber: encryptJson({ e164: "+12125550123" }, encryptionKey),
        phoneFingerprint: userId,
        phoneLastFour: "0123",
        country: "US",
        state: "active",
        consentVersion: "test",
        verifiedAt: current,
      });
    }
    await putWork(ref);
    send = vi.fn(async () => ({ sid: `SM${crypto.randomUUID()}`, status: "queued" }));
    texting = createTextingService({
      db: database.db,
      apiBaseUrl: "https://nohmi.test",
      enabled: true,
      encryptionKey,
      senderPhoneNumber: "+12125550124",
      now,
      twilio: { sendMessage: send } as unknown as TwilioConnector,
    });
    service = makeService();
  });
  it.each([
    "blocked",
    "failed_terminal",
    "completed",
    "completed_with_questions",
    "awaiting_approval",
    "queued",
  ] as const)("discovers only actionable attention, deduplicates scans and honors default reminders: %s", async (status) => {
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: owner,
        domain: "finances",
        scope: { type: "all_outstanding" },
        status,
        rulebookVersion: "test",
        createdAt: current,
        updatedAt: current,
      })
      .returning();
    if (!run) throw new Error("run");
    service = makeService(resolveFinanceWorks);
    const dispatch = () =>
      createFinanceNotificationDispatcher({
        db: database.db,
        enabled: () => true,
        notifications: service,
      });
    const scan = dispatch();
    await scan();
    await scan();
    await dispatch()();
    const actionable = status === "blocked" || status === "failed_terminal";
    expect(send).toHaveBeenCalledTimes(actionable ? 1 : 0);
    const state = await service.status(principal);
    expect(state.intents).toHaveLength(actionable ? 1 : 0);
    if (actionable) {
      expect(state.intents[0]?.work).toMatchObject({
        ...financeRunAttentionWork(run),
      });
      current = new Date(current.getTime() + 8 * 86400000);
      await scan();
      expect(send).toHaveBeenCalledTimes(2);
    }
  });

  async function attentionFixture(id?: string) {
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        id,
        userId: owner,
        domain: "finances",
        scope: { type: "all_outstanding" },
        status: "blocked",
        rulebookVersion: "test",
        createdAt: current,
        updatedAt: current,
      })
      .returning();
    if (!run) throw new Error("run");
    service = makeService(resolveFinanceWorks);
    const work = financeRunAttentionWork(run);
    await service.publish(principal, { work: [work] });
    return { run, work };
  }
  it.each([
    ["question", false],
    ["approval", false],
    ["question", true],
    ["approval", true],
  ] as const)("preserves exact bindings for unrelated %s mixed with repair (legacy claim=%s)", async (kind, legacyClaim) => {
    await attentionFixture();
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId: owner, provider: "manual", institution: "Cash", name: "Cash" })
      .returning();
    if (!account) throw new Error("account");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId: owner,
        accountId: account.id,
        amount: 1200,
        merchant: "Lunch",
        direction: "expense",
        transactionDate: "2026-03-08",
      })
      .returning();
    if (!transaction) throw new Error("transaction");
    let interactive: FinanceHumanWorkRef;
    if (kind === "question") {
      const result = await createFinanceContextualQuestionService({
        db: database.db,
        now,
      }).createQuestion(
        transaction.id,
        { operationId: crypto.randomUUID() },
        {
          principal: { ...principal, scopes: new Set([...principal.scopes, "finances:write"]) },
          requestId: "unrelated-question",
        },
      );
      if (result.state !== "available") throw new Error("question");
      interactive = result.question.work;
    } else {
      const [category] = await database.db
        .insert(financeCategories)
        .values({ userId: owner, group: "Expenses", name: "Dining", slug: "dining" })
        .returning();
      if (!category) throw new Error("category");
      const [review] = await database.db
        .insert(financeAgentActionReviews)
        .values({
          userId: owner,
          requestingAgentId: "test-agent",
          actionKind: "categorization",
          fingerprint: crypto.randomUUID(),
          privatePayload: {
            input: {
              decisions: [
                { transactionId: transaction.id, categoryId: category.id, learnMerchant: "never" },
              ],
            },
          },
          safeChanges: [
            {
              entityType: "finance_transaction",
              entityId: transaction.id,
              summary: "Categorize Lunch as Dining.",
            },
          ],
          createdAt: current,
          updatedAt: current,
        })
        .returning();
      if (!review) throw new Error("review");
      interactive = {
        id: review.id,
        domain: "finances",
        kind: "approval",
        revision: review.updatedAt.getTime().toString(),
        actionRevision: review.updatedAt.getTime().toString(),
      };
    }
    await service.publish(principal, { work: [interactive] });
    let legacyId: string | null = null;
    if (legacyClaim) {
      const claim = await claimed();
      legacyId = claim.id;
      const repair = (await database.db.select().from(notificationIntents)).find(
        (item) => item.work.kind === "repair",
      );
      if (!repair) throw new Error("repair");
      // Reproduce the immutable mixed membership committed by a pre-partition process.
      await database.db
        .insert(notificationAttemptItems)
        .values({ userId: owner, attemptId: claim.id, intentId: repair.id, work: repair.work });
      await service.deliver(principal, claim);
      expect(send).not.toHaveBeenCalled();
      expect((await service.status(principal)).attempts[0]?.reason).toBe(
        "unsupported_delivery_shape",
      );
    }
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].body).toContain(
      kind === "question" ? "Reply with the item number and answer" : "Reply 1 approve or 1 reject",
    );
    expect(await database.db.select().from(textReplyBindings)).toMatchObject([
      {
        workId: interactive.id,
        workKind: kind,
        itemNumber: 1,
        state: "open",
        answerMode: kind === "question" ? "free_text" : "choices",
      },
    ]);
    expect(
      (await database.db.select().from(notificationAttemptItems))
        .filter((item) => item.attemptId !== legacyId)
        .map((item) => item.work.id),
    ).toEqual([interactive.id]);
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].body).toContain("maintenance needs attention");
    expect(await database.db.select().from(textReplyBindings)).toHaveLength(1);
  });

  it("deduplicates the same unresolved action across runs and admits a material action change", async () => {
    const { run } = await attentionFixture();
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        status: "failed_terminal",
        lastSafeError: { code: "forbidden", message: "Old wording" },
      })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const scan = () =>
      createFinanceNotificationDispatcher({
        db: database.db,
        notifications: service,
        enabled: () => true,
      });
    await scan()();
    expect(send).toHaveBeenCalledTimes(1);
    const first = (await service.status(principal)).intents.find(
      (item) => item.work.kind === "repair",
    );
    for (const code of ["forbidden", "not_found"]) {
      current = new Date(current.getTime() + 1000);
      const [next] = await database.db
        .insert(workspaceMaintenanceRuns)
        .values({
          userId: owner,
          domain: "finances",
          scope: run.scope,
          status: "failed_terminal",
          rulebookVersion: "test",
          lastSafeError: { code, message: "New wording" },
          createdAt: current,
          updatedAt: current,
        })
        .returning();
      if (!next) throw new Error("next");
      await scan()();
      const state = await service.status(principal);
      expect(state.intents.filter((item) => item.work.kind === "repair")).toHaveLength(1);
      expect(state.intents[0]?.work.id).toBe(first?.work.id);
      expect(state.intents[0]?.work.revision).toBe(next.id);
      expect(send).toHaveBeenCalledTimes(code === "forbidden" ? 1 : 2);
    }
  });

  it("opens a new same-code episode only after authoritative completion of the same scope", async () => {
    const { run } = await attentionFixture();
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "failed_terminal" })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const scan = createFinanceNotificationDispatcher({
      db: database.db,
      notifications: service,
      enabled: () => true,
    });
    await scan();
    const first = (await service.status(principal)).intents[0]?.work;
    current = new Date(current.getTime() + 1000);
    // A completed different target cannot resolve this broad-scope blocker.
    await database.db.insert(workspaceMaintenanceRuns).values({
      userId: owner,
      domain: "finances",
      scope: { type: "target", entityType: "transaction", id: crypto.randomUUID() },
      status: "completed",
      rulebookVersion: "test",
      createdAt: current,
    });
    current = new Date(current.getTime() + 1000);
    await database.db.insert(workspaceMaintenanceRuns).values({
      userId: owner,
      domain: "finances",
      scope: run.scope,
      status: "failed_terminal",
      rulebookVersion: "test",
      createdAt: current,
    });
    await scan();
    expect(send).toHaveBeenCalledTimes(1);
    current = new Date(current.getTime() + 1000);
    await database.db.insert(workspaceMaintenanceRuns).values({
      userId: owner,
      domain: "finances",
      scope: run.scope,
      status: "completed",
      rulebookVersion: "test",
      createdAt: current,
    });
    current = new Date(current.getTime() + 1000);
    const [next] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: owner,
        domain: "finances",
        scope: run.scope,
        status: "failed_terminal",
        rulebookVersion: "test",
        createdAt: current,
      })
      .returning();
    await scan();
    expect(send).toHaveBeenCalledTimes(2);
    const state = await service.status(principal);
    expect(state.intents).toHaveLength(1);
    expect(state.intents[0]?.work.id).toBe(first?.id);
    expect(state.intents[0]?.work.actionRevision).not.toBe(first?.actionRevision);
    expect(state.intents[0]?.work.revision).toBe(next?.id);
    // History pagination cannot truncate the completed episode boundary or reset its identity.
    await database.db.insert(workspaceMaintenanceRuns).values(
      Array.from({ length: 51 }, (_, i) => ({
        userId: owner,
        domain: "finances" as const,
        scope: run.scope,
        status: "failed_terminal" as const,
        rulebookVersion: "test",
        createdAt: new Date(current.getTime() + (i + 1) * 1000),
      })),
    );
    current = new Date(current.getTime() + 52_000);
    await scan();
    expect(send).toHaveBeenCalledTimes(2);
    expect((await service.status(principal)).intents[0]?.work.actionRevision).toBe(
      state.intents[0]?.work.actionRevision,
    );
  });

  it("distinguishes material canonical targets within all-outstanding without hashing evidence churn", async () => {
    const { run } = await attentionFixture();
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "failed_terminal" })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const scan = createFinanceNotificationDispatcher({
      db: database.db,
      notifications: service,
      enabled: () => true,
    });
    const targetA = crypto.randomUUID();
    const targetB = crypto.randomUUID();
    for (const [i, accountId] of [
      targetA,
      null,
      targetA,
      targetB,
      targetA,
      null,
      targetA,
    ].entries()) {
      current = new Date(current.getTime() + 1000);
      await database.db.insert(workspaceMaintenanceRuns).values({
        userId: owner,
        domain: "finances",
        scope: run.scope,
        status: "failed_terminal",
        rulebookVersion: "test",
        createdAt: current,
        settledResult: {
          code: "finance_position_evidence_unavailable",
          position: accountId
            ? {
                revision: `incidental-${i}`,
                scope: { accountIds: [accountId], from: "2026-03-01", through: "2026-03-31" },
                facts: Object.fromEntries(
                  financePositionFactNames.map((name) => [
                    name,
                    { quality: "unavailable", reasons: ["source_unavailable"] },
                  ]),
                ),
              }
            : undefined,
        },
      });
      await scan();
      expect(send).toHaveBeenCalledTimes(i >= 4 ? 3 : i === 3 ? 2 : 1);
    }
  });

  it.each([1, null])("honors configured repair reminders across runs: %s", async (reminderDays) => {
    const { run } = await attentionFixture();
    await service.savePreferences(principal, "global", {
      expectedRevision: null,
      preferences: { ...defaultNotificationPreferences, reminderDays },
    });
    await service.drain(principal);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "failed_terminal" })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const scan = createFinanceNotificationDispatcher({
      db: database.db,
      notifications: service,
      enabled: () => true,
    });
    current = new Date(current.getTime() + 12 * 3600000);
    await database.db.insert(workspaceMaintenanceRuns).values({
      userId: owner,
      domain: "finances",
      scope: run.scope,
      status: "failed_terminal",
      rulebookVersion: "test",
      createdAt: current,
    });
    await scan();
    expect(send).toHaveBeenCalledTimes(1);
    current = new Date(current.getTime() + 12 * 3600000);
    await scan();
    expect(send).toHaveBeenCalledTimes(reminderDays === null ? 1 : 2);
  });

  it("suppresses an old claimed episode without retargeting its immutable membership", async () => {
    const { run, work } = await attentionFixture();
    const claim = await claimed();
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "failed_terminal" })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    current = new Date(current.getTime() + 1000);
    await database.db.insert(workspaceMaintenanceRuns).values({
      userId: owner,
      domain: "finances",
      scope: run.scope,
      status: "completed",
      rulebookVersion: "test",
      createdAt: current,
    });
    current = new Date(current.getTime() + 1000);
    const [next] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: owner,
        domain: "finances",
        scope: run.scope,
        status: "failed_terminal",
        rulebookVersion: "test",
        createdAt: current,
      })
      .returning();
    await service.deliver(principal, claim);
    expect(send).not.toHaveBeenCalled();
    expect((await service.status(principal)).attempts[0]?.reason).toBe("resolved");
    await createFinanceNotificationDispatcher({
      db: database.db,
      notifications: service,
      enabled: () => true,
    })();
    expect(send).toHaveBeenCalledTimes(1);
    const membership = await database.db
      .select()
      .from(notificationAttemptItems)
      .where(eq(notificationAttemptItems.attemptId, claim.id));
    expect(membership).toMatchObject([{ work }]);
    const state = await service.status(principal);
    expect(state.intents).toHaveLength(1);
    expect(state.intents[0]?.work.revision).toBe(next?.id);
    expect(state.intents[0]?.work.actionRevision).not.toBe(work.actionRevision);
  });

  it("preserves uncertainty across new runs and material action revisions", async () => {
    const { run } = await attentionFixture();
    send.mockRejectedValueOnce(new Error("unknown handoff"));
    await service.drain(principal);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "failed_terminal" })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    for (const code of ["internal_error", "forbidden"]) {
      current = new Date(current.getTime() + 1000);
      await database.db.insert(workspaceMaintenanceRuns).values({
        userId: owner,
        domain: "finances",
        scope: run.scope,
        status: "completed",
        rulebookVersion: "test",
        createdAt: current,
      });
      current = new Date(current.getTime() + 1000);
      await database.db.insert(workspaceMaintenanceRuns).values({
        userId: owner,
        domain: "finances",
        scope: run.scope,
        status: "failed_terminal",
        rulebookVersion: "new-version",
        lastSafeError: { code, message: "new message" },
        createdAt: current,
        updatedAt: current,
      });
      await createFinanceNotificationDispatcher({
        db: database.db,
        notifications: service,
        enabled: () => true,
      })();
      expect(send).toHaveBeenCalledTimes(1);
      expect((await service.status(principal)).intents).toHaveLength(1);
    }
  });
  it("revalidates resolved attention before submission and cannot resolve another owner's run", async () => {
    const { run, work } = await attentionFixture();
    const resolution = await database.db.transaction((tx) =>
      resolveFinanceWorks(other, [work], tx),
    );
    expect(resolution).toEqual([{ state: "unavailable" }]);
    const claim = await claimed();
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "completed" })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await service.deliver(principal, claim);
    expect(send).not.toHaveBeenCalled();
    expect((await service.status(principal)).attempts[0]?.reason).toBe("resolved");
  });
  it("suppresses historical failure attention once a newer run exists", async () => {
    const { work } = await attentionFixture();
    await database.db.insert(workspaceMaintenanceRuns).values({
      userId: owner,
      domain: "finances",
      scope: { type: "all_outstanding" },
      status: "completed",
      rulebookVersion: "test",
      createdAt: new Date(current.getTime() + 1000),
    });
    await service.drain(principal);
    expect(send).not.toHaveBeenCalled();
    expect(
      (await service.status(principal)).intents.find((item) => item.work.id === work.id)?.state,
    ).toBe("resolved");
  });
  it.each([
    "current",
    "terminal",
    "orphan",
    "page_before",
    "page_after",
  ] as const)("only a current actionable question suppresses repair: %s", async (mode) => {
    const { run } = await attentionFixture(
      mode === "page_before"
        ? "00000000-0000-4000-8000-000000000001"
        : mode === "page_after"
          ? "ffffffff-ffff-4fff-8fff-ffffffffffff"
          : undefined,
    );
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId: owner, provider: "manual", institution: "Manual", name: "Cash" })
      .returning();
    if (!account) throw new Error("account");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId: owner,
        accountId: account.id,
        amount: 1200,
        merchant: "Lunch",
        direction: "expense",
        transactionDate: "2026-03-08",
      })
      .returning();
    if (!transaction) throw new Error("transaction");
    const created = await createFinanceContextualQuestionService({
      db: database.db,
      now,
    }).createQuestion(
      transaction.id,
      { operationId: crypto.randomUUID() },
      {
        principal: { ...principal, scopes: new Set([...principal.scopes, "finances:write"]) },
        requestId: "attention-question",
      },
    );
    if (created.state !== "available") throw new Error("question");
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({ userId: owner, runId: run.id, revision: "attention-test", state: "challenged" })
      .returning();
    if (!candidate) throw new Error("candidate");
    await database.db
      .delete(financeContextualQuestions)
      .where(eq(financeContextualQuestions.id, created.question.id));
    await database.db
      .update(financeReviewCases)
      .set({
        evidence: {
          maintenanceRunId: run.id,
          candidateId: candidate.id,
          candidateRevision: candidate.revision,
          prompt: "What did this transaction represent?",
        },
      })
      .where(eq(financeReviewCases.id, created.question.reviewCaseId));
    await database.db.transaction(async (tx) => {
      await guardFinanceExecutionTransaction(tx, owner, {});
      await issueMaintenanceReviewQuestion(tx, owner, created.question.reviewCaseId);
    });
    if (mode === "terminal")
      await database.db
        .update(workspaceMaintenanceRuns)
        .set({ status: "failed_terminal" })
        .where(eq(workspaceMaintenanceRuns.id, run.id));
    if (mode === "orphan")
      await database.db
        .update(financeMaintenanceCandidates)
        .set({ state: "superseded" })
        .where(eq(financeMaintenanceCandidates.id, candidate.id));
    if (mode.startsWith("page_")) {
      // Force 26 discovered stale rows strictly between the current question and source run.
      const prefix =
        Number.parseInt(created.question.reviewCaseId.slice(0, 8), 16) +
        (mode === "page_before" ? -1 : 1);
      for (let i = 0; i < 26; i++) {
        const id = `${prefix.toString(16).padStart(8, "0")}-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
        await database.db.insert(notificationIntents).values({
          userId: owner,
          domain: "finances",
          workId: id,
          work: { id, domain: "finances", kind: "question", revision: "1", actionRevision: "1" },
        });
      }
    }
    const errors: unknown[] = [];
    const scan = createFinanceNotificationDispatcher({
      db: database.db,
      notifications: {
        publish: async (...args) => {
          try {
            return await service.publish(...args);
          } catch (error) {
            errors.push(error);
            throw error;
          }
        },
        drain: (...args) => service.drain(...args),
      },
      enabled: () => true,
    });
    const scanResult = await scan();
    if (mode.startsWith("page_")) {
      expect(scanResult.processed).toBe(25);
      // Drain through both boundaries and wrap the cursor: ordering cannot own currentness.
      for (let i = 0; i < 4; i++) expect((await scan()).failed).toBe(0);
    }
    expect(errors).toEqual([]);
    expect(scanResult.failed).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const bindings = await database.db.select().from(textReplyBindings);
    if (mode === "current" || mode.startsWith("page_")) {
      expect(send.mock.calls[0]?.[0].body).toContain("Reply with the item number and answer");
      expect(bindings).toMatchObject([
        { workKind: "question", workId: created.question.reviewCaseId },
      ]);
    } else {
      expect(send.mock.calls[0]?.[0].body).toContain("maintenance needs attention");
      expect(bindings).toEqual([]);
    }
  });
  it("bounds known provider rejections while retaining every correlated attempt", async () => {
    const { work } = await attentionFixture();
    send.mockRejectedValue({ status: 400, code: 21614, message: "private provider details" });
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    current = new Date(current.getTime() + 60_000);
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(2);
    current = new Date(current.getTime() + 299_999);
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(2);
    current = new Date(current.getTime() + 1);
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(3);
    current = new Date(current.getTime() + 86400000);
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(3);
    const state = await service.status(principal);
    expect(state.intents[0]).toMatchObject({ work, reason: "retry_exhausted" });
    expect(state.attempts).toHaveLength(3);
    expect(state.attempts.every((attempt) => attempt.state === "failed" && attempt.messageId)).toBe(
      true,
    );
    expect(JSON.stringify(state)).not.toContain("private provider details");
  });
  it("does not retry uncertain attention across rediscovery or restart", async () => {
    await attentionFixture();
    send.mockRejectedValueOnce(new Error("unknown provider acceptance"));
    await service.drain(principal);
    current = new Date(current.getTime() + 8 * 86400000);
    const restart = createFinanceNotificationDispatcher({
      db: database.db,
      notifications: makeService(resolveFinanceWorks),
      enabled: () => true,
    });
    await restart();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await service.status(principal)).attempts[0]).toMatchObject({
      state: "uncertain",
      recovery: "reconcile_delivery",
    });
  });
  it("honors global opt-out even when a Finance override is enabled", async () => {
    await attentionFixture();
    await service.savePreferences(principal, "global", {
      expectedRevision: null,
      preferences: { ...defaultNotificationPreferences, enabled: false },
    });
    await service.savePreferences(principal, "finances", {
      expectedRevision: null,
      preferences: defaultNotificationPreferences,
    });
    await service.drain(principal);
    expect(send).not.toHaveBeenCalled();
    expect((await service.status(principal)).effective.enabled).toBe(false);
  });

  async function putWork(work: FinanceHumanWorkRef, extra: Partial<NotificationWork> = {}) {
    const value: NotificationWork = {
      work,
      active: true,
      expiresAt: null,
      disclosure: "context",
      context: "Dinner",
      occurredAt: "2026-03-07T23:00:00Z",
      destination: "/finances?review=open",
      ...extra,
    };
    await database.db.execute(sql`INSERT INTO notification_test_work VALUES (${work.id}, ${owner}, ${JSON.stringify(value)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value`);
  }
  async function claimed() {
    const result = await service.claim(principal);
    if (result.state !== "claimed") throw new Error(`Expected claim, got ${result.state}`);
    return result;
  }
  async function withLockedWork(work: FinanceHumanWorkRef, action: () => Promise<void>) {
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const locking = database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM notification_test_work WHERE id=${work.id} FOR UPDATE`);
      entered();
      await held;
    });
    await ready;
    try {
      await action();
    } finally {
      release();
      await locking;
    }
  }
  it("keeps absent producers unavailable and rejects missing caller authority", async () => {
    const unavailable = createNotificationService({
      db: database.db,
      origin: "https://nohmi.test",
      transport: texting,
      now,
    });
    expect(await unavailable.publish(principal, { work: [ref] })).toEqual({
      state: "unavailable",
      reason: "producer_not_registered",
    });
    expect(await unavailable.drain(principal)).toEqual({
      state: "unavailable",
      reason: "producer_not_registered",
    });
    expect((await unavailable.status(principal)).capability).toBe("unavailable");
    await expect(
      service.publish({ ...principal, scopes: new Set(["texting:read"]) }, { work: [ref] }),
    ).rejects.toThrow("requires");
    expect(send).not.toHaveBeenCalled();
  });
  it("passes one positional batch per publish, claim, and delivery transaction", async () => {
    await putWork(secondRef, { context: "Lunch" });
    const batched = vi.fn(resolver);
    const notifications = makeService(batched);
    await notifications.publish(principal, { work: [secondRef, ref] });
    expect(batched).toHaveBeenCalledTimes(1);
    expect(batched.mock.calls[0]?.[1]).toEqual([secondRef, ref]);
    const claim = await notifications.claim(principal);
    if (claim.state !== "claimed") throw new Error("Expected claim");
    expect(batched).toHaveBeenCalledTimes(2);
    expect(batched.mock.calls[1]?.[1]).toEqual([ref, secondRef]);
    send.mockImplementationOnce(async () => {
      // Both Finance fixture locks must have ended at the queued-message commit.
      await putWork(secondRef, { active: false });
      return { sid: "SMbatch", status: "queued" };
    });
    await notifications.deliver(principal, claim);
    expect(batched).toHaveBeenCalledTimes(3);
    expect(batched.mock.calls[2]?.[1]).toEqual([ref, secondRef]);
    expect(await database.db.select().from(notificationAttemptItems)).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects short, malformed and positionally wrong resolver batches before publication", async () => {
    await putWork(secondRef);
    const valid = await database.db.transaction((tx) => resolver(owner, [ref, secondRef], tx));
    for (const response of [
      valid.slice(0, 1),
      [{ state: "current" }, valid[1]],
      [valid[1], valid[0]],
      new Array(2),
    ]) {
      const broken = makeService(
        async () => response as Awaited<ReturnType<NotificationWorkResolver>>,
      );
      await expect(broken.publish(principal, { work: [ref, secondRef] })).rejects.toThrow();
      expect(await database.db.select().from(notificationIntents)).toEqual([]);
    }
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects case-variant duplicate work IDs before invoking Finance", async () => {
    const batched = vi.fn(resolver);
    await expect(
      makeService(batched).publish(principal, {
        work: [ref, { ...ref, id: ref.id.toUpperCase() }],
      }),
    ).rejects.toThrow("once");
    expect(batched).not.toHaveBeenCalled();
    expect(await database.db.select().from(notificationIntents)).toEqual([]);
  });
  it("keeps mixed invalid publish batches atomic and claims eligible siblings independently", async () => {
    await putWork(secondRef, { active: false });
    await expect(service.publish(principal, { work: [ref, secondRef] })).rejects.toThrow();
    expect(await database.db.select().from(notificationIntents)).toEqual([]);
    await putWork(secondRef);
    await service.publish(principal, { work: [ref, secondRef] });
    await putWork(secondRef, { active: false });
    const batched = vi.fn(resolver);
    const notifications = makeService(batched);
    const claim = await notifications.claim(principal);
    expect(claim.state).toBe("claimed");
    expect(batched).toHaveBeenCalledTimes(1);
    expect(batched.mock.calls[0]?.[1]).toEqual([ref, secondRef]);
    const items = await database.db.select().from(notificationAttemptItems);
    expect(items.map((item) => item.work.id)).toEqual([ref.id]);
    expect(send).not.toHaveBeenCalled();
  });
  it("suppresses an unsent multi-item attempt and queues nothing when one work changes", async () => {
    await putWork(secondRef);
    await service.publish(principal, { work: [ref, secondRef] });
    const claim = await claimed();
    await putWork(secondRef, { active: false });
    const batched = vi.fn(resolver);
    await makeService(batched).deliver(principal, claim);
    expect(batched).toHaveBeenCalledTimes(1);
    expect(batched.mock.calls[0]?.[1]).toEqual([ref, secondRef]);
    expect((await service.status(principal)).attempts[0]?.state).toBe("suppressed");
    expect(await database.db.select().from(textMessages)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
  it("rolls back contended publish and claim batches without partial intents or attempts", async () => {
    await putWork(secondRef);
    await withLockedWork(secondRef, async () => {
      await expect(service.publish(principal, { work: [ref, secondRef] })).rejects.toThrow();
    });
    expect(await database.db.select().from(notificationIntents)).toEqual([]);
    await service.publish(principal, { work: [ref, secondRef] });
    await withLockedWork(secondRef, async () => {
      await expect(service.claim(principal)).rejects.toThrow();
    });
    expect(await database.db.select().from(notificationDeliveryAttempts)).toEqual([]);
    expect(await database.db.select().from(notificationAttemptItems)).toEqual([]);
    expect(
      (await database.db.select().from(notificationIntents)).every(
        (item) => item.state === "pending",
      ),
    ).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
  it("rolls back a claim when the resolver omits a positional result", async () => {
    await putWork(secondRef);
    await service.publish(principal, { work: [ref, secondRef] });
    await expect(makeService(async () => []).claim(principal)).rejects.toThrow();
    expect(await database.db.select().from(notificationDeliveryAttempts)).toEqual([]);
    expect(await database.db.select().from(notificationAttemptItems)).toEqual([]);
    expect(
      (await database.db.select().from(notificationIntents)).every(
        (item) => item.state === "pending",
      ),
    ).toBe(true);
  });
  it("queues nothing and never calls the provider when delivery batch resolution fails", async () => {
    await putWork(secondRef);
    await service.publish(principal, { work: [ref, secondRef] });
    const claim = await claimed();
    await withLockedWork(secondRef, async () => {
      await service.deliver(principal, claim);
    });
    expect(await database.db.select().from(textMessages)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await makeService(async () => [{ state: "current" }] as never).deliver(principal, claim);
    await makeService(async (userId, works, tx) =>
      (await resolver(userId, works, tx)).reverse(),
    ).deliver(principal, claim);
    expect(await database.db.select().from(textMessages)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
  it("persists human preferences with revision fencing, audit and inherited disclosure ceiling", async () => {
    await service.savePreferences(principal, "global", {
      expectedRevision: null,
      preferences: { ...defaultNotificationPreferences, detail: "minimal" },
    });
    await service.savePreferences(principal, "finances", {
      expectedRevision: null,
      preferences: defaultNotificationPreferences,
    });
    expect((await service.status(principal)).effective.detail).toBe("minimal");
    await expect(
      service.savePreferences(principal, "global", {
        expectedRevision: null,
        preferences: defaultNotificationPreferences,
      }),
    ).rejects.toThrow("changed");
    await expect(
      service.savePreferences({ ...principal, actorType: "agent" }, "global", {
        expectedRevision: 1,
        preferences: defaultNotificationPreferences,
      }),
    ).rejects.toThrow("explicit texting:execute access");
    await service.savePreferences(principal, "global", {
      expectedRevision: 1,
      preferences: defaultNotificationPreferences,
    });
    const audits = await database.db.query.auditEvents.findMany();
    expect(audits).toHaveLength(3);
    expect((await service.status({ ...principal, userId: other })).preferences).toEqual([]);
  });
  it("resets only the owned Finance override with revision fencing and audit, without reusing deleted revisions", async () => {
    const global = { ...defaultNotificationPreferences, enabled: false };
    await service.savePreferences(principal, "global", {
      expectedRevision: null,
      preferences: global,
    });
    await service.savePreferences(principal, "finances", {
      expectedRevision: null,
      preferences: defaultNotificationPreferences,
    });
    await expect(
      service.resetFinancePreferences(
        { ...principal, actorType: "agent" },
        { expectedRevision: 1 },
      ),
    ).rejects.toThrow("explicit texting:execute access");
    await expect(
      service.resetFinancePreferences(
        { ...principal, scopes: new Set(["texting:read", "finances:read"]) },
        { expectedRevision: 1 },
      ),
    ).rejects.toThrow("requires");
    await expect(
      service.resetFinancePreferences({ ...principal, userId: other }, { expectedRevision: 1 }),
    ).rejects.toThrow("changed");
    await expect(
      service.resetFinancePreferences(principal, { expectedRevision: 2 }),
    ).rejects.toThrow("changed");
    expect(
      await service.resetFinancePreferences(
        principal,
        { expectedRevision: 1 },
        "finance-reset-request",
      ),
    ).toEqual({
      scope: "finances",
      inherited: true,
    });
    const inherited = await service.status(principal);
    expect(inherited.preferences).toEqual([{ scope: "global", revision: 1, preferences: global }]);
    expect(inherited.effective).toEqual(global);
    const audits = await database.db.query.auditEvents.findMany();
    expect(audits.filter((event) => event.action === "notifications.preferences.reset")).toEqual([
      expect.objectContaining({
        before: { scope: "finances", revision: 1, preferences: defaultNotificationPreferences },
        after: { scope: "finances", inherited: true },
        requestId: "finance-reset-request",
        actorId: owner,
        actorType: "user",
      }),
    ]);
    expect(
      (
        await service.savePreferences(principal, "finances", {
          expectedRevision: null,
          preferences: defaultNotificationPreferences,
        })
      ).revision,
    ).toBe(2);
    await expect(
      service.resetFinancePreferences(principal, { expectedRevision: 1 }),
    ).rejects.toThrow("changed");
    await expect(
      service.savePreferences(principal, "finances", {
        expectedRevision: 1,
        preferences: global,
      }),
    ).rejects.toThrow("changed");
    expect((await service.status(principal)).preferences).toEqual([
      expect.objectContaining({ scope: "global", revision: 1, preferences: global }),
      expect.objectContaining({
        scope: "finances",
        revision: 2,
        preferences: defaultNotificationPreferences,
      }),
    ]);
    expect(await database.db.query.auditEvents.findMany()).toHaveLength(audits.length + 1);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    "question",
    "approval",
  ] as const)("expires delayed %s replies with their Finance work and releases the namespace", async (kind) => {
    const work = { ...ref, kind };
    const expiry = new Date(current.getTime() + 60_000);
    await putWork(work, {
      expiresAt: expiry.toISOString(),
      questionPrompt: kind === "question" ? "What was this purchase for?" : undefined,
    });
    await service.publish(principal, { work: [work] });
    await service.drain(principal);
    const original = await database.db.select().from(textReplyBindings);
    expect(original).toHaveLength(1);
    expect(original[0]?.expiresAt).toEqual(expiry);
    current = new Date(expiry.getTime() + 1000);
    await putWork(secondRef, { questionPrompt: "What was the next purchase for?" });
    await service.publish(principal, { work: [secondRef] });
    await service.drain(principal);
    expect(send.mock.calls[1]?.[0].body).toContain("Reply with the item number and answer");
    expect(await database.db.select().from(textReplyBindings)).toHaveLength(2);
  });
  it("keeps successive question notifications in one reply namespace", async () => {
    await putWork(ref, { questionPrompt: "What was this purchase for?" });
    await service.publish(principal, { work: [ref] });
    await service.drain(principal);
    const original = await database.db.select().from(textReplyBindings);
    expect(original).toHaveLength(1);
    expect(send.mock.calls[0]?.[0].body).toContain("Reply with the item number and answer");
    current = new Date(current.getTime() + 60_000);
    await putWork(secondRef, { questionPrompt: "What was the next purchase for?" });
    await service.publish(principal, { work: [secondRef] });
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].body).toContain("/finances?review=open");
    expect(send.mock.calls[1]?.[0].body).not.toContain("Reply with the item number and answer");
    const remaining = await database.db.select().from(textReplyBindings);
    expect(remaining).toEqual(original);
    expect(remaining[0]?.workId).toBe(ref.id);
  });
  it("deduplicates wording and evidence refreshes while keeping semantic attempt history", async () => {
    await service.publish(principal, { work: [ref] });
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].body).toContain("Dinner (yesterday)");
    expect(send.mock.calls[0]?.[0].body).toContain("Reply STOP");
    const refreshed = { ...ref, revision: "r2" };
    await putWork(refreshed, { context: "Changed wording" });
    await service.publish(principal, { work: [refreshed] });
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    const material = { ...refreshed, actionRevision: "a2" };
    await putWork(material);
    await service.publish(principal, { work: [material] });
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(2);
    const items = await database.db.select().from(notificationAttemptItems);
    expect(items.map((item) => item.work.actionRevision).sort()).toEqual(["a1", "a2"]);
    expect(await database.db.select().from(notificationIntents)).toHaveLength(1);
  });
  it("revalidates resolved, expired or superseded work after quiet hours and before submission", async () => {
    current = new Date("2026-03-08T11:59:00Z");
    await service.publish(principal, { work: [ref] });
    await service.drain(principal);
    expect((await service.status(principal)).intents[0]?.reason).toBe("quiet_hours");
    current = new Date("2026-03-08T12:00:00Z");
    const claim = await claimed();
    await putWork(ref, { active: false });
    await service.deliver(principal, claim);
    expect(send).not.toHaveBeenCalled();
    expect((await service.status(principal)).attempts[0]?.state).toBe("suppressed");
    await putWork(ref, { expiresAt: current.toISOString() });
    await service.drain(principal);
    expect((await service.status(principal)).intents[0]?.reason).toBe("expired");
    await putWork({ ...ref, revision: "new" });
    await service.publish(principal, { work: [{ ...ref, revision: "new" }] });
    const freshClaim = await claimed();
    await putWork({ ...ref, revision: "newer" });
    await service.deliver(principal, freshClaim);
    expect(send).not.toHaveBeenCalled();
  });
  it("reclaims expired leases with fencing and never repeats an uncertain provider attempt", async () => {
    await service.publish(principal, { work: [ref] });
    const oldClaim = await claimed();
    expect((await service.claim(principal)).state).toBe("pending");
    current = new Date(current.getTime() + 60_001);
    const newClaim = await claimed();
    expect(newClaim.id).toBe(oldClaim.id);
    expect(newClaim.claimId).not.toBe(oldClaim.claimId);
    await expect(service.deliver(principal, oldClaim)).rejects.toThrow("stale");
    send.mockRejectedValueOnce(new Error("provider secret canary"));
    await service.deliver(principal, newClaim);
    current = new Date(current.getTime() + 60_001);
    expect((await service.status(principal)).attempts[0]?.state).toBe("uncertain");
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await service.status(principal))).not.toContain("canary");
  });
  it("preserves queued process-loss evidence and reconciles provider delivery without resend", async () => {
    await service.publish(principal, { work: [ref] });
    await service.drain(principal);
    const [attempt] = await database.db.select().from(notificationDeliveryAttempts);
    if (!attempt?.messageId) throw new Error("Expected durable message link");
    await database.db
      .update(textMessages)
      .set({ status: "unknown", providerMessageSid: null })
      .where(eq(textMessages.id, attempt.messageId));
    await database.db
      .update(notificationDeliveryAttempts)
      .set({ state: "submitting" })
      .where(eq(notificationDeliveryAttempts.id, attempt.id));
    current = new Date(current.getTime() + 60_001);
    expect((await service.status(principal)).attempts[0]?.state).toBe("uncertain");
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    await database.db
      .update(textMessages)
      .set({ status: "delivered", providerMessageSid: "SMreconciled" })
      .where(eq(textMessages.id, attempt.messageId));
    expect((await service.status(principal)).attempts[0]?.state).toBe("accepted");
  });
  it("rechecks consent epoch, STOP state, disablement, and canonical timezone at send", async () => {
    await service.publish(principal, { work: [ref] });
    const claim = await claimed();
    await database.db
      .update(textingConnections)
      .set({ consentEpoch: 2 })
      .where(eq(textingConnections.userId, owner));
    await service.deliver(principal, claim);
    expect(send).not.toHaveBeenCalled();
    expect((await service.status(principal)).attempts[0]?.reason).toBe("consent_changed");
    const next = await claimed();
    await database.db
      .update(textingConnections)
      .set({ state: "opted_out" })
      .where(eq(textingConnections.userId, owner));
    await service.deliver(principal, next);
    expect(send).not.toHaveBeenCalled();
    current = new Date(current.getTime() + 60_001);
    await database.db
      .update(textingConnections)
      .set({ state: "active" })
      .where(eq(textingConnections.userId, owner));
    const retry = await claimed();
    await database.db.update(users).set({ planningTimezone: "invalid" }).where(eq(users.id, owner));
    await service.deliver(principal, retry);
    expect(send).not.toHaveBeenCalled();
    expect((await service.status(principal)).attempts[0]?.reason).toBe("timezone_unavailable");
  });
  it("isolates intent lookup, attempts, and composite references across tenants", async () => {
    await expect(service.publish({ ...principal, userId: other }, { work: [ref] })).rejects.toThrow(
      "unavailable",
    );
    await service.publish(principal, { work: [ref] });
    const claim = await claimed();
    await expect(service.deliver({ ...principal, userId: other }, claim)).rejects.toThrow("stale");
    expect((await service.status({ ...principal, userId: other })).intents).toEqual([]);
    const [intent] = await database.db.select().from(notificationIntents);
    if (!intent) throw new Error("Expected intent");
    await expect(
      database.db
        .insert(notificationAttemptItems)
        .values({ userId: other, attemptId: claim.id, intentId: intent.id, work: ref }),
    ).rejects.toThrow();
  });
  it("serializes concurrent claims and keeps domain locks only until queued commit", async () => {
    await service.publish(principal, { work: [ref] });
    const claims = await Promise.all([service.claim(principal), service.claim(principal)]);
    expect(claims.filter((c) => c.state === "claimed")).toHaveLength(1);
    const claim = claims.find((c) => c.state === "claimed");
    if (claim?.state !== "claimed") throw new Error("Expected claim");
    send.mockImplementationOnce(async () => {
      // A separate transaction can acquire and resolve domain work during provider I/O.
      await putWork(ref, { active: false });
      return { sid: "SMnetwork", status: "queued" };
    });
    await service.deliver(principal, claim);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await service.status(principal)).attempts[0]?.state).toBe("accepted");
    await service.drain(principal);
    expect((await service.status(principal)).intents[0]?.state).toBe("resolved");
  });
  it("holds authoritative fixture locks through handoff and detects later provider failure", async () => {
    await service.publish(principal, { work: [ref] });
    const claim = await claimed();
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waitingResolver: NotificationWorkResolver = async (userId, works, tx) => {
      const result = await resolver(userId, works, tx);
      entered();
      await blocked;
      return result;
    };
    const delivering = makeService(waitingResolver).deliver(principal, claim);
    await locked;
    try {
      await expect(
        database.db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT id FROM notification_test_work WHERE id=${ref.id} FOR UPDATE NOWAIT`,
          );
        }),
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await delivering;
    const [attempt] = await database.db.select().from(notificationDeliveryAttempts);
    if (!attempt?.messageId) throw new Error("Expected message");
    await database.db
      .update(textMessages)
      .set({ status: "undelivered" })
      .where(eq(textMessages.id, attempt.messageId));
    expect((await service.status(principal)).attempts[0]?.state).toBe("failed");
  });
  it("rejects unsafe configured origins and accepts local HTTP", async () => {
    for (const origin of [
      "javascript:alert(1)",
      "https://user:password@example.test",
      "https://example.test/path",
      "https://example.test?secret=x",
      "https://example.test#fragment",
      "not a url",
    ]) {
      expect(() =>
        createNotificationService({ db: database.db, origin, transport: texting }),
      ).toThrow();
    }
    expect(
      createNotificationService({
        db: database.db,
        origin: "http://localhost:3000/",
        transport: texting,
      }),
    ).toBeDefined();
    const unavailable = createNotificationService({
      db: database.db,
      origin: "https://NOHMI.test/",
      transport: texting,
    });
    await unavailable.publish(principal, { work: [ref] });
    await unavailable.drain(principal);
    expect(await database.db.select().from(notificationIntents)).toEqual([]);
    expect(await database.db.select().from(notificationDeliveryAttempts)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
  it("rolls back mixed invalid references and serializes preference/zone changes without blocking FK consent inserts", async () => {
    await expect(service.publish(principal, { work: [ref, ref] })).rejects.toThrow("once");
    await expect(
      service.publish(principal, {
        work: [ref, { ...ref, id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }],
      }),
    ).rejects.toThrow("unavailable");
    expect(await database.db.select().from(notificationIntents)).toEqual([]);
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const writing = makeService(async (userId, works, tx) => {
      const result = await resolver(userId, works, tx);
      entered();
      await wait;
      return result;
    }).publish(principal, { work: [ref] });
    await started;
    try {
      await database.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout='300ms'`);
        const [connection] = await tx
          .select()
          .from(textingConnections)
          .where(eq(textingConnections.userId, owner))
          .for("update");
        if (!connection) throw new Error("Expected connection");
        await tx.insert(textingConsentEvents).values({
          userId: owner,
          connectionId: connection.id,
          phoneFingerprint: owner,
          kind: "verified_opt_in",
          source: "nohmi",
          occurredAt: current,
        });
      });
      await expect(
        database.db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout='100ms'`);
          await tx.update(users).set({ planningTimezone: "UTC" }).where(eq(users.id, owner));
        }),
      ).rejects.toThrow();
      await expect(
        database.db.transaction(async (tx) => {
          await tx.execute(sql`SELECT id FROM users WHERE id=${owner} FOR UPDATE NOWAIT`);
        }),
      ).rejects.toThrow();
    } finally {
      release();
    }
    await writing;
    await database.db.update(users).set({ planningTimezone: "UTC" }).where(eq(users.id, owner));
    await service.drain(principal);
    expect((await database.db.select().from(notificationDeliveryAttempts))[0]?.timeZone).toBe(
      "UTC",
    );
    await database.db.delete(users).where(eq(users.id, owner));
    expect(await database.db.select().from(notificationDeliveryAttempts)).toEqual([]);
    expect(await database.db.select().from(notificationIntents)).toEqual([]);
  });
  it("rechecks changed preferences, final expiry, and date rollover before queuing", async () => {
    await service.publish(principal, { work: [ref] });
    const first = await claimed();
    await service.savePreferences(principal, "global", {
      expectedRevision: null,
      preferences: { ...defaultNotificationPreferences, enabled: false },
    });
    await service.deliver(principal, first);
    expect(send).not.toHaveBeenCalled();
    await service.savePreferences(principal, "global", {
      expectedRevision: 1,
      preferences: defaultNotificationPreferences,
    });
    const next = await claimed();
    await putWork(ref, { expiresAt: new Date(current.getTime() + 1000).toISOString() });
    const advancing: NotificationWorkResolver = async (userId, works, tx) => {
      const result = await resolver(userId, works, tx);
      current = new Date(current.getTime() + 1001);
      return result;
    };
    await makeService(advancing).deliver(principal, next);
    expect(send).not.toHaveBeenCalled();
    await putWork(ref);
    current = new Date("2026-03-09T12:00:00Z");
    await service.drain(principal);
    expect(send.mock.calls[0]?.[0].body).not.toContain("yesterday");
  });
  it("preserves failed and opted-out outcomes and respects disabled transport", async () => {
    await service.publish(principal, { work: [ref] });
    send.mockRejectedValueOnce({ status: 400, code: 21610, message: "secret canary" });
    await service.drain(principal);
    expect((await service.status(principal)).attempts[0]?.state).toBe("failed");
    expect(
      (
        await database.db
          .select()
          .from(textingConnections)
          .where(eq(textingConnections.userId, owner))
      )[0]?.state,
    ).toBe("opted_out");
    expect((await service.claim(principal)).state).toBe("pending");
    expect(JSON.stringify(await service.status(principal))).not.toContain("canary");
    await database.db
      .update(textingConnections)
      .set({ state: "active" })
      .where(eq(textingConnections.userId, owner));
    current = new Date(current.getTime() + 8 * 86400000);
    const disabled = createTextingService({
      db: database.db,
      apiBaseUrl: "https://nohmi.test",
      enabled: false,
      encryptionKey,
      senderPhoneNumber: "",
      now,
    });
    const off = createNotificationService({
      db: database.db,
      origin: "https://nohmi.test",
      transport: disabled,
      resolveWork: resolver,
      now,
    });
    await off.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await off.status(principal)).attempts.some((a) => a.reason === "delivery_blocked"),
    ).toBe(true);
  });
  it("aggregates bounded work and falls back to minimal Unicode disclosure", async () => {
    const refs = Array.from({ length: 4 }, () => ({ ...ref, id: crypto.randomUUID() }));
    for (const work of refs) await putWork(work, { context: "Dinner 🍜" });
    await service.publish(principal, { work: refs });
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].body).toContain("4 Finance items need review");
    expect(send.mock.calls[0]?.[0].body).not.toContain("🍜");
    expect(await database.db.select().from(notificationAttemptItems)).toHaveLength(4);
  });
  it("rolls back the queued message when durable linkage fails and enforces transport limits", async () => {
    await expect(
      texting.sendNotification(owner, async () => ({
        body: "nohmi: Review",
        queued: async () => {
          throw new Error("link failed");
        },
      })),
    ).rejects.toThrow("link failed");
    expect(await database.db.select().from(textMessages)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await expect(
      texting.sendNotification(owner, async () => ({
        body: "x".repeat(1000),
        queued: async () => {},
      })),
    ).rejects.toThrow("limit");
    const [connection] = await database.db
      .select()
      .from(textingConnections)
      .where(eq(textingConnections.userId, owner));
    if (!connection) throw new Error("Expected connection");
    await database.db.insert(textMessages).values(
      Array.from({ length: 5 }, () => ({
        userId: owner,
        connectionId: connection.id,
        body: "Earlier",
        direction: "outbound" as const,
        status: "accepted" as const,
        occurredAtSource: "nohmi" as const,
        occurredAt: current,
        createdAt: current,
      })),
    );
    await expect(
      texting.sendNotification(owner, async () => ({
        body: "nohmi: Review",
        queued: async () => {},
      })),
    ).rejects.toThrow("quota");
    expect(send).not.toHaveBeenCalled();
  });
});
