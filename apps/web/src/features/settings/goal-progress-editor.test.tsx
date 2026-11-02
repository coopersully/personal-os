// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { GoalProgressEditor } from "./goal-progress-editor";

it.each([
  "",
  "-1",
  "101",
  "1.5",
])("retains invalid progress %s without saving and supports cancellation", async (value) => {
  const user = userEvent.setup();
  const save = vi.fn();
  render(<GoalProgressEditor value={20} pending={false} onSave={save} />);
  const input = screen.getByRole("spinbutton", { name: "Progress" });
  await user.click(input);
  fireEvent.change(input, { target: { value } });
  await user.keyboard("{Enter}");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription("Enter a whole number from 0 to 100.");
  expect(save).not.toHaveBeenCalled();
  await user.click(input);
  await user.keyboard("{Escape}");
  expect(input).toHaveValue(20);
  expect(input).not.toHaveAttribute("aria-invalid", "true");
});
it("ignores unchanged blur and serializes repeated blur while a valid boundary value saves", async () => {
  const user = userEvent.setup();
  let resolve!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  function Harness() {
    const [value, setValue] = useState(20);
    return (
      <GoalProgressEditor
        value={value}
        pending={false}
        onSave={async (next) => {
          await save();
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole("spinbutton", { name: "Progress" });
  await user.click(input);
  await user.tab();
  expect(save).not.toHaveBeenCalled();
  await user.click(input);
  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.blur(input);
  fireEvent.blur(input);
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  await waitFor(() => expect(input).toHaveValue(0));
});
