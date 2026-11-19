// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceOnboardingSnapshot } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceSetupScreen, FinishFinanceSetup } from "./setup";

vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner-a",
  timezone: "America/New_York" as string | undefined,
  params: {} as Record<string, string>,
  push: vi.fn(),
  navigate: vi.fn(),
  replace: vi.fn(),
  setParams: vi.fn(),
  back: vi.fn(),
  alert: vi.fn(),
  platform: "ios",
  screen: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "feedback"),
  api: {
    getFinanceOnboarding: vi.fn(),
    saveFinanceOnboardingAnswers: vi.fn(),
    completeFinanceOnboarding: vi.fn(),
    setupFinances: vi.fn(),
    maintainFinances: vi.fn(),
    getFinanceMaintenanceHistory: vi.fn(),
    getFinanceBudget: vi.fn(),
  },
}));
vi.mock("react-native", () => {
  const Box = ({
    children,
    testID,
    accessibilityLabel,
  }: PropsWithChildren<{ testID?: string; accessibilityLabel?: string }>) => (
    <div data-testid={testID} title={accessibilityLabel}>
      {children}
    </div>
  );
  return {
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
    Keyboard: { addListener: () => ({ remove: vi.fn() }) },
    useWindowDimensions: () => ({ height: 852, width: 393 }),
    Image: () => null,
    View: Box,
    ScrollView: Box,
    Text: Box,
    Modal: ({ children, visible }: PropsWithChildren<{ visible?: boolean }>) =>
      visible ? <div role="dialog">{children}</div> : null,
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
    Alert: { alert: h.alert },
    Platform: {
      get OS() {
        return h.platform;
      },
    },
    useColorScheme: () => "light",
    Switch: ({
      accessibilityLabel,
      value,
      onValueChange,
      disabled,
    }: {
      accessibilityLabel?: string;
      value: boolean;
      onValueChange: (value: boolean) => void;
      disabled?: boolean;
    }) => (
      <input
        type="checkbox"
        aria-label={accessibilityLabel}
        checked={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.checked)}
      />
    ),
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityState,
    }: PropsWithChildren<{
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityState?: { selected?: boolean; checked?: boolean };
    }>) => (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-pressed={accessibilityState?.selected ?? accessibilityState?.checked}
        disabled={disabled}
        onClick={onPress}
      >
        {typeof children === "function" ? null : children}
      </button>
    ),
    TextInput: ({
      accessibilityLabel,
      value,
      onChangeText,
      editable = true,
    }: {
      accessibilityLabel?: string;
      value: string;
      onChangeText: (value: string) => void;
      editable?: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
        disabled={!editable}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
      />
    ),
  };
});
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: PropsWithChildren) => <main>{children}</main>,
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("../../components/glass-surface", () => ({
  GlassSurface: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: h.timezone } },
    session: { api: () => h.api, epoch: () => h.owner },
  }),
}));
vi.mock("sonner-native", () => ({ toast: h }));
vi.mock("expo-router", () => ({
  router: h,
  useLocalSearchParams: () => h.params,
  useFocusEffect: () => undefined,
  Stack: {
    Screen: ({
      options,
    }: {
      options: { title?: string; headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
    }) => {
      h.screen(options);
      return (
        <>
          {options.headerLeft?.() ?? null}
          {options.headerRight?.() ?? null}
        </>
      );
    },
  },
}));

const RUN = "90000000-0000-4000-8000-000000000001";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const household = {
  questionId: "household",
  label: "Household",
  disposition: "unreviewed",
  answerSummary: "Two adults",
  allowsNone: false,
} as const;
const debts = {
  questionId: "debts",
  label: "Debts",
  disposition: "unreviewed",
  answerSummary: null,
  allowsNone: true,
} as const;
const snapshot: FinanceOnboardingSnapshot = {
  revision: 3,
  completedAt: null,
  existingAccess: false,
  source: { state: "usable", summary: "Two accounts are connected.", recoveryHref: null },
  contextReview: "needs_review",
  questions: [household, debts],
  displayPreferences: { reviewed: false, summary: ["Amounts are shown in USD."] },
  automationChoice: null,
  manualVisibility: "auto",
  automation: {
    registrationCount: 0,
    authorizedRegistrationWithCadence: false,
    chatVerification: "unavailable",
    canSendChat: false,
    historyAvailable: false,
  },
};
/** The server's snapshot once the draft below has been saved. */
const saved: FinanceOnboardingSnapshot = {
  ...snapshot,
  revision: 4,
  contextReview: "reviewed",
  questions: [
    { ...household, disposition: "answered" },
    { ...debts, disposition: "none" },
  ],
  displayPreferences: { ...snapshot.displayPreferences, reviewed: true },
  automationChoice: "later",
};
const result = <T,>(data: T, outcome = "completed", headline = "Done.") => ({
  outcome,
  data,
  communication: { headline, optionalDetails: [], requiredDisclosures: [] },
});
const maintenance = (status: string | null, reason: string | null = null) => ({
  run: status ? { id: RUN, status } : null,
  challengeId: null,
  nextAction: reason
    ? {
        tool: "maintain_finances",
        arguments: { operation: "resume", runId: RUN },
        reason,
      }
    : null,
  recovery: null,
});
const rejection = (status: number, message = "rejected") =>
  new ApiClientError({ code: "error", message, status });
let client: QueryClient;
function mount(node: ReactNode = <FinanceSetupScreen />) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
/** Opens a choice row and picks one of its options. */
function pick(row: RegExp, option: string | RegExp) {
  press(row);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: option }));
}
/** The option names a choice row offers. */
function options(row: RegExp) {
  press(row);
  const dialog = screen.getByRole("dialog");
  const names = within(dialog)
    .getAllByRole("button")
    .map((item) => item.getAttribute("aria-label") ?? item.textContent);
  fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel/ }));
  return names.filter((name) => !name?.startsWith("Cancel"));
}
/** Fills the draft that `saved` records. */
function review() {
  pick(/^Household,/, "Answered");
  pick(/^Debts,/, "None");
  fireEvent.click(screen.getByLabelText("I reviewed my display preferences"));
  pick(/^Automation,/, /^Later/);
}
async function loaded() {
  mount();
  await screen.findByRole("button", { name: /^Household,/ });
}
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info, h.loading])
    for (const [message] of toast.mock.calls)
      expect(screen.queryByText(String(message))).toBeNull();
}

beforeEach(() => {
  h.owner = "owner-a";
  h.api.getFinanceOnboarding.mockResolvedValue(snapshot);
  h.api.getFinanceBudget.mockResolvedValue(result(null));
  h.api.getFinanceMaintenanceHistory.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
});

// Review

it("offers each question the answers it allows and saves the reviewed draft", async () => {
  await loaded();
  expect(screen.getByText("Two accounts are connected.")).toBeTruthy();
  expect(screen.getByText("Saved answer: Two adults")).toBeTruthy();
  expect(screen.getByText("Amounts are shown in USD.")).toBeTruthy();
  expect(options(/^Household,/)).toEqual(["Answered", "Not sure"]);
  expect(options(/^Debts,/)).toEqual(["None", "Not sure"]);
  // Nothing to save until something is reviewed.
  expect(button("Save review").disabled).toBe(true);

  pick(/^Household,/, "Answered");
  pick(/^Debts,/, "Not sure");
  // A choice of automation is part of every save.
  expect(button("Save review").disabled).toBe(true);
  pick(/^Automation,/, /^Later/);
  h.api.saveFinanceOnboardingAnswers.mockResolvedValue({
    ...saved,
    contextReview: "reviewed",
    questions: [
      { ...household, disposition: "answered" },
      { ...debts, disposition: "unknown" },
    ],
    displayPreferences: snapshot.displayPreferences,
  });
  press("Save review");
  expect(h.loading).toHaveBeenCalledWith("Saving setup review…");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Setup review saved", expect.any(Object)),
  );
  expect(h.api.saveFinanceOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
    expectedRevision: 3,
    idempotencyKey: expect.stringMatching(UUID),
    automationChoice: "later",
    displayPreferencesReviewed: false,
    answers: [
      { questionId: "household", disposition: "answered" },
      { questionId: "debts", disposition: "unknown" },
    ],
  });
  // The draft now is what the server returned.
  expect(screen.getByRole("button", { name: "Debts, Not sure" })).toBeTruthy();
  expect(button("Save review").disabled).toBe(true);
  expectNoInlineResult();
});

it("leaves an unreviewed question out of the save", async () => {
  await loaded();
  pick(/^Debts,/, "None");
  pick(/^Automation,/, /^Set up/);
  h.api.saveFinanceOnboardingAnswers.mockResolvedValue(snapshot);
  press("Save review");
  await waitFor(() => expect(h.api.saveFinanceOnboardingAnswers).toHaveBeenCalled());
  expect(h.api.saveFinanceOnboardingAnswers.mock.calls[0]?.[0]).toMatchObject({
    automationChoice: "now",
    answers: [{ questionId: "debts", disposition: "none" }],
  });
});

it("reuses the key of an unconfirmed save for the same draft and not for another", async () => {
  await loaded();
  review();
  h.api.saveFinanceOnboardingAnswers.mockRejectedValueOnce(rejection(503));
  press("Save review");
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  press("Reload setup review");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Setup review reloaded", expect.any(Object)),
  );

  // The server still holds revision 3, so the same choices are the same request.
  review();
  h.api.saveFinanceOnboardingAnswers.mockRejectedValueOnce(rejection(503));
  press("Save review");
  await waitFor(() => expect(h.api.saveFinanceOnboardingAnswers).toHaveBeenCalledTimes(2));
  const [[first], [second]] = h.api.saveFinanceOnboardingAnswers.mock.calls as [
    [{ idempotencyKey: string }],
    [{ idempotencyKey: string }],
  ];
  expect(second.idempotencyKey).toBe(first.idempotencyKey);

  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(2));
  press("Reload setup review");
  await waitFor(() => expect(h.success).toHaveBeenCalledTimes(2));
  pick(/^Household,/, "Not sure");
  pick(/^Automation,/, /^Later/);
  h.api.saveFinanceOnboardingAnswers.mockResolvedValue(saved);
  press("Save review");
  await waitFor(() => expect(h.api.saveFinanceOnboardingAnswers).toHaveBeenCalledTimes(3));
  const third = h.api.saveFinanceOnboardingAnswers.mock.calls[2]?.[0] as { idempotencyKey: string };
  expect(third.idempotencyKey).toMatch(UUID);
  expect(third.idempotencyKey).not.toBe(first.idempotencyKey);
});

it.each([
  [
    { source: { ...snapshot.source, state: "missing" } },
    "Add an account or import records to continue.",
  ],
  [
    { source: { ...snapshot.source, state: "ownership_required" } },
    "Review account ownership to continue.",
  ],
  [
    { source: { ...snapshot.source, state: "unavailable" } },
    "Your financial records could not be checked.",
  ],
  [{ contextReview: "needs_review" }, "Review each financial context answer."],
  [{ contextReview: "unavailable" }, "Your financial context could not be checked."],
  [{}, "Review your display preferences."],
  [{}, "Choose whether to set up automation now or later."],
  [
    { automationChoice: "now" },
    "Connect an authorized agent and choose its cadence, or select Later.",
  ],
] as [
  Partial<FinanceOnboardingSnapshot>,
  string,
][])("explains what still blocks finishing: %#", async (change, copy) => {
  h.api.getFinanceOnboarding.mockResolvedValue({ ...snapshot, ...change });
  await loaded();
  expect(screen.getByText(copy)).toBeTruthy();
  expect(button("Finish setup").disabled).toBe(true);
});

it("finishes only a saved review the server says can complete", async () => {
  h.api.getFinanceOnboarding.mockResolvedValue(saved);
  await loaded();
  expect(screen.queryByText("Review your display preferences.")).toBeNull();
  expect(button("Finish setup").disabled).toBe(false);
  // An unsaved change must be saved first.
  pick(/^Debts,/, "Not sure");
  expect(button("Finish setup").disabled).toBe(true);
  pick(/^Debts,/, "None");
  expect(button("Finish setup").disabled).toBe(false);

  h.api.completeFinanceOnboarding.mockResolvedValue({
    ...saved,
    revision: 5,
    completedAt: "2026-11-18T15:00:00.000Z",
  });
  press("Finish setup");
  expect(h.loading).toHaveBeenCalledWith("Finishing setup…");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Finance setup finished", expect.any(Object)),
  );
  expect(h.api.completeFinanceOnboarding).toHaveBeenCalledExactlyOnceWith({
    expectedRevision: 4,
    idempotencyKey: expect.stringMatching(UUID),
    automationChoice: "later",
  });
  // Completion is the server's timestamp; the writes are gone and the answers are read-only.
  expect(screen.getByText("Setup is complete. Your workspace remains available.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Finish setup" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save review" })).toBeNull();
  expect(button(/^Household,/).disabled).toBe(true);
  expectNoInlineResult();
});

it("does not show setup as complete when the server has not recorded completion", async () => {
  h.api.getFinanceOnboarding.mockResolvedValue(saved);
  await loaded();
  h.api.completeFinanceOnboarding.mockResolvedValue({ ...saved, revision: 5 });
  press("Finish setup");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Setup is still pending", expect.any(Object)),
  );
  expect(screen.queryByText("Setup is complete. Your workspace remains available.")).toBeNull();
  expect(h.success).not.toHaveBeenCalled();
});

it("locks both writes after an unconfirmed outcome until the review is reloaded", async () => {
  h.api.getFinanceOnboarding.mockResolvedValue(saved);
  await loaded();
  h.api.completeFinanceOnboarding.mockRejectedValue(new TypeError("Network request failed"));
  press("Finish setup");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm setup finished. Reload the review before trying again.",
      expect.any(Object),
    ),
  );
  expect(h.api.completeFinanceOnboarding).toHaveBeenCalledTimes(1);
  pick(/^Debts,/, "Not sure");
  expect(button("Save review").disabled).toBe(true);
  expect(button("Finish setup").disabled).toBe(true);
  expect(screen.queryByText("Setup is complete. Your workspace remains available.")).toBeNull();

  // A failed reload keeps the draft and the lock.
  h.api.getFinanceOnboarding.mockRejectedValueOnce(rejection(500));
  press("Reload setup review");
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t reload the setup review. Your choices are still here.",
      expect.any(Object),
    ),
  );
  expect(screen.getByRole("button", { name: "Debts, Not sure" })).toBeTruthy();
  expect(button("Save review").disabled).toBe(true);

  // The reload shows what the server holds: here, the unconfirmed finish did land.
  h.api.getFinanceOnboarding.mockResolvedValue({
    ...saved,
    revision: 5,
    completedAt: "2026-11-18T15:00:00.000Z",
  });
  press("Reload setup review");
  await screen.findByText("Setup is complete. Your workspace remains available.");
  expect(screen.getByRole("button", { name: "Debts, None" })).toBeTruthy();
  expectNoInlineResult();
});

it("reloads a review that changed elsewhere", async () => {
  await loaded();
  review();
  h.api.saveFinanceOnboardingAnswers.mockRejectedValue(rejection(409));
  h.api.getFinanceOnboarding.mockResolvedValue({
    ...snapshot,
    revision: 9,
    questions: [household, { ...debts, disposition: "unknown" }],
  });
  press("Save review");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "This review changed elsewhere. Nothing was saved; the latest review is shown.",
      expect.any(Object),
    ),
  );
  expect(h.api.getFinanceOnboarding).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Debts, Not sure" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Household, Choose an answer" })).toBeTruthy();
  // The reloaded review is writable again, against the new revision.
  pick(/^Automation,/, /^Later/);
  h.api.saveFinanceOnboardingAnswers.mockResolvedValue(saved);
  press("Save review");
  await waitFor(() => expect(h.api.saveFinanceOnboardingAnswers).toHaveBeenCalledTimes(2));
  expect(h.api.saveFinanceOnboardingAnswers.mock.calls[1]?.[0]).toMatchObject({
    expectedRevision: 9,
  });
  expectNoInlineResult();
});

it("keeps the lock when a review that changed elsewhere cannot be reloaded", async () => {
  await loaded();
  review();
  h.api.saveFinanceOnboardingAnswers.mockRejectedValue(rejection(409));
  h.api.getFinanceOnboarding.mockRejectedValue(rejection(500));
  press("Save review");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "This review changed elsewhere and couldn’t be reloaded. Reload the review before trying again.",
      expect.any(Object),
    ),
  );
  expect(button("Save review").disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Debts, None" })).toBeTruthy();
});

it("adopts a newer server snapshot only while there are no unsaved choices", async () => {
  h.api.getFinanceOnboarding.mockResolvedValue({ ...saved, automationChoice: "now" });
  await loaded();
  expect(
    screen.getByText("Connect an authorized agent and choose its cadence, or select Later."),
  ).toBeTruthy();
  // A registration made on another screen is read again and lifts the blocker.
  h.api.getFinanceOnboarding.mockResolvedValue({
    ...saved,
    automationChoice: "now",
    automation: {
      ...saved.automation,
      registrationCount: 1,
      authorizedRegistrationWithCadence: true,
    },
  });
  await act(() => client.invalidateQueries({ queryKey: ["finances", "owner-a"] }));
  await waitFor(() => expect(button("Finish setup").disabled).toBe(false));

  // An unsaved choice is never replaced by a background read.
  pick(/^Debts,/, "Not sure");
  h.api.getFinanceOnboarding.mockResolvedValue({ ...saved, revision: 8 });
  await act(() => client.invalidateQueries({ queryKey: ["finances", "owner-a"] }));
  expect(screen.getByRole("button", { name: "Debts, Not sure" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Automation, Set up/ })).toBeTruthy();
});

it("links to Finance automations while the choice is to set up automation now", async () => {
  await loaded();
  expect(screen.queryByRole("button", { name: /Finance automations/ })).toBeNull();
  pick(/^Automation,/, /^Set up/);
  press(/Finance automations/);
  expect(h.push).toHaveBeenCalledWith("/finance-automations");
  pick(/^Automation,/, /^Later/);
  expect(screen.queryByRole("button", { name: /Finance automations/ })).toBeNull();
});

it("reports a refused save with the server's reason and keeps the draft writable", async () => {
  await loaded();
  review();
  h.api.saveFinanceOnboardingAnswers.mockRejectedValue(rejection(400, "Debts cannot be none."));
  press("Save review");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Setup review not saved. Debts cannot be none.",
      expect.any(Object),
    ),
  );
  expect(button("Save review").disabled).toBe(false);
  expect(screen.getByRole("button", { name: "Debts, None" })).toBeTruthy();
  expectNoInlineResult();
});

it("offers a retry when the review cannot load", async () => {
  h.api.getFinanceOnboarding.mockRejectedValue(rejection(500));
  mount();
  await screen.findByRole("button", { name: /Retry loading/ });
  expect(screen.queryByRole("button", { name: "Save review" })).toBeNull();
  expect(h.error).toHaveBeenCalledWith("Couldn’t load finance data", expect.any(Object));
});

// Budget

it("prepares a budget draft and reads the plan again", async () => {
  await loaded();
  h.api.setupFinances.mockResolvedValue(result({}));
  press("Prepare budget");
  expect(h.loading).toHaveBeenCalledWith("Preparing budget…");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Budget draft prepared", expect.any(Object)),
  );
  expect(h.api.setupFinances).toHaveBeenCalledExactlyOnceWith({ operation: "prepare_budget" });
  await waitFor(() => expect(h.api.getFinanceBudget).toHaveBeenCalledTimes(2));
  expectNoInlineResult();
});

it("offers the saved budget instead of preparing another", async () => {
  h.api.getFinanceBudget.mockResolvedValue(result({ id: "plan", status: "proposed" }));
  await loaded();
  press(await screen.findByRole("button", { name: /Open budget/ }).then(() => /Open budget/));
  expect(h.navigate).toHaveBeenCalledWith("/finances/plan");
  expect(screen.queryByRole("button", { name: "Prepare budget" })).toBeNull();
});

it("reports a budget that was not prepared or not confirmed", async () => {
  await loaded();
  h.api.setupFinances.mockResolvedValueOnce(result({}, "failed", "Record your income first."));
  press("Prepare budget");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Record your income first.", expect.any(Object)),
  );
  h.api.setupFinances.mockRejectedValueOnce(rejection(422, "Profile is incomplete."));
  press("Prepare budget");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Budget not prepared. Profile is incomplete.",
      expect.any(Object),
    ),
  );
  h.api.setupFinances.mockRejectedValueOnce(rejection(502));
  press("Prepare budget");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the budget was prepared. Check Plan before trying again.",
      expect.any(Object),
    ),
  );
  expect(h.api.setupFinances).toHaveBeenCalledTimes(3);
  expectNoInlineResult();
});

// Maintenance

it("starts maintenance and shows its stage, headline and next action", async () => {
  await loaded();
  h.api.maintainFinances.mockResolvedValue(
    result(
      maintenance("running", "Check again once the evidence is processed."),
      "work_remaining",
      "Processing 12 transactions.",
    ),
  );
  press("Start initial maintenance");
  expect(h.loading).toHaveBeenCalledWith("Checking maintenance…");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Maintenance status updated", expect.any(Object)),
  );
  expect(h.api.maintainFinances).toHaveBeenCalledExactlyOnceWith({
    operation: "start",
    scope: { type: "all_outstanding" },
  });
  expect(screen.getByText("Processing transaction evidence")).toBeTruthy();
  expect(screen.getByText("Processing 12 transactions.")).toBeTruthy();
  expect(screen.getByText("Check again once the evidence is processed.")).toBeTruthy();

  // The run it returned is resumed rather than started again.
  h.api.maintainFinances.mockResolvedValue(
    result(maintenance("completed_with_questions"), "user_input_required", "Two questions remain."),
  );
  press("Check maintenance progress");
  await waitFor(() => expect(h.api.maintainFinances).toHaveBeenCalledTimes(2));
  expect(h.api.maintainFinances).toHaveBeenLastCalledWith({ operation: "resume", runId: RUN });
  await screen.findByText("Maintenance complete with questions");
  press(/Answer in Review/);
  expect(h.navigate).toHaveBeenCalledWith("/finances/assistant");
  expectNoInlineResult();
});

it("resumes the latest unfinished run the server reports", async () => {
  h.api.getFinanceMaintenanceHistory.mockResolvedValue({
    items: [maintenance("awaiting_approval", "Approve the proposed action.")],
    nextCursor: null,
  });
  await loaded();
  await screen.findByText("Action approval required");
  expect(h.api.getFinanceMaintenanceHistory).toHaveBeenCalledWith({ limit: 1 });
  expect(screen.getByText("Approve the proposed action.")).toBeTruthy();
  h.api.maintainFinances.mockResolvedValue(
    result(maintenance("completed"), "completed", "All done."),
  );
  press("Check maintenance progress");
  await waitFor(() =>
    expect(h.api.maintainFinances).toHaveBeenCalledExactlyOnceWith({
      operation: "resume",
      runId: RUN,
    }),
  );
  // A finished run is not resumed; the next press starts a new one.
  await screen.findByText("Maintenance complete");
  expect(screen.getByRole("button", { name: "Start initial maintenance" })).toBeTruthy();
});

it("reports maintenance that failed, was refused or was not confirmed", async () => {
  await loaded();
  h.api.maintainFinances.mockResolvedValueOnce(
    result(maintenance(null), "failed", "No connected agent can run maintenance."),
  );
  press("Start initial maintenance");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "No connected agent can run maintenance.",
      expect.any(Object),
    ),
  );
  h.api.maintainFinances.mockRejectedValueOnce(rejection(403, "Maintenance is not authorized."));
  press("Start initial maintenance");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Maintenance didn’t run. Maintenance is not authorized.",
      expect.any(Object),
    ),
  );
  h.api.maintainFinances.mockRejectedValueOnce(new TypeError("Network request failed"));
  press("Start initial maintenance");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm maintenance ran. Check the latest run before starting again.",
      expect.any(Object),
    ),
  );
  // Never sent again on its own; the latest run is read again instead.
  expect(h.api.maintainFinances).toHaveBeenCalledTimes(3);
  await waitFor(() =>
    expect(h.api.getFinanceMaintenanceHistory.mock.calls.length).toBeGreaterThan(1),
  );
  expectNoInlineResult();
});

it("re-reads the run after an unconfirmed start and resumes the one that landed", async () => {
  await loaded();
  h.api.maintainFinances.mockRejectedValueOnce(new TypeError("Network request failed"));
  const reread = Promise.withResolvers<unknown>();
  h.api.getFinanceMaintenanceHistory.mockReturnValue(reread.promise);
  press("Start initial maintenance");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm maintenance ran. Check the latest run before starting again.",
      expect.any(Object),
    ),
  );
  // Nothing can be started while the run that may exist has not been read.
  expect(button("Start initial maintenance").disabled).toBe(true);
  press("Start initial maintenance");
  await act(async () => reread.resolve({ items: [maintenance("running")], nextCursor: null }));
  await screen.findByText("Processing transaction evidence");
  expect(button("Check maintenance progress").disabled).toBe(false);
  expect(h.api.maintainFinances).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("keeps Start closed while the run cannot be read after an unconfirmed start", async () => {
  await loaded();
  h.api.maintainFinances.mockRejectedValueOnce(rejection(503));
  h.api.getFinanceMaintenanceHistory.mockRejectedValue(rejection(500));
  press("Start initial maintenance");
  const check = await screen.findByRole("button", { name: /Check the latest run/ });
  expect(button("Start initial maintenance").disabled).toBe(true);
  // A check that fails changes nothing.
  h.loading.mockClear();
  fireEvent.click(check);
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Checking the latest run…");
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t read the latest run. Check again before starting.",
      expect.any(Object),
    ),
  );
  expect(button("Start initial maintenance").disabled).toBe(true);
  h.api.getFinanceMaintenanceHistory.mockResolvedValue({ items: [], nextCursor: null });
  press(/Check the latest run/);
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Latest run checked", expect.any(Object)),
  );
  expect(button("Start initial maintenance").disabled).toBe(false);
  expect(screen.queryByRole("button", { name: /Check the latest run/ })).toBeNull();
  expect(h.api.maintainFinances).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("shows whichever of the last response and the run read is newer", async () => {
  const stamped = (status: string, updatedAt: string, reason: string | null = null) => {
    const payload = maintenance(status, reason);
    return {
      ...payload,
      run: { ...payload.run, createdAt: "2026-11-18T14:00:00.000Z", updatedAt },
    };
  };
  await loaded();
  h.api.maintainFinances.mockResolvedValue(
    result(
      stamped("running", "2026-11-18T14:01:00.000Z"),
      "work_remaining",
      "Processing 12 transactions.",
    ),
  );
  // A read that is older than the response does not replace it.
  h.api.getFinanceMaintenanceHistory.mockResolvedValue({
    items: [stamped("queued", "2026-11-18T14:00:00.000Z")],
    nextCursor: null,
  });
  press("Start initial maintenance");
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  await waitFor(() =>
    expect(h.api.getFinanceMaintenanceHistory.mock.calls.length).toBeGreaterThan(1),
  );
  await act(async () => {});
  expect(screen.getByText("Processing transaction evidence")).toBeTruthy();
  expect(screen.getByText("Processing 12 transactions.")).toBeTruthy();
  // The run then finishes elsewhere: the read is newer, and the old response's words go with it.
  h.api.getFinanceMaintenanceHistory.mockResolvedValue({
    items: [stamped("completed", "2026-11-18T14:05:00.000Z")],
    nextCursor: null,
  });
  await act(async () => {
    await client.refetchQueries({ queryKey: ["finances", "owner-a", "maintenance-latest"] });
  });
  await screen.findByText("Maintenance complete");
  expect(screen.queryByText("Processing 12 transactions.")).toBeNull();
  expect(button("Start initial maintenance").disabled).toBe(false);
});

// Overview

it("shows Finish Finance setup on Overview only while the server has no completion", async () => {
  const view = mount(<FinishFinanceSetup />);
  press(
    await screen
      .findByRole("button", { name: /Finish Finance setup/ })
      .then(() => /Finish Finance setup/),
  );
  expect(h.push).toHaveBeenCalledWith("/finance-setup");
  view.unmount();

  h.api.getFinanceOnboarding.mockResolvedValue({
    ...saved,
    completedAt: "2026-11-18T15:00:00.000Z",
  });
  mount(<FinishFinanceSetup />);
  await waitFor(() => expect(h.api.getFinanceOnboarding).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(screen.queryByRole("button", { name: /Finish Finance setup/ })).toBeNull();
});

it("does not claim setup is unfinished while the read is pending or has failed", async () => {
  h.api.getFinanceOnboarding.mockRejectedValue(rejection(500));
  mount(<FinishFinanceSetup />);
  await waitFor(() => expect(h.api.getFinanceOnboarding).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByRole("button", { name: /Finish Finance setup/ })).toBeNull();
  expect(h.error).not.toHaveBeenCalled();
});
