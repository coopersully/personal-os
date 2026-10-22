import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { financeBudgetVersionSchema } from "@personal-os/domain";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createProfileBudgetService } from "./finance/profile-budget-service.js";
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
          expect(parsed.allocations).toHaveLength(9);
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
