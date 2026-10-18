// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceOnboardingAdapter, FinanceOnboardingSnapshot } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinanceOnboardingReview } from "./onboarding-review.js";

vi.mock("sonner", () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() } }));
function snapshot(): FinanceOnboardingSnapshot {
  return {
    revision: 1,
    completedAt: null,
    existingAccess: false,
    source: {
      state: "syncing",
      summary: "Account connected; records are syncing.",
      recoveryHref: null,
    },
    contextReview: "reviewed",
    questions: [
      {
        questionId: "income",
        label: "Income",
        disposition: "unreviewed",
        answerSummary: null,
        allowsNone: false,
      },
    ],
    displayPreferences: { reviewed: false, summary: ["Personal cost, current month"] },
    automationChoice: null,
    manualVisibility: "auto",
    automation: {
      registrationCount: 0,
      authorizedRegistrationWithCadence: false,
      chatVerification: "pending",
      canSendChat: false,
      historyAvailable: true,
    },
  };
}
function show(
  initial = snapshot(),
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  const adapter = {
    getFinanceOnboarding: vi.fn().mockResolvedValue(initial),
    saveFinanceOnboardingAnswers: vi.fn(),
    completeFinanceOnboarding: vi.fn(),
  } satisfies FinanceOnboardingAdapter;
  render(
    <QueryClientProvider client={client}>
      <FinanceOnboardingReview adapter={adapter} />
    </QueryClientProvider>,
  );
  return adapter;
}
it("saves explicit unknown and manual later before durable completion", async () => {
  const user = userEvent.setup();
  const client = new QueryClient();
  const adapter = show(snapshot(), client);
  await screen.findByLabelText("Income");
  expect(screen.queryByRole("option", { name: /^None$/ })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Income"), "unknown");
  await user.click(screen.getByRole("checkbox"));
  await user.selectOptions(screen.getByLabelText("Automation"), "later");
  const saved = {
    ...snapshot(),
    revision: 2,
    questions: snapshot().questions.map((question) => ({
      ...question,
      disposition: "unknown" as const,
    })),
    displayPreferences: { reviewed: true, summary: [] },
    automationChoice: "later" as const,
  };
  adapter.saveFinanceOnboardingAnswers.mockResolvedValue(saved);
  expect(screen.getByRole("button", { name: "Finish setup" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Save review" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Finish setup" })).toBeEnabled());
  expect(adapter.saveFinanceOnboardingAnswers).toHaveBeenCalledWith({
    expectedRevision: 1,
    idempotencyKey: expect.any(String),
    answers: [{ questionId: "income", disposition: "unknown" }],
    displayPreferencesReviewed: true,
    automationChoice: "later",
  });
  expect(screen.queryByText(/Setup complete\./)).not.toBeInTheDocument();
  adapter.completeFinanceOnboarding.mockResolvedValue({
    ...saved,
    revision: 3,
    completedAt: "2026-10-18T12:00:00Z",
  });
  await user.click(screen.getByRole("button", { name: "Finish setup" }));
  await screen.findByText("Setup complete. Your workspace remains available.");
  expect(client.getQueryData(["finance-onboarding", adapter])).toMatchObject({
    revision: 3,
    completedAt: "2026-10-18T12:00:00Z",
  });
  expect(adapter.completeFinanceOnboarding).toHaveBeenCalledWith({
    expectedRevision: 2,
    idempotencyKey: expect.any(String),
    automationChoice: "later",
  });
  expect(
    screen.getByText(/Chat sending will be available after agent verification/),
  ).toHaveTextContent("Your existing Chat history remains available.");
});
it("retains edits after a conflict and requires explicit reload before another write", async () => {
  const user = userEvent.setup();
  const adapter = show();
  await screen.findByLabelText("Income");
  await user.selectOptions(screen.getByLabelText("Income"), "unknown");
  await user.selectOptions(screen.getByLabelText("Automation"), "later");
  adapter.saveFinanceOnboardingAnswers.mockRejectedValue(new Error("Revision conflict"));
  await user.click(screen.getByRole("button", { name: "Save review" }));
  await screen.findByRole("button", { name: "Reload setup review" });
  expect(screen.getByLabelText("Income")).toHaveValue("unknown");
  expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Reload setup review" }));
  await waitFor(() => expect(screen.getByLabelText("Income")).toHaveValue("unreviewed"));
  expect(adapter.saveFinanceOnboardingAnswers).toHaveBeenCalledTimes(1);
});
it("keeps completed setup available during provider failure without presenting completion again", async () => {
  show({
    ...snapshot(),
    completedAt: "2026-10-18T12:00:00Z",
    source: { state: "unavailable", summary: "Records unavailable", recoveryHref: null },
  });
  await screen.findByText("Setup complete. Your workspace remains available.");
  expect(screen.queryByRole("button", { name: "Finish setup" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Automation")).toBeDisabled();
});
it("does not call pending completion confirmed", async () => {
  const initial = snapshot();
  initial.questions = [];
  initial.displayPreferences.reviewed = true;
  initial.automationChoice = "now";
  initial.automation.registrationCount = 1;
  initial.automation.authorizedRegistrationWithCadence = true;
  const adapter = show(initial);
  adapter.completeFinanceOnboarding.mockResolvedValue({ ...initial, revision: 2 });
  await userEvent.click(await screen.findByRole("button", { name: "Finish setup" }));
  await waitFor(() => expect(adapter.completeFinanceOnboarding).toHaveBeenCalledTimes(1));
  expect(
    screen.queryByText("Setup complete. Your workspace remains available."),
  ).not.toBeInTheDocument();
});
