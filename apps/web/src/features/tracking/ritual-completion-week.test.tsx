// @vitest-environment jsdom
import type { RitualCompletionDay } from "@personal-os/domain";
import { cleanup, render, screen, within } from "@testing-library/react";
import { RitualCompletionWeek } from "./ritual-completion-week.js";

const days: RitualCompletionDay[] = [
  { date: "2026-10-01", status: "completed" },
  { date: "2026-10-02", status: "skipped" },
  { date: "2026-10-03", status: "missed" },
  { date: "2026-10-04", status: "not_scheduled" },
  { date: "2026-10-05", status: "not_recorded" },
  { date: "2026-10-06", status: "completed" },
  { date: "2026-10-07", status: "pending" },
];
afterEach(cleanup);
it("shows seven dated days and retains completed days after a break", () => {
  render(<RitualCompletionWeek days={days} queued={false} />);
  const region = screen.getByRole("region", { name: "Past 7 ritual days" });
  expect(within(region).getAllByRole("listitem")).toHaveLength(7);
  expect(screen.queryByText(/completed · Past 7 days/)).not.toBeInTheDocument();
  expect(region.querySelectorAll(".ritual-day-dot-complete")).toHaveLength(2);
  for (const status of [
    "Completed",
    "Skipped",
    "Missed",
    "Not scheduled",
    "No completion recorded",
    "Pending",
  ]) {
    expect(
      within(region).getAllByRole("listitem", { name: new RegExp(`: ${status}$`) }).length,
    ).toBeGreaterThan(0);
  }
  expect(region.querySelector('time[datetime="2026-10-07"]')).toHaveTextContent(
    "Wednesday, October 7, 2026: Pending",
  );
  expect(screen.queryByText(/Waiting to sync/)).not.toBeInTheDocument();
});
it("marks queued local progress as awaiting synchronization", () => {
  render(<RitualCompletionWeek days={days} queued />);
  expect(screen.getByText("Waiting to sync")).toHaveClass("sr-only");
});
