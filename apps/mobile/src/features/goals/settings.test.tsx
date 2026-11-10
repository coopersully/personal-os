// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GoalEditorScreen } from "./settings";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  back: vi.fn(),
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
  useAuth: () => ({
    state: { user: { id: "owner" } },
    session: {
      api: () => ({
        updateGoal: h.update,
        createGoal: h.create,
        deleteGoal: h.remove,
        updateMotive: h.update,
      }),
    },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: h.records }),
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));
vi.mock("expo-router", () => ({
  router: { back: h.back, push: vi.fn() },
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
vi.mock("../../theme", () => ({
  useTheme: () => ({ ink: "black", secondary: "gray", information: "blue", surface: "white" }),
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("../../components/record-row", () => ({ RecordRow: () => null }));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({ disabled, onPress }: { disabled: boolean; onPress: () => void }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      Save changes
    </button>
  ),
}));
vi.mock("../../components/forms/inline-options", () => ({ InlineOptions: () => null }));
beforeEach(() => {
  vi.clearAllMocks();
  h.buttons = [];
  h.records = [goal];
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
