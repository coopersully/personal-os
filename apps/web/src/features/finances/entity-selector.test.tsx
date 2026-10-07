// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { FinanceEntitySelector } from "./entity-selector";

it("selects an existing name and offers a new name for the transaction save", async () => {
  function Form() {
    const [value, setValue] = useState("");
    return (
      <>
        <FinanceEntitySelector
          id="merchant"
          label="Merchant"
          value={value}
          options={["Corner Cafe", "Market"]}
          onValueChange={setValue}
        />
        <output>{value}</output>
      </>
    );
  }
  render(<Form />);
  const user = userEvent.setup();
  const input = screen.getByRole("combobox", { name: "Merchant" });
  await user.type(input, "Corner");
  await user.click(await screen.findByRole("option", { name: "Corner Cafe" }));
  expect(input).toHaveValue("Corner Cafe");
  await user.clear(input);
  await user.type(input, "New shop");
  await user.click(await screen.findByRole("option", { name: "Add “New shop”" }));
  expect(screen.getByRole("status")).toHaveTextContent("New shop");
});
