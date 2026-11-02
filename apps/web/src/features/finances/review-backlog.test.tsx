// @vitest-environment jsdom
import type {
  FinanceReviewBacklogAssessment,
  FinanceReviewBacklogItem,
  FinanceReviewBatchRun,
} from "@personal-os/domain";
import { emptyFinanceReviewBacklogCounts, financeReviewBacklogGroups } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { vi } from "vitest";
import { ReviewFlowHost } from "../reviews/flow";
import { FinanceReviewBacklog } from "./review-backlog";

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => viewport.mobile }));

const api = vi.hoisted(() => ({
  getFinanceReviewBacklog: vi.fn(),
  listFinanceReviewBacklogItems: vi.fn(),
  listFinanceReviewBatches: vi.fn(),
  getFinanceReviewBatch: vi.fn(),
  executeFinanceReviewBatch: vi.fn(),
  getFinanceTransaction: vi.fn(),
  getFinanceCategories: vi.fn(),
  listAgentAccessWorkItems: vi.fn(),
}));
vi.mock("@/api", () => ({ api, errorMessage: (error: Error) => error.message }));
const id = "11111111-1111-4111-8111-111111111111";
const nextId = "22222222-2222-4222-8222-222222222222";
const now = "2026-10-24T12:00:00.000Z";
function assessment(populated = true): FinanceReviewBacklogAssessment {
  const counts = {
    ...emptyFinanceReviewBacklogCounts(),
    ...(populated
      ? {
          items: 15,
          needsReviewTransactions: 11,
          openReviewCases: 3,
          deferredReviewCases: 1,
          historical: 15,
        }
      : {}),
  };
  return {
    schemaVersion: 1,
    snapshot: "a".repeat(64),
    scope: "all_owned_transactions_flagged_and_open_or_deferred_cases",
    countingUnit: "transaction_flags_and_review_cases_separately",
    month: "2026-10",
    timezone: "UTC",
    complete: true,
    counts,
    reasons: [],
    groups: financeReviewBacklogGroups.map((group) => ({
      ...group,
      counts: group.group === "roundups" ? counts : emptyFinanceReviewBacklogCounts(),
    })),
  };
}
function item(merchant = "Synthetic roundup"): FinanceReviewBacklogItem {
  return {
    id,
    transactionId: id,
    reviewCaseId: null,
    source: "transaction_flag",
    group: "roundups",
    reason: "needs_review",
    status: "needs_review",
    period: "historical",
    transaction: {
      date: "2024-01-01",
      merchant,
      amountCents: 12,
      currencyCode: "USD",
      direction: "expense",
      category: null,
      needsReview: true,
      pending: false,
    },
    fingerprint: "a".repeat(64),
    provenance: {
      transactionFingerprint: "a".repeat(64),
      reviewFingerprint: null,
      expectedTransactionUpdatedAt: now,
      expectedReviewUpdatedAt: null,
      transactionRevision: "1",
      reviewRevision: null,
      actionRevision: null,
      evidenceState: "current_record",
      freshness: "requires_validation",
    },
    savedClarification: {
      source: "evidence",
      text: "This was a savings deposit.",
      truncated: false,
    },
    evidence: ["Synthetic statement entry"],
    recommendedOperations: ["review_transaction"],
    requiresPreview: true,
    destination: `/finances/transactions?transactionId=${id}`,
  };
}
function batch(): FinanceReviewBatchRun {
  return {
    id,
    fingerprint: `sha256:${"b".repeat(64)}`,
    idempotencyKey: "synthetic-batch",
    status: "previewed",
    pendingCount: 2,
    createdAt: now,
    updatedAt: now,
    outcomes: [],
    decisions: [
      {
        kind: "categorization",
        transactionId: id,
        categoryId: nextId,
        expectedTransactionUpdatedAt: now,
        expectedTransactionRevision: "1",
        rationale: "The receipt identifies groceries.",
        evidence: "Synthetic receipt line items",
        confidence: 0.8,
        learnMerchant: "never",
      },
      {
        kind: "review",
        transactionId: nextId,
        reviewId: nextId,
        expectedTransactionUpdatedAt: now,
        expectedTransactionRevision: "1",
        expectedReviewUpdatedAt: now,
        expectedReviewRevision: "1",
        expectedActionRevision: "0",
        action: "defer",
        rationale: "Destination still unknown.",
        evidence: "Statement lacks recipient",
        confidence: 0.2,
        learnMerchant: "never",
      },
    ],
  };
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FinanceReviewBacklog />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
beforeEach(() => {
  viewport.mobile = false;
  vi.resetAllMocks();
  api.getFinanceReviewBacklog.mockResolvedValue(assessment());
  api.listFinanceReviewBacklogItems.mockResolvedValue({
    items: [item()],
    total: 15,
    nextCursor: "page-two",
    complete: false,
  });
  api.listFinanceReviewBatches.mockResolvedValue([]);
  api.getFinanceCategories.mockResolvedValue([{ id: nextId, name: "Groceries" }]);
  api.getFinanceTransaction.mockResolvedValue({ data: { merchant: "Synthetic grocer" } });
});
afterEach(() => vi.restoreAllMocks());

it("keeps loading distinct from empty and renders independent all-date counts", async () => {
  let resolve!: (value: FinanceReviewBacklogAssessment) => void;
  api.getFinanceReviewBacklog.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  mount();
  expect(screen.getByRole("status", { name: "Loading review backlog" })).toBeVisible();
  expect(screen.queryByText("No outstanding review records")).not.toBeInTheDocument();
  resolve(assessment());
  expect(await screen.findByText("Flagged transactions")).toBeVisible();
  for (const [label, count] of [
    ["Flagged transactions", "11"],
    ["Open reviews", "3"],
    ["Deferred reviews", "1"],
  ] as const) {
    expect(screen.getByText(label).parentElement).toHaveTextContent(count);
  }
  expect(screen.getByText(/15 historical/)).toBeVisible();
  expect(await screen.findByText("Saved clarification: This was a savings deposit.")).toBeVisible();
  expect(await screen.findByRole("link", { name: "Synthetic roundup" })).toHaveAttribute(
    "href",
    `/finances/transactions?transactionId=${id}`,
  );
});

it("shows successful empty assessment and batches without fetching group items", async () => {
  api.getFinanceReviewBacklog.mockResolvedValue(assessment(false));
  mount();
  expect(await screen.findByText("No outstanding review records")).toBeVisible();
  expect(await screen.findByText("No prepared batches")).toBeVisible();
  expect(api.listFinanceReviewBacklogItems).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Process 2 decisions" })).not.toBeInTheDocument();
});

it("paginates only the selected group and resets its cursor on group changes", async () => {
  api.listFinanceReviewBacklogItems.mockImplementation(async ({ group, cursor }) => ({
    items:
      group === "card_payments" ? [] : [item(cursor ? "Earlier roundup" : "Synthetic roundup")],
    total: group === "card_payments" ? 0 : 15,
    nextCursor: cursor ? null : "page-two",
  }));
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Next records" }));
  expect(await screen.findByText("Earlier roundup")).toBeVisible();
  expect(screen.queryByText("Synthetic roundup")).not.toBeInTheDocument();
  expect(api.listFinanceReviewBacklogItems).toHaveBeenLastCalledWith({
    group: "roundups",
    cursor: "page-two",
    limit: 10,
  });
  await user.click(screen.getByRole("button", { name: "Previous records" }));
  expect(await screen.findByText("Synthetic roundup")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Investigation group"), "card_payments");
  expect(await screen.findByText("No records in this group")).toBeVisible();
  expect(api.listFinanceReviewBacklogItems).toHaveBeenLastCalledWith({
    group: "card_payments",
    cursor: undefined,
    limit: 10,
  });
});

it("authorizes an exact persisted manifest, resumes remaining work, and preserves exception outcomes", async () => {
  const loading = vi.spyOn(toast, "loading");
  const success = vi.spyOn(toast, "success");
  let saved = batch();
  api.listFinanceReviewBatches.mockResolvedValue([saved]);
  api.getFinanceReviewBatch.mockImplementation(async () => saved);
  api.executeFinanceReviewBatch.mockImplementation(async () => {
    saved =
      saved.outcomes.length === 0
        ? {
            ...saved,
            status: "in_progress",
            pendingCount: 1,
            outcomes: [
              {
                index: 0,
                transactionId: id,
                status: "applied",
                error: null,
                recovery: "none",
                completedAt: now,
              },
            ],
          }
        : {
            ...saved,
            status: "completed_with_exceptions",
            pendingCount: 0,
            outcomes: [
              ...saved.outcomes,
              {
                index: 1,
                transactionId: nextId,
                status: "review_required",
                error: { code: "stale_evidence", message: "Observed transaction changed." },
                recovery: "new_preview",
                completedAt: now,
              },
            ],
          };
    return saved;
  });
  const user = userEvent.setup();
  const view = mount();
  await user.selectOptions(await screen.findByLabelText("Saved batch"), id);
  expect(await screen.findByText("1. Categorize transaction")).toBeVisible();
  expect(screen.getByText("2. defer")).toBeVisible();
  expect(await screen.findByText("Category: Groceries")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open exact review" })).toHaveAttribute(
    "href",
    `/finances?review=${encodeURIComponent(`finance-review:${nextId}`)}`,
  );
  for (const revision of screen.getAllByText(`Transaction revision: ${now}`, { exact: false }))
    expect(revision).not.toBeVisible();
  expect(screen.getByText("Evidence: Synthetic receipt line items")).toBeVisible();
  expect(screen.getByText("The receipt identifies groceries.")).toBeVisible();
  expect(await screen.findAllByText("Synthetic grocer")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Process 2 decisions" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Resume 1 decision" })).toBeEnabled(),
  );
  expect(api.executeFinanceReviewBatch).toHaveBeenLastCalledWith(id, {
    fingerprint: batch().fingerprint,
    limit: 10,
  });
  expect(api.getFinanceReviewBacklog.mock.calls.length).toBeGreaterThan(1);
  expect(loading).toHaveBeenCalled();
  expect(success).toHaveBeenCalledWith(
    "Batch step recorded. Review the saved outcomes.",
    expect.anything(),
  );
  expect(
    screen.queryByText("Batch step recorded. Review the saved outcomes."),
  ).not.toBeInTheDocument();
  // Reloading reconstructs resume from the server, with no component-local run state.
  view.unmount();
  mount();
  await user.selectOptions(await screen.findByLabelText("Saved batch"), id);
  await user.click(await screen.findByRole("button", { name: "Resume 1 decision" }));
  expect(await screen.findByText("Observed transaction changed. (stale_evidence)")).toBeVisible();
  expect(screen.getByText("Needs a new preview with corrected evidence.")).toBeVisible();
  expect(
    within(screen.getByRole("list", { name: "Exact batch decisions" })).getByText("applied"),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Resume 1 decision" })).not.toBeInTheDocument();
});

it("reports an uncertain execution through Sonner and reloads committed state before resume", async () => {
  const error = vi.spyOn(toast, "error");
  const saved = batch();
  api.listFinanceReviewBatches.mockResolvedValue([saved]);
  api.getFinanceReviewBatch.mockResolvedValue(saved);
  api.executeFinanceReviewBatch.mockRejectedValue(new Error("Connection dropped"));
  const user = userEvent.setup();
  mount();
  await user.selectOptions(await screen.findByLabelText("Saved batch"), id);
  await user.click(await screen.findByRole("button", { name: "Process 2 decisions" }));
  await waitFor(() => expect(error).toHaveBeenCalled());
  await waitFor(() => expect(api.getFinanceReviewBatch).toHaveBeenCalledTimes(2));
  expect(api.executeFinanceReviewBatch).toHaveBeenCalledOnce();
  expect(screen.queryByText("Connection dropped")).not.toBeInTheDocument();
});

it("recovers an unavailable assessment without presenting it as an empty backlog", async () => {
  api.getFinanceReviewBacklog
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue(assessment());
  const user = userEvent.setup();
  mount();
  const recovery = await screen.findByRole("region", { name: "Review backlog unavailable" });
  expect(screen.queryByText("No outstanding review records")).not.toBeInTheDocument();
  await user.click(within(recovery).getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Synthetic roundup")).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Review backlog unavailable" }),
  ).not.toBeInTheDocument();
});

it.each([
  false,
  true,
])("opens backlog in the shared review flow (mobile=%s) with no session decisions", async (mobile) => {
  viewport.mobile = mobile;
  api.listAgentAccessWorkItems.mockResolvedValue({
    items: [],
    nextCursor: null,
    unavailableDomains: [],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/finances?review=open"]}>
        <ReviewFlowHost workspace="finances" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  (await screen.findByRole("button", { name: "Review backlog and saved batches" })).focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByText("Synthetic roundup")).toBeVisible();
  expect(screen.getByRole("region", { name: "Saved review batches" })).toBeVisible();
  expect(screen.getByText(/completed in this session. Check the review backlog/)).toBeVisible();
});

it("does not authorize a category decision until its category can be identified", async () => {
  api.listFinanceReviewBatches.mockResolvedValue([batch()]);
  api.getFinanceReviewBatch.mockResolvedValue(batch());
  api.getFinanceCategories.mockResolvedValue([]);
  const user = userEvent.setup();
  mount();
  await user.selectOptions(await screen.findByLabelText("Saved batch"), id);
  expect(await screen.findByText("Category: Unavailable — prepare a new preview")).toBeVisible();
  expect(screen.getByRole("button", { name: "Process 2 decisions" })).toBeDisabled();
  expect(api.executeFinanceReviewBatch).not.toHaveBeenCalled();
});

it.each([
  1, 11,
])("labels the bounded process action for %i pending decisions", async (pendingCount) => {
  const saved = {
    ...batch(),
    pendingCount,
    decisions: Array.from({ length: pendingCount }, (_, index) => ({
      ...batch().decisions[0],
      transactionId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    })),
  };
  api.listFinanceReviewBatches.mockResolvedValue([saved]);
  api.getFinanceReviewBatch.mockResolvedValue(saved);
  mount();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Saved batch"), id);
  expect(
    await screen.findByRole("button", {
      name: pendingCount === 1 ? "Process 1 decision" : "Process next 10",
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("option", {
      name: new RegExp(
        `${pendingCount} pending · ${pendingCount} ${pendingCount === 1 ? "decision" : "decisions"}$`,
      ),
    }),
  ).toBeInTheDocument();
});
