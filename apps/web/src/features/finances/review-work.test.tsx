// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { FinanceReimbursementList } from "./reimbursement-list.js";
import { FinanceAgentReviewQueue } from "./review-queue.js";

const {
  answerFinanceQuestion,
  approveFinanceActionReview,
  dismissFinanceActionReview,
  listFinanceActionReviews,
  listFinanceQuestions,
  listFinanceReimbursements,
} = vi.hoisted(() => ({
  answerFinanceQuestion: vi.fn(),
  approveFinanceActionReview: vi.fn(),
  dismissFinanceActionReview: vi.fn(),
  listFinanceActionReviews: vi.fn(),
  listFinanceQuestions: vi.fn(),
  listFinanceReimbursements: vi.fn(),
}));

vi.mock("../../api.js", () => ({
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
  api: {
    answerFinanceQuestion,
    approveFinanceActionReview,
    dismissFinanceActionReview,
    listFinanceActionReviews,
    listFinanceQuestions,
    listFinanceReimbursements,
  },
}));

const id = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-22T12:00:00.000Z";

function renderWithQueryClient(component: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  answerFinanceQuestion.mockResolvedValue({});
  approveFinanceActionReview.mockResolvedValue({});
  dismissFinanceActionReview.mockResolvedValue({});
});

it("shows, answers, and approves the complete Finance review queue", async () => {
  listFinanceQuestions.mockResolvedValue([
    {
      actionKind: "maintenance_turn",
      choices: [
        { label: "Work dinner", value: "work" },
        { label: "Personal", value: "personal" },
      ],
      expectedAnswer: [],
      id,
      prompt: "Was this dinner reimbursable?",
      sourceRefs: [{ id: secondId, type: "finance_transaction" }],
      why: "The amount is unusual for this merchant.",
    },
    {
      actionKind: "set_finance_profile",
      choices: [],
      expectedAnswer: [],
      id: secondId,
      prompt: "What is your monthly rent?",
      sourceRefs: [],
      why: "It makes your monthly plan more accurate.",
    },
  ]);
  listFinanceActionReviews.mockResolvedValue([
    {
      actionKind: "maintenance_turn",
      assumptions: ["The linked credit is a reimbursement."],
      changes: [
        { entityId: id, entityType: "finance_transaction", summary: "Mark as reimbursable" },
        { entityId: null, entityType: "finance_reimbursement", summary: "Track expected credit" },
      ],
      expectedRevision: null,
      fingerprint: "sha256:review",
      id: "33333333-3333-4333-8333-333333333333",
      rationale: "The ledger evidence supports this change.",
      requestedAt: now,
      requestingAgentId: "connected-agent",
      runId: null,
      sourceRefs: [],
      status: "pending",
    },
    { id: "44444444-4444-4444-8444-444444444444", status: "applied" },
  ]);

  renderWithQueryClient(<FinanceAgentReviewQueue />);
  const browser = userEvent.setup();
  expect(await screen.findByText("Was this dinner reimbursable?")).toBeInTheDocument();
  expect(screen.getByText("Based on 1 ledger source record.")).toBeInTheDocument();
  await browser.click(screen.getByRole("button", { name: "Work dinner" }));
  await waitFor(() => expect(answerFinanceQuestion).toHaveBeenCalledWith(id, "work"));

  const answer = screen.getByRole("textbox", { name: "Your answer" });
  await browser.type(answer, "1500");
  await browser.click(screen.getByRole("button", { name: "Answer" }));
  await waitFor(() => expect(answerFinanceQuestion).toHaveBeenCalledWith(secondId, "1500"));

  await browser.click(screen.getByRole("button", { name: "See evidence and changes" }));
  expect(screen.getByText("Mark as reimbursable")).toBeInTheDocument();
  expect(screen.getByText(/Assumptions:/)).toBeInTheDocument();
  await browser.click(screen.getByRole("button", { name: "Approve" }));
  await browser.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() =>
    expect(approveFinanceActionReview.mock.calls[0]?.[0]).toBe(
      "33333333-3333-4333-8333-333333333333",
    ),
  );
  expect(dismissFinanceActionReview.mock.calls[0]?.[0]).toBe(
    "33333333-3333-4333-8333-333333333333",
  );
});

it("makes empty and failed review work explicit", async () => {
  listFinanceQuestions.mockRejectedValue(new Error("Questions are unavailable"));
  listFinanceActionReviews.mockResolvedValue([]);
  renderWithQueryClient(<FinanceAgentReviewQueue />);
  expect(await screen.findByText("Questions are unavailable")).toBeInTheDocument();

  listFinanceQuestions.mockResolvedValue([]);
  listFinanceActionReviews.mockResolvedValue([]);
  renderWithQueryClient(<FinanceAgentReviewQueue />);
  expect(await screen.findByText("Nothing needs review")).toBeInTheDocument();
});

it("uses plural evidence and singular non-maintenance review copy", async () => {
  listFinanceQuestions.mockResolvedValue([
    {
      actionKind: "categorization",
      choices: [{ label: "Dining", value: "dining" }],
      expectedAnswer: [],
      id,
      prompt: "Choose a category",
      sourceRefs: [
        { id, type: "finance_transaction" },
        { id: secondId, type: "finance_transaction" },
      ],
      why: "The merchant is ambiguous.",
    },
  ]);
  listFinanceActionReviews.mockResolvedValue([
    {
      actionKind: "categorization",
      assumptions: [],
      changes: [{ entityId: id, entityType: "finance_transaction", summary: "Set Dining" }],
      expectedRevision: null,
      fingerprint: "sha256:single-review",
      id: secondId,
      rationale: "Confirmed by the user.",
      requestedAt: now,
      requestingAgentId: "connected-agent",
      runId: null,
      sourceRefs: [],
      status: "pending",
    },
  ]);

  renderWithQueryClient(<FinanceAgentReviewQueue />);
  expect(await screen.findByText("Based on 2 ledger source records.")).toBeInTheDocument();
  expect(screen.getByText("1 proposed change · prepared by connected-agent")).toBeInTheDocument();
  expect(screen.getByText("Review Categorization")).toBeInTheDocument();
});

it("presents reimbursement states, amounts, and empty or failed results", async () => {
  listFinanceReimbursements.mockResolvedValue({
    reimbursements: [
      {
        allocationId: id,
        cancelledAt: null,
        cancelledEvidence: null,
        cancelledRationale: null,
        createdAt: now,
        dueDate: "2026-08-25",
        evidence: { sourceRefs: [{ id, type: "finance_transaction" }], summary: "Dinner receipt" },
        expectedAmount: 120,
        id,
        matches: [{ id, creditTransactionId: secondId }],
        payer: "Casey",
        rationale: "Shared dinner",
        receivedAmount: 40,
        revision: 1,
        status: "overdue",
        updatedAt: now,
      },
      {
        allocationId: secondId,
        cancelledAt: now,
        cancelledEvidence: null,
        cancelledRationale: "No longer expected",
        createdAt: now,
        dueDate: null,
        evidence: { sourceRefs: [{ id, type: "finance_transaction" }], summary: "Receipt" },
        expectedAmount: 25,
        id: "33333333-3333-4333-8333-333333333333",
        matches: [],
        payer: null,
        rationale: "Cancelled request",
        receivedAmount: 0,
        revision: 2,
        status: "cancelled",
        updatedAt: now,
      },
    ],
    unmatchedCredits: [],
  });
  renderWithQueryClient(<FinanceReimbursementList />);
  expect(await screen.findByText("Overdue")).toBeInTheDocument();
  expect(screen.getByText("Recently resolved")).toBeInTheDocument();
  expect(screen.getByText(/\$40.00 received of \$120.00/)).toBeInTheDocument();
  expect(screen.getByText("Payer not set")).toBeInTheDocument();
  expect(screen.getByLabelText("Reimbursement from Casey")).toHaveAttribute(
    "aria-valuenow",
    "33.33333333333333",
  );

  listFinanceReimbursements.mockResolvedValue({ reimbursements: [], unmatchedCredits: [] });
  renderWithQueryClient(<FinanceReimbursementList />);
  expect(await screen.findByText("No reimbursements outstanding")).toBeInTheDocument();

  listFinanceReimbursements.mockRejectedValue(new Error("Reimbursements are unavailable"));
  renderWithQueryClient(<FinanceReimbursementList />);
  expect(await screen.findByText("Reimbursements are unavailable")).toBeInTheDocument();
});
