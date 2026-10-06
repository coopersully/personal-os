// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { FinanceLinkedTransaction, FinanceTransactionControls } from "./transaction-controls.js";

const api = vi.hoisted(() => ({ getFinanceTransaction: vi.fn() }));
vi.mock("../../api.js", () => ({ api, errorMessage: (error: Error) => error.message }));
function CurrentLocation() {
  return <output aria-label="Location">{useLocation().search}</output>;
}
it("applies transaction filters from the header and clears only filter parameters", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/finances/transactions?transactionId=source&sortBy=amount"]}>
      <FinanceTransactionControls accounts={[]} categories={[]} />
      <CurrentLocation />
    </MemoryRouter>,
  );
  expect(screen.queryByLabelText("Search")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.type(screen.getByLabelText("Search"), "groceries");
  await user.selectOptions(screen.getByLabelText("Review"), "resolved");
  await user.selectOptions(screen.getByLabelText("Posting state"), "posted");
  expect(screen.getByLabelText("Location")).toHaveTextContent("transactionId=source");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(screen.getByLabelText("Location")).toHaveTextContent("search=groceries");
  expect(screen.getByLabelText("Location")).toHaveTextContent("reviewState=resolved");
  expect(screen.getByLabelText("Location")).not.toHaveTextContent("review=resolved");
  expect(screen.getByLabelText("Location")).not.toHaveTextContent("transactionId");
  expect(
    screen.getByRole("button", { name: "Filters (3 active)" }).querySelector("[data-slot=badge]"),
  ).toHaveTextContent("3");
  await user.click(screen.getByRole("button", { name: "Filters (3 active)" }));
  expect(screen.getByLabelText("Search")).toHaveValue("groceries");
  expect(screen.getByLabelText("Review")).toHaveValue("resolved");
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByLabelText("Location")).toHaveTextContent("?sortBy=amount");
  expect(
    screen.getByRole("button", { name: "Filters" }).querySelector("[data-slot=badge]"),
  ).toBeNull();
});
it("exposes mutually exclusive sort choices in the header", async () => {
  const onSort = vi.fn();
  render(
    <MemoryRouter>
      <FinanceTransactionControls accounts={[]} categories={[]} sort="date:desc" onSort={onSort} />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Sort transactions" }));
  expect(screen.getByRole("menuitemradio", { name: "Newest first" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Highest amount" }));
  expect(onSort).toHaveBeenCalledWith("amount:desc");
});

it("loads the exact source record and never presents a failed envelope as transaction data", async () => {
  api.getFinanceTransaction
    .mockResolvedValueOnce({
      outcome: "failed",
      communication: { headline: "Source is no longer available" },
    })
    .mockResolvedValueOnce({
      outcome: "completed",
      data: {
        id: "source",
        merchant: "Market",
        amount: 24,
        date: "2026-09-03",
        category: null,
        direction: "expense",
        pending: false,
      },
    });
  const onBreakdown = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <FinanceLinkedTransaction id="source" onBreakdown={onBreakdown} onCategorize={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Couldn’t load this material.")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Source transaction" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Market")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "View breakdown" }));
  await waitFor(() =>
    expect(onBreakdown).toHaveBeenCalledWith(expect.objectContaining({ id: "source" })),
  );
  expect(api.getFinanceTransaction).toHaveBeenLastCalledWith("source");
});

it("retains a pending source and its original merchant through a failed background refresh", async () => {
  const record = {
    id: "cached-source",
    merchant: "Market",
    rawMerchant: "MARKET 123 POS",
    amount: 24,
    date: "2026-09-03",
    category: "Groceries",
    direction: "expense",
    pending: true,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envelope = { outcome: "completed", data: record };
  client.setQueryData(["finance-transaction", "cached-source"], envelope);
  api.getFinanceTransaction
    .mockRejectedValueOnce(new Error("private upstream failure"))
    .mockResolvedValue(envelope);
  const onCategorize = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FinanceLinkedTransaction
          id="cached-source"
          onBreakdown={vi.fn()}
          onCategorize={onCategorize}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/Showing the last available update/)).toBeVisible();
  expect(screen.getByText("Pending")).toBeVisible();
  expect(screen.getByText(/MARKET 123 POS/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Categorize" }));
  expect(onCategorize).toHaveBeenCalledWith(record);
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(screen.queryByText(/Showing the last available update/)).not.toBeInTheDocument(),
  );
});
