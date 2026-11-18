// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { EnumChoice } from "./enum-choice";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", () => import("../../../test/native"));
vi.mock("../icons", () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));
vi.mock("../../theme", () => ({
  spacing: { md: 12, lg: 16, xl: 24 },
  radius: { panel: 16 },
  useTheme: () => ({ ink: "black", secondary: "gray", canvas: "white", surface: "white" }),
}));
afterEach(cleanup);
const options = [
  { label: "Compact", value: "compact" },
  { label: "Comfortable", value: "comfortable" },
];
it("opens a separate choice surface, updates its current value, and closes after selection", () => {
  const changed = vi.fn();
  function Preference() {
    const [value, setValue] = useState("compact");
    return (
      <EnumChoice
        label="List density"
        icon="views"
        value={value}
        options={options}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Preference />);
  expect(screen.queryByRole("radio")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "List density, Compact" }));
  expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "Comfortable" }));
  expect(changed).toHaveBeenCalledExactlyOnceWith("comfortable");
  expect(screen.getByRole("button", { name: "List density, Comfortable" })).toBeVisible();
  expect(screen.queryByRole("radio")).toBeNull();
});
it("cancel and reselecting the current option never mutate the setting; disabled cannot open", () => {
  const changed = vi.fn();
  const { rerender } = render(
    <EnumChoice label="List density" value="compact" options={options} onChange={changed} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "List density, Compact" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel list density" }));
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "List density, Compact" }));
  fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
  expect(changed).not.toHaveBeenCalled();
  rerender(
    <EnumChoice
      label="List density"
      value="compact"
      options={options}
      onChange={changed}
      disabled
    />,
  );
  expect(screen.getByRole("button", { name: "List density, Compact" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "List density, Compact" }));
  expect(screen.queryByRole("radio")).toBeNull();
});
