// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceGoalEditor } from "./goal-editor";
import {
  confirmedProgress,
  goalDate,
  goalSummary,
  parseProgressCents,
  parseTarget,
} from "./goal-progress";
import { FinanceGoalProgress } from "./goal-progress-editor";
import { FinanceGoalScreen, FinanceGoals } from "./goals";
import { localToday } from "./mutations";
import { formatMoney } from "./presentation";

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
  setParams: vi.fn(),
  back: vi.fn(),
  alert: vi.fn(),
  screen: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "feedback"),
  api: {
    listFinanceGoals: vi.fn(),
    manageFinanceGoal: vi.fn(),
  },
}));
vi.mock("react-native", () => {
  const Box = ({ children, testID }: PropsWithChildren<{ testID?: string }>) => (
    <div data-testid={testID}>{children}</div>
  );
  return {
    StyleSheet: { create: (value: unknown) => value },
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
    Keyboard: { addListener: () => ({ remove: vi.fn() }) },
    useWindowDimensions: () => ({ height: 852, width: 393 }),
    Image: () => null,
    View: Box,
    ScrollView: Box,
    Text: Box,
    Modal: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
    Alert: { alert: h.alert },
    Platform: { OS: "web" },
    useColorScheme: () => "light",
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityHint,
    }: PropsWithChildren<{
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityHint?: string;
    }>) => (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-description={accessibilityHint}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
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

const evidence = {
  evidenceId: "evidence-1",
  ownerUserId: "owner-a",
  actor: { type: "user", userId: "owner-a" },
  provenance: "explicit_user",
  currencyCode: "USD",
  asOf: "2026-01-05",
  recordedAt: "2026-01-05T12:00:00Z",
  kind: "goal",
  goalId: "goal-1",
  goalVersion: 3,
  progressAmountCents: 250_000,
};
const reserve = {
  id: "goal-1",
  name: "Emergency reserve",
  targetAmount: 10_000,
  currentAmount: 2500,
  deadline: "2027-06-30",
  priority: "high",
  status: "active",
  version: 3,
  createdAt: "2026-01-01T12:00:00Z",
  updatedAt: "2026-01-05T12:00:00Z",
  planningEvidence: evidence,
};
const trip = {
  ...reserve,
  id: "goal-2",
  name: "Summer trip",
  targetAmount: 3000,
  currentAmount: 0,
  deadline: null,
  priority: "medium",
  status: "paused",
  version: 1,
  planningEvidence: null,
};
const completed = <T,>(data: T) => ({
  outcome: "completed",
  data,
  communication: { headline: "" },
});
const goals = (list: unknown[]) => completed(list);
const rejection = (status: number) =>
  new ApiClientError({ code: "error", message: "rejected", status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return {
    ...view,
    again: (next: ReactNode) =>
      view.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  };
}
/** Presses a button of the most recent native confirmation. */
function confirm(label: string) {
  const buttons = h.alert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  act(() => buttons.find((button) => button.text === label)?.onPress?.());
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const save = () => screen.getByRole("button", { name: "Save changes" });
const sent = (call = 0) => h.api.manageFinanceGoal.mock.calls[call]?.[0];
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info, h.loading])
    for (const [message] of toast.mock.calls)
      expect(screen.queryByText(String(message))).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
  h.owner = "owner-a";
  h.timezone = "America/New_York";
  h.params = {};
  h.api.listFinanceGoals.mockResolvedValue(
    goals([reserve, trip, { ...trip, id: "goal-3", name: "Old car", status: "removed" }]),
  );
});
afterEach(cleanup);

// ── Pure rules ───────────────────────────────────────────────────────────────

it("shows progress only for a statement that matches this version of the goal", () => {
  const goal = reserve as never;
  expect(confirmedProgress(goal, "owner-a", "2026-11-15")).toEqual({
    amount: 2500,
    currency: "USD",
    asOf: "2026-01-05",
    percent: 25,
  });
  const not = (change: object, owner: string | undefined = "owner-a", today = "2026-11-15") =>
    expect(confirmedProgress({ ...reserve, ...change } as never, owner, today)).toBeNull();
  not({ planningEvidence: null });
  not({ planningEvidence: undefined });
  not({ status: "removed" });
  not({ version: 4 });
  not({ currentAmount: 2600 });
  not({ planningEvidence: { ...evidence, goalId: "goal-9" } });
  not({ planningEvidence: { ...evidence, ownerUserId: "owner-b" } });
  not({ planningEvidence: { ...evidence, actor: { type: "user", userId: "owner-b" } } });
  not({}, "owner-b");
  not({}, "owner-a", "2026-01-04");
  expect(confirmedProgress(goal, "owner-a", undefined)).toBeNull();
  expect(confirmedProgress(goal, undefined, "2026-11-15")).toBeNull();
  // A zero target has no percentage, and an agent acting for the owner still counts.
  expect(
    confirmedProgress(
      {
        ...reserve,
        targetAmount: 0,
        planningEvidence: { ...evidence, actor: { type: "agent", userId: "owner-a", id: "a" } },
      } as never,
      "owner-a",
      "2026-11-15",
    ),
  ).toMatchObject({ percent: null });
});

it("reads exact amounts and rejects anything else", () => {
  expect(parseProgressCents("0")).toBe(0);
  expect(parseProgressCents(" 1,250.5 ")).toBe(125_050);
  expect(parseProgressCents("21474836.47")).toBe(2_147_483_647);
  for (const text of ["", "12,50", "1.234", "-5", "abc", "21474836.48"])
    expect(parseProgressCents(text)).toBeUndefined();
  expect(parseTarget("0")).toBe(0);
  expect(parseTarget("100,000,000")).toBe(100_000_000);
  for (const text of ["", "100000000.01", "5.999", "-1", "1,00"])
    expect(parseTarget(text)).toBeUndefined();
});

it("summarizes a goal without inventing progress", () => {
  expect(goalSummary(trip as never, null)).toBe(
    "Paused · Target $3,000.00 · progress not confirmed",
  );
  expect(
    goalSummary(reserve as never, {
      amount: 2500,
      currency: "EUR",
      asOf: "2026-01-05",
      percent: 25,
    }),
  ).toBe(
    `${formatMoney(2500, "EUR")} confirmed of ${formatMoney(10_000, "EUR")} · by ${goalDate("2027-06-30")}`,
  );
  expect(goalDate("2027-06-30")).toContain("2027");
});

// ── Plan › Wealth list ───────────────────────────────────────────────────────

it("lists goals with confirmed progress only and leaves removed goals out", async () => {
  mount(<FinanceGoals />);
  const row = await screen.findByRole("button", { name: /Emergency reserve/ });
  expect(row.textContent).toContain("$2,500.00 confirmed of $10,000.00");
  expect(row.textContent).toContain("25%");
  const paused = screen.getByRole("button", { name: /Summer trip/ });
  expect(paused.textContent).toContain("Paused · Target $3,000.00 · progress not confirmed");
  expect(paused.textContent).not.toContain("%");
  expect(screen.queryByText("Old car")).toBeNull();
  fireEvent.click(row);
  expect(h.push).toHaveBeenCalledWith({ pathname: "/finance-goal", params: { id: "goal-1" } });
  press("Add goal");
  expect(h.push).toHaveBeenLastCalledWith("/finance-goal-edit");
});

it("does not show a recorded amount as progress when the statement is for another version", async () => {
  h.api.listFinanceGoals.mockResolvedValue(goals([{ ...reserve, version: 4 }]));
  mount(<FinanceGoals />);
  const row = await screen.findByRole("button", { name: /Emergency reserve/ });
  expect(row.textContent).toContain("progress not confirmed");
  expect(row.textContent).not.toContain("25%");
  expect(row.textContent).not.toContain("$2,500.00");
});

it("offers Add when there are no goals, and without a timezone confirms nothing", async () => {
  h.api.listFinanceGoals.mockResolvedValue(goals([{ ...trip, status: "removed" }]));
  const view = mount(<FinanceGoals />);
  await screen.findByText("No goals yet.");
  expect(screen.getByRole("button", { name: "Add goal" })).toBeTruthy();
  view.unmount();
  h.timezone = undefined;
  h.api.listFinanceGoals.mockResolvedValue(goals([reserve]));
  mount(<FinanceGoals />);
  const row = await screen.findByRole("button", { name: /Emergency reserve/ });
  expect(row.textContent).toContain("progress not confirmed");
});

// ── Goal detail and lifecycle actions ────────────────────────────────────────

it("shows a goal's confirmed progress, target, deadline, priority and status", async () => {
  h.params = { id: "goal-1" };
  mount(<FinanceGoalScreen />);
  await screen.findByText("Confirmed progress");
  expect(screen.getByText("$2,500.00")).toBeTruthy();
  expect(
    screen.getByText(`25% of $10,000.00 · Your statement as of ${goalDate("2026-01-05")}`),
  ).toBeTruthy();
  expect(screen.getByText(goalDate("2027-06-30"))).toBeTruthy();
  expect(screen.getByText("High")).toBeTruthy();
  expect(screen.getByText("Active")).toBeTruthy();
  expect(h.screen).toHaveBeenCalledWith({ title: "goal" });
  // Ordinary actions first, the destructive one last.
  const labels = within(screen.getByRole("dialog"))
    .getAllByRole("button")
    .map((button) => button.textContent);
  expect(labels).toEqual([
    "",
    "Edit goal",
    "Confirm progress",
    "Pause goal",
    "Mark complete",
    "Remove goal",
  ]);
  press("Edit goal");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-goal-edit",
    params: { id: "goal-1" },
  });
  press("Confirm progress");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-goal-progress",
    params: { id: "goal-1" },
  });
});

it("says progress is not confirmed, and offers only the actions a status allows", async () => {
  h.params = { id: "goal-2" };
  const view = mount(<FinanceGoalScreen />);
  await screen.findByText("Progress not confirmed");
  expect(screen.queryByText("Confirmed progress")).toBeNull();
  expect(screen.getByText("None")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Resume goal" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Pause goal" })).toBeNull();
  view.unmount();
  h.api.listFinanceGoals.mockResolvedValue(goals([{ ...trip, status: "completed" }]));
  mount(<FinanceGoalScreen />);
  await screen.findByText("Completed");
  for (const name of ["Pause goal", "Resume goal", "Mark complete"])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.getByRole("button", { name: "Remove goal" })).toBeTruthy();
});

it("treats a removed or unknown goal as unavailable", async () => {
  h.params = { id: "goal-3" };
  mount(<FinanceGoalScreen />);
  await screen.findByText("This goal is unavailable.");
  expect(screen.queryByRole("button", { name: "Remove goal" })).toBeNull();
});

it("pauses a goal against the version shown, through one toast", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockResolvedValue(completed({ ...reserve, status: "paused" }));
  mount(<FinanceGoalScreen />);
  await screen.findByText("Confirmed progress");
  const reads = h.api.listFinanceGoals.mock.calls.length;
  press("Pause goal");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Goal paused", { id: "feedback" }));
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Pausing goal…");
  expect(sent()).toEqual({
    operation: "pause",
    goalId: "goal-1",
    expectedVersion: 3,
    idempotencyKey: expect.any(String),
  });
  expect(h.alert).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  await waitFor(() => expect(h.api.listFinanceGoals.mock.calls.length).toBeGreaterThan(reads));
  expectNoInlineResult();
});

it("resumes a paused goal", async () => {
  h.params = { id: "goal-2" };
  h.api.manageFinanceGoal.mockResolvedValue(completed({ ...trip, status: "active" }));
  mount(<FinanceGoalScreen />);
  press(await screen.findByText("Resume goal").then(() => "Resume goal"));
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Goal resumed", { id: "feedback" }));
  expect(sent()).toMatchObject({ operation: "resume", goalId: "goal-2", expectedVersion: 1 });
  expectNoInlineResult();
});

it("completes a goal only after confirmation", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockResolvedValue(completed({ ...reserve, status: "completed" }));
  mount(<FinanceGoalScreen />);
  await screen.findByText("Confirmed progress");
  press("Mark complete");
  expect(h.alert).toHaveBeenCalledWith(
    "Mark Emergency reserve complete?",
    expect.stringContaining("will need confirming again"),
    expect.any(Array),
  );
  confirm("Cancel");
  expect(h.api.manageFinanceGoal).not.toHaveBeenCalled();
  press("Mark complete");
  confirm("Mark complete");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Goal marked complete", { id: "feedback" }),
  );
  expect(sent()).toMatchObject({ operation: "complete", goalId: "goal-1", expectedVersion: 3 });
  expectNoInlineResult();
});

it("removes a goal only after a destructive confirmation, then leaves its page", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockResolvedValue(completed({ ...reserve, status: "removed" }));
  mount(<FinanceGoalScreen />);
  await screen.findByText("Confirmed progress");
  press("Remove goal");
  expect(h.alert).toHaveBeenCalledWith(
    "Remove Emergency reserve?",
    expect.stringContaining("keep their record"),
    [
      { text: "Keep goal", style: "cancel" },
      expect.objectContaining({ text: "Remove goal", style: "destructive" }),
    ],
  );
  confirm("Keep goal");
  expect(h.api.manageFinanceGoal).not.toHaveBeenCalled();
  press("Remove goal");
  confirm("Remove goal");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Goal removed", { id: "feedback" }));
  expect(sent()).toMatchObject({ operation: "remove", goalId: "goal-1", expectedVersion: 3 });
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("reports a rejected change as unchanged and retries it under a new key", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockRejectedValueOnce(rejection(422));
  h.api.manageFinanceGoal.mockResolvedValue(completed({ ...reserve, status: "paused" }));
  mount(<FinanceGoalScreen />);
  await screen.findByText("Confirmed progress");
  press("Pause goal");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t pause this goal. Nothing was changed.", {
      id: "feedback",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();
  await waitFor(() => expect(save0()).toBe(false));
  press("Pause goal");
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(sent(1).idempotencyKey).not.toBe(sent(0).idempotencyKey);
  expectNoInlineResult();
});
/** Whether the goal's actions are disabled while a change is pending. */
const save0 = () => screen.getByRole("button", { name: "Pause goal" }).hasAttribute("disabled");

it("never claims an unconfirmed change, and repeats it under the same key", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockRejectedValueOnce(new Error("connection lost"));
  h.api.manageFinanceGoal.mockRejectedValueOnce(rejection(503));
  h.api.manageFinanceGoal.mockResolvedValue(completed({ ...reserve, status: "paused" }));
  mount(<FinanceGoalScreen />);
  await screen.findByText("Confirmed progress");
  for (const attempt of [1, 2]) {
    press("Pause goal");
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(attempt));
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t confirm the goal was changed. Check its status before trying again.",
      { id: "feedback" },
    );
    await waitFor(() => expect(save0()).toBe(false));
  }
  expect(h.success).not.toHaveBeenCalled();
  press("Pause goal");
  await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
  expect(new Set([0, 1, 2].map((call) => sent(call).idempotencyKey)).size).toBe(1);
  expectNoInlineResult();
});

it("explains a conflict and a declined change without claiming success", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockRejectedValueOnce(rejection(409));
  h.api.manageFinanceGoal.mockResolvedValueOnce({
    outcome: "failed",
    data: reserve,
    communication: { headline: "This goal can’t be paused right now." },
  });
  h.api.manageFinanceGoal.mockResolvedValueOnce({
    outcome: "user_input_required",
    data: reserve,
    communication: { headline: "Review this goal first." },
  });
  mount(<FinanceGoalScreen />);
  await screen.findByText("Confirmed progress");
  press("Pause goal");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "This goal changed elsewhere. Review the latest version before trying again.",
      { id: "feedback" },
    ),
  );
  await waitFor(() => expect(save0()).toBe(false));
  press("Pause goal");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("This goal can’t be paused right now.", {
      id: "feedback",
    }),
  );
  await waitFor(() => expect(save0()).toBe(false));
  press("Pause goal");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Review this goal first.", { id: "feedback" }),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("disables the goal's actions while a change is pending and ignores a second press", async () => {
  h.params = { id: "goal-1" };
  const request = deferred<unknown>();
  h.api.manageFinanceGoal.mockReturnValue(request.promise);
  mount(<FinanceGoalScreen />);
  await screen.findByText("Confirmed progress");
  press("Pause goal");
  await waitFor(() => expect(save0()).toBe(true));
  expect(screen.getByRole("button", { name: "Remove goal" })).toHaveProperty("disabled", true);
  expect(h.api.manageFinanceGoal).toHaveBeenCalledOnce();
  await act(async () => request.resolve(completed({ ...reserve, status: "paused" })));
  await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
});

it("keeps the actions disabled until the changed goal is on screen", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockResolvedValue(completed({ ...reserve, status: "paused" }));
  mount(<FinanceGoalScreen />);
  await screen.findByText("Confirmed progress");
  const reload = deferred<unknown>();
  h.api.listFinanceGoals.mockReturnValue(reload.promise);
  press("Pause goal");
  await waitFor(() => expect(h.api.manageFinanceGoal).toHaveBeenCalledOnce());
  // The write is confirmed but the old version is still shown: nothing can be sent against it.
  await waitFor(() => expect(h.api.listFinanceGoals.mock.calls.length).toBeGreaterThan(1));
  expect(save0()).toBe(true);
  expect(h.success).not.toHaveBeenCalled();
  press("Pause goal");
  expect(h.api.manageFinanceGoal).toHaveBeenCalledOnce();
  await act(async () =>
    reload.resolve(
      goals([{ ...reserve, status: "paused", version: 4, planningEvidence: evidence }]),
    ),
  );
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Goal paused", { id: "feedback" }));
  expect(screen.getByRole("button", { name: "Resume goal" })).toHaveProperty("disabled", false);
  // The statement was for version 3; the target keeps its currency all the same.
  expect(screen.getByText("Progress not confirmed")).toBeTruthy();
  expect(screen.getByText("$10,000.00")).toBeTruthy();
});

it("says nothing about a change once the goal page has been left", async () => {
  h.params = { id: "goal-1" };
  for (const settle of ["resolve", "decline", "reject"] as const) {
    const request = deferred<unknown>();
    h.api.manageFinanceGoal.mockReturnValue(request.promise);
    const view = mount(<FinanceGoalScreen />);
    await screen.findByText("Confirmed progress");
    press("Pause goal");
    view.unmount();
    await act(async () => {
      if (settle === "resolve") request.resolve(completed(reserve));
      else if (settle === "decline")
        request.resolve({ outcome: "failed", data: reserve, communication: { headline: "No." } });
      else request.reject(new Error("connection lost"));
    });
    await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("feedback"));
    h.dismiss.mockClear();
  }
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
});

it("keeps the target in the currency of the goal's last statement", () => {
  const euro = { ...reserve, version: 4, planningEvidence: { ...evidence, currencyCode: "EUR" } };
  expect(confirmedProgress(euro as never, "owner-a", "2026-11-15")).toBeNull();
  expect(goalSummary(euro as never, null)).toContain(`Target ${formatMoney(10_000, "EUR")}`);
});

it("drops the result of a change when the signed-in owner changed meanwhile", async () => {
  h.params = { id: "goal-1" };
  for (const settle of ["resolve", "reject"] as const) {
    const request = deferred<unknown>();
    h.api.manageFinanceGoal.mockReturnValue(request.promise);
    const view = mount(<FinanceGoalScreen />);
    await screen.findByText("Confirmed progress");
    press("Pause goal");
    h.owner = "owner-b";
    h.api.listFinanceGoals.mockResolvedValue(goals([]));
    view.again(<FinanceGoalScreen />);
    await act(async () =>
      settle === "resolve" ? request.resolve(completed(reserve)) : request.reject(rejection(422)),
    );
    await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("feedback"));
    expect(h.success).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
    view.unmount();
    h.dismiss.mockClear();
    h.owner = "owner-a";
    h.api.listFinanceGoals.mockResolvedValue(goals([reserve]));
  }
});

// ── Add and edit ─────────────────────────────────────────────────────────────

it("adds a goal only once its fields are valid", async () => {
  h.api.manageFinanceGoal.mockResolvedValue(completed({ ...trip, id: "goal-9" }));
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  expect(save()).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  expect(screen.getAllByText("Add goal").length).toBe(1);
  expect(h.screen.mock.lastCall?.[0]).toMatchObject({ title: "", headerBackVisible: false });
  expect(screen.getByText(/Name and Target are required\./)).toBeTruthy();
  type("Name", "  House deposit ");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  type("Target", "12,50");
  expect(screen.getByText("Enter an amount such as 5000.00, up to 100,000,000.")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  type("Target", "40,000.50");
  expect(screen.queryByText("Enter an amount such as 5000.00, up to 100,000,000.")).toBeNull();
  type("Deadline (ISO date/time)", "2028-03-01");
  const rows = screen.getByTestId("padded-surface-rows");
  expect(rows.contains(screen.getByLabelText("Name"))).toBe(true);
  expect(rows.contains(screen.getByRole("button", { name: "Priority, Medium" }))).toBe(true);
  press("Priority, Medium");
  press("High");
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Goal added", { id: "feedback" }));
  expect(sent()).toEqual({
    operation: "create",
    name: "House deposit",
    targetAmount: 40_000.5,
    deadline: "2028-03-01",
    priority: "high",
    idempotencyKey: expect.any(String),
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Adding goal…");
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("keeps the draft when adding is rejected and sends no deadline when none is chosen", async () => {
  h.api.manageFinanceGoal.mockRejectedValueOnce(rejection(422));
  h.api.manageFinanceGoal.mockResolvedValue(completed(trip));
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  type("Name", "House deposit");
  type("Target", "40000");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t add this goal. Your draft is still here.", {
      id: "feedback",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "House deposit");
  expect(sent()).toMatchObject({ deadline: null, priority: "medium" });
  // A definitive rejection wrote nothing: the retry is a fresh write with no lookup first.
  const reads = h.api.listFinanceGoals.mock.calls.length;
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(sent(1).idempotencyKey).not.toBe(sent(0).idempotencyKey);
  expect(h.api.listFinanceGoals).toHaveBeenCalledTimes(reads + 1); // refresh after success only
  expectNoInlineResult();
});

it("repeats an unconfirmed add of the same draft under the same key", async () => {
  h.api.manageFinanceGoal.mockRejectedValueOnce(new Error("connection lost"));
  h.api.manageFinanceGoal.mockResolvedValue(completed(trip));
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  type("Name", "House deposit");
  type("Target", "40000");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the goal was added. Your draft is still here; saving again won’t add it twice.",
      { id: "feedback" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Goal added", { id: "feedback" }));
  expect(sent(1).idempotencyKey).toBe(sent(0).idempotencyKey);
  expectNoInlineResult();
});

it("does not add a second goal when a corrected draft follows an add that was recorded", async () => {
  h.api.manageFinanceGoal.mockRejectedValueOnce(new Error("connection lost"));
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  type("Name", "House deposit");
  type("Target", "40000");
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  h.api.listFinanceGoals.mockResolvedValue(
    goals([reserve, trip, { ...trip, id: "goal-9", name: "House deposit" }]),
  );
  type("Target", "45000");
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith(
      "Your earlier attempt already added “House deposit”. Open that goal to change it.",
      { id: "feedback" },
    ),
  );
  expect(h.api.manageFinanceGoal).toHaveBeenCalledOnce();
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("adds a corrected draft once the earlier attempt is known not to be recorded", async () => {
  h.api.manageFinanceGoal.mockRejectedValueOnce(new Error("connection lost"));
  h.api.manageFinanceGoal.mockResolvedValue(completed(trip));
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  type("Name", "House deposit");
  type("Target", "40000");
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  // A goal that already existed under the same name is not the earlier attempt.
  h.api.listFinanceGoals.mockResolvedValue(goals([{ ...reserve, name: "House deposit" }, trip]));
  type("Target", "45000");
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Goal added", { id: "feedback" }));
  expect(sent(1)).toMatchObject({ targetAmount: 45_000 });
  expect(sent(1).idempotencyKey).not.toBe(sent(0).idempotencyKey);
});

it("writes nothing when it cannot check for the earlier attempt", async () => {
  h.api.manageFinanceGoal.mockRejectedValueOnce(new Error("connection lost"));
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  type("Name", "House deposit");
  type("Target", "40000");
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  h.api.listFinanceGoals.mockRejectedValue(new Error("offline"));
  type("Target", "45000");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t check whether the goal was added. Try again shortly.",
      { id: "feedback" },
    ),
  );
  expect(h.api.manageFinanceGoal).toHaveBeenCalledOnce();
  expect(h.back).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("says nothing when the form is left while it checks for the earlier attempt", async () => {
  for (const settle of ["resolve", "reject"] as const) {
    h.api.manageFinanceGoal.mockRejectedValueOnce(new Error("connection lost"));
    const view = mount(<FinanceGoalEditor />);
    await screen.findByLabelText("Name");
    type("Name", "House deposit");
    type("Target", "40000");
    fireEvent.click(save());
    await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
    await waitFor(() => expect(save()).toHaveProperty("disabled", false));
    const lookup = deferred<unknown>();
    h.api.listFinanceGoals.mockReturnValue(lookup.promise);
    type("Target", "45000");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveProperty("disabled", true));
    view.unmount();
    await act(async () =>
      settle === "resolve" ? lookup.resolve(goals([reserve])) : lookup.reject(new Error("offline")),
    );
    await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("feedback"));
    expect(h.api.manageFinanceGoal).toHaveBeenCalledOnce();
    expect(h.error).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    h.api.manageFinanceGoal.mockReset();
    h.api.listFinanceGoals.mockResolvedValue(goals([reserve, trip]));
  }
});

it("saves only the changed fields of a goal against the version that was opened", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockResolvedValue(completed({ ...reserve, version: 4 }));
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  expect(screen.getAllByText("Edit goal").length).toBe(1);
  expect(screen.getByLabelText("Target")).toHaveProperty("value", "10000");
  expect(screen.getByText(/progress will need confirming again/)).toBeTruthy();
  type("Target", "12000");
  type("Deadline (ISO date/time)", "");
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Goal updated", { id: "feedback" }));
  expect(sent()).toEqual({
    operation: "update",
    goalId: "goal-1",
    expectedVersion: 3,
    changes: { targetAmount: 12_000, deadline: null },
    idempotencyKey: expect.any(String),
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Saving goal…");
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("writes nothing when an edit returns every field to its saved value", async () => {
  h.params = { id: "goal-1" };
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  type("Name", "Reserve");
  type("Name", "Emergency reserve");
  press("Priority, High");
  press("Low");
  press("Priority, Low");
  press("High");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("No changes to save", { id: "feedback" }),
  );
  expect(h.api.manageFinanceGoal).not.toHaveBeenCalled();
  expect(h.back).toHaveBeenCalledOnce();
});

it("keeps the draft and never reports a save that was rejected, conflicted or unconfirmed", async () => {
  h.params = { id: "goal-1" };
  const outcomes: [unknown, string][] = [
    [rejection(422), "Couldn’t save this goal. Your draft is still here."],
    [
      rejection(409),
      "This goal changed elsewhere. Close and reopen it to review the latest version; your draft is still here.",
    ],
    [
      new Error("connection lost"),
      "Couldn’t confirm the save. Your draft is still here. Check the goal before retrying.",
    ],
    [
      rejection(500),
      "Couldn’t confirm the save. Your draft is still here. Check the goal before retrying.",
    ],
  ];
  for (const [error] of outcomes) h.api.manageFinanceGoal.mockRejectedValueOnce(error);
  h.api.manageFinanceGoal.mockResolvedValue(completed(reserve));
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  type("Name", "Rainy day fund");
  for (const [index, [, message]] of outcomes.entries()) {
    await waitFor(() => expect(save()).toHaveProperty("disabled", false));
    fireEvent.click(save());
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(index + 1));
    expect(h.error).toHaveBeenLastCalledWith(message, { id: "feedback" });
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Rainy day fund");
  }
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  // Definitive rejections take a new key; the two unknown outcomes share one with the retry.
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
  const keys = [0, 1, 2, 3, 4].map((call) => sent(call).idempotencyKey);
  expect(new Set(keys).size).toBe(3);
  expect(keys[2]).toBe(keys[3]);
  expect(keys[3]).toBe(keys[4]);
  expectNoInlineResult();
});

it("reports a save the server answered without applying", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockResolvedValueOnce({
    outcome: "failed",
    data: reserve,
    communication: { headline: "This goal can’t be changed." },
  });
  h.api.manageFinanceGoal.mockResolvedValueOnce({
    outcome: "work_remaining",
    data: reserve,
    communication: { headline: "Review is needed first." },
  });
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  type("Name", "Rainy day fund");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("This goal can’t be changed.", { id: "feedback" }),
  );
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Review is needed first.", { id: "feedback" }),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("closes an untouched form at once and asks before discarding edits", async () => {
  h.params = { id: "goal-1" };
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  press("Close");
  expect(h.alert).not.toHaveBeenCalled();
  expect(h.back).toHaveBeenCalledOnce();
  type("Name", "Rainy day fund");
  press("Cancel");
  expect(h.alert).toHaveBeenCalledWith("Discard changes?", expect.any(String), expect.any(Array));
  expect(h.back).toHaveBeenCalledOnce();
  confirm("Discard");
  expect(h.back).toHaveBeenCalledTimes(2);
  expect(h.api.manageFinanceGoal).not.toHaveBeenCalled();
});

it("locks the form while saving and says nothing once it has been left", async () => {
  h.params = { id: "goal-1" };
  for (const settle of ["resolve", "reject"] as const) {
    const request = deferred<unknown>();
    h.api.manageFinanceGoal.mockReturnValue(request.promise);
    const view = mount(<FinanceGoalEditor />);
    await screen.findByLabelText("Name");
    type("Name", "Rainy day fund");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveProperty("disabled", true));
    expect(save()).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
    view.unmount();
    await act(async () =>
      settle === "resolve" ? request.resolve(completed(reserve)) : request.reject(rejection(422)),
    );
    await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("feedback"));
    h.dismiss.mockClear();
  }
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});

it("says a goal to edit is unavailable, and asks for a timezone before a deadline", async () => {
  h.params = { id: "goal-3" };
  const view = mount(<FinanceGoalEditor />);
  await screen.findByText("This goal is unavailable.");
  view.unmount();
  h.params = {};
  h.timezone = undefined;
  mount(<FinanceGoalEditor />);
  await screen.findByLabelText("Name");
  expect(
    screen.getByText(/Set your account timezone in Settings to choose a deadline\./),
  ).toBeTruthy();
});

// ── Progress confirmation ────────────────────────────────────────────────────

it("records a progress statement for the version that was opened", async () => {
  h.params = { id: "goal-2" };
  h.api.manageFinanceGoal.mockResolvedValue(completed({ ...trip, version: 2 }));
  mount(<FinanceGoalProgress />);
  await screen.findByLabelText("Amount");
  expect(screen.getAllByText("Confirm progress").length).toBe(1);
  expect(screen.getByText("Summer trip")).toBeTruthy();
  expect(h.screen.mock.lastCall?.[0]).toMatchObject({ title: "", headerBackVisible: false });
  const today = localToday("America/New_York");
  expect(screen.getByLabelText("As of (ISO date/time)")).toHaveProperty("value", today);
  expect(screen.getByLabelText("Currency")).toHaveProperty("value", "");
  expect(save()).toHaveProperty("disabled", true);
  type("Amount", "12,50");
  expect(screen.getByText("Enter an amount such as 1250.00, up to 21,474,836.47.")).toBeTruthy();
  type("Amount", "1,250.5");
  type("Currency", "us");
  expect(screen.getByText("Use a three-letter code such as USD.")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  type("Currency", "usd");
  type("As of (ISO date/time)", "2999-01-01");
  expect(screen.getByText("The progress date cannot be in the future.")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  type("As of (ISO date/time)", "");
  expect(save()).toHaveProperty("disabled", true);
  type("As of (ISO date/time)", "2026-02-01");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Goal progress confirmed", { id: "feedback" }),
  );
  expect(sent()).toEqual({
    operation: "confirm_progress",
    goalId: "goal-2",
    expectedVersion: 1,
    progressAmountCents: 125_050,
    currencyCode: "USD",
    asOf: "2026-02-01",
    idempotencyKey: expect.any(String),
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Recording goal progress…");
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("accepts zero and offers the currency of the last statement", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockResolvedValue(completed(reserve));
  mount(<FinanceGoalProgress />);
  await screen.findByLabelText("Amount");
  expect(screen.getByLabelText("Currency")).toHaveProperty("value", "USD");
  type("Amount", "0");
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(sent()).toMatchObject({
    progressAmountCents: 0,
    currencyCode: "USD",
    asOf: localToday("America/New_York"),
    expectedVersion: 3,
  });
});

it("keeps the entries and never reports progress that was rejected, conflicted or unconfirmed", async () => {
  h.params = { id: "goal-1" };
  const outcomes: [unknown, string][] = [
    [
      rejection(422),
      "Couldn’t record this progress. Check the amount, currency and date; your entries are still here.",
    ],
    [
      rejection(409),
      "This goal changed elsewhere. Close and reopen it to confirm progress for the latest version.",
    ],
    [
      new Error("connection lost"),
      "Couldn’t confirm the progress was recorded. Your entries are still here. Check the goal before retrying.",
    ],
  ];
  for (const [error] of outcomes) h.api.manageFinanceGoal.mockRejectedValueOnce(error);
  h.api.manageFinanceGoal.mockResolvedValue(completed(reserve));
  mount(<FinanceGoalProgress />);
  await screen.findByLabelText("Amount");
  type("Amount", "3000");
  for (const [index, [, message]] of outcomes.entries()) {
    await waitFor(() => expect(save()).toHaveProperty("disabled", false));
    fireEvent.click(save());
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(index + 1));
    expect(h.error).toHaveBeenLastCalledWith(message, { id: "feedback" });
    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "3000");
  }
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
  const keys = [0, 1, 2, 3].map((call) => sent(call).idempotencyKey);
  expect(new Set(keys).size).toBe(3);
  expect(keys[2]).toBe(keys[3]);
  expectNoInlineResult();
});

it("reports a statement the server answered without recording", async () => {
  h.params = { id: "goal-1" };
  h.api.manageFinanceGoal.mockResolvedValueOnce({
    outcome: "failed",
    data: reserve,
    communication: { headline: "Progress can’t be recorded for this goal." },
  });
  h.api.manageFinanceGoal.mockResolvedValueOnce({
    outcome: "user_input_required",
    data: reserve,
    communication: { headline: "Review is needed first." },
  });
  mount(<FinanceGoalProgress />);
  await screen.findByLabelText("Amount");
  type("Amount", "3000");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Progress can’t be recorded for this goal.", {
      id: "feedback",
    }),
  );
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Review is needed first.", { id: "feedback" }),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("asks before discarding a statement, and says nothing once the form has been left", async () => {
  h.params = { id: "goal-1" };
  const view = mount(<FinanceGoalProgress />);
  await screen.findByLabelText("Amount");
  press("Close");
  expect(h.back).toHaveBeenCalledOnce();
  type("Amount", "3000");
  press("Cancel");
  expect(h.alert).toHaveBeenCalledWith("Discard changes?", expect.any(String), expect.any(Array));
  confirm("Discard");
  expect(h.back).toHaveBeenCalledTimes(2);
  view.unmount();
  for (const settle of ["resolve", "reject"] as const) {
    const request = deferred<unknown>();
    h.api.manageFinanceGoal.mockReturnValue(request.promise);
    const form = mount(<FinanceGoalProgress />);
    await screen.findByLabelText("Amount");
    type("Amount", "3000");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByLabelText("Amount")).toHaveProperty("disabled", true));
    form.unmount();
    await act(async () =>
      settle === "resolve" ? request.resolve(completed(reserve)) : request.reject(rejection(422)),
    );
    await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("feedback"));
    h.dismiss.mockClear();
  }
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
});

it("needs a timezone to date a statement, and a goal that still exists", async () => {
  h.params = { id: "goal-1" };
  h.timezone = undefined;
  const view = mount(<FinanceGoalProgress />);
  await screen.findByLabelText("Amount");
  expect(
    screen.getByText("Set your account timezone in Settings to choose the date."),
  ).toBeTruthy();
  type("Amount", "3000");
  type("As of (ISO date/time)", "2026-02-01");
  expect(save()).toHaveProperty("disabled", true);
  view.unmount();
  h.params = { id: "goal-3" };
  mount(<FinanceGoalProgress />);
  await screen.findByText("This goal is unavailable.");
});
