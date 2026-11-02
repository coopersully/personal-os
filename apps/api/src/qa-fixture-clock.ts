import { createHash } from "node:crypto";
import {
  type Database,
  financeBudgetAllocations,
  financeBudgets,
  financeBudgetVersions,
  financeTransactionCoverage,
  financeTransactions,
  users,
} from "@personal-os/database";
import { addLocalDays, localDateAt, localDateToIso } from "@personal-os/domain";
import { and, desc, eq, like, max, or, sql } from "drizzle-orm";
import { createFinanceBudgetBaselineQualificationService } from "./finance/baseline-qualification-service.js";
import { loadFinanceAuthorization } from "./finance/context.js";

const owner = "f1000000-0000-4000-8000-000000000001";
const id = (record: number) => `f1000000-0000-4000-8000-${record.toString(16).padStart(12, "0")}`;
const timezone = "America/New_York";
const key = (value: string) => {
  const hex = createHash("sha256").update(`qa-fixture-clock:${value}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** Only the worktree-owned local runtime may manufacture fictional daily activity. */
export function qaFixtureClockEnabled(env: NodeJS.ProcessEnv, databaseUrl: string) {
  return (
    env.QA_FIXTURE_CLOCK === "true" &&
    env.NODE_ENV !== "production" &&
    ["postgres", "localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)
  );
}

export function dailyDemoTransactions(date: string, now: Date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const purchases = [
    {
      category: "Dining",
      categoryId: id(420),
      merchant: "CORNER CAFE NYC #042",
      merchantId: id(430),
      amount: 575 + (Number(date.slice(-2)) % 4) * 125,
    },
    ...(day === 0
      ? [
          {
            category: "Groceries",
            categoryId: id(421),
            merchant: "NEIGHBORHOOD MARKET",
            merchantId: id(431),
            amount: 10_200 + (Number(date.slice(-2)) % 5) * 735,
          },
        ]
      : []),
    ...(day === 5 || day === 6
      ? [
          {
            category: "Dining",
            categoryId: id(420),
            merchant: "HUDSON TABLE",
            merchantId: id(1901),
            amount: 3_800 + (Number(date.slice(-2)) % 7) * 650,
          },
        ]
      : []),
  ];
  return purchases.map((purchase, index): typeof financeTransactions.$inferInsert => ({
    ...purchase,
    id: key(`${date}:${index}`),
    userId: owner,
    accountId: id(403),
    providerTransactionId: `fixture-live-${date}-${index}`,
    transactionDate: date,
    currencyCode: "USD",
    direction: "expense",
    categorySource: "user",
    categoryConfidence: 10_000,
    categoryDecidedAt: now,
    needsReview: false,
    pending: false,
    createdAt: now,
    updatedAt: now,
  }));
}

/** Add missing days; never reload users, sessions, existing transactions or account edits. */
export async function refreshQaFinanceFixtures(db: Database, now = new Date()) {
  const today = localDateToIso(localDateAt(now, timezone));
  const month = today.slice(0, 7);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('qa-fixture-clock'))`);
    const demo = await tx.query.users.findFirst({
      where: and(eq(users.id, owner), eq(users.email, "demo+full@nohmi.test")),
    });
    if (!demo) return null;
    const [anchor] = await tx
      .select({ date: max(financeTransactions.transactionDate) })
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.userId, owner),
          or(
            eq(financeTransactions.id, id(441)),
            like(financeTransactions.providerTransactionId, "fixture-live-%"),
          ),
        ),
      );
    if (!anchor?.date) return null; // An ordinary account cannot opt itself into fixture writes.
    let date = localDateToIso(
      addLocalDays(localDateAt(new Date(`${anchor.date}T17:00:00Z`), timezone), 1),
    );
    let days = 0;
    for (; date <= today && days < 31; days++) {
      await tx
        .insert(financeTransactions)
        .values(dailyDemoTransactions(date, now))
        .onConflictDoNothing();
      date = localDateToIso(addLocalDays(localDateAt(new Date(`${date}T17:00:00Z`), timezone), 1));
    }
    const latest = await tx.query.financeBudgetVersions.findFirst({
      where: and(
        eq(financeBudgetVersions.userId, owner),
        eq(financeBudgetVersions.status, "active"),
      ),
      orderBy: desc(financeBudgetVersions.effectiveFrom),
    });
    let budgetId = latest?.id;
    if (latest && latest.effectiveFrom < month) {
      budgetId = key(`budget:${month}`);
      const versions = await tx
        .select({ version: max(financeBudgetVersions.version) })
        .from(financeBudgetVersions)
        .where(eq(financeBudgetVersions.planId, latest.planId));
      await tx.insert(financeBudgetVersions).values({
        ...latest,
        id: budgetId,
        version: (versions[0]?.version ?? 0) + 1,
        effectiveFrom: month,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const allocations = await tx.query.financeBudgetAllocations.findMany({
        where: eq(financeBudgetAllocations.budgetVersionId, latest.id),
      });
      if (allocations.length)
        await tx.insert(financeBudgetAllocations).values(
          allocations.map((row) => ({
            ...row,
            id: key(`allocation:${month}:${row.id}`),
            budgetVersionId: budgetId as string,
            createdAt: now,
            updatedAt: now,
          })),
        );
    }
    const limits = await tx.query.financeBudgets.findMany({
      where: eq(financeBudgets.userId, owner),
      orderBy: desc(financeBudgets.month),
    });
    const categories = new Set<string>();
    for (const limit of limits) {
      if (categories.has(limit.category)) continue;
      categories.add(limit.category);
      await tx
        .insert(financeBudgets)
        .values({
          ...limit,
          id: key(`limit:${month}:${limit.category}`),
          month,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
    // Coverage ends yesterday: today's activity is still in progress.
    const through = [
      localDateToIso(addLocalDays(localDateAt(now, timezone), -1)),
      localDateToIso(addLocalDays(localDateAt(new Date(`${date}T17:00:00Z`), timezone), -1)),
    ].sort()[0];
    if (through && through >= anchor.date && days > 0)
      await tx
        .insert(financeTransactionCoverage)
        .values(
          [400, 401, 402, 403].map((record) => ({
            id: key(`coverage:${through}:${record}`),
            userId: owner,
            accountId: id(record),
            fromDate: anchor.date as string,
            throughDate: through,
            timezone,
            currencyCode: "USD",
            evidenceRef: "qa-fixture:rolling-demo-ledger:v1",
            recordedAt: now,
          })),
        )
        .onConflictDoNothing();
    return { days, caughtUp: date > today, budgetId };
  });
  if (result?.budgetId) {
    const service = createFinanceBudgetBaselineQualificationService({ db, now: () => now });
    if ((await service.getQualification(owner, month)).state !== "qualified") {
      const context = await loadFinanceAuthorization({
        db,
        principal: {
          actorId: owner,
          actorType: "user",
          userId: owner,
          scopes: new Set(["finances:write"]),
        },
        requestId: `qa-clock:${month}`,
      });
      const review = await service.prepare(
        {
          month,
          budgetVersionId: result.budgetId,
          accountIds: [400, 401, 403].map(id),
          currency: "USD",
          timezone,
          idempotencyKey: `qa-clock-prepare:${month}`,
        },
        context,
      );
      await service.confirm(
        {
          reviewId: review.id,
          expectedFingerprint: review.fingerprint,
          idempotencyKey: `qa-clock-confirm:${month}`,
        },
        context,
      );
    }
  }
  return result;
}
