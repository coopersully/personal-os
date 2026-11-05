// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithFeedback as render } from "@/test-utils/feedback";
import { TextingAgentSettings } from "./agent-settings.js";
import { TextConversation } from "./conversation.js";

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
