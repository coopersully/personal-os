// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlanningPicker } from "./planning-picker.ios";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", () => import("../../../test/native"));
vi.mock("../../theme", () => ({
  useTheme: () => ({ ink: "black", secondary: "gray", information: "blue" }),
}));
vi.mock("@expo/ui/community/datetime-picker", () => ({
  default: ({ onChange }: { onChange: (event: unknown, date: Date) => void }) => (
    <button type="button" onClick={() => onChange({}, new Date("2026-11-10T01:30:00Z"))}>
      Pick date
    </button>
  ),
}));
afterEach(cleanup);
it("uses the account calendar day rather than UTC and clears optional date", () => {
  const change = vi.fn();
  render(
    <PlanningPicker
      label="Target date"
      value="2026-11-09"
      mode="date"
      timeZone="America/New_York"
      optional
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Target date, 2026-11-09" }));
  fireEvent.click(screen.getByText("Pick date"));
  expect(change).toHaveBeenCalledWith("2026-11-09");
  fireEvent.click(screen.getByText("Clear target date"));
  expect(change).toHaveBeenLastCalledWith("");
});
it("stores native time selection as wall time in profile timezone", () => {
  const change = vi.fn();
  render(
    <PlanningPicker
      label="Time"
      value="20:00"
      mode="time"
      timeZone="America/New_York"
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Time, 20:00" }));
  fireEvent.click(screen.getByText("Pick date"));
  expect(change).toHaveBeenCalledWith("20:30");
});
