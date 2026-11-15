// @vitest-environment jsdom
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type PropsWithChildren, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import { AgentPolicyScreen } from "./agents";

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
  update: vi.fn(),
  confirm: vi.fn(),
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
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useNavigation: () => ({
    getState: () => ({ index: 1 }),
    isFocused: () => true,
    addListener: () => () => {},
  }),
}));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/forms/form-save", () => ({ FormSave: () => null }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: () => () => {} }));
vi.mock("../../theme", () => ({
  useTheme: () => ({}),
  spacing: { xs: 4, md: 12, lg: 16 },
  workspaceColor: () => "#123456",
}));
vi.mock("../tasks/ui", () => ({ Choice: () => null, State: () => null, confirm: h.confirm }));
vi.mock("../../components/forms/form-rows", () => ({
  formBlock: {},
  Section: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SectionNote: () => null,
  SectionFootnote: () => null,
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Field: () => null,
  ToggleRow: ({
    label,
    detail,
    value,
    disabled,
    onChange,
  }: {
    label: string;
    detail?: string;
    value: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void;
  }) => (
    <>
      <input
        type="checkbox"
        aria-label={label}
        checked={value}
        disabled={disabled}
        onChange={() => onChange(!value)}
      />
      {detail && <p>{detail}</p>}
    </>
  ),
}));
vi.mock("./settings-row", () => ({
  SettingsRow: () => null,
  SettingsDetailRow: () => null,
  SettingsActionRow: ({
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
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.policy.mockReset();
  h.update.mockReset();
  h.api = {
    getExecutionPolicySettings: h.policy,
    updateExecutionPolicySettings: h.update,
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
let client: QueryClient | undefined;
function CaptureClient() {
  client = useQueryClient();
  return null;
}
const show = () =>
  render(
    <MobileDataProvider>
      <CaptureClient />
      <AgentPolicyScreen />
    </MobileDataProvider>,
  );
it("uses exactly one loading-to-error toast for a cached policy refresh with the real provider QueryCache", async () => {
  h.policy
    .mockResolvedValueOnce({ version: 9, reviewBypassEnabled: false })
    .mockRejectedValueOnce(new Error("Offline"));
  show();
  await screen.findByLabelText("Apply eligible work without waiting in Review");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh review policy" })),
  );
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(h.loading).toHaveBeenCalledOnce();
  expect(h.error).toHaveBeenCalledWith(expect.any(String), { id: "policy-toast" });
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Apply eligible work without waiting in Review")).not.toBeChecked();
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
    fireEvent.click(screen.getByRole("button", { name: "Refresh review policy" })),
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
  await screen.findByLabelText("Apply eligible work without waiting in Review");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh review policy" })),
  );
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Review policy refreshed", { id: "policy-toast" }),
  );
  expect(h.loading).toHaveBeenCalledOnce();
  expect(h.error).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Apply eligible work without waiting in Review")).toBeChecked();
  expect(screen.queryByText("Review policy refreshed")).not.toBeInTheDocument();
});
it("reports a later background read failure once while keeping the cached policy on screen", async () => {
  h.policy
    .mockResolvedValueOnce({ version: 9, reviewBypassEnabled: true })
    .mockRejectedValueOnce(new Error("Offline"));
  show();
  await screen.findByLabelText("Apply eligible work without waiting in Review");
  expect(h.error).not.toHaveBeenCalled();
  await act(async () => {
    await client?.refetchQueries();
  });
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  // Reported by the screen itself: no loading toast and no toast id to update.
  expect(h.error.mock.calls[0]).toHaveLength(1);
  expect(h.loading).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Apply eligible work without waiting in Review")).toBeChecked();
  expect(screen.queryByText(h.error.mock.calls[0]?.[0])).not.toBeInTheDocument();
});
const label = "Apply eligible work without waiting in Review";
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flipAndConfirm = async () => {
  fireEvent.click(screen.getByLabelText(label));
  await act(async () => {
    await h.confirm.mock.calls.at(-1)?.[2]();
  });
};
it("shows the saved policy after a save without reading it a second time", async () => {
  h.policy.mockResolvedValue({ version: 9, reviewBypassEnabled: false });
  h.update.mockResolvedValue({ version: 10, reviewBypassEnabled: true });
  show();
  await screen.findByLabelText(label);
  await flipAndConfirm();
  expect(h.update).toHaveBeenCalledWith({ expectedVersion: 9, reviewBypassEnabled: true });
  await waitFor(() => expect(screen.getByLabelText(label)).toBeChecked());
  expect(screen.getByLabelText(label)).toBeEnabled();
  expect(h.policy).toHaveBeenCalledOnce();
  expect(h.success).toHaveBeenCalledWith("Review policy saved", { id: "policy-toast" });
  // The next save uses the accepted version, not the one read before the save.
  h.update.mockResolvedValue({ version: 11, reviewBypassEnabled: false });
  await flipAndConfirm();
  expect(h.update).toHaveBeenLastCalledWith({ expectedVersion: 10, reviewBypassEnabled: false });
});
it("does not let a read that started before the save overwrite the saved policy", async () => {
  h.policy.mockResolvedValueOnce({ version: 9, reviewBypassEnabled: false });
  show();
  await screen.findByLabelText(label);
  const save = deferred<{ version: number; reviewBypassEnabled: boolean }>();
  h.update.mockReturnValue(save.promise);
  fireEvent.click(screen.getByLabelText(label));
  let saving!: Promise<unknown>;
  act(() => {
    saving = h.confirm.mock.calls.at(-1)?.[2]();
  });
  // A background read starts while the save is in flight and answers with the old policy.
  const staleRead = deferred<{ version: number; reviewBypassEnabled: boolean }>();
  h.policy.mockReturnValueOnce(staleRead.promise);
  let reading!: Promise<unknown>;
  act(() => {
    reading = client?.refetchQueries() ?? Promise.resolve();
  });
  await waitFor(() => expect(h.policy).toHaveBeenCalledTimes(2));
  // While a read is in flight the switch cannot start another change.
  expect(screen.getByLabelText(label)).toBeDisabled();
  await act(async () => {
    save.resolve({ version: 10, reviewBypassEnabled: true });
    await saving;
  });
  await act(async () => {
    staleRead.resolve({ version: 9, reviewBypassEnabled: false });
    await reading.catch(() => {});
  });
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
  expect(screen.getByLabelText(label)).toBeChecked();
  h.update.mockResolvedValue({ version: 11, reviewBypassEnabled: false });
  await flipAndConfirm();
  expect(h.update).toHaveBeenLastCalledWith({ expectedVersion: 10, reviewBypassEnabled: false });
});
it("re-reads and stays blocked when the screen is reopened after an uncertain save", async () => {
  let setOpen!: (open: boolean) => void;
  function Reopenable() {
    const [open, set] = useState(true);
    setOpen = set;
    return open ? <AgentPolicyScreen /> : null;
  }
  h.policy.mockResolvedValue({ version: 9, reviewBypassEnabled: false });
  h.update.mockRejectedValue(new Error("Network request timed out"));
  render(
    <MobileDataProvider>
      <Reopenable />
    </MobileDataProvider>,
  );
  await screen.findByLabelText(label);
  await flipAndConfirm();
  await waitFor(() => expect(screen.getByLabelText(label)).toBeDisabled());
  expect(screen.getByLabelText(label)).toBeChecked();
  expect(h.policy).toHaveBeenCalledOnce();
  act(() => setOpen(false));
  expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
  // Reopened: the cached "off" is not presented as the saved policy, and it is read again.
  // The server did apply the timed-out save.
  h.policy.mockResolvedValue({ version: 10, reviewBypassEnabled: true });
  act(() => setOpen(true));
  expect(screen.getByLabelText(label)).toBeChecked();
  expect(screen.getByLabelText(label)).toBeDisabled();
  expect(screen.getByText(/^Not confirmed/)).toBeVisible();
  await waitFor(() => expect(h.policy).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText(label)).toBeDisabled();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh review policy" })),
  );
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
  expect(screen.getByLabelText(label)).toBeChecked();
  expect(screen.queryByText(/^Not confirmed/)).not.toBeInTheDocument();
});
