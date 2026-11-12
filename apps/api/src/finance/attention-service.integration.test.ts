import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAccounts,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Principal } from "../types.js";
import { createFinanceAttentionService } from "./attention-service.js";

describe.sequential("Finance budget starting policy", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Finance owner",
        email: `${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "America/New_York",
      })
      .returning();
    if (!owner) throw new Error("Missing fixture");
    const principal: Principal = {
      actorType: "user",
      actorId: owner.id,
      userId: owner.id,
      scopes: new Set(["finances:read", "finances:write"]),
    };
    return { principal, requestId: crypto.randomUUID() };
  }
  const service = () =>
    createFinanceAttentionService({ db: database.db, now: () => new Date("2026-11-12T16:00:00Z") });
  const input = () => ({
    firstMonth: "2026-11",
    expectedPolicyRevision: 0,
    idempotencyKey: crypto.randomUUID(),
  });
  it("does not claim budget readiness or suppress historical work before qualification", async () => {
    const owner = await fixture();
    const output = await service().getAttentionSnapshot(owner.principal.userId);
    expect(output).toMatchObject({
      complete: true,
      period: "2026-11",
      activeDecisionCount: 0,
      budgetReady: false,
    });
    expect(output.readiness).toMatchObject({
      openingPositionQualified: false,
      budgetApproved: false,
    });
  });
  it("keeps flagged history in triage until opening evidence is qualified and isolates owners", async () => {
    const owner = await fixture();
    const other = await fixture();
    for (const context of [owner, other]) {
      const [account] = await database.db
        .insert(financeAccounts)
        .values({
          userId: context.principal.userId,
          institution: "Synthetic Bank",
          name: "Checking",
          provider: "manual",
          status: "manual",
        })
        .returning();
      if (!account) throw new Error("Missing account");
      await database.db.insert(financeTransactions).values({
        userId: context.principal.userId,
        accountId: account.id,
        merchant: "Synthetic purchase",
        amount: 1000,
        direction: "expense",
        transactionDate: "2026-10-31",
        needsReview: true,
      });
    }
    const prepared = await service().previewBudgetStart(owner, input());
    await service().applyBudgetStart(owner, {
      previewId: prepared.id,
      fingerprint: prepared.fingerprint,
    });
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      activeTransactionCount: 1,
      triageRecordCount: 1,
      historicalRecordCount: 0,
      activeDecisionCount: 0,
      budgetReady: false,
      rawCounts: { transactionFlags: 1 },
    });
  });
  it("requires an exact preview, records server-derived approval, and replays safely", async () => {
    const context = await fixture();
    const prepared = await service().previewBudgetStart(context, input());
    expect(await service().getBudgetStart(context.principal.userId)).toBeNull();
    expect(prepared.attention).toMatchObject({
      period: "2026-11",
      complete: true,
      budgetReady: false,
    });
    expect(prepared.attention.snapshot).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      service().applyBudgetStart(context, {
        previewId: prepared.id,
        fingerprint: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const result = await service().applyBudgetStart(context, {
      previewId: prepared.id,
      fingerprint: prepared.fingerprint,
    });
    expect(result).toMatchObject({
      firstMonth: "2026-11",
      timezone: "America/New_York",
      revision: 1,
      approvalSource: "user_instruction",
    });
    expect(
      await service().applyBudgetStart(context, {
        previewId: prepared.id,
        fingerprint: prepared.fingerprint,
      }),
    ).toEqual(result);
  });
  it("rejects another owner and never lets an agent impersonate approval", async () => {
    const owner = await fixture();
    const other = await fixture();
    const prepared = await service().previewBudgetStart(owner, input());
    const apply = { previewId: prepared.id, fingerprint: prepared.fingerprint };
    await expect(service().applyBudgetStart(other, apply)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service().applyBudgetStart(
        {
          ...owner,
          principal: { ...owner.principal, actorType: "agent", actorId: crypto.randomUUID() },
        },
        apply,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("invalidates competing previews and permits a reviewed reversal without deleting history", async () => {
    const context = await fixture();
    const first = await service().previewBudgetStart(context, input());
    const stale = await service().previewBudgetStart(context, input());
    await service().applyBudgetStart(context, {
      previewId: first.id,
      fingerprint: first.fingerprint,
    });
    await expect(
      service().applyBudgetStart(context, { previewId: stale.id, fingerprint: stale.fingerprint }),
    ).rejects.toMatchObject({ code: "conflict" });
    const reversal = await service().previewBudgetStart(context, {
      ...input(),
      firstMonth: null,
      expectedPolicyRevision: 1,
    });
    expect(
      await service().applyBudgetStart(context, {
        previewId: reversal.id,
        fingerprint: reversal.fingerprint,
      }),
    ).toMatchObject({ firstMonth: null, revision: 2 });
  });
  it("rejects a reused preview key with changed intent", async () => {
    const context = await fixture();
    const request = input();
    const prepared = await service().previewBudgetStart(context, request);
    expect(await service().previewBudgetStart(context, request)).toEqual(prepared);
    await expect(
      service().previewBudgetStart(context, { ...request, firstMonth: "2026-10" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
