// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FinanceConversationCorrection } from "./conversation-correction";

const api = vi.hoisted(() => ({
  getFinanceReviewBatchUndo: vi.fn(),
  getFinanceReviewBatch: vi.fn(),
  executeFinanceReviewBatchUndo: vi.fn(),
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
it("requires an exact correction and exposes preserved later-edit conflicts", async () => {
  const correction = {
    id: "undo",
    batchId: "batch",
    fingerprint: "exact",
    pendingCount: 1,
    outcomeIndexes: [0],
    outcomes: [],
  };
  api.getFinanceReviewBatchUndo.mockResolvedValue(correction);
  api.getFinanceReviewBatch.mockResolvedValue({
    decisions: [{ transactionId: "t1", rationale: "Grocery purchase" }],
  });
  api.executeFinanceReviewBatchUndo.mockImplementation(async () => {
    const result = {
      ...correction,
      pendingCount: 0,
      status: "completed_with_exceptions",
      outcomes: [{ index: 0, status: "failed", error: { message: "Later edit preserved" } }],
    };
    api.getFinanceReviewBatchUndo.mockResolvedValue(result);
    return result;
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <FinanceConversationCorrection id="undo" sessionKey="owner" isCurrent={() => true} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const button = await screen.findByRole("button", { name: "Confirm undo (1)" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByText("Later edit preserved");
  expect(api.executeFinanceReviewBatchUndo).toHaveBeenCalledWith("undo", {
    fingerprint: "exact",
    limit: 10,
  });
  expect(toast.info).toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute(
    "href",
    "/finances/transactions?transactionId=t1",
  );
});
