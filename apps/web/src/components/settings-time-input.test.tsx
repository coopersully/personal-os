// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { SettingsTimeInput } from "./settings-time-input";

it("accepts a non-quarter-hour time, dispatches the form change and resets to its default", async () => {
  const user = userEvent.setup();
  const ref = createRef<HTMLInputElement>();
  const change = vi.fn();
  const blur = vi.fn();
  const { container } = render(
    <form>
      <SettingsTimeInput
        ref={ref}
        type="time"
        name="time"
        aria-label="Time"
        defaultValue="09:00"
        onChange={change}
        onBlur={blur}
      />
      <button type="reset">Reset</button>
    </form>,
  );
  const input = screen.getByRole("combobox", { name: "Time" });
  await user.click(input);
  await user.clear(input);
  await user.type(input, "12:07 pm");
  await user.click(await screen.findByRole("option", { name: "12:07 PM" }));
  expect(input).toHaveValue("12:07 PM");
  expect(ref.current).toHaveValue("12:07");
  expect(new FormData(container.querySelector("form")!).get("time")).toBe("12:07");
  expect(change).toHaveBeenCalledTimes(1);
  expect(blur).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Reset" }));
  expect(input).toHaveValue("9:00 AM");
  expect(ref.current).toHaveValue("09:00");
});
it.each([
  "25:00",
  "12:67",
  "0 pm",
  "13 am",
  "not a time",
])("does not commit invalid time %s", async (value) => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(
    <SettingsTimeInput
      type="time"
      aria-label="Time"
      defaultValue="10:00"
      required
      onChange={change}
    />,
  );
  const input = screen.getByRole("combobox", { name: "Time" });
  await user.click(input);
  await user.type(input, value);
  expect(await screen.findByText("No matching times.")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(input).toHaveValue("10:00 AM");
  expect(change).not.toHaveBeenCalled();
});
it("limits choices to the configured bounds and allows clearing an optional time", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(
    <SettingsTimeInput
      type="time"
      aria-label="Time"
      defaultValue="10:00"
      min="09:30"
      max="10:30"
      onChange={change}
    />,
  );
  const input = screen.getByRole("combobox", { name: "Time" });
  await user.click(input);
  expect(screen.queryByRole("option", { name: "9:00 AM" })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "9:30 AM" })).toBeVisible();
  await user.click(screen.getByRole("option", { name: "No time" }));
  expect(input).toHaveValue("No time");
  expect(change).toHaveBeenCalledTimes(1);
});
it("keeps read-only settings unavailable and releases forwarded refs on unmount", async () => {
  const user = userEvent.setup();
  const ref = vi.fn();
  const { unmount } = render(
    <SettingsTimeInput ref={ref} type="time" aria-label="Time" value="00:00" readOnly />,
  );
  await user.click(screen.getByRole("combobox", { name: "Time" }));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Time" })).toHaveValue("12:00 AM");
  unmount();
  expect(ref).toHaveBeenLastCalledWith(null);
});
