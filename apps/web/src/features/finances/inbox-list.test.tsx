// @vitest-environment jsdom
import type { FinanceInboxCase, FinanceToolResult } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { FinanceInboxList } from "./inbox-list.js";

const api = vi.hoisted(() => ({
  getFinanceCategories: vi.fn(),
  getFinanceTransaction: vi.fn(),
  answerFinanceReview: vi.fn(),
  listFinanceTransactions: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api, errorMessage: (error: Error) => error.message }));
const transactionId = "33333333-3333-4333-8333-333333333333";
const categoryId = "44444444-4444-4444-8444-444444444444";
function item(id: string): FinanceInboxCase {
  return {
    id,
    transactionId,
    economicEventId: transactionId,
    evidence: {},
    firstSeenAt: "2026-09-09T12:00:00Z",
    lastSeenAt: "2026-09-09T12:00:00Z",
    impactAmount: 99,
    proposedResolution: null,
    reason: "possible_transfer",
    reopenedFromId: null,
    resolvedAt: null,
    stableKey: id,
    status: "open",
    prompt: "Where did this money go?",
    context: {
      accountId: transactionId,
      accountName: "Savings",
      institution: "Bank",
      merchant: `Merchant ${id}`,
      date: "2026-09-08",
      amount: 99,
      currencyCode: "USD",
      direction: "expense",
      pending: false,
    },
  };
}
function result(items: FinanceInboxCase[]): FinanceToolResult<FinanceInboxCase[]> {
  return {
    data: items,
    changes: [],
    communication: { headline: "Review activity", optionalDetails: [], requiredDisclosures: [] },
    outcome: "user_input_required",
    remainingWork: { count: items.length, categories: [] },
    schemaVersion: 1,
  };
}
function mount(items: FinanceInboxCase[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FinanceInboxList result={result(items)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceCategories.mockResolvedValue([{ id: categoryId, name: "Groceries" }]);
  api.getFinanceTransaction.mockResolvedValue({
    data: {
      merchant: "Source",
      date: "2026-09-08",
      amount: 99,
      currencyCode: "USD",
      pending: false,
      direction: "expense",
    },
  });
  api.listFinanceTransactions.mockResolvedValue({
    items: [
      { id: transactionId, merchant: "Self" },
      {
        id: categoryId,
        merchant: "Nearby rent",
        date: "2026-09-01",
        amount: 1000,
        currencyCode: "USD",
        direction: "expense",
        pending: false,
      },
    ],
    nextCursor: null,
  });
  api.answerFinanceReview.mockResolvedValue(result([]));
});
it("keeps a compact list, includes deferred and noted items, and reveals all on request", async () => {
  const items = Array.from({ length: 7 }, (_, i) => item(String(i)));
  Object.assign(items[1] ?? {}, { status: "deferred" });
  Object.assign(items[2] ?? {}, {
    resolution: { type: "clarify", clarification: "A weekly transfer" },
  });
  Object.assign(items[6] ?? {}, { status: "resolved" });
  mount(items);
  expect(screen.getByText("Outstanding (6)")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Review Merchant/ })).toHaveLength(5);
  expect(screen.getByText("Deferred")).toBeInTheDocument();
  expect(screen.getByText("Note saved · awaiting maintenance")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show all 6" }));
  expect(screen.getAllByRole("button", { name: /Review Merchant/ })).toHaveLength(6);
  await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
  expect(screen.getAllByRole("button", { name: /Review Merchant/ })).toHaveLength(5);
});
it("opens a selected item with dated context, saves a note without categorizing, and updates the shared Inbox", async () => {
  const client = mount([item("1"), item("2")]);
  await userEvent.click(screen.getByRole("button", { name: "Review Merchant 2" }));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByText(/2026-09-08 · Bank Savings · Money out · Posted/),
  ).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Nearby account activity" }));
  expect(await screen.findByRole("link", { name: "Nearby rent" })).toBeInTheDocument();
  expect(api.listFinanceTransactions).toHaveBeenCalledWith({
    accountId: transactionId,
    from: "2026-09-01",
    to: "2026-09-15",
    limit: 50,
  });
  await userEvent.type(within(dialog).getByLabelText("Your answer"), "Weekly savings transfer");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save answer" }));
  await waitFor(() =>
    expect(api.answerFinanceReview).toHaveBeenCalledWith(
      "2",
      expect.objectContaining({
        answer: "Weekly savings transfer",
        resolution: { type: "clarify", clarification: "Weekly savings transfer" },
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(client.getQueryData(["finance-inbox"])).toEqual(result([]));
});
it("supports immediate categorization and preserves input after a failed save", async () => {
  api.answerFinanceReview.mockRejectedValueOnce(new Error("Network unavailable"));
  mount([item("1")]);
  await userEvent.click(screen.getByRole("button", { name: "Review Merchant 1" }));
  await userEvent.selectOptions(screen.getByLabelText("Resolution"), "classify_transaction");
  await userEvent.selectOptions(screen.getByLabelText("Category"), categoryId);
  await userEvent.type(screen.getByLabelText("Your answer"), "Groceries delivery");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(await screen.findByText("Network unavailable")).toBeInTheDocument();
  expect(screen.getByLabelText("Your answer")).toHaveValue("Groceries delivery");
  const firstKey = api.answerFinanceReview.mock.calls[0]?.[1].idempotencyKey;
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await waitFor(() =>
    expect(api.answerFinanceReview).toHaveBeenLastCalledWith("1", {
      idempotencyKey: firstKey,
      answer: "Groceries delivery",
      resolution: { type: "classify_transaction", categoryId, meaning: "Groceries delivery" },
    }),
  );
});
it("shows the empty state", () => {
  mount([]);
  expect(screen.getByText("No outstanding Inbox items.")).toBeInTheDocument();
});

it("lets the user categorize immediately without also writing a note", async () => {
  mount([item("1")]);
  await userEvent.click(screen.getByRole("button", { name: "Review Merchant 1" }));
  await userEvent.selectOptions(screen.getByLabelText("Resolution"), "classify_transaction");
  await userEvent.selectOptions(screen.getByLabelText("Category"), categoryId);
  expect(screen.getByRole("button", { name: "Save answer" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await waitFor(() =>
    expect(api.answerFinanceReview).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({
        answer: "Categorized as Groceries.",
        resolution: {
          type: "classify_transaction",
          categoryId,
          meaning: "Categorized as Groceries.",
        },
      }),
    ),
  );
});

it.each([
  ["income", "Money in"],
  ["transfer", "Transfer"],
])("labels a pending %s without inventing its currency", async (direction, label) => {
  const review = item("1");
  Object.assign(review.context ?? {}, { direction, currencyCode: null, pending: true });
  delete review.prompt;
  mount([review]);
  expect(screen.getByText("99 (currency unavailable)")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Review Merchant 1" }));
  expect(
    within(screen.getByRole("dialog")).getByText(new RegExp(`Bank Savings · ${label} · Pending`)),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "What should we know about this item?" }),
  ).toBeVisible();
});
it("discloses failed, empty and truncated nearby activity", async () => {
  api.listFinanceTransactions.mockRejectedValueOnce(new Error("Account activity unavailable"));
  const client = mount([item("1")]);
  await userEvent.click(screen.getByRole("button", { name: "Review Merchant 1" }));
  await userEvent.click(screen.getByRole("button", { name: "Nearby account activity" }));
  expect(await screen.findByText("Account activity unavailable")).toBeVisible();
  api.listFinanceTransactions.mockResolvedValueOnce({ items: [], nextCursor: null });
  await client.invalidateQueries({ queryKey: ["finance-review-nearby"] });
  expect(await screen.findByText("No other activity in this window.")).toBeVisible();
  api.listFinanceTransactions.mockResolvedValueOnce({
    items: [
      {
        id: categoryId,
        merchant: "Unsettled payment",
        date: "2026-09-08",
        amount: 10,
        currencyCode: null,
        pending: true,
        direction: "expense",
      },
    ],
    nextCursor: "opaque-next",
  });
  await client.invalidateQueries({ queryKey: ["finance-review-nearby"] });
  expect(await screen.findByRole("link", { name: "Open account transactions" })).toHaveAttribute(
    "href",
    `/finances/transactions?accountId=${transactionId}`,
  );
  expect(screen.getByText(/10 currency unavailable · expense · Pending/)).toBeVisible();
});
