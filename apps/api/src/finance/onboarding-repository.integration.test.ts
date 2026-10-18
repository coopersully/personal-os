import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeOnboardingReceipts,
  financeOnboardingStates,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFinanceOnboardingService,
  type FinanceOnboardingEvidence,
} from "../finance-onboarding-service.js";
import { type FinanceMutationContext, loadFinanceAuthorization } from "./context.js";
import { createFinanceOnboardingRepository } from "./onboarding-repository.js";

function evidence(): FinanceOnboardingEvidence {
  return {
    existingAccess: false,
    source: { state: "usable", summary: "Owned source", recoveryHref: null },
    contextReview: "reviewed",
    questions: [
      {
        questionId: "profile:income",
        label: "Income",
        disposition: "unreviewed",
        answerSummary: null,
        allowsNone: false,
      },
    ],
    displayPreferences: { summary: ["Monthly"] },
    manualVisibility: "auto",
    automation: {
      registrationCount: 0,
      authorizedRegistrationWithCadence: false,
      chatVerification: "pending",
      canSendChat: false,
      historyAvailable: false,
    },
  };
}

describe.sequential("durable Finance onboarding repository with real migrations", () => {
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

  async function fixture() {
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Onboarding",
        email: `${randomUUID()}@example.com`,
        passwordHash: "unused",
      })
      .returning();
    if (!user) throw new Error("Missing owner");
    const context: FinanceMutationContext = {
      userId: user.id,
      actorId: user.id,
      actorType: "user",
      requestId: randomUUID(),
      canMutate: true,
      canSelfApprove: false,
      bypassEnabled: false,
    };
    let evidenceExecutorWasTransaction = false;
    const repository = createFinanceOnboardingRepository({
      db: database.db,
      async loadEvidence(executor, owner) {
        expect(owner).toBe(user.id);
        evidenceExecutorWasTransaction ||= executor !== database.db;
        return evidence();
      },
    });
    const service = createFinanceOnboardingService({ repository });
    const save = {
      expectedRevision: 0,
      idempotencyKey: "save",
      answers: [{ questionId: "profile:income", disposition: "unknown" }],
      displayPreferencesReviewed: true,
      automationChoice: "later",
    };
    return {
      user,
      context,
      repository,
      service,
      save,
      txEvidence: () => evidenceExecutorWasTransaction,
    };
  }

  it("reads without inserting and isolates owner state, receipts, and transaction evidence", async () => {
    const f = await fixture();
    const other = await fixture();
    expect((await f.repository.read(f.user.id)).state.revision).toBe(0);
    expect(
      await database.db
        .select()
        .from(financeOnboardingStates)
        .where(eq(financeOnboardingStates.userId, f.user.id)),
    ).toHaveLength(0);
    await f.service.saveFinanceOnboardingAnswers(f.save, f.context);
    expect(f.txEvidence()).toBe(true);
    expect((await other.service.getFinanceOnboarding(other.user.id)).revision).toBe(0);
    await other.service.saveFinanceOnboardingAnswers(other.save, other.context);
    const own = await database.db
      .select()
      .from(financeOnboardingReceipts)
      .where(eq(financeOnboardingReceipts.userId, f.user.id));
    expect(own).toHaveLength(1);
    expect(own[0]?.actorId).toBe(f.user.id);
  });

  it("serializes concurrent exact retries and rejects stale CAS and reused keys", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([
      f.service.saveFinanceOnboardingAnswers(f.save, f.context),
      f.service.saveFinanceOnboardingAnswers(f.save, f.context),
    ]);
    expect(a).toEqual(b);
    expect((await f.repository.read(f.user.id)).state.revision).toBe(1);
    await expect(
      f.service.saveFinanceOnboardingAnswers({ ...f.save, idempotencyKey: "stale" }, f.context),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.saveFinanceOnboardingAnswers({ ...f.save, automationChoice: "now" }, f.context),
    ).rejects.toMatchObject({ code: "conflict" });
    const outcomes = await Promise.allSettled(
      ["a", "b"].map((idempotencyKey) =>
        f.service.saveFinanceOnboardingAnswers(
          { ...f.save, expectedRevision: 1, idempotencyKey },
          f.context,
        ),
      ),
    );
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await f.repository.read(f.user.id)).state.revision).toBe(2);
  });

  it("rolls state, receipt, and audit back together when the transaction fails after write", async () => {
    const f = await fixture();
    const result = await f.service.getFinanceOnboarding(f.user.id);
    await expect(
      f.repository.withOwnerTransaction(f.context, async (tx) => {
        await tx.write({
          expectedRevision: 0,
          state: {
            revision: 1,
            completedAt: null,
            answers: [],
            displayPreferencesReviewed: true,
            automationChoice: "later",
            updatedAt: new Date().toISOString(),
          },
          receipt: {
            idempotencyKey: "rollback",
            operation: "save",
            requestHash: "a".repeat(64),
            result: { ...result, revision: 1 },
          },
          context: f.context,
        });
        throw new Error("Force transaction rollback");
      }),
    ).rejects.toThrow("Force transaction rollback");
    for (const table of [financeOnboardingStates, financeOnboardingReceipts, auditEvents])
      expect(
        await database.db.select().from(table).where(eq(table.userId, f.user.id)),
      ).toHaveLength(0);
  });

  it("enforces migrated completion immutability and cascades owner deletion", async () => {
    const f = await fixture();
    await f.service.saveFinanceOnboardingAnswers(f.save, f.context);
    const result = await f.service.completeFinanceOnboarding(
      { expectedRevision: 1, idempotencyKey: "complete", automationChoice: "later" },
      f.context,
    );
    expect(result.completedAt).not.toBeNull();
    for (const completedAt of [null, new Date("2000-01-01T00:00:00Z")])
      await expect(
        database.db
          .update(financeOnboardingStates)
          .set({ completedAt, revision: 3 })
          .where(eq(financeOnboardingStates.userId, f.user.id)),
      ).rejects.toThrow();
    await expect(
      database.db
        .update(financeOnboardingStates)
        .set({ revision: 2 })
        .where(eq(financeOnboardingStates.userId, f.user.id)),
    ).rejects.toThrow();
    await database.db.delete(users).where(eq(users.id, f.user.id));
    expect(
      await database.db
        .select()
        .from(financeOnboardingStates)
        .where(eq(financeOnboardingStates.userId, f.user.id)),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(financeOnboardingReceipts)
        .where(eq(financeOnboardingReceipts.userId, f.user.id)),
    ).toHaveLength(0);
    await expect(f.service.saveFinanceOnboardingAnswers(f.save, f.context)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("checks current agent execution authorization before returning an existing receipt", async () => {
    const f = await fixture();
    const [grant] = await database.db
      .insert(accessTokens)
      .values({
        userId: f.user.id,
        name: "Onboarding",
        tokenHash: randomUUID(),
        scopes: ["finances:write", "finances:execute"],
      })
      .returning();
    if (!grant) throw new Error("Missing grant");
    await database.db
      .insert(executionPolicySettings)
      .values({ userId: f.user.id, reviewBypassEnabled: true });
    const context = await loadFinanceAuthorization({
      db: database.db,
      requestId: randomUUID(),
      principal: {
        userId: f.user.id,
        actorId: grant.id,
        actorType: "agent",
        scopes: new Set(["finances:write", "finances:execute"]),
      },
    });
    await f.service.saveFinanceOnboardingAnswers(f.save, context);
    await database.db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(accessTokens.id, grant.id));
    await expect(f.service.saveFinanceOnboardingAnswers(f.save, context)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await f.repository.read(f.user.id)).state.revision).toBe(1);
  });

  it("rejects corrupt stored response shapes without fabricating a successful replay", async () => {
    const f = await fixture();
    await f.service.saveFinanceOnboardingAnswers(f.save, f.context);
    await database.db
      .update(financeOnboardingReceipts)
      .set({ result: { revision: 1 } })
      .where(
        and(
          eq(financeOnboardingReceipts.userId, f.user.id),
          eq(financeOnboardingReceipts.idempotencyKey, "save"),
        ),
      );
    await expect(f.service.saveFinanceOnboardingAnswers(f.save, f.context)).rejects.toMatchObject({
      code: "internal_error",
    });
    const count = await database.db.execute(
      sql`select count(*)::int as count from finance_onboarding_receipts where user_id=${f.user.id}`,
    );
    expect(count.rows[0]?.count).toBe(1);
  });
});
