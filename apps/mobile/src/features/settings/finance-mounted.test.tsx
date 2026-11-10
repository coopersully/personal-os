// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinancialProfileSettingsScreen, PayrollSettingsScreen } from "./finance-settings";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  save: vi.fn(),
  resources: {} as Record<string, unknown>,
}));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "stable-attempt" }));
vi.mock("expo-router", () => ({ router: { back: vi.fn() }, Stack: { Screen: () => null } }));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: () => () => {} }));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({ disabled, onPress }: { disabled: boolean; onPress: () => void }) => (
    <button type="button" aria-label="Save changes" disabled={disabled} onClick={onPress} />
  ),
}));
vi.mock("../../components/forms/planning-picker", () => ({
  PlanningPicker: ({
    label,
    value,
    timeZone,
    mode,
    onChange,
  }: {
    label: string;
    value: string;
    timeZone: string;
    mode: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={label}
      data-native-mode={mode}
      data-timezone={timeZone}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: "fixture", planningTimezone: "America/New_York" } },
    session: { epoch: () => 1 },
  }),
}));
vi.mock("./data", () => ({
  useSettingsResource: (key: string) => ({ data: h.resources[key] }),
  useSettingsAction: () => ({
    pending: false,
    run: async (action: (api: unknown) => Promise<unknown>, success?: string) => {
      try {
        const value = await action({ updateFinancialProfile: h.save });
        if (success) h.success(success);
        return { ok: true, value };
      } catch (error) {
        h.error(error);
        return { ok: false };
      }
    },
  }),
}));
vi.mock("../tasks/ui", () => ({
  Section: ({ children }: PropsWithChildren) => <div>{children}</div>,
  FormBody: ({ children }: PropsWithChildren) => <div data-scroll>{children}</div>,
  State: () => null,
  Choice: () => null,
  ToggleRow: () => null,
  confirm: h.confirm,
  Field: ({
    label,
    value,
    onChangeText,
    editable,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    editable: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
      disabled={!editable}
    />
  ),
  Action: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {label}
    </button>
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.resources = {
    "financial-profile": null,
    "finance-accounts": { accounts: [] },
    "finance-goals": [],
  };
});
it("keeps profile Save outside long collections and uses account-timezone date controls", async () => {
  render(<FinancialProfileSettingsScreen />);
  const save = screen.getByRole("button", { name: "Save changes" });
  expect(save.closest("[data-scroll]")).toBeNull();
  expect(save).toBeDisabled();
  expect(screen.getByLabelText("Next reliable payment")).toHaveAttribute(
    "data-native-mode",
    "date",
  );
  expect(screen.getByLabelText("Next reliable payment")).toHaveAttribute(
    "data-timezone",
    "America/New_York",
  );
  fireEvent.click(screen.getByRole("button", { name: "Add other possible income" }));
  expect(screen.getByLabelText("Expected date")).toHaveAttribute("data-native-mode", "date");
  expect(save).toBeEnabled();
});
it("retains a profile draft and blocks resubmission for an unconfirmed Finance outcome", async () => {
  h.save.mockResolvedValue({
    outcome: "user_input_required",
    communication: { headline: "Need more information" },
    data: null,
  });
  render(<FinancialProfileSettingsScreen />);
  fireEvent.change(screen.getByLabelText("Country and state or region"), {
    target: { value: "US, NY" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  expect(h.save).toHaveBeenCalledWith({
    changes: { jurisdiction: "US, NY" },
    expectedVersion: 0,
    idempotencyKey: "stable-attempt",
  });
  expect(screen.getByLabelText("Country and state or region")).toHaveValue("US, NY");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.queryByText("Need more information")).not.toBeInTheDocument();
});
it("uses the same floating Save and native date picker for payroll", () => {
  h.resources["finance-configuration"] = {
    income: { state: "loaded", value: null },
    accounts: { state: "loaded", value: { accounts: [] } },
  };
  render(<PayrollSettingsScreen />);
  expect(screen.getByLabelText("Next payday")).toHaveAttribute("data-native-mode", "date");
  expect(screen.getByLabelText("Next payday")).toHaveAttribute("data-timezone", "America/New_York");
  expect(screen.getByRole("button", { name: "Save changes" }).closest("[data-scroll]")).toBeNull();
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Engineer" } });
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});
