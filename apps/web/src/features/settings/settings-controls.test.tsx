// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SettingsControlsContext } from "@/components/settings-controls-context";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

it("settings autocomplete preserves change handlers and submitted option values", async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  function Form() {
    const [value, setValue] = useState("first");
    return (
      <SettingsControlsContext.Provider value={true}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saved(new FormData(event.currentTarget).get("choice"));
          }}
        >
          <label htmlFor="choice">Choice</label>
          <NativeSelect
            id="choice"
            name="choice"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            <NativeSelectOption value="first">First choice</NativeSelectOption>
            <NativeSelectOption value="second">Second choice</NativeSelectOption>
            {["third", "fourth", "fifth", "sixth"].map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
            <NativeSelectOption value="blocked" disabled>
              Unavailable choice
            </NativeSelectOption>
          </NativeSelect>
          <button type="submit">Save</button>
        </form>
      </SettingsControlsContext.Provider>
    );
  }
  render(<Form />);
  const input = screen.getByLabelText("Choice");
  await user.clear(input);
  await user.type(input, "Second");
  await user.click(await screen.findByRole("option", { name: "Second choice" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(saved).toHaveBeenCalledWith("second");
  expect(input).toHaveValue("Second choice");
});

it("settings time picker sends canonical times through existing change and blur handlers", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  const blurred = vi.fn();
  function Form() {
    const [value, setValue] = useState("09:00");
    return (
      <SettingsControlsContext.Provider value={true}>
        <label htmlFor="time">Time</label>
        <Input
          id="time"
          name="time"
          type="time"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            changed(event.target.value);
          }}
          onBlur={(event) => blurred(event.target.value)}
        />
      </SettingsControlsContext.Provider>
    );
  }
  render(<Form />);
  const input = screen.getByLabelText("Time");
  await user.clear(input);
  await user.type(input, "10:07 am");
  await user.click(await screen.findByRole("option", { name: "10:07 AM" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith("10:07"));
  expect(blurred).toHaveBeenCalledWith("10:07");
});

it("workspace forms outside Settings retain their native controls", () => {
  render(
    <>
      <label htmlFor="outside">Outside</label>
      <NativeSelect id="outside" defaultValue="a">
        <NativeSelectOption value="a">A</NativeSelectOption>
      </NativeSelect>
    </>,
  );
  expect(screen.getByLabelText("Outside").tagName).toBe("SELECT");
});

it("small choices show a checked menu, preserve form values, and do not save on open", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  const { container } = render(
    <SettingsControlsContext.Provider value={true}>
      <form>
        <label htmlFor="small-choice">Week starts on</label>
        <NativeSelect id="small-choice" name="week" defaultValue="sun" onChange={changed}>
          <NativeSelectOption value="sun">Sunday</NativeSelectOption>
          <NativeSelectOption value="mon">Monday</NativeSelectOption>
          <NativeSelectOption value="blocked" disabled>
            Unavailable
          </NativeSelectOption>
        </NativeSelect>
      </form>
    </SettingsControlsContext.Provider>,
  );
  await user.click(screen.getByLabelText("Week starts on"));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole("menuitemradio", { name: "Sunday" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(screen.getByRole("menuitemradio", { name: "Unavailable" })).toHaveAttribute(
    "data-disabled",
  );
  await user.click(screen.getByRole("menuitemradio", { name: "Monday" }));
  expect(changed).toHaveBeenCalledTimes(1);
  const form = container.querySelector("form");
  if (!form) throw new Error("Missing settings form");
  expect(new FormData(form).get("week")).toBe("mon");
});
