// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithFeedback as render } from "@/test-utils/feedback";
import { TextingAgentSettings } from "./agent-settings.js";
import { TextConversation } from "./conversation.js";
import { TextingRunRecovery } from "./run-recovery.js";

const mocks = vi.hoisted(() => ({
  getTextConversation: vi.fn(),
  getTextingConnection: vi.fn(),
  getTextingAgentStatus: vi.fn(),
  configureTextingAgent: vi.fn(),
  recoverTextingAgentRun: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: mocks }));
const status = {
  enabled: true,
  scheduleId: "routine",
  readiness: "ready",
  chatReady: true,
  verifiedAt: "2026-11-05T12:00:00Z",
  pendingCount: 0,
  routines: [{ id: "routine", label: "Personal Claude" }],
  runs: [],
  nextRunCursor: null,
  instructions: "Use your saved nohmi context.",
};
const message = (id: string, direction: string, text: string) => ({
  id,
  direction,
  text,
  occurredAt: "2026-11-05T12:00:00Z",
  localDateTime: "Nov 5, 7:00 AM",
  status: "unknown",
  workspaces: ["tasks"],
  senderKind: direction === "inbound" ? "human" : "agent",
  replyToMessageIds: [],
});
function mount(element: React.ReactNode, path = "/messages") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getTextingAgentStatus.mockResolvedValue(status);
  mocks.getTextingConnection.mockResolvedValue({
    state: "active",
    senderPhoneNumber: "+18885550100",
    maskedPhoneNumber: "•••0123",
  });
});
it("shows verified history and paginates older messages", async () => {
  mocks.getTextConversation.mockImplementation((_tz, query) =>
    Promise.resolve({
      connection: { state: "disconnected" },
      messages: query.beforeCursor
        ? [message("old", "inbound", "Yesterday’s request")]
        : [message("new", "outbound", "Your update")],
      hasEarlierMessages: !query.beforeCursor,
      earlierCursor: query.beforeCursor ? null : "old-cursor",
    }),
  );
  mount(<TextConversation userId="one" timeZone="America/New_York" />);
  expect(await screen.findByText("Your update")).toBeVisible();
  expect(screen.getByText(/Delivery unconfirmed/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Message views" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
  expect(await screen.findByText("Yesterday’s request")).toBeVisible();
  expect(mocks.getTextConversation).toHaveBeenCalledWith("America/New_York", {
    limit: 50,
    beforeCursor: "old-cursor",
  });
});
it("requires billing and prompt confirmation and delivers save errors through Sonner", async () => {
  mocks.getTextingAgentStatus.mockResolvedValue({
    ...status,
    enabled: false,
    scheduleId: null,
    chatReady: false,
  });
  mocks.configureTextingAgent.mockRejectedValue(new Error("Cannot save right now"));
  mount(<TextingAgentSettings userId="one" />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Automatic replies" }));
  const button = await screen.findByRole("button", { name: "Enable automatic replies" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Claude routine"), { target: { value: "routine" } });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(button);
  expect(await screen.findByText(/Couldn’t save automatic replies/)).toBeVisible();
  expect(document.querySelector("[data-sonner-toast]")).toHaveTextContent(
    "Couldn’t save automatic replies",
  );
  expect(
    screen.getByText(/Couldn’t save automatic replies/).closest("[data-sonner-toast]"),
  ).not.toBeNull();
});

const run = (
  id: string,
  state: "completed" | "blocked",
  reason: string | null,
  createdAt: string,
) => ({
  id,
  state,
  reason,
  createdAt,
  updatedAt: createdAt,
  hostSessionId: null,
  replyMessageId: null,
  work: [],
});

it("keeps older rejected requests accessible and closable after newer runs", async () => {
  const latest = run("latest", "completed", null, "2026-11-05T12:00:00Z");
  const rejected = run("rejected", "blocked", "host_rejected", "2026-11-04T12:00:00Z");
  let closed = false;
  mocks.getTextConversation.mockResolvedValue({
    connection: {},
    messages: [],
    hasEarlierMessages: false,
  });
  mocks.getTextingAgentStatus.mockImplementation((input) =>
    Promise.resolve({
      ...status,
      runs: input?.beforeRun
        ? [{ ...rejected, reason: closed ? "human_closed" : "host_rejected" }]
        : [latest],
      nextRunCursor: input?.beforeRun ? null : "latest",
    }),
  );
  mocks.recoverTextingAgentRun.mockImplementation(async () => {
    closed = true;
    return { ...status, runs: [latest] };
  });
  mount(<TextConversation userId="one" timeZone="UTC" />);
  const summary = await screen.findByText("Agent runs", { selector: "summary" });
  fireEvent.click(summary);
  expect(screen.queryByRole("button", { name: "Review this run" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load older runs" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review this run" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "Retry saved request" })).toBeEnabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close saved request" }));
  await waitFor(() =>
    expect(mocks.recoverTextingAgentRun).toHaveBeenCalledWith("rejected", {
      action: "close",
      hostStopped: true,
    }),
  );
  expect(await screen.findByText(/Closed without retrying/)).toBeVisible();
  expect(mocks.getTextingAgentStatus).toHaveBeenCalledWith({ beforeRun: "latest" });
});

it("hides cached messages and run details after authorization is denied", async () => {
  mocks.getTextConversation.mockResolvedValue({
    connection: {},
    messages: [message("secret", "inbound", "Private saved message")],
    hasEarlierMessages: false,
  });
  mocks.getTextingAgentStatus.mockResolvedValue({
    ...status,
    runs: [run("private-run", "blocked", "host_rejected", "2026-11-04T12:00:00Z")],
  });
  const { client } = mount(<TextConversation userId="one" timeZone="UTC" />);
  expect(await screen.findByText("Private saved message")).toBeVisible();
  mocks.getTextingAgentStatus.mockRejectedValue(
    new ApiClientError({ code: "forbidden", status: 403, message: "Access denied" }),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["texting-agent"] });
  });
  await waitFor(() => expect(screen.queryByText("Private saved message")).not.toBeInTheDocument());
  expect(screen.queryByText("Agent runs", { selector: "summary" })).not.toBeInTheDocument();
});

it("keeps every conversation locked and does not fetch history before delivered agent proof", async () => {
  mocks.getTextingAgentStatus.mockResolvedValue({ ...status, chatReady: false, verifiedAt: null });
  mount(<TextConversation userId="one" timeZone="UTC" />, "/messages?workspace=calendar");
  expect(await screen.findByText("Connect your agent to unlock Messages")).toBeVisible();
  expect(screen.getByText(/Text “Hello nohmi”/)).toBeVisible();
  expect(mocks.getTextConversation).not.toHaveBeenCalled();
  expect(screen.queryByRole("list", { name: "Conversation history" })).not.toBeInTheDocument();
});
it("passes workspace scope to the server and preserves the original mixed message", async () => {
  mocks.getTextConversation.mockResolvedValue({
    messages: [
      {
        ...message("mixed", "inbound", "Check my calendar and tasks"),
        workspaces: ["calendar", "tasks"],
      },
    ],
    hasEarlierMessages: false,
  });
  mount(<TextConversation userId="one" timeZone="UTC" />, "/messages?workspace=tasks");
  expect(await screen.findByText("Check my calendar and tasks")).toBeVisible();
  expect(mocks.getTextConversation).toHaveBeenCalledWith("UTC", { limit: 50, workspace: "tasks" });
  expect(screen.getByRole("link", { name: "Full conversation" })).toHaveAttribute(
    "href",
    "/messages#message-mixed",
  );
});
it("hides cached history immediately when verification is revoked", async () => {
  mocks.getTextConversation.mockResolvedValue({
    messages: [message("secret", "inbound", "Saved private message")],
    hasEarlierMessages: false,
  });
  const { client } = mount(<TextConversation userId="one" timeZone="UTC" />);
  expect(await screen.findByText("Saved private message")).toBeVisible();
  mocks.getTextingAgentStatus.mockResolvedValue({ ...status, chatReady: false, verifiedAt: null });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["texting-agent"] });
  });
  expect(await screen.findByText("Connect your agent to unlock Messages")).toBeVisible();
  expect(screen.queryByText("Saved private message")).not.toBeInTheDocument();
});

it("retrieves a deep-linked old message directly and focuses it after rendering", async () => {
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  mocks.getTextConversation.mockImplementation((_tz, query) =>
    Promise.resolve({
      messages: query.afterCursor
        ? [message("newer", "outbound", "Later reply")]
        : [message("old-target", "inbound", "Original mixed request")],
      hasEarlierMessages: false,
      earlierCursor: null,
      newerCursor: query.afterCursor ? null : "old-target",
    }),
  );
  mount(<TextConversation userId="one" timeZone="UTC" />, "/messages#message-old-target");
  await screen.findByText("Original mixed request");
  expect(mocks.getTextConversation).toHaveBeenCalledExactlyOnceWith("UTC", {
    limit: 50,
    aroundCursor: "old-target",
  });
  expect(document.getElementById("message-old-target")).toHaveFocus();
  expect(scroll).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Load newer messages" }));
  expect(await screen.findByText("Later reply")).toBeVisible();
  expect(mocks.getTextConversation).toHaveBeenLastCalledWith("UTC", {
    limit: 50,
    afterCursor: "old-target",
  });
  expect(scroll).toHaveBeenCalledOnce();
});

it("enables a chosen routine, clears billing confirmation, and turns replies off", async () => {
  mocks.getTextingAgentStatus.mockResolvedValue({ ...status, enabled: false, scheduleId: null });
  mocks.configureTextingAgent
    .mockResolvedValueOnce(status)
    .mockResolvedValueOnce({ ...status, enabled: false, scheduleId: null });
  mount(<TextingAgentSettings userId="one" />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Automatic replies" }));
  fireEvent.change(await screen.findByLabelText("Claude routine"), {
    target: { value: "routine" },
  });
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(screen.getByRole("button", { name: "Enable automatic replies" }));
  const off = await screen.findByRole("button", { name: "Turn off" });
  expect(mocks.configureTextingAgent).toHaveBeenCalledWith({
    scheduleId: "routine",
    subscriptionOnlyConfirmed: true,
  });
  expect(screen.getByRole("switch")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Enable automatic replies" })).toBeDisabled();
  fireEvent.click(off);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument(),
  );
  expect(mocks.configureTextingAgent).toHaveBeenLastCalledWith({ scheduleId: null });
});

it("directs accounts without a registered routine to Automations", async () => {
  mocks.getTextingAgentStatus.mockResolvedValue({
    ...status,
    enabled: false,
    scheduleId: null,
    routines: [],
  });
  mount(<TextingAgentSettings userId="one" />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Automatic replies" }));
  expect(await screen.findByRole("link", { name: "Automations" })).toHaveAttribute(
    "href",
    "/finances/automations",
  );
  expect(
    screen.queryByRole("button", { name: "Enable automatic replies" }),
  ).not.toBeInTheDocument();
});

it("retries an explicitly rejected start and reports recovery failures through Sonner", async () => {
  const recovered = vi.fn();
  mocks.recoverTextingAgentRun
    .mockRejectedValueOnce(new Error("Routine unavailable"))
    .mockResolvedValueOnce(status);
  mount(
    <TextingRunRecovery
      run={run("rejected", "blocked", "host_rejected", "2026-11-05T12:00:00Z")}
      onRecovered={recovered}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review this run" }));
  expect(screen.getByRole("link", { name: /Inspect the session/ })).toHaveAttribute(
    "href",
    "https://claude.ai/code/routines",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry saved request" }));
  const feedback = await screen.findByText(/Couldn’t.*recover this conversation/);
  expect(feedback.closest("[data-sonner-toast]")).not.toBeNull();
  expect(
    within(screen.getByRole("dialog")).queryByText(/Couldn’t.*recover this conversation/),
  ).not.toBeInTheDocument();
  expect(recovered).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry saved request" }));
  await waitFor(() => expect(recovered).toHaveBeenCalledWith(status));
  expect(mocks.recoverTextingAgentRun).toHaveBeenLastCalledWith("rejected", { action: "retry" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("requires the old session to be stopped before closing an interrupted run", async () => {
  const recovered = vi.fn();
  mocks.recoverTextingAgentRun.mockResolvedValue(status);
  mount(
    <TextingRunRecovery
      run={{
        ...run("interrupted", "blocked", "host_timeout", "2026-11-05T12:00:00Z"),
        hostSessionId: "session/one",
      }}
      onRecovered={recovered}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review this run" }));
  expect(screen.getByRole("link", { name: /Inspect the session/ })).toHaveAttribute(
    "href",
    "https://claude.ai/code/session%2Fone",
  );
  const close = screen.getByRole("button", { name: "Close interrupted run" });
  expect(close).toBeDisabled();
  const checked = screen.getByRole("checkbox");
  fireEvent.click(checked);
  expect(close).toBeEnabled();
  fireEvent.click(checked);
  expect(close).toBeDisabled();
  fireEvent.click(checked);
  fireEvent.click(close);
  await waitFor(() => expect(recovered).toHaveBeenCalledWith(status));
  expect(mocks.recoverTextingAgentRun).toHaveBeenCalledWith("interrupted", {
    action: "close",
    hostStopped: true,
  });
});

it("shows queued and deferred runs without inviting unsafe manual recovery", async () => {
  mocks.getTextConversation.mockResolvedValue({ messages: [], hasEarlierMessages: false });
  mocks.getTextingAgentStatus.mockResolvedValue({
    ...status,
    pendingCount: 2,
    runs: [
      run("retry", "blocked", "retry_requested", "2026-11-05T12:00:00Z"),
      run("limited", "blocked", "rate_limited", "2026-11-05T12:01:00Z"),
      run("shutdown", "blocked", "shutdown_deferred", "2026-11-05T12:02:00Z"),
    ],
  });
  mount(<TextConversation userId="one" timeZone="UTC" />);
  expect(await screen.findByText("2 messages waiting for your agent.")).toBeVisible();
  fireEvent.click(screen.getByText("Agent runs", { selector: "summary" }));
  expect(screen.getByText(/Saved request queued again/)).toBeVisible();
  expect(screen.getByText(/Waiting for the usage limit to reset/)).toBeVisible();
  expect(screen.getByText(/Waiting for nohmi to resume/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Review this run" })).not.toBeInTheDocument();
});

it("shows only unfinished work in the selected workspace while preserving the pending count", async () => {
  mocks.getTextConversation.mockResolvedValue({ messages: [], hasEarlierMessages: false });
  mocks.getTextingAgentStatus.mockResolvedValue({
    ...status,
    pendingCount: 1,
    runs: [
      {
        ...run("work", "blocked", "host_rejected", "2026-11-05T12:00:00Z"),
        work: [
          {
            key: "task",
            domain: "tasks",
            state: "pending",
            references: [],
            note: "Review proposal",
          },
          {
            key: "finance",
            domain: "finances",
            state: "pending",
            references: [],
            note: "Inspect spending",
          },
          {
            key: "done",
            domain: "tasks",
            state: "completed",
            references: [],
            note: "Already finished",
          },
        ],
      },
    ],
  });
  mount(<TextConversation userId="one" timeZone="UTC" />, "/messages?workspace=tasks");
  expect(await screen.findByText("1 message waiting for your agent.")).toBeVisible();
  fireEvent.click(screen.getByText("Agent runs", { selector: "summary" }));
  expect(screen.getByRole("list", { name: "Pending work" })).toHaveTextContent("Review proposal");
  expect(screen.queryByText(/Inspect spending/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Already finished/)).not.toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "View all messages" })).toHaveAttribute(
    "href",
    "/messages",
  );
});

it("removes cached agent settings after authorization is revoked", async () => {
  const { client } = mount(<TextingAgentSettings userId="one" />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Automatic replies" }));
  await screen.findByText("Personal Claude");
  mocks.getTextingAgentStatus.mockRejectedValue(
    new ApiClientError({ code: "forbidden", status: 403, message: "Access denied" }),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["texting-agent-settings"] });
  });
  await waitFor(() => expect(screen.queryByText("Personal Claude")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Edit Automatic replies" })).not.toBeInTheDocument();
});

it("keeps development preview isolated from live agent and conversation queries", async () => {
  mount(<TextConversation userId="one" timeZone="UTC" />, "/messages?preview=messages");
  expect(await screen.findByText(/fictional messages/)).toBeVisible();
  expect(mocks.getTextingAgentStatus).not.toHaveBeenCalled();
  expect(mocks.getTextConversation).not.toHaveBeenCalled();
  expect(mocks.getTextingConnection).not.toHaveBeenCalled();
});

it.each([true, false])("polls only while visible (document hidden=%s)", async (isHidden) => {
  const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
  Object.defineProperty(document, "hidden", { configurable: true, value: isHidden });
  vi.useFakeTimers();
  let view: ReturnType<typeof mount> | undefined;
  try {
    mocks.getTextConversation.mockResolvedValue({
      messages: [message("one", "inbound", "Saved conversation")],
      hasEarlierMessages: false,
    });
    view = mount(<TextConversation userId="one" timeZone="UTC" />);
    // Resolve status, then the enabled history query and React Query notification timers.
    for (let turn = 0; turn < 5; turn++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
    }
    expect(screen.getByText("Saved conversation")).toBeVisible();
    expect(mocks.getTextConversation).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    for (const query of [mocks.getTextConversation, mocks.getTextingAgentStatus]) {
      if (isHidden) expect(query).toHaveBeenCalledTimes(1);
      else expect(query.mock.calls.length).toBeGreaterThan(1);
    }
  } finally {
    view?.unmount();
    vi.useRealTimers();
    if (hidden) Object.defineProperty(document, "hidden", hidden);
    else Reflect.deleteProperty(document, "hidden");
  }
});

it("orders equal-time runs deterministically without dropping either record", async () => {
  mocks.getTextConversation.mockResolvedValue({ messages: [], hasEarlierMessages: false });
  mocks.getTextingAgentStatus.mockResolvedValue({
    ...status,
    runs: [
      run("a", "blocked", "retry_requested", "2026-11-05T12:00:00Z"),
      run("z", "blocked", "rate_limited", "2026-11-05T12:00:00Z"),
    ],
  });
  mount(<TextConversation userId="one" timeZone="UTC" />);
  fireEvent.click(await screen.findByText("Agent runs", { selector: "summary" }));
  const rows = within(screen.getByRole("list", { name: "Agent runs" })).getAllByRole("article");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Waiting for the usage limit to reset");
  expect(rows[1]).toHaveTextContent("Saved request queued again");
});
