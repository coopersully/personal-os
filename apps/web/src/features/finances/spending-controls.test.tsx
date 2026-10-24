// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpendingPeriodControls } from "./spending-controls";

afterEach(cleanup);
it("shows the calendar and presets directly and applies a complete range in either direction", () => {
  const onDates = vi.fn();
  render(
    <SpendingPeriodControls
      period="custom"
      from="2020-01-01"
      through="2020-01-03"
      onPeriod={vi.fn()}
      onDates={onDates}
      onMove={vi.fn()}
    />,
  );
  expect(screen.getByRole("grid")).toBeVisible();
  expect(screen.getByRole("radio", { name: "This month" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Period:/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("12", { exact: true }));
  expect(onDates).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("10", { exact: true }));
  expect(onDates).toHaveBeenLastCalledWith("2020-01-10", "2020-01-12");
  fireEvent.click(screen.getByText("15", { exact: true }));
  fireEvent.click(screen.getByText("15", { exact: true }));
  expect(onDates).toHaveBeenLastCalledWith("2020-01-15", "2020-01-15");
});
