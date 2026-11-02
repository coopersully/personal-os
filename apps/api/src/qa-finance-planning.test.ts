import { financeBudgetVersionSchema, financeSetupPlanningSchema } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { financePlanningFixture } from "./qa-finance-planning.js";

const userId = "f1000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-22T19:00:00Z");

describe("Finance planning fixtures", () => {
  it.each([true, false])("provides a coherent canonical budget (complete: %s)", (complete) => {
    const fixture = financePlanningFixture(userId, now, complete);
    const budget = financeBudgetVersionSchema.parse({
      ...fixture.budget,
      resources: fixture.budget.resources?.map((resource) => ({
        ...resource,
        amount: Number(resource.amount) / 100,
      })),
      allocatedTotal: fixture.budget.allocatedTotal / 100,
      expectedResources: fixture.budget.expectedResources / 100,
      balanceDelta: fixture.budget.balanceDelta / 100,
      createdAt: now.toISOString(),
      approvedAt: complete ? now.toISOString() : null,
      allocations: fixture.allocations.map((allocation) => ({
        ...allocation,
        key: allocation.allocationKey,
        amount: allocation.amount / 100,
      })),
    });
    expect(budget.status).toBe(complete ? "active" : "incomplete");
    expect(budget.balanceDelta).toBe(complete ? 0 : 500);
    expect(budget.approvedAt !== null).toBe(complete);
    const planning = financeSetupPlanningSchema.parse(fixture.profile.planning);
    expect(planning.obligations).toHaveLength(4);
    expect(planning.recurringIncome?.amountCents).toBe(fixture.profile.expectedMonthlyTakeHome);
    for (const allocation of fixture.allocations) {
      if (allocation.goalId)
        expect(fixture.goals.some((goal) => goal.id === allocation.goalId)).toBe(true);
    }
    for (const contribution of planning.contributions ?? []) {
      expect(fixture.goals.some((goal) => goal.id === contribution.goalId)).toBe(true);
    }
    expect(new Set(fixture.goals.map((goal) => goal.status))).toEqual(
      new Set(["active", "paused", "completed"]),
    );
    expect(fixture.onboarding.answers?.every((answer) => answer.disposition === "answered")).toBe(
      true,
    );
    expect(fixture.onboarding.automationChoice).toBe("later");
    expect(fixture.evidence.filter((row) => row.goalId)).toHaveLength(4);
    expect(fixture.schedules).toHaveLength(5);
    for (const obligation of fixture.obligations) {
      expect(
        fixture.schedules.find((schedule) => schedule.obligationId === obligation.id),
      ).toMatchObject({
        accountId: obligation.accountId,
        amountCents: obligation.expectedAmount,
        anchorLocalDate: obligation.nextExpectedDate,
      });
    }
  });

  it("keeps identities stable, owners isolated, and dates current across year and DST boundaries", () => {
    const before = financePlanningFixture(userId, new Date("2026-12-31T23:30:00Z"), true);
    const after = financePlanningFixture(userId, new Date("2027-01-01T01:30:00Z"), true);
    expect(before).toMatchObject({ plan: { month: "2026-12" } });
    expect(after.plan.month).toBe("2026-12"); // Still Dec 31 in New York.
    const spring = financePlanningFixture(userId, new Date("2027-03-14T16:00:00Z"), true);
    expect(spring.schedules[0]?.anchorLocalDate).toBe("2027-03-21");
    expect(spring.allocations.map((row) => row.id)).toEqual(
      before.allocations.map((row) => row.id),
    );
    const other = financePlanningFixture("f2000000-0000-4000-8000-000000000001", now, false);
    expect(other.profile.id).not.toBe(before.profile.id);
    expect(other.goals.every((goal) => goal.userId === other.profile.userId)).toBe(true);
  });
});
