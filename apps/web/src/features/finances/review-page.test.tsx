// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceInboxCase, FinanceToolResult } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { FinanceReviewPage } from "./review-page.js";

const api = vi.hoisted(() => ({
  getFinanceInbox: vi.fn(),
  answerFinanceReview: vi.fn(),
  getFinanceCategories: vi.fn(),
  getFinanceTransaction: vi.fn(),
  listFinanceTransactions: vi.fn(),
  listFinanceQuestions: vi.fn(),
  listFinanceActionReviews: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));
const reviewId = "11111111-1111-4111-8111-111111111111";
const nextId = "22222222-2222-4222-8222-222222222222";
const transactionId = "33333333-3333-4333-8333-333333333333";
const categoryId = "44444444-4444-4444-8444-444444444444";
const now = "2026-09-03T12:00:00.000Z";
function review(id = reviewId): FinanceInboxCase {
  return {
    economicEventId: nextId,
    evidence: {
      merchant: "Cafe Example",
      transactionId,
      questionReason: "The merchant sells groceries and prepared meals.",
    },
    firstSeenAt: now,
    id,
    impactAmount: 42,
    lastSeenAt: now,
    proposedResolution: null,
    reason: "category_ambiguity",
    reopenedFromId: null,
    resolvedAt: null,
    stableKey: id,
    status: "open",
  };
}
function response(
  data: FinanceInboxCase[],
  prompt = "Was this groceries or a meal?",
): FinanceToolResult<FinanceInboxCase[]> {
  return {
    data,
    changes: [],
    communication: {
      headline: `${data.length} transactions need review.`,
      optionalDetails: [],
      requiredDisclosures: [],
      ...(data[0] ? { nextQuestion: { id: data[0].id, answerType: "text", prompt } } : {}),
    },
    outcome: data.length ? "user_input_required" : "completed",
    remainingWork: { count: data.length, categories: [] },
    schemaVersion: 1,
  };
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FinanceReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceInbox.mockResolvedValue(response([review(), review(nextId)]));
  api.getFinanceCategories.mockResolvedValue([{ id: categoryId, name: "Dining" }]);
  api.getFinanceTransaction.mockResolvedValue({
    data: {
      id: transactionId,
      merchant: "Cafe Example receipt",
      amount: 42,
      currencyCode: "USD",
      date: "2026-09-02",
      direction: "expense",
      pending: false,
      category: null,
    },
  });
  api.listFinanceTransactions.mockResolvedValue({ items: [], nextCursor: null });
  api.listFinanceQuestions.mockResolvedValue([]);
  api.listFinanceActionReviews.mockResolvedValue([]);
});
it("shows the requested question and exact transaction evidence, then advances only after a typed answer returns", async () => {
  const user = userEvent.setup();
  let resolve: ((value: FinanceToolResult<FinanceInboxCase[]>) => void) | undefined;
  api.answerFinanceReview.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount();
  expect(
    await screen.findByRole("heading", { name: "Was this groceries or a meal?" }),
  ).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "Cafe Example receipt" })).toHaveAttribute(
    "href",
    `/finances/transactions?transactionId=${transactionId}`,
  );
  expect(api.getFinanceTransaction).toHaveBeenCalledWith(transactionId);
  expect(screen.getAllByLabelText("Your answer")).toHaveLength(1);
  await user.selectOptions(screen.getByLabelText("Resolution"), "classify_transaction");
  await user.selectOptions(screen.getByLabelText("Category"), categoryId);
  await user.type(screen.getByLabelText("Your answer"), "Dinner with a friend");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(api.answerFinanceReview).toHaveBeenCalledWith(reviewId, {
    answer: "Dinner with a friend",
    idempotencyKey: expect.any(String),
    resolution: { type: "classify_transaction", categoryId, meaning: "Dinner with a friend" },
  });
  expect(screen.getByRole("button", { name: "Saving answer…" })).toBeDisabled();
  expect(screen.getByLabelText("Your answer")).toHaveValue("Dinner with a friend");
  resolve?.(response([review(nextId)], "Was the second purchase expected?"));
  expect(
    await screen.findByRole("heading", { name: "Was the second purchase expected?" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Was this groceries or a meal?")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Your answer")).toHaveValue("");
});
it("preserves failed answers and reuses the mutation key for an unchanged retry", async () => {
  const user = userEvent.setup();
  api.answerFinanceReview
    .mockRejectedValueOnce(new Error("Connection interrupted"))
    .mockResolvedValueOnce(response([]));
  mount();
  await user.type(await screen.findByLabelText("Your answer"), "Bought a gift");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(await screen.findByText("Connection interrupted")).toBeInTheDocument();
  expect(screen.getByLabelText("Your answer")).toHaveValue("Bought a gift");
  const input = api.answerFinanceReview.mock.calls[0]?.[1];
  expect(input.resolution).toEqual({ type: "clarify", clarification: "Bought a gift" });
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(await screen.findByText("No open Inbox questions")).toBeInTheDocument();
  expect(api.answerFinanceReview.mock.calls[1]?.[1]).toEqual(input);
});
it("never invents a question or transaction identity when the canonical response lacks one", async () => {
  const data = response([review()]);
  delete data.communication.nextQuestion;
  api.getFinanceInbox.mockResolvedValue(data);
  mount();
  expect(await screen.findByText("Review question unavailable")).toBeInTheDocument();
  expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument();
  expect(api.getFinanceTransaction).not.toHaveBeenCalled();
});
it("loads older questions and approvals only when their labelled disclosure is opened", async () => {
  const user = userEvent.setup();
  api.getFinanceInbox.mockResolvedValue(response([]));
  api.listFinanceActionReviews.mockResolvedValue([
    {
      id: reviewId,
      status: "pending",
      actionKind: "categorization",
      assumptions: [],
      changes: [{ entityType: "finance_transaction", summary: "Categorize dinner" }],
      requestingAgentId: "Finance agent",
    },
  ]);
  mount();
  await screen.findByText("No open Inbox questions");
  expect(api.listFinanceQuestions).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Older questions and approvals" }));
  await waitFor(() => expect(api.listFinanceQuestions).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Review Categorization")).toBeInTheDocument();
});

it("links a selected transaction with the chosen relationship and excludes the reviewed transaction", async () => {
  const user = userEvent.setup();
  const item = {
    ...review(),
    transactionId,
    evidence: { merchant: "Cafe Example" },
    proposedResolution: {
      type: "link_transactions",
      relationship: "refund",
      relatedTransactionId: nextId,
    },
  };
  api.getFinanceInbox.mockResolvedValue(response([item]));
  api.listFinanceTransactions.mockResolvedValue({
    items: [
      {
        id: transactionId,
        merchant: "Reviewed debit",
        amount: 42,
        currencyCode: "USD",
        date: "2026-09-02",
      },
      {
        id: nextId,
        merchant: "Refund credit",
        amount: 42,
        currencyCode: "USD",
        date: "2026-09-03",
      },
    ],
    nextCursor: null,
  });
  api.answerFinanceReview.mockResolvedValue(response([]));
  mount();
  await user.selectOptions(await screen.findByLabelText("Resolution"), "link_transactions");
  expect(await screen.findByRole("option", { name: /Refund credit/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Reviewed debit/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Related transaction")).toHaveValue(nextId);
  expect(api.getFinanceTransaction).toHaveBeenCalledWith(transactionId);
  await user.type(screen.getByLabelText("Your answer"), "The merchant returned this charge");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(api.answerFinanceReview).toHaveBeenCalledWith(
    reviewId,
    expect.objectContaining({
      resolution: {
        type: "link_transactions",
        relationship: "refund",
        relatedTransactionId: nextId,
      },
    }),
  );
  expect(await screen.findByText("No open Inbox questions")).toBeInTheDocument();
});

it("preserves input for a failed result envelope and does not guess a missing transaction link", async () => {
  const user = userEvent.setup();
  const item = { ...review(), evidence: { merchant: "Cafe Example" } };
  api.getFinanceInbox.mockResolvedValue(response([item]));
  api.answerFinanceReview.mockResolvedValue({
    ...response([item]),
    outcome: "failed",
    communication: {
      ...response([item]).communication,
      headline: "This resolution could not be applied.",
    },
  });
  mount();
  expect(await screen.findByText(/does not include an exact transaction link/)).toBeInTheDocument();
  expect(api.getFinanceTransaction).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText("Resolution"), "dismiss");
  await user.type(screen.getByLabelText("Your answer"), "The charge is legitimate");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(await screen.findByText("This resolution could not be applied.")).toBeInTheDocument();
  expect(screen.getByLabelText("Your answer")).toHaveValue("The charge is legitimate");
  expect(api.answerFinanceReview).toHaveBeenCalledWith(
    reviewId,
    expect.objectContaining({
      resolution: { type: "dismiss", rationale: "The charge is legitimate" },
    }),
  );
});

it("uses source references, proposal defaults, and paged related evidence conservatively", async () => {
  const user = userEvent.setup();
  const sourceId = "55555555-5555-4555-8555-555555555555";
  const item = {
    ...review(),
    transactionId,
    evidence: {
      transactionIds: [sourceId, "not-an-id"],
      sourceRefs: [
        { type: "finance_transaction", id: sourceId },
        { type: "finance_account", id: categoryId },
        null,
      ],
    },
    proposedResolution: { type: "classify_transaction", categoryId, meaning: "Dining" },
  } as FinanceInboxCase;
  api.getFinanceInbox.mockResolvedValue(response([item]));
  api.getFinanceTransaction.mockImplementation(async (id: string) => {
    if (id === transactionId) throw new Error("Primary evidence offline");
    return {
      data: {
        id,
        merchant: "Uncategorized pending item",
        amount: 12,
        currencyCode: null,
        date: "2026-09-01",
        direction: "income",
        pending: true,
        category: "Other",
      },
    };
  });
  api.listFinanceTransactions
    .mockResolvedValueOnce({
      items: [
        { id: nextId, merchant: "Older item", amount: 5, currencyCode: null, date: "2026-08-31" },
      ],
      nextCursor: "older",
    })
    .mockRejectedValueOnce(new Error("Older evidence unavailable"))
    .mockResolvedValueOnce({
      items: [
        { id: nextId, merchant: "Older item", amount: 5, currencyCode: null, date: "2026-08-31" },
      ],
      nextCursor: "older",
    });
  mount();
  expect(await screen.findByText("Proposed category: Dining")).toBeVisible();
  expect(await screen.findByText("Primary evidence offline")).toBeVisible();
  expect(screen.getByText(/currency unavailable.*Pending.*Other/)).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Resolution"), "link_transactions");
  expect(
    await screen.findByRole("option", { name: /Older item.*currency unavailable/ }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Earlier transactions" }));
  expect(await screen.findByText("Older evidence unavailable")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Latest transactions" }));
  expect(await screen.findByRole("option", { name: /Older item/ })).toBeVisible();
});

it("reloads failed inbox and category sources and renews a confirmed failed answer key", async () => {
  const user = userEvent.setup();
  api.getFinanceInbox.mockRejectedValueOnce(new Error("Inbox unavailable"));
  api.getFinanceCategories.mockRejectedValueOnce(new Error("Categories unavailable"));
  api.answerFinanceReview
    .mockRejectedValueOnce(new Error("previously failed; use a new idempotency key"))
    .mockResolvedValueOnce(response([]));
  mount();
  expect(await screen.findByText("Inbox unavailable")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Reload review" }));
  expect(await screen.findByLabelText("Your answer")).toBeVisible();
  expect(await screen.findByText("Categories unavailable")).toBeVisible();
  await user.type(screen.getByLabelText("Your answer"), "Confirmed purchase");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(await screen.findByText(/previously failed/)).toBeVisible();
  const first = api.answerFinanceReview.mock.calls[0]?.[1].idempotencyKey;
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(api.answerFinanceReview.mock.calls[1]?.[1].idempotencyKey).not.toBe(first);
});
