// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import {
  AgentAccessScreen,
  AgentPolicyScreen,
  AgentReviewsScreen,
  AgentSetupScreen,
  AgentsSettingsScreen,
  ConnectedAgentsScreen,
} from "./agents";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner",
  epoch: 1,
  callbacks: new Map<string, () => void>(),
  confirm: vi.fn(),
  open: vi.fn(),
  push: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "toast"),
  api: {
    listAgentAccounts: vi.fn(),
    getAgentConnectionGuide: vi.fn(),
    getAssistantSetupStatus: vi.fn(),
    getPersonalOsSetup: vi.fn(),
    listAccessTokens: vi.fn(),
    listOAuthClients: vi.fn(),
    getExecutionPolicySettings: vi.fn(),
    getPersonalOsContext: vi.fn(),
    listAgentAccessWorkItems: vi.fn(),
  },
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner } },
    session: { epoch: () => h.epoch, api: () => h.api },
  }),
}));
vi.mock("expo-router", () => ({
  router: { push: h.push },
  Stack: { Screen: () => null },
  usePreventRemove: () => () => {},
}));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Linking: { openURL: h.open },
}));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("../../components/forms/form-save", () => ({ FormSave: () => null }));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("./settings-row", () => ({
  SettingsRow: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, loading: h.loading, dismiss: vi.fn() },
}));
vi.mock("../tasks/ui", () => ({
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Section: ({ children, title }: PropsWithChildren<{ title?: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  State: ({ loading, retry, empty }: { loading?: boolean; retry?: () => void; empty?: string }) =>
    loading ? (
      <span>Loading</span>
    ) : retry ? (
      <button type="button" onClick={retry}>
        Retry
      </button>
    ) : (
      <span>{empty}</span>
    ),
  Field: ({
    label,
    value,
    onChangeText,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onChangeText(e.target.value)} />,
  Action: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => {
    h.callbacks.set(label, onPress);
    return (
      <button type="button" disabled={disabled} onClick={onPress}>
        {label}
      </button>
    );
  },
  Choice: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  ToggleRow: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={value}
      disabled={disabled}
      onChange={() => onChange(!value)}
    />
  ),
  confirm: h.confirm,
}));
beforeEach(() => {
  vi.clearAllMocks();
  h.callbacks.clear();
  h.owner = "owner";
  h.epoch = 1;
  h.api.listAgentAccounts.mockReset().mockResolvedValue({ accounts: [], connections: [] });
  h.api.getAgentConnectionGuide.mockReset().mockResolvedValue({
    mcpUrl: "https://fixture.test/mcp",
    skill: { installPrompt: "Install fixture skill", setupPrompt: "Follow fixture setup" },
    domains: [],
  });
  h.api.getAssistantSetupStatus.mockReset().mockResolvedValue({ domains: [] });
  h.api.getPersonalOsSetup.mockReset().mockResolvedValue({
    status: "ready",
    progress: { completed: 0, total: 0 },
    nextAction: "Ready",
    steps: [],
  });
  h.api.listAccessTokens.mockReset().mockResolvedValue([]);
  h.api.listOAuthClients.mockReset().mockResolvedValue([]);
  h.api.getExecutionPolicySettings
    .mockReset()
    .mockResolvedValue({ version: 2, reviewBypassEnabled: false });
  h.api.getPersonalOsContext
    .mockReset()
    .mockResolvedValue({ links: { agentAccess: "https://fixture.test/settings" } });
  h.api.listAgentAccessWorkItems
    .mockReset()
    .mockResolvedValue({ items: [], unavailableDomains: [], nextCursor: null });
});
afterEach(cleanup);
const show = (children: React.ReactNode) =>
  render(<MobileDataProvider>{children}</MobileDataProvider>);
it("navigates the concise native agent tree without fetching or granting authority", () => {
  show(<AgentsSettingsScreen />);
  for (const [label, path] of [
    ["Connected agents", "connected"],
    ["Setup", "setup"],
    ["Reviews", "reviews"],
    ["Access", "access"],
    ["Execution policy", "policy"],
  ]) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(h.push).toHaveBeenLastCalledWith(`/settings/agents/${path}`);
  }
  expect(h.api.listAgentAccounts).not.toHaveBeenCalled();
  expect(h.api.listAccessTokens).not.toHaveBeenCalled();
});
it("retries a denied directory read and never presents another child's access form", async () => {
  h.api.listAgentAccounts.mockRejectedValueOnce(new Error("Directory denied"));
  show(<ConnectedAgentsScreen />);
  await screen.findByText("Retry");
  expect(h.error).toHaveBeenCalledOnce();
  expect(screen.queryByText("No agents have connected yet.")).toBeNull();
  fireEvent.click(screen.getByText("Retry"));
  await screen.findByText("No agents have connected yet.");
  expect(h.api.listAccessTokens).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Token name")).toBeNull();
});
it("keeps setup prompts and workspace instructions on setup only and retries failed instructions", async () => {
  h.api.getPersonalOsSetup.mockRejectedValueOnce(new Error("Setup denied"));
  show(<AgentSetupScreen />);
  await screen.findByText("Install fixture skill");
  await screen.findByText("Retry");
  fireEvent.click(screen.getByText("Retry"));
  await screen.findByText(/0 of 0 steps/);
  expect(h.api.getPersonalOsSetup).toHaveBeenCalledTimes(2);
  expect(h.api.listAccessTokens).not.toHaveBeenCalled();
});
it("loads grants only on Access and retries unavailable token reads", async () => {
  h.api.listAccessTokens.mockRejectedValueOnce(new Error("Tokens denied"));
  show(<AgentAccessScreen />);
  await screen.findByText("Retry");
  expect(screen.queryByText("No access tokens.")).toBeNull();
  fireEvent.click(screen.getByText("Retry"));
  await waitFor(() => expect(h.api.listAccessTokens).toHaveBeenCalledTimes(2));
  await screen.findByLabelText("Token name");
  expect(h.api.getExecutionPolicySettings).not.toHaveBeenCalled();
});
it("retries the policy API through its single action feedback owner", async () => {
  h.api.getExecutionPolicySettings.mockRejectedValueOnce(new Error("Policy denied"));
  show(<AgentPolicyScreen />);
  await screen.findByText("Retry");
  expect(h.error).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Retry"));
  await screen.findByLabelText("Allow eligible actions without review");
  expect(h.api.listAccessTokens).not.toHaveBeenCalled();
  expect(h.success).toHaveBeenCalledWith("Execution policy refreshed", { id: "toast" });
});
it("loads review work only on Reviews", async () => {
  show(<AgentReviewsScreen />);
  await screen.findByText("No agent work is waiting.");
  await waitFor(() => expect(h.api.listAgentAccessWorkItems).toHaveBeenCalledWith({ limit: 10 }));
  expect(h.api.getPersonalOsContext).toHaveBeenCalledOnce();
  expect(h.api.getAgentConnectionGuide).not.toHaveBeenCalled();
  expect(h.api.listAccessTokens).not.toHaveBeenCalled();
});
it("suppresses prior-owner directory results after a native child survives session replacement", async () => {
  let resolvePrior!: (value: unknown) => void;
  h.api.listAgentAccounts.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePrior = resolve;
      }),
  );
  const view = show(<ConnectedAgentsScreen />);
  await waitFor(() => expect(h.api.listAgentAccounts).toHaveBeenCalledOnce());
  h.owner = "next-owner";
  h.epoch = 2;
  view.rerender(
    <MobileDataProvider>
      <ConnectedAgentsScreen />
    </MobileDataProvider>,
  );
  await screen.findByText("No agents have connected yet.");
  resolvePrior({
    accounts: [
      {
        id: "prior",
        displayName: "Private prior-owner agent",
        accountLabel: null,
        platform: "codex",
        updatedAt: "now",
      },
    ],
    connections: [],
  });
  await waitFor(() => expect(h.api.listAgentAccounts).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/Private prior-owner agent/)).toBeNull();
});

it("announces explicit cached policy refresh once and preserves policy on denied reads", async () => {
  show(<AgentPolicyScreen />);
  await screen.findByLabelText("Allow eligible actions without review");
  fireEvent.click(screen.getByRole("button", { name: "Refresh execution policy" }));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Execution policy refreshed", { id: "toast" }),
  );
  expect(h.loading).toHaveBeenCalledWith("Refreshing…");
  expect(h.success).toHaveBeenCalledOnce();
  h.api.getExecutionPolicySettings.mockRejectedValueOnce(new Error("Cached refresh denied"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh execution policy" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the result. Check your connection and refresh before retrying.",
      { id: "toast" },
    ),
  );
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.loading).toHaveBeenCalledTimes(2);
  expect(h.success).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Allow eligible actions without review")).not.toBeChecked();
  expect(
    screen.queryByText(
      "Couldn’t confirm the result. Check your connection and refresh before retrying.",
    ),
  ).toBeNull();
  expect(screen.queryByText("Cached refresh denied")).toBeNull();
});

it.each([
  401, 403, 500,
])("fails closed for authoritative %s after accumulating review pages, retaining only ordinary failures", async (status) => {
  const first = {
    id: "private-first",
    domain: "tasks",
    priority: "high",
    kind: "review",
    title: "Private first review",
    summary: "Private first summary",
    preview: [{ label: "Private field", value: "Private value" }],
    action: { label: "Review", to: "/tasks/review?id=first" },
  };
  h.api.listAgentAccessWorkItems
    .mockResolvedValueOnce({ items: [first], unavailableDomains: [], nextCursor: "second" })
    .mockRejectedValueOnce(
      new ApiClientError({
        code: status === 500 ? "UNAVAILABLE" : "FORBIDDEN",
        status,
        message: "Review access denied",
      }),
    )
    .mockResolvedValue({ items: [], unavailableDomains: [], nextCursor: null });
  show(<AgentReviewsScreen />);
  await screen.findByText("Private first summary");
  fireEvent.click(screen.getByRole("button", { name: "Load more agent work" }));
  await screen.findByRole("button", { name: "Retry loading agent work" });
  expect(h.api.listAgentAccessWorkItems).toHaveBeenCalledTimes(2);
  expect(h.error).toHaveBeenCalledOnce();
  if (status === 500) expect(screen.getByText("Private first summary")).toBeTruthy();
  else {
    expect(screen.queryByText("Private first summary")).toBeNull();
    expect(screen.queryByText(/Private field/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Review on the web" })).toBeNull();
  }
  fireEvent.click(screen.getByRole("button", { name: "Retry loading agent work" }));
  await waitFor(() => expect(h.api.listAgentAccessWorkItems).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Retry loading agent work" })).toBeNull(),
  );
  if (status === 500) expect(screen.getByText("Private first summary")).toBeTruthy();
  else {
    await screen.findByText("No agent work on this page.");
    expect(screen.queryByText("No agent work is waiting.")).toBeNull();
    expect(screen.queryByText("Private first summary")).toBeNull();
  }
  expect(h.api.listAgentAccessWorkItems).toHaveBeenCalledTimes(3);
});

it("fences queued page, review and confirmation callbacks through denial, pending retry and fresh authorization", async () => {
  const first = {
    id: "private-first",
    domain: "tasks",
    priority: "high",
    kind: "review",
    title: "Private first review",
    summary: "Private queued summary",
    action: { label: "Review", to: "/tasks/review?id=private" },
  };
  let finish!: (value: unknown) => void;
  h.api.listAgentAccessWorkItems
    .mockResolvedValueOnce({ items: [first], unavailableDomains: [], nextCursor: "second" })
    .mockRejectedValueOnce(
      new ApiClientError({ code: "FORBIDDEN", status: 403, message: "Denied" }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const view = show(<AgentReviewsScreen />);
  await screen.findByText("Private queued summary");
  await screen.findByRole("button", { name: "Review on the web" });
  const oldLoad = h.callbacks.get("Load more agent work");
  const oldReview = h.callbacks.get("Review on the web");
  if (!oldLoad || !oldReview) throw new Error("Expected mounted native callbacks");
  act(() => oldReview());
  const oldConfirm = h.confirm.mock.calls.at(-1)?.[2] as () => void;
  expect(oldConfirm).toBeTypeOf("function");
  act(() => oldLoad());
  await screen.findByRole("button", { name: "Retry loading agent work" });
  expect(screen.queryByText("Private queued summary")).toBeNull();
  const confirmations = h.confirm.mock.calls.length;
  await act(async () => {
    oldLoad();
    oldReview();
    oldConfirm();
  });
  expect(h.confirm).toHaveBeenCalledTimes(confirmations);
  expect(h.open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading agent work" }));
  await waitFor(() => expect(h.api.listAgentAccessWorkItems).toHaveBeenCalledTimes(3));
  await act(async () => {
    oldLoad();
    oldReview();
    oldConfirm();
  });
  expect(screen.queryByText("Private queued summary")).toBeNull();
  expect(h.open).not.toHaveBeenCalled();
  await act(async () => finish({ items: [], unavailableDomains: [], nextCursor: null }));
  await screen.findByText("No agent work on this page.");
  expect(screen.queryByText("No agent work is waiting.")).toBeNull();
  await act(async () => {
    oldLoad();
    oldReview();
    oldConfirm();
  });
  expect(screen.queryByText("Private queued summary")).toBeNull();
  expect(h.api.listAgentAccessWorkItems).toHaveBeenCalledTimes(3);
  expect(h.open).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenCalledTimes(confirmations);
  view.unmount();
  await act(async () => {
    oldLoad();
    oldReview();
    oldConfirm();
  });
  expect(h.open).not.toHaveBeenCalled();
});

it("recovers denied review context explicitly while successful pages stay private and old callbacks remain fenced", async () => {
  const item = {
    id: "context-item",
    domain: "tasks",
    priority: "high",
    kind: "review",
    title: "Context review",
    summary: "Context private summary",
    action: { label: "Review", to: "/tasks/review?id=context" },
  };
  h.api.listAgentAccessWorkItems.mockResolvedValue({
    items: [item],
    unavailableDomains: [],
    nextCursor: "next",
  });
  let refetchContext: (() => Promise<unknown>) | undefined;
  function ReviewContextFixture() {
    const client = useQueryClient();
    refetchContext = () =>
      client.refetchQueries({
        queryKey: ["settings", h.owner, h.epoch, "agent-context"],
        exact: true,
      });
    return <AgentReviewsScreen />;
  }
  show(<ReviewContextFixture />);
  await screen.findByRole("button", { name: "Review on the web" });
  const oldReview = h.callbacks.get("Review on the web");
  const oldLoad = h.callbacks.get("Load more agent work");
  if (!oldReview || !oldLoad || !refetchContext) throw new Error("Expected live context fixture");
  act(() => oldReview());
  const oldConfirm = h.confirm.mock.calls.at(-1)?.[2] as () => void;
  h.api.getPersonalOsContext.mockRejectedValueOnce(
    new ApiClientError({ code: "FORBIDDEN", status: 403, message: "Context denied" }),
  );
  await act(async () => refetchContext?.());
  await screen.findByRole("button", { name: "Retry web review links" });
  expect(h.error).toHaveBeenCalledOnce();
  expect(screen.queryByText("Context private summary")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry loading agent work" })).toBeNull();
  let finish!: (value: unknown) => void;
  h.api.getPersonalOsContext.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry web review links" }));
  await waitFor(() => expect(h.api.getPersonalOsContext).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("button", { name: "Review on the web" })).toBeNull();
  await act(async () => {
    oldLoad();
    oldReview();
    oldConfirm();
  });
  expect(screen.queryByText("Context private summary")).toBeNull();
  expect(h.open).not.toHaveBeenCalled();
  await act(async () => finish({ links: { agentAccess: "https://authorized-new.test/settings" } }));
  await screen.findByRole("button", { name: "Review on the web" });
  expect(screen.queryByRole("button", { name: "Retry web review links" })).toBeNull();
  await act(async () => {
    oldLoad();
    oldReview();
    oldConfirm();
  });
  expect(h.open).not.toHaveBeenCalled();
  expect(h.api.listAgentAccessWorkItems).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Review on the web" }));
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  expect(h.open).toHaveBeenCalledWith("https://authorized-new.test/tasks/review?id=context");
  expect(h.api.getPersonalOsContext).toHaveBeenCalledTimes(3);
});
