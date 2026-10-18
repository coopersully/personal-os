// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceOnboardingAdapter, FinanceOnboardingSnapshot } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinanceOnboardingReview } from "./onboarding-review.js";

const toast = vi.hoisted(() => ({
  loading: vi.fn(() => "setup-review-toast"),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
beforeEach(() => vi.clearAllMocks());
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
  vi.clearAllMocks();
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
  expect(toast.loading).toHaveBeenCalledWith("Saving setup review…");
  expect(toast.success).toHaveBeenCalledWith("Setup review saved", { id: "setup-review-toast" });
  expect(toast.loading.mock.invocationCallOrder[0]).toBeLessThan(
    toast.success.mock.invocationCallOrder[0] ?? Number.NaN,
  );
  expect(toast.error).not.toHaveBeenCalled();
  expect(screen.queryByText("Saving setup review…")).not.toBeInTheDocument();
  expect(screen.queryByText("Setup review saved")).not.toBeInTheDocument();
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
  expect(toast.loading).toHaveBeenLastCalledWith("Finishing setup…");
  expect(toast.success).toHaveBeenLastCalledWith("Setup complete", { id: "setup-review-toast" });
  expect(screen.queryByText("Finishing setup…")).not.toBeInTheDocument();
  expect(screen.queryByText("Setup complete", { exact: true })).not.toBeInTheDocument();
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
  vi.clearAllMocks();
  await user.selectOptions(screen.getByLabelText("Income"), "unknown");
  await user.selectOptions(screen.getByLabelText("Automation"), "later");
  adapter.saveFinanceOnboardingAnswers.mockRejectedValue(new Error("Revision conflict"));
  await user.click(screen.getByRole("button", { name: "Save review" }));
  await screen.findByRole("button", { name: "Reload setup review" });
  expect(toast.loading).toHaveBeenCalledWith("Saving setup review…");
  expect(toast.error).toHaveBeenCalledWith(
    "Setup outcome unconfirmed. Your edits are still here. Reload the review before trying again.",
    { id: "setup-review-toast" },
  );
  expect(toast.loading.mock.invocationCallOrder[0]).toBeLessThan(
    toast.error.mock.invocationCallOrder[0] ?? Number.NaN,
  );
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.queryByText("Saving setup review…")).not.toBeInTheDocument();
  expect(screen.queryByText(/Setup outcome unconfirmed/)).not.toBeInTheDocument();
  expect(screen.queryByText("Revision conflict")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Income")).toHaveValue("unknown");
  expect(screen.getByLabelText("Automation")).toHaveValue("later");
  expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
  toast.loading.mockClear();
  toast.error.mockClear();
  toast.success.mockClear();
  await user.click(screen.getByRole("button", { name: "Reload setup review" }));
  await waitFor(() => expect(screen.getByLabelText("Income")).toHaveValue("unreviewed"));
  expect(toast.loading).toHaveBeenCalledWith("Reloading setup review…");
  expect(toast.success).toHaveBeenCalledWith("Setup review reloaded", { id: "setup-review-toast" });
  expect(toast.loading.mock.invocationCallOrder[0]).toBeLessThan(
    toast.success.mock.invocationCallOrder[0] ?? Number.NaN,
  );
  expect(toast.error).not.toHaveBeenCalled();
  expect(screen.queryByText("Reloading setup review…")).not.toBeInTheDocument();
  expect(screen.queryByText("Setup review reloaded")).not.toBeInTheDocument();
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
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Setup is still pending", {
      id: "setup-review-toast",
    }),
  );
  expect(adapter.completeFinanceOnboarding).toHaveBeenCalledTimes(1);
  expect(toast.loading).toHaveBeenCalledWith("Finishing setup…");
  expect(toast.loading.mock.invocationCallOrder[0]).toBeLessThan(
    toast.success.mock.invocationCallOrder[0] ?? Number.NaN,
  );
  expect(toast.success).not.toHaveBeenCalledWith("Setup complete", expect.anything());
  expect(toast.error).not.toHaveBeenCalled();
  expect(screen.queryByText("Finishing setup…")).not.toBeInTheDocument();
  expect(screen.queryByText("Setup is still pending")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Finish setup" })).toBeEnabled();
  expect(
    screen.queryByText("Setup complete. Your workspace remains available."),
  ).not.toBeInTheDocument();
});

it("keeps failed explicit reload feedback in Sonner and preserves the locked draft", async () => {
  const user = userEvent.setup();
  const adapter = show();
  await screen.findByLabelText("Income");
  vi.clearAllMocks();
  await user.selectOptions(screen.getByLabelText("Income"), "unknown");
  await user.click(screen.getByRole("checkbox"));
  await user.selectOptions(screen.getByLabelText("Automation"), "later");
  adapter.saveFinanceOnboardingAnswers.mockRejectedValue(new Error("Revision conflict"));
  await user.click(screen.getByRole("button", { name: "Save review" }));
  await screen.findByRole("button", { name: "Reload setup review" });
  toast.loading.mockClear();
  toast.error.mockClear();
  toast.success.mockClear();
  adapter.getFinanceOnboarding.mockRejectedValueOnce(new Error("Offline"));
  await user.click(screen.getByRole("button", { name: "Reload setup review" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Setup review could not reload. Your edits are still here.",
      { id: "setup-review-toast" },
    ),
  );
  expect(toast.loading).toHaveBeenCalledWith("Reloading setup review…");
  expect(toast.loading.mock.invocationCallOrder[0]).toBeLessThan(
    toast.error.mock.invocationCallOrder[0] ?? Number.NaN,
  );
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.queryByText("Reloading setup review…")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Setup review could not reload. Your edits are still here."),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Income")).toHaveValue("unknown");
  expect(screen.getByLabelText("Automation")).toHaveValue("later");
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Finish setup" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload setup review" })).toBeEnabled();
  expect(adapter.saveFinanceOnboardingAnswers).toHaveBeenCalledTimes(1);
  expect(adapter.completeFinanceOnboarding).not.toHaveBeenCalled();
});

it("announces a failed Finish through the same toast and requires reload without false completion", async () => {
  const initial = snapshot();
  initial.questions = [];
  initial.displayPreferences.reviewed = true;
  initial.automationChoice = "later";
  const adapter = show(initial);
  adapter.completeFinanceOnboarding.mockRejectedValue(new Error("Revision conflict"));
  await userEvent.click(await screen.findByRole("button", { name: "Finish setup" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Setup outcome unconfirmed. Your edits are still here. Reload the review before trying again.",
      { id: "setup-review-toast" },
    ),
  );
  expect(toast.loading).toHaveBeenCalledWith("Finishing setup…");
  expect(toast.loading.mock.invocationCallOrder[0]).toBeLessThan(
    toast.error.mock.invocationCallOrder[0] ?? Number.NaN,
  );
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.queryByText("Finishing setup…")).not.toBeInTheDocument();
  expect(screen.queryByText(/Setup outcome unconfirmed/)).not.toBeInTheDocument();
  expect(
    screen.queryByText("Setup complete. Your workspace remains available."),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Automation")).toHaveValue("later");
  expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Finish setup" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload setup review" })).toBeEnabled();
});

it("explicitly reloads saved profile facts and replaces unsaved review choices only after success", async () => {
  const adapter = show();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Income"), "unknown");
  await user.selectOptions(screen.getByLabelText("Automation"), "later");
  expect(screen.getByText(/replaces any unsaved review choices/)).toBeVisible();
  let resolveReload!: (next: FinanceOnboardingSnapshot) => void;
  adapter.getFinanceOnboarding.mockReturnValueOnce(
    new Promise<FinanceOnboardingSnapshot>((resolve) => {
      resolveReload = resolve;
    }),
  );
  await user.click(screen.getByRole("button", { name: "Reload setup review" }));
  expect(screen.getByLabelText("Income")).toHaveValue("unknown");
  expect(screen.getByLabelText("Income")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Finish setup" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload setup review" })).toBeDisabled();
  const refreshed = {
    ...snapshot(),
    questions: snapshot().questions.map((q) => ({
      ...q,
      disposition: "answered" as const,
      answerSummary: "$1,234.56 saved income",
    })),
  };
  await act(async () => resolveReload(refreshed));
  expect(await screen.findByText("$1,234.56 saved income")).toBeVisible();
  expect(screen.getByLabelText("Income")).toHaveValue("answered");
  expect(screen.getByLabelText("Automation")).toHaveValue("");
  expect(adapter.saveFinanceOnboardingAnswers).not.toHaveBeenCalled();
  expect(adapter.completeFinanceOnboarding).not.toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledWith("Setup review reloaded", { id: "setup-review-toast" });
  expect(screen.queryByText("Setup review reloaded")).not.toBeInTheDocument();
});

it("announces initial and retry load failures through one toast lifecycle without inline result copy", async () => {
  const get = vi
    .fn()
    .mockRejectedValueOnce(new Error("Initial transport failure"))
    .mockRejectedValueOnce(new Error("Retry transport failure"))
    .mockResolvedValueOnce(snapshot());
  const adapter = {
    getFinanceOnboarding: get,
    saveFinanceOnboardingAnswers: vi.fn(),
    completeFinanceOnboarding: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FinanceOnboardingReview adapter={adapter} />
    </QueryClientProvider>,
  );
  const retry = await screen.findByRole("button", { name: "Retry setup review" });
  expect(toast.loading).toHaveBeenCalledExactlyOnceWith("Loading setup review…");
  expect(toast.error).toHaveBeenCalledExactlyOnceWith("Setup review could not load. Try again.", {
    id: "setup-review-toast",
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/Setup review could not load/)).not.toBeInTheDocument();
  expect(screen.queryByText("Loading setup review…")).not.toBeInTheDocument();
  expect(screen.queryByText(/transport failure/)).not.toBeInTheDocument();
  await userEvent.click(retry);
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
  expect(toast.loading).toHaveBeenCalledTimes(2);
  expect(toast.error).toHaveBeenLastCalledWith("Setup review could not load. Try again.", {
    id: "setup-review-toast",
  });
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.dismiss).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Retry setup review" }));
  await screen.findByLabelText("Income");
  expect(toast.loading).toHaveBeenCalledTimes(3);
  expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith("setup-review-toast");
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenCalledTimes(3);
  expect(screen.queryByText(/Setup review could not load/)).not.toBeInTheDocument();
});

it("does not replay load feedback when mounting cached setup state", async () => {
  const adapter = {
    getFinanceOnboarding: vi.fn(),
    saveFinanceOnboardingAnswers: vi.fn(),
    completeFinanceOnboarding: vi.fn(),
  };
  const client = new QueryClient();
  client.setQueryData(["finance-onboarding", adapter], snapshot());
  render(
    <QueryClientProvider client={client}>
      <FinanceOnboardingReview adapter={adapter} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("Income");
  expect(adapter.getFinanceOnboarding).not.toHaveBeenCalled();
  expect(toast.loading).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.dismiss).not.toHaveBeenCalled();
});

it.each([
  "resolve",
  "reject",
] as const)("dismisses a held load immediately on unmount and suppresses its later %s outcome", async (outcome) => {
  let resolveLoad!: (next: FinanceOnboardingSnapshot) => void;
  let rejectLoad!: (error: Error) => void;
  const held = new Promise<FinanceOnboardingSnapshot>((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });
  const adapter = {
    getFinanceOnboarding: vi.fn().mockReturnValue(held),
    saveFinanceOnboardingAnswers: vi.fn(),
    completeFinanceOnboarding: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <FinanceOnboardingReview adapter={adapter} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(toast.loading).toHaveBeenCalledExactlyOnceWith("Loading setup review…"),
  );
  view.unmount();
  expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith("setup-review-toast");
  await act(async () => {
    if (outcome === "resolve") resolveLoad(snapshot());
    else rejectLoad(new Error("Late failed request"));
  });
  expect(toast.dismiss).toHaveBeenCalledTimes(1);
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});
