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
  api: {} as Record<string, unknown>,
  openURL: vi.fn(),
  errors: new Set<string>(),
  dismiss: undefined as undefined | (() => void),
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.openURL },
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
    useSettingsResource: (key: string) => {
      const [, refresh] = useState(0);
      return {
        data: h.resources[key],
        isPending: false,
        isError: h.errors.has(key),
        isFetching: false,
        refetch: async () => {
          const result = await h.refresh(key);
          refresh((value) => value + 1);
          return result;
        },
      };
    },
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
  Section: ({ children, title }: PropsWithChildren<{ title?: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  State: ({ loading, retry, empty }: { loading?: boolean; retry?: () => void; empty?: string }) =>
    loading ? (
      <span role="progressbar" />
    ) : retry ? (
      <button type="button" onClick={retry}>
        Retry loading
      </button>
    ) : (
      <span>{empty}</span>
    ),
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
  Choice: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
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
  h.errors.clear();
  h.createToken.mockReset();
  h.refresh.mockReset().mockImplementation(async (key) => ({ data: h.resources[key] }));
  h.resources = {
    "agent-directory": { accounts: [], connections: [] },
    "agent-tokens": [],
    "agent-oauth-clients": [],
    "agent-execution-policy": { version: 9, reviewBypassEnabled: false },
  };
  h.api = { updateExecutionPolicySettings: h.updatePolicy, createAccessToken: h.createToken };
  h.run.mockImplementation(async (action, success) => {
    try {
      const value = await action(h.api);
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

const approve = async () => {
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
};
it("edits an agent identity explicitly and refreshes authoritative directory state without granting scopes", async () => {
  h.resources["agent-directory"] = { accounts: [account], connections: [] };
  const update = vi.fn().mockResolvedValue({});
  h.api = { ...h.api, updateAgentAccount: update };
  render(<AgentsSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Helper" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Updated helper" } });
  fireEvent.change(screen.getByLabelText("Account label"), { target: { value: "Work account" } });
  fireEvent.change(screen.getByLabelText("Platform"), { target: { value: "claude" } });
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith("agent", {
      displayName: "Updated helper",
      accountLabel: "Work account",
      platform: "claude",
    }),
  );
  await waitFor(() => expect(screen.queryByLabelText("Name")).not.toBeInTheDocument());
  expect(h.refresh).toHaveBeenCalledWith("agent-directory");
  expect(h.success).toHaveBeenCalledWith("Agent identity saved");
});
it("retains rejected identity edits and confirms local cancellation before returning", async () => {
  h.resources["agent-directory"] = { accounts: [account], connections: [] };
  const update = vi.fn().mockRejectedValue(new Error("Denied"));
  h.api = { ...h.api, updateAgentAccount: update };
  render(<AgentsSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Helper" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Draft helper" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ message: "Denied" })),
  );
  expect(screen.getByLabelText("Name")).toHaveValue("Draft helper");
  act(() => h.dismiss?.());
  expect(screen.getByLabelText("Name")).toBeVisible();
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Discard identity changes?",
    expect.any(String),
    expect.any(Function),
    true,
  );
  await approve();
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
});
it("requires confirmation to link or unlink existing connections while displaying their actual authority", async () => {
  h.resources["agent-directory"] = {
    accounts: [account],
    connections: [
      {
        id: "connection",
        label: "My client",
        agentAccountId: null,
        scopes: ["tasks:read"],
        active: true,
        lastUsedAt: "2026-11-10T00:00:00.000Z",
      },
    ],
  };
  const link = vi.fn().mockResolvedValue({});
  h.api = { ...h.api, linkAgentAccountConnection: link };
  const { rerender } = render(<AgentsSettingsScreen />);
  expect(screen.getByText("Granted scopes: tasks:read")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Agent identity"), { target: { value: "agent" } });
  expect(link).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Change connection identity?",
    expect.stringContaining("does not add scopes"),
    expect.any(Function),
  );
  await approve();
  expect(link).toHaveBeenCalledWith("connection", { agentAccountId: "agent" });
  h.resources["agent-directory"] = {
    accounts: [account],
    connections: [
      {
        id: "connection",
        label: "My client",
        agentAccountId: "agent",
        scopes: [],
        active: false,
        lastUsedAt: null,
      },
    ],
  };
  rerender(<AgentsSettingsScreen />);
  fireEvent.change(screen.getByLabelText("Agent identity"), { target: { value: "none" } });
  await approve();
  expect(link).toHaveBeenLastCalledWith("connection", { agentAccountId: null });
  expect(screen.getByText("Granted scopes: none")).toBeVisible();
});
it("retains a rejected scope grant draft and validates dependent scopes before transport", async () => {
  h.createToken.mockRejectedValue(new Error("Grant rejected"));
  tokenDraft();
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  await approve();
  expect(screen.getByLabelText("Token name")).toHaveValue("Limited helper");
  expect(screen.getByLabelText("tasks:read")).toBeChecked();
  expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ message: "Grant rejected" }));
  expect(screen.queryByText("New access token")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("tasks:read"));
  fireEvent.click(screen.getByLabelText("texting:write"));
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  await approve();
  expect(h.createToken).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("texting:write")).toBeChecked();
});
it("revokes named token and OAuth grants through confirmed endpoints without exposing a stored secret", async () => {
  h.resources["agent-tokens"] = [
    {
      id: "live-token",
      name: "Live client",
      scopes: ["tasks:read"],
      revokedAt: null,
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    {
      id: "old-token",
      name: "Old client",
      scopes: [],
      revokedAt: "2026-11-10T00:00:00.000Z",
      expiresAt: null,
    },
  ];
  h.resources["agent-oauth-clients"] = [
    { id: "oauth", name: "OAuth client", scopes: ["mail:read"] },
  ];
  const revokeToken = vi.fn().mockResolvedValue(undefined),
    revokeOAuth = vi.fn().mockResolvedValue(undefined);
  h.api = { ...h.api, deleteAccessToken: revokeToken, revokeOAuthClient: revokeOAuth };
  render(<AgentsSettingsScreen />);
  expect(screen.queryByRole("button", { name: "Revoke Old client" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revoke Live client" }));
  expect(revokeToken).not.toHaveBeenCalled();
  await approve();
  expect(revokeToken).toHaveBeenCalledWith("live-token");
  expect(h.refresh).toHaveBeenCalledWith("agent-tokens");
  fireEvent.click(screen.getByRole("button", { name: "Revoke OAuth client" }));
  await approve();
  expect(revokeOAuth).toHaveBeenCalledWith("oauth");
  expect(h.refresh).toHaveBeenCalledWith("agent-oauth-clients");
  expect(screen.queryByLabelText("New access token")).not.toBeInTheDocument();
});
it("shows actual setup readiness and changes workspace instructions without changing permissions", async () => {
  h.resources["agent-setup-status"] = {
    domains: [
      {
        domain: "tasks",
        canRead: true,
        canWrite: false,
        approvedProfileVersion: 3,
        pendingDraftVersion: 4,
      },
      {
        domain: "mail",
        canRead: false,
        canWrite: true,
        approvedProfileVersion: null,
        pendingDraftVersion: null,
      },
    ],
  };
  const setup = (status: string) => ({
    status,
    progress: { completed: 1, total: 3 },
    nextAction: "Review setup",
    steps: [
      {
        id: "review",
        title: "Review guidance",
        state: "current",
        owner: "person",
        description: "Check the instructions",
        instructions: ["Inspect current scopes"],
        userAction: "Approve only intended access",
      },
    ],
  });
  h.resources["agent-setup-tasks"] = setup("in_progress");
  h.resources["agent-setup-mail"] = setup("blocked");
  render(<AgentsSettingsScreen />);
  expect(screen.getByText(/Approved guidance version 3/)).toBeVisible();
  expect(screen.getByText("Inspect current scopes")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Workspace"), { target: { value: "mail" } });
  expect(screen.getByText(/Agent access: no read.*write/)).toBeVisible();
  expect(screen.getByText(/blocked.*1 of 3/)).toBeVisible();
  expect(h.updatePolicy).not.toHaveBeenCalled();
});
it("retains earlier work pages across a later read failure and only hands confirmed reviews to the authoritative web origin", async () => {
  const first = {
    id: "first",
    domain: "tasks",
    priority: "high",
    kind: "review",
    title: "Review first item",
    summary: "First summary",
    preview: [{ label: "Workspace", value: "Tasks" }],
    action: { label: "Review", to: "/tasks/review?id=first" },
  };
  h.resources["agent-context"] = { links: { agentAccess: "https://app.example.com/settings" } };
  h.resources["agent-work-items-root"] = {
    items: [first],
    nextCursor: "second",
    unavailableDomains: ["mail"],
  };
  h.errors.add("agent-work-items-second");
  h.refresh.mockImplementation(async (key) => {
    if (key === "agent-work-items-second") {
      h.errors.delete(key);
      h.resources[key] = {
        items: [
          first,
          {
            ...first,
            id: "next",
            title: "Review next item",
            summary: "Next summary",
            action: null,
          },
        ],
        nextCursor: null,
        unavailableDomains: [],
      };
    }
    return { data: h.resources[key] };
  });
  h.openURL.mockResolvedValue(undefined);
  render(<AgentsSettingsScreen />);
  expect(screen.getByText(/Could not load: mail/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load more agent work" }));
  expect(screen.getByText("First summary")).toBeVisible();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Retry loading agent work" })),
  );
  expect(screen.getByText("Next summary")).toBeVisible();
  expect(screen.getAllByText("First summary")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Review on the web" }));
  expect(h.openURL).not.toHaveBeenCalled();
  await approve();
  expect(h.openURL).toHaveBeenCalledWith("https://app.example.com/tasks/review?id=first");
  expect(h.success).toHaveBeenCalledWith("Requested opening the web flow");
});
it.each([
  "agent-directory",
  "agent-guide",
  "agent-tokens",
  "agent-oauth-clients",
  "agent-setup-tasks",
])("retries the failed %s read without fabricating an empty successful result", async (key) => {
  h.resources[key] = undefined;
  h.errors.add(key);
  render(<AgentsSettingsScreen />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry loading" })));
  expect(h.refresh).toHaveBeenCalledWith(key);
});
