// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import { AgentsSettingsScreen } from "./agents";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  api: {} as Record<string, unknown>,
  policy: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(() => "policy-toast"),
  success: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: "fixture" } },
    session: { epoch: () => 1, api: () => h.api },
  }),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, loading: h.loading, success: h.success, dismiss: h.dismiss },
}));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({ children, style }: PropsWithChildren<{ style?: object }>) => (
    <div style={style}>{children}</div>
  ),
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/forms/form-save", () => ({ FormSave: () => null }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: () => () => {} }));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("../tasks/ui", () => ({
  Section: ({ children }: PropsWithChildren) => <div>{children}</div>,
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Field: () => null,
  Choice: () => null,
  State: () => null,
  Action: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
  ToggleRow: ({ label, value }: { label: string; value: boolean }) => (
    <input type="checkbox" aria-label={label} checked={value} readOnly />
  ),
  confirm: vi.fn(),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.policy.mockReset();
  h.api = {
    getExecutionPolicySettings: h.policy,
    listAgentAccounts: async () => ({ accounts: [], connections: [] }),
    getAgentConnectionGuide: async () => null,
    listAccessTokens: async () => [],
    listOAuthClients: async () => [],
    getAssistantSetupStatus: async () => ({ domains: [] }),
    getPersonalOsSetup: async () => null,
    getPersonalOsContext: async () => null,
    listAgentAccessWorkItems: async () => ({ items: [], unavailableDomains: [], nextCursor: null }),
  };
});
const show = () =>
  render(
    <MobileDataProvider>
      <AgentsSettingsScreen />
    </MobileDataProvider>,
  );
it("uses exactly one loading-to-error toast for a cached policy refresh with the real provider QueryCache", async () => {
  h.policy
    .mockResolvedValueOnce({ version: 9, reviewBypassEnabled: false })
    .mockRejectedValueOnce(new Error("Offline"));
  show();
  await screen.findByLabelText("Allow eligible actions without review");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh execution policy" })),
  );
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(h.loading).toHaveBeenCalledOnce();
  expect(h.error).toHaveBeenCalledWith(expect.any(String), { id: "policy-toast" });
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Allow eligible actions without review")).not.toBeChecked();
  expect(screen.queryByText(h.error.mock.calls[0]?.[0])).not.toBeInTheDocument();
});
it("keeps initial policy read failures visible through one local Sonner without the global duplicate", async () => {
  h.policy.mockRejectedValue(new Error("Offline"));
  show();
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(h.error.mock.calls[0]).toHaveLength(1);
  expect(h.loading).not.toHaveBeenCalled();
  expect(screen.queryByText(h.error.mock.calls[0]?.[0])).not.toBeInTheDocument();
  h.error.mockClear();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh execution policy" })),
  );
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(h.error).toHaveBeenCalledWith(expect.any(String), { id: "policy-toast" });
  expect(h.loading).toHaveBeenCalledOnce();
});
it("updates one loading toast on a successful cached policy refresh", async () => {
  h.policy
    .mockResolvedValueOnce({ version: 9, reviewBypassEnabled: false })
    .mockResolvedValueOnce({ version: 10, reviewBypassEnabled: true });
  show();
  await screen.findByLabelText("Allow eligible actions without review");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh execution policy" })),
  );
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Execution policy refreshed", { id: "policy-toast" }),
  );
  expect(h.loading).toHaveBeenCalledOnce();
  expect(h.error).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Allow eligible actions without review")).toBeChecked();
  expect(screen.queryByText("Execution policy refreshed")).not.toBeInTheDocument();
});
