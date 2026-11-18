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
  api.getFinanceCategories.mockResolvedValue([{ id: "category", name: "Groceries" }]);
});
it("executes the reviewed manifest in bounded chunks and reads each committed result", async () => {
  const original = preview();
  let saved = original;
  api.getFinanceReviewBatch.mockImplementation(async () => saved);
  api.executeFinanceReviewBatch.mockImplementation(async () => {
    const start = saved.outcomes.length;
    const outcomes = [
      ...saved.outcomes,
      ...saved.decisions.slice(start, start + 10).map((item, index) => ({
        index: start + index,
        transactionId: item.transactionId,
        status: "applied" as const,
        error: null,
        recovery: "none" as const,
        completedAt: at,
      })),
    ];
    saved = {
      ...saved,
      outcomes,
      pendingCount: saved.decisions.length - outcomes.length,
      status: outcomes.length === saved.decisions.length ? "completed" : "in_progress",
    };
    return saved;
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Apply reviewed batch (11)" }));
  await screen.findByText("0 pending · 11 applied");
  expect(api.executeFinanceReviewBatch).toHaveBeenCalledTimes(2);
  for (const [id, input, signal] of api.executeFinanceReviewBatch.mock.calls) {
    expect([id, input]).toEqual([original.id, { fingerprint: original.fingerprint, limit: 10 }]);
    expect(signal).toBeInstanceOf(AbortSignal);
  }
  expect(api.getFinanceReviewBatch.mock.invocationCallOrder[1]).toBeLessThan(
    api.executeFinanceReviewBatch.mock.invocationCallOrder[1] ?? 0,
  );
});
it("stops on a saved exception and displays remaining decisions for explicit recovery", async () => {
  const original = preview();
  const saved = {
    ...original,
    status: "in_progress",
    pendingCount: 10,
    outcomes: [
      {
        index: 0,
        transactionId: "transaction-0",
        status: "failed",
        error: { code: "conflict", message: "Source changed" },
        recovery: "new_preview",
        completedAt: at,
      },
    ],
  };
  api.getFinanceReviewBatch.mockResolvedValueOnce(original).mockResolvedValue(saved);
  api.executeFinanceReviewBatch.mockResolvedValue(saved);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Apply reviewed batch (11)" }));
  await screen.findByText("Source changed");
  expect(api.executeFinanceReviewBatch).toHaveBeenCalledTimes(1);
  expect(toast.info).toHaveBeenCalled();
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
  expect(screen.queryByRole("button", { name: /Apply reviewed batch/ })).toBeNull();
  view.unmount();
  mount();
  expect(await screen.findByRole("link", { name: "View other transfer leg" })).toHaveAttribute(
    "href",
    "/finances/transactions?transactionId=counterpart",
  );
  expect(screen.getByRole("button", { name: "Apply reviewed batch (1)" })).toBeEnabled();
});
it("aborts the current request on cancel and never submits the next chunk", async () => {
  api.getFinanceReviewBatch.mockResolvedValue(preview());
  api.executeFinanceReviewBatch.mockImplementation(
    (_id, _input, signal: AbortSignal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
      ),
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Apply reviewed batch (11)" }));
  fireEvent.click(await screen.findByRole("button", { name: "Stop applying" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Stop applying" })).toBeNull());
  expect(api.executeFinanceReviewBatch).toHaveBeenCalledTimes(1);
  expect(toast.error).not.toHaveBeenCalled();
});

it("retains an earlier exception when the remaining reviewed decisions apply", async () => {
  const original = preview();
  const failed = {
    index: 0,
    transactionId: "transaction-0",
    status: "failed",
    error: { code: "conflict", message: "Earlier evidence changed" },
    recovery: "new_preview",
    completedAt: at,
  };
  const resumed = { ...original, status: "in_progress", pendingCount: 10, outcomes: [failed] };
  const finished = {
    ...resumed,
    status: "completed_with_exceptions",
    pendingCount: 0,
    outcomes: [
      failed,
      ...original.decisions.slice(1).map((item, index) => ({
        index: index + 1,
        transactionId: item.transactionId,
        status: "applied",
        error: null,
        recovery: "none",
        completedAt: at,
      })),
    ],
  };
  api.getFinanceReviewBatch.mockResolvedValueOnce(resumed).mockResolvedValue(finished);
  api.executeFinanceReviewBatch.mockResolvedValue(finished);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Apply reviewed batch (10)" }));
  await screen.findByText("0 pending · 10 applied");
  expect(screen.getByText("Earlier evidence changed")).toBeVisible();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.info).toHaveBeenCalledWith(
    "Some decisions need review. Check the saved outcomes.",
    expect.anything(),
  );
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
  expect(screen.queryByRole("button", { name: /Apply reviewed batch/ })).toBeNull();
  fireEvent.click(refresh);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Could not refresh target categories.", {
      id: "toast",
    }),
  );
  expect(screen.queryByText("Could not refresh target categories.")).toBeNull();
  expect(screen.queryByRole("button", { name: /Apply reviewed batch/ })).toBeNull();
  fireEvent.click(refresh);
  expect(await screen.findAllByText("Category: Groceries")).toHaveLength(11);
  expect(screen.getByRole("button", { name: "Apply reviewed batch (11)" })).toBeEnabled();
  expect(api.executeFinanceReviewBatch).not.toHaveBeenCalled();
});

it("keeps the confirmed execute receipt when the following and final reads fail", async () => {
  const original = preview();
  const saved = {
    ...original,
    pendingCount: 10,
    outcomes: [{ index: 0, status: "applied" }],
  };
  api.getFinanceReviewBatch.mockResolvedValueOnce(original).mockRejectedValue(new Error("Offline"));
  api.executeFinanceReviewBatch.mockResolvedValue(saved);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Apply reviewed batch (11)" }));
  expect(await screen.findByText("10 pending · 1 applied")).toBeVisible();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Could not finish checking the batch. Refresh saved progress before retrying.",
      { id: "toast" },
    ),
  );
  expect(
    screen.queryByText(
      "Could not finish checking the batch. Refresh saved progress before retrying.",
    ),
  ).toBeNull();
  expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  expect(api.executeFinanceReviewBatch).toHaveBeenCalledOnce();
});

it("withholds cached outcomes if the current batch is no longer accessible", async () => {
  const original = preview();
  const receipt = { ...original, pendingCount: 10, outcomes: [{ index: 0, status: "applied" }] };
  api.getFinanceReviewBatch
    .mockResolvedValueOnce(original)
    .mockRejectedValue(new ApiClientError({ code: "forbidden", status: 403, message: "Denied" }));
  api.executeFinanceReviewBatch.mockResolvedValue(receipt);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Apply reviewed batch (11)" }));
  await screen.findByText("Could not load this review batch.");
  expect(screen.queryByText(/pending ·/)).toBeNull();
  expect(screen.queryByText("Category: Groceries")).toBeNull();
  expect(screen.queryByRole("button", { name: /Apply reviewed batch/ })).toBeNull();
});
