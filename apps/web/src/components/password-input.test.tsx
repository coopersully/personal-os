// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordInput } from "./password-input.js";

describe("PasswordInput", () => {
  it("uses the standard shadcn input-group surface and inset icon button", () => {
    render(<PasswordInput aria-label="Password" />);

    const input = screen.getByLabelText("Password");
    const group = input.closest('[data-slot="input-group"]');
    const button = screen.getByRole("button", { name: "Show password" });

    expect(group).toHaveClass("rounded-lg", "border", "border-transparent", "bg-input/60");
    expect(input).toHaveClass("rounded-none", "border-0", "bg-transparent");
    expect(button).toHaveClass("size-6", "rounded-[min(var(--radius-md),10px)]");
  });

  it("reveals and hides the password without honoring an external type override", () => {
    render(<PasswordInput aria-label="Password" type="text" />);

    const input = screen.getByLabelText("Password");
    const showButton = screen.getByRole("button", { name: "Show password" });

    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(showButton);
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("disables both the input and its reveal control", () => {
    render(<PasswordInput aria-label="Password" disabled />);

    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show password" })).toBeDisabled();
    expect(screen.getByLabelText("Password").closest('[data-slot="input-group"]')).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });
});
