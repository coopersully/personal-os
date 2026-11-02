import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import {
  addLocalDays,
  financeBudgetVersionSchema,
  localDateAt,
  localDateToIso,
} from "@personal-os/domain";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createFinanceActivityService } from "./finance/activity-service.js";
import { createFinanceBudgetBaselineQualificationService } from "./finance/baseline-qualification-service.js";
import { createProfileBudgetService } from "./finance/profile-budget-service.js";
import { createFinanceSpendingService } from "./finance/spending-service.js";
import { createFinanceService } from "./finance-service.js";
import { loadQaFixtures, qaFixtureAccounts } from "./qa-fixtures.js";

it("reloads canonical planning fixtures without completing empty, recovery or onboarding personas", async () => {
  const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
  const database = createDatabaseClient(container.getConnectionUri());
  try {
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const now = new Date("2026-12-31T23:00:00Z");
    const keys = ["demo-full", "qa-loaded", "qa-empty", "qa-recovery", "qa-onboarding-finances"];
    const accounts = qaFixtureAccounts.filter((account) => keys.includes(account.key));
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    for (let pass = 0; pass < 2; pass++) {
      await loadQaFixtures(database.db, { accounts, now });
      const activity = createFinanceActivityService({
        db: database.db,
        cursorSecret: "fixture-test-secret",
      });
      const demo = accounts.find((account) => account.key === "demo-full");
      if (!demo) throw new Error("Demo fixture missing");
      const page = await activity.listActivity(demo.id, { limit: 50 });
      expect(page.entries).toHaveLength(5);
      expect(
        page.entries.every(
          (entry) =>
            entry.status === "applied" && entry.actor.type === "user" && entry.changes.length === 1,
        ),
      ).toBe(true);
      const newest = page.entries[0];
      if (!newest) throw new Error("Activity fixture missing");
      expect(newest.explanation).toContain("Everyday checking");
      expect((await activity.readEvidence(demo.id, newest.id)).changes).toHaveLength(1);
      for (const account of accounts.filter((account) => account.key !== "demo-full")) {
        expect((await activity.listActivity(account.id, { limit: 50 })).entries).toEqual([]);
      }
      const runtime = createFinanceService({ db: database.db, now: () => now });
      await runtime.backfillLearning();
      await runtime.backfillLedgerIntegrity();
      for (const account of accounts) {
        const populated = account.key === "demo-full" || account.key === "qa-loaded";
        const profile = await service.getFinancialProfile(account.id);
        const budget = await service.getFinanceBudget(account.id);
        const setup = await database.db.query.financeOnboardingStates.findFirst({
          where: (row, { eq }) => eq(row.userId, account.id),
        });
        if (populated) {
          expect(profile.data).toMatchObject({ householdSize: 1, expectedMonthlyTakeHome: 8250 });
          const parsed = financeBudgetVersionSchema.parse(budget.data);
          expect(parsed.resources[0]?.amount).toBe(8250);
          expect(parsed.allocations).toHaveLength(10);
          expect(parsed.balanceDelta).toBe(account.key === "demo-full" ? 0 : 500);
          expect(parsed.status).toBe(account.key === "demo-full" ? "active" : "incomplete");
          expect(setup?.completedAt).toEqual(now);
          expect(setup?.automationChoice).toBe("later");
          const bases = await database.db.query.financeCashBalanceBases.findMany({
            where: (row, { eq }) => eq(row.userId, account.id),
          });
          expect(bases).toHaveLength(2);
          expect(bases.map((basis) => basis.amountCents).sort((a, b) => a - b)).toEqual([
            842_534, 1_520_000,
          ]);
          const schedules = await database.db.query.financeRecurringScheduleVersions.findMany({
            where: (row, { eq }) => eq(row.userId, account.id),
          });
          expect(schedules).toHaveLength(5);
          const id = (record: number) =>
            `${account.id.slice(0, 8)}-0000-4000-8000-${record.toString(16).padStart(12, "0")}`;
          const today = localDateAt(now, "America/New_York");
          const cashflow = await createFinanceService({
            db: database.db,
            now: () => now,
          }).getFinanceCashflowProjection(account.id, {
            from: localDateToIso(today),
            to: localDateToIso(addLocalDays(today, 30)),
            selectedIncomeStreamId: id(470),
            accountIds: [id(400), id(401)],
          });
          expect(cashflow.projection.status).not.toBe("unavailable");
          const baseline = createFinanceBudgetBaselineQualificationService({
            db: database.db,
            now: () => now,
          });
          const spending = await createFinanceSpendingService({
            db: database.db,
            now: () => now,
            readBudgetQualification: baseline.getQualification,
          }).readSpending(account.id, {
            scope: {
              from: "2026-12-01",
              through: "2026-12-31",
              timezone: "America/New_York",
              accountIds: null,
              categoryIds: null,
              basis: "personal_cost",
              includePending: true,
              subtractRefunds: true,
            },
            grouping: "auto",
            includeUncategorized: true,
          });
          if (account.key === "demo-full") {
            expect(spending.monthlyBudget).toMatchObject({ state: "qualified" });
            if (spending.monthlyBudget?.state === "qualified") {
              expect(
                spending.monthlyBudget.groups.find((group) => group.budgetCents === 380_000),
              ).toMatchObject({ usedCents: 293_742 });
              expect(
                spending.monthlyBudget.groups.find((group) => group.budgetCents === 95_000),
              ).toMatchObject({ usedCents: 17_249 });
            }
            const history = await createFinanceSpendingService({
              db: database.db,
              now: () => now,
            }).readSpending(account.id, {
              scope: { ...spending.snapshot.scope, from: "2026-08-01", through: "2026-11-30" },
              grouping: "auto",
              includeUncategorized: true,
            });
            expect(history.snapshot.coverage).toBe("complete");
            expect(history.snapshot.bins.every((bin) => bin.coverage === "complete")).toBe(true);
            expect(history.source.reasons).not.toContain("historical_coverage_not_certified");
            const outsideCoverage = await createFinanceSpendingService({
              db: database.db,
              now: () => now,
            }).readSpending(account.id, {
              scope: { ...history.snapshot.scope, from: "2026-07-31", through: "2026-08-01" },
              grouping: "auto",
              includeUncategorized: true,
            });
            expect(outsideCoverage.snapshot.bins.map((bin) => bin.coverage)).toEqual([
              "unknown",
              "complete",
            ]);
            const monthly = new Map<string, number>();
            const weekdays = new Set<number>();
            for (const contribution of history.snapshot.contributions) {
              const month = contribution.date.slice(0, 7);
              monthly.set(month, (monthly.get(month) ?? 0) + contribution.netCents);
              weekdays.add(new Date(`${contribution.date}T12:00:00Z`).getUTCDay());
            }
            expect([...monthly.keys()].sort()).toEqual([
              "2026-08",
              "2026-09",
              "2026-10",
              "2026-11",
            ]);
            expect(new Set(monthly.values()).size).toBe(4);
            expect([...monthly.values()].every((amount) => amount > 350_000)).toBe(true);
            expect(weekdays.size).toBe(7);
            expect(history.snapshot.contributions.length).toBeGreaterThan(80);
          } else {
            expect(spending.monthlyBudget?.state).toBe("unavailable");
            expect(spending.snapshot.coverage).toBe("unknown");
          }
        } else {
          expect(profile.data).toBeNull();
          expect(budget.data).toBeNull();
          expect(setup).toBeUndefined();
        }
      }
    }
  } finally {
    await database.close();
    await container.stop();
  }
}, 120_000);
