// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RitualEditorScreen } from "./settings";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  save: vi.fn(),
  list: vi.fn(),
  back: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  invalidate: vi.fn(),
  params: { kind: "night" },
  revision: 2,
}));
const definition = {
  id: "ritual",
  kind: "night",
  title: "Evening",
  enabled: true,
  time: "20:00",
  timeZone: "UTC",
  revision: 2,
  enabledAt: "2026-11-10T00:00:00Z",
  steps: [
    { id: "step", label: "Reflect", kind: "checkbox" },
    {
      id: "choice",
      label: "Energy",
      kind: "multiple_choice",
      options: ["Low", "High"],
      optional: true,
      days: [1, 3, 5],
    },
    { id: "note", label: "Tomorrow", kind: "short_text" },
  ],
};
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: "owner", planningTimezone: "America/New_York" } },
    session: { api: () => ({ saveRitual: h.save, listRituals: h.list }) },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { rituals: [definition] } }),
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
  useInfiniteQuery: () => ({}),
}));
vi.mock("expo-router", () => ({
  router: { back: h.back, push: vi.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => h.params,
  usePreventRemove: () => () => {},
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("expo-secure-store", () => ({ getItemAsync: async () => "device", setItemAsync: vi.fn() }));
vi.mock("expo-file-system", () => ({ File: vi.fn(), Paths: { cache: "cache" } }));
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
  Alert: { alert: vi.fn() },
  Share: { share: vi.fn() },
}));
vi.mock("sonner-native", () => ({
  toast: Object.assign(vi.fn(), {
    loading: () => "toast",
    success: h.success,
    error: h.error,
    dismiss: vi.fn(),
  }),
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
vi.mock("../../components/forms/enum-choice", () => ({
  EnumChoice: ({
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
  h.save.mockResolvedValue(definition);
  h.list.mockResolvedValue({ rituals: [{ ...definition, revision: 3 }] });
});
afterEach(cleanup);
it("saves explicit drafts using profile timezone and displayed revision", async () => {
  render(<RitualEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Evening reflection" } });
  expect(h.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  expect(h.save).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "night",
      title: "Evening reflection",
      expectedRevision: 2,
      timeZone: "America/New_York",
      deviceId: "device",
    }),
  );
});
it("keeps draft after conflict and requires latest revision then explicit retry", async () => {
  h.save.mockRejectedValueOnce(
    new ApiClientError({ status: 409, code: "conflict", message: "Conflict" }),
  );
  render(<RitualEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My evening" } });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.getByLabelText("Title")).toHaveValue("My evening");
  expect(h.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Load latest revision and keep draft"));
  await waitFor(() => expect(h.list).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText("Save changes")).not.toBeDisabled());
  expect(h.save).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
  expect(h.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: "My evening", expectedRevision: 3 }),
  );
});

it("reorders steps in the draft and saves stable identities with their configuration", async () => {
  render(<RitualEditorScreen />);
  expect(screen.getByRole("button", { name: "Move step 1 up" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move step 3 down" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Move step 1 down" }));
  expect(screen.getByLabelText("Step 1")).toHaveValue("Energy");
  expect(screen.getByLabelText("Step 2")).toHaveValue("Reflect");
  expect(h.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Move step 3 up" }));
  expect(screen.getByLabelText("Step 2")).toHaveValue("Tomorrow");
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  expect(h.save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 2,
      steps: [definition.steps[1], definition.steps[2], definition.steps[0]],
    }),
  );
});
it("retains reordered draft on uncertain failure and reuses the unchanged mutation on retry", async () => {
  h.save.mockRejectedValueOnce(new Error("Network interrupted"));
  render(<RitualEditorScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.getByLabelText("Step 1")).toHaveValue("Energy");
  expect(h.back).not.toHaveBeenCalled();
  const attempted = h.save.mock.calls[0]?.[0];
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  expect(h.save.mock.calls[1]?.[0]).toBe(attempted);
});
it("does not submit invalid step choices and retains the invalid draft for correction", async () => {
  render(<RitualEditorScreen />);
  fireEvent.change(screen.getByLabelText("Step 2 options (one per line)"), {
    target: { value: "Only one choice" },
  });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.save).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Step 2 options (one per line)")).toHaveValue("Only one choice");
  expect(h.back).not.toHaveBeenCalled();
});

it("saves schedule and step configuration edits together without issuing premature writes", async () => {
  render(<RitualEditorScreen />);
  fireEvent.click(screen.getByLabelText("Enabled"));
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "21:00" } });
  fireEvent.change(screen.getByLabelText("Reminder time (optional)"), {
    target: { value: "21:30" },
  });
  fireEvent.change(screen.getByLabelText("Step 1"), { target: { value: "Energy level" } });
  fireEvent.click(screen.getAllByText("number")[0]);
  fireEvent.click(screen.getByLabelText("Step 1 optional"));
  fireEvent.click(screen.getByRole("checkbox", { name: "Step 1 days, Sunday" }));
  fireEvent.click(screen.getAllByText("Remove step")[2]);
  fireEvent.click(screen.getByText("Add step"));
  fireEvent.change(screen.getByLabelText("Step 3"), { target: { value: "Next action" } });
  expect(h.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  expect(h.save).toHaveBeenCalledWith(
    expect.objectContaining({
      enabled: false,
      time: "21:00",
      reminderTime: "21:30",
      steps: [
        {
          id: "step",
          label: "Energy level",
          kind: "number",
          optional: true,
          days: [1, 2, 3, 4, 5, 6],
        },
        definition.steps[1],
        { id: "11111111-1111-4111-8111-111111111111", label: "Next action", kind: "checkbox" },
      ],
    }),
  );
});
