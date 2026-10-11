// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceAccount } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountScopeDialog } from "./account-scope-dialog";

afterEach(cleanup);
it("distinguishes none from all eligible, shows names without implying snapshot amounts", () => {
  const reset = vi.fn();
  const change = vi.fn();
  const props = {
    accounts: [
      { id: "cash", name: "Everyday checking", kind: "cash", balance: 42 },
      { id: "investment", name: "Retirement", kind: "investment", balance: 100 },
    ] as FinanceAccount[],
    disabled: false,
    feedback: null,
    onReset: reset,
    onChange: change,
    onOpenChange: vi.fn(),
    scope: "cash" as const,
    selectedIds: [],
    viewOnly: true,
  };
  const view = render(<AccountScopeDialog {...props} />);
  expect(screen.getByLabelText("Everyday checking")).not.toBeChecked();
  expect(screen.queryByLabelText("Retirement")).not.toBeInTheDocument();
  expect(screen.queryByText(/\$42/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use all eligible accounts" }));
  expect(reset).toHaveBeenCalledWith("cash");
  fireEvent.click(screen.getByLabelText("Everyday checking"));
  expect(change).toHaveBeenCalledWith("cash", "cash", true);
  view.rerender(<AccountScopeDialog {...props} disabled selectedIds={["cash"]} />);
  expect(screen.getByLabelText("Everyday checking")).toBeChecked();
  expect(screen.getByLabelText("Everyday checking")).toBeDisabled();
});
it("preserves the legacy dialog label and amount presentation", () => {
  render(
    <AccountScopeDialog
      accounts={
        [{ id: "cash", name: "Everyday checking", kind: "cash", balance: 42 }] as FinanceAccount[]
      }
      disabled={false}
      feedback={null}
      onReset={vi.fn()}
      onChange={vi.fn()}
      onOpenChange={vi.fn()}
      scope="cash"
      selectedIds={["cash"]}
      transactions={[]}
    />,
  );
  expect(screen.getByRole("dialog", { name: "Accounts included in cash" })).toBeVisible();
  expect(screen.getByLabelText(/Everyday checking ·/)).toBeChecked();
});
