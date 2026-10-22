// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import {
  CashflowOccurrenceItem,
  CashflowPlanningControls,
  type CashflowPlanningRow,
} from "./cashflow-planning-views.js";

const row: CashflowPlanningRow = {
  key: "bill",
  date: null,
  source: { kind: "obligation", id: "bill / one" },
  displayName: "Unconfirmed bill",
  currency: null,
  amountCents: null,
  occurrence: null,
  cadence: null,
  scheduleTimezone: null,
  recordedAt: null,
  lastObservedDate: null,
};

it("keeps unknown amount, currency and provenance explicit and prevents unavailable scheduling", () => {
  const onSchedule = vi.fn();
  const { rerender } = render(
    <MemoryRouter>
      <CashflowOccurrenceItem
        row={row}
        canSchedule={false}
        canInspect={false}
        onSchedule={onSchedule}
        onMatch={vi.fn()}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Amount unknown/)).toBeVisible();
  expect(screen.getByText(/Cadence not established/)).not.toBeVisible();
  fireEvent.click(screen.getByText("Schedule details"));
  expect(screen.getByText(/Cadence not established/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Unconfirmed bill" })).toHaveAttribute(
    "href",
    "/finances/cashflow?view=subscriptions&record=bill%20%2F%20one",
  );
  expect(screen.getByRole("button", { name: "Confirm schedule" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Match or inspect receipts" }),
  ).not.toBeInTheDocument();
  rerender(
    <MemoryRouter>
      <CashflowOccurrenceItem
        row={{ ...row, amountCents: 1200, lastObservedDate: "2026-10-01" }}
        canSchedule
        canInspect={false}
        onSchedule={onSchedule}
        onMatch={vi.fn()}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText(/12.00 · currency unknown/)).toBeVisible();
  expect(screen.getByText(/Source last observed Oct 1, 2026/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Confirm schedule" }));
  expect(onSchedule).toHaveBeenCalledWith(row.source);
});

it("discloses unsupported planning units without relabeling the original amount", () => {
  render(
    <MemoryRouter>
      <CashflowOccurrenceItem
        row={{ ...row, amountCents: 1200, currency: "JPY" }}
        canSchedule
        canInspect
        onSchedule={vi.fn()}
        onMatch={vi.fn()}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText(/12.00 JPY/)).toBeVisible();
  expect(screen.getByText(/Planning currency units unsupported/)).toBeVisible();
});

const accounts = [
  { id: "cash-a", name: "First cash" },
  { id: "cash-b", name: "Second cash" },
];
function controls(accountIds: string[] | undefined) {
  const onParamChange = vi.fn();
  const onReset = vi.fn();
  render(
    <CashflowPlanningControls
      from="2026-10-01"
      to="2026-10-31"
      presentation="agenda"
      accountIds={accountIds}
      accounts={accounts}
      onParamChange={onParamChange}
      onReset={onReset}
    />,
  );
  return { onParamChange, onReset };
}

it("changes dates and presentation through named controls and provides filter reset", async () => {
  const callbacks = controls(undefined);
  await userEvent.click(screen.getByRole("button", { name: "Timeline options" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-02" } });
  fireEvent.change(screen.getByLabelText("Through"), { target: { value: "2026-10-30" } });
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  await userEvent.click(screen.getByRole("radio", { name: "Calendar" }));
  await userEvent.click(screen.getByRole("button", { name: "Timeline options" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset timeline filters" }));
  expect(callbacks.onParamChange.mock.calls).toEqual([
    ["cashflowFrom", "2026-10-02"],
    ["cashflowTo", "2026-10-30"],
    ["timeline", "calendar"],
  ]);
  expect(callbacks.onReset).toHaveBeenCalledOnce();
});

it.each([
  { scope: undefined, label: "All source accounts", accountName: "First cash", expected: "cash-b" },
  {
    scope: [] as string[],
    label: "No accounts selected",
    accountName: "First cash",
    expected: "cash-a",
  },
  { scope: ["cash-a"], label: "1 selected accounts", accountName: "First cash", expected: "none" },
])("changes $label without treating an empty selection as all accounts", async ({
  scope,
  label,
  accountName,
  expected,
}) => {
  const user = userEvent.setup();
  const { onParamChange } = controls(scope);
  await user.click(screen.getByRole("button", { name: "Timeline options" }));
  await user.click(screen.getByRole("button", { name: label }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: accountName }));
  expect(onParamChange).toHaveBeenCalledWith("cashflowAccounts", expected);
});

it.each([
  { menu: "Select no accounts", expected: "none" },
  { menu: "All source accounts", expected: null },
])("offers the explicit $menu policy", async ({ menu, expected }) => {
  const user = userEvent.setup();
  const { onParamChange } = controls(["cash-a"]);
  await user.click(screen.getByRole("button", { name: "Timeline options" }));
  await user.click(screen.getByRole("button", { name: "1 selected accounts" }));
  await user.click(screen.getByRole("menuitem", { name: menu }));
  expect(onParamChange).toHaveBeenCalledWith("cashflowAccounts", expected);
});
