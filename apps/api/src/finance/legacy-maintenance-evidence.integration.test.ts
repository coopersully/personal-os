import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAccounts,
  financeCategories,
  financeEconomicEvents,
  financeMaintenanceRuns,
  financeReviewCases,
  financeTransactionRelationships,
  financeTransactionRevisions,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createAgentAccessWorkItemService } from "../agent-access-work-items.js";
import { createFinanceService } from "../finance-service.js";
import { createFinanceStatusService } from "../finance-status-service.js";
import { findUnverifiedLegacyFinanceEffects } from "./legacy-maintenance-evidence.js";
import { readFinanceEffectWork } from "./review-effect-projection.js";

const legacyAt = new Date("2026-07-15T12:00:00Z");
const laterAt = new Date("2026-08-15T12:00:00Z");

describe.sequential("Legacy Finance maintenance evidence", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  async function fixture() {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Legacy evidence",
        email: `legacy-evidence-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Owner missing.");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        userId: owner.id,
        name: "Manual cash",
        institution: "Fixture bank",
        syncState: "current",
        kind: "cash",
        provider: "manual",
        status: "manual",
        balance: 100_000,
      })
      .returning();
    if (!account) throw new Error("Account missing.");
    const transactions = await database.db
      .insert(financeTransactions)
      .values(
        ["2026-07-01", "2026-08-01", "2026-08-02"].map((transactionDate, index) => ({
          userId: owner.id,
          accountId: account.id,
          amount: 1000,
          transactionDate,
          merchant: `Historical effect ${index}`,
          direction: "expense" as const,
          category: "Groceries",
          categorySource: "agent" as const,
          needsReview: false,
        })),
      )
      .returning();
    const first = transactions[0];
    const second = transactions[1];
    const third = transactions[2];
    if (!first || !second || !third) throw new Error("Transactions missing.");
    const legacyRunId = crypto.randomUUID();
    await database.db
      .insert(financeMaintenanceRuns)
      .values({ id: legacyRunId, userId: owner.id, scope: { type: "all" } });
    const [revision] = await database.db
      .insert(financeTransactionRevisions)
      .values({
        userId: owner.id,
        transactionId: first.id,
        version: 1,
        changes: { category: { before: null, after: "Groceries" } },
        provenance: { actorType: "agent", maintenanceRunId: legacyRunId },
        createdAt: legacyAt,
      })
      .returning();
    if (!revision) throw new Error("Revision missing.");
    return { userId: owner.id, account, first, second, third, revision, legacyRunId };
  }

  it("blocks historical effects even when needsReview is false and exposes exact repair in status", async () => {
    const setup = await fixture();
    const effects = await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
      type: "all_outstanding",
    });
    expect(effects).toEqual([
      expect.objectContaining({
        effectId: setup.revision.id,
        kind: "classification",
        legacyRunId: setup.legacyRunId,
        transactionIds: [setup.first.id],
        repair: {
          href: `/finances/transactions?transactionId=${setup.first.id}`,
          label: "Review and confirm transaction category",
          operation: "update_finance_transaction",
        },
      }),
    ]);
    const projected = await readFinanceEffectWork(database.db, {
      userId: setup.userId,
      snapshotAt: laterAt,
    });
    expect(projected).toEqual([
      expect.objectContaining({
        id: `finance-effect:classification:${setup.revision.id}`,
        action: { label: effects[0]?.repair.label, to: effects[0]?.repair.href },
        priority: "blocked",
        updatedAt: legacyAt.toISOString(),
      }),
    ]);
    expect(
      await readFinanceEffectWork(database.db, {
        userId: setup.userId,
        snapshotAt: new Date("2026-07-01T00:00:00Z"),
      }),
    ).toEqual([]);
    const status = createFinanceStatusService({
      db: database.db,
      now: () => laterAt,
      assistant: {} as never,
      finances: {} as never,
      goals: {} as never,
      maintenance: {} as never,
    });
    const blocked = await status.getFinanceStatus(setup.userId, { type: "all_outstanding" });
    expect(blocked).toMatchObject({
      state: "blocked",
      work: { blocked: 1 },
      details: { closeReadiness: { ready: false, reconciledThrough: null } },
      recommendedNextOperation: effects[0]?.repair,
    });
    expect(blocked.freshness.blockers).toContainEqual(
      expect.objectContaining({
        code: "legacy_maintenance_unverified",
        message: expect.stringContaining(setup.first.id),
      }),
    );
    await expect(
      database.db
        .select({ needsReview: financeTransactions.needsReview })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, setup.first.id)),
    ).resolves.toEqual([{ needsReview: false }]);
  });

  it("notes, clarification, unrelated user changes and another transaction decision cannot clear classification evidence", async () => {
    const setup = await fixture();
    await database.db.insert(financeTransactionRevisions).values([
      {
        userId: setup.userId,
        transactionId: setup.first.id,
        version: 2,
        changes: { notes: "I saw this." },
        provenance: { actorType: "user" },
        createdAt: laterAt,
      },
      {
        userId: setup.userId,
        transactionId: setup.first.id,
        version: 3,
        changes: { merchant: { before: "Old", after: "New" } },
        provenance: { actorType: "user" },
        createdAt: laterAt,
      },
      {
        userId: setup.userId,
        transactionId: setup.second.id,
        version: 1,
        changes: { category: { after: "Groceries" } },
        provenance: { actorType: "user" },
        createdAt: laterAt,
      },
    ]);
    await database.db.insert(financeReviewCases).values({
      userId: setup.userId,
      transactionId: setup.first.id,
      status: "resolved",
      resolution: { type: "clarify", answer: "Yes, seen." },
      resolutionProvenance: { actorType: "user" },
      resolvedAt: laterAt,
    });
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "all_outstanding",
      }),
    ).toHaveLength(1);
    expect(
      await readFinanceEffectWork(database.db, { userId: setup.userId, snapshotAt: laterAt }),
    ).toHaveLength(1);
    await database.db.insert(financeTransactionRevisions).values({
      userId: setup.userId,
      transactionId: setup.first.id,
      version: 4,
      changes: { category: { after: "Groceries" } },
      provenance: { actorType: "user", source: "inbox_answer" },
      createdAt: laterAt,
    });
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "all_outstanding",
      }),
    ).toEqual([]);
    expect(
      await readFinanceEffectWork(database.db, { userId: setup.userId, snapshotAt: laterAt }),
    ).toEqual([]);
  });

  it("a newer legacy category remains blocked while an explicit user categorization supersedes it", async () => {
    const setup = await fixture();
    const [newer] = await database.db
      .insert(financeTransactionRevisions)
      .values({
        userId: setup.userId,
        transactionId: setup.first.id,
        version: 2,
        changes: { category: { before: "Groceries", after: "Dining" }, meaning: "Dinner" },
        provenance: { actorType: "agent", maintenanceRunId: setup.legacyRunId },
        createdAt: laterAt,
      })
      .returning();
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "all_outstanding",
      }),
    ).toEqual([expect.objectContaining({ effectId: newer?.id })]);
    const [category] = await database.db
      .insert(financeCategories)
      .values({ userId: setup.userId, name: "Dining", slug: "dining", group: "Spending" })
      .returning();
    if (!category) throw new Error("Category missing.");
    const finances = createFinanceService({
      db: database.db,
      now: () => new Date("2026-08-16T12:00:00Z"),
    });
    await finances.updateTransaction(
      setup.first.id,
      { category: category.name },
      {
        principal: {
          actorType: "user",
          actorId: setup.userId,
          userId: setup.userId,
          scopes: new Set(["finances:write"]),
        },
        requestId: "confirm-legacy-classification",
      },
    );
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "all_outstanding",
      }),
    ).toEqual([]);
  });

  it("binds account, window, transaction and review scopes to the owner", async () => {
    const setup = await fixture();
    const other = await fixture();
    const projected = await readFinanceEffectWork(database.db, {
      userId: setup.userId,
      snapshotAt: laterAt,
    });
    expect(JSON.stringify(projected)).not.toContain(other.first.id);
    expect(JSON.stringify(projected)).not.toContain(other.revision.id);
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "window",
        start: "2026-08-01",
        end: "2026-08-31",
      }),
    ).toEqual([]);
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "window",
        start: "2026-07-01",
        end: "2026-07-01",
      }),
    ).toHaveLength(1);
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "target",
        entityType: "finance_account",
        id: setup.account.id,
      }),
    ).toHaveLength(1);
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "target",
        entityType: "finance_transaction",
        id: setup.second.id,
      }),
    ).toEqual([]);
    const [review] = await database.db
      .insert(financeReviewCases)
      .values({ userId: setup.userId, transactionId: setup.first.id })
      .returning();
    if (!review) throw new Error("Review missing.");
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "target",
        entityType: "finance_review_case",
        id: review.id,
      }),
    ).toHaveLength(1);
    for (const scope of [
      { type: "target", entityType: "finance_transaction", id: other.first.id },
      { type: "target", entityType: "finance_account", id: other.account.id },
      { type: "target", entityType: "finance_review_case", id: crypto.randomUUID() },
    ] as const)
      await expect(
        findUnverifiedLegacyFinanceEffects(database.db, setup.userId, scope),
      ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "target",
        entityType: "finance_budget",
        id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    // A malformed foreign revision cannot act as evidence for an owned transaction.
    await database.db.insert(financeTransactionRevisions).values({
      userId: other.userId,
      transactionId: setup.first.id,
      version: 9,
      changes: { category: { after: "Confirmed" } },
      provenance: { actorType: "user" },
      createdAt: laterAt,
    });
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "all_outstanding",
      }),
    ).toHaveLength(1);
  });

  it("relationship evidence requires a later explicit user decision on the exact transaction set", async () => {
    const setup = await fixture();
    await database.db
      .delete(financeTransactionRevisions)
      .where(eq(financeTransactionRevisions.id, setup.revision.id));
    const [event] = await database.db
      .insert(financeEconomicEvents)
      .values({ userId: setup.userId, kind: "transfer", stableKey: crypto.randomUUID() })
      .returning();
    if (!event) throw new Error("Event missing.");
    const [relationship] = await database.db
      .insert(financeTransactionRelationships)
      .values({
        userId: setup.userId,
        economicEventId: event.id,
        relationship: "transfer",
        transactionIds: [setup.first.id, setup.second.id],
        rationale: "Legacy match",
        provenance: { actorType: "agent", maintenanceRunId: setup.legacyRunId },
        createdAt: legacyAt,
      })
      .returning();
    await database.db.insert(financeTransactionRevisions).values({
      userId: setup.userId,
      transactionId: setup.first.id,
      version: 2,
      changes: { category: { after: "Groceries" } },
      provenance: { actorType: "user" },
      createdAt: laterAt,
    });
    await database.db.insert(financeTransactionRelationships).values({
      userId: setup.userId,
      economicEventId: event.id,
      relationship: "transfer",
      transactionIds: [setup.first.id, setup.third.id],
      rationale: "Different pair",
      provenance: { actorType: "user" },
      createdAt: laterAt,
    });
    const other = await fixture();
    const [foreignEvent] = await database.db
      .insert(financeEconomicEvents)
      .values({ userId: other.userId, kind: "transfer", stableKey: crypto.randomUUID() })
      .returning();
    if (!foreignEvent) throw new Error("Foreign event missing.");
    await database.db.insert(financeTransactionRelationships).values({
      userId: setup.userId,
      economicEventId: foreignEvent.id,
      relationship: "transfer",
      transactionIds: [setup.first.id, setup.second.id],
      rationale: "Malformed foreign event confirmation",
      provenance: { actorType: "user" },
      createdAt: laterAt,
    });
    const unresolved = await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
      type: "target",
      entityType: "finance_transaction",
      id: setup.second.id,
    });
    expect(unresolved).toEqual([
      expect.objectContaining({
        effectId: relationship?.id,
        kind: "relationship",
        transactionIds: [setup.first.id, setup.second.id],
      }),
    ]);
    await database.db.insert(financeTransactionRelationships).values({
      userId: setup.userId,
      economicEventId: event.id,
      relationship: "transfer",
      transactionIds: [setup.second.id, setup.first.id],
      rationale: "I confirm this exact pair",
      provenance: { actorType: "user" },
      createdAt: laterAt,
    });
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "all_outstanding",
      }),
    ).toEqual([]);
  });

  it("unknown legacy financial changes stay blocked by a later category decision", async () => {
    const setup = await fixture();
    await database.db.insert(financeTransactionRevisions).values({
      userId: setup.userId,
      transactionId: setup.first.id,
      version: 2,
      changes: { splitPartIds: [setup.second.id] },
      provenance: { actorType: "agent", maintenanceRunId: setup.legacyRunId },
      createdAt: legacyAt,
    });
    await database.db.insert(financeTransactionRevisions).values({
      userId: setup.userId,
      transactionId: setup.first.id,
      version: 3,
      changes: { category: { after: "Groceries" } },
      provenance: { actorType: "user" },
      createdAt: laterAt,
    });
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "all_outstanding",
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "transaction_change",
        repair: expect.objectContaining({ operation: "get_finance_transaction" }),
      }),
    ]);
  });
  it("resolves provenance only to owned legacy runs and distinguishes missing or canonical evidence", async () => {
    const setup = await fixture();
    const other = await fixture();
    const canonicalId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      id: canonicalId,
      userId: setup.userId,
      domain: "finances",
      scope: { type: "all_outstanding" },
      rulebookVersion: "rules:v1",
      status: "queued",
    });
    for (const runId of ["not-a-run-id", crypto.randomUUID(), other.legacyRunId]) {
      await database.db
        .update(financeTransactionRevisions)
        .set({ provenance: { actorType: "agent", maintenanceRunId: runId } })
        .where(eq(financeTransactionRevisions.id, setup.revision.id));
      expect(
        await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
          type: "all_outstanding",
        }),
      ).toEqual([
        expect.objectContaining({
          code: "finance_maintenance_evidence_missing",
          legacyRunId: null,
        }),
      ]);
    }
    await database.db
      .update(financeTransactionRevisions)
      .set({ provenance: { actorType: "agent", maintenanceRunId: canonicalId } })
      .where(eq(financeTransactionRevisions.id, setup.revision.id));
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "all_outstanding",
      }),
    ).toEqual([]);
    await database.db
      .update(financeTransactionRevisions)
      .set({ provenance: { actorType: "agent", maintenanceRunId: setup.legacyRunId } })
      .where(eq(financeTransactionRevisions.id, setup.revision.id));
    await database.db.insert(financeTransactionRevisions).values({
      userId: setup.userId,
      transactionId: setup.first.id,
      version: 2,
      changes: { category: { after: "Dining" } },
      provenance: { actorType: "agent", maintenanceRunId: canonicalId },
      createdAt: laterAt,
    });
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "all_outstanding",
      }),
    ).toEqual([
      expect.objectContaining({
        code: "legacy_maintenance_unverified",
        legacyRunId: setup.legacyRunId,
      }),
    ]);
    const [event] = await database.db
      .insert(financeEconomicEvents)
      .values({ userId: setup.userId, kind: "transfer", stableKey: crypto.randomUUID() })
      .returning();
    if (!event) throw new Error("Event missing.");
    const [relationship] = await database.db
      .insert(financeTransactionRelationships)
      .values({
        userId: setup.userId,
        economicEventId: event.id,
        relationship: "transfer",
        transactionIds: [setup.second.id, setup.third.id],
        rationale: "Run provenance",
        provenance: { actorType: "agent", maintenanceRunId: canonicalId },
      })
      .returning();
    if (!relationship) throw new Error("Relationship missing.");
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "target",
        entityType: "finance_transaction",
        id: setup.second.id,
      }),
    ).toEqual([]);
    await database.db
      .update(financeTransactionRelationships)
      .set({ provenance: { actorType: "agent", maintenanceRunId: other.legacyRunId } })
      .where(eq(financeTransactionRelationships.id, relationship.id));
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "target",
        entityType: "finance_transaction",
        id: setup.second.id,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "finance_maintenance_evidence_missing",
        legacyRunId: null,
        kind: "relationship",
      }),
    ]);
    await database.db
      .update(financeTransactionRelationships)
      .set({ provenance: { actorType: "agent", maintenanceRunId: setup.legacyRunId } })
      .where(eq(financeTransactionRelationships.id, relationship.id));
    expect(
      await findUnverifiedLegacyFinanceEffects(database.db, setup.userId, {
        type: "target",
        entityType: "finance_transaction",
        id: setup.second.id,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "legacy_maintenance_unverified",
        legacyRunId: setup.legacyRunId,
        kind: "relationship",
      }),
    ]);
  });
  it("deduplicates identical repair actions and paginates exact affected identities", async () => {
    const setup = await fixture();
    await database.db.insert(financeTransactionRevisions).values(
      [2, 3].map((version) => ({
        userId: setup.userId,
        transactionId: setup.first.id,
        version,
        changes: { splitPartIds: [setup.second.id] },
        provenance: { actorType: "agent", maintenanceRunId: setup.legacyRunId },
        createdAt: legacyAt,
      })),
    );
    const work = await readFinanceEffectWork(database.db, {
      userId: setup.userId,
      snapshotAt: laterAt,
    });
    expect(work).toHaveLength(2);
    expect(work.map((item) => item.action?.label)).toContain(
      "Inspect transaction change; operator repair required",
    );
    expect(
      await readFinanceEffectWork(database.db, { userId: setup.userId, snapshotAt: laterAt }),
    ).toEqual(work);
    const service = createAgentAccessWorkItemService({
      db: database.db,
      cursorSigningKey: "test",
      now: () => laterAt,
    });
    const principal = {
      actorType: "user" as const,
      actorId: setup.userId,
      userId: setup.userId,
      scopes: new Set<"finances:read">(["finances:read"]),
    };
    const domains = [
      {
        domain: "finances" as const,
        readScope: "finances:read" as const,
        writeScope: "finances:write" as const,
        support: "profile_and_attention" as const,
      },
    ];
    const first = await service.list(principal, { domain: "finances", limit: 1 }, domains);
    expect(first.filteredTotal).toBe(2);
    expect(first.items).toHaveLength(1);
    if (!first.nextCursor) throw new Error("Missing cursor");
    const second = await service.list(
      principal,
      { domain: "finances", limit: 1, cursor: first.nextCursor },
      domains,
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.nextCursor).toBeNull();
    const inaccessible = await service.list(
      { ...principal, scopes: new Set() },
      { limit: 10 },
      domains,
    );
    expect(inaccessible.items).toEqual([]);
  });
});
