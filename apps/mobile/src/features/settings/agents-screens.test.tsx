// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentAccessScreen,
  AgentPolicyScreen,
  AgentReviewsScreen,
  AgentSetupScreen,
  AgentsSettingsScreen,
  ConnectedAgentsScreen,
} from "./agents";

// These tests render the real shared sections and rows (form-rows, settings-row) so they
// prove each Agents screen is laid out with the standard Settings components.
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  stackIndex: 1,
  focused: true,
  stateListeners: new Set<() => void>(),
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: vi.fn(() => true),
  screenOptions: [] as Record<string, unknown>[],
  confirm: vi.fn(),
  push: vi.fn(),
  openURL: vi.fn(),
  resources: {} as Record<string, unknown>,
  errors: new Set<string>(),
  pending: new Set<string>(),
}));
Object.assign(h, {
  navigation: {
    getState: () => ({ index: h.stackIndex }),
    isFocused: () => h.focused,
    addListener: (_event: string, listener: () => void) => {
      h.stateListeners.add(listener);
      return () => h.stateListeners.delete(listener);
    },
  },
});
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  Linking: { openURL: h.openURL },
}));
vi.mock("expo-router", () => ({
  router: { push: h.push, back: h.back, replace: h.replace, canGoBack: h.canGoBack },
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => {
      h.screenOptions.push(options);
      return null;
    },
  },
  useNavigation: () => (h as unknown as { navigation: object }).navigation,
}));
vi.mock("sonner-native", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));
vi.mock("../../components/editor-header", () => ({
  editorDismissOptions: (action: { label: string; onPress: () => void }) => ({ dismiss: action }),
}));
vi.mock("../../components/forms/form-save", () => ({ FormSave: () => null }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: () => undefined }));
vi.mock("../../components/forms/enum-choice", () => ({
  EnumChoice: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({ state: { user: { id: "fixture" } }, session: { epoch: () => 1 } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    cancelQueries: vi.fn(),
    getQueryData: () => undefined,
    setQueryData: vi.fn(),
    setQueryDefaults: vi.fn(),
    removeQueries: vi.fn(),
  }),
}));
vi.mock("../tasks/data", () => ({ errorMessage: (error: Error) => error.message }));
vi.mock("../tasks/ui", async (original) => ({
  ...(await original<typeof import("../tasks/ui")>()),
  confirm: h.confirm,
}));
vi.mock("./data", () => ({
  useSettingsResource: (key: string) => {
    const waiting = h.pending.has(key) || h.errors.has(key);
    return {
      data: waiting ? undefined : h.resources[key],
      isPending: h.pending.has(key),
      isError: h.errors.has(key),
      isSuccess: !waiting,
      isFetching: h.pending.has(key),
      error: h.errors.has(key) ? new Error("Unavailable") : null,
      refetch: vi.fn(),
    };
  },
  useSettingsRefresh: () => ({ pending: false, refresh: vi.fn() }),
  useSettingsAction: () => ({ pending: false, run: vi.fn() }),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.stackIndex = 1;
  h.focused = true;
  h.stateListeners.clear();
  h.screenOptions = [];
  h.canGoBack.mockReturnValue(true);
  h.errors.clear();
  h.pending.clear();
  h.resources = {
    "agent-directory": { accounts: [], connections: [] },
    "agent-tokens": [],
    "agent-oauth-clients": [],
    "agent-execution-policy": { version: 3, reviewBypassEnabled: false },
    "agent-guide": guide([]),
    "agent-setup-status": { domains: [] },
    "agent-setup-tasks": plan(1),
    "agent-context": { links: { agentAccess: "https://app.example.com/settings" } },
    "agent-work-items-root": { items: [], nextCursor: null, unavailableDomains: [] },
  };
});

const groups = () => screen.queryAllByTestId("form-group");
const headings = () => screen.queryAllByRole("heading").map((heading) => heading.textContent);
/** Every visible string lives in a shared group or its heading; footnotes are named. */
function expectStandardLayout(view: ReactElement, footnotes: RegExp[] = []) {
  const { container } = render(view);
  const loose = [...container.querySelectorAll("span")]
    .filter((text) => !text.closest('[data-testid="form-group"]'))
    .map((text) => text.textContent ?? "");
  expect(loose).toHaveLength(footnotes.length);
  footnotes.forEach((footnote, index) => {
    expect(loose[index]).toMatch(footnote);
  });
  // Raw permission identifiers such as "mail:read" are never shown to a person.
  expect(container.textContent).not.toMatch(/\b[a-z]+:(read|write|execute|maintain)\b/);
  return container;
}
const inGroup = (text: string | RegExp) => {
  const node = screen.getByText(text);
  expect(node.closest('[data-testid="form-group"]')).not.toBeNull();
  return node;
};

const account = (id: string, displayName: string, platform = "claude") => ({
  id,
  displayName,
  accountLabel: null,
  platform,
});
const connection = (id: string, label: string, scopes: string[]) => ({
  id,
  label,
  agentAccountId: null,
  scopes,
  active: true,
  lastUsedAt: null,
});

describe("Agents root", () => {
  it("lists the five Agents pages as standard navigation rows with an explanation", () => {
    expectStandardLayout(<AgentsSettingsScreen />, [/AI assistants, such as Claude or Codex/]);
    const rows = within(groups()[0] as HTMLElement).getAllByRole("button");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Connected agents",
      "Setup",
      "Reviews",
      "Access",
      "Review policy",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Reviews" }));
    expect(h.push).toHaveBeenCalledWith("/settings/agents/reviews");
  });
});

describe("Agents root back control", () => {
  const dismiss = () =>
    h.screenOptions.map((options) => options.dismiss).filter(Boolean) as {
      label: string;
      onPress: () => void;
    }[];
  const shown = () => Boolean(h.screenOptions.at(-1)?.dismiss);
  it("adds no second back control when Agents is reached from Settings", () => {
    render(<AgentsSettingsScreen />);
    expect(dismiss()).toEqual([]);
  });
  it("drops its Back once the stack reports Settings beneath it, even if the first read was stale", () => {
    // On a push the state read at mount can still be the previous one (index 0).
    h.stackIndex = 0;
    render(<AgentsSettingsScreen />);
    h.screenOptions = [];
    h.stackIndex = 1;
    act(() => {
      for (const listener of h.stateListeners) listener();
    });
    expect(dismiss()).toEqual([]);
    expect(shown()).toBe(false);
  });
  it("keeps its Back while a child page is open above it", () => {
    h.stackIndex = 0;
    const view = render(<AgentsSettingsScreen />);
    h.stackIndex = 1;
    h.focused = false;
    h.screenOptions = [];
    act(() => {
      for (const listener of h.stateListeners) listener();
    });
    view.rerender(<AgentsSettingsScreen />);
    expect(shown()).toBe(true);
  });
  it("shows a visible Back when Agents is the first screen in the stack", () => {
    h.stackIndex = 0;
    render(<AgentsSettingsScreen />);
    expect(dismiss()).toHaveLength(1);
    expect(dismiss()[0]?.label).toBe("Back");
    dismiss()[0]?.onPress();
    expect(h.back).toHaveBeenCalledOnce();
    expect(h.replace).not.toHaveBeenCalled();
  });
  it("returns to Today when there is nothing to go back to", () => {
    h.stackIndex = 0;
    h.canGoBack.mockReturnValue(false);
    render(<AgentsSettingsScreen />);
    dismiss()[0]?.onPress();
    expect(h.replace).toHaveBeenCalledWith("/");
    expect(h.back).not.toHaveBeenCalled();
  });
});

describe("Connected agents", () => {
  it("explains the screen and says so when no agent has connected", () => {
    expectStandardLayout(<ConnectedAgentsScreen />);
    expect(headings()).toEqual(["Agents"]);
    inGroup("No agents have connected yet.");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("does not claim there are no agents while the directory is loading or failed", () => {
    h.pending.add("agent-directory");
    const view = render(<ConnectedAgentsScreen />);
    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(screen.queryByText("No agents have connected yet.")).toBeNull();
    h.pending.clear();
    h.errors.add("agent-directory");
    view.rerender(<ConnectedAgentsScreen />);
    expect(screen.getByRole("button", { name: "Retry loading" })).toBeVisible();
    expect(screen.queryByText("No agents have connected yet.")).toBeNull();
  });
  it("shows one agent as a navigation row and its connection as labelled detail rows", () => {
    h.resources["agent-directory"] = {
      accounts: [account("a", "Amber Finch")],
      connections: [connection("c", "Claude desktop", ["tasks:read", "tasks:write", "mail:read"])],
    };
    expectStandardLayout(<ConnectedAgentsScreen />);
    expect(headings()).toEqual(["Agents", "Connection · Claude desktop"]);
    expect(screen.getByRole("button", { name: "Amber Finch, Claude" })).toBeVisible();
    expect(screen.queryByText("No agents have connected yet.")).toBeNull();
    const detail = within(groups()[1] as HTMLElement);
    for (const text of ["Status", "Active", "Last used", "Never", "Permissions"])
      expect(detail.getByText(text)).toBeVisible();
    expect(detail.getByText("Mail: read")).toBeVisible();
    expect(detail.getByText("Tasks: read, manage")).toBeVisible();
    expect(detail.getByLabelText("Agent")).toHaveValue("none");
  });
  it("shows several agents in one group and one group per connection", () => {
    h.resources["agent-directory"] = {
      accounts: [
        account("a", "Amber Finch"),
        account("b", "Cedar Otter", "codex"),
        { ...account("c", "Quiet Heron", "other"), accountLabel: "Work account" },
      ],
      connections: [
        connection("c1", "Claude desktop", ["tasks:read"]),
        connection("c2", "Codex CLI", []),
      ],
    };
    expectStandardLayout(<ConnectedAgentsScreen />);
    expect(
      within(groups()[0] as HTMLElement)
        .getAllByRole("button")
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Amber Finch, Claude", "Cedar Otter, Codex", "Quiet Heron, Work account"]);
    expect(headings()).toEqual(["Agents", "Connection · Claude desktop", "Connection · Codex CLI"]);
    expect(within(groups()[2] as HTMLElement).getByText("None")).toBeVisible();
  });
});

function guide(domains: string[]) {
  return {
    mcpUrl: "https://nohmi.example/mcp",
    skill: { installPrompt: "Install the nohmi skill.", setupPrompt: "Run nohmi setup." },
    domains: domains.map((domain) => ({
      domain,
      support: domain === "mail" ? "executable_rules" : "profile_and_attention",
      readScope: `${domain}:read`,
      writeScope: `${domain}:write`,
    })),
  };
}
function plan(steps: number) {
  return {
    status: "needs_input",
    progress: { completed: 0, total: steps },
    nextAction: "Connect an agent to begin.",
    steps: Array.from({ length: steps }, (_, index) => ({
      id: `step-${index}`,
      title: ["Connect your agent", "Learn your preferences", "Review guidance"][index],
      state: index === 0 ? "current" : "blocked",
      owner: index === 0 ? "person" : "agent",
      description: `Description ${index + 1}`,
      instructions: index === 0 ? ["Open your agent", "Paste the server address"] : [],
      userAction: index === 0 ? "Approve the connection" : null,
    })),
  };
}

describe("Agent setup", () => {
  it("lays out connection steps in labelled blocks when no workspace support is published", () => {
    expectStandardLayout(<AgentSetupScreen />);
    expect(headings()).toEqual([
      "Connect an agent",
      "What agents can help with",
      "Workspace setup",
      "Tasks progress",
      "Step 1: Connect your agent",
    ]);
    inGroup("1. Server address (MCP)");
    inGroup("https://nohmi.example/mcp");
    inGroup("Install the nohmi skill.");
    inGroup("Run nohmi setup.");
    inGroup("Agents can’t help in any workspace yet.");
    expect(screen.queryByText("Agent can read")).toBeNull();
  });
  it("describes one supported workspace and its setup in plain language", () => {
    h.resources["agent-guide"] = guide(["tasks"]);
    h.resources["agent-setup-status"] = {
      domains: [
        {
          domain: "tasks",
          canRead: true,
          canWrite: false,
          approvedProfileVersion: 3,
          pendingDraftVersion: null,
        },
      ],
    };
    expectStandardLayout(<AgentSetupScreen />);
    expect(screen.queryByText("Agents can’t help in any workspace yet.")).toBeNull();
    inGroup("Preferences and actions");
    inGroup("Reading needs “Read tasks”. Changing needs “Manage tasks”.");
    const setup = within(groups()[2] as HTMLElement);
    for (const text of [
      "Agent can read",
      "Yes",
      "Agent can make changes",
      "No",
      "Approved guidance",
      "Version 3",
      "Draft waiting for approval",
      "None",
    ])
      expect(setup.getByText(text)).toBeVisible();
    const progress = within(groups()[3] as HTMLElement);
    for (const text of ["Needs your input", "0 of 1", "Connect an agent to begin."])
      expect(progress.getByText(text)).toBeVisible();
    const step = within(groups()[4] as HTMLElement);
    for (const text of [
      "Current step",
      "You",
      "Description 1",
      "Open your agent",
      "Paste the server address",
      "Your part",
      "Approve the connection",
    ])
      expect(step.getByText(text)).toBeVisible();
  });
  it("gives several workspaces and several steps a block or group each", () => {
    h.resources["agent-guide"] = guide(["mail", "calendar", "tasks", "finances"]);
    h.resources["agent-setup-tasks"] = plan(3);
    expectStandardLayout(<AgentSetupScreen />);
    const support = within(groups()[1] as HTMLElement);
    for (const text of ["Mail", "Calendar", "Tasks", "Finances"])
      expect(support.getByText(text)).toBeVisible();
    expect(support.getByText("Preferences, actions and rules")).toBeVisible();
    expect(support.getAllByText("Preferences and actions")).toHaveLength(3);
    expect(headings().slice(4)).toEqual([
      "Step 1: Connect your agent",
      "Step 2: Learn your preferences",
      "Step 3: Review guidance",
    ]);
    expect(screen.getAllByText("Waiting on an earlier step")).toHaveLength(2);
    expect(screen.getAllByText("Your agent")).toHaveLength(2);
  });
  it("shows guidance version 0 as a version and keeps identical instruction lines", () => {
    h.resources["agent-setup-status"] = {
      domains: [
        {
          domain: "tasks",
          canRead: true,
          canWrite: true,
          approvedProfileVersion: 0,
          pendingDraftVersion: null,
        },
      ],
    };
    const repeated = plan(1);
    (repeated.steps[0] as { instructions: string[] }).instructions = ["Wait", "Wait"];
    h.resources["agent-setup-tasks"] = repeated;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AgentSetupScreen />);
    expect(screen.getByText("Version 0")).toBeVisible();
    expect(screen.getAllByText("Wait")).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
  it("offers a retry instead of setup details while the guide or plan is unavailable", () => {
    h.errors.add("agent-guide");
    h.pending.add("agent-setup-tasks");
    render(<AgentSetupScreen />);
    expect(screen.getByRole("button", { name: "Retry loading" })).toBeVisible();
    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(screen.queryByText("1. Server address (MCP)")).toBeNull();
    expect(screen.queryByText(/^Step 1/)).toBeNull();
  });
});

const workItem = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  domain: "finances",
  priority: "high",
  kind: "review",
  title: `Categorize ${id}`,
  summary: `Summary for ${id}`,
  preview: [
    { label: "Condition", value: "Merchant is Corner Market" },
    { label: "Proposed action", value: "Set category to Groceries" },
  ],
  action: { label: "Review", to: `/finances/reviews?id=${id}` },
  ...overrides,
});
const reviews = (items: unknown[], more: string | null = null, unavailable: string[] = []) => ({
  items,
  nextCursor: more,
  unavailableDomains: unavailable,
});

describe("Agent reviews", () => {
  it("explains the screen and says when nothing is waiting", () => {
    expectStandardLayout(<AgentReviewsScreen />);
    expect(headings()).toEqual(["Waiting for you"]);
    inGroup(/You finish each item on the web/);
    inGroup("No agent work is waiting.");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("does not claim nothing is waiting while work is loading or failed to load", () => {
    h.pending.add("agent-work-items-root");
    const view = render(<AgentReviewsScreen />);
    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(screen.queryByText("No agent work is waiting.")).toBeNull();
    h.pending.clear();
    h.errors.add("agent-work-items-root");
    view.rerender(<AgentReviewsScreen />);
    expect(screen.getByRole("button", { name: "Retry loading agent work" })).toBeVisible();
    expect(screen.queryByText("No agent work is waiting.")).toBeNull();
  });
  it("shows one review as its own group of labelled rows with a web handoff", () => {
    h.resources["agent-work-items-root"] = reviews([workItem("groceries")]);
    expectStandardLayout(<AgentReviewsScreen />);
    expect(headings()).toEqual(["Waiting for you", "Finances · Review"]);
    expect(screen.queryByText("No agent work is waiting.")).toBeNull();
    const review = within(groups()[1] as HTMLElement);
    for (const text of [
      "Categorize groceries",
      "Summary for groceries",
      "Priority",
      "High",
      "Condition",
      "Merchant is Corner Market",
      "Proposed action",
      "Set category to Groceries",
    ])
      expect(review.getByText(text)).toBeVisible();
    // Preview values get the full row width under their label, not a narrow trailing column.
    for (const label of ["Condition", "Proposed action"])
      expect(review.getByText(label).parentElement).toHaveAttribute("data-testid", "detail-block");
    expect(review.getByText("Priority").parentElement).not.toHaveAttribute("data-testid");
    fireEvent.click(review.getByRole("button", { name: "Review on the web" }));
    expect(h.confirm).toHaveBeenCalledWith(
      "Continue on the web?",
      expect.stringContaining("does not approve or apply anything"),
      expect.any(Function),
    );
    expect(h.openURL).not.toHaveBeenCalled();
  });
  it("gives several items a group each, names their workspace and kind, and offers more", () => {
    h.resources["agent-work-items-root"] = reviews(
      [
        workItem("groceries"),
        workItem("mail-rule", { domain: "mail", kind: "attention", priority: "person_review" }),
        workItem("account", { domain: null, priority: "blocked", action: null, preview: [] }),
      ],
      "next",
      ["calendar", "tasks"],
    );
    expectStandardLayout(<AgentReviewsScreen />);
    expect(headings()).toEqual([
      "Waiting for you",
      "Finances · Review",
      "Mail · Attention",
      "Account · Review",
    ]);
    inGroup("Could not load Calendar, Tasks. Other work remains visible.");
    expect(within(groups()[2] as HTMLElement).getByText("Needs your review")).toBeVisible();
    const account = within(groups()[3] as HTMLElement);
    expect(account.getByText("Blocked")).toBeVisible();
    expect(account.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Review on the web" })).toHaveLength(2);
    const more = screen.getByRole("button", { name: "Load more agent work" });
    expect(more.closest('[data-testid="form-group"]')).not.toBeNull();
  });
  it("does not offer a web handoff until the review links have loaded", () => {
    h.resources["agent-work-items-root"] = reviews([workItem("groceries")]);
    h.errors.add("agent-context");
    render(<AgentReviewsScreen />);
    expect(screen.queryByRole("button", { name: "Review on the web" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry web review links" })).toBeVisible();
  });
});

const token = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  scopes: ["mail:read", "mail:write"],
  revokedAt: null,
  expiresAt: null,
  ...overrides,
});

describe("Agent access", () => {
  it("explains tokens and apps and says when there are none", () => {
    expectStandardLayout(<AgentAccessScreen />);
    expect(headings().slice(0, 3)).toEqual(["Access tokens", "Connected apps", "Create a token"]);
    inGroup("No access tokens.");
    inGroup("No connected apps.");
    expect(screen.queryByRole("button", { name: /^Revoke/ })).toBeNull();
  });
  it("does not claim there are no tokens or apps while they are loading or failed", () => {
    h.pending.add("agent-tokens");
    h.errors.add("agent-oauth-clients");
    render(<AgentAccessScreen />);
    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry loading" })).toBeVisible();
    expect(screen.queryByText("No access tokens.")).toBeNull();
    expect(screen.queryByText("No connected apps.")).toBeNull();
  });
  it("shows one token and one app as groups with status, permissions and a named revoke", () => {
    h.resources["agent-tokens"] = [token("t", "Laptop helper")];
    h.resources["agent-oauth-clients"] = [{ id: "o", name: "Claude", scopes: ["tasks:read"] }];
    expectStandardLayout(<AgentAccessScreen />);
    expect(headings().slice(0, 4)).toEqual([
      "Access tokens",
      "Token · Laptop helper",
      "Connected apps",
      "App · Claude",
    ]);
    expect(screen.queryByText("No access tokens.")).toBeNull();
    expect(screen.queryByText("No connected apps.")).toBeNull();
    const tokenGroup = within(groups()[1] as HTMLElement);
    for (const text of ["Status", "Active, no expiry", "Permissions", "Mail: read, manage"])
      expect(tokenGroup.getByText(text)).toBeVisible();
    expect(tokenGroup.getByRole("button", { name: "Revoke Laptop helper" })).toBeEnabled();
    const appGroup = within(groups()[3] as HTMLElement);
    expect(appGroup.getByText("Tasks: read")).toBeVisible();
    expect(appGroup.getByRole("button", { name: "Revoke Claude" })).toBeEnabled();
  });
  it("gives several tokens and apps a group each and offers no revoke for a revoked token", () => {
    h.resources["agent-tokens"] = [
      token("t1", "Laptop helper"),
      token("t2", "Old script", { revokedAt: "2026-11-01T00:00:00.000Z", scopes: [] }),
      token("t3", "Server job", { expiresAt: "2099-01-01T00:00:00.000Z" }),
    ];
    h.resources["agent-oauth-clients"] = [
      { id: "o1", name: "Claude", scopes: ["tasks:read"] },
      { id: "o2", name: "Codex", scopes: [] },
    ];
    expectStandardLayout(<AgentAccessScreen />);
    expect(headings().slice(0, 7)).toEqual([
      "Access tokens",
      "Token · Laptop helper",
      "Token · Old script",
      "Token · Server job",
      "Connected apps",
      "App · Claude",
      "App · Codex",
    ]);
    const revoked = within(groups()[2] as HTMLElement);
    expect(revoked.getByText("Revoked")).toBeVisible();
    expect(revoked.getByText("None")).toBeVisible();
    expect(revoked.queryByRole("button")).toBeNull();
    expect(within(groups()[3] as HTMLElement).getByText(/^Expires /)).toBeVisible();
    expect(screen.getAllByRole("button", { name: /^Revoke / })).toHaveLength(4);
  });
  it("shows a legacy token as inactive access and keeps repeated instruction lines", () => {
    h.resources["agent-tokens"] = [
      token("t", "Old automation", { scopes: ["automations:write", "automations:read"] }),
    ];
    render(<AgentAccessScreen />);
    expect(
      within(groups()[1] as HTMLElement).getByText("Daily brief: read, legacy access (inactive)"),
    ).toBeVisible();
    expect(screen.queryByText(/Daily brief: .*manage/)).toBeNull();
  });
  it("names every permission switch in plain language, grouped by the part of nohmi", () => {
    render(<AgentAccessScreen />);
    expect(headings()).toEqual(
      expect.arrayContaining(["Mail permissions", "Finances permissions", "Tasks permissions"]),
    );
    const switches = screen.getAllByRole("switch").map((item) => item.getAttribute("aria-label"));
    expect(switches).toHaveLength(24);
    expect(switches).toEqual(expect.arrayContaining(["Read mail", "Manage mail", "Read tasks"]));
    expect(switches.filter((label) => label?.includes(":read"))).toEqual([]);
    // No switch name runs to a paragraph; conditions sit under the name instead.
    expect(Math.max(...switches.map((label) => label?.length ?? 0))).toBeLessThan(60);
    expect(switches).toContain("Change Calendar settings");
    inGroup(
      "Only when your review policy lets eligible work skip Reviews. With Mail and Tasks execution, it can also sync or disconnect shared sources.",
    );
    expect(screen.getByText(/^Sync providers, reconcile and categorize/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
  });
});

describe("Review policy", () => {
  it("shows the review policy as one switch with an explanation under its group", () => {
    expectStandardLayout(<AgentPolicyScreen />, [/Off by default: eligible work waits in Reviews/]);
    expect(headings()).toEqual(["Eligible agent work"]);
    const policy = screen.getByRole("switch", {
      name: "Apply eligible work without waiting in Review",
    });
    expect(policy).not.toBeChecked();
    expect(policy.closest('[data-testid="form-group"]')).not.toBeNull();
    const refresh = screen.getByRole("button", { name: "Refresh review policy" });
    expect(refresh.closest('[data-testid="form-group"]')).not.toBeNull();
  });
  it("reflects an enabled policy and offers no switch before the policy has loaded", () => {
    h.resources["agent-execution-policy"] = { version: 4, reviewBypassEnabled: true };
    const view = render(<AgentPolicyScreen />);
    expect(screen.getByRole("switch")).toBeChecked();
    h.pending.add("agent-execution-policy");
    view.rerender(<AgentPolicyScreen />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("progressbar")).toBeVisible();
  });
});
