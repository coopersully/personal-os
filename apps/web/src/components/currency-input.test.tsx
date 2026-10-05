// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CurrencyInput } from "./currency-input";

// jsdom does not dispatch the browser's formdata event on construction.
function serializedAmount() {
  const form = screen.getByRole("form") as HTMLFormElement;
  const formData = new FormData(form);
  const event = new Event("formdata");
  Object.defineProperty(event, "formData", { value: formData });
  form.dispatchEvent(event);
  return formData.get("amount");
}

function Form({ initial = "1234.5" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <form aria-label="Money">
      <label htmlFor="money">Amount</label>
      <CurrencyInput
        id="money"
        name="amount"
        value={value}
        onValueChange={setValue}
        max={1000000}
      />
      <button type="button">Next</button>
    </form>
  );
}

describe("CurrencyInput", () => {
  it("formats on blur, edits plain decimal text, and submits the canonical value", async () => {
    const user = userEvent.setup();
    render(<Form />);
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveValue("1,234.50");
    await user.click(input);
    expect(input).toHaveValue("1234.5");
    await user.clear(input);
    await user.paste("12,345.67");
    await user.tab();
    expect(input).toHaveValue("12,345.67");
    expect(serializedAmount()).toBe("12345.67");
    await user.click(input);
    await user.clear(input);
    await user.tab();
    expect(input).toHaveValue("");
    expect(serializedAmount()).toBe("");
  });
  it("preserves invalid drafts and prevents submission rather than rounding or dropping text", () => {
    render(<Form initial="" />);
    const input = screen.getByLabelText("Amount");
    for (const value of ["1.234", "wrong", "-1", "1000001"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
      expect(input).toBeInvalid();
      expect(serializedAmount()).toBe(value);
    }
    fireEvent.change(input, { target: { value: "0" } });
    expect(input).toBeValid();
    expect(input).toHaveValue("0.00");
  });
});
