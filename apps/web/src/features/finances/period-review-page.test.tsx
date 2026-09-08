// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinancePeriodReview } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinancePeriodReviewPage } from "./period-review-page.js";

const api = vi.hoisted(() => ({
  getFinancePeriodReview: vi.fn(),
  maintainFinances: vi.fn(),
  startFinanceMaintenance: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));
const reviewId = "00000000-0000-4000-8000-000000000001";
const review: FinancePeriodReview = {
  id: reviewId,
  userId: "00000000-0000-4000-8000-000000000002",
  runId: "00000000-0000-4000-8000-000000000003",
  createdAt: "2026-09-02T12:00:00.000Z",
  cutoff: "2026-09-01T12:00:00.000Z",
  period: { start: "2026-08-01", end: "2026-08-31" },
  status: "completed_with_questions",
  challenge: { checked: [], findings: 2, observations: 1 },
  closeReadiness: {
    missingProvenance: 1,
    possibleDuplicates: 4,
    ready: false,
    reconciledThrough: null,
    unansweredExceptions: 3,
    uncategorized: 2,
    unmatchedTransfers: 5,
  },
  goalsAndDebt: { activeGoals: 1, debt: null, netWorth: null },
  income: null,
  monitoring: {
    href: "/finances/review",
    responsibility: "Review the remaining transfer evidence before closing August.",
  },
  position: { opening: null, closing: null, cashLowPoint: null },
  recommendations: [
    {
      recommendation: "Confirm the shared-account transfer",
      assumptions: ["Ownership is still being confirmed."],
      disposition: "needs_input",
      evidence: ["The August statement includes two matching transfers."],
      tradeoffs: ["Waiting preserves the original recorded balances."],
    },
  ],
  reimbursements: {
    anomalies: 0,
    expected: 0,
    needsInput: 0,
    open: 0,
    overdue: 0,
    outstanding: 0,
    received: 0,
    unresolved: 0,
    unmatchedCredits: 0,
  },
  sourceIds: [],
  spending: { budgetVariance: null, gross: 0, personal: 0, savings: null },
  work: { approvals: 1, exceptions: 3, questions: 2, rulesAndActions: 1 },
};

function mount(id = reviewId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FinancePeriodReviewPage id={id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinancePeriodReview.mockResolvedValue(review);
});
afterEach(cleanup);

describe("Saved Finance period review", () => {
  it("loads the exact requested review and distinguishes unavailable historical amounts from a recorded zero", async () => {
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Loading financial review");
    expect(await screen.findByText("2026-08-01 – 2026-08-31")).toBeVisible();
    expect(api.getFinancePeriodReview).toHaveBeenCalledExactlyOnceWith(reviewId);
    for (const label of [
      "Income",
      "Savings",
      "Opening position",
      "Closing position",
      "Cash low point",
    ]) {
      const metric = screen.getByText(label).closest("div");
      expect(metric).not.toBeNull();
      expect(within(metric as HTMLElement).getByText("Unavailable")).toBeVisible();
      expect(within(metric as HTMLElement).queryByText("$0.00")).not.toBeInTheDocument();
    }
    expect(screen.getByText("Personal spending").closest("div")).toHaveTextContent("$0.00");
  });

  it("shows the recorded cutoff, outstanding questions, evidence, and follow-up without starting maintenance", async () => {
    mount();
    expect(await screen.findByText("Completed with questions")).toBeVisible();
    expect(screen.getByText(/Evidence through/)).toHaveTextContent(
      /Recorded .*Sep 2, 2026.*Evidence through .*Sep 1, 2026/,
    );
    expect(screen.getByText("Confirm the shared-account transfer")).toBeVisible();
    expect(screen.getByText("needs input")).toBeVisible();
    expect(
      screen.getByText(/Evidence: The August statement includes two matching transfers/),
    ).toBeVisible();
    expect(screen.getByText(/Assumptions: Ownership is still being confirmed/)).toBeVisible();
    expect(
      screen.getByText(/Tradeoffs: Waiting preserves the original recorded balances/),
    ).toBeVisible();
    expect(
      screen.getByText(
        /2 questions · 3 exceptions · 5 unmatched transfers · 4 possible duplicates/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText("This review still had unresolved evidence at its cutoff."),
    ).toBeVisible();
    expect(screen.getByText(review.monitoring.responsibility)).toBeVisible();
    expect(
      screen.getByText(/Viewing it does not schedule or run financial maintenance/),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Open current review inbox" })).toHaveAttribute(
      "href",
      "/finances/review",
    );
    expect(api.maintainFinances).not.toHaveBeenCalled();
    expect(api.startFinanceMaintenance).not.toHaveBeenCalled();
  });

  it("shows a completed review's recorded empty recommendations and closed evidence", async () => {
    api.getFinancePeriodReview.mockResolvedValue({
      ...review,
      status: "completed",
      recommendations: [],
      closeReadiness: { ...review.closeReadiness, ready: true },
    });
    mount();
    expect(await screen.findByText("Completed")).toBeVisible();
    expect(screen.getByText("No recommendations recorded for this review.")).toBeVisible();
    expect(
      screen.getByText("The recorded evidence was ready to close at the review cutoff."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to overview" })).toHaveAttribute(
      "href",
      "/finances",
    );
  });

  it("retries the same historical review after a failed read", async () => {
    api.getFinancePeriodReview.mockRejectedValueOnce(
      new Error("Historical review is temporarily unavailable"),
    );
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Historical review is temporarily unavailable",
    );
    expect(screen.queryByText("2026-08-01 – 2026-08-31")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("2026-08-01 – 2026-08-31")).toBeVisible();
    await waitFor(() => expect(api.getFinancePeriodReview).toHaveBeenCalledTimes(2));
    expect(api.getFinancePeriodReview.mock.calls).toEqual([[reviewId], [reviewId]]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
