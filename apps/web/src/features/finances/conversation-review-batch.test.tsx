// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceReviewBatchRun } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FinanceConversationReviewBatch } from "./conversation-review-batch";

const api = vi.hoisted(() => ({
  getFinanceReviewBatch: vi.fn(),
  getFinanceCategories: vi.fn(),
  executeFinanceReviewBatch: vi.fn(),
  previewFinanceReviewBatchUndo: vi.fn(),
  getFinanceBatchContinuation: vi.fn(),
  approveFinanceBatchContinuation: vi.fn(),
  cancelFinanceBatchContinuation: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  loading: vi.fn(() => "toast"),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
vi.mock("sonner", () => ({ toast }));
const at = "2026-11-11T00:00:00Z";
function preview(): FinanceReviewBatchRun {
  return {
    id: "batch",
    fingerprint: `sha256:${"a".repeat(64)}`,
    idempotencyKey: "batch",
    status: "previewed",
    pendingCount: 11,
    createdAt: at,
    updatedAt: at,
    transferCounterparts: [],
    outcomes: [],
    decisions: Array.from({ length: 11 }, (_, index) => ({
      kind: "categorization",
      transactionId: `transaction-${index}`,
      categoryId: "category",
      expectedTransactionUpdatedAt: at,
      expectedTransactionRevision: "1",
      rationale: `Decision ${index}`,
      evidence: "Observed account statement",
      confidence: 1,
      learnMerchant: "never",
    })),
  };
}
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <FinanceConversationReviewBatch id="batch" sessionKey="owner:1" isCurrent={() => true} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceBatchContinuation.mockResolvedValue(null);
  api.getFinanceCategories.mockResolvedValue([{ id: "category", name: "Groceries" }]);
});
it("saves exact approval and leaves execution on the server after the view closes", async () => {
  const original = preview();
  api.getFinanceReviewBatch.mockResolvedValue(original);
  api.getFinanceBatchContinuation.mockResolvedValue(null);
  const receipt = {
    id: "approval",
    batchId: original.id,
    fingerprint: original.fingerprint,
    state: "pending",
    recovery: "none",
  };
  api.approveFinanceBatchContinuation.mockImplementation(async () => {
    api.getFinanceBatchContinuation.mockResolvedValue(receipt);
    return receipt;
  });
  const view = mount();
  fireEvent.click(await screen.findByRole("button", { name: "Approve batch (11)" }));
  await screen.findByText("Approved · waiting to process");
  expect(api.approveFinanceBatchContinuation).toHaveBeenCalledWith(
    original.id,
    original.fingerprint,
  );
  expect(api.executeFinanceReviewBatch).not.toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledWith(
    "Batch approved. Progress is saved in Finance Chat.",
    expect.anything(),
  );
  view.unmount();
  expect(api.cancelFinanceBatchContinuation).not.toHaveBeenCalled();
});
it("shows saved partial outcomes and recovery without claiming all decisions applied", async () => {
  api.getFinanceReviewBatch.mockResolvedValue({
    ...preview(),
    pendingCount: 10,
    outcomes: [{ index: 0, status: "failed", error: { message: "Source changed" } }],
  });
  api.getFinanceBatchContinuation.mockResolvedValue({ state: "blocked", recovery: "new_preview" });
  mount();
  await screen.findByText("Source changed");
  expect(screen.getByText("10 pending · 0 applied")).toBeVisible();
  expect(
    screen.getByText("Ask nohmi for a fresh preview of the remaining decisions."),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: /Approve batch/ })).toBeNull();
  expect(toast.success).not.toHaveBeenCalled();
});
it("offers the exact transfer counterpart and holds an old preview without one", async () => {
  const original = preview();
  const transfer = {
    ...original.decisions[0],
    kind: "review",
    action: "confirm_transfer",
    reviewId: "case",
    expectedReviewUpdatedAt: at,
    expectedReviewRevision: "1",
    expectedActionRevision: "0",
  };
  api.getFinanceReviewBatch
    .mockResolvedValueOnce({ ...original, decisions: [transfer], pendingCount: 1 })
    .mockResolvedValue({
      ...original,
      decisions: [transfer],
      pendingCount: 1,
      transferCounterparts: [{ index: 0, transactionId: "counterpart", revision: "2" }],
    });
  const view = mount();
  await screen.findByText("Ask for a fresh batch with both transfer records attached.");
  expect(screen.queryByRole("button", { name: /Approve batch/ })).toBeNull();
  view.unmount();
  mount();
  expect(await screen.findByRole("link", { name: "View other transfer leg" })).toHaveAttribute(
    "href",
    "/finances/transactions?transactionId=counterpart",
  );
  expect(screen.getByRole("button", { name: "Approve batch (1)" })).toBeEnabled();
});
it("cancels durable pending work only after an explicit request", async () => {
  api.getFinanceReviewBatch.mockResolvedValue(preview());
  api.getFinanceBatchContinuation.mockResolvedValue({ state: "running" });
  api.cancelFinanceBatchContinuation.mockImplementation(async () => {
    api.getFinanceBatchContinuation.mockResolvedValue({
      state: "cancelled",
      recovery: "new_preview",
    });
    return { state: "cancelled", recovery: "new_preview" };
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Stop remaining decisions" }));
  await screen.findByText("cancelled");
  expect(api.cancelFinanceBatchContinuation).toHaveBeenCalledWith("batch");
  expect(toast.success).toHaveBeenCalledWith(
    "Remaining decisions stopped. Saved changes are kept.",
    expect.anything(),
  );
  expect(screen.queryByText("Remaining decisions stopped. Saved changes are kept.")).toBeNull();
});
it("requires the exact category before allowing approval", async () => {
  api.getFinanceReviewBatch.mockResolvedValue(preview());
  api.getFinanceCategories
    .mockResolvedValueOnce([{ id: "other", name: "Groceries" }])
    .mockRejectedValueOnce(new Error("Offline"));
  mount();
  const refresh = await screen.findByRole("button", {
    name: "Refresh target categories before applying",
  });
  await waitFor(() => expect(refresh).toBeEnabled());
  expect(screen.queryByRole("button", { name: /Approve batch/ })).toBeNull();
  fireEvent.click(refresh);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Could not refresh target categories.", {
      id: "toast",
    }),
  );
  expect(screen.queryByText("Could not refresh target categories.")).toBeNull();
  expect(screen.queryByRole("button", { name: /Approve batch/ })).toBeNull();
  fireEvent.click(refresh);
  expect(await screen.findAllByText("Category: Groceries")).toHaveLength(11);
  expect(screen.getByRole("button", { name: "Approve batch (11)" })).toBeEnabled();
  expect(api.executeFinanceReviewBatch).not.toHaveBeenCalled();
});

it("reconciles uncertain approval before offering a retry and never executes locally", async () => {
  api.getFinanceReviewBatch.mockResolvedValue(preview());
  api.approveFinanceBatchContinuation.mockImplementation(async () => {
    api.getFinanceBatchContinuation.mockResolvedValue({ state: "pending" });
    throw new Error("Response lost");
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Approve batch (11)" }));
  await screen.findByText("Approved · waiting to process");
  expect(toast.error).toHaveBeenCalledWith(
    "Could not confirm the request. Refresh saved progress before retrying.",
    expect.anything(),
  );
  expect(
    screen.queryByText("Could not confirm the request. Refresh saved progress before retrying."),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: /Approve batch/ })).toBeNull();
  expect(api.executeFinanceReviewBatch).not.toHaveBeenCalled();
});
it("blocks approval while saved authority cannot be read", async () => {
  api.getFinanceReviewBatch.mockResolvedValue(preview());
  api.getFinanceBatchContinuation.mockRejectedValue(new Error("Offline"));
  mount();
  await screen.findByRole("button", { name: "Refresh saved approval" });
  expect(screen.queryByRole("button", { name: /Approve batch/ })).toBeNull();
});
it("withholds cached outcomes if the batch is no longer accessible", async () => {
  api.getFinanceReviewBatch.mockRejectedValue(
    new ApiClientError({ code: "forbidden", status: 403, message: "Denied" }),
  );
  mount();
  await screen.findByText("Could not load this review batch.");
  expect(screen.queryByText(/pending ·/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Approve batch/ })).toBeNull();
});

it("prepares a correction for only the selected applied effect", async () => {
  api.getFinanceReviewBatch.mockResolvedValue({
    ...preview(),
    pendingCount: 0,
    outcomes: [{ index: 0, status: "applied" }],
  });
  api.getFinanceBatchContinuation.mockResolvedValue({ state: "completed" });
  api.previewFinanceReviewBatchUndo.mockResolvedValue({ id: "undo" });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Review undo for decision 1" }));
  await waitFor(() =>
    expect(api.previewFinanceReviewBatchUndo).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: "batch", outcomeIndexes: [0] }),
    ),
  );
  expect(api.executeFinanceReviewBatch).not.toHaveBeenCalled();
});
it("shows frozen merchant and dollar amount before approval", async () => {
  api.getFinanceReviewBatch.mockResolvedValue({
    ...preview(),
    transactionSummaries: [
      {
        index: 0,
        merchant: "Neighborhood market",
        amountCents: 7825,
        currencyCode: "USD",
        date: "2026-11-10",
      },
    ],
  });
  mount();
  expect(await screen.findByText("Neighborhood market")).toBeVisible();
  expect(screen.getByText(/\$78\.25/)).toBeVisible();
});
