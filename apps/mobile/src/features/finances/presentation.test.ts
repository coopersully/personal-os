import { describe, expect, it } from "vitest";
import { workspacePages } from "../../navigation/workspace-pages";
import { currencyForTotals, formatMoney, periodScope } from "./presentation";

describe("mobile Finance presentation", () => {
  it("keeps missing balances unavailable and defaults legacy currency to USD", () => {
    expect(formatMoney(null, "USD")).toBe("Unavailable");
    expect(formatMoney(100, null)).toBe("$100.00");
    expect(formatMoney(100, "EUR")).toContain("100.00");
    expect(formatMoney(0, "USD")).toBe("$0.00");
    expect(formatMoney(1234.56, "USD")).toBe("$1,234.56");
    expect(formatMoney(-42, "USD")).toBe("-$42.00");
  });
  it("does not combine mixed or unknown currencies", () => {
    expect(currencyForTotals([])).toBeNull();
    expect(currencyForTotals([{ currencyCode: "USD" }])).toBe("USD");
    expect(currencyForTotals([{ currencyCode: "USD" }, { currencyCode: "EUR" }])).toBeNull();
    expect(currencyForTotals([{ currencyCode: "USD" }, { currencyCode: null }])).toBeNull();
  });
  it("uses the account timezone for calendar periods including year boundaries", () => {
    const at = new Date("2026-01-01T01:00:00Z");
    expect(periodScope("month", "America/New_York", at)).toMatchObject({
      from: "2025-12-01",
      through: "2025-12-31",
      timezone: "America/New_York",
    });
    expect(periodScope("week", "America/New_York", at)).toMatchObject({
      from: "2025-12-29",
      through: "2026-01-04",
    });
  });
  it("provides the approved five destinations", () => {
    expect(workspacePages.finances.map((page) => page.name)).toEqual([
      "index",
      "spending",
      "plan",
      "accounts",
      "assistant",
    ]);
  });
});

it("uses date-only upcoming ranges across a month boundary", async () => {
  const { upcomingScope } = await import("./presentation");
  expect(upcomingScope("America/New_York", new Date("2026-01-01T01:00:00Z"))).toEqual({
    from: "2025-12-31",
    to: "2026-01-30",
  });
});

it("distinguishes expected money in and out without assuming unknown amounts", async () => {
  const { expectedAmount } = await import("./presentation");
  expect(
    expectedAmount({
      source: { kind: "income" },
      remainingExpectedCents: 5000,
      currencyCode: "USD",
    }),
  ).toMatch(/\+\$50\.00/);
  expect(
    expectedAmount({
      source: { kind: "obligation" },
      remainingExpectedCents: 5000,
      currencyCode: "USD",
    }),
  ).toMatch(/−\$50\.00/);
  expect(
    expectedAmount({
      source: { kind: "obligation" },
      remainingExpectedCents: null,
      currencyCode: "USD",
    }),
  ).toBe("Unavailable");
});

it("formats legacy record amounts as USD and preserves explicit currency", async () => {
  const { recordAmount, formatLocalDate } = await import("./presentation");
  expect(recordAmount(124, null)).toBe("$124.00");
  expect(recordAmount(null, "USD")).toBe("Unavailable");
  expect(recordAmount(124, "EUR")).toMatch(/EUR\s124\.00/);
  expect(formatLocalDate("2026-01-01")).toBe("Jan 1");
});
