import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeClassificationDecisions,
  financeMerchantAliases,
  financeMerchants,
  financeMutationRecords,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";
import { createFinanceService, normalizedMerchant, titleCaseMerchant } from "../finance-service.js";
import type { Principal } from "../types.js";
import type { FinanceMutationContext } from "./context.js";
import { createFinanceMerchantService } from "./merchant-service.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Merchant fixture was not created.");
  return value;
}
const now = () => new Date("2026-10-09T12:00:00.000Z");

describe.sequential("Finance merchant facade compatibility", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let service: ReturnType<typeof createFinanceService>;
  let userId: string;
  let foreignId: string;
  let principal: Principal;
  let context: { principal: Principal; requestId: string };
  let canonical: FinanceMutationContext;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    service = createFinanceService({ db: database.db, now });
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  beforeEach(async () => {
    const owners = await database.db
      .insert(users)
      .values([
        {
          displayName: "Merchant owner",
          email: `${randomUUID()}@example.com`,
          passwordHash: "unused",
        },
        {
          displayName: "Other owner",
          email: `${randomUUID()}@example.com`,
          passwordHash: "unused",
        },
      ])
      .returning();
    userId = required(owners[0]).id;
    foreignId = required(owners[1]).id;
    principal = {
      actorId: userId,
      actorType: "user",
      userId,
      scopes: new Set(["finances:read", "finances:write"]),
    };
    context = { principal, requestId: randomUUID() };
    canonical = {
      actorId: userId,
      actorType: "user",
      userId,
      requestId: context.requestId,
      bypassEnabled: false,
      canMutate: true,
      canSelfApprove: false,
    };
  });

  async function seedMerchant(owner: string, name: string) {
    const [row] = await database.db
      .insert(financeMerchants)
      .values({ userId: owner, displayName: name, normalizedName: normalizedMerchant(name) })
      .returning();
    return required(row);
  }
  async function createTransaction(owner: string, name: string) {
    const ownedPrincipal = { ...principal, actorId: owner, userId: owner };
    const ownedContext = { principal: ownedPrincipal, requestId: randomUUID() };
    const account = await service.createAccount(
      { balance: 100, institution: "Synthetic", name: "Cash", provider: "manual" },
      ownedContext,
    );
    return service.createTransaction(
      {
        accountId: account.id,
        amount: 12,
        category: null,
        categoryConfidence: null,
        date: "2026-10-09",
        direction: "expense",
        merchant: name,
        notes: null,
      },
      ownedContext,
    );
  }

  it("preserves facade helpers and raw alias identity while isolating owners", async () => {
    expect(normalizedMerchant("ACME*12345 #67890")).toBe("acme");
    expect(titleCaseMerchant("acme usa llc")).toBe("Acme USA LLC");
    const first = await createTransaction(userId, "ACME*12345");
    const second = await createTransaction(userId, "Acme #67890");
    const foreign = await createTransaction(foreignId, "ACME*12345");
    const rows = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.userId, userId));
    expect(rows.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
    expect(new Set(rows.map((row) => row.merchantId)).size).toBe(1);
    const merchants = await service.listMerchants(userId);
    expect(merchants).toHaveLength(1);
    expect(merchants[0]).toMatchObject({
      displayName: "Acme",
      aliases: ["ACME*12345"],
      isUserConfirmed: false,
    });
    const foreignRow = required(
      (
        await database.db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.id, foreign.id))
      )[0],
    );
    expect(foreignRow.merchantId).not.toBe(rows[0]?.merchantId);
    expect(await service.listMerchants(randomUUID())).toEqual([]);
  });

  it("replays canonical rename once, confirms user edits, and redacts names from audits", async () => {
    const row = await seedMerchant(userId, "Private original merchant");
    const input = { displayName: "Private corrected merchant", idempotencyKey: randomUUID() };
    const first = await service.updateFinanceMerchant(row.id, input, canonical);
    expect(await service.updateFinanceMerchant(row.id, input, canonical)).toEqual(first);
    expect(first.data).toMatchObject({
      id: row.id,
      displayName: input.displayName,
      isUserConfirmed: true,
    });
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.userId, userId), eq(auditEvents.action, "finance.merchant_renamed")),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      before: { id: row.id, isUserConfirmed: false },
      after: { id: row.id, isUserConfirmed: true, changedFields: ["displayName"] },
    });
    expect(JSON.stringify(audits)).not.toContain("Private");
    expect(
      await database.db
        .select()
        .from(financeMutationRecords)
        .where(eq(financeMutationRecords.userId, userId)),
    ).toHaveLength(1);
    const agentRow = await seedMerchant(userId, "Agent identity");
    expect(
      await service.updateMerchant(
        agentRow.id,
        { displayName: "Agent renamed" },
        { ...context, principal: { ...principal, actorType: "agent" } },
      ),
    ).toMatchObject({ isUserConfirmed: false });
  });

  it("rejects foreign rename and merge without changing either tenant", async () => {
    const own = await seedMerchant(userId, "Own merchant");
    const foreign = await seedMerchant(foreignId, "Foreign merchant");
    await expect(
      service.updateFinanceMerchant(
        foreign.id,
        { displayName: "Wrong", idempotencyKey: randomUUID() },
        canonical,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.mergeFinanceMerchantRecords(
        {
          sourceMerchantId: own.id,
          targetMerchantId: foreign.id,
          rationale: "Wrong tenant",
          idempotencyKey: randomUUID(),
        },
        canonical,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await service.listMerchants(userId)).toMatchObject([
      { id: own.id, displayName: "Own merchant" },
    ]);
    expect(await service.listMerchants(foreignId)).toMatchObject([
      { id: foreign.id, displayName: "Foreign merchant" },
    ]);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, userId)),
    ).toHaveLength(0);
    const failures = await database.db
      .select()
      .from(financeMutationRecords)
      .where(eq(financeMutationRecords.userId, userId));
    expect(failures).toHaveLength(2);
    expect(
      failures.every((receipt) => receipt.status === "failed" && receipt.response === null),
    ).toBe(true);
  });

  it("merges every merchant reference and replays after the source has been removed", async () => {
    const transaction = await createTransaction(userId, "Source private merchant");
    const source = required((await service.listMerchants(userId))[0]);
    const target = await seedMerchant(userId, "Target private merchant");
    await database.db.insert(financeClassificationDecisions).values({
      userId,
      transactionId: transaction.id,
      merchantId: source.id,
      categoryName: "Synthetic category",
      source: "user",
      confidence: 10000,
      outcome: "confirmed",
    });
    const input = {
      sourceMerchantId: source.id,
      targetMerchantId: target.id,
      rationale: "Private rationale",
      idempotencyKey: randomUUID(),
    };
    const result = await service.mergeFinanceMerchantRecords(input, canonical);
    expect(await service.mergeFinanceMerchantRecords(input, canonical)).toEqual(result);
    expect(result.data.id).toBe(target.id);
    expect(
      await database.db.select().from(financeMerchants).where(eq(financeMerchants.id, source.id)),
    ).toHaveLength(0);
    expect(
      required(
        (
          await database.db
            .select()
            .from(financeTransactions)
            .where(eq(financeTransactions.id, transaction.id))
        )[0],
      ).merchantId,
    ).toBe(target.id);
    expect(
      required(
        (
          await database.db
            .select()
            .from(financeMerchantAliases)
            .where(eq(financeMerchantAliases.userId, userId))
        )[0],
      ).merchantId,
    ).toBe(target.id);
    expect(
      required(
        (
          await database.db
            .select()
            .from(financeClassificationDecisions)
            .where(eq(financeClassificationDecisions.transactionId, transaction.id))
        )[0],
      ).merchantId,
    ).toBe(target.id);
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.userId, userId), eq(auditEvents.action, "finance.merchants_merged")),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toEqual({
      rationaleProvided: true,
      sourceMerchantId: source.id,
      targetMerchantId: target.id,
    });
    expect(JSON.stringify(audits)).not.toContain("Private rationale");
  });

  it("rolls canonical rename back when audit persistence fails and retains a failed receipt", async () => {
    const row = await seedMerchant(userId, "Audit rollback original");
    const input = { displayName: "Audit rollback changed", idempotencyKey: randomUUID() };
    await database.db.execute(sql`
      create function reject_merchant_test_audit() returns trigger language plpgsql as $$
      begin
        if NEW.request_id = 'merchant-rollback-audit' then
          raise exception 'merchant audit unavailable';
        end if;
        return NEW;
      end;
      $$
    `);
    await database.db.execute(sql`
      create trigger reject_merchant_test_audit before insert on audit_events
      for each row execute function reject_merchant_test_audit()
    `);
    try {
      await expect(
        service.updateFinanceMerchant(row.id, input, {
          ...canonical,
          requestId: "merchant-rollback-audit",
        }),
      ).rejects.toThrow();
    } finally {
      await database.db.execute(sql`drop trigger reject_merchant_test_audit on audit_events`);
      await database.db.execute(sql`drop function reject_merchant_test_audit()`);
    }
    expect(await service.listMerchants(userId)).toMatchObject([
      { id: row.id, displayName: "Audit rollback original", isUserConfirmed: false },
    ]);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, userId)),
    ).toHaveLength(0);
    const receipt = required(
      (
        await database.db
          .select()
          .from(financeMutationRecords)
          .where(eq(financeMutationRecords.userId, userId))
      )[0],
    );
    expect(receipt).toMatchObject({ status: "failed", response: null });
    await expect(service.updateFinanceMerchant(row.id, input, canonical)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("uses the caller transaction for alias creation, rename, merge, and their audits", async () => {
    const source = await seedMerchant(userId, "Rollback source");
    const target = await seedMerchant(userId, "Rollback target");
    const merchantService = createFinanceMerchantService({ db: database.db, now });
    await expect(
      database.db.transaction(async (tx) => {
        await merchantService.merchantFor(userId, "Rollback alias", "provider", tx);
        await service.updateMerchant(target.id, { displayName: "Uncommitted name" }, context, tx);
        await service.mergeMerchants(
          { sourceMerchantId: source.id, targetMerchantId: target.id, rationale: "Rollback" },
          context,
          tx,
        );
        throw new Error("abort merchant writes");
      }),
    ).rejects.toThrow("abort merchant writes");
    expect((await service.listMerchants(userId)).map((row) => row.displayName).sort()).toEqual([
      "Rollback source",
      "Rollback target",
    ]);
    expect(
      await database.db
        .select()
        .from(financeMerchantAliases)
        .where(eq(financeMerchantAliases.userId, userId)),
    ).toHaveLength(0);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, userId)),
    ).toHaveLength(0);
  });
});
