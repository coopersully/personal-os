// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  EmailField,
  InviteCodeField,
  isValidEmailAddress,
  isValidPassword,
  PasswordFields,
} from "./auth-fields";

describe("auth fields", () => {
  it("uses a useful reserved email example and the domain validator", () => {
    render(<EmailField name="email" onChange={() => undefined} value="" />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("placeholder", "sam@example.com");
    expect(isValidEmailAddress("sam@example.com")).toBe(true);
    expect(isValidEmailAddress("not-an-email")).toBe(false);
  });

  it("renders an eight-character Shadcn OTP and normalizes invite codes", async () => {
    function InviteCodeExample() {
      const [value, setValue] = useState("");
      return <InviteCodeField onChange={setValue} value={value} />;
    }

    render(<InviteCodeExample />);
    const input = screen.getByLabelText("Invite code");
    await userEvent.setup().type(input, "abcd2345");

    expect(input).toHaveValue("ABCD2345");
    expect(screen.getAllByText(/[A-D2-5]/)).toHaveLength(8);
  });

  it("checks password requirements and toggles both password fields together", async () => {
    function PasswordExample() {
      const [password, setPassword] = useState("");
      const [confirmation, setConfirmation] = useState("");
      return (
        <PasswordFields
          confirmValue={confirmation}
          onConfirmValueChange={setConfirmation}
          onValueChange={setPassword}
          showRequirements
          value={password}
        />
      );
    }

    render(<PasswordExample />);
    const browser = userEvent.setup();
    const password = screen.getByLabelText("Password");
    const confirmation = screen.getByLabelText("Confirm password");

    expect(isValidPassword("short")).toBe(false);
    await browser.type(password, "LocalTestOnly123!");
    expect(isValidPassword("LocalTestOnly123!")).toBe(true);
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).toHaveAttribute("data-complete", "true");
    }

    const toggles = screen.getAllByRole("button", { name: "Show passwords" });
    expect(toggles).toHaveLength(2);
    const secondToggle = toggles.at(1);
    if (!secondToggle) throw new Error("Expected a second password visibility control.");
    await browser.click(secondToggle);
    expect(password).toHaveAttribute("type", "text");
    expect(confirmation).toHaveAttribute("type", "text");
    expect(screen.getAllByRole("button", { name: "Hide passwords" })).toHaveLength(2);
  });
});
