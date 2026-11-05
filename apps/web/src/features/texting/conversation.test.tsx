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
  getTextingAgentStatus: vi.fn(),
  configureTextingAgent: vi.fn(),
  recoverTextingAgentRun: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: mocks }));
const status = {
  enabled: false,
  scheduleId: null,
  readiness: "disabled",
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
});
function mount(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getTextingAgentStatus.mockResolvedValue(status);
});
it("shows history while automatic replies are off and paginates older messages", async () => {
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
  expect(screen.getByText(/Automatic replies are off/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
  expect(await screen.findByText("Yesterday’s request")).toBeVisible();
  expect(mocks.getTextConversation).toHaveBeenCalledWith("America/New_York", {
    limit: 50,
    beforeCursor: "old-cursor",
  });
});
it("requires billing and prompt confirmation and delivers save errors through Sonner", async () => {
  mocks.configureTextingAgent.mockRejectedValue(new Error("Cannot save right now"));
  mount(<TextingAgentSettings userId="one" />);
  const button = await screen.findByRole("button", { name: "Enable automatic replies" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Claude routine"), { target: { value: "routine" } });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
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
