// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuidanceSettingsScreen, MailSettingsScreen } from "./workspaces";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  error: vi.fn(),
  write: vi.fn(),
  reload: vi.fn(),
  saveGuidance: vi.fn(),
  api: {},
  guidance: null as unknown,
  blocked: false,
}));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ domain: "mail" }),
}));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: () => () => {} }));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({ disabled, onPress }: { disabled: boolean; onPress: () => void }) => (
    <button
      type="button"
      aria-label="Save changes"
      data-floating-save
      disabled={disabled}
      onClick={onPress}
    />
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("./finance-settings", () => ({ FinanceConfigurationSettings: () => null }));
vi.mock("./preferences-hook", () => ({
  useWorkspacePreferenceQueue: () => ({
    blocked: h.blocked,
    current: {
      preferences: {
        includeArchivedInSearch: true,
        mailConversationLayout: "split",
        mailListDensity: "comfortable",
        mailListWidth: 34,
      },
    },
    save: h.write,
    recover: vi.fn(),
  }),
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({ state: { user: { id: "fixture" } }, session: { epoch: () => 1 } }),
}));
vi.mock("./data", () => ({
  useSettingsResource: (key: string) => ({
    data:
      key === "workspace-mail"
        ? {
            workspace: "mail",
            revision: 1,
            preferences: {
              includeArchivedInSearch: true,
              mailConversationLayout: "split",
              mailListDensity: "comfortable",
              mailListWidth: 34,
            },
          }
        : key === "mail-rules"
          ? []
          : h.guidance,
  }),
  useSettingsAction: () => ({
    pending: false,
    run: async (action: (api: unknown) => Promise<unknown>) => {
      try {
        return { ok: true, value: await action(h.api) };
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
    onEndEditing,
    editable,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    onEndEditing?: () => void;
    editable: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
      onBlur={onEndEditing}
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
  h.guidance = null;
  h.blocked = false;
  h.api = { getWorkspaceSettings: h.reload, upsertDomainProfile: h.saveGuidance };
});
it("resets rejected numeric text only after reviewed reload and does not replay it on blur", async () => {
  h.reload.mockResolvedValue({
    workspace: "mail",
    revision: 2,
    preferences: {
      includeArchivedInSearch: true,
      mailConversationLayout: "split",
      mailListDensity: "comfortable",
      mailListWidth: 34,
    },
  });
  render(<MailSettingsScreen />);
  fireEvent.change(screen.getByLabelText("List width (%)"), { target: { value: "150" } });
  await act(async () => fireEvent.blur(screen.getByLabelText("List width (%)")));
  expect(screen.getByLabelText("List width (%)")).toHaveValue("150");
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload and review preferences" }));
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  expect(screen.getByLabelText("List width (%)")).toHaveValue("34");
  expect(screen.getByLabelText("List width (%)")).toBeEnabled();
  await act(async () => fireEvent.blur(screen.getByLabelText("List width (%)")));
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.write).not.toHaveBeenCalled();
});
it("keeps guidance Save floating outside the scroll body and retains a rejected draft", async () => {
  h.guidance = {
    id: "11111111-1111-4111-8111-111111111111",
    domain: "mail",
    version: 4,
    categories: [],
    instructions: [],
    objective: "Existing",
    preferences: {},
    sourceContexts: [],
    status: "draft",
    summary: "Existing",
  };
  h.saveGuidance.mockRejectedValue(new Error("Conflict"));
  render(<GuidanceSettingsScreen />);
  const save = screen.getByRole("button", { name: "Save changes" });
  expect(save.closest("[data-scroll]")).toBeNull();
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Updated objective" } });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  expect(h.saveGuidance).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 4, objective: "Updated objective" }),
  );
  expect(screen.getByLabelText("Objective")).toHaveValue("Updated objective");
  expect(h.error).toHaveBeenCalledOnce();
  expect(screen.queryByText("Conflict")).not.toBeInTheDocument();
});

it("surfaces a reopened blocked queue before allowing another edit", () => {
  h.blocked = true;
  render(<MailSettingsScreen />);
  expect(screen.getByLabelText("List width (%)")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload and review preferences" })).toBeEnabled();
  expect(h.write).not.toHaveBeenCalled();
});
