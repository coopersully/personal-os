// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { TextingAgentStatus, TextMessage } from "@personal-os/domain";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ConversationPreview } from "./conversation-preview";
import { ConversationSetup } from "./conversation-setup";
import { ConversationView } from "./conversation-view";

function mount(element: React.ReactNode) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

it("renders fictional global history with unframed system notices and compact adjacent replies", () => {
  mount(<ConversationPreview mode="messages" timeZone="UTC" />);
  expect(screen.getByText(/fictional messages/)).toBeVisible();
  const notice = screen.getByRole("listitem", { name: "System event" });
  expect(within(notice).queryByText("Your agent")).not.toBeInTheDocument();
  expect(within(notice).queryByText("Delivered")).not.toBeInTheDocument();
  expect(notice.querySelector(".rounded-2xl")).toBeNull();
  const adjacent = screen.getAllByRole("link", { name: "Reply to previous message" });
  expect(adjacent.length).toBeGreaterThan(0);
  for (const reply of adjacent) {
    expect(reply.textContent).toBe("");
    expect(reply.closest(".rounded-2xl")).toBeNull();
  }
  const earlier = screen.getByRole("link", { name: /Reply to: What’s on my calendar/ });
  expect(earlier).toHaveAttribute("href", "#message-demo-one");
  expect(earlier.closest(".rounded-2xl")).toBeNull();
});

it("keeps a mixed original in a filtered preview and routes back to its full context", async () => {
  const user = userEvent.setup();
  mount(<ConversationPreview mode="messages" workspace="tasks" timeZone="UTC" />);
  expect(screen.getByText(/What’s on my calendar this afternoon/)).toBeVisible();
  expect(screen.queryByText(/can you check my recent spending/i)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Full conversation" })).toHaveAttribute(
    "href",
    "/messages?preview=messages#message-demo-one",
  );
  await user.click(screen.getByRole("button", { name: "Message views" }));
  expect(screen.getByRole("menuitem", { name: "All messages" })).toHaveAttribute(
    "href",
    "/messages?preview=messages",
  );
  expect(screen.getByRole("menuitem", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("menuitem", { name: "Preview setup" })).toHaveAttribute(
    "href",
    "/messages?workspace=tasks&preview=messages-locked",
  );
  expect(screen.getByRole("menuitem", { name: "Exit preview" })).toHaveAttribute(
    "href",
    "/messages?workspace=tasks",
  );
});

it("offers all messages from an empty workspace without losing preview isolation", () => {
  mount(<ConversationPreview mode="messages" workspace="mail" timeZone="UTC" />);
  expect(screen.getByText("No Mail messages yet")).toBeVisible();
  expect(screen.getByRole("link", { name: "View all messages" })).toHaveAttribute(
    "href",
    "/messages?preview=messages",
  );
  expect(screen.queryByRole("list", { name: "Conversation history" })).not.toBeInTheDocument();
});

it("shows the first-reply gate even in the connected setup preview", () => {
  mount(<ConversationPreview mode="messages-locked" timeZone="UTC" />);
  expect(screen.getByText("Connect your agent to unlock Messages")).toBeVisible();
  expect(screen.getAllByRole("img", { name: "Complete" })).toHaveLength(2);
  expect(screen.getByRole("img", { name: "Step 3" })).toBeVisible();
  expect(screen.queryByRole("list", { name: "Conversation history" })).not.toBeInTheDocument();
});

it("names missing phone and agent permissions without implying that messages are unlocked", () => {
  const status: TextingAgentStatus = {
    enabled: true,
    scheduleId: null,
    readiness: "permission_required",
    chatReady: false,
    verifiedAt: null,
    pendingCount: 0,
    routines: [],
    runs: [],
    nextRunCursor: null,
    instructions: "",
  };
  mount(<ConversationSetup status={status} />);
  expect(screen.getByText(/Connect the number you’ll text from/)).toBeVisible();
  expect(
    screen.getByText(/Allow your connected agent to read, write and execute Texting/),
  ).toBeVisible();
  expect(screen.queryByRole("img", { name: "Complete" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Texting settings" })).toHaveAttribute(
    "href",
    "/settings?page=texting",
  );
});

it("preserves empty-body and unsettled delivery evidence without fabricating an absent reply parent", () => {
  const message: TextMessage = {
    id: "pending",
    text: "",
    senderKind: "agent",
    direction: "outbound",
    status: "queued",
    workspaces: [],
    replyToMessageIds: ["outside-window"],
    classifiedAt: null,
    occurredAt: "2026-11-05T14:00:00Z",
    localDateTime: "",
    occurredAtSource: "nohmi",
    contentKind: null,
    deliveredAt: null,
    sentAt: null,
    actualSegments: null,
    predictedSegments: null,
    seriesId: null,
    seriesPart: null,
    seriesTotal: null,
  };
  mount(
    <ConversationView
      messages={[
        message,
        {
          ...message,
          id: "tomorrow",
          text: "Following day",
          occurredAt: "2026-11-06T14:00:00Z",
          status: "delivered",
        },
      ]}
      timeZone="UTC"
    />,
  );
  expect(screen.getByText("Message without text")).toBeVisible();
  expect(screen.getByText("queued")).toBeVisible();
  expect(screen.getByText("Delivered")).toBeVisible();
  expect(screen.queryByRole("link", { name: /Reply to/ })).not.toBeInTheDocument();
  expect(screen.getByText("November 5, 2026")).toBeVisible();
  expect(screen.getByText("November 6, 2026")).toBeVisible();
});
