// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ChoiceCardGroup } from "./choice-card-group";

function TestChoiceCards() {
  const [value, setValue] = useState("system");
  return (
    <ChoiceCardGroup
      aria-label="Theme"
      onValueChange={setValue}
      options={[
        { label: "System", value: "system" },
        { label: "Dark", preview: <span>Dark preview</span>, value: "dark" },
      ]}
      value={value}
    />
  );
}

describe("ChoiceCardGroup", () => {
  it("selects an option when its preview area is clicked", async () => {
    const user = userEvent.setup();
    const { container } = render(<TestChoiceCards />);

    expect(container.querySelectorAll(".choice-card__selection")).toHaveLength(2);

    await user.click(screen.getByText("Dark preview"));

    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("data-state", "checked");
    expect(container.querySelectorAll(".choice-card__selection")).toHaveLength(2);
  });
});
