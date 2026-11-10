// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DaySelection } from "./day-selection";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", () => import("../../../test/native"));
vi.mock("../../theme", () => ({
  useTheme: () => ({ ink: "black", secondary: "gray", information: "blue" }),
}));
afterEach(cleanup);
it("defaults to every named day and toggles days without numeric text input", () => {
  const change = vi.fn();
  const view = render(<DaySelection label="Step days" value={undefined} onChange={change} />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(7);
  fireEvent.click(screen.getByRole("checkbox", { name: "Step days, Sunday" }));
  expect(change).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6]);
  view.rerender(<DaySelection label="Step days" value={[1, 2, 3, 4, 5, 6]} onChange={change} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Step days, Sunday" }));
  expect(change).toHaveBeenLastCalledWith(undefined);
});
