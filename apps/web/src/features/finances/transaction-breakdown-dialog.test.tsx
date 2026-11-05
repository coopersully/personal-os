import { renderWithFeedback as render } from "@/test-utils/feedback";
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceCategory, FinanceTransaction } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { TransactionBreakdownDialog } from "./transaction-breakdown-dialog.js";

const { setFinanceTransactionBreakdown } = vi.hoisted(() => ({
  setFinanceTransactionBreakdown: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api: { setFinanceTransactionBreakdown },
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

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

it("reopens saved allocations in their order without replacing their categories or treatment", async () => {
  const saved = {
    ...transaction,
    categoryId: null,
    allocations: [
      {
        id: "second",
        allocationOrder: 1,
        amount: 220,
        categoryId: categories[1]?.id,
        state: "active",
        treatment: "reimbursable",
        rationale: "Roommate's items.",
      },
      {
        id: "obsolete",
        allocationOrder: 0,
        amount: 310,
        categoryId,
        state: "invalidated",
        treatment: "personal",
        rationale: "Old classification.",
      },
      {
        id: "first",
        allocationOrder: 0,
        amount: 90,
        categoryId,
        state: "active",
        treatment: "personal",
        rationale: "Receipt: personal items.",
      },
    ],
  } as FinanceTransaction;
  setFinanceTransactionBreakdown.mockResolvedValue(saved);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["finance-transaction", id], saved);
  render(
    <QueryClientProvider client={client}>
      <TransactionBreakdownDialog
        categories={categories}
        onOpenChange={vi.fn()}
        open
        transaction={saved}
      />
    </QueryClientProvider>,
  );
  expect(
    (await screen.findAllByLabelText("Amount")).map((field) => (field as HTMLInputElement).value),
  ).toEqual(["90.00", "220.00"]);
  expect(
    screen.getAllByLabelText("Category").map((field) => (field as HTMLSelectElement).value),
  ).toEqual([categoryId, categories[1]?.id]);
  expect(
    screen.getAllByLabelText("Treatment").map((field) => (field as HTMLSelectElement).value),
  ).toEqual(["personal", "reimbursable"]);
  expect(screen.getByRole("switch", { name: /Use for future purchases/ })).not.toBeChecked();
  expect(screen.getByText("Every cent assigned")).toBeVisible();
  expect(setFinanceTransactionBreakdown).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Save breakdown" }));
  await waitFor(() =>
    expect(setFinanceTransactionBreakdown).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        allocations: [
          { amount: 90, categoryId, rationale: "Receipt: personal items.", treatment: "personal" },
          {
            amount: 220,
            categoryId: categories[1]?.id,
            rationale: "Roommate's items.",
            treatment: "reimbursable",
          },
        ],
        expectedTransactionUpdatedAt: now,
        futureRule: null,
      }),
    ),
  );
  await waitFor(() =>
    expect(client.getQueryState(["finance-transaction", id])?.isInvalidated).toBe(true),
  );
});

it.each([null, "", "   "])("uses a valid default for saved rationale %j", async (rationale) => {
  setFinanceTransactionBreakdown.mockClear();
  const saved = {
    ...transaction,
    allocations: [
      {
        id: "saved",
        allocationOrder: 0,
        amount: 310,
        categoryId,
        state: "active",
        treatment: "personal",
        rationale,
      },
    ],
  } as FinanceTransaction;
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <TransactionBreakdownDialog
        categories={categories}
        onOpenChange={vi.fn()}
        open
        transaction={saved}
      />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Save breakdown" }));
  await waitFor(() =>
    expect(setFinanceTransactionBreakdown).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        allocations: [
          expect.objectContaining({ rationale: "User-entered transaction breakdown." }),
        ],
      }),
    ),
  );
});

it("loads the latest saved allocation when reopened and keeps edits during category refresh", async () => {
  setFinanceTransactionBreakdown.mockClear();
  const saved = {
    ...transaction,
    allocations: [
      {
        id: "saved",
        allocationOrder: 0,
        amount: 310,
        categoryId,
        state: "active",
        treatment: "personal",
        rationale: "Confirmed receipt.",
      },
    ],
  } as FinanceTransaction;
  const client = new QueryClient();
  const view = (open: boolean, current = saved, choices = categories) => (
    <QueryClientProvider client={client}>
      <TransactionBreakdownDialog
        categories={choices}
        onOpenChange={vi.fn()}
        open={open}
        transaction={current}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(view(true));
  const amount = await screen.findByLabelText("Amount");
  await userEvent.clear(amount);
  await userEvent.type(amount, "300");
  rerender(view(true, saved, [...categories]));
  expect(screen.getByLabelText("Amount")).toHaveValue("300");
  const updated = {
    ...saved,
    updatedAt: "2026-08-22T12:00:00.000Z",
    allocations: [
      {
        ...saved.allocations?.[0],
        amount: 310,
        categoryId: categories[1]?.id,
        treatment: "reimbursable",
      },
    ],
  } as FinanceTransaction;
  rerender(view(true, updated));
  expect(screen.getByLabelText("Amount")).toHaveValue("300");
  await userEvent.clear(screen.getByLabelText("Amount"));
  await userEvent.type(screen.getByLabelText("Amount"), "310");
  await userEvent.click(screen.getByRole("button", { name: "Save breakdown" }));
  await waitFor(() =>
    expect(setFinanceTransactionBreakdown).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ expectedTransactionUpdatedAt: now }),
    ),
  );
  rerender(view(false));
  rerender(view(true, updated));
  expect(await screen.findByLabelText("Amount")).toHaveValue("310.00");
  expect(screen.getByLabelText("Category")).toHaveValue(categories[1]?.id);
  expect(screen.getByLabelText("Treatment")).toHaveValue("reimbursable");
});

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

it("handles an absent transaction and category without inventing a valid split", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <TransactionBreakdownDialog categories={[]} onOpenChange={vi.fn()} open transaction={null} />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Split transaction")).toBeInTheDocument();
  rerender(
    <QueryClientProvider client={client}>
      <TransactionBreakdownDialog
        categories={[]}
        onOpenChange={vi.fn()}
        open
        transaction={{ ...transaction, categoryId: null }}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("button", { name: "Save breakdown" })).toBeDisabled();
});

it("saves a single-category future rule and keeps a failed save recoverable", async () => {
  let rejectSave: ((error: Error) => void) | undefined;
  setFinanceTransactionBreakdown.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
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
  await browser.click(await screen.findByRole("button", { name: "Remove allocation 2" }));
  const future = screen.getByRole("switch", { name: /Use for future purchases/ });
  expect(future).toBeEnabled();
  await browser.click(future);
  await browser.click(screen.getByRole("button", { name: "Save breakdown" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(setFinanceTransactionBreakdown).toHaveBeenCalledWith(
    id,
    expect.objectContaining({
      futureRule: expect.objectContaining({ categoryId }),
    }),
  );
  rejectSave?.(new Error("Breakdown save failed"));
  const failure = await screen.findByText(
    /Couldn’t confirm whether we could save this transaction breakdown/,
  );
  expect(failure).toBeVisible();
  expect(failure.closest("[data-sonner-toast]")).not.toBeNull();
  expect(
    within(screen.getByRole("dialog")).queryByText(
      /Couldn’t confirm whether we could save this transaction breakdown/,
    ),
  ).not.toBeInTheDocument();
});

it("does not round sub-cent amounts into a saveable split", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TransactionBreakdownDialog
        categories={categories}
        onOpenChange={vi.fn()}
        open
        transaction={transaction}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const amounts = await screen.findAllByLabelText("Amount");
  await user.clear(amounts[0] as HTMLInputElement);
  await user.type(amounts[0] as HTMLInputElement, "310.001");
  expect(screen.getByRole("button", { name: "Save breakdown" })).toBeDisabled();
});
