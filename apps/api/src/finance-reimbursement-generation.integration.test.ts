import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeAccounts,
  financeAgentActionReviews,
  financeCategories,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import type { AccessScope } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinanceActionService } from "./finance-action-service.js";
import { createFinanceReimbursementService } from "./finance-reimbursement-service.js";
import { createFinanceService } from "./finance-service.js";
import type { Principal } from "./types.js";

const now = new Date("2026-10-18T12:00:00Z");
const evidence = {
  summary: "Person reviewed the source expense.",
  sourceRefs: [
    {
      provider: "local" as const,
      sourceType: "finance_transaction" as const,
      accountId: null,
      remoteId: null,
      revision: null,
    },
  ],
};
function required<T>(value: T | undefined): T {
  if (!value) throw new Error("Fixture missing");
  return value;
}
describe.sequential("Database-owned reimbursement relationship generations", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let service: ReturnType<typeof createFinanceReimbursementService>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    service = createFinanceReimbursementService({ db: database.db, now: () => now });
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const owner = required(
      (
        await database.db
          .insert(users)
          .values({
            email: `relationship-generation-${crypto.randomUUID()}@example.com`,
            displayName: "Synthetic",
            passwordHash: "unused",
          })
          .returning()
      )[0],
    );
    const account = required(
      (
        await database.db
          .insert(financeAccounts)
          .values({
            userId: owner.id,
            provider: "manual",
            institution: "Synthetic",
            name: "Euro",
            currencyCode: "EUR",
            balance: 100_000,
          })
          .returning()
      )[0],
    );
    const category = required(
      (
        await database.db
          .insert(financeCategories)
          .values({ userId: owner.id, name: "Shared", slug: "shared", group: "expenses" })
          .returning()
      )[0],
    );
    const expense = required(
      (
        await database.db
          .insert(financeTransactions)
          .values({
            userId: owner.id,
            accountId: account.id,
            amount: 20_000,
            currencyCode: "EUR",
            direction: "expense",
            merchant: "Shared meal",
            transactionDate: "2026-10-01",
          })
          .returning()
      )[0],
    );
    const credit = required(
      (
        await database.db
          .insert(financeTransactions)
          .values({
            userId: owner.id,
            accountId: account.id,
            amount: 5_000,
            currencyCode: "EUR",
            direction: "income",
            merchant: "Alex transfer",
            transactionDate: "2026-10-05",
          })
          .returning()
      )[0],
    );
    const allocation = required(
      (
        await database.db
          .insert(financeTransactionAllocations)
          .values({
            userId: owner.id,
            transactionId: expense.id,
            categoryId: category.id,
            amount: 12_000,
            allocationOrder: 0,
            treatment: "reimbursable",
          })
          .returning()
      )[0],
    );
    const claim = required(
      (
        await database.db
          .insert(financeReimbursements)
          .values({
            userId: owner.id,
            allocationId: allocation.id,
            expectedAmount: 10_000,
            receivedAmount: 0,
            status: "expected",
            payer: "Alex",
            rationale: "Shared meal",
            evidence,
          })
          .returning()
      )[0],
    );
    const principal: Principal = {
      actorId: owner.id,
      actorType: "user",
      userId: owner.id,
      scopes: new Set<AccessScope>(["finances:read", "finances:write"]),
    };
    return {
      owner,
      account,
      expense,
      credit,
      allocation,
      claim,
      context: { principal, requestId: crypto.randomUUID() },
    };
  }
  async function generations(transactionId: string) {
    const result = await database.pool.query<{
      contextual_revision: string;
      reimbursement_relationship_revision: string;
    }>(
      "SELECT contextual_revision::text, reimbursement_relationship_revision::text FROM finance_transactions WHERE id=$1",
      [transactionId],
    );
    return required(result.rows[0]);
  }
  async function match(f: Awaited<ReturnType<typeof fixture>>, revision = 1) {
    return service.reconcile(
      {
        operation: "match_credit",
        reimbursementId: f.claim.id,
        expectedRevision: revision,
        creditTransactionId: f.credit.id,
        amount: 50,
        rationale: "Person matched the posted receipt",
        evidence,
      },
      f.context,
    );
  }
  it("uses canonical match, unmatch and rematch writers with a frozen clock and no replay bump", async () => {
    const f = await fixture();
    const initial = await generations(f.credit.id);
    expect(initial).toEqual({ contextual_revision: "1", reimbursement_relationship_revision: "1" });
    const matched = await match(f);
    expect(await generations(f.credit.id)).toEqual({
      ...initial,
      reimbursement_relationship_revision: "2",
    });
    expect(await match(f)).toEqual(matched);
    expect(await generations(f.credit.id)).toEqual({
      ...initial,
      reimbursement_relationship_revision: "2",
    });
    const stored = required(
      (
        await database.db
          .select()
          .from(financeReimbursementMatches)
          .where(eq(financeReimbursementMatches.creditTransactionId, f.credit.id))
      )[0],
    );
    const input = {
      operation: "unmatch_credit" as const,
      reimbursementId: f.claim.id,
      expectedRevision: matched.revision,
      matchId: stored.id,
      rationale: "Person corrected the selected credit",
      evidence,
      idempotencyKey: crypto.randomUUID(),
    };
    const unmatched = await service.reconcile(input, f.context);
    expect(await generations(f.credit.id)).toEqual({
      ...initial,
      reimbursement_relationship_revision: "3",
    });
    expect(await service.reconcile(input, f.context)).toEqual(unmatched);
    expect(await generations(f.credit.id)).toEqual({
      ...initial,
      reimbursement_relationship_revision: "3",
    });
    await match(f, unmatched.revision);
    expect(await generations(f.credit.id)).toEqual({
      ...initial,
      reimbursement_relationship_revision: "4",
    });
    expect(
      (
        await database.db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.id, f.credit.id))
      )[0]?.updatedAt,
    ).toEqual(f.credit.updatedAt);
  });
  it("covers the separate maintenance-answer match writer and its completed-answer replay", async () => {
    const f = await fixture();
    const reviewState = async () => {
      const [row] = await database.db
        .select({ needsReview: financeTransactions.needsReview })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, f.credit.id));
      return required(row).needsReview;
    };
    expect(await reviewState()).toBe(true);
    expect(await generations(f.credit.id)).toEqual({
      contextual_revision: "1",
      reimbursement_relationship_revision: "1",
    });
    await database.db
      .insert(executionPolicySettings)
      .values({ userId: f.owner.id, reviewBypassEnabled: true });
    const source = {
      accountId: f.account.id,
      provider: "local" as const,
      remoteId: f.credit.id,
      revision: f.credit.updatedAt.toISOString(),
      sourceType: "finance_transaction" as const,
    };
    const question = required(
      (
        await database.db
          .insert(financeAgentActionReviews)
          .values({
            actionKind: "question",
            expectedRevision: "maintenance-question",
            fingerprint: `relationship-generation-${crypto.randomUUID()}`,
            privatePayload: {
              candidate: { reimbursementIds: [f.claim.id], transactionId: f.credit.id },
              maintenanceAnswerAuthority: "same_user_finances_write",
              original: { actionKind: "reimbursement", input: { operation: "answer_question" } },
              question: {
                actionKind: "reimbursement",
                choices: [],
                expectedAnswer: [{ name: "answer", required: true, type: "object" }],
                id: "pending",
                prompt: "Which claim does this credit repay?",
                sourceRefs: [source],
                why: "Person must identify the receipt.",
              },
            },
            requestingAgentId: "finance-maintenance",
            safeChanges: [
              {
                entityId: f.credit.id,
                entityType: "finance_transaction",
                summary: "Match receipt.",
              },
            ],
            semanticTargetKeys: [`transaction:${f.credit.id}`],
            sourceRefs: [source],
            userId: f.owner.id,
          })
          .returning()
      )[0],
    );
    const actions = createFinanceActionService({
      db: database.db,
      finances: createFinanceService({ db: database.db, now: () => now }),
      now: () => now,
    });
    const context = {
      principal: {
        ...f.context.principal,
        actorType: "agent" as const,
        actorId: "finance-maintenance",
      },
      requestId: crypto.randomUUID(),
    };
    const answer = JSON.stringify({
      answer: { kind: "match", matches: [{ amount: 50, reimbursementId: f.claim.id }] },
    });
    const result = await actions.answerQuestion(question.id, answer, context);
    expect(result).toMatchObject({ status: "applied", result: { disposition: "match" } });
    expect(await generations(f.credit.id)).toEqual({
      contextual_revision: "2",
      reimbursement_relationship_revision: "2",
    });
    expect(await reviewState()).toBe(false);
    await actions.answerQuestion(question.id, answer, context);
    expect(await generations(f.credit.id)).toEqual({
      contextual_revision: "2",
      reimbursement_relationship_revision: "2",
    });
    expect(await reviewState()).toBe(false);
    expect(
      await database.db
        .select()
        .from(financeReimbursementMatches)
        .where(eq(financeReimbursementMatches.creditTransactionId, f.credit.id)),
    ).toHaveLength(1);
  });
  it("does not advance for exact or evidence-only updates, but advances on relationship changes and deletion", async () => {
    const f = await fixture();
    await match(f);
    // Canonical service matching is deliberately the first relationship mutation.
    const stored = required(
      (
        await database.db
          .select()
          .from(financeReimbursementMatches)
          .where(eq(financeReimbursementMatches.creditTransactionId, f.credit.id))
      )[0],
    );
    const write = async (query: string, parameters: unknown[]) => {
      const connection = await database.pool.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `finance-reimbursement-topology:${f.owner.id}`,
        ]);
        await connection.query(
          "SELECT id FROM finance_transactions WHERE user_id=$1 AND id=$2 ORDER BY id FOR UPDATE",
          [f.owner.id, f.credit.id],
        );
        await connection.query(query, parameters);
        await connection.query("COMMIT");
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    };
    await write("UPDATE finance_reimbursement_matches SET amount_cents=amount_cents WHERE id=$1", [
      stored.id,
    ]);
    await write(
      "UPDATE finance_reimbursement_matches SET rationale=$2, evidence=$3::jsonb WHERE id=$1",
      [
        stored.id,
        "Additional receipt detail",
        JSON.stringify({ ...evidence, summary: "New explanation only" }),
      ],
    );
    expect((await generations(f.credit.id)).reimbursement_relationship_revision).toBe("2");
    await write("UPDATE finance_reimbursement_matches SET amount_cents=4000 WHERE id=$1", [
      stored.id,
    ]);
    expect((await generations(f.credit.id)).reimbursement_relationship_revision).toBe("3");
    await write("UPDATE finance_reimbursement_matches SET amount_cents=5000 WHERE id=$1", [
      stored.id,
    ]);
    expect((await generations(f.credit.id)).reimbursement_relationship_revision).toBe("4");
    await write("DELETE FROM finance_reimbursement_matches WHERE id=$1", [stored.id]);
    expect(await generations(f.credit.id)).toEqual({
      contextual_revision: "1",
      reimbursement_relationship_revision: "5",
    });
  });
  it("rejects caller writes to the relationship generation atomically", async () => {
    const f = await fixture();
    await expect(
      database.pool.query(
        "UPDATE finance_transactions SET reimbursement_relationship_revision=reimbursement_relationship_revision+1 WHERE id=$1",
        [f.credit.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await generations(f.credit.id)).toEqual({
      contextual_revision: "1",
      reimbursement_relationship_revision: "1",
    });
  });
  it("derives visible final state for a multirow statement and rejects owner reassignment while preserving same-owner credit moves", async () => {
    const first = await fixture();
    const second = await fixture();
    await match(first);
    await match(second);
    const connection = await database.pool.connect();
    try {
      await connection.query("BEGIN");
      for (const ownerId of [first.owner.id, second.owner.id].sort()) {
        await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `finance-reimbursement-topology:${ownerId}`,
        ]);
      }
      await connection.query(
        "SELECT id FROM finance_reimbursements WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[first.claim.id, second.claim.id]],
      );
      await connection.query(
        "SELECT id FROM finance_transactions WHERE id=ANY($1::uuid[]) ORDER BY user_id,id FOR UPDATE",
        [[first.credit.id, second.credit.id]],
      );
      await connection.query(
        "UPDATE finance_reimbursement_matches SET amount_cents=amount_cents-100 WHERE credit_transaction_id=ANY($1::uuid[])",
        [[first.credit.id, second.credit.id]],
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
    for (const f of [first, second]) {
      expect((await generations(f.credit.id)).reimbursement_relationship_revision).toBe("3");
    }
    await expect(
      database.pool.query(
        "UPDATE finance_reimbursement_matches SET user_id=$2,reimbursement_id=$3,credit_transaction_id=$4 WHERE credit_transaction_id=$1",
        [first.credit.id, second.owner.id, second.claim.id, second.credit.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await generations(first.credit.id)).reimbursement_relationship_revision).toBe("3");
    expect((await generations(second.credit.id)).reimbursement_relationship_revision).toBe("3");
    const destination = required(
      (
        await database.db
          .insert(financeTransactions)
          .values({
            userId: first.owner.id,
            accountId: first.account.id,
            amount: 5000,
            currencyCode: "EUR",
            direction: "income",
            merchant: "Corrected receipt",
            transactionDate: "2026-10-05",
          })
          .returning()
      )[0],
    );
    const move = await database.pool.connect();
    try {
      await move.query("BEGIN");
      await move.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `finance-reimbursement-topology:${first.owner.id}`,
      ]);
      await move.query("SELECT id FROM finance_reimbursements WHERE id=$1 ORDER BY id FOR UPDATE", [
        first.claim.id,
      ]);
      await move.query(
        "SELECT id FROM finance_transactions WHERE id=ANY($1::uuid[]) ORDER BY user_id,id FOR UPDATE",
        [[first.credit.id, destination.id]],
      );
      await move.query(
        "UPDATE finance_reimbursement_matches SET credit_transaction_id=$2 WHERE credit_transaction_id=$1",
        [first.credit.id, destination.id],
      );
      await move.query("COMMIT");
    } catch (error) {
      await move.query("ROLLBACK");
      throw error;
    } finally {
      move.release();
    }
    expect((await generations(first.credit.id)).reimbursement_relationship_revision).toBe("4");
    expect((await generations(destination.id)).reimbursement_relationship_revision).toBe("2");
  });
  it("rejects fingerprint spoofing and TRUNCATE without losing matched rows", async () => {
    const f = await fixture();
    await match(f);
    await expect(
      database.pool.query(
        "UPDATE finance_transactions SET reimbursement_relationship_state='[]'::jsonb WHERE id=$1",
        [f.credit.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.pool.query("TRUNCATE finance_reimbursement_matches"),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await generations(f.credit.id)).reimbursement_relationship_revision).toBe("2");
    expect(
      await database.db
        .select()
        .from(financeReimbursementMatches)
        .where(eq(financeReimbursementMatches.creditTransactionId, f.credit.id)),
    ).toHaveLength(1);
  });
  it("supports owner cascade without touching a disappearing parent", async () => {
    const f = await fixture();
    await match(f);
    await database.db.delete(users).where(eq(users.id, f.owner.id));
    expect(
      await database.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.id, f.credit.id)),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(financeReimbursementMatches)
        .where(eq(financeReimbursementMatches.creditTransactionId, f.credit.id)),
    ).toHaveLength(0);
  });
  it("rolls back the canonical match and case update when generation is exhausted", async () => {
    const f = await fixture();
    // Privileged test setup only: production callers cannot assign this value.
    // Trigger suspension is transaction-local DDL and the guard is restored before the mutation.
    const connection = await database.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        "ALTER TABLE finance_transactions DISABLE TRIGGER finance_transactions_reimbursement_relationship_guard",
      );
      await connection.query(
        "UPDATE finance_transactions SET reimbursement_relationship_revision=9223372036854775807 WHERE id=$1",
        [f.credit.id],
      );
      await connection.query(
        "ALTER TABLE finance_transactions ENABLE TRIGGER finance_transactions_reimbursement_relationship_guard",
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
    await expect(match(f)).rejects.toBeDefined();
    expect((await generations(f.credit.id)).reimbursement_relationship_revision).toBe(
      "9223372036854775807",
    );
    expect(
      await database.db
        .select()
        .from(financeReimbursementMatches)
        .where(eq(financeReimbursementMatches.creditTransactionId, f.credit.id)),
    ).toHaveLength(0);
    expect(
      (
        await database.db
          .select()
          .from(financeReimbursements)
          .where(eq(financeReimbursements.id, f.claim.id))
      )[0],
    ).toMatchObject({ revision: 1, receivedAmount: 0 });
  });
  it("retains the original contextual generation caller-write guard", async () => {
    const f = await fixture();
    await expect(
      database.pool.query(
        "UPDATE finance_transactions SET contextual_revision=contextual_revision+1 WHERE id=$1",
        [f.credit.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await generations(f.credit.id)).toEqual({
      contextual_revision: "1",
      reimbursement_relationship_revision: "1",
    });
  });
});
