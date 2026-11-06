import type { TextingAgentStatus, TextingConnection, TextMessage } from "@personal-os/domain";
import { ConversationSetup } from "./conversation-setup";
import {
  ConversationNavigation,
  ConversationView,
  type ConversationWorkspace,
} from "./conversation-view";

/** Render-only development fixture. Never changes API state or supplies live readiness evidence. */
export function conversationPreviewMode(url: URL) {
  if (!import.meta.env.DEV || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    return null;
  const mode = url.searchParams.get("preview");
  return mode === "messages" || mode === "messages-locked" ? mode : null;
}

const connection: TextingConnection = {
  id: "demo-connection",
  state: "active",
  senderPhoneNumber: "+1 888 555 0100",
  maskedPhoneNumber: "••• ••• 0123",
  providerReady: true,
  consentEpoch: 1,
  country: "US",
  verifiedAt: "2026-11-05T12:00:00Z",
};
const status: TextingAgentStatus = {
  enabled: true,
  scheduleId: "demo-routine",
  readiness: "ready",
  pendingCount: 0,
  routines: [],
  runs: [],
  nextRunCursor: null,
  instructions: "",
  chatReady: false,
  verifiedAt: null,
};
const message = (
  id: string,
  senderKind: "human" | "agent" | "system",
  text: string,
  minute: number,
  workspaces: ConversationWorkspace[],
  replyToMessageIds: string[] = [],
): TextMessage => ({
  id,
  senderKind,
  text,
  workspaces,
  replyToMessageIds,
  classifiedAt: "2026-11-05T14:00:00Z",
  direction: senderKind === "human" ? "inbound" : "outbound",
  occurredAt: `2026-11-05T14:${String(minute).padStart(2, "0")}:00Z`,
  localDateTime: "Nov 5, 9:00 AM",
  occurredAtSource: "provider",
  status: "delivered",
  deliveredAt: "2026-11-05T14:00:00Z",
  sentAt: "2026-11-05T14:00:00Z",
  contentKind: null,
  actualSegments: 1,
  predictedSegments: 1,
  seriesId: null,
  seriesPart: null,
  seriesTotal: null,
});
const messages = [
  message(
    "demo-one",
    "human",
    "What’s on my calendar this afternoon, and what should I tackle first?",
    0,
    ["calendar", "tasks"],
  ),
  message(
    "demo-two",
    "agent",
    "You’re free after your 1:30 project check-in. There’s a clear window from 2 to 4.",
    1,
    ["calendar"],
    ["demo-one"],
  ),
  message(
    "demo-three",
    "agent",
    "Start with the proposal due tomorrow. Then review the launch checklist. Both fit into your free time from 2 to 4.",
    1,
    ["tasks"],
    ["demo-one"],
  ),
  message("demo-four", "human", "Yes, remind me about the proposal at 2.", 2, ["tasks"]),
  message(
    "demo-five",
    "agent",
    "Your reminder is set for 2 PM today: finish the proposal.",
    2,
    ["tasks"],
    ["demo-four"],
  ),
  message("demo-six", "human", "Can you check my recent spending too?", 3, ["finances"]),
  message(
    "demo-seven",
    "system",
    "I couldn’t confirm your agent started. Your message is saved. Check Messages in nohmi before trying again.",
    4,
    ["finances"],
    ["demo-six"],
  ),
];

export function ConversationPreview({
  mode,
  workspace,
  timeZone,
}: {
  mode: "messages" | "messages-locked";
  workspace?: ConversationWorkspace | undefined;
  timeZone: string;
}) {
  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-2"
      aria-label="Messages preview"
    >
      <p className="text-center text-xs text-muted-foreground">
        Design preview · fictional messages · no live connection verified
      </p>
      <ConversationNavigation workspace={workspace} preview={mode} />
      {mode === "messages-locked" ? (
        <ConversationSetup status={status} connection={connection} />
      ) : (
        <ConversationView
          messages={
            workspace ? messages.filter((item) => item.workspaces.includes(workspace)) : messages
          }
          workspace={workspace}
          timeZone={timeZone}
          preview={mode}
        />
      )}
    </section>
  );
}
