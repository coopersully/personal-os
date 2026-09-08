// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type {
  FinanceBudgetVersion,
  FinanceSetupPayload,
  FinanceToolResult,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { FinanceSetupPage } from "./setup-page.js";

const api = vi.hoisted(() => ({
  setupFinances: vi.fn(),
  getFinanceBudget: vi.fn(),
  getFinanceCategories: vi.fn(),
  maintainFinances: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));
const sessionId = "11111111-1111-4111-8111-111111111111";
const budgetVersionId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const now = "2026-09-03T12:00:00.000Z";
function setupResponse(
  overrides: Partial<FinanceSetupPayload> = {},
): FinanceToolResult<FinanceSetupPayload> {
  const data: FinanceSetupPayload = {
    budgetVersionId: null,
    maintenanceRunId: null,
    question: {
      id: "profile:location",
      prompt: "Where do you live for tax purposes?",
      answerType: "location",
    },
    sessionId,
    stage: "collecting_profile",
    version: 7,
    ...overrides,
  };
  return {
    data,
    changes: [],
    communication: {
      headline: "Your saved financial setup",
      optionalDetails: [],
      requiredDisclosures: [],
      ...(data.question ? { nextQuestion: data.question } : {}),
    },
    outcome:
      data.stage === "settled"
        ? "completed"
        : data.question
          ? "user_input_required"
          : "work_remaining",
    remainingWork: { categories: [], count: data.stage === "settled" ? 0 : 1 },
    schemaVersion: 1,
  };
}
function plan(): FinanceBudgetVersion {
  return {
    id: budgetVersionId,
    planId: budgetVersionId,
    status: "proposed",
    version: 2,
    expectedResources: 5000,
    allocatedTotal: 5000,
    balanceDelta: 0,
    effectiveFrom: "2026-09",
    createdAt: now,
    approvedAt: null,
    rationale: "A balanced starting plan.",
    assumptions: ["Income varies; this is a starting estimate."],
    resources: [{ key: "income", kind: "income", amount: 5000, description: "Monthly take-home" }],
    allocations: [
      { key: "living", kind: "spending", categoryId, amount: 4000 },
      { key: "savings", kind: "savings", amount: 750 },
      { key: "buffer", kind: "buffer", amount: 250 },
    ],
  };
}
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <FinanceSetupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceCategories.mockResolvedValue([{ id: categoryId, name: "Living expenses" }]);
  api.getFinanceBudget.mockResolvedValue({ data: plan() });
  api.setupFinances.mockResolvedValue(setupResponse());
});
it("starts only on request and answers one saved question with the exact session version", async () => {
  const user = userEvent.setup();
  mount();
  expect(api.setupFinances).not.toHaveBeenCalled();
  expect(api.getFinanceBudget).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Start or resume setup" }));
  expect(api.setupFinances).toHaveBeenCalledWith({ operation: "start" });
  await user.type(await screen.findByLabelText("Where do you live for tax purposes?"), "New York");
  api.setupFinances.mockResolvedValue(
    setupResponse({
      question: {
        id: "profile:household_size",
        prompt: "How many people are in your household?",
        answerType: "integer",
      },
      version: 8,
    }),
  );
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(api.setupFinances).toHaveBeenLastCalledWith({
    operation: "answer",
    sessionId,
    questionId: "profile:location",
    expectedVersion: 7,
    answer: "New York",
    idempotencyKey: expect.any(String),
  });
  expect(await screen.findByLabelText("How many people are in your household?")).toHaveValue("");
  expect(screen.queryByLabelText("Where do you live for tax purposes?")).not.toBeInTheDocument();
});
it("keeps interrupted input and resumes a changed session before retrying", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Start or resume setup" }));
  await user.type(
    await screen.findByLabelText("Where do you live for tax purposes?"),
    "California",
  );
  api.setupFinances.mockRejectedValueOnce(
    new Error("Finance setup is at version 8; resume it before continuing."),
  );
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(await screen.findByText(/Finance setup is at version 8/)).toBeInTheDocument();
  expect(screen.getByLabelText("Where do you live for tax purposes?")).toHaveValue("California");
  api.setupFinances.mockResolvedValueOnce(setupResponse({ version: 8 }));
  await user.click(screen.getByRole("button", { name: "Resume saved progress" }));
  await waitFor(() =>
    expect(api.setupFinances).toHaveBeenLastCalledWith({ operation: "resume", sessionId }),
  );
  expect(screen.getByLabelText("Where do you live for tax purposes?")).toHaveValue("California");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(api.setupFinances).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedVersion: 8, answer: "California", operation: "answer" }),
  );
});
it("shows complete allocations and assumptions before approving the displayed budget with the setup version", async () => {
  const user = userEvent.setup();
  api.setupFinances.mockResolvedValueOnce(
    setupResponse({
      budgetVersionId,
      stage: "budget_approval",
      version: 12,
      question: {
        id: "budget:approval",
        prompt: "Approve this starting budget?",
        answerType: "approval",
      },
    }),
  );
  mount();
  await user.click(screen.getByRole("button", { name: "Start or resume setup" }));
  expect(await screen.findByText("Monthly take-home")).toBeInTheDocument();
  expect(await screen.findByText("Living expenses")).toBeInTheDocument();
  expect(screen.getByText("$750.00")).toBeInTheDocument();
  expect(screen.getByText("$250.00")).toBeInTheDocument();
  expect(screen.getByText("Income varies; this is a starting estimate.")).toBeInTheDocument();
  api.setupFinances.mockResolvedValueOnce(
    setupResponse({ budgetVersionId, stage: "initial_maintenance", question: null, version: 13 }),
  );
  await user.click(screen.getByRole("button", { name: "Approve displayed budget" }));
  expect(api.setupFinances).toHaveBeenLastCalledWith({
    approvalSource: "user_instruction",
    budgetVersionId,
    expectedVersion: 12,
    idempotencyKey: expect.any(String),
    operation: "approve_budget",
    sessionId,
  });
  expect(await screen.findByText("Initial maintenance remains")).toBeInTheDocument();
  expect(api.maintainFinances).not.toHaveBeenCalled();
  expect(screen.queryByText("Setup complete")).not.toBeInTheDocument();
});
it("blocks approval when the server's current budget differs from the setup proposal", async () => {
  const user = userEvent.setup();
  api.setupFinances.mockResolvedValue(
    setupResponse({ budgetVersionId, stage: "budget_approval", question: null }),
  );
  api.getFinanceBudget.mockResolvedValue({ data: { ...plan(), id: categoryId } });
  mount();
  await user.click(screen.getByRole("button", { name: "Start or resume setup" }));
  expect(await screen.findByText("Budget version changed")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approve displayed budget" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Open Plan" })).toHaveAttribute("href", "/finances/plan");
});
it("keeps maintenance judgment visibly pending and resumes the same run without fabricating completion", async () => {
  const user = userEvent.setup();
  api.setupFinances.mockResolvedValue(
    setupResponse({ budgetVersionId, stage: "initial_maintenance", question: null }),
  );
  api.maintainFinances.mockResolvedValue({
    data: {
      runId: categoryId,
      version: 3,
      stage: "agent_reasoning",
      reasoningBatch: [{ transactionId: sessionId }],
      reviewQuestion: null,
    },
    communication: { headline: "Reasoning remains.", requiredDisclosures: [] },
    outcome: "work_remaining",
  });
  mount();
  await user.click(screen.getByRole("button", { name: "Start or resume setup" }));
  await user.click(await screen.findByRole("button", { name: "Start initial maintenance" }));
  expect(api.maintainFinances).toHaveBeenCalledWith({
    operation: "start",
    scope: { type: "all_outstanding" },
  });
  expect(await screen.findByText("Transaction judgment required")).toBeInTheDocument();
  expect(screen.queryByText("Setup complete")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Check maintenance progress" }));
  expect(api.maintainFinances).toHaveBeenLastCalledWith({ operation: "resume", runId: categoryId });
});

it("keeps approval disabled until the exact budget has loaded", async () => {
  const user = userEvent.setup();
  let resolve: ((value: { data: FinanceBudgetVersion }) => void) | undefined;
  api.setupFinances.mockResolvedValue(
    setupResponse({ budgetVersionId, stage: "budget_approval", question: null }),
  );
  api.getFinanceBudget.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount();
  await user.click(screen.getByRole("button", { name: "Start or resume setup" }));
  expect(await screen.findByRole("button", { name: "Approve displayed budget" })).toBeDisabled();
  resolve?.({ data: plan() });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Approve displayed budget" })).toBeEnabled(),
  );
});

it("preserves a confirmed failed answer and uses a new attempt key", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Start or resume setup" }));
  await user.type(await screen.findByLabelText("Where do you live for tax purposes?"), "Texas");
  api.setupFinances.mockResolvedValueOnce({
    ...setupResponse(),
    outcome: "failed",
    communication: {
      headline: "Saved profile unavailable",
      optionalDetails: [],
      requiredDisclosures: [],
    },
  });
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(await screen.findByText("Saved profile unavailable")).toBeInTheDocument();
  expect(screen.getByLabelText("Where do you live for tax purposes?")).toHaveValue("Texas");
  const failedInput = api.setupFinances.mock.calls[1]?.[0];
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(api.setupFinances.mock.calls[2]?.[0]).toEqual({
    ...failedInput,
    idempotencyKey: expect.any(String),
  });
  expect(api.setupFinances.mock.calls[2]?.[0].idempotencyKey).not.toBe(failedInput.idempotencyKey);
});

it("renders every resumable setup state and its conservative fallback evidence", async () => {
  const user = userEvent.setup();
  api.setupFinances
    .mockResolvedValueOnce(
      setupResponse({
        question: {
          id: "profile:income",
          prompt: "What is your monthly income?",
          answerType: "currency",
        },
      }),
    )
    .mockRejectedValueOnce(new Error("previously failed; use a new idempotency key"))
    .mockResolvedValueOnce({
      ...setupResponse({
        budgetVersionId,
        maintenanceRunId: categoryId,
        question: null,
        stage: "settled",
      }),
      communication: {
        headline: "Setup needs one review",
        optionalDetails: ["One account still needs attention."],
        requiredDisclosures: [],
      },
      outcome: "work_remaining",
      remainingWork: { categories: ["review"], count: 1 },
    })
    .mockResolvedValueOnce(
      setupResponse({
        budgetVersionId,
        maintenanceRunId: categoryId,
        question: null,
        stage: "initial_maintenance",
      }),
    );
  api.getFinanceBudget.mockResolvedValue({
    data: {
      ...plan(),
      resources: [{ key: "fallback", kind: "income", amount: 5000 }],
      allocations: [
        {
          key: "legacy",
          kind: "spending",
          categoryId: null,
          legacyCategory: "Household",
          amount: 5000,
        },
      ],
    },
  });
  api.maintainFinances
    .mockResolvedValueOnce({
      data: {
        runId: categoryId,
        version: 4,
        stage: "agent_audit",
        reasoningBatch: [],
        reviewQuestion: { id: sessionId },
      },
      communication: {
        headline: "Audit pending",
        optionalDetails: ["One account still needs attention."],
        requiredDisclosures: [{ message: "No changes were applied." }],
      },
      outcome: "work_remaining",
      remainingWork: { categories: ["review"], count: 1 },
    })
    .mockRejectedValueOnce(new Error("Maintenance unavailable"));

  mount();
  await user.click(screen.getByRole("button", { name: "Start or resume setup" }));
  expect(await screen.findByLabelText("What is your monthly income?")).toHaveAttribute(
    "inputmode",
    "decimal",
  );
  await user.type(screen.getByLabelText("What is your monthly income?"), "5000");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  expect(await screen.findByText(/previously failed/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Save answer" }));

  expect(await screen.findByText("Setup progress")).toBeVisible();
  expect(screen.getByText("fallback")).toBeVisible();
  expect(screen.getByText(/spending · Household/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Setup details" }));
  expect(screen.getByText("One account still needs attention.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Resume saved progress" }));
  await user.click(screen.getByRole("button", { name: "Check maintenance progress" }));
  expect(api.maintainFinances).toHaveBeenCalledWith({ operation: "resume", runId: categoryId });
  expect(await screen.findByText("Audit judgment required")).toBeVisible();
  expect(screen.getByRole("link", { name: "Answer in Review" })).toBeVisible();
  expect(screen.getByText("No changes were applied.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Check maintenance progress" }));
  expect(await screen.findByText("Maintenance unavailable")).toBeVisible();
});
