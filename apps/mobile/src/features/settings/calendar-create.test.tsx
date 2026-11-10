// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CalendarCreateScreen } from "./calendar-create";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  create: vi.fn(),
  invalidate: vi.fn(),
  back: vi.fn(),
  permitDismiss: vi.fn(),
  timezone: "America/New_York",
}));
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));
vi.mock("expo-router", () => ({ router: { back: h.back }, Stack: { Screen: () => null } }));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({
  useDirtyDismiss: () => h.permitDismiss,
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({ state: { user: { planningTimezone: h.timezone } } }),
}));
vi.mock("./data", () => ({
  useSettingsAction: () => ({
    pending: false,
    run: async (operation: (api: unknown) => Promise<unknown>) => {
      try {
        return { ok: true, value: await operation({ createCalendar: h.create }) };
      } catch {
        return { ok: false };
      }
    },
  }),
}));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../tasks/ui", () => ({
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Section: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Field: ({
    label,
    value,
    onChangeText,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.timezone = "America/New_York";
  h.create.mockResolvedValue({ id: "calendar" });
});
it("requires a name and planning timezone, then creates once from the explicit form and returns", async () => {
  render(<CalendarCreateScreen />);
  expect(h.create).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Create calendar" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Calendar name"), {
    target: { value: "Personal projects" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create calendar" }));
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.create).toHaveBeenCalledExactlyOnceWith({
    name: "Personal projects",
    color: null,
    timezone: "America/New_York",
  });
  expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["settings"] });
  expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["calendar"] });
  expect(h.permitDismiss).toHaveBeenCalledOnce();
});
it("retains the draft and dismissal protection when creation fails", async () => {
  h.create.mockRejectedValue(new Error("offline"));
  render(<CalendarCreateScreen />);
  fireEvent.change(screen.getByLabelText("Calendar name"), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create calendar" }));
  await waitFor(() => expect(h.create).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Calendar name")).toHaveValue("Keep this draft");
  expect(h.back).not.toHaveBeenCalled();
  expect(h.permitDismiss).not.toHaveBeenCalled();
});
it("does not enable creation without the account planning timezone", () => {
  h.timezone = "";
  render(<CalendarCreateScreen />);
  fireEvent.change(screen.getByLabelText("Calendar name"), {
    target: { value: "Personal projects" },
  });
  expect(screen.getByRole("button", { name: "Create calendar" })).toBeDisabled();
});

it("retains an invalid color until corrected, then saves the explicit color with the account timezone", async () => {
  render(<CalendarCreateScreen />);
  fireEvent.change(screen.getByLabelText("Calendar name"), {
    target: { value: "Project calendar" },
  });
  fireEvent.change(screen.getByLabelText("Color (optional)"), {
    target: { value: "invalid-color" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create calendar" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create calendar" })).toBeEnabled(),
  );
  expect(h.create).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Color (optional)")).toHaveValue("invalid-color");
  fireEvent.change(screen.getByLabelText("Color (optional)"), { target: { value: "#7928ff" } });
  fireEvent.click(screen.getByRole("button", { name: "Create calendar" }));
  await waitFor(() =>
    expect(h.create).toHaveBeenCalledWith({
      name: "Project calendar",
      color: "#7928ff",
      timezone: "America/New_York",
    }),
  );
});
