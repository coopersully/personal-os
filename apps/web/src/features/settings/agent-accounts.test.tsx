// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { agentAccountFixture as account } from "../../test-fixtures/agent-account";
import { AgentAccountsSettings } from "./agent-accounts";

const api = vi.hoisted(() => ({
  listAgentAccounts: vi.fn(),
  updateAgentAccount: vi.fn(),
  linkAgentAccountConnection: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
vi.mock("sonner", () => ({
  toast: { loading: vi.fn(() => "notice"), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
const directory = {
  accounts: [account, { ...account, id: "second", displayName: "Maple Owl" }],
  connections: [
    {
      id: "connection",
      label: "Desktop connection",
      agentAccountId: account.id,
      scopes: ["finances:maintain"],
      active: true,
      lastUsedAt: null,
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  api.listAgentAccounts.mockResolvedValue(directory);
  api.updateAgentAccount.mockResolvedValue(account);
  api.linkAgentAccountConnection.mockResolvedValue(directory.connections[0]);
});
function open(owner: string | null = "owner-a") {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (owner) cache.setQueryData(["me"], { id: owner });
  render(
    <QueryClientProvider client={cache}>
      <AgentAccountsSettings />
    </QueryClientProvider>,
  );
  return { cache, user: userEvent.setup() };
}
it("edits the shared profile and reports one toast, preserving connection permissions", async () => {
  const { cache, user } = open();
  cache.setQueryData(["finance-host-schedules", "owner-a", 0], []);
  cache.setQueryData(["finance-host-connections", "owner-a", 0], []);
  await user.click(await screen.findByRole("button", { name: "Edit agent account Cedar Fox" }));
  expect(screen.getByRole("button", { name: "Save account" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Display name"));
  await user.type(screen.getByLabelText("Display name"), "Cedar");
  await user.clear(screen.getByLabelText("Account label"));
  await user.click(screen.getByLabelText("Platform"));
  await user.click(screen.getByRole("menuitemradio", { name: "Claude" }));
  await user.click(screen.getByRole("button", { name: "Save account" }));
  await waitFor(() =>
    expect(api.updateAgentAccount).toHaveBeenCalledWith(account.id, {
      displayName: "Cedar",
      accountLabel: null,
      platform: "claude",
    }),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Agent account saved.", { id: "notice" }),
  );
  expect(screen.queryByText("Agent account saved.")).not.toBeInTheDocument();
  expect(api.linkAgentAccountConnection).not.toHaveBeenCalled();
  expect(cache.getQueryState(["finance-host-schedules", "owner-a", 0])?.isInvalidated).toBe(true);
  expect(cache.getQueryState(["finance-host-connections", "owner-a", 0])?.isInvalidated).toBe(true);
});
it("retains rejected drafts and delivers errors through Sonner only", async () => {
  api.updateAgentAccount.mockRejectedValueOnce(new Error("Name rejected"));
  const { user } = open();
  await user.click(await screen.findByRole("button", { name: "Edit agent account Cedar Fox" }));
  await user.type(screen.getByLabelText("Display name"), " draft");
  await user.click(screen.getByRole("button", { name: "Save account" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Name rejected", { id: "notice" }));
  expect(screen.getByLabelText("Display name")).toHaveValue("Cedar Fox draft");
  expect(screen.queryByText("Name rejected")).not.toBeInTheDocument();
});
it.each([
  ["Maple Owl · Codex · Personal", "second"],
  ["Create a new agent account", null],
])("links a connection using %s without changing its scopes", async (label, id) => {
  const { cache, user } = open();
  cache.setQueryData(["finance-host-schedules", "owner-a", 0], []);
  cache.setQueryData(["finance-host-connections", "owner-a", 0], []);
  await user.click(
    await screen.findByRole("button", { name: "Change account for Desktop connection" }),
  );
  await user.click(screen.getByLabelText("Agent account"));
  await user.click(screen.getByRole("menuitemradio", { name: label }));
  await user.click(screen.getByRole("button", { name: "Save connection account" }));
  await waitFor(() =>
    expect(api.linkAgentAccountConnection).toHaveBeenCalledWith("connection", {
      agentAccountId: id,
    }),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Connection account saved.", { id: "notice" }),
  );
  expect(screen.queryByText("Connection account saved.")).not.toBeInTheDocument();
  expect(cache.getQueryState(["finance-host-schedules", "owner-a", 0])?.isInvalidated).toBe(true);
  expect(cache.getQueryState(["finance-host-connections", "owner-a", 0])?.isInvalidated).toBe(true);
});
it("does not query without an owner", () => {
  open(null);
  expect(api.listAgentAccounts).not.toHaveBeenCalled();
});
it("discards late reads after switching owners", async () => {
  let resolve!: (value: typeof directory) => void;
  api.listAgentAccounts.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { cache } = open();
  api.listAgentAccounts.mockResolvedValue({ accounts: [], connections: [] });
  act(() => cache.setQueryData(["me"], { id: "owner-b" }));
  await act(async () => resolve(directory));
  await screen.findByText("Agent accounts appear when an agent connects.");
  expect(screen.queryByText("Cedar Fox")).not.toBeInTheDocument();
});
it("suppresses late save feedback and invalidations after an owner switch", async () => {
  let resolve!: () => void;
  api.updateAgentAccount.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const { cache, user } = open();
  await user.click(await screen.findByRole("button", { name: "Edit agent account Cedar Fox" }));
  await user.type(screen.getByLabelText("Display name"), " edited");
  await user.click(screen.getByRole("button", { name: "Save account" }));
  const invalidate = vi.spyOn(cache, "invalidateQueries");
  api.listAgentAccounts.mockResolvedValue({ accounts: [], connections: [] });
  act(() => cache.setQueryData(["me"], { id: "owner-b" }));
  await act(async () => resolve());
  expect(toast.success).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  expect(toast.dismiss).toHaveBeenCalledWith("notice");
});

it("retains dormant profiles after relinking and distinguishes them from absent accounts", async () => {
  const { user } = open();
  expect(await screen.findByText("Agent Accounts · 1")).toBeVisible();
  expect(screen.getByText("1 connection")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Change account for Desktop connection" }),
  ).toHaveTextContent(/^Change$/);
  expect(screen.queryByText("Maple Owl")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Previous accounts · 1" }));
  expect(screen.getByText("Maple Owl")).toBeVisible();
  expect(screen.getByText("0 connections")).toBeVisible();
  expect(
    screen.queryByText("Agent accounts appear when an agent connects."),
  ).not.toBeInTheDocument();
});
it("keeps a rejected platform-mismatched link editable and reports no inline error", async () => {
  api.linkAgentAccountConnection.mockRejectedValueOnce(new Error("Agent platforms do not match"));
  const { user } = open();
  await user.click(
    await screen.findByRole("button", { name: "Change account for Desktop connection" }),
  );
  await user.click(screen.getByLabelText("Agent account"));
  await user.click(screen.getByRole("menuitemradio", { name: "Maple Owl · Codex · Personal" }));
  await user.click(screen.getByRole("button", { name: "Save connection account" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Agent platforms do not match", { id: "notice" }),
  );
  expect(screen.getByLabelText("Agent account")).toHaveTextContent("Maple Owl");
  expect(screen.queryByText("Agent platforms do not match")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save connection account" })).toBeEnabled();
});
it("offers read recovery without claiming an empty directory", async () => {
  api.listAgentAccounts.mockRejectedValueOnce(new Error("Directory offline"));
  const { user } = open();
  expect(await screen.findByLabelText("Agent accounts unavailable")).toBeVisible();
  expect(
    screen.queryByText("Agent accounts appear when an agent connects."),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Cedar Fox")).toBeVisible();
});

it("moves the source profile into Previous accounts after merging connections and permits renaming it", async () => {
  const secondConnection = {
    ...directory.connections[0],
    id: "second-connection",
    label: "Other connection",
    agentAccountId: "second",
    active: false,
  };
  api.listAgentAccounts.mockResolvedValue({
    ...directory,
    connections: [...directory.connections, secondConnection],
  });
  const { user } = open();
  expect(await screen.findByText("Agent Accounts · 2")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Change account for Other connection" }));
  await user.click(screen.getByLabelText("Agent account"));
  await user.click(screen.getByRole("menuitemradio", { name: "Cedar Fox · Codex · Personal" }));
  api.listAgentAccounts.mockResolvedValue({
    ...directory,
    connections: [...directory.connections, { ...secondConnection, agentAccountId: account.id }],
  });
  await user.click(screen.getByRole("button", { name: "Save connection account" }));
  expect(await screen.findByText("Agent Accounts · 1")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("Maple Owl")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Previous accounts · 1" }));
  await user.click(screen.getByRole("button", { name: "Edit agent account Maple Owl" }));
  await user.clear(screen.getByLabelText("Display name"));
  await user.type(screen.getByLabelText("Display name"), "Previous Maple");
  await user.click(screen.getByRole("button", { name: "Save account" }));
  await waitFor(() =>
    expect(api.updateAgentAccount).toHaveBeenCalledWith(
      "second",
      expect.objectContaining({ displayName: "Previous Maple" }),
    ),
  );
});

it.each([
  "codex",
  "unknown",
] as const)("filters incompatible accounts for a %s connection while allowing unknown platforms", async (platform) => {
  api.listAgentAccounts.mockResolvedValue({
    ...directory,
    accounts: [
      { ...account, platform },
      { ...account, id: "claude", displayName: "Claude Profile", platform: "claude" },
      {
        ...account,
        id: "unknown",
        displayName: "Unknown Profile",
        platform: "unknown",
        accountLabel: null,
      },
    ],
  });
  const { user } = open();
  await user.click(
    await screen.findByRole("button", { name: "Change account for Desktop connection" }),
  );
  await user.click(screen.getByLabelText("Agent account"));
  expect(
    screen.getByRole("menuitemradio", { name: "Unknown Profile · Unknown platform" }),
  ).toBeVisible();
  if (platform === "codex") {
    expect(
      screen.queryByRole("menuitemradio", { name: "Claude Profile · Claude · Personal" }),
    ).not.toBeInTheDocument();
  } else {
    expect(
      screen.getByRole("menuitemradio", { name: "Claude Profile · Claude · Personal" }),
    ).toBeVisible();
  }
  await user.click(
    screen.getByRole("menuitemradio", { name: "Unknown Profile · Unknown platform" }),
  );
  await user.click(screen.getByRole("button", { name: "Save connection account" }));
  await waitFor(() =>
    expect(api.linkAgentAccountConnection).toHaveBeenCalledWith("connection", {
      agentAccountId: "unknown",
    }),
  );
});
