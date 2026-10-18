// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceCashflowScheduleItem, FinanceCashflowScheduleView } from "@personal-os/domain";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinanceCashflowCalendar } from "./cashflow-calendar";

function item(date: string | null, name = "Paycheck"): FinanceCashflowScheduleItem {
  return {
    key: name,
    source: { kind: "income", id: name },
    sourceStatus: "active",
    provenance: "user",
    accountId: null,
    accountName: null,
    currencyCode: null,
    displayName: name,
    kind: "income",
    expectedAmount: 100,
    date,
    dateCertainty: date ? "expected" : "unknown",
    timing: date ? "expected" : "unknown",
    lastObservedDate: null,
    cadence: "monthly",
  };
}
function schedule(from = "2026-03-08", to = "2026-04-02"): FinanceCashflowScheduleView {
  return {
    from,
    to,
    timezone: "America/New_York",
    today: from,
    generatedAt: "2026-03-08T12:00:00Z",
    dated: [
      item("2026-03-08"),
      item("2026-03-31", "Rent"),
      item("2026-03-31", "Utilities"),
      item("2026-04-02", "Savings"),
    ],
    undated: [item(null, "Unknown date")],
    projection: { state: "unavailable", reason: "balance_basis_unavailable" },
    coverage: {
      basis: "next_expected_only",
      recurrenceExpansion: "unavailable",
      matching: "unavailable",
      outsideRangeCount: 0,
    },
  };
}
const renderItem = (value: FinanceCashflowScheduleItem) => (
  <div role="listitem">{value.displayName}</div>
);

it("keeps DST and month-end dates, counts and exact source rows together", async () => {
  const user = userEvent.setup();
  const source = schedule();
  const renderer = vi.fn(renderItem);
  render(<FinanceCashflowCalendar schedule={source} renderItem={renderer} />);
  expect(screen.getByRole("heading", { name: "Sunday, March 8, 2026" })).toBeVisible();
  expect(renderer).toHaveBeenCalledWith(source.dated[0]);
  expect(screen.queryByText("Unknown date")).not.toBeInTheDocument();
  const day = screen.getByRole("button", {
    name: /Tuesday, March 31, 2026, 2 next expected items/,
  });
  expect(day).toHaveTextContent("31 · 2");
  await user.click(day);
  expect(screen.getByRole("heading", { name: "Tuesday, March 31, 2026" })).toBeVisible();
  expect(
    within(screen.getByRole("list"))
      .getAllByRole("listitem")
      .map((row) => row.textContent),
  ).toEqual(["Rent", "Utilities"]);
  expect(renderer).toHaveBeenCalledWith(source.dated[1]);
  expect(renderer).toHaveBeenCalledWith(source.dated[2]);
});

it("bounds month navigation while making the last month reachable", async () => {
  const user = userEvent.setup();
  render(<FinanceCashflowCalendar schedule={schedule()} renderItem={renderItem} />);
  expect(screen.getByRole("button", { name: /previous month/i })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await user.click(screen.getByRole("button", { name: /next month/i }));
  expect(screen.getByRole("button", { name: /next month/i })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await user.click(
    screen.getByRole("button", { name: /Thursday, April 2, 2026, 1 next expected item/ }),
  );
  expect(screen.getByText("Savings")).toBeVisible();
  expect(screen.getByRole("button", { name: /Friday, April 3, 2026/ })).toBeDisabled();
});

it("supports keyboard day selection and honestly describes a day without recorded items", async () => {
  const user = userEvent.setup();
  render(<FinanceCashflowCalendar schedule={schedule()} renderItem={renderItem} />);
  act(() => {
    screen.getByRole("button", { name: /Sunday, March 8, 2026, 1 next expected item/ }).focus();
  });
  await user.keyboard("{ArrowRight}{Enter}");
  expect(screen.getByRole("heading", { name: "Monday, March 9, 2026" })).toBeVisible();
  expect(screen.getByText("No next expected items recorded for this day.")).toBeVisible();
});

it("resets selection and month inside a changed empty range", () => {
  const { rerender } = render(
    <FinanceCashflowCalendar schedule={schedule()} renderItem={renderItem} />,
  );
  const empty = { ...schedule("2026-11-01", "2026-11-10"), dated: [] };
  rerender(<FinanceCashflowCalendar schedule={empty} renderItem={renderItem} />);
  expect(screen.getByRole("heading", { name: "Sunday, November 1, 2026" })).toBeVisible();
  expect(
    screen.getByRole("button", {
      name: /Sunday, November 1, 2026, 0 next expected items, selected/,
    }),
  ).toBeVisible();
  expect(screen.getByText("No next expected items recorded for this day.")).toBeVisible();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

it("can navigate the entire 366-date range without expanding recurrence", async () => {
  const user = userEvent.setup();
  const final = item("2027-01-31", "Last recorded item");
  render(
    <FinanceCashflowCalendar
      schedule={{ ...schedule("2026-01-31", "2027-01-31"), dated: [final] }}
      renderItem={renderItem}
    />,
  );
  for (let month = 0; month < 12; month += 1) {
    await user.click(screen.getByRole("button", { name: /next month/i }));
  }
  await user.click(
    screen.getByRole("button", { name: /Sunday, January 31, 2027, 1 next expected item/ }),
  );
  expect(screen.getByText("Last recorded item")).toBeVisible();
  expect(screen.getByRole("button", { name: /next month/i })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});
