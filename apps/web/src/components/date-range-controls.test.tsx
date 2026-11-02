// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DateRangeControls } from "./date-range-controls";

afterEach(cleanup);
const props = {
  from: "2026-10-01",
  through: "2026-10-31",
  onPeriod: vi.fn(),
  onDates: vi.fn(),
};

it("keeps presets concise and reveals direct dates only for custom ranges", () => {
  const { rerender } = render(<DateRangeControls {...props} period="month" />);
  expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "This month" })).toHaveTextContent("Month");
  expect(screen.queryByRole("button", { name: "Previous period" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Go to the Previous Month" })).toBeEnabled();
  rerender(<DateRangeControls {...props} period="custom" />);
  expect(screen.getByLabelText("From")).toHaveValue("2026-10-01");
  expect(screen.getByLabelText("Through")).toHaveValue("2026-10-31");
});

it("accepts a reversed calendar selection as an ordered custom range", () => {
  render(<DateRangeControls {...props} period="custom" />);
  fireEvent.click(screen.getByRole("button", { name: /^Thursday, October 15th, 2026/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Monday, October 5th, 2026/ }));
  expect(props.onDates).toHaveBeenCalledWith("2026-10-05", "2026-10-15");
});
