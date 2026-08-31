import { describe, expect, it, vi } from "vitest";
import { createFinancePlaybookService } from "./finance-playbook-service.js";

describe("Finance playbook service", () => {
  it("does not require the wealth summary for a profile-based assessment", async () => {
    const getFinancialProfile = vi.fn(async () => ({ data: null }));
    const getWealthSummary = vi.fn(async () => {
      throw new Error("wealth unavailable");
    });
    const service = createFinancePlaybookService({
      finances: { getFinancialProfile, getWealthSummary } as never,
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    });

    await expect(service.get("11111111-1111-4111-8111-111111111111")).resolves.toMatchObject({
      assessment: { readiness: "not_ready" },
    });
    expect(getFinancialProfile).toHaveBeenCalledOnce();
    expect(getWealthSummary).not.toHaveBeenCalled();
  });
});
