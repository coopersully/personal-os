// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GoalEditorScreen, GoalsSettingsScreen } from "./settings";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
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
    state: { user: { id: "owner" } },
    session: {
      api: () => ({
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
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey.includes("motives") && h.params.kind !== "motive" ? h.motives : h.records,
    isPending: h.readState === "pending",
    isError: h.readState === "error",
    isSuccess: h.readState === "success",
    refetch: h.refetch,
  }),
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));
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
  toast: { loading: () => "toast", success: h.success, error: h.error },
}));
vi.mock("../../theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../theme")>()),
  useTheme: () => ({ ink: "black", secondary: "gray", information: "blue", surface: "white" }),
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
beforeEach(() => {
  vi.clearAllMocks();
  h.buttons = [];
  h.records = [goal];
  h.motives = [];
  h.readState = "success";
  h.create.mockResolvedValue(goal);
  h.params = { kind: "goal", id: "goal" };
  h.update.mockResolvedValue(goal);
});
afterEach(cleanup);
it("retains failed draft, sends only edited fields, delivers Sonner and retries", async () => {
  h.update.mockRejectedValueOnce(new Error("Connection lost"));
  render(<GoalEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Swim daily" } });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Connection lost", { id: "toast" }));
  expect(screen.getByLabelText("Title")).toHaveValue("Swim daily");
  expect(screen.queryByText("Connection lost")).toBeNull();
  expect(h.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.update).toHaveBeenLastCalledWith("goal", { title: "Swim daily" });
  expect(h.back).toHaveBeenCalledOnce();
});
it("requires permanent delete confirmation", async () => {
  render(<GoalEditorScreen />);
  fireEvent.click(screen.getByText("Delete goal"));
  expect(h.remove).not.toHaveBeenCalled();
  act(() => h.buttons.find((b) => b.text === "Delete")?.onPress?.());
  await waitFor(() => expect(h.remove).toHaveBeenCalledWith("goal"));
});
it("blocks duplicate saves and dirty navigation until discard", async () => {
  let finish: () => void = () => {};
  h.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<GoalEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
  expect(h.prevent).toBe(true);
  const repeat = vi.fn();
  h.blocked?.({ repeat });
  expect(repeat).not.toHaveBeenCalled();
  expect(h.buttons.map((b) => b.text)).toEqual(["Keep editing", "Discard"]);
  fireEvent.click(screen.getByText("Save changes"));
  fireEvent.click(screen.getByText("Save changes"));
  expect(h.update).toHaveBeenCalledOnce();
  finish();
  await waitFor(() => expect(h.back).toHaveBeenCalled());
});

for (const kind of ["goal", "motive"]) {
  const base =
    kind === "goal"
      ? { ...goal, description: "Reviewed description" }
      : {
          id: "motive",
          title: "Family",
          detail: "Reviewed detail",
          isActive: true,
          createdAt: goal.createdAt,
          updatedAt: goal.updatedAt,
        };
  it(`${kind}: background updates keep untouched draft clean`, () => {
    h.params = { kind, id: base.id };
    h.records = [base];
    const view = render(<GoalEditorScreen />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    h.records = [
      {
        ...base,
        title: "Remote title",
        ...(kind === "goal" ? { description: "Remote description" } : { detail: "Remote detail" }),
      },
    ];
    view.rerender(<GoalEditorScreen />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(h.prevent).toBe(false);
    expect(h.update).not.toHaveBeenCalled();
  });
  it(`${kind}: background updates never turn untouched fields into patches`, async () => {
    h.params = { kind, id: base.id };
    h.records = [base];
    const view = render(<GoalEditorScreen />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Local title" } });
    h.records = [
      {
        ...base,
        ...(kind === "goal"
          ? { description: "Remote description", targetDate: "2026-12-25", progress: 75 }
          : { detail: "Remote detail", isActive: false }),
      },
    ];
    view.rerender(<GoalEditorScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith(base.id, { title: "Local title" }));
    expect(h.back).toHaveBeenCalledOnce();
  });
}

for (const kind of ["goal", "motive"]) {
  it(`${kind}: creates only after explicit Save and preserves nullable fields`, async () => {
    h.params = { kind, id: "" };
    h.records = [];
    render(<GoalEditorScreen />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New personal record" } });
    expect(h.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(h.back).toHaveBeenCalled());
    expect(h.create).toHaveBeenCalledWith(
      kind === "goal"
        ? { title: "New personal record", description: null, targetDate: null, progress: 0 }
        : { title: "New personal record", detail: null },
    );
  });
  it(`${kind}: rejected creation retains draft and permits corrected retry`, async () => {
    h.params = { kind, id: "" };
    h.records = [];
    h.create.mockRejectedValueOnce(new Error("Create unavailable"));
    render(<GoalEditorScreen />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Retain me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("Create unavailable", { id: "toast" }),
    );
    expect(h.back).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue("Retain me");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(h.back).toHaveBeenCalled());
  });
}
it("motive deletion failure retains editor for retry and confirms only server success", async () => {
  h.params = { kind: "motive", id: "motive" };
  h.records = [{ id: "motive", title: "Family", detail: null, isActive: true }];
  h.remove.mockRejectedValueOnce(new Error("Delete unavailable"));
  render(<GoalEditorScreen />);
  fireEvent.click(screen.getByText("Delete motive"));
  await act(async () => h.buttons.find((b) => b.text === "Delete")?.onPress?.());
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Delete unavailable", { id: "toast" }));
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Delete motive"));
  await act(async () => h.buttons.find((b) => b.text === "Delete")?.onPress?.());
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Record deleted", { id: "toast" }));
  expect(h.remove).toHaveBeenLastCalledWith("motive");
});
it("keeps paused goals distinct from completed outcomes and routes selected personal records", () => {
  h.records = [
    goal,
    { ...goal, id: "paused", title: "Paused goal", status: "paused" },
    { ...goal, id: "done", title: "Finished goal", progress: 100, status: "completed" },
  ];
  h.motives = [{ id: "motive", title: "Family", detail: "Why", isActive: false }];
  render(<GoalsSettingsScreen />);
  expect(screen.queryByText(/Finished goal/)).toBeNull();
  fireEvent.click(screen.getByText(/Paused goal/));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/settings/goals/edit",
    params: { kind: "goal", id: "paused" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Completed" }));
  expect(screen.getByText(/Finished goal/)).toBeVisible();
  expect(screen.queryByText(/Paused goal/)).toBeNull();
  fireEvent.click(screen.getByText("Motives"));
  fireEvent.click(screen.getByText(/Family Paused/));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/settings/goals/edit",
    params: { kind: "motive", id: "motive" },
  });
  fireEvent.click(screen.getByText("Add motive"));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/settings/goals/edit",
    params: { kind: "motive" },
  });
});
it("distinguishes read failures from empty lists and offers retry", () => {
  h.records = [];
  h.readState = "error";
  const view = render(<GoalsSettingsScreen />);
  expect(screen.queryByText("No goals yet.")).toBeNull();
  fireEvent.click(screen.getByText("Unable to load. Retry"));
  expect(h.refetch).toHaveBeenCalledOnce();
  h.readState = "success";
  view.rerender(<GoalsSettingsScreen />);
  expect(screen.getByText("No goals yet.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Completed" }));
  expect(screen.getByText("No completed outcomes yet.")).toBeVisible();
});

it("saves edited goal planning fields and pause together as one minimal patch", async () => {
  render(<GoalEditorScreen />);
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Pool twice weekly" },
  });
  fireEvent.change(screen.getByLabelText("Target date"), { target: { value: "2026-12-31" } });
  fireEvent.change(screen.getByLabelText("Progress (%)"), { target: { value: "40" } });
  fireEvent.click(screen.getByLabelText("Active"));
  expect(h.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  expect(h.update).toHaveBeenCalledWith("goal", {
    description: "Pool twice weekly",
    targetDate: "2026-12-31",
    progress: 40,
    status: "paused",
  });
});
it("saves a changed motive explanation without rewriting its title", async () => {
  h.params = { kind: "motive", id: "motive" };
  h.records = [{ id: "motive", title: "Family", detail: null, isActive: true }];
  render(<GoalEditorScreen />);
  fireEvent.change(screen.getByLabelText("Detail"), { target: { value: "Time together" } });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  expect(h.update).toHaveBeenCalledWith("motive", { detail: "Time together" });
});

it("locks all goal draft inputs during save and reopens them with the submitted draft after failure", async () => {
  let reject: (reason: Error) => void = () => {};
  h.update.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(<GoalEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Submitted title" } });
  fireEvent.click(screen.getByText("Save changes"));
  for (const label of ["Title", "Description", "Target date", "Progress (%)"])
    expect(screen.getByLabelText(label)).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Late title" } });
  fireEvent.change(screen.getByLabelText("Progress (%)"), { target: { value: "100" } });
  await act(async () => reject(new Error("Offline")));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.getByLabelText("Title")).toHaveValue("Submitted title");
  expect(screen.getByLabelText("Progress (%)")).toHaveValue("30");
  expect(screen.getByLabelText("Title")).not.toBeDisabled();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Corrected title" } });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  expect(h.update).toHaveBeenLastCalledWith("goal", { title: "Corrected title" });
});
