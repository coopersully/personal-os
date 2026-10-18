// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceRecurringObligation } from "@personal-os/domain";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecurringCostLadder } from "./recurring-cost-ladder";

const fixture = (
  changes: Partial<FinanceRecurringObligation> = {},
): FinanceRecurringObligation => ({
  id: "bill-1",
  accountId: "account-1",
  displayName: "Music",
  merchant: "Same merchant",
  kind: "subscription",
  cadence: "monthly",
  status: "active",
  source: "user",
  confidence: 1,
  expectedAmount: 19.99,
  nextExpectedDate: "2026-11-01",
  lastObservedDate: "2026-10-01",
  ...changes,
});
function show(
  obligations: FinanceRecurringObligation[],
  accounts = [{ id: "account-1", name: "Checking", currencyCode: "USD" }],
) {
  return render(
    <MemoryRouter>
      <RecurringCostLadder obligations={obligations} accounts={accounts} />
    </MemoryRouter>,
  );
}

it("preserves payment evidence and does not infer fixedness from a user supplied record", () => {
  show([fixture()]);
  const row = within(screen.getByRole("listitem", { name: "Music" }));
  expect(row.getByText("$19.99")).toBeVisible();
  expect(row.getByText(/User supplied · Monthly · Checking/)).toBeVisible();
  expect(row.getAllByText("Unavailable")).toHaveLength(2);
  expect(row.getByText("Fixed or variable amount not established")).toBeVisible();
  expect(row.getByText(/Next expected: 2026-11-01 · Last observed: 2026-10-01/)).toBeVisible();
  expect(row.getByRole("link", { name: "View source account activity for Music" })).toHaveAttribute(
    "href",
    "/finances/transactions?accountId=account-1",
  );
  expect(row.getByText("Record: bill-1")).toBeInTheDocument();
  expect(row.queryByRole("button")).not.toBeInTheDocument();
});

it("separates review, inferred and inactive records without merging matching merchants", () => {
  show([
    fixture(),
    fixture({ id: "bill-2", displayName: "Video", source: "inferred" }),
    fixture({ id: "bill-3", displayName: "Review", status: "needs_review" }),
    fixture({ id: "bill-4", displayName: "Paused", status: "paused" }),
    fixture({ id: "bill-5", displayName: "Ended", status: "cancelled" }),
    fixture({ id: "save", displayName: "Emergency savings", kind: "savings" }),
  ]);
  expect(
    within(screen.getByRole("region", { name: "Active recurring costs" })).getAllByRole("listitem"),
  ).toHaveLength(1);
  expect(
    within(screen.getByRole("region", { name: "Inferred recurring costs" })).getByText("Video"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Needs review recurring costs" })).getByText(
      "Review",
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Inactive recurring costs" })).getAllByRole(
      "listitem",
    ),
  ).toHaveLength(2);
  expect(screen.queryByText("Emergency savings")).not.toBeInTheDocument();
  expect(screen.getByText("Savings contributions excluded.")).toBeVisible();
});

it("never supplies a currency fallback or rounds subcent input into supported money", () => {
  show([
    fixture({ accountId: null, expectedAmount: 0 }),
    fixture({ id: "subcent", displayName: "Subcent", expectedAmount: 1.234 }),
  ]);
  expect(screen.getByText("0 · currency unavailable")).toBeVisible();
  expect(screen.getByText(/Account currency unavailable/)).toBeVisible();
  expect(screen.getByText("$1.234")).toBeVisible();
  expect(screen.getByText(/Amount is not exact supported cents/)).toBeVisible();
});

it.each([
  "JPY",
  "KWD",
  "ZZZ",
])("keeps unsupported currency %s out of equivalent amounts", (currencyCode) => {
  show([fixture()], [{ id: "account-1", name: "Foreign", currencyCode }]);
  expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  expect(
    screen.getByText(
      currencyCode === "ZZZ" ? /Currency not recognized/ : /Currency minor units unsupported/,
    ),
  ).toBeVisible();
});

it("shows an empty comparison when only savings exist", () => {
  show([fixture({ kind: "savings" })]);
  expect(screen.getByText("No bills or subscriptions to compare")).toBeVisible();
  expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
});

it("passes the original record to parent-owned accessible actions", () => {
  const obligation = fixture();
  const renderActions = vi.fn((item: FinanceRecurringObligation) => (
    <button type="button">Pause {item.displayName}</button>
  ));
  render(
    <MemoryRouter>
      <RecurringCostLadder obligations={[obligation]} accounts={[]} renderActions={renderActions} />
    </MemoryRouter>,
  );
  expect(renderActions).toHaveBeenCalledWith(obligation);
  expect(renderActions.mock.calls[0]?.[0]).toBe(obligation);
  expect(
    within(screen.getByRole("listitem", { name: "Music" })).getByRole("button", {
      name: "Pause Music",
    }),
  ).toBeVisible();
});
