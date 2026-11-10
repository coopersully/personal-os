// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentsSettingsScreen, agentIdentityInput, agentWorkItemUrl, tokenInput } from "./agents";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  updatePolicy: vi.fn(),
  refresh: vi.fn(),
  run: vi.fn(),
  resources: {} as Record<string, unknown>,
  createToken: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: undefined as undefined | (() => void),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({ children, style }: PropsWithChildren<{ style?: object }>) => (
    <div style={style}>{children}</div>
  ),
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
vi.mock("../../components/editor-header", () => ({
  editorDismissOptions: ({ onPress }: { onPress: () => void }) => {
    h.dismiss = onPress;
    return {};
  },
}));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: () => {} }));
vi.mock("../auth/context", () => ({
  useAuth: () => ({ state: { user: { id: "fixture" } }, session: { epoch: () => 1 } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("./data", async () => {
  const { useState } = await import("react");
  return {
    useSettingsResource: (key: string) => ({
      data: h.resources[key],
      isPending: false,
      isError: false,
      refetch: h.refresh,
    }),
    useSettingsAction: () => {
      const [pending, setPending] = useState(false);
      return {
        pending,
        run: async (action: unknown, success?: unknown) => {
          setPending(true);
          try {
            return await h.run(action, success);
          } finally {
            setPending(false);
          }
        },
      };
    },
  };
});
vi.mock("../tasks/ui", () => ({
  Section: ({ children }: PropsWithChildren) => <div>{children}</div>,
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  State: () => null,
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
      disabled={!editable}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
  Choice: () => null,
  confirm: h.confirm,
  Action: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
  ToggleRow: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: boolean;
    onChange: (next: boolean) => void;
  }) => (
    <input aria-label={label} type="checkbox" checked={value} onChange={() => onChange(!value)} />
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.dismiss = undefined;
  h.resources = {
    "agent-directory": { accounts: [], connections: [] },
    "agent-tokens": [],
    "agent-oauth-clients": [],
    "agent-execution-policy": { version: 9, reviewBypassEnabled: false },
  };
  h.run.mockImplementation(async (action, success) => {
    try {
      const value = await action({
        updateExecutionPolicySettings: h.updatePolicy,
        createAccessToken: h.createToken,
      });
      if (success) h.success(success);
      return { ok: true, value };
    } catch (error) {
      h.error(error);
      return { ok: false };
    }
  });
});
it("requires confirmation before policy broadening and sends the reviewed version", async () => {
  render(<AgentsSettingsScreen />);
  fireEvent.click(screen.getByLabelText("Allow eligible actions without review"));
  expect(h.updatePolicy).not.toHaveBeenCalled();
  expect(h.run).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenCalledWith(
    "Enable review bypass?",
    expect.stringContaining("does not grant scopes"),
    expect.any(Function),
  );
  await act(async () => {
    h.confirm.mock.calls[0][2]();
  });
  expect(h.updatePolicy).toHaveBeenCalledWith({ expectedVersion: 9, reviewBypassEnabled: true });
});
it("requires a named confirmation before revoking an existing token", () => {
  h.resources["agent-tokens"] = [
    {
      id: "token-id",
      name: "Fixture agent",
      scopes: ["tasks:read"],
      revokedAt: null,
      expiresAt: null,
    },
  ];
  render(<AgentsSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Revoke Fixture agent" }));
  expect(h.run).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenCalledWith(
    "Revoke Fixture agent?",
    expect.stringContaining("lose access"),
    expect.any(Function),
    true,
  );
});
it("validates identity and explicitly selected token scopes without adding authority", () => {
  expect(agentIdentityInput(" Helper ", " ", "codex")).toEqual({
    displayName: "Helper",
    accountLabel: null,
    platform: "codex",
  });
  expect(() => agentIdentityInput(" ", "label", "codex")).toThrow();
  expect(tokenInput("Limited helper", ["tasks:read"])).toEqual({
    name: "Limited helper",
    scopes: ["tasks:read"],
  });
  expect(() => tokenInput("helper", [])).toThrow();
  expect(() => tokenInput("helper", ["texting:write"])).toThrow();
});

it("keeps web review handoffs on the authoritative HTTPS origin", () => {
  expect(
    agentWorkItemUrl(
      "https://app.example.com/settings?section=workspace-access",
      "/finances/reviews?id=fixture",
    ),
  ).toBe("https://app.example.com/finances/reviews?id=fixture");
  for (const path of ["https://evil.example", "//evil.example", "/\\evil.example"])
    expect(() => agentWorkItemUrl("https://app.example.com/settings", path)).toThrow();
  expect(() => agentWorkItemUrl("http://app.example.com/settings", "/finances")).toThrow();
});

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

const account = {
  id: "agent",
  displayName: "Helper",
  accountLabel: null,
  platform: "codex",
  updatedAt: "now",
};
function tokenDraft() {
  h.resources["agent-directory"] = { accounts: [account], connections: [] };
  render(<AgentsSettingsScreen />);
  fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "Limited helper" } });
  fireEvent.click(screen.getByLabelText("tasks:read"));
}
it("keeps token drafts mounted when opening and returning from identity editing", () => {
  tokenDraft();
  fireEvent.click(screen.getByRole("button", { name: "Edit Helper" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Helper");
  expect(screen.getByLabelText("Token name")).not.toBeVisible();
  act(() => h.dismiss?.());
  expect(screen.getByLabelText("Token name")).toBeVisible();
  expect(screen.getByLabelText("Token name")).toHaveValue("Limited helper");
  expect(screen.getByLabelText("tasks:read")).toBeChecked();
});
it("retains the one-time secret across identity editing until explicit acknowledgement", async () => {
  h.createToken.mockResolvedValue({ token: "synthetic-token" });
  tokenDraft();
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  await waitFor(() => expect(screen.getByText("synthetic-token")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "Edit Helper" }));
  expect(screen.getByText("synthetic-token")).not.toBeVisible();
  act(() => h.dismiss?.());
  expect(screen.getByText("synthetic-token")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "I saved the token" }));
  expect(screen.queryByText("synthetic-token")).not.toBeInTheDocument();
});
it("blocks identity transitions while a token creation is pending", async () => {
  let finish!: (value: { token: string }) => void;
  h.createToken.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  tokenDraft();
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  act(() => h.confirm.mock.calls.at(-1)?.[2]());
  await waitFor(() => expect(screen.getByRole("button", { name: "Edit Helper" })).toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Edit Helper" }));
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  await act(async () => finish({ token: "synthetic-token" }));
});
it("routes refresh success and cached refresh failure through shared Sonner action feedback", async () => {
  h.refresh.mockResolvedValueOnce({
    data: { version: 9, reviewBypassEnabled: false },
    error: null,
  });
  render(<AgentsSettingsScreen />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh execution policy" })),
  );
  expect(h.success).toHaveBeenCalledWith("Execution policy refreshed");
  h.refresh.mockResolvedValueOnce({
    data: { version: 9, reviewBypassEnabled: false },
    error: new Error("Refresh unavailable"),
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh execution policy" })),
  );
  expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ message: "Refresh unavailable" }));
  expect(screen.queryByText("Refresh unavailable")).not.toBeInTheDocument();
  expect(h.success).toHaveBeenCalledTimes(1);
});

vi.mock("sonner-native", () => ({ toast: { error: h.error } }));
vi.mock("../tasks/data", () => ({ errorMessage: (error: Error) => error.message }));
