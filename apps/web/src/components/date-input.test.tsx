// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DateInput } from "./date-input";

function Example() {
  const [value, setValue] = useState("2026-10-01");
  return (
    <>
      <label htmlFor="date">Target date</label>
      <DateInput
        id="date"
        name="date"
        value={value}
        onValueChange={setValue}
        min="2026-10-01"
        max="2027-12-31"
      />
    </>
  );
}

describe("DateInput", () => {
  it("supports typing, calendar selection, bounds, and a date-only value", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const input = screen.getByLabelText("Target date");
    fireEvent.change(input, { target: { value: "2026-10-02" } });
    expect(input).toHaveValue("2026-10-02");
    await user.click(screen.getByRole("button", { name: "Choose date" }));
    const day = screen.getByRole("button", { name: /Saturday, October 3rd, 2026/ });
    await user.click(day);
    expect(input).toHaveValue("2026-10-03");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("min", "2026-10-01");
    expect(input).toHaveAttribute("max", "2027-12-31");
  });
});
