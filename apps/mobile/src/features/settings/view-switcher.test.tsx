// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsViewSwitcher } from "./view-switcher";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", () => import("../../../test/native"));
vi.mock("../../theme", () => ({
  useTheme: () => ({ ink: "#202024", surface: "#eee", canvas: "#fff" }),
}));
afterEach(cleanup);
it("keeps peer views directly available and changes only the requested view", () => {
  const change = vi.fn();
  render(
    <SettingsViewSwitcher
      value="goals"
      options={[
        { value: "goals", label: "Goals" },
        { value: "completed", label: "Completed" },
        { value: "motives", label: "Motives" },
      ]}
      onChange={change}
    />,
  );
  expect(screen.getAllByRole("button")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Motives" }));
  expect(change).toHaveBeenCalledExactlyOnceWith("motives");
  expect(screen.getByRole("button", { name: "Goals" })).toBeVisible();
});
