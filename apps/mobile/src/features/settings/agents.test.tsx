// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type { AccessScope } from "@personal-os/domain";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scopeLabels, scopePrerequisites, toggleScope } from "./agent-copy";
import {
  AgentAccessScreen,
  AgentPolicyScreen,
  AgentReviewsScreen,
  AgentSetupScreen,
  agentIdentityInput,
  agentWorkItemUrl,
  ConnectedAgentsScreen,
  tokenInput,
  tokenPresets,
} from "./agents";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  setQueryData: vi.fn(),
  invalidate: vi.fn(),
  cancelQueries: vi.fn(),
  removeQueries: vi.fn(),
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
  dirtyGuard: vi.fn(),
  dismiss: undefined as undefined | (() => void),
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.openURL },
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({ children, style }: PropsWithChildren<{ style?: object }>) => (
    <div style={style}>{children}</div>
  ),
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  Stack: { Screen: () => null },
  useNavigation: () => ({
    getState: () => ({ index: 1 }),
    isFocused: () => true,
    addListener: () => () => {},
  }),
}));
vi.mock("../../components/editor-header", () => ({
  editorDismissOptions: ({ onPress }: { onPress: () => void }) => {
    h.dismiss = onPress;
    return {};
  },
}));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({
  useDirtyDismiss: (dirty: boolean, pending: boolean) => h.dirtyGuard(dirty, pending),
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({ state: { user: { id: "fixture" } }, session: { epoch: () => 1 } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: h.invalidate,
    cancelQueries: h.cancelQueries,
    getQueryData: () => undefined,
    setQueryData: h.setQueryData,
    setQueryDefaults: vi.fn(),
    removeQueries: h.removeQueries,
  }),
}));
type Row = { label: string; value?: string; disabled?: boolean; onPress?: () => void };
vi.mock("./settings-row", () => ({
  SettingsRow: ({ label, onPress }: Row) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
  SettingsActionRow: ({ label, disabled, onPress }: Row) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
  SettingsDetailRow: ({ label, value }: Row) => (
    <span>
      {label}: {value}
    </span>
  ),
}));
vi.mock("../../theme", () => ({ useTheme: () => ({}), spacing: {} }));
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
    useSettingsRefresh: (
      _keys: unknown,
      refetches: (() => Promise<{ error?: unknown }>)[],
      message: string,
    ) => ({
      pending: false,
      refresh: () =>
        h.run(async () => {
          for (const refetch of refetches) {
            const result = await refetch();
            if (result.error) throw result.error;
          }
        }, message),
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
}));
vi.mock("../../components/forms/form-rows", () => ({
  formBlock: {},
  Section: ({ children, title }: PropsWithChildren<{ title?: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  SectionNote: ({ children }: PropsWithChildren) => <p>{children}</p>,
  SectionFootnote: ({ children }: PropsWithChildren) => <p>{children}</p>,
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Field: ({
    label,
    value,
    onChangeText,
    editable,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    editable?: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={editable === false}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
  ToggleRow: ({
    label,
    detail,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    detail?: string;
    value: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
  }) => (
    <>
      <input
        aria-label={label}
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={() => onChange(!value)}
      />
      {detail && <p>{detail}</p>}
    </>
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
  render(<AgentPolicyScreen />);
  fireEvent.click(screen.getByLabelText("Apply eligible work without waiting in Review"));
  expect(h.updatePolicy).not.toHaveBeenCalled();
  expect(h.run).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenCalledWith(
    "Apply eligible work without review?",
    "Agents that hold an execute permission will act without waiting in Reviews. That includes Finance approvals and account changes, sending mail, and syncing or disconnecting sources. Questions and required approvals still apply.",
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
  render(<AgentAccessScreen />);
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
  render(<AgentAccessScreen />);
  fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "Limited helper" } });
  fireEvent.click(screen.getByLabelText("Read tasks"));
}
it("retains token draft across access rerenders and guards native dismissal", () => {
  tokenDraft();
  expect(h.dirtyGuard).toHaveBeenLastCalledWith(true, false);
  expect(screen.getByLabelText("Token name")).toHaveValue("Limited helper");
  expect(screen.getByLabelText("Read tasks")).toBeChecked();
});
it("retains the one-time secret until explicit acknowledgement and guards native dismissal", async () => {
  h.createToken.mockResolvedValue({ token: "synthetic-token" });
  tokenDraft();
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  await waitFor(() => expect(screen.getByText("synthetic-token")).toBeVisible());
  expect(h.dirtyGuard).toHaveBeenLastCalledWith(true, false);
  fireEvent.click(screen.getByRole("button", { name: "I saved the token" }));
  expect(screen.queryByText("synthetic-token")).not.toBeInTheDocument();
});
it("guards native dismissal while token creation is pending", async () => {
  let finish!: (value: { token: string }) => void;
  h.createToken.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  tokenDraft();
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  act(() => h.confirm.mock.calls.at(-1)?.[2]());
  await waitFor(() => expect(h.dirtyGuard).toHaveBeenLastCalledWith(true, true));
  expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
  await act(async () => finish({ token: "synthetic-token" }));
});
it("routes refresh success and cached refresh failure through shared Sonner action feedback", async () => {
  h.refresh.mockResolvedValueOnce({
    data: { version: 9, reviewBypassEnabled: false },
    error: null,
  });
  render(<AgentPolicyScreen />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh review policy" })),
  );
  expect(h.success).toHaveBeenCalledWith("Review policy refreshed");
  h.refresh.mockResolvedValueOnce({
    data: { version: 9, reviewBypassEnabled: false },
    error: new Error("Refresh unavailable"),
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh review policy" })),
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
  render(<ConnectedAgentsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Helper" }));
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
  expect(h.success).toHaveBeenCalledWith("Agent details saved");
});
it("retains rejected identity edits and confirms local cancellation before returning", async () => {
  h.resources["agent-directory"] = { accounts: [account], connections: [] };
  const update = vi.fn().mockRejectedValue(new Error("Denied"));
  h.api = { ...h.api, updateAgentAccount: update };
  render(<ConnectedAgentsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Helper" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Draft helper" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ message: "Denied" })),
  );
  expect(screen.getByLabelText("Name")).toHaveValue("Draft helper");
  act(() => h.dismiss?.());
  expect(screen.getByLabelText("Name")).toBeVisible();
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Discard agent details?",
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
  const { rerender } = render(<ConnectedAgentsScreen />);
  expect(screen.getByText("Tasks: read")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "agent" } });
  expect(link).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Change this connection’s agent?",
    "My client will appear as Helper. This does not change its permissions.",
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
  rerender(<ConnectedAgentsScreen />);
  fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "none" } });
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Change this connection’s agent?",
    "My client will no longer be linked to an agent. This does not change its permissions.",
    expect.any(Function),
  );
  await approve();
  expect(link).toHaveBeenLastCalledWith("connection", { agentAccountId: null });
  expect(screen.getByText("None")).toBeVisible();
});
it("retains a rejected scope grant draft and validates dependent scopes before transport", async () => {
  h.createToken.mockRejectedValue(new Error("Grant rejected"));
  tokenDraft();
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  await approve();
  expect(screen.getByLabelText("Token name")).toHaveValue("Limited helper");
  expect(screen.getByLabelText("Read tasks")).toBeChecked();
  expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ message: "Grant rejected" }));
  expect(screen.queryByText("New access token")).not.toBeInTheDocument();
});
it("keeps sending texts tied to reading them so a token the server would refuse is never offered", async () => {
  h.createToken.mockResolvedValue({ token: "texting-token" });
  render(<AgentAccessScreen />);
  const send = () => screen.getByLabelText("Send text messages");
  const read = () => screen.getByLabelText("Read text conversation");
  fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "Text helper" } });
  // Turning on send also turns on the read permission it needs.
  fireEvent.click(send());
  expect(send()).toBeChecked();
  expect(read()).toBeChecked();
  // Turning read off takes send with it; turning send off leaves read alone.
  fireEvent.click(read());
  expect(send()).not.toBeChecked();
  expect(read()).not.toBeChecked();
  fireEvent.click(send());
  fireEvent.click(send());
  expect(send()).not.toBeChecked();
  expect(read()).toBeChecked();
  fireEvent.click(send());
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Grant agent access?",
    "Text helper will receive these permissions:\n• Read text conversation\n• Send text messages. Needs “Read text conversation”, so that is turned on with it.\nKeep its token private.",
    expect.any(Function),
  );
  await approve();
  // The request passes validation and reaches the server; nothing is reported as a failure.
  expect(h.createToken).toHaveBeenCalledWith({
    name: "Text helper",
    scopes: ["texting:read", "texting:write"],
  });
  expect(h.error).not.toHaveBeenCalled();
});
it("only pairs the permissions the token schema requires", () => {
  expect(scopePrerequisites).toEqual({ "texting:write": "texting:read" });
  for (const [scope, needed] of Object.entries(scopePrerequisites)) {
    expect(() => tokenInput("helper", [scope as AccessScope])).toThrow();
    expect(() => tokenInput("helper", [scope as AccessScope, needed])).not.toThrow();
  }
  expect(toggleScope(["tasks:read"], "texting:write", true)).toEqual([
    "tasks:read",
    "texting:write",
    "texting:read",
  ]);
  expect(
    toggleScope(["texting:read", "texting:write", "tasks:read"], "texting:read", false),
  ).toEqual(["tasks:read"]);
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
  render(<AgentAccessScreen />);
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
  expect(screen.queryByText("New access token")).not.toBeInTheDocument();
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
  render(<AgentSetupScreen />);
  expect(screen.getByText("Approved guidance: Version 3")).toBeVisible();
  expect(screen.getByText("Inspect current scopes")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Workspace"), { target: { value: "mail" } });
  expect(screen.getByText("Agent can read: No")).toBeVisible();
  expect(screen.getByText("Agent can make changes: Yes")).toBeVisible();
  expect(screen.getByText("Status: Blocked")).toBeVisible();
  expect(screen.getByText("Steps done: 1 of 3")).toBeVisible();
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
  render(<AgentReviewsScreen />);
  expect(screen.getByText(/Could not load Mail\./)).toBeVisible();
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
  const Page =
    key === "agent-directory"
      ? ConnectedAgentsScreen
      : key === "agent-guide" || key === "agent-setup-tasks"
        ? AgentSetupScreen
        : AgentAccessScreen;
  render(<Page />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry loading" })));
  expect(h.refresh).toHaveBeenCalledWith(key);
});

it("matches web permission presets, changes only draft scopes, and keeps custom toggles behind explicit grant confirmation", async () => {
  h.createToken.mockResolvedValue({ token: "preset-secret" });
  render(<AgentAccessScreen />);
  expect(tokenPresets.map((preset) => preset.name)).toEqual([
    "Mail setup",
    "Calendar & planning",
    "Daily brief",
    "Full nohmi",
  ]);
  for (const preset of tokenPresets) {
    fireEvent.change(screen.getByLabelText("Permission preset"), {
      target: { value: preset.name },
    });
    for (const scope of preset.scopes)
      expect(screen.getByLabelText(scopeLabels[scope])).toBeChecked();
    expect(h.createToken).not.toHaveBeenCalled();
  }
  fireEvent.change(screen.getByLabelText("Permission preset"), { target: { value: "Mail setup" } });
  expect(screen.getByLabelText("Read mail")).toBeChecked();
  expect(screen.getByLabelText("Manage mail")).toBeChecked();
  // Memory is on by default in every preset; the read-only Daily brief only reads it.
  expect(screen.getByLabelText("Read memory")).toBeChecked();
  expect(screen.getByLabelText("Save memory")).toBeChecked();
  expect(tokenPresets.find((preset) => preset.name === "Daily brief")?.scopes).not.toContain(
    "knowledge:write",
  );
  expect(screen.getByLabelText("Read tasks")).not.toBeChecked();
  fireEvent.click(screen.getByLabelText("Read tasks"));
  expect(screen.getByLabelText("Permission preset")).toHaveValue("custom");
  expect(h.createToken).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "Preset helper" } });
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  expect(h.createToken).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Grant agent access?",
    "Preset helper will receive these permissions:\n• Read mail\n• Manage mail\n• Read memory\n• Save memory\n• Read tasks\nKeep its token private.",
    expect.any(Function),
  );
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  expect(h.createToken).toHaveBeenCalledWith({
    name: "Preset helper",
    scopes: ["mail:read", "mail:write", "knowledge:read", "knowledge:write", "tasks:read"],
  });
});

it("states the full reach of every permission in the grant confirmation", () => {
  render(<AgentAccessScreen />);
  fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "Wide helper" } });
  for (const label of [
    "Read tasks",
    "Change notification preferences",
    "Execute Finance approvals, account changes and settings",
    "Execute Mail approvals, sending and settings",
    "Change Calendar settings",
    "Change Tasks settings",
    "Maintain Finances",
  ])
    fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  const message = h.confirm.mock.calls.at(-1)?.[1] as string;
  expect(h.confirm.mock.calls.at(-1)?.[0]).toBe("Grant agent access?");
  expect(message).toContain("• Read tasks\n");
  expect(message).toContain(
    "• Change notification preferences. Only when your review policy lets eligible work skip Reviews, it can change notification preferences or disconnect the verified Texting destination.",
  );
  expect(message).toContain(
    "it can disconnect or delete financial accounts, resolve duplicate accounts, change budget policies and automation schedules, and sync banks.",
  );
  expect(message).toContain("It can send mail, which cannot be undone, and activate mail rules.");
  // Each of the three execute permissions states that it can sync or disconnect shared sources.
  expect(message.match(/it can also sync or disconnect shared sources/g)).toHaveLength(3);
  expect(message).toContain("• Maintain Finances. Sync providers, reconcile and categorize");
  expect(message).not.toMatch(/\b[a-z]+:(read|write|execute|maintain)\b/);
  expect(h.createToken).not.toHaveBeenCalled();
});
it("retries failed workspace setup status and authoritative web review links without granting scopes", async () => {
  h.errors.add("agent-setup-status");
  h.errors.add("agent-context");
  const view = render(<AgentSetupScreen />);
  fireEvent.click(screen.getByText("Retry setup status"));
  await waitFor(() => expect(h.refresh).toHaveBeenCalledWith("agent-setup-status"));
  view.rerender(<AgentReviewsScreen />);
  fireEvent.click(screen.getByText("Retry web review links"));
  await waitFor(() => expect(h.refresh).toHaveBeenCalledWith("agent-context"));
  expect(h.createToken).not.toHaveBeenCalled();
});

it("closes pristine identity edits without unnecessary confirmation", () => {
  h.resources["agent-directory"] = { accounts: [account], connections: [] };
  render(<ConnectedAgentsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Helper" }));
  act(() => h.dismiss?.());
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(h.confirm).not.toHaveBeenCalled();
});
it("requires named confirmation before narrowing review bypass using the reviewed version", async () => {
  h.resources["agent-execution-policy"] = { version: 12, reviewBypassEnabled: true };
  render(<AgentPolicyScreen />);
  fireEvent.click(screen.getByLabelText("Apply eligible work without waiting in Review"));
  expect(h.confirm).toHaveBeenCalledWith(
    "Send eligible work to Reviews?",
    "Eligible work will wait in Reviews until you decide.",
    expect.any(Function),
  );
  await approve();
  expect(h.updatePolicy).toHaveBeenCalledWith({ expectedVersion: 12, reviewBypassEnabled: false });
});
const policySwitch = () => screen.getByLabelText("Apply eligible work without waiting in Review");
it("shows the policy the server accepted without depending on a second read", async () => {
  const saved = { version: 10, reviewBypassEnabled: true };
  h.updatePolicy.mockResolvedValue(saved);
  render(<AgentPolicyScreen />);
  fireEvent.click(policySwitch());
  await approve();
  expect(h.setQueryData).toHaveBeenCalledWith(
    ["settings", "fixture", 1, "agent-execution-policy"],
    saved,
  );
  expect(h.refresh).not.toHaveBeenCalledWith("agent-execution-policy");
  // Any read already in flight is cancelled before the accepted policy is stored.
  expect(h.cancelQueries).toHaveBeenCalledWith({
    queryKey: ["settings", "fixture", 1, "agent-execution-policy"],
    exact: true,
  });
  expect(h.cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(
    h.setQueryData.mock.invocationCallOrder[0] ?? 0,
  );
  expect(h.success).toHaveBeenCalledWith("Review policy saved");
  expect(policySwitch()).toBeEnabled();
});
const rejection = (status: number) =>
  new ApiClientError({ code: "rejected", status, message: `Rejected ${status}` });
it.each([
  [409, true],
  [403, false],
  [422, false],
])("keeps the saved policy on the switch after a definite %i rejection", async (status, rereads) => {
  h.updatePolicy.mockRejectedValue(rejection(status));
  render(<AgentPolicyScreen />);
  fireEvent.click(policySwitch());
  await approve();
  expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ status }));
  // Nothing was written, so the switch stays on what the server holds and stays usable.
  expect(policySwitch()).not.toBeChecked();
  expect(policySwitch()).toBeEnabled();
  expect(screen.queryByText(/^Not confirmed/)).not.toBeInTheDocument();
  expect(h.setQueryData).not.toHaveBeenCalled();
  expect(h.invalidate).not.toHaveBeenCalled();
  // Only a conflict means the policy on screen is out of date.
  expect(h.refresh.mock.calls.filter(([key]) => key === "agent-execution-policy")).toHaveLength(
    rereads ? 1 : 0,
  );
});
it("keeps an uncertain policy change visible and blocks further changes until a refresh succeeds", async () => {
  h.updatePolicy.mockRejectedValue(new Error("Network request timed out"));
  render(<AgentPolicyScreen />);
  fireEvent.click(policySwitch());
  await approve();
  expect(h.error).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Network request timed out" }),
  );
  expect(policySwitch()).toBeChecked();
  expect(policySwitch()).toBeDisabled();
  expect(screen.getByText(/^Not confirmed\. Refresh the review policy/)).toBeVisible();
  expect(screen.queryByText("Network request timed out")).not.toBeInTheDocument();
  // The cached policy is marked stale and the attempt is remembered beside it.
  const policyKey = ["settings", "fixture", 1, "agent-execution-policy"];
  expect(h.setQueryData).toHaveBeenCalledWith([...policyKey, "unconfirmed"], true);
  expect(h.setQueryData).not.toHaveBeenCalledWith(policyKey, expect.anything());
  expect(h.invalidate).toHaveBeenCalledWith({
    queryKey: policyKey,
    exact: true,
    refetchType: "none",
  });
  // A failed refresh does not unblock it.
  h.refresh.mockResolvedValueOnce({ data: undefined, error: new Error("Offline") });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh review policy" })),
  );
  expect(policySwitch()).toBeDisabled();
  expect(h.removeQueries).not.toHaveBeenCalled();
  h.refresh.mockResolvedValueOnce({
    data: { version: 9, reviewBypassEnabled: false },
    error: null,
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Refresh review policy" })),
  );
  expect(policySwitch()).toBeEnabled();
  expect(policySwitch()).not.toBeChecked();
  expect(screen.queryByText(/^Not confirmed/)).not.toBeInTheDocument();
  expect(h.removeQueries).toHaveBeenCalledWith({
    queryKey: [...policyKey, "unconfirmed"],
    exact: true,
  });
});
it("treats a 5xx or 408 as uncertain, and a save that was never sent as nothing to recover", async () => {
  h.updatePolicy.mockRejectedValue(rejection(503));
  const view = render(<AgentPolicyScreen />);
  fireEvent.click(policySwitch());
  await approve();
  expect(policySwitch()).toBeDisabled();
  expect(screen.getByText(/^Not confirmed/)).toBeVisible();
  view.unmount();
  h.updatePolicy.mockRejectedValue(rejection(408));
  render(<AgentPolicyScreen />);
  fireEvent.click(policySwitch());
  await approve();
  expect(policySwitch()).toBeDisabled();
  cleanup();
  // Another action is running or the session changed: the save is refused before transport.
  h.run.mockResolvedValue({ ok: false });
  h.updatePolicy.mockClear();
  render(<AgentPolicyScreen />);
  fireEvent.click(policySwitch());
  await approve();
  expect(h.updatePolicy).not.toHaveBeenCalled();
  expect(policySwitch()).toBeEnabled();
  expect(policySwitch()).not.toBeChecked();
  expect(screen.queryByText(/^Not confirmed/)).not.toBeInTheDocument();
});
it("labels returned OAuth clients with no scopes without inventing authority", () => {
  h.resources["agent-oauth-clients"] = [
    { id: "empty-client", name: "No authority client", scopes: [] },
  ];
  render(<AgentAccessScreen />);
  expect(screen.getByText("None")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Revoke No authority client" }));
  expect(h.confirm).toHaveBeenCalledWith(
    "Revoke No authority client?",
    expect.any(String),
    expect.any(Function),
    true,
  );
});

it("rejects control-character-normalized cross-origin review paths", () => {
  expect(() =>
    agentWorkItemUrl("https://fixture.test/settings", "/\t/foreign.test/private"),
  ).toThrow("The web review address is invalid.");
});

it("identifies account-level agent work without assigning a workspace or fabricating an action", () => {
  h.resources["agent-context"] = { links: { agentAccess: "https://fixture.test/settings" } };
  h.resources["agent-work-items-root"] = {
    items: [
      {
        id: "account-work",
        domain: null,
        priority: "normal",
        kind: "review",
        title: "Account review",
        summary: "Account-level work",
        action: null,
      },
    ],
    unavailableDomains: [],
    nextCursor: null,
  };
  render(<AgentReviewsScreen />);
  expect(screen.getByLabelText("Account · Review")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review on the web" })).toBeNull();
});
