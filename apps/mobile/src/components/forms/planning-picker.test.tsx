// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
const h = vi.hoisted(() => ({
  nativeChange: undefined as undefined | ((event: unknown, date: Date) => void),
}));
vi.mock("@expo/ui/community/datetime-picker", () => ({
  default: ({
    onChange,
    disabled,
  }: {
    onChange: (event: unknown, date: Date) => void;
    disabled?: boolean;
  }) => {
    if (!disabled) h.nativeChange = onChange;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange({}, new Date("2026-11-10T01:30:00Z"))}
      >
        Pick date
      </button>
    );
  },
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
  expect(screen.queryByText("2026-11-09")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Target date, .*2026/ }));
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
  fireEvent.click(screen.getByRole("button", { name: /Time, .*8:00/ }));
  fireEvent.click(screen.getByText("Pick date"));
  expect(change).toHaveBeenCalledWith("20:30");
});

it("disables an already open native picker and rejects a late native value event until unlocked", () => {
  const change = vi.fn();
  const props = {
    label: "Time",
    value: "20:00",
    mode: "time" as const,
    timeZone: "America/New_York",
    optional: true,
    onChange: change,
  };
  const view = render(<PlanningPicker {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Time, .*8:00/ }));
  const late = h.nativeChange;
  view.rerender(<PlanningPicker {...props} disabled />);
  expect(screen.getByText("Pick date")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Clear time" })).toBeDisabled();
  act(() => late?.({}, new Date("2026-11-10T01:30:00Z")));
  expect(change).not.toHaveBeenCalled();
  view.rerender(<PlanningPicker {...props} />);
  fireEvent.click(screen.getByText("Pick date"));
  expect(change).toHaveBeenCalledWith("20:30");
});

it("closes an opened native time picker with Done without changing the retained wall time", () => {
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
  fireEvent.click(screen.getByRole("button", { name: /Time, .*8:00/ }));
  expect(screen.getByText("Pick date")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByText("Pick date")).toBeNull();
  expect(screen.getByRole("button", { name: /Time, .*8:00/ })).toBeVisible();
  expect(change).not.toHaveBeenCalled();
});
