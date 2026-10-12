// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FinancePlanEditor } from "./plan-editor.js";

function mount(pending = false) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <FinancePlanEditor
      plan={null}
      categories={[]}
      accounts={[]}
      goals={[]}
      onClose={onClose}
      onSave={onSave}
      pending={pending}
      error={null}
      onReload={vi.fn()}
    />,
  );
  return { onSave, onClose };
}
it("creates a named balanced proposal from blank amounts and retains the last rows", () => {
  const { onSave } = mount();
  expect(screen.getByRole("dialog", { name: "Create a complete plan" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove resource 1" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Remove allocation 1" })).toBeDisabled();
  fireEvent.blur(screen.getByLabelText("Resource 1 amount"));
  fireEvent.blur(screen.getByLabelText("Allocation 1 amount"));
  expect(screen.getByLabelText("Resource 1 amount")).toHaveAttribute("aria-invalid", "false");
  expect(screen.getByLabelText("Allocation 1 amount")).toHaveAttribute("aria-invalid", "false");
  fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "October household" } });
  fireEvent.change(screen.getByLabelText("Effective month"), { target: { value: "2026-10" } });
  fireEvent.change(screen.getByLabelText("Resource 1 amount"), { target: { value: "50" } });
  expect(screen.getByRole("button", { name: "Save proposal" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Allocation 1 amount"), { target: { value: "40" } });
  expect(screen.getByText("$10.00 left to assign")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Allocation 1 amount"), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText("Rationale"), { target: { value: "Cover groceries." } });
  fireEvent.click(screen.getByRole("button", { name: "Save proposal" }));
  expect(onSave).toHaveBeenCalledWith({
    name: "October household",
    effectiveFrom: "2026-10",
    rationale: "Cover groceries.",
    resources: [{ key: "Income", kind: "income", amount: 50 }],
    allocations: [{ key: "Spending", kind: "spending", amount: 50 }],
    assumptions: [],
    idempotencyKey: expect.any(String),
  });
});
it("shows schema validation for whitespace-only rationale without saving", () => {
  const { onSave } = mount();
  fireEvent.change(screen.getByLabelText("Resource 1 amount"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Allocation 1 amount"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Rationale"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Save proposal" }));
  expect(screen.getByText("Check the proposal")).toBeVisible();
  expect(screen.getByText(/rationale:/)).toBeVisible();
  expect(onSave).not.toHaveBeenCalled();
});
it("marks invalid resource precision only after blur and clears the error when corrected", () => {
  const { onSave } = mount();
  const amount = screen.getByLabelText("Resource 1 amount");
  fireEvent.change(amount, { target: { value: "10.001" } });
  expect(amount).toHaveAttribute("aria-invalid", "false");
  fireEvent.blur(amount);
  expect(amount).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("Enter amounts with up to two decimal places")).toBeVisible();
  fireEvent.change(amount, { target: { value: "10.00" } });
  expect(amount).toHaveAttribute("aria-invalid", "false");
  expect(onSave).not.toHaveBeenCalled();
});
it("keeps a pending proposal open and prevents cancellation or a duplicate save", async () => {
  const { onClose, onSave } = mount(true);
  expect(screen.getByRole("button", { name: "Saving proposal…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeVisible();
});
it("lets an unsaved new proposal be cancelled", () => {
  const { onClose, onSave } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});
