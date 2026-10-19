// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceOnboardingAdapter, FinanceOnboardingSnapshot } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { financeOnboardingApiAdapter } from "./onboarding-adapter.js";
import { FinanceOnboardingReview, financeOnboardingReviewKey } from "./onboarding-review.js";

const defaultApi = vi.hoisted(() => ({
  getFinanceOnboarding: vi.fn(),
  saveFinanceOnboardingAnswers: vi.fn(),
  completeFinanceOnboarding: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: defaultApi }));
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
async function chooseAutomation(user: ReturnType<typeof userEvent.setup>, value: "later" | "now") {
  const radio = screen.queryByRole("radio", {
    name: value === "later" ? "Use Finance manually" : "Set up with an agent",
  });
  if (radio) await user.click(radio);
  else await user.selectOptions(screen.getByLabelText("Automation"), value);
}
function expectAutomation(value: string) {
  const group = screen.queryByRole("radiogroup", { name: "Initial Finance mode" });
  if (group) {
    if (!value) expect(group.querySelector('[aria-checked="true"]')).toBeNull();
    else
      expect(
        screen.getByRole("radio", {
          name: value === "later" ? "Use Finance manually" : "Set up with an agent",
        }),
      ).toBeChecked();
  } else expect(screen.getByLabelText("Automation")).toHaveValue(value);
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
  await chooseAutomation(user, "later");
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
  expect(
    screen.queryByRole("radiogroup", { name: "Initial Finance mode" }),
  ).not.toBeInTheDocument();
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
  expect(client.getQueryData(financeOnboardingReviewKey(adapter))).toMatchObject({
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
  await chooseAutomation(user, "later");
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
  expectAutomation("later");
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
  await chooseAutomation(user, "later");
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
  expectAutomation("later");
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
  expectAutomation("later");
  expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Finish setup" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload setup review" })).toBeEnabled();
});

it("explicitly reloads saved profile facts and replaces unsaved review choices only after success", async () => {
  const adapter = show();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Income"), "unknown");
  await chooseAutomation(user, "later");
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
  expectAutomation("");
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
  client.setQueryData(financeOnboardingReviewKey(adapter), snapshot());
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

it("offers the initial manual/agent chooser without autosaving its selection", async () => {
  const adapter = show();
  const user = userEvent.setup();
  await screen.findByRole("radiogroup", { name: "Initial Finance mode" });
  await chooseAutomation(user, "later");
  expect(adapter.saveFinanceOnboardingAnswers).not.toHaveBeenCalled();
  expect(adapter.completeFinanceOnboarding).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Initial agent guidance" })).not.toBeInTheDocument();
  await chooseAutomation(user, "now");
  expect(screen.getByRole("region", { name: "Initial agent guidance" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Connect an agent and get host instructions" }),
  ).toHaveAttribute("href", "/finances/automations");
  expect(adapter.saveFinanceOnboardingAnswers).not.toHaveBeenCalled();
});
it("copies initial canonical tool guidance through Sonner with selectable text fallback", async () => {
  const adapter = show();
  const user = userEvent.setup();
  await screen.findByLabelText("Income");
  await chooseAutomation(user, "now");
  const text = screen.getByLabelText("Initial agent instructions");
  expect((text as HTMLTextAreaElement).value).toContain("get_finance_playbook");
  for (const tool of [
    "get_finance_onboarding",
    "save_finance_onboarding_answers",
    "complete_finance_onboarding",
  ])
    expect((text as HTMLTextAreaElement).value).toContain(tool);
  expect((text as HTMLTextAreaElement).value).toContain('setup_finances with operation "start"');
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  toast.loading.mockClear();
  toast.success.mockClear();
  expect(write).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Copy initial instructions" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Initial agent instructions copied", {
      id: "setup-review-toast",
    }),
  );
  expect(toast.loading).toHaveBeenCalledExactlyOnceWith("Copying initial agent instructions…");
  expect(screen.queryByText("Initial agent instructions copied")).not.toBeInTheDocument();
  write.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await user.click(screen.getByRole("button", { name: "Copy initial instructions" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Instructions could not be copied. Select and copy the text below.",
      { id: "setup-review-toast" },
    ),
  );
  expect(
    screen.queryByText("Instructions could not be copied. Select and copy the text below."),
  ).not.toBeInTheDocument();
  expect(text).toHaveAttribute("readonly");
  expect(adapter.saveFinanceOnboardingAnswers).not.toHaveBeenCalled();
});

function defaultReview(owner: string | null = "owner-a") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (owner) client.setQueryData(["me"], { id: owner });
  const view = render(
    <QueryClientProvider client={client}>
      <FinanceOnboardingReview adapter={financeOnboardingApiAdapter} />
    </QueryClientProvider>,
  );
  return { client, view };
}
function ownerB() {
  return { ...snapshot(), source: { ...snapshot().source, summary: "Owner B source" } };
}
it("does not initiate default setup reads without an authenticated owner", async () => {
  defaultReview(null);
  expect(screen.getByRole("heading", { name: "Review your setup" })).toBeVisible();
  expect(defaultApi.getFinanceOnboarding).not.toHaveBeenCalled();
  expect(toast.loading).not.toHaveBeenCalled();
});
it("discards a deferred prior-owner default read and loads the current owner's review", async () => {
  let resolveOld!: (next: FinanceOnboardingSnapshot) => void;
  defaultApi.getFinanceOnboarding
    .mockReturnValueOnce(
      new Promise<FinanceOnboardingSnapshot>((resolve) => {
        resolveOld = resolve;
      }),
    )
    .mockResolvedValue(ownerB());
  const { client } = defaultReview();
  await waitFor(() => expect(defaultApi.getFinanceOnboarding).toHaveBeenCalledTimes(1));
  await act(async () => {
    client.setQueryData(["me"], { id: "owner-b" });
  });
  await screen.findByText("Owner B source");
  vi.clearAllMocks();
  await act(async () =>
    resolveOld({ ...snapshot(), source: { ...snapshot().source, summary: "Owner A secret" } }),
  );
  expect(client.getQueryData(["finance-onboarding", financeOnboardingApiAdapter])).toEqual(
    ownerB(),
  );
  expect(screen.queryByText("Owner A secret")).not.toBeInTheDocument();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.dismiss).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Reload setup review" }));
  await waitFor(() => expect(defaultApi.getFinanceOnboarding).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Owner B source")).toBeVisible();
});
it.each([
  ["save", "resolve"],
  ["save", "reject"],
  ["complete", "resolve"],
  ["complete", "reject"],
] as const)("suppresses a prior-owner default %s %s after account swap", async (operation, outcome) => {
  const initial =
    operation === "complete"
      ? {
          ...snapshot(),
          questions: [],
          displayPreferences: { reviewed: true, summary: [] },
          automationChoice: "later" as const,
        }
      : snapshot();
  defaultApi.getFinanceOnboarding.mockResolvedValueOnce(initial).mockResolvedValue(ownerB());
  let resolveOld!: (next: FinanceOnboardingSnapshot) => void;
  let rejectOld!: (error: Error) => void;
  const pending = new Promise<FinanceOnboardingSnapshot>((resolve, reject) => {
    resolveOld = resolve;
    rejectOld = reject;
  });
  const mutation =
    operation === "save"
      ? defaultApi.saveFinanceOnboardingAnswers
      : defaultApi.completeFinanceOnboarding;
  mutation.mockReturnValue(pending);
  const { client } = defaultReview();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Review your setup" });
  if (operation === "save") {
    await user.selectOptions(await screen.findByLabelText("Income"), "unknown");
    await chooseAutomation(user, "later");
    await user.click(screen.getByRole("button", { name: "Save review" }));
  } else await user.click(await screen.findByRole("button", { name: "Finish setup" }));
  await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
  await act(async () => {
    client.setQueryData(["me"], { id: "owner-b" });
  });
  await screen.findByText("Owner B source");
  vi.clearAllMocks();
  await act(async () => {
    if (outcome === "resolve")
      resolveOld({ ...initial, revision: 99, completedAt: "2026-10-18T12:00:00Z" });
    else rejectOld(new Error("Old owner denied"));
  });
  expect(client.getQueryData(["finance-onboarding", financeOnboardingApiAdapter])).toEqual(
    ownerB(),
  );
  expect(
    screen.queryByText("Setup complete. Your workspace remains available."),
  ).not.toBeInTheDocument();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.dismiss).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Reload setup review" }));
  await waitFor(() => expect(defaultApi.getFinanceOnboarding).toHaveBeenCalledTimes(1));
});

it("rejects the old read epoch even when the same account signs back in", async () => {
  let resolveOld!: (next: FinanceOnboardingSnapshot) => void;
  const current = {
    ...snapshot(),
    source: { ...snapshot().source, summary: "New account session" },
  };
  defaultApi.getFinanceOnboarding
    .mockReturnValueOnce(
      new Promise<FinanceOnboardingSnapshot>((resolve) => {
        resolveOld = resolve;
      }),
    )
    .mockResolvedValue(current);
  const { client } = defaultReview();
  await waitFor(() => expect(defaultApi.getFinanceOnboarding).toHaveBeenCalledTimes(1));
  await act(async () => {
    client.removeQueries({ queryKey: ["me"], exact: true });
    client.setQueryData(["me"], { id: "owner-a" });
  });
  await screen.findByText("New account session");
  vi.clearAllMocks();
  await act(async () => resolveOld({ ...snapshot(), revision: 90 }));
  expect(client.getQueryData(["finance-onboarding", financeOnboardingApiAdapter])).toEqual(current);
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.dismiss).not.toHaveBeenCalled();
});

function denial(status: 401 | 403 | 503) {
  return new ApiClientError({
    status,
    code: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "service_unavailable",
    message: "Private server diagnostic",
  });
}
const privateSnapshot = () => ({
  ...snapshot(),
  source: { ...snapshot().source, summary: "Private owner source" },
});
it.each([
  401, 403,
] as const)("removes cached private source, questions, and dirty draft on default read %s", async (status) => {
  defaultApi.getFinanceOnboarding.mockResolvedValue(privateSnapshot());
  const { client } = defaultReview();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Income"), "unknown");
  await chooseAutomation(user, "later");
  defaultApi.getFinanceOnboarding.mockRejectedValueOnce(denial(status));
  await user.click(screen.getByRole("button", { name: "Reload setup review" }));
  await screen.findByRole("button", { name: "Retry setup review" });
  expect(
    client.getQueryData(financeOnboardingReviewKey(financeOnboardingApiAdapter)),
  ).toBeUndefined();
  expect(screen.queryByText("Private owner source")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Income")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save review" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Finance setup access could not be confirmed/)).not.toBeInTheDocument();
  expect(toast.error).toHaveBeenLastCalledWith(
    "Finance setup access could not be confirmed. Retry to check your access.",
    { id: "setup-review-toast" },
  );
  expect(defaultApi.getFinanceOnboarding).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "Retry setup review" }));
  await screen.findByText("Private owner source");
  expect(screen.getByLabelText("Income")).toHaveValue("unreviewed");
});
it.each([
  ["save", 401],
  ["save", 403],
  ["complete", 401],
  ["complete", 403],
] as const)("unmounts private default review after %s is denied with %s", async (operation, status) => {
  const initial =
    operation === "complete"
      ? {
          ...privateSnapshot(),
          questions: [],
          displayPreferences: { reviewed: true, summary: [] },
          automationChoice: "later" as const,
        }
      : privateSnapshot();
  defaultApi.getFinanceOnboarding.mockResolvedValue(initial);
  const mutation =
    operation === "save"
      ? defaultApi.saveFinanceOnboardingAnswers
      : defaultApi.completeFinanceOnboarding;
  mutation.mockRejectedValueOnce(denial(status));
  const { client } = defaultReview();
  const user = userEvent.setup();
  if (operation === "save") {
    await user.selectOptions(await screen.findByLabelText("Income"), "unknown");
    await chooseAutomation(user, "later");
    await user.click(screen.getByRole("button", { name: "Save review" }));
  } else await user.click(await screen.findByRole("button", { name: "Finish setup" }));
  await screen.findByRole("button", { name: "Retry setup review" });
  expect(
    client.getQueryData(financeOnboardingReviewKey(financeOnboardingApiAdapter)),
  ).toBeUndefined();
  expect(screen.queryByText("Private owner source")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Income")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Finish setup" })).not.toBeInTheDocument();
  expect(toast.error).toHaveBeenLastCalledWith(
    "Finance setup access could not be confirmed. Retry to check your access.",
    { id: "setup-review-toast" },
  );
});
it.each([
  ["save", "resolve"],
  ["save", "reject"],
  ["complete", "resolve"],
  ["complete", "reject"],
] as const)("does not resurrect a pre-denial %s %s after fresh same-owner recovery", async (operation, outcome) => {
  const initial =
    operation === "complete"
      ? {
          ...privateSnapshot(),
          questions: [],
          displayPreferences: { reviewed: true, summary: [] },
          automationChoice: "later" as const,
        }
      : privateSnapshot();
  defaultApi.getFinanceOnboarding.mockResolvedValue(initial);
  let resolveOld!: (value: FinanceOnboardingSnapshot) => void;
  let rejectOld!: (error: Error) => void;
  const held = new Promise<FinanceOnboardingSnapshot>((resolve, reject) => {
    resolveOld = resolve;
    rejectOld = reject;
  });
  const mutation =
    operation === "save"
      ? defaultApi.saveFinanceOnboardingAnswers
      : defaultApi.completeFinanceOnboarding;
  mutation.mockReturnValueOnce(held);
  const { client } = defaultReview();
  const user = userEvent.setup();
  if (operation === "save") {
    await user.selectOptions(await screen.findByLabelText("Income"), "unknown");
    await chooseAutomation(user, "later");
    await user.click(screen.getByRole("button", { name: "Save review" }));
  } else await user.click(await screen.findByRole("button", { name: "Finish setup" }));
  await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
  defaultApi.getFinanceOnboarding.mockRejectedValueOnce(denial(403));
  await act(async () => {
    await client.refetchQueries({
      queryKey: financeOnboardingReviewKey(financeOnboardingApiAdapter),
      exact: true,
    });
  });
  await screen.findByRole("button", { name: "Retry setup review" });
  const recovered = {
    ...snapshot(),
    source: { ...snapshot().source, summary: "Fresh authorized source" },
  };
  defaultApi.getFinanceOnboarding.mockResolvedValue(recovered);
  await user.click(screen.getByRole("button", { name: "Retry setup review" }));
  await screen.findByText("Fresh authorized source");
  vi.clearAllMocks();
  await act(async () => {
    if (outcome === "resolve")
      resolveOld({ ...initial, revision: 99, completedAt: "2026-10-18T12:00:00Z" });
    else rejectOld(denial(401));
  });
  expect(client.getQueryData(financeOnboardingReviewKey(financeOnboardingApiAdapter))).toEqual(
    recovered,
  );
  expect(screen.getByLabelText("Income")).toHaveValue("unreviewed");
  expect(
    screen.queryByText("Setup complete. Your workspace remains available."),
  ).not.toBeInTheDocument();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.dismiss).not.toHaveBeenCalled();
});
it("keeps a private draft after a transient default read failure without pretending it refreshed", async () => {
  defaultApi.getFinanceOnboarding.mockResolvedValue(privateSnapshot());
  const { client } = defaultReview();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Income"), "unknown");
  await chooseAutomation(user, "later");
  defaultApi.getFinanceOnboarding.mockRejectedValueOnce(denial(503));
  await user.click(screen.getByRole("button", { name: "Reload setup review" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Setup review could not reload. Your edits are still here.",
      { id: "setup-review-toast" },
    ),
  );
  expect(screen.getByText("Private owner source")).toBeVisible();
  expect(screen.getByLabelText("Income")).toHaveValue("unknown");
  expect(client.getQueryData(financeOnboardingReviewKey(financeOnboardingApiAdapter))).toEqual(
    privateSnapshot(),
  );
});
it("does not expose the default account cache through an ownerless injected adapter", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(financeOnboardingReviewKey(financeOnboardingApiAdapter), privateSnapshot());
  const adapter = {
    getFinanceOnboarding: vi.fn().mockResolvedValue(snapshot()),
    saveFinanceOnboardingAnswers: vi.fn(),
    completeFinanceOnboarding: vi.fn(),
  };
  render(
    <QueryClientProvider client={client}>
      <FinanceOnboardingReview adapter={adapter} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("Income");
  expect(adapter.getFinanceOnboarding).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Private owner source")).not.toBeInTheDocument();
  expect(client.getQueryData(financeOnboardingReviewKey(financeOnboardingApiAdapter))).toEqual(
    privateSnapshot(),
  );
});

it("ignores an aborted default read denial after a fresh same-owner mount", async () => {
  let rejectOld!: (error: Error) => void;
  const fresh = { ...snapshot(), source: { ...snapshot().source, summary: "Fresh current mount" } };
  defaultApi.getFinanceOnboarding
    .mockReturnValueOnce(
      new Promise<FinanceOnboardingSnapshot>((_resolve, reject) => {
        rejectOld = reject;
      }),
    )
    .mockResolvedValue(fresh);
  const { client, view } = defaultReview();
  await waitFor(() => expect(defaultApi.getFinanceOnboarding).toHaveBeenCalledTimes(1));
  view.unmount();
  render(
    <QueryClientProvider client={client}>
      <FinanceOnboardingReview adapter={financeOnboardingApiAdapter} />
    </QueryClientProvider>,
  );
  await screen.findByText("Fresh current mount");
  vi.clearAllMocks();
  await act(async () => rejectOld(denial(401)));
  expect(screen.getByText("Fresh current mount")).toBeVisible();
  expect(client.getQueryData(financeOnboardingReviewKey(financeOnboardingApiAdapter))).toEqual(
    fresh,
  );
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.dismiss).not.toHaveBeenCalled();
});
