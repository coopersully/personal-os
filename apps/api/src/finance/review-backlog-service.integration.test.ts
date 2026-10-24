import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import {
  financeReviewBacklogAssessmentSchema,
  financeReviewBacklogPageSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceReviewBacklogService } from "./review-backlog-service.js";

describe.sequential("Finance review backlog complete owner reads", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  let otherId: string;
  let accountId: string;
  let otherAccountId: string;
  const now = () => new Date("2026-10-24T12:00:00Z");
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
    const owners = await database.db
      .insert(users)
      .values(
        [0, 1].map(() => ({
          displayName: "Backlog fixture",
          email: `${randomUUID()}@example.com`,
          passwordHash: "unused",
        })),
      )
      .returning();
    if (!owners[0] || !owners[1]) throw new Error("Missing owner fixtures");
    userId = owners[0].id;
    otherId = owners[1].id;
    const accounts = await database.db
      .insert(financeAccounts)
      .values(
        [userId, otherId].map((userId) => ({
          userId,
          institution: "Synthetic Bank",
          name: "Checking",
          provider: "manual" as const,
          status: "manual" as const,
        })),
      )
      .returning();
    if (!accounts[0] || !accounts[1]) throw new Error("Missing account fixtures");
    accountId = accounts[0].id;
    otherAccountId = accounts[1].id;
  });
  async function transaction(overrides: Partial<typeof financeTransactions.$inferInsert> = {}) {
    const [row] = await database.db
      .insert(financeTransactions)
      .values({
        userId,
        accountId,
        merchant: "Synthetic merchant",
        amount: 1200,
        direction: "expense",
        transactionDate: "2026-10-01",
        ...overrides,
      })
      .returning();
    if (!row) throw new Error("Missing fixture");
    return row;
  }
  async function review(
    transactionId: string,
    overrides: Partial<typeof financeReviewCases.$inferInsert> = {},
  ) {
    const [row] = await database.db
      .insert(financeReviewCases)
      .values({ userId, transactionId, reasonCode: "category_ambiguity", ...overrides })
      .returning();
    if (!row) throw new Error("Missing fixture");
    return row;
  }
  const service = () => createFinanceReviewBacklogService(database.db, { now });

  it("reports all flagged transactions and active cases, including historical, mismatched and null-event cases", async () => {
    const flagged = await transaction({
      merchant: "Savings roundups",
      transactionDate: "2026-09-30",
    });
    const unflagged = await transaction({ needsReview: false });
    await review(flagged.id);
    const mismatch = await review(unflagged.id, {
      status: "deferred",
      reasonCode: "possible_duplicate",
    });
    await review(flagged.id, { status: "resolved" });
    await transaction({ transactionDate: "2026-11-01" });
    await transaction({ transactionDate: "not-a-date" });
    const foreign = await transaction({
      userId: otherId,
      accountId: otherAccountId,
      merchant: "Private other-owner merchant",
    });
    await review(foreign.id, { userId: otherId });
    const assessment = await service().assess(userId);
    expect(financeReviewBacklogAssessmentSchema.safeParse(assessment).success).toBe(true);
    expect(assessment.counts).toEqual({
      items: 5,
      needsReviewTransactions: 3,
      openReviewCases: 1,
      deferredReviewCases: 1,
      currentMonth: 1,
      historical: 2,
      future: 1,
      unknownDate: 1,
      mismatchedReviewCases: 1,
    });
    expect(assessment.reasons).toContainEqual({ reason: "possible_duplicate", count: 1 });
    expect(assessment.groups.find((group) => group.group === "roundups")?.counts.items).toBe(2);
    const page = await service().list(userId);
    expect(financeReviewBacklogPageSchema.safeParse(page).success).toBe(true);
    expect(page.snapshot).toBe(assessment.snapshot);
    expect(page.items.find((item) => item.reviewCaseId === mismatch.id)).toMatchObject({
      transactionId: unflagged.id,
      destination: `/finances?review=${encodeURIComponent(`finance-review:${mismatch.id}`)}`,
      provenance: { evidenceState: "transaction_not_flagged", freshness: "requires_validation" },
      requiresPreview: true,
    });
    expect(
      page.items.find(
        (item) => item.source === "transaction_flag" && item.transactionId === flagged.id,
      ),
    ).toMatchObject({
      destination: `/finances/transactions?transactionId=${flagged.id}`,
    });
    expect(JSON.stringify(page)).not.toContain("Private other-owner merchant");
    expect(
      await database.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.id, flagged.id)),
    ).toMatchObject([{ needsReview: true }]);
  });

  it("keeps a mismatched-owner case visible without disclosing the other owner's transaction", async () => {
    const foreign = await transaction({
      userId: otherId,
      accountId: otherAccountId,
      merchant: "Private other-owner merchant",
    });
    const mismatch = await review(foreign.id);
    const page = await service().list(userId);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      reviewCaseId: mismatch.id,
      transaction: null,
      period: "unknown",
      provenance: { transactionFingerprint: null, evidenceState: "transaction_unavailable" },
    });
    expect(JSON.stringify(page)).not.toContain("Private other-owner merchant");
  });

  it("pages more than a scan chunk exactly and bounds payload without truncating totals", async () => {
    await database.db.insert(financeTransactions).values(
      Array.from({ length: 507 }, (_, i) => ({
        userId,
        accountId,
        merchant: i % 2 ? "Card payment" : "Roundup",
        amount: 100,
        direction: "expense" as const,
        transactionDate: "2026-10-01",
      })),
    );
    const assessment = await service().assess(userId);
    expect(assessment.counts.needsReviewTransactions).toBe(507);
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = await service().list(userId, {
        group: "roundups",
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      expect(page.total).toBe(254);
      expect(page.items.length).toBeLessThanOrEqual(100);
      expect(page.snapshot).toBe(assessment.snapshot);
      expect(page.complete).toBe(page.nextCursor === null);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(254);
    expect(new Set(ids).size).toBe(254);
    expect(ids).toEqual([...ids].sort());
  }, 20_000);

  it("binds cursors to owner/group/current source state and rejects malformed cursors", async () => {
    const first = await transaction();
    await transaction();
    const page = await service().list(userId, { limit: 1 });
    expect(page.nextCursor).not.toBeNull();
    await expect(service().list(otherId, { cursor: page.nextCursor })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      service().list(userId, { group: "roundups", cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(service().list(userId, { cursor: "garbage" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await database.db
      .update(financeTransactions)
      .set({ category: "Changed", notes: "New evidence" })
      .where(eq(financeTransactions.id, first.id));
    await expect(service().list(userId, { cursor: page.nextCursor })).rejects.toMatchObject({
      code: "conflict",
    });
    const latest = await service().list(userId);
    expect(latest.snapshot).not.toBe(page.snapshot);
  });

  it("fingerprints case evidence changes and recognizes potentially stale observations", async () => {
    const row = await transaction({
      updatedAt: new Date("2026-10-20T12:00:00Z"),
      merchant: "x".repeat(400),
      category: "y".repeat(200),
    });
    const caseRow = await review(row.id, {
      lastSeenAt: new Date("2026-10-19T12:00:00Z"),
      evidence: { note: "private evidence not copied into summary" },
    });
    const before = await service().list(userId);
    const beforeCase = before.items.find((item) => item.reviewCaseId === caseRow.id);
    if (!beforeCase) throw new Error("Missing case");
    expect(beforeCase.provenance.evidenceState).toBe("transaction_changed_since_observation");
    expect(beforeCase.transaction?.merchant.length).toBe(240);
    expect(beforeCase.transaction?.category?.length).toBe(120);
    expect(JSON.stringify(before)).not.toContain("private evidence not copied into summary");
    await database.db
      .update(financeReviewCases)
      .set({ evidence: { changed: true } })
      .where(eq(financeReviewCases.id, caseRow.id));
    const after = await service().list(userId);
    const afterCase = after.items.find((item) => item.reviewCaseId === caseRow.id);
    if (!afterCase) throw new Error("Missing case");
    expect(afterCase.fingerprint).not.toBe(beforeCase.fingerprint);
    expect(afterCase.provenance.actionRevision).toBe(caseRow.actionRevision.toString());
    expect(afterCase.provenance.reviewRevision).not.toBe(beforeCase.provenance.reviewRevision);
    expect(afterCase.provenance.transactionFingerprint).toBe(
      beforeCase.provenance.transactionFingerprint,
    );
  });

  it.each([
    "resolution",
    "evidence",
  ] as const)("exposes saved %s clarification and revision timestamps without re-asking", async (source) => {
    const row = await transaction({
      merchant: "Payment",
      updatedAt: new Date("2026-10-20T12:00:00.123Z"),
    });
    const answer = "A synthetic explanation ".repeat(70);
    const caseRow = await review(row.id, {
      ...(source === "resolution"
        ? { resolution: { type: "clarify", answer } }
        : { evidence: { clarification: answer } }),
      updatedAt: new Date("2026-10-21T12:00:00.456Z"),
    });
    const page = await service().list(userId);
    const item = page.items.find((entry) => entry.reviewCaseId === caseRow.id);
    expect(item).toMatchObject({
      savedClarification: { source, text: answer.slice(0, 1000), truncated: true },
      provenance: {
        expectedTransactionUpdatedAt: row.updatedAt.toISOString(),
        expectedReviewUpdatedAt: caseRow.updatedAt.toISOString(),
      },
    });
    expect(item?.recommendedOperations).toContain("review_saved_clarification");
    expect(item?.recommendedOperations).not.toContain("ask_person");
    expect(
      page.items.find((entry) => entry.source === "transaction_flag")?.recommendedOperations,
    ).not.toContain("ask_person");
  });

  it.each([
    ["America/New_York", "2026-10-01T00:30:00Z", "2026-09", 1, 1],
    ["Pacific/Kiritimati", "2026-09-30T12:30:00Z", "2026-10", 1, 0],
  ] as const)("uses owner planning timezone %s at the month boundary", async (timezone, instant, month, currentMonth, future) => {
    await database.db.update(users).set({ planningTimezone: timezone }).where(eq(users.id, userId));
    await transaction({ transactionDate: "2026-09-30" });
    await transaction({ transactionDate: "2026-10-01" });
    const result = await createFinanceReviewBacklogService(database.db, {
      now: () => new Date(instant),
    }).assess(userId);
    expect(result).toMatchObject({
      month,
      timezone,
      counts: { currentMonth, future, historical: 1 - future },
    });
  });

  it("invalidates cursors when the owner timezone changes and refuses invalid or missing owner settings", async () => {
    await transaction();
    await transaction();
    const before = await service().list(userId, { limit: 1 });
    await database.db
      .update(users)
      .set({ planningTimezone: "America/New_York" })
      .where(eq(users.id, userId));
    await expect(service().list(userId, { cursor: before.nextCursor })).rejects.toMatchObject({
      code: "conflict",
    });
    await database.db
      .update(users)
      .set({ planningTimezone: "Invalid/Timezone" })
      .where(eq(users.id, userId));
    await expect(service().assess(userId)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(service().assess(randomUUID())).rejects.toMatchObject({ code: "not_found" });
  });

  it("returns truthful empty results and distinguishes calendar months in snapshot identity", async () => {
    expect(await service().assess(userId)).toMatchObject({
      complete: true,
      counts: { items: 0 },
      groups: expect.any(Array),
    });
    expect(await service().list(userId)).toMatchObject({
      total: 0,
      items: [],
      complete: true,
      nextCursor: null,
    });
    const a = await service().assess(userId);
    const b = await createFinanceReviewBacklogService(database.db, {
      now: () => new Date("2026-11-01T00:00:00Z"),
    }).assess(userId);
    expect(a.snapshot).not.toBe(b.snapshot);
  });
});
