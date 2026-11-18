// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dateDisplayLabels } from "@/lib/date-format";
import { DateDisplay } from "./date-display";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T16:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it.each([
  ["2026-10-22", "Yesterday"],
  ["2026-10-23", "Today"],
  ["2026-10-24", "Tomorrow"],
])("defaults nearby dates to relative labels: %s", (value, text) => {
  render(<DateDisplay value={value} timeZone="America/New_York" />);
  expect(screen.getByRole("button", { name: new RegExp(`^${text};`) })).toBeVisible();
});
it("toggles arbitrary dates without activating their record and resets when value changes", () => {
  const open = vi.fn();
  document.addEventListener("click", open);
  const { rerender } = render(<DateDisplay value="2026-10-28" timeZone="America/New_York" />);
  fireEvent.click(screen.getByRole("button", { name: "Oct 28, 2026; show in 5 days" }));
  expect(screen.getByRole("button", { name: "in 5 days; show Oct 28, 2026" })).toBeVisible();
  expect(open).not.toHaveBeenCalled();
  document.removeEventListener("click", open);
  fireEvent.click(screen.getByRole("button", { name: "in 5 days; show Oct 28, 2026" }));
  rerender(<DateDisplay value="2026-10-13" timeZone="America/New_York" />);
  fireEvent.click(screen.getByRole("button", { name: "Oct 13, 2026; show 10 days ago" }));
  expect(screen.getByText("10 days ago")).toBeVisible();
});
it("compares local calendar days through DST and UTC boundaries", () => {
  expect(
    dateDisplayLabels("2026-03-09", "America/New_York", new Date("2026-03-08T05:30:00Z"))?.relative,
  ).toBe("Tomorrow");
  expect(dateDisplayLabels("2026-10-24T01:00:00Z", "America/New_York")?.absolute).toBe(
    "Oct 23, 2026",
  );
  expect(
    dateDisplayLabels("2026-10-23", "Pacific/Auckland", new Date("2026-10-23T16:00:00Z"))?.relative,
  ).toBe("Yesterday");
  expect(dateDisplayLabels("invalid", "UTC")).toBeNull();
  expect(dateDisplayLabels("2026-02-30", "UTC")).toBeNull();
});
it("updates the default after midnight", () => {
  render(<DateDisplay value="2026-10-25" timeZone="UTC" />);
  expect(screen.getByText("Oct 25, 2026")).toBeVisible();
  vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
  fireEvent(window, new Event("focus"));
  expect(screen.getByText("Tomorrow")).toBeVisible();
});
