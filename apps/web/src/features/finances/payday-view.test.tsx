// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceCashflowProjectionView } from "@personal-os/domain";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PaydayView } from "./payday-view.js";

const actions = () => ({
  onIncomeStreamChange: vi.fn(),
  onConfirmSchedule: vi.fn(),
  onReviewActuals: vi.fn(),
  onConfirmBalance: vi.fn(),
  onRefresh: vi.fn(),
});
const incomeStreams = [
  { id: "job-a", displayName: "Main job" },
  { id: "job-b", displayName: "Other job" },
];
function estimate(): FinanceCashflowProjectionView {
  return {
    schedule: {
      from: "2026-10-01",
      to: "2026-10-31",
      occurrences: [],
      matchEvents: [],
      unavailableSources: [],
    },
    projection: {
      status: "estimated",
      currencyCode: "USD",
      periodStartLocalDate: "2026-10-01",
      asOfLocalDate: "2026-10-01",
      asOfInstant: "2026-10-01T12:00:00Z",
      endLocalDate: "2026-10-31",
      selectedIncomeStreamId: "job-a",
      nextPaydayOccurrenceId: "payday",
      expectedEndPaydayIncomeMinorUnits: 100000,
      openingBalanceMinorUnits: 20000,
      endingBalanceMinorUnits: 90000,
      lowestEndOfDayBalance: {
        amountMinorUnits: 10000,
        localDate: "2026-10-03",
        basis: "end_of_day",
      },
      days: Array.from({ length: 30 }, (_, index) => ({
        localDate: `2026-10-${String(index + 1).padStart(2, "0")}`,
        estimatedEndOfDayBalanceMinorUnits: 20000,
        expectedIncomingMinorUnits: 0,
        expectedOutgoingMinorUnits: 0,
        unreflectedActualNetMinorUnits: 0,
        events: [],
      })),
      protectedFloor: { status: "unknown" },
      assumptions: [],
      evidence: {
        balances: [
          {
            accountId: "cash",
            basis: "available",
            sourceRevision: "9",
            asOfInstant: "2026-10-01T12:00:00Z",
            validUntilInstant: "2026-10-01T13:00:00Z",
          },
        ],
        occurrences: [],
        actualMovements: [],
      },
    },
  };
}
it("requires explicit income selection and exposes real recovery actions for incomplete evidence", () => {
  const callbacks = actions();
  render(
    <PaydayView
      view={null}
      incomeStreams={incomeStreams}
      selectedIncomeStreamId={null}
      {...callbacks}
    />,
  );
  expect(screen.getByLabelText("Income stream defining this cycle")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Income stream defining this cycle"), {
    target: { value: "job-b" },
  });
  expect(callbacks.onIncomeStreamChange).toHaveBeenCalledWith("job-b");
  fireEvent.click(screen.getByRole("button", { name: "Confirm recurring schedule" }));
  fireEvent.click(screen.getByRole("button", { name: "Review actual matches" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm balance and reflections" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh cycle evidence" }));
  for (const callback of [
    callbacks.onConfirmSchedule,
    callbacks.onReviewActuals,
    callbacks.onConfirmBalance,
    callbacks.onRefresh,
  ])
    expect(callback).toHaveBeenCalledOnce();
});
it("renders qualified end-payday estimates, floor unknown and intraday limits with bounded movement pages", () => {
  render(
    <PaydayView
      view={estimate()}
      incomeStreams={incomeStreams}
      selectedIncomeStreamId="job-a"
      {...actions()}
    />,
  );
  expect(
    screen.getByText(/expected end-payday income, not a confirmed receipt/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Protected floor unknown. No zero floor/)).toBeInTheDocument();
  expect(screen.getByText(/intraday order and any intraday low are unknown/)).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Estimated cycle movements" });
  expect(within(table).getAllByRole("row")).toHaveLength(25);
  fireEvent.click(screen.getByRole("button", { name: "Next cycle movements" }));
  expect(within(table).getByRole("cell", { name: "2026-10-30" })).toBeInTheDocument();
  expect(within(table).getAllByRole("row")).toHaveLength(7);
  expect(screen.getByText("Cycle movement page 2 of 2")).toBeInTheDocument();
});
it("withholds stale-source results and explains unavailable canonical review rather than inventing balances", () => {
  const { rerender } = render(
    <PaydayView
      view={estimate()}
      incomeStreams={incomeStreams}
      selectedIncomeStreamId="job-b"
      {...actions()}
    />,
  );
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText(/loaded estimate belongs to another income source/)).toBeInTheDocument();
  rerender(
    <PaydayView
      view={{
        schedule: estimate().schedule,
        projection: {
          status: "unavailable",
          reasons: [
            { code: "actual_review_required", evidenceId: "tx-1" },
            { code: "balance_basis_unavailable", evidenceId: "cash" },
          ],
        },
      }}
      incomeStreams={incomeStreams}
      selectedIncomeStreamId="job-b"
      {...actions()}
    />,
  );
  expect(screen.getByText(/explicit balance-reflection review/)).toBeInTheDocument();
  expect(screen.getByText(/balance statement is missing/)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("shows an explicit zero protected floor and returns to the first movement page when selection clears", () => {
  const view = estimate();
  if (view.projection.status !== "estimated") throw new Error("Expected estimate fixture");
  view.projection.protectedFloor = {
    status: "confirmed",
    amountMinorUnits: 0,
    lowestEndOfDayMarginMinorUnits: 10000,
    belowFloorAtEndOfDay: false,
    sourceRevision: "floor:1",
  };
  view.projection.lowestEndOfDayBalance.basis = "opening";
  const callbacks = actions();
  render(
    <PaydayView
      view={view}
      incomeStreams={incomeStreams}
      selectedIncomeStreamId="job-a"
      {...callbacks}
    />,
  );
  expect(screen.getByText(/User-confirmed floor \$0.00/)).toHaveTextContent(
    "not an intraday affordability guarantee",
  );
  expect(screen.getByText(/Opening statement/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next cycle movements" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous cycle movements" }));
  expect(screen.getByText("Cycle movement page 1 of 2")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next cycle movements" }));
  fireEvent.change(screen.getByLabelText("Income stream defining this cycle"), {
    target: { value: "" },
  });
  expect(callbacks.onIncomeStreamChange).toHaveBeenCalledWith(null);
  expect(screen.getByText("Cycle movement page 1 of 2")).toBeVisible();
});

it("distinguishes a selected but unloaded cycle and supplies honest fallback for unfamiliar evidence reasons", () => {
  const { rerender } = render(
    <PaydayView
      view={null}
      incomeStreams={incomeStreams}
      selectedIncomeStreamId="job-a"
      {...actions()}
    />,
  );
  expect(screen.getByText(/Cycle evidence has not been loaded/)).toBeVisible();
  const view = estimate();
  view.projection = {
    status: "unavailable",
    reasons: [{ code: "invalid_scope", evidenceId: null }],
  };
  view.schedule.unavailableSources = [
    { source: { kind: "income", id: "job-a" }, reason: "unconfirmed_schedule" },
  ];
  rerender(
    <PaydayView
      view={view}
      incomeStreams={incomeStreams}
      selectedIncomeStreamId="job-a"
      {...actions()}
    />,
  );
  expect(screen.getByRole("list", { name: "Unavailable cycle evidence" })).toHaveTextContent(
    "incomplete or inconsistent",
  );
  expect(
    screen.getByText(/Some recurring sources have unavailable dates or amounts/),
  ).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
