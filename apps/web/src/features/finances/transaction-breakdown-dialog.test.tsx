// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceCategory, FinanceTransaction } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { TransactionBreakdownDialog } from "./transaction-breakdown-dialog.js";

const { setFinanceTransactionBreakdown } = vi.hoisted(() => ({
  setFinanceTransactionBreakdown: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: { setFinanceTransactionBreakdown } }));

const id = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-21T12:00:00.000Z";
const transaction = {
  amount: 310,
  category: "Shopping",
  categoryId,
  id,
  merchant: "CVS",
  updatedAt: now,
} as FinanceTransaction;
const categories = [
  { id: categoryId, name: "Shopping" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Medical" },
] as FinanceCategory[];

it("requires every cent and saves a mixed CVS breakdown without a future rule", async () => {
  setFinanceTransactionBreakdown.mockResolvedValue(transaction);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TransactionBreakdownDialog
        categories={categories}
        onOpenChange={vi.fn()}
        open
        transaction={transaction}
      />
    </QueryClientProvider>,
  );
  const browser = userEvent.setup();
  const amounts = await screen.findAllByLabelText("Amount");
  await browser.clear(amounts[0] as HTMLInputElement);
  await browser.type(amounts[0] as HTMLInputElement, "90");
  expect(screen.getByText("$220.00 left to assign")).toBeInTheDocument();
  await browser.type(amounts[1] as HTMLInputElement, "220");
  expect(screen.getByText("Every cent assigned")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: /Use for future purchases/ })).toBeDisabled();
  await browser.click(screen.getByRole("button", { name: "Save breakdown" }));
  await waitFor(() =>
    expect(setFinanceTransactionBreakdown).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        allocations: [
          expect.objectContaining({ amount: 90, treatment: "personal" }),
          expect.objectContaining({ amount: 220, treatment: "reimbursable" }),
        ],
        expectedTransactionUpdatedAt: now,
        futureRule: null,
      }),
    ),
  );
});
