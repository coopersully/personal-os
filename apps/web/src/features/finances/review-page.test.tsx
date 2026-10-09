// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type {
  FinanceInboxCase,
  FinanceReviewHistoryItem,
  FinanceReviewHistorySummary,
  FinanceToolResult,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { FinanceReviewPage } from "./review-page.js";

const api = vi.hoisted(() => ({
  getFinanceInbox: vi.fn(),
  listFinanceReviewHistory: vi.fn(),
  getFinanceReviewHistoryItem: vi.fn(),
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
function mount(path = "/finances/review") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <FinanceReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceInbox.mockResolvedValue(response([review(), review(nextId)]));
  api.listFinanceReviewHistory.mockResolvedValue({ items: [], nextCursor: null });
  api.getFinanceReviewHistoryItem.mockResolvedValue(null);
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

it("loads bounded review history and exact evidence without changing the active question", async () => {
  const user = userEvent.setup();
  const first: FinanceReviewHistorySummary = {
    id: reviewId,
    transactionId,
    firstSeenAt: now,
    reason: "category_ambiguity",
    resolvedAt: null,
    status: "open",
    context: {
      accountId: categoryId,
      accountName: "Checking",
      institution: "Bank",
      merchant: "Cafe Example",
      date: "2026-09-02",
      amount: 42,
      currencyCode: "USD",
      direction: "expense",
      pending: false,
    },
  };
  const resolved: FinanceReviewHistorySummary = {
    ...first,
    id: nextId,
    status: "resolved",
    resolvedAt: now,
  };
  const detail: FinanceReviewHistoryItem = {
    ...review(nextId),
    ...resolved,
    resolution: { answer: "Dinner with a friend", type: "dismiss" },
    resolutionProvenance: { actorType: "user" },
    evidence: { note: "Receipt checked", source: "manual" },
  };
  api.listFinanceReviewHistory.mockImplementation(async ({ cursor }: { cursor?: string }) =>
    cursor ? { items: [resolved], nextCursor: null } : { items: [first], nextCursor: reviewId },
  );
  api.getFinanceReviewHistoryItem.mockResolvedValue(detail);
  mount();
  expect(
    await screen.findByRole("heading", { name: "Was this groceries or a meal?" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Older questions and approvals" }));
  expect(await screen.findByRole("heading", { name: "Review history" })).toBeVisible();
  expect(api.listFinanceReviewHistory).toHaveBeenCalledWith({ limit: 20 });
  await user.click(await screen.findByRole("button", { name: "Load more history" }));
  await waitFor(() =>
    expect(api.listFinanceReviewHistory).toHaveBeenCalledWith({ limit: 20, cursor: reviewId }),
  );
  expect(screen.getByText("resolved")).toBeVisible();
  const evidenceButtons = screen.getAllByRole("button", { name: /View evidence for Cafe Example/ });
  const secondButton = evidenceButtons[1];
  if (!secondButton) throw new Error("The second history item was not rendered.");
  await user.click(secondButton);
  expect(api.getFinanceReviewHistoryItem).toHaveBeenCalledWith(nextId);
  expect(await screen.findByText("Recorded answer: Dinner with a friend")).toBeVisible();
  expect(screen.getByText(/Receipt checked/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Open transaction" })).toHaveAttribute(
    "href",
    `/finances/transactions?transactionId=${transactionId}`,
  );
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("heading", { name: "Was this groceries or a meal?" })).toBeVisible();
});

it.each([
  {
    name: "a consolidation reason",
    resolution: {
      type: "dismiss",
      rationale: "Consolidated into the canonical Finance Inbox case.",
    },
    expected: "Reason: Consolidated into the canonical Finance Inbox case.",
  },
  {
    name: "classification details",
    resolution: { type: "classify_transaction", categoryId, meaning: "Prepared meals" },
    expected: `Category reference: ${categoryId}`,
  },
  {
    name: "a linked transaction",
    resolution: {
      type: "link_transactions",
      relationship: "reimbursement",
      relatedTransactionId: nextId,
    },
    expected: "Relationship: reimbursement",
  },
])("shows $name when a review has no answer text", async ({ resolution, expected }) => {
  const user = userEvent.setup();
  const summary: FinanceReviewHistorySummary = {
    id: reviewId,
    transactionId,
    firstSeenAt: now,
    reason: "category_ambiguity",
    resolvedAt: now,
    status: "resolved",
    context: {
      accountId: categoryId,
      accountName: "Checking",
      institution: "Bank",
      merchant: "Cafe Example",
      date: "2026-09-02",
      amount: 42,
      currencyCode: "USD",
      direction: "expense",
      pending: false,
    },
  };
  const detail: FinanceReviewHistoryItem = {
    ...review(),
    ...summary,
    resolution,
    resolutionProvenance: null,
  };
  api.listFinanceReviewHistory.mockResolvedValue({ items: [summary], nextCursor: null });
  api.getFinanceReviewHistoryItem.mockResolvedValue(detail);
  mount();
  await user.click(screen.getByRole("button", { name: "Older questions and approvals" }));
  await user.click(await screen.findByRole("button", { name: "View evidence for Cafe Example" }));
  expect(await screen.findByText(expected)).toBeVisible();
  expect(screen.queryByText("Resolution recorded")).not.toBeInTheDocument();
  if (resolution.type === "link_transactions") {
    expect(screen.getByRole("link", { name: "Open related transaction" })).toHaveAttribute(
      "href",
      `/finances/transactions?transactionId=${nextId}`,
    );
  }
  if (resolution.type === "classify_transaction") {
    expect(screen.getByText("Meaning: Prepared meals")).toBeVisible();
  }
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
  await user.type(screen.getByRole("combobox", { name: "Category" }), "Dining");
  await user.keyboard("{Enter}");
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
  expect(
    await screen.findByText(/Couldn’t confirm whether we could save this review/),
  ).toBeInTheDocument();
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
  expect(await screen.findByText("Couldn’t load this material.")).toBeVisible();
  expect(screen.getByText(/currency unavailable.*Pending.*Other/)).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Resolution"), "link_transactions");
  expect(
    await screen.findByRole("option", { name: /Older item.*currency unavailable/ }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Earlier transactions" }));
  expect(await screen.findAllByText("Couldn’t load this material.")).toHaveLength(2);
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
  expect(await screen.findByText("Couldn’t load this material.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Reload review" }));
  expect(await screen.findByLabelText("Your answer")).toBeVisible();
  expect(await screen.findByText("Couldn’t load this material.")).toBeVisible();
  await user.type(screen.getByLabelText("Your answer"), "Confirmed purchase");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(
    await screen.findByText(/Couldn’t confirm whether we could save this review/),
  ).toBeVisible();
  const first = api.answerFinanceReview.mock.calls[0]?.[1].idempotencyKey;
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(api.answerFinanceReview.mock.calls[1]?.[1].idempotencyKey).not.toBe(first);
});

it("keeps saved notes inspectable when no unanswered question remains", async () => {
  const data = response([
    {
      ...review(),
      prompt: "Where did this money go?",
      resolution: { type: "clarify", clarification: "A savings transfer" },
    },
  ]);
  delete data.communication.nextQuestion;
  data.outcome = "work_remaining";
  api.getFinanceInbox.mockResolvedValue(data);
  mount();
  expect(await screen.findByText("Note saved · awaiting maintenance")).toBeVisible();
  expect(screen.getByText("A savings transfer")).toBeVisible();
  expect(screen.queryByText("Review question unavailable")).not.toBeInTheDocument();
  expect(screen.queryByText("No open Inbox questions")).not.toBeInTheDocument();
});

it("keeps legacy clarification evidence inspectable as a saved note", async () => {
  const data = response([
    {
      ...review(),
      prompt: "Where did this money go?",
      evidence: { clarification: "A legacy savings transfer note" },
    },
  ]);
  delete data.communication.nextQuestion;
  data.outcome = "work_remaining";
  api.getFinanceInbox.mockResolvedValue(data);
  mount();
  expect(await screen.findByText("Note saved · awaiting maintenance")).toBeVisible();
  expect(screen.getByText("A legacy savings transfer note")).toBeVisible();
});

it("lets the user choose a later case using its own server-authored question", async () => {
  const later = {
    ...review(nextId),
    prompt: "Was this a gift?",
    context: {
      accountId: transactionId,
      accountName: "Checking",
      institution: "Bank",
      date: "2026-09-03",
      amount: 63,
      currencyCode: "USD",
      direction: "income" as const,
      pending: false,
      merchant: "Transfer",
    },
  };
  api.getFinanceInbox.mockResolvedValue(response([review(), later]));
  mount();
  await userEvent.selectOptions(await screen.findByLabelText("Outstanding items"), nextId);
  expect(screen.getByRole("heading", { name: "Was this a gift?" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Was this groceries or a meal?" }),
  ).not.toBeInTheDocument();
});

it("does not substitute another question for an inaccessible exact case", async () => {
  mount("/finances/review?item=99999999-9999-4999-8999-999999999999");
  expect(await screen.findByText("Review question unavailable")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Was this groceries or a meal?" }),
  ).not.toBeInTheDocument();
  expect(api.answerFinanceReview).not.toHaveBeenCalled();
});

it("opens an exact legacy question without showing the canonical question", async () => {
  api.listFinanceQuestions.mockResolvedValue([
    {
      id: nextId,
      actionKind: "profile",
      prompt: "Exact question",
      why: "Needs evidence",
      choices: [],
      sourceRefs: [],
      expectedAnswer: [],
    },
  ]);
  mount(`/finances/review?question=${nextId}`);
  expect(await screen.findByText("Exact question")).toBeInTheDocument();
  expect(api.listFinanceQuestions).toHaveBeenCalledWith(50, nextId);
  expect(api.listFinanceActionReviews).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("heading", { name: "Was this groceries or a meal?" }),
  ).not.toBeInTheDocument();
});

it("shows an unavailable exact approval without offering another pending approval", async () => {
  api.listFinanceActionReviews.mockResolvedValue([{ id: reviewId, status: "pending" }]);
  mount(`/finances/review?approval=${nextId}`);
  expect(await screen.findByText("Requested review unavailable")).toBeInTheDocument();
  expect(api.listFinanceActionReviews).toHaveBeenCalledWith(50, nextId);
  expect(api.listFinanceQuestions).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
});

it("requires shortening a long clarification when switching to a category resolution", async () => {
  const user = userEvent.setup();
  mount();
  const answer = await screen.findByLabelText("Your answer");
  await user.click(answer);
  await user.paste("A".repeat(600));
  expect(screen.getByRole("button", { name: "Save answer" })).toBeEnabled();
  await user.selectOptions(screen.getByLabelText("Resolution"), "classify_transaction");
  expect(screen.getByText("Use 500 characters or fewer for this resolution.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled();
  await user.clear(answer);
  await user.type(screen.getByRole("combobox", { name: "Category" }), "Dining");
  await user.keyboard("{Enter}");
  api.answerFinanceReview.mockResolvedValue(response([]));
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(api.answerFinanceReview).toHaveBeenCalledWith(
    reviewId,
    expect.objectContaining({
      answer: "Categorized as Dining.",
      resolution: { type: "classify_transaction", categoryId, meaning: "Categorized as Dining." },
    }),
  );
  expect(await screen.findByText("No open Inbox questions")).toBeVisible();
});

it("shows a selected transaction's evidence even when it is absent from the related page", async () => {
  const item = {
    ...review(),
    proposedResolution: {
      type: "link_transactions",
      relationship: "refund",
      relatedTransactionId: nextId,
    },
  };
  api.getFinanceInbox.mockResolvedValue(response([item]));
  api.getFinanceTransaction.mockImplementation(async (id: string) => ({
    data: {
      id,
      merchant: id === nextId ? "Prior refund" : "Original debit",
      amount: 42,
      currencyCode: "USD",
      date: "2026-09-02",
      direction: id === nextId ? "income" : "expense",
      pending: false,
      category: null,
    },
  }));
  mount();
  await userEvent.selectOptions(await screen.findByLabelText("Resolution"), "link_transactions");
  expect(await screen.findByRole("link", { name: "Prior refund" })).toHaveAttribute(
    "href",
    `/finances/transactions?transactionId=${nextId}`,
  );
  expect(screen.getByRole("option", { name: "Selected transaction (see evidence)" })).toBeVisible();
  expect(screen.getByLabelText("Related transaction")).toHaveValue(nextId);
});
