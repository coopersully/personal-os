// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CheckboxCardGroup } from "./checkbox-card-group";

function TestCheckboxCards() {
  const [values, setValues] = useState<Array<"calendar" | "mail">>(["calendar"]);
  return (
    <CheckboxCardGroup
      aria-label="Services"
      onValuesChange={setValues}
      options={[
        {
          description: "See every commitment.",
          label: "Calendar",
          value: "calendar",
        },
        {
          description: "Bring conversations together.",
          label: "Mail",
          value: "mail",
        },
      ]}
      values={values}
    />
  );
}

describe("CheckboxCardGroup", () => {
  it("toggles a choice from anywhere on its card", async () => {
    const user = userEvent.setup();
    render(<TestCheckboxCards />);

    expect(screen.getByRole("checkbox", { name: "Calendar" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Mail" })).not.toBeChecked();

    await user.click(screen.getByText("Bring conversations together."));

    expect(screen.getByRole("checkbox", { name: "Mail" })).toBeChecked();

    await user.click(screen.getByText("See every commitment."));

    expect(screen.getByRole("checkbox", { name: "Calendar" })).not.toBeChecked();
  });
});
