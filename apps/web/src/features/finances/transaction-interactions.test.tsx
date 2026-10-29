// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceTransaction } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionContextEditor, TransactionContextMenu } from "./transaction-interactions";

const api = vi.hoisted(() => ({ updateFinanceTransaction: vi.fn() }));
vi.mock("@/api", () => ({ api }));
const transaction = {
  id: "meal",
  merchant: "Cafe",
  notes: "Lunch",
  category: "Dining",
  updatedAt: "2026-09-30T00:00:00.000Z",
} as FinanceTransaction;
it("offers split, edit context, and recategorize on right click", async () => {
  const onSplit = vi.fn();
  const onContext = vi.fn();
  const onCategorize = vi.fn();
  render(
    <TransactionContextMenu
      transaction={transaction}
      onSplit={onSplit}
      onContext={onContext}
      onCategorize={onCategorize}
    >
      <button type="button">Cafe</button>
    </TransactionContextMenu>,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "Cafe" }));
  expect(screen.getByRole("menuitem", { name: "Split purchase" })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "Recategorize" })).toBeVisible();
  await userEvent.click(screen.getByRole("menuitem", { name: "Edit context" }));
  expect(onContext).toHaveBeenCalledOnce();
});
it("preserves edited context after failure and saves with the observed version", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  api.updateFinanceTransaction
    .mockRejectedValueOnce(new Error("Could not save"))
    .mockResolvedValueOnce(transaction);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <TransactionContextEditor transaction={transaction} onClose={onClose} />
    </QueryClientProvider>,
  );
  await user.clear(screen.getByLabelText("Context for Cafe"));
  await user.type(screen.getByLabelText("Context for Cafe"), "Team lunch");
  await user.click(screen.getByRole("button", { name: "Save context" }));
  await waitFor(() => expect(api.updateFinanceTransaction).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Context for Cafe")).toHaveValue("Team lunch");
  expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save context" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api.updateFinanceTransaction).toHaveBeenLastCalledWith("meal", {
    notes: "Team lunch",
    expectedTransactionUpdatedAt: transaction.updatedAt,
  });
});

it.each([
  "pending_review",
  "needs_information",
])("keeps context open for a %s response", async (status) => {
  api.updateFinanceTransaction.mockResolvedValue({ status });
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <TransactionContextEditor transaction={{ ...transaction, notes: null }} onClose={onClose} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Save context" }));
  await waitFor(() =>
    expect(api.updateFinanceTransaction).toHaveBeenCalledWith(
      "meal",
      expect.objectContaining({ notes: null }),
    ),
  );
  expect(onClose).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});
