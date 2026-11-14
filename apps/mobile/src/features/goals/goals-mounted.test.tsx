// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePageRefresh } from "../../components/page-refresh";
import { MobileDataProvider } from "../tasks/data";
import { GoalEditorScreen, GoalsSettingsScreen } from "./settings";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  owner: "owner",
  goals: vi.fn(),
  motivesRead: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
  refetch: vi.fn(),
  readState: "success",
  motives: [] as unknown[],
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "goals-refresh"),
  dismiss: vi.fn(),
  invalidate: vi.fn(),
  params: { kind: "goal", id: "goal" },
  records: [] as unknown[],
  buttons: [] as { text: string; onPress?: () => void }[],
  prevent: false,
  blocked: undefined as undefined | ((value: { repeat: () => void }) => void),
}));
const goal = {
  id: "goal",
  title: "Swim",
  description: null,
  targetDate: null,
  progress: 30,
  status: "active",
  createdAt: "2026-11-10T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
};
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner } },
    session: {
      epoch: () => 1,
      api: () => ({
        listGoals: h.goals,
        listMotives: h.motivesRead,
        updateGoal: h.update,
        createGoal: h.create,
        deleteGoal: h.remove,
        updateMotive: h.update,
        createMotive: h.create,
        deleteMotive: h.remove,
      }),
    },
  }),
}));
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
vi.mock("expo-router", () => ({
  router: { back: h.back, push: h.push },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => h.params,
  usePreventRemove: (prevent: boolean, callback: typeof h.blocked) => {
    h.prevent = prevent;
    h.blocked = callback;
    return () => {};
  },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  Switch: ({
    value,
    onValueChange,
    accessibilityLabel,
  }: {
    value: boolean;
    onValueChange: (v: boolean) => void;
    accessibilityLabel: string;
  }) => (
    <input
      type="checkbox"
      aria-label={accessibilityLabel}
      checked={value}
      onChange={(e) => onValueChange(e.target.checked)}
    />
  ),
  Alert: {
    alert: (_title: string, _message: string, buttons: typeof h.buttons) => {
      h.buttons = buttons;
    },
  },
}));
vi.mock("sonner-native", () => ({
  toast: { loading: h.loading, success: h.success, error: h.error, dismiss: h.dismiss },
}));
vi.mock("../../theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../theme")>()),
  useTheme: () => ({ ink: "black", secondary: "gray", information: "blue", surface: "white" }),
}));
vi.mock("../../components/screen", () => ({
  Screen: ({
    children,
    onRefresh,
  }: {
    children: React.ReactNode;
    onRefresh?: () => Promise<unknown>;
  }) => {
    const refresh = usePageRefresh([], onRefresh);
    return (
      <div>
        {children}
        {onRefresh && (
          <button
            type="button"
            aria-busy={refresh.refreshing}
            onClick={() => void refresh.refresh()}
          >
            Refresh personal records
          </button>
        )}
      </div>
    );
  },
}));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("../../components/record-row", () => ({
  RecordRow: ({ title, value, onPress }: { title: string; value: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {title} {value}
    </button>
  ),
}));
vi.mock("../../components/forms/form-save", () => ({
  FloatingAdd: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
  FormSave: ({ disabled, onPress }: { disabled: boolean; onPress: () => void }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      Save changes
    </button>
  ),
}));
vi.mock("../../components/forms/inline-options", () => ({
  InlineOptions: ({
    options,
    onChange,
  }: {
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
  }) => (
    <div>
      {options.map((option) => (
        <button type="button" key={option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

const wrap = (node: React.ReactNode) => (
  <MobileDataProvider key={h.owner}>{node}</MobileDataProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  h.params = { kind: "goal", id: "goal" };
  h.goals.mockResolvedValue([goal]);
  h.motivesRead.mockResolvedValue([]);
});
afterEach(cleanup);
it("loads authoritative goals and motives, then refreshes cached records without empty-success fallback", async () => {
  render(wrap(<GoalsSettingsScreen />));
  const record = await screen.findByText(/Swim/);
  // Records sit in one rounded group, each taking the group's side padding.
  expect(
    record.closest('[data-testid="section-item"]')?.closest('[data-testid="form-group"]'),
  ).toBeTruthy();
  expect(screen.getAllByTestId("form-group")).toHaveLength(1);
  expect(h.goals).toHaveBeenCalledOnce();
  expect(h.motivesRead).toHaveBeenCalledOnce();
  h.goals.mockResolvedValue([{ ...goal, title: "Updated on web" }]);
  fireEvent.click(screen.getByText("Refresh personal records"));
  await screen.findByText(/Updated on web/);
  expect(screen.queryByText(/Swim/)).toBeNull();
  expect(h.goals).toHaveBeenCalledTimes(2);
  expect(h.motivesRead).toHaveBeenCalledTimes(2);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh personal records" })).toHaveAttribute(
      "aria-busy",
      "false",
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.loading).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
});
it("exposes a failed authoritative read and retries without interpreting failure as empty", async () => {
  h.goals.mockRejectedValueOnce(new Error("Offline"));
  render(wrap(<GoalsSettingsScreen />));
  await screen.findByText("Unable to load. Retry");
  expect(screen.queryByText("No goals yet.")).toBeNull();
  expect(h.error).toHaveBeenCalled();
  fireEvent.click(screen.getByText("Unable to load. Retry"));
  await screen.findByText(/Swim/);
  expect(h.goals).toHaveBeenCalledTimes(2);
});
it("retries an editor read and initializes only after the record is received", async () => {
  h.goals.mockRejectedValueOnce(new Error("Offline"));
  render(wrap(<GoalEditorScreen />));
  fireEvent.click(await screen.findByText("Unable to load. Retry"));
  await screen.findByLabelText("Title");
  expect(screen.getByLabelText("Title")).toHaveValue("Swim");
  expect(screen.getByText("Save changes")).toBeDisabled();
  expect(h.update).not.toHaveBeenCalled();
});
it("loads motives through the correct authenticated endpoint and does not substitute goal data", async () => {
  h.params = { kind: "motive", id: "motive" };
  h.motivesRead.mockResolvedValue([
    { id: "motive", title: "Family", detail: "Time together", isActive: true },
  ]);
  render(wrap(<GoalEditorScreen />));
  await screen.findByLabelText("Title");
  expect(screen.getByLabelText("Title")).toHaveValue("Family");
  expect(h.motivesRead).toHaveBeenCalledOnce();
  expect(h.goals).not.toHaveBeenCalled();
});
it("clears the mounted owner's read state when the authenticated account changes", async () => {
  const view = render(wrap(<GoalsSettingsScreen />));
  await screen.findByText(/Swim/);
  h.owner = "second-owner";
  h.goals.mockResolvedValue([]);
  view.rerender(wrap(<GoalsSettingsScreen />));
  const empty = await screen.findByText("No goals yet.");
  expect(empty.closest('[data-testid="form-group"]')).not.toBeNull();
  expect(screen.queryByTestId("section-item")).toBeNull();
  expect(screen.queryByText(/Swim/)).toBeNull();
  expect(h.goals).toHaveBeenCalledTimes(2);
});

it("waits for both personal reads before giving one refresh error and retains both cached lists", async () => {
  render(wrap(<GoalsSettingsScreen />));
  await screen.findByText(/Swim/);
  let failGoals: (reason: Error) => void = () => {},
    failMotives: (reason: Error) => void = () => {};
  h.goals.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failGoals = reject;
      }),
  );
  h.motivesRead.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failMotives = reject;
      }),
  );
  fireEvent.click(screen.getByText("Refresh personal records"));
  await waitFor(() => expect(h.motivesRead).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: "Refresh personal records" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await act(async () => failGoals(new Error("Goals offline")));
  expect(h.error).not.toHaveBeenCalled();
  await act(async () => failMotives(new Error("Motives offline")));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the result. Check your connection and refresh before retrying.",
      { id: undefined },
    ),
  );
  expect(h.loading).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.getByText(/Swim/)).toBeVisible();
  expect(screen.queryByText("Goals offline")).toBeNull();
});
