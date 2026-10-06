import { readFinanceConfiguration } from "./configuration-service.js";

it("reads configuration without advancing setup and keeps successful sibling reads", async () => {
  const profile = { version: 3, jurisdiction: "US-NY" };
  const reads = {
    execution: vi.fn().mockResolvedValue(null),
    profile: vi.fn().mockResolvedValue(profile),
    preferences: vi.fn().mockResolvedValue({ revision: 0, preferences: {} }),
    income: vi.fn().mockResolvedValue(null),
    budget: vi.fn().mockRejectedValue(new Error("private database detail")),
    accounts: vi.fn().mockResolvedValue({ items: [] }),
    guidance: vi.fn().mockResolvedValue(null),
  };
  const result = await readFinanceConfiguration(reads);
  expect(result.profile).toEqual({ state: "loaded", value: profile });
  expect(result.budget).toEqual({ state: "unavailable" });
  expect(result.capabilities.budget.state).toBe("unavailable");
  expect(JSON.stringify(result)).not.toContain("private database detail");
  expect(reads.profile).toHaveBeenCalledTimes(1);
});
