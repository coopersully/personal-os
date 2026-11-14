// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { DaySelection } from "./day-selection";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", () => import("../../../test/native"));
vi.mock("../../theme", () => ({
  spacing: { sm: 8, md: 12, lg: 16, page: 20 },
  touchTarget: 44,
  radius: { control: 8, panel: 16 },
  useTheme: () => ({ ink: "black", secondary: "gray", information: "blue", canvas: "white" }),
}));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
afterEach(cleanup);
it("edits days in a bounded dialog and retains selected day IDs after Done and reopening", () => {
  const change = vi.fn();
  function Harness() {
    const [days, setDays] = useState<number[] | undefined>();
    return (
      <DaySelection
        label="Step days"
        value={days}
        onChange={(next) => {
          change(next);
          setDays(next);
        }}
      />
    );
  }
  render(<Harness />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Step days, Every day" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByRole("checkbox")).toHaveLength(7);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Step days, Sunday" }));
  expect(change).toHaveBeenLastCalledWith([1, 2, 3, 4, 5, 6]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Step days, Mon, Tue, Wed, Thu, Fri, Sat" }));
  expect(
    within(screen.getByRole("dialog")).getByRole("checkbox", { name: "Step days, Sunday" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Step days, Sunday" }));
  expect(change).toHaveBeenLastCalledWith(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Step days, Every day" })).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(change).toHaveBeenCalledTimes(2);
});
