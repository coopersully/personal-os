import type { FinanceBudgetBaselineSnapshot } from "@personal-os/domain";
import { baselinePeriod, baselineQualificationKind } from "./baseline-qualification-evidence.js";
import { createFinanceBudgetBaselineQualificationService } from "./baseline-qualification-service.js";

describe("baseline qualification evidence", () => {
  it("uses complete calendar months, including leap day", () => {
    expect(baselinePeriod("2024-02", "America/New_York")).toEqual({
      from: "2024-02-01",
      through: "2024-02-29",
      timezone: "America/New_York",
    });
    expect(baselinePeriod("2026-12", "UTC").through).toBe("2026-12-31");
  });
  it("discloses retrospective confirmation using the reviewed timezone and original actor", () => {
    const snapshot = {
      month: "2026-10",
      period: { timezone: "America/Los_Angeles" },
      originalApproval: { actorType: "user", actorId: "owner" },
    } as FinanceBudgetBaselineSnapshot;
    const now = new Date("2026-11-01T03:00:00Z");
    expect(baselineQualificationKind(snapshot, now, "owner")).toBe("current");
    expect(
      baselineQualificationKind(
        { ...snapshot, period: { ...snapshot.period, timezone: "UTC" } },
        now,
        "owner",
      ),
    ).toBe("retrospective");
    expect(
      baselineQualificationKind(
        { ...snapshot, originalApproval: { ...snapshot.originalApproval, actorType: "agent" } },
        now,
        "owner",
      ),
    ).toBe("retrospective");
  });
  it.each([
    { actorType: "agent", actorId: "agent" },
    { actorType: "user", actorId: "other" },
  ] as const)("rejects unauthorized confirmation before any durable mutation", async ({
    actorType,
    actorId,
  }) => {
    const transaction = vi.fn();
    const service = createFinanceBudgetBaselineQualificationService({
      db: { transaction } as never,
      now: () => new Date(),
    });
    await expect(
      service.confirm(
        {},
        {
          actorType,
          actorId,
          userId: "owner",
          canMutate: true,
          canSelfApprove: true,
          bypassEnabled: true,
          requestId: "forbidden",
        },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(transaction).not.toHaveBeenCalled();
  });
});
