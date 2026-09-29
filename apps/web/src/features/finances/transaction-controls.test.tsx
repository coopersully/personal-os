// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { FinanceLinkedTransaction, FinanceTransactionControls } from "./transaction-controls.js";

const api = vi.hoisted(() => ({ getFinanceTransaction: vi.fn() }));
vi.mock("../../api.js", () => ({ api, errorMessage: (error: Error) => error.message }));
function CurrentLocation() {
  return <output aria-label="Location">{useLocation().search}</output>;
}
it("applies shareable filters without fetching on each keystroke and clears the selected source", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/finances/transactions?transactionId=source"]}>
      <FinanceTransactionControls accounts={[]} categories={[]} onAdd={vi.fn()} />
      <CurrentLocation />
    </MemoryRouter>,
  );
  await user.type(screen.getByLabelText("Search"), "groceries");
  expect(screen.getByLabelText("Location")).toHaveTextContent("transactionId=source");
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.selectOptions(screen.getByLabelText("Review"), "resolved");
  await user.selectOptions(screen.getByLabelText("Posting state"), "posted");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(screen.getByLabelText("Location")).toHaveTextContent(
    "search=groceries&pending=posted&review=resolved",
  );
  expect(screen.getByLabelText("Location")).not.toHaveTextContent("transactionId");
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.getByLabelText("Location")).toBeEmptyDOMElement();
  expect(screen.getByLabelText("Search")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "false");
});
it("keeps search and actions visible while preserving committed advanced filters in a closed disclosure", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter
      initialEntries={[
        "/finances/transactions?from=2026-09-01&to=2026-09-03&pending=posted&review=resolved&sortBy=amount",
      ]}
    >
      <FinanceTransactionControls accounts={[]} categories={[]} onAdd={vi.fn()} />
      <CurrentLocation />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "Filters (4 active)" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(screen.getByLabelText("Search")).toBeVisible();
  expect(screen.getByRole("button", { name: "Apply filters" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Clear" })).toBeVisible();
  expect(screen.getByLabelText("From")).not.toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Review" })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Search"), "groceries");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  const location = new URLSearchParams(screen.getByLabelText("Location").textContent ?? "");
  expect(Object.fromEntries(location)).toEqual({
    from: "2026-09-01",
    to: "2026-09-03",
    pending: "posted",
    review: "resolved",
    sortBy: "amount",
    search: "groceries",
  });
  await user.click(screen.getByRole("button", { name: "Filters (4 active)" }));
  expect(screen.getByLabelText("From")).toHaveValue("2026-09-01");
  expect(screen.getByLabelText("Through")).toHaveValue("2026-09-03");
  expect(screen.getByLabelText("Review")).toHaveValue("resolved");
  expect(screen.getByLabelText("Posting state")).toHaveValue("posted");
});

it("retains advanced edits across close and reopen and applies them while closed", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/finances/transactions?review=all"]}>
      <FinanceTransactionControls accounts={[]} categories={[]} onAdd={vi.fn()} />
      <CurrentLocation />
    </MemoryRouter>,
  );
  const filters = screen.getByRole("button", { name: "Filters" });
  await user.click(filters);
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-08-01" } });
  await user.selectOptions(screen.getByLabelText("Review"), "needs_review");
  await user.click(filters);
  expect(screen.getByLabelText("From")).not.toBeVisible();
  await user.click(filters);
  expect(screen.getByLabelText("From")).toHaveValue("2026-08-01");
  expect(screen.getByLabelText("Review")).toHaveValue("needs_review");
  await user.click(filters);
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(screen.getByLabelText("Location")).toHaveTextContent(
    "review=needs_review&from=2026-08-01",
  );
  expect(screen.getByRole("button", { name: "Filters (2 active)" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
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
  expect(await screen.findByRole("alert")).toHaveTextContent("Source is no longer available");
  expect(screen.queryByRole("region", { name: "Source transaction" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Market")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "View breakdown" }));
  await waitFor(() =>
    expect(onBreakdown).toHaveBeenCalledWith(expect.objectContaining({ id: "source" })),
  );
  expect(api.getFinanceTransaction).toHaveBeenLastCalledWith("source");
});
