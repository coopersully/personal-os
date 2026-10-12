import type { FinanceTransaction } from "@personal-os/domain";
import { formatCompactMoney } from "./format";
import { groupTransactions } from "./transaction-groups";

const rows = [
  {
    id: "a",
    category: "Travel",
    pending: true,
    direction: "expense",
    date: "2026-09-30",
    merchant: "Metro",
  },
  {
    id: "b",
    category: null,
    pending: false,
    direction: "income",
    date: "2026-09-29",
    merchant: "Payroll",
  },
  {
    id: "c",
    category: "Travel",
    pending: false,
    direction: "transfer",
    date: "2026-09-30",
    merchant: "Metro",
  },
] as FinanceTransaction[];
it("groups once per record while preserving within-group sort order", () => {
  expect(
    groupTransactions(rows, "category").map(({ label, items }) => [
      label,
      items.map((item) => item.id),
    ]),
  ).toEqual([
    ["Travel", ["a", "c"]],
    ["Uncategorized", ["b"]],
  ]);
  expect(
    groupTransactions(rows, "posting").map(({ label, items }) => [label, items.length]),
  ).toEqual([
    ["Pending", 1],
    ["Posted", 2],
  ]);
  expect(groupTransactions(rows, "date")).toHaveLength(2);
  expect(groupTransactions(rows, "merchant")).toHaveLength(2);
  expect(groupTransactions(rows, "direction").map(({ label }) => label)).toEqual([
    "Expenses",
    "Income",
    "Transfers",
  ]);
  expect(groupTransactions(rows, "invalid")).toEqual([{ label: "", items: rows }]);
  expect(groupTransactions([], "date")).toEqual([]);
});
it("compacts money without losing currency or negative signs", () => {
  expect(formatCompactMoney(23625.34)).toBe("$23.6k");
  expect(formatCompactMoney(-1247.5)).toBe("-$1.2k");
  expect(formatCompactMoney(0)).toBe("$0");
  expect(formatCompactMoney(2400000)).toBe("$2.4M");
});
