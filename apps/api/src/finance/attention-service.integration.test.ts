import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAccounts,
  financeBudgetStartPreviews,
  financeConversationMessages,
  financeEconomicEvents,
  financeOpeningStatements,
  financeReviewBatchRuns,
  financeReviewCases,
  financeTransactionRelationships,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import type { Principal } from "../types.js";
import { createFinanceAttentionService } from "./attention-service.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}
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
  async function qualifiedBoundary() {
    const owner = await fixture();
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.principal.userId,
        institution: "Synthetic Bank",
        name: "Investments",
        kind: "investment",
        provider: "manual",
        status: "manual",
        currencyCode: "USD",
        ownershipType: "individual",
        ownershipShareBps: 10000,
        includeInPlanning: true,
      })
      .returning();
    if (!account) throw new Error("Missing account");
    await database.db.insert(financeOpeningStatements).values({
      userId: owner.principal.userId,
      accountId: account.id,
      month: "2026-11",
      revision: 1,
      accountRevision: account.contextualRevision.toString(),
      timezone: "America/New_York",
      signedOpeningBalanceCents: 100000,
      currencyCode: "USD",
      actorId: owner.principal.userId,
      idempotencyKey: crypto.randomUUID(),
      fingerprint: "fixture",
      recordedAt: new Date("2026-11-01T12:00:00Z"),
    });
    const preview = await service().previewBudgetStart(owner, input());
    await service().applyBudgetStart(owner, {
      previewId: preview.id,
      fingerprint: preview.fingerprint,
    });
    return { owner, account };
  }
  it("does not reactivate independent October history when December needs a new opening statement", async () => {
    const { owner, account } = await qualifiedBoundary();
    await database.db.insert(financeTransactions).values({
      userId: owner.principal.userId,
      accountId: account.id,
      merchant: "Old purchase",
      amount: 1000,
      direction: "expense",
      transactionDate: "2026-10-20",
      needsReview: true,
    });
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      historicalRecordCount: 1,
      activeTransactionCount: 0,
    });
    const december = createFinanceAttentionService({
      db: database.db,
      now: () => new Date("2026-12-02T16:00:00Z"),
    });
    expect(await december.getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      historicalRecordCount: 1,
      activeTransactionCount: 0,
      readiness: { openingPositionQualified: false },
    });
  });
  it.each([
    false,
    true,
  ])("scopes a published batch to its actual transactions (mixed=%s)", async (mixed) => {
    const { owner, account } = await qualifiedBoundary();
    const transactions = await database.db
      .insert(financeTransactions)
      .values(
        (mixed ? ["2026-10-20", "2026-11-10"] : ["2026-10-20"]).map((date) => ({
          userId: owner.principal.userId,
          accountId: account.id,
          merchant: "Reviewed purchase",
          amount: 1000,
          direction: "expense" as const,
          transactionDate: date,
          needsReview: true,
        })),
      )
      .returning();
    const [batch] = await database.db
      .insert(financeReviewBatchRuns)
      .values({
        userId: owner.principal.userId,
        actorType: "user",
        actorId: owner.principal.userId,
        idempotencyKey: crypto.randomUUID(),
        fingerprint: `sha256:${"a".repeat(64)}`,
        manifest: transactions.map((item) => ({
          decision: {
            kind: "categorization",
            transactionId: item.id,
            expectedTransactionRevision: item.contextualRevision.toString(),
            expectedTransactionUpdatedAt: item.updatedAt.toISOString(),
          },
          transactionSummary: { date: item.transactionDate },
        })),
      })
      .returning();
    if (!batch) throw new Error("Missing batch");
    await database.db.insert(financeConversationMessages).values({
      userId: owner.principal.userId,
      sequence: 1n,
      authorKind: "agent",
      text: "Review purchases",
      recordRefs: [{ kind: "review_batch", id: batch.id }],
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date("2026-11-12T12:00:00Z"),
    });
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      activeDecisionCount: mixed ? 1 : 0,
      historicalRecordCount: 2,
      rawCounts: { approvals: 1 },
    });
  });
  it("promotes only history belonging to an unqualified account", async () => {
    const { owner, account } = await qualifiedBoundary();
    const [other] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.principal.userId,
        institution: "Synthetic Bank",
        name: "Unknown opening",
        provider: "manual",
        status: "manual",
        includeInPlanning: true,
      })
      .returning();
    if (!other) throw new Error("Missing account");
    await database.db.insert(financeTransactions).values(
      [account, other].map((item) => ({
        userId: owner.principal.userId,
        accountId: item.id,
        merchant: "Old purchase",
        amount: 1000,
        direction: "expense" as const,
        transactionDate: "2026-10-20",
        needsReview: true,
      })),
    );
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      historicalRecordCount: 1,
      activeTransactionCount: 1,
      triageRecordCount: 1,
    });
  });
  it("keeps an unlinked cross-boundary transfer candidate active with a qualified opening", async () => {
    const { owner, account } = await qualifiedBoundary();
    const [other] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.principal.userId,
        institution: "Synthetic Bank",
        name: "Other",
        provider: "manual",
        status: "manual",
        includeInPlanning: false,
      })
      .returning();
    if (!other) throw new Error("Missing other account");
    await database.db.insert(financeTransactions).values([
      {
        userId: owner.principal.userId,
        accountId: account.id,
        merchant: "Outgoing",
        amount: 1000,
        direction: "expense",
        providerDirection: "expense",
        providerCategory: "TRANSFER_OUT",
        currencyCode: "USD",
        transactionDate: "2026-10-31",
        needsReview: true,
      },
      {
        userId: owner.principal.userId,
        accountId: other.id,
        merchant: "Incoming",
        amount: 1000,
        direction: "income",
        providerDirection: "income",
        providerCategory: "TRANSFER_IN",
        currencyCode: "USD",
        transactionDate: "2026-11-01",
        needsReview: true,
      },
    ]);
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      historicalRecordCount: 0,
      activeTransactionCount: 2,
      readiness: { openingPositionQualified: true },
    });
  });
  it("counts a flagged transaction and its own review case as one unit of processing work", async () => {
    const { owner, account } = await qualifiedBoundary();
    const [both, flagOnly] = await database.db
      .insert(financeTransactions)
      .values(
        ["Flag and case", "Flag only"].map((merchant) => ({
          userId: owner.principal.userId,
          accountId: account.id,
          merchant,
          amount: 1000,
          direction: "expense" as const,
          transactionDate: "2026-11-10",
          needsReview: true,
        })),
      )
      .returning();
    if (!both || !flagOnly) throw new Error("Missing transactions");
    await database.db.insert(financeReviewCases).values({
      userId: owner.principal.userId,
      transactionId: both.id,
      reasonCode: "category_ambiguity",
    });
    expect(await service().getAttentionSnapshot(owner.principal.userId)).toMatchObject({
      activeTransactionCount: 2,
      activeDecisionCount: 0,
      processingCount: 2,
      // Raw record counts stay separately labelled and are never summed into work.
      rawCounts: { transactionFlags: 2, reviewCases: 1 },
    });
  });
  it("reads a snapshot over about 3,000 outstanding records in well under a second", async () => {
    const { owner, account } = await qualifiedBoundary();
    const userId = owner.principal.userId;
    const rows = <T>(count: number, build: (index: number) => T) =>
      Array.from({ length: count }, (_, index) => build(index));
    const insertTransactions = async (
      count: number,
      build: (index: number) => {
        transactionDate: string;
        needsReview: boolean;
        providerCategory?: string;
        providerDirection?: "expense" | "income";
      },
    ) => {
      const saved: { id: string; transactionDate: string }[] = [];
      for (let offset = 0; offset < count; offset += 500)
        saved.push(
          ...(await database.db
            .insert(financeTransactions)
            .values(
              rows(Math.min(500, count - offset), (index) => ({
                userId,
                accountId: account.id,
                merchant: "Synthetic purchase",
                amount: 1000 + offset + index,
                direction: "expense" as const,
                ...build(offset + index),
              })),
            )
            .returning({
              id: financeTransactions.id,
              transactionDate: financeTransactions.transactionDate,
            })),
        );
      return saved;
    };
    // 1,500 flagged transactions, each with its own open case: 3,000 outstanding records.
    const flagged = await insertTransactions(1500, (index) => ({
      transactionDate: index % 3 === 0 ? "2026-11-05" : "2026-10-15",
      needsReview: true,
      // A third are transfer-shaped history that must be compared with later activity.
      ...(index % 3 === 2
        ? { providerCategory: "TRANSFER_OUT", providerDirection: "expense" as const }
        : {}),
    }));
    const settled = await insertTransactions(2000, (index) => ({
      transactionDate: index % 2 === 0 ? "2026-11-06" : "2026-10-16",
      needsReview: false,
      // Same-account, distant-date transfers: compared, but never a valid counterpart.
      ...(index % 2 === 0
        ? { providerCategory: "TRANSFER_IN", providerDirection: "income" as const }
        : {}),
    }));
    for (let offset = 0; offset < flagged.length; offset += 500)
      await database.db.insert(financeReviewCases).values(
        flagged.slice(offset, offset + 500).map((item) => ({
          userId,
          transactionId: item.id,
          reasonCode: "category_ambiguity" as const,
        })),
      );
    // 200 historical flagged transactions are linked to settled November activity.
    const historical = flagged.filter((item) => item.transactionDate < "2026-11").slice(0, 200);
    const current = settled.filter((item) => item.transactionDate >= "2026-11");
    const [event] = await database.db
      .insert(financeEconomicEvents)
      .values({ userId, kind: "transfer", stableKey: crypto.randomUUID() })
      .returning();
    if (!event) throw new Error("Missing event");
    await database.db.insert(financeTransactionRelationships).values(
      historical.map((item, index) => ({
        userId,
        economicEventId: event.id,
        relationship: "transfer" as const,
        transactionIds: [item.id, required(current[index]).id],
        rationale: "Synthetic cross-boundary link",
        provenance: { actorType: "user" },
      })),
    );
    await database.db.execute(sql`ANALYZE`);
    // Best of three reads, so a busy shared runner does not decide a wall-clock check.
    let output = await service().getAttentionSnapshot(userId);
    let elapsed = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = performance.now();
      output = await service().getAttentionSnapshot(userId);
      elapsed = Math.min(elapsed, performance.now() - started);
    }
    console.info(`Finance attention read over 3,000 outstanding records: ${elapsed.toFixed(0)}ms`);
    expect(output).toMatchObject({
      complete: true,
      rawCounts: { transactionFlags: 1500, reviewCases: 1500 },
      // 500 current transactions plus 200 promoted by a cross-boundary relationship.
      activeTransactionCount: 700,
      processingCount: 700,
      historicalRecordCount: 1600,
      triageRecordCount: 0,
      activeDecisionCount: 0,
    });
    expect(output.dependencyRefs).toHaveLength(400);
    expect(elapsed).toBeLessThan(1000);
  }, 120_000);
  it("lets the owner inspect an agent preview without leaking it to another owner or agent", async () => {
    const owner = await fixture();
    const other = await fixture();
    const agent = {
      ...owner,
      principal: { ...owner.principal, actorType: "agent" as const, actorId: crypto.randomUUID() },
    };
    const prepared = await service().previewBudgetStart(agent, input());
    expect(await service().getBudgetStartPreview(owner, prepared.id)).toEqual(prepared);
    expect(await service().getBudgetStartPreview(agent, prepared.id)).toEqual(prepared);
    await expect(service().getBudgetStartPreview(other, prepared.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service().getBudgetStartPreview(
        { ...agent, principal: { ...agent.principal, actorId: crypto.randomUUID() } },
        prepared.id,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service().applyBudgetStart(agent, {
        previewId: prepared.id,
        fingerprint: prepared.fingerprint,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await service().getBudgetStart(owner.principal.userId)).toBeNull();
  });
  it("lets only the owner decline a published starting-month preview", async () => {
    const owner = await fixture();
    const other = await fixture();
    const agent = {
      ...owner,
      principal: {
        ...owner.principal,
        actorType: "agent" as const,
        actorId: crypto.randomUUID(),
        scopes: new Set(["finances:read", "finances:write", "finances:execute"] as const),
      },
    };
    const prepared = await service().previewBudgetStart(agent, input());
    await database.db.insert(financeConversationMessages).values({
      userId: owner.principal.userId,
      sequence: 1n,
      authorKind: "agent",
      text: "Start in November?",
      recordRefs: [{ kind: "budget_start_preview", id: prepared.id }],
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date("2026-11-12T12:00:00Z"),
    });
    const snapshot = () => service().getAttentionSnapshot(owner.principal.userId);
    expect(await snapshot()).toMatchObject({ activeDecisionCount: 1, rawCounts: { approvals: 1 } });
    await expect(service().declineBudgetStartPreview(agent, prepared.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(service().declineBudgetStartPreview(other, prepared.id)).rejects.toMatchObject({
      code: "not_found",
    });
    const declined = await service().declineBudgetStartPreview(owner, prepared.id);
    expect(declined).toMatchObject({
      kind: "budget_start_preview",
      id: prepared.id,
      recovery: "new_preview",
    });
    expect(await service().declineBudgetStartPreview(owner, prepared.id)).toEqual(declined);
    expect(prepared.declinedAt).toBeNull();
    expect(await service().getBudgetStartPreview(agent, prepared.id)).toMatchObject({
      declinedAt: declined.declinedAt,
    });
    expect(await snapshot()).toMatchObject({ activeDecisionCount: 0, rawCounts: { approvals: 0 } });
    await expect(
      service().applyBudgetStart(owner, {
        previewId: prepared.id,
        fingerprint: prepared.fingerprint,
      }),
    ).rejects.toMatchObject({ code: "conflict", details: { recovery: "new_preview" } });
    expect(await service().getBudgetStart(owner.principal.userId)).toBeNull();
    // An approved starting month is reversed with a new preview, never declined afterward.
    const approved = await service().previewBudgetStart(owner, input());
    await service().applyBudgetStart(owner, {
      previewId: approved.id,
      fingerprint: approved.fingerprint,
    });
    await expect(service().declineBudgetStartPreview(owner, approved.id)).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("refuses previews and reads without the matching scope, owner, policy revision or time zone", async () => {
    const context = await fixture();
    const scoped = (scopes: Principal["scopes"]) => ({
      ...context,
      principal: { ...context.principal, scopes },
    });
    await expect(
      service().previewBudgetStart(scoped(new Set(["finances:read"])), input()),
    ).rejects.toMatchObject({ code: "forbidden" });
    const prepared = await service().previewBudgetStart(context, input());
    await expect(
      service().getBudgetStartPreview(scoped(new Set(["finances:write"])), prepared.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    // A preview built against a policy revision that is not current is refused up front.
    await expect(
      service().previewBudgetStart(context, { ...input(), expectedPolicyRevision: 4 }),
    ).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("changed") });
    const missing = crypto.randomUUID();
    const stranger = {
      ...context,
      principal: { ...context.principal, actorId: missing, userId: missing },
    };
    await expect(service().previewBudgetStart(stranger, input())).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(service().getAttentionSnapshot(missing)).rejects.toMatchObject({
      code: "not_found",
    });
    await database.db
      .update(users)
      .set({ planningTimezone: "Not/A_Zone" })
      .where(eq(users.id, context.principal.userId));
    await expect(service().previewBudgetStart(context, input())).rejects.toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("time zone"),
    });
    expect(await service().getBudgetStart(context.principal.userId)).toBeNull();
  });
  it("refuses approval after the owner's time zone changes or for a preview without its impact", async () => {
    const context = await fixture();
    const prepared = await service().previewBudgetStart(context, input());
    const apply = { previewId: prepared.id, fingerprint: prepared.fingerprint };
    await database.db
      .update(users)
      .set({ planningTimezone: "America/Chicago" })
      .where(eq(users.id, context.principal.userId));
    await expect(service().applyBudgetStart(context, apply)).rejects.toMatchObject({
      code: "conflict",
      // The saved preview no longer describes this account, whichever check notices first.
      message: expect.stringContaining("changed"),
    });
    await database.db
      .update(users)
      .set({ planningTimezone: "America/New_York" })
      .where(eq(users.id, context.principal.userId));
    // Previews saved before the impact projection existed cannot be approved blind.
    await database.db
      .update(financeBudgetStartPreviews)
      .set({ projectedAttention: null })
      .where(eq(financeBudgetStartPreviews.id, prepared.id));
    await expect(service().applyBudgetStart(context, apply)).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("expected impact"),
    });
    expect(await service().getBudgetStart(context.principal.userId)).toBeNull();
    const replacement = await service().previewBudgetStart(context, input());
    const policy = await service().applyBudgetStart(context, {
      previewId: replacement.id,
      fingerprint: replacement.fingerprint,
    });
    expect(await service().getBudgetStart(context.principal.userId)).toEqual(policy);
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
