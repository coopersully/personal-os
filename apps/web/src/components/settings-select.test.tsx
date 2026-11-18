// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { SettingsSelect } from "./settings-select";

it("preserves form values, disabled groups, and form reset for compact settings", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const ref = createRef<HTMLSelectElement>();
  const { container } = render(
    <form>
      <SettingsSelect ref={ref} name="mode" aria-label="Mode" defaultValue="auto" onChange={change}>
        <option value="auto">Automatic</option>
        <optgroup label="Unavailable" disabled>
          <option value="managed">Managed</option>
        </optgroup>
        <option value="manual">Manual</option>
      </SettingsSelect>
      <button type="reset">Reset</button>
    </form>,
  );
  const form = container.querySelector("form")!;
  expect(ref.current).toHaveValue("auto");
  await user.click(screen.getByRole("button", { name: "Mode" }));
  expect(screen.getByRole("menuitemradio", { name: "Managed" })).toHaveAttribute("data-disabled");
  await user.click(screen.getByRole("menuitemradio", { name: "Manual" }));
  expect(new FormData(form).get("mode")).toBe("manual");
  expect(change).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Reset" }));
  expect(ref.current).toHaveValue("auto");
  expect(new FormData(form).get("mode")).toBe("auto");
});

it("searches a long option list, cancels an unmatched query, and commits the chosen form value", async () => {
  const user = userEvent.setup();
  const ref = vi.fn();
  const change = vi.fn();
  const { container, unmount } = render(
    <form>
      <SettingsSelect
        ref={ref}
        name="zone"
        aria-label="Time zone"
        defaultValue="zone-7"
        onChange={change}
      >
        {Array.from({ length: 8 }, (_, index) => String(index)).map((region) => (
          <option key={region} value={`zone-${region}`}>
            Region {region}
          </option>
        ))}
      </SettingsSelect>
    </form>,
  );
  const input = screen.getByRole("combobox", { name: "Time zone" });
  await user.click(input);
  await user.type(input, "Unknown");
  expect(await screen.findByText("No matching options.")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(input).toHaveValue("Region 7");
  await user.click(input);
  await user.clear(input);
  await user.type(input, "Region 2");
  await user.click(await screen.findByRole("option", { name: "Region 2" }));
  expect(input).toHaveValue("Region 2");
  expect(new FormData(container.querySelector("form")!).get("zone")).toBe("zone-2");
  expect(change).toHaveBeenCalledTimes(1);
  unmount();
  expect(ref).toHaveBeenLastCalledWith(null);
});

it("keeps controlled selects authoritative on form reset and leaves disabled settings unavailable", async () => {
  const user = userEvent.setup();
  function Controlled() {
    const [value, setValue] = useState("b");
    return (
      <form>
        <SettingsSelect
          aria-label="Choice"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="a">A</option>
          <option value="b">B</option>
        </SettingsSelect>
        <SettingsSelect aria-label="Locked" disabled>
          <option value="a">A</option>
        </SettingsSelect>
        <button type="reset">Reset</button>
      </form>
    );
  }
  render(<Controlled />);
  expect(screen.getByRole("button", { name: "Locked" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Choice" }));
  await user.click(screen.getByRole("menuitemradio", { name: "A" }));
  await user.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByRole("button", { name: "Choice" })).toHaveTextContent("A");
  fireEvent.blur(screen.getByRole("button", { name: "Choice" }));
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
});
