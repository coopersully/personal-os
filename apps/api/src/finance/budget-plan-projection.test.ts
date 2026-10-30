import type { Database } from "@personal-os/database";
import { budgetPlanningDate, readBudgetPlanContext } from "./budget-plan-projection.js";

describe("budget plan projection read boundary", () => {
  it("uses wall dates rather than UTC month near midnight and rejects invalid timezones", () => {
    expect(budgetPlanningDate(new Date("2026-11-01T02:30:00Z"), "America/New_York")).toBe(
      "2026-10-31",
    );
    expect(budgetPlanningDate(new Date("2026-11-01T02:30:00Z"), "UTC")).toBe("2026-11-01");
    expect(() => budgetPlanningDate(new Date(), "Invalid/Timezone")).toThrow();
  });
  it("propagates unavailable storage instead of fabricating a missing plan", async () => {
    const error = new Error("storage unavailable");
    const reader = {
      select: () => {
        throw error;
      },
    } as unknown as Pick<Database, "select">;
    await expect(readBudgetPlanContext(reader, crypto.randomUUID(), new Date())).rejects.toBe(
      error,
    );
  });
});
