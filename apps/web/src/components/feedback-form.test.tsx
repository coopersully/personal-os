// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { SettingsFeedbackContext } from "../lib/settings-feedback.js";
import { FeedbackForm } from "./feedback-form.js";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
describe("FeedbackForm", () => {
  it("announces settings validation failures through Sonner while retaining correction hints", async () => {
    render(
      <SettingsFeedbackContext.Provider value={true}>
        <FeedbackForm feedback={null}>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <button type="submit">Connect</button>
        </FeedbackForm>
      </SettingsFeedbackContext.Provider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(toast.error).toHaveBeenCalledWith(
      "Check the highlighted settings fields.",
      expect.anything(),
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });
  it("validates only on submit, focuses a field, preserves helpers and clears corrections", async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <FeedbackForm feedback={null} onSubmit={submit}>
        <label>
          Email
          <input name="email" type="email" required aria-describedby="help" />
        </label>
        <span id="help">Your email</span>
        <button type="submit">Save</button>
      </FeedbackForm>,
    );
    const input = screen.getByRole("textbox");
    expect(input).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleName("Email");
    expect(input).toHaveAccessibleDescription("Your email Enter a value for this field.");
    await user.type(input, "hello@example.com");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAttribute("aria-describedby", "help");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenCalledOnce();
  });
  it("focuses a linked summary for multiple errors without moving focus during correction", async () => {
    const user = userEvent.setup();
    render(
      <FeedbackForm feedback={null}>
        <label>
          First
          <input name="first" required />
        </label>
        <label>
          Second
          <input name="second" required />
        </label>
        <button type="submit">Save</button>
      </FeedbackForm>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Check these fields before continuing.").parentElement).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /First:/ }));
    const first = screen.getByRole("textbox", { name: /^First/ });
    expect(first).toHaveFocus();
    await user.type(first, "ok");
    expect(first).toHaveFocus();
  });
  it("maps server fields, keeps values, and clears obsolete errors on retry", () => {
    const feedback = {
      kind: "validation" as const,
      persistent: true,
      message: "Check values",
      fields: { "profile.email": "Enter a valid email." },
    };
    const form = (value: typeof feedback | null) => (
      <FeedbackForm feedback={value} fieldNames={{ "profile.email": "email" }}>
        <label>
          Email
          <input name="email" defaultValue="draft" />
        </label>
      </FeedbackForm>
    );
    const { rerender } = render(form(feedback));
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription("Enter a valid email.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(form(null));
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("textbox")).toHaveValue("draft");
  });
  it("keeps unmapped errors in the form and supports custom constraints", () => {
    render(
      <FeedbackForm
        feedback={{
          kind: "validation",
          persistent: true,
          message: "Check the date range.",
          fields: {},
        }}
      >
        <input aria-label="End" name="end" />
        <button type="submit">Save</button>
      </FeedbackForm>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Check the date range.");
    const input = screen.getByRole("textbox") as HTMLInputElement;
    input.setCustomValidity("End must be after start.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(input).toHaveAccessibleDescription("End must be after start.");
  });
  it("checks related values on blur and submission, then clears their error on correction", async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <FeedbackForm
        feedback={null}
        onSubmit={submit}
        validate={(form) => {
          const values = new FormData(form);
          return Number(values.get("end")) <= Number(values.get("start"))
            ? { end: "End must follow start." }
            : {};
        }}
      >
        <input aria-label="Start" name="start" defaultValue="3" />
        <input aria-label="End" name="end" defaultValue="2" />
        <button type="button">Preview</button>
        <button type="submit">Save</button>
      </FeedbackForm>,
    );
    const end = screen.getByRole("textbox", { name: "End" });
    await user.click(end);
    await user.tab();
    expect(end).toHaveAccessibleDescription("End must follow start.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).not.toHaveBeenCalled();
    await user.clear(end);
    await user.type(end, "4");
    expect(end).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenCalledOnce();
  });
  it.each([
    ["0", "Enter a value of at least 1."],
    ["9", "Enter a value no greater than 5."],
  ])("explains native numeric constraint for %s", (value, message) => {
    render(
      <FeedbackForm feedback={null}>
        <input aria-label="Count" name="count" type="number" min="1" max="5" defaultValue={value} />
        <button type="submit">Save</button>
      </FeedbackForm>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("spinbutton")).toHaveAccessibleDescription(message);
  });
  it("keeps unmapped server errors visible alongside mapped corrections", async () => {
    const user = userEvent.setup();
    render(
      <FeedbackForm
        feedback={{
          kind: "validation",
          persistent: true,
          message: "Check values.",
          fields: { email: "Correct your email.", range: "End must follow start." },
        }}
      >
        <input aria-label="Email" name="email" defaultValue="draft" />
      </FeedbackForm>,
    );
    expect(screen.getByText("End must follow start.")).toBeInTheDocument();
    expect(screen.getByText("Check these fields before continuing.").parentElement).toHaveFocus();
    await user.type(screen.getByRole("textbox"), "x");
    expect(screen.getByRole("status")).toHaveTextContent("End must follow start.");
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
  });
  it("does not clear another server field's rejection while correcting one", async () => {
    const user = userEvent.setup();
    render(
      <FeedbackForm
        validate={() => ({})}
        feedback={{
          kind: "validation",
          persistent: true,
          message: "Check values.",
          fields: { first: "Correct first.", second: "Correct second." },
        }}
      >
        <input aria-label="First" name="first" defaultValue="one" />
        <input aria-label="Second" name="second" defaultValue="two" />
      </FeedbackForm>,
    );
    await user.type(screen.getByRole("textbox", { name: "First" }), "x");
    expect(screen.getByRole("textbox", { name: "First" })).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("textbox", { name: "Second" })).toHaveAccessibleDescription(
      "Correct second.",
    );
  });
  it("ignores disabled and readonly inputs for native and custom submit validation", () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <FeedbackForm
        onSubmit={submit}
        validate={() => ({ locked: "Invalid", disabled: "Invalid" })}
        feedback={null}
      >
        <input aria-label="Locked" name="locked" readOnly required />
        <input aria-label="Disabled" name="disabled" disabled required />
        <button type="submit">Save</button>
      </FeedbackForm>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Locked" })).not.toHaveAttribute("aria-invalid");
  });
  it("maps nested recipient paths only through an explicit prefix and coalesces one field", () => {
    render(
      <FeedbackForm
        fieldNames={{ to: "to" }}
        feedback={{
          kind: "validation",
          persistent: true,
          message: "Check recipients.",
          fields: {
            "to.0.address": "Enter a valid recipient.",
            "to.1.address": "Check the second recipient.",
          },
        }}
      >
        <label>
          To
          <input name="to" defaultValue="draft" />
        </label>
      </FeedbackForm>,
    );
    const input = screen.getByRole("textbox", { name: /^To/ });
    expect(input).toHaveAccessibleDescription(
      "Enter a valid recipient. Check the second recipient.",
    );
    expect(input).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("clears a shown custom error when a controlled selection becomes valid", () => {
    const form = (valid: boolean) => (
      <FeedbackForm
        feedback={null}
        validate={() => (valid ? {} : { city: "Choose a city from the results." })}
      >
        <input aria-label="City" name="city" defaultValue="London" />
        <button type="submit">Save</button>
      </FeedbackForm>
    );
    const { rerender } = render(form(false));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    rerender(form(true));
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
  });
  it("supports textarea and select corrections while preserving parent handlers and refs", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLFormElement>();
    const input = vi.fn();
    const blur = vi.fn();
    const { unmount } = render(
      <FeedbackForm ref={ref} feedback={null} onInput={input} onBlur={blur}>
        <textarea aria-label="Notes" name="notes" required />
        <select aria-label="Calendar" name="calendar" required defaultValue="">
          <option value="">Choose</option>
          <option value="home">Home</option>
        </select>
        <button type="submit">Save</button>
      </FeedbackForm>,
    );
    expect(ref.current).toBeInstanceOf(HTMLFormElement);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.type(screen.getByRole("textbox"), "Note");
    await user.selectOptions(screen.getByRole("combobox"), "home");
    await user.tab();
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveBeenCalled();
    expect(blur).toHaveBeenCalled();
    unmount();
    expect(ref.current).toBeNull();
  });
  it("supports callback refs and restores a parent's existing invalid attribute", () => {
    const ref = vi.fn();
    const form = (feedback: Parameters<typeof FeedbackForm>[0]["feedback"]) => (
      <FeedbackForm feedback={feedback} ref={ref}>
        <input aria-label="Email" name="email" aria-invalid="false" />
      </FeedbackForm>
    );
    const { rerender } = render(
      form({
        kind: "validation",
        persistent: true,
        message: "Check email.",
        fields: { email: "Enter valid email." },
      }),
    );
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLFormElement));
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    rerender(form(null));
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "false");
  });
  it("defers blur validation while focusing this form's submit control so its click target stays still", () => {
    const submit = vi.fn((event) => event.preventDefault());
    const blur = vi.fn();
    render(
      <FeedbackForm
        feedback={null}
        onSubmit={submit}
        onBlur={blur}
        validate={() => ({ end: "End must follow start." })}
      >
        <input aria-label="End" name="end" type="time" defaultValue="08:00" />
        <button type="submit">Save</button>
      </FeedbackForm>,
    );
    const input = screen.getByLabelText("End");
    const button = screen.getByRole("button", { name: "Save" });
    input.focus();
    fireEvent.blur(input, { relatedTarget: button });
    expect(blur).toHaveBeenCalledOnce();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("End must follow start.")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
  });
  it("retains a native error when controlled validation rules change, then updates a shown related rule", () => {
    const form = (minimum: number) => (
      <FeedbackForm feedback={null} validate={() => ({ limit: `Choose at least ${minimum}.` })}>
        <input title="Email" name="email" type="email" defaultValue="invalid" />
        <input title="Limit" name="limit" defaultValue="0" />
        <button type="submit">Save</button>
      </FeedbackForm>
    );
    const { rerender } = render(form(1));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByTitle("Email")).toHaveAccessibleDescription(
      "Enter an email address in the format name@example.com.",
    );
    rerender(form(2));
    expect(screen.getByTitle("Email")).toHaveAccessibleDescription(
      "Enter an email address in the format name@example.com.",
    );
    expect(screen.getByTitle("Limit")).toHaveAccessibleDescription("Choose at least 2.");
    fireEvent.click(screen.getByRole("button", { name: "limit: Choose at least 2." }));
    expect(screen.getByTitle("Limit")).toHaveFocus();
  });
  it("keeps a server rejection on blur until that field is actually edited", async () => {
    const user = userEvent.setup();
    render(
      <FeedbackForm
        feedback={{
          kind: "validation",
          persistent: true,
          message: "Check values.",
          fields: {
            email: "This email is already in use.",
            account: "Choose a different account.",
          },
        }}
      >
        <input title="Email" name="email" defaultValue="draft@example.com" />
        <button type="button">Preview</button>
      </FeedbackForm>,
    );
    await user.click(screen.getByRole("button", { name: "email: This email is already in use." }));
    const email = screen.getByTitle("Email");
    expect(email).toHaveFocus();
    await user.tab();
    expect(email).toHaveAccessibleDescription("This email is already in use.");
    expect(screen.getByText("Choose a different account.")).toBeInTheDocument();
    await user.type(email, "x");
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("status")).toHaveTextContent("Choose a different account.");
  });
  it("lets nested rich-text controls emit input events without discarding native errors", () => {
    const onInput = vi.fn();
    render(
      <FeedbackForm feedback={null} onInput={onInput}>
        <input name="title" title="Title" required />
        <div contentEditable data-testid="rich-notes" />
        <button type="submit">Save</button>
      </FeedbackForm>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.input(screen.getByTestId("rich-notes"));
    expect(onInput).toHaveBeenCalledOnce();
    expect(screen.getByTitle("Title")).toHaveAttribute("aria-invalid", "true");
  });
});
