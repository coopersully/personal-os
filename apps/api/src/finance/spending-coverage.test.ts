import { describe, expect, it } from "vitest";
import { type SpendingCoverageInterval, spendingDateCoverage } from "./spending-coverage.js";

const interval: SpendingCoverageInterval = {
  id: "evidence",
  userId: "owner",
  accountId: "cash",
  fromDate: "2026-06-01",
  throughDate: "2026-09-30",
  timezone: "America/New_York",
  currencyCode: "USD",
  evidenceRef: "statement:2026-Q3",
  recordedAt: new Date("2026-10-01T12:00:00Z"),
};
const input = {
  userId: "owner",
  accounts: [{ id: "cash", currencyCode: "USD" }],
  date: "2026-08-05",
  timezone: "America/New_York",
  asOf: "2026-10-22T12:00:00Z",
  intervals: [interval],
};
describe("explicit transaction interval coverage", () => {
  it("requires complete evidence for every selected account, including zero-transaction accounts", () => {
    expect(spendingDateCoverage(input)).toBe("complete");
    expect(
      spendingDateCoverage({
        ...input,
        accounts: [
          { id: "cash", currencyCode: "USD" },
          { id: "card", currencyCode: "USD" },
        ],
      }),
    ).toBe("partial");
    expect(spendingDateCoverage({ ...input, accounts: [] })).toBe("unknown");
    expect(spendingDateCoverage({ ...input, intervals: [] })).toBe("unknown");
    expect(
      spendingDateCoverage({ ...input, accounts: [{ id: "cash", currencyCode: "EUR" }] }),
    ).toBe("unknown");
  });
  it.each([
    { userId: "someone-else" },
    { accountId: "other" },
    { timezone: "UTC" },
    { currencyCode: "EUR" },
    { fromDate: "2026-08-06" },
    { throughDate: "2026-08-04" },
    { recordedAt: new Date("2026-10-23T12:00:00Z") },
    { evidenceRef: " " },
  ])("does not certify incompatible, foreign, out-of-period or future evidence: %j", (change) => {
    expect(spendingDateCoverage({ ...input, intervals: [{ ...interval, ...change }] })).toBe(
      "unknown",
    );
  });
});
