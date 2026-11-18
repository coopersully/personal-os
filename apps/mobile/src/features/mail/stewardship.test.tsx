// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type {
  AttentionItem,
  MailMessage,
  MailSetupAccount,
  MailThreadStewardship,
  MailThreadSummary,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import InboxRoute from "../../app/(workspaces)/mail/index";
import { snoozedScope } from "./logic";
import { MailReader } from "./reader";
import { MailThreadList } from "./thread-list";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner" as string | undefined,
  epoch: 0,
  params: {} as { mailSearch?: string },
  setParams: vi.fn(),
  focus: undefined as undefined | (() => (() => void) | undefined),
  endReached: undefined as undefined | (() => void),
  foreground: undefined as undefined | ((status: string) => void),
  summaries: vi.fn(),
  accounts: vi.fn(),
  messages: vi.fn(),
  fullThreads: vi.fn(),
  update: vi.fn(),
  snooze: vi.fn(),
  drafts: vi.fn(),
  attention: vi.fn(),
  thread: vi.fn(),
  stewardship: vi.fn(),
  answer: vi.fn(),
  toast: { error: vi.fn(), loading: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("react-native", async () => {
  const native = await import("../../../test/native");
  type ListProps = Parameters<typeof native.FlatList>[0] & { onEndReached?: () => void };
  return {
    ...native,
    // The shared indicator double drops its label; keep it so tests can tell indicators apart.
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
    // The shared list double never scrolls; expose the end-of-list callback to the tests.
    FlatList: ({ onEndReached, ...props }: ListProps) => {
      h.endReached = onEndReached;
      return native.FlatList(props);
    },
    // The shared scroll double drops its refresh control; keep it so a pull can be tested.
    ScrollView: ({
      refreshControl,
      children,
    }: PropsWithChildren<{ refreshControl?: ReactNode }>) => (
      <div>
        {refreshControl}
        {children}
      </div>
    ),
    AppState: {
      addEventListener: (_event: string, listener: (status: string) => void) => {
        h.foreground = listener;
        return { remove: vi.fn() };
      },
    },
  };
});
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("sonner-native", () => ({ toast: h.toast }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("expo-router", () => ({
  router: { setParams: h.setParams },
  useLocalSearchParams: () => h.params,
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    h.focus = effect;
  },
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: h.owner ? { id: h.owner } : null },
    session: {
      epoch: () => h.epoch,
      api: () => ({
        listMailThreadSummaries: h.summaries,
        getMailSetupContext: h.accounts,
        listMailMessages: h.messages,
        listMailThreads: h.fullThreads,
        updateMailThread: h.update,
        snoozeMailThread: h.snooze,
        listMailDrafts: h.drafts,
        listAttentionItems: h.attention,
        getMailThread: h.thread,
        getMailThreadStewardship: h.stewardship,
        answerMailQuestion: h.answer,
      }),
    },
  }),
}));

const ONE = "11111111-1111-4111-8111-111111111111";
const ELSEWHERE = "22222222-2222-4222-8222-222222222222";
const summary = (id: string, patch: Partial<MailThreadSummary> = {}): MailThreadSummary => ({
  accountId: "33333333-3333-4333-8333-333333333333",
  from: { name: "Maya Chen", address: "maya@example.test" },
  id,
  mailboxIds: ["44444444-4444-4444-8444-444444444444"],
  messageCount: 1,
  provider: "google",
  receivedAt: "2026-11-09T12:00:00.000Z",
  snippet: "The updated agenda is attached",
  starred: false,
  subject: "Board packet",
  unread: false,
  updatedAt: "2026-11-09T12:00:00.000Z",
  ...patch,
});
const message = (id: string, patch: Partial<MailMessage> = {}): MailMessage => ({
  attachments: [],
  bodyText: "Please review before Thursday.",
  cc: [],
  from: { name: "Maya Chen", address: "maya@example.test" },
  id,
  messageId: null,
  receivedAt: "2026-11-09T12:00:00.000Z",
  references: [],
  replyTo: [],
  threadId: ONE,
  to: [{ name: null, address: "me@example.test" }],
  ...patch,
});
const accounts = [
  {
    accountId: "33333333-3333-4333-8333-333333333333",
    label: "Personal",
    email: "me@example.test",
    mailboxes: [
      {
        accountId: "33333333-3333-4333-8333-333333333333",
        id: "44444444-4444-4444-8444-444444444444",
        name: "INBOX",
        provider: "google",
        role: "inbox",
        totalCount: 10,
        unreadCount: 1,
      },
    ],
  },
] as unknown as MailSetupAccount[];
const item = (id: string, title: string, patch: Partial<AttentionItem> = {}) =>
  ({
    id,
    title,
    summary: `${title} summary`,
    status: "open",
    kind: "important",
    importance: "normal",
    domain: "mail",
    expiresAt: null,
    occursAt: null,
    relatedEntityType: "mail_thread",
    relatedEntityId: ONE,
    source: null,
    createdAt: "2026-11-09T08:00:00.000Z",
    updatedAt: "2026-11-09T08:00:00.000Z",
    version: 1,
    ...patch,
  }) as AttentionItem;
const evidence = (sourceType: string) => ({
  accountId: null,
  provider: "google",
  remoteId: null,
  revision: null,
  sourceType,
});
const question = (id: string, patch: object = {}) => ({
  accountId: "personal",
  answer: null,
  answeredAt: null,
  createdAt: "2026-11-09T08:00:00.000Z",
  evidence: [evidence("mail_thread"), evidence("calendar_event"), evidence("mail_thread")],
  fingerprint: "f".repeat(64),
  id,
  kind: "needs_owner",
  options: [
    { label: "I’ll reply", value: "me" },
    { label: "Maya is handling it", value: "other" },
  ],
  reason: "Who owns the reply to the board?",
  status: "open",
  threadId: ONE,
  updatedAt: "2026-11-09T08:00:00.000Z",
  version: 4,
  ...patch,
});
const obligation = (id: string, patch: object = {}) => ({
  closureEvidence: [],
  confidence: "explicit",
  createdAt: "2026-11-09T08:00:00.000Z",
  dueAt: null,
  goalIds: [],
  id,
  kind: "follow_up",
  nextReviewAt: null,
  owner: { kind: "user" },
  rationale: "Maya asked for comments on the packet.",
  sourceMessageId: null,
  sourceThreadRevision: "2026-11-09T08:00:00.000Z",
  state: "open",
  threadId: ONE,
  updatedAt: "2026-11-09T08:00:00.000Z",
  version: 1,
  ...patch,
});
const found = (patch: object = {}) =>
  ({
    disposition: {
      createdAt: "2026-11-09T08:00:00.000Z",
      current: true,
      disposition: "waiting",
      id: "d1",
      rationale: "The board has not confirmed the date.",
      sourceThreadRevision: "2026-11-09T08:00:00.000Z",
      threadId: ONE,
      version: 1,
    },
    obligations: [
      obligation("o1", { dueAt: "2026-11-12T17:00:00.000Z" }),
      obligation("o2", { kind: "decide", rationale: "Already settled.", state: "resolved" }),
    ],
    questions: [
      question("q1"),
      question("q2", { reason: "An older question.", status: "answered", answer: "me" }),
    ],
    threadId: ONE,
    threadUpdatedAt: "2026-11-09T12:00:00.000Z",
    ...patch,
  }) as unknown as MailThreadStewardship;
const nothing = found({ disposition: null, obligations: [], questions: [] });

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  h.epoch = 0;
  h.params = {};
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.summaries.mockResolvedValue([summary(ONE, { unread: true })]);
  h.accounts.mockResolvedValue({ accounts });
  h.drafts.mockResolvedValue([]);
  h.messages.mockResolvedValue([message("m1")]);
  h.attention.mockResolvedValue([]);
  h.stewardship.mockResolvedValue(nothing);
});
afterEach(() => {
  cleanup();
  client.clear();
});
const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={client}>{node}</QueryClientProvider>
);
const rejection = (status: number) =>
  new ApiClientError({ code: "rejected", message: "Rejected", status });
/** No toast text may also be rendered on the page. */
function expectNoInlineResult() {
  for (const call of [
    ...h.toast.error.mock.calls,
    ...h.toast.success.mock.calls,
    ...h.toast.loading.mock.calls,
  ])
    expect(screen.queryByText(call[0] as string)).toBeNull();
}
const listed = { name: /Maya Chen/ };

it("lists what needs you above the inbox, current items only and the most important first", async () => {
  h.attention.mockResolvedValue([
    item("low", "Newsletter choice", { importance: "low" }),
    item("old", "Expired request", { expiresAt: "2020-01-01T00:00:00.000Z" }),
    item("run", "Mail run finished", { kind: "run_summary", importance: "critical" }),
    item("fare", "Approve the fare", { importance: "critical" }),
    item("note", "A note without a conversation", {
      relatedEntityType: null,
      relatedEntityId: null,
    }),
  ]);
  render(wrap(<InboxRoute />));

  expect(await screen.findByRole("heading", { name: "Needs you" })).toBeTruthy();
  expect(h.attention).toHaveBeenCalledExactlyOnceWith({
    domain: "mail",
    status: "open",
    limit: 100,
  });
  const titles = screen
    .getAllByText(/^(Approve the fare|Newsletter choice|A note without a conversation)$/)
    .map((node) => node.textContent);
  expect(titles).toEqual([
    "Approve the fare",
    "A note without a conversation",
    "Newsletter choice",
  ]);
  expect(screen.getByText("Approve the fare summary")).toBeTruthy();
  expect(screen.getByText("Critical")).toBeTruthy();
  expect(screen.queryByText("Expired request")).toBeNull();
  expect(screen.queryByText("Mail run finished")).toBeNull();
  // An item that is not about a conversation has nothing to open.
  expect(screen.queryByRole("button", { name: /A note without a conversation/ })).toBeNull();
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("keeps the first three in view until asked for the rest", async () => {
  h.attention.mockResolvedValue(
    ["One", "Two", "Three", "Four", "Five"].map((title, index) =>
      item(title, `Item ${title}`, { updatedAt: `2026-11-09T08:00:0${9 - index}.000Z` }),
    ),
  );
  render(wrap(<InboxRoute />));

  await screen.findByText("Item Three");
  expect(screen.queryByText("Item Four")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all 5" }));
  expect(screen.getByText("Item Five")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show all 5" })).toBeNull();
});

it("shows no section when nothing needs you, when the read fails, or outside the inbox", async () => {
  const first = render(wrap(<InboxRoute />));
  await screen.findByRole("button", listed);
  await waitFor(() => expect(h.attention).toHaveBeenCalledOnce());
  expect(screen.queryByRole("heading", { name: "Needs you" })).toBeNull();
  first.unmount();
  client.clear();

  h.attention.mockRejectedValue(new Error("offline"));
  const second = render(wrap(<InboxRoute />));
  await screen.findByRole("button", listed);
  await waitFor(() => expect(h.attention).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("heading", { name: "Needs you" })).toBeNull();
  // The inbox stays usable; only an explicit refresh reports this read.
  expect(h.toast.error).not.toHaveBeenCalled();
  second.unmount();
  client.clear();

  h.attention.mockResolvedValue([item("fare", "Approve the fare")]);
  render(wrap(<MailThreadList scope={snoozedScope} />));
  await screen.findByRole("button", listed);
  expect(h.attention).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("heading", { name: "Needs you" })).toBeNull();
});

it("steps aside for a selection and for search results", async () => {
  h.attention.mockResolvedValue([item("fare", "Approve the fare")]);
  const view = render(wrap(<InboxRoute />));
  await screen.findByRole("heading", { name: "Needs you" });

  fireEvent.contextMenu(screen.getByRole("button", listed));
  expect(screen.getByText("1 selected")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Needs you" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("heading", { name: "Needs you" })).toBeTruthy();

  h.params = { mailSearch: "agenda" };
  view.rerender(wrap(<InboxRoute />));
  await screen.findByText("Results for “agenda”");
  expect(screen.queryByRole("heading", { name: "Needs you" })).toBeNull();
});

it("opens a listed conversation from its row without another read", async () => {
  h.attention.mockResolvedValue([item("fare", "Approve the fare")]);
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", listed);

  fireEvent.click(await screen.findByRole("button", { name: /Approve the fare/ }));

  const reader = await screen.findByRole("dialog");
  expect(within(reader).getByRole("heading", { name: "Board packet" })).toBeTruthy();
  expect(await within(reader).findByText("Please review before Thursday.")).toBeTruthy();
  expect(h.thread).not.toHaveBeenCalled();
  expect(h.toast.loading).not.toHaveBeenCalled();
});

it("reads a conversation the inbox has not listed, and says so when it is gone", async () => {
  h.attention.mockResolvedValue([item("fare", "Approve the fare", { relatedEntityId: ELSEWHERE })]);
  h.thread.mockResolvedValueOnce({
    ...summary(ELSEWHERE, { subject: "Fare approval" }),
    bodyText: "Never kept",
    remoteThreadId: "remote",
    to: [],
  });
  render(wrap(<InboxRoute />));

  fireEvent.click(await screen.findByRole("button", { name: /Approve the fare/ }));

  const reader = await screen.findByRole("dialog");
  expect(within(reader).getByRole("heading", { name: "Fare approval" })).toBeTruthy();
  expect(h.thread).toHaveBeenCalledExactlyOnceWith(ELSEWHERE);
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Opening conversation…", {
    id: "mail-open-owner",
  });
  expect(h.toast.dismiss).toHaveBeenCalledWith("mail-open-owner");
  fireEvent.click(within(reader).getByRole("button", { name: "Close" }));

  h.thread.mockRejectedValueOnce(rejection(404));
  fireEvent.click(screen.getByRole("button", { name: /Approve the fare/ }));
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "This conversation is no longer available.",
      { id: "mail-open-owner" },
    ),
  );
  h.thread.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: /Approve the fare/ }));
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Couldn’t open this conversation. Check your connection and try again.",
      { id: "mail-open-owner" },
    ),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expectNoInlineResult();
});

const openReader = async () => {
  render(wrap(<MailReader thread={summary(ONE)} close={vi.fn()} />));
  const reader = await screen.findByRole("dialog");
  await within(reader).findByText("Please review before Thursday.");
  return reader;
};

it("shows what nohmi found: the disposition, open obligations and open questions", async () => {
  h.stewardship.mockResolvedValue(found());
  const reader = await openReader();

  expect(await within(reader).findByRole("heading", { name: "What nohmi found" })).toBeTruthy();
  expect(h.stewardship).toHaveBeenCalledExactlyOnceWith(ONE);
  expect(within(reader).getByText("Waiting")).toBeTruthy();
  expect(within(reader).getByText("The board has not confirmed the date.")).toBeTruthy();
  expect(within(reader).getByText("Follow up · Due Nov 12")).toBeTruthy();
  expect(within(reader).getByText("Maya asked for comments on the packet.")).toBeTruthy();
  expect(within(reader).queryByText("Already settled.")).toBeNull();
  expect(within(reader).getByText("Who owns the reply to the board?")).toBeTruthy();
  expect(within(reader).getByText("Based on this conversation and a calendar event")).toBeTruthy();
  expect(within(reader).getByRole("radio", { name: "I’ll reply", checked: false })).toBeTruthy();
  expect(within(reader).getByRole("radio", { name: "Maya is handling it" })).toBeTruthy();
  expect(within(reader).queryByText("An older question.")).toBeNull();
  // Nothing can be sent until an option is chosen.
  expect(within(reader).getByRole("button", { name: "Send answer" })).toHaveProperty(
    "disabled",
    true,
  );
  // Reading is all the phone offers for a disposition or an obligation.
  expect(within(reader).queryByRole("button", { name: /disposition|obligation/i })).toBeNull();
});

it("shows no findings section when nohmi found nothing", async () => {
  const reader = await openReader();
  await waitFor(() => expect(h.stewardship).toHaveBeenCalledOnce());
  expect(within(reader).queryByRole("heading", { name: "What nohmi found" })).toBeNull();
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("sends the chosen answer with the question's version and drops the answered question", async () => {
  h.stewardship.mockResolvedValueOnce(found());
  h.stewardship.mockResolvedValue(found({ questions: [] }));
  h.answer.mockResolvedValue({});
  const reader = await openReader();

  fireEvent.click(await within(reader).findByRole("radio", { name: "Maya is handling it" }));
  fireEvent.click(within(reader).getByRole("button", { name: "Send answer" }));

  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Answer sent", {
      id: "mail-answer-q1",
    }),
  );
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Sending answer…", {
    id: "mail-answer-q1",
  });
  expect(h.answer).toHaveBeenCalledExactlyOnceWith("q1", {
    answer: "other",
    expectedVersion: 4,
    generalize: false,
  });
  await waitFor(() =>
    expect(within(reader).queryByText("Who owns the reply to the board?")).toBeNull(),
  );
  expect(h.stewardship).toHaveBeenCalledTimes(2);
  // The rest of what nohmi found stays.
  expect(within(reader).getByText("Waiting")).toBeTruthy();
  expect(h.toast.error).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("says a question changed elsewhere on a conflict and reads it again", async () => {
  h.stewardship.mockResolvedValueOnce(found());
  h.stewardship.mockResolvedValue(
    found({ questions: [question("q1", { reason: "Who owns it now?", version: 5 })] }),
  );
  h.answer.mockRejectedValue(rejection(409));
  const reader = await openReader();

  fireEvent.click(await within(reader).findByRole("radio", { name: "I’ll reply" }));
  fireEvent.click(within(reader).getByRole("button", { name: "Send answer" }));

  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith("This question changed elsewhere.", {
      id: "mail-answer-q1",
    }),
  );
  expect(await within(reader).findByText("Who owns it now?")).toBeTruthy();
  expect(h.stewardship).toHaveBeenCalledTimes(2);
  expect(h.answer).toHaveBeenCalledOnce();
  expect(h.toast.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("reports a rejected answer as not saved and a missing question as gone", async () => {
  h.stewardship.mockResolvedValue(found());
  h.answer.mockRejectedValueOnce(rejection(422)).mockRejectedValueOnce(rejection(404));
  const reader = await openReader();

  fireEvent.click(await within(reader).findByRole("radio", { name: "I’ll reply" }));
  fireEvent.click(within(reader).getByRole("button", { name: "Send answer" }));
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith("Couldn’t send the answer. It was not saved.", {
      id: "mail-answer-q1",
    }),
  );
  await waitFor(() =>
    expect(within(reader).getByRole("button", { name: "Send answer" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(within(reader).getByRole("button", { name: "Send answer" }));
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith("This question is no longer available.", {
      id: "mail-answer-q1",
    }),
  );
  expectNoInlineResult();
});

it.each([
  ["a lost connection", new Error("offline")],
  ["a timeout", rejection(408)],
  ["a server fault", rejection(503)],
])("reports %s as not confirmed, keeps the choice and sends nothing again", async (_, error) => {
  h.stewardship.mockResolvedValue(found());
  h.answer.mockRejectedValue(error);
  const reader = await openReader();

  fireEvent.click(await within(reader).findByRole("radio", { name: "I’ll reply" }));
  fireEvent.click(within(reader).getByRole("button", { name: "Send answer" }));

  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the answer was sent. Check the question once it reloads before trying again.",
      { id: "mail-answer-q1" },
    ),
  );
  await waitFor(() => expect(h.stewardship).toHaveBeenCalledTimes(2));
  expect(within(reader).getByRole("radio", { name: "I’ll reply", checked: true })).toBeTruthy();
  expect(h.answer).toHaveBeenCalledOnce();
  expect(h.toast.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("says nothing to a person who signed in after the answer was sent", async () => {
  h.stewardship.mockResolvedValue(found());
  let settle: (value: unknown) => void = () => {};
  h.answer.mockReturnValue(new Promise((resolve) => (settle = resolve)));
  const reader = await openReader();

  fireEvent.click(await within(reader).findByRole("radio", { name: "I’ll reply" }));
  fireEvent.click(within(reader).getByRole("button", { name: "Send answer" }));
  // A second press while the first is in flight sends nothing more.
  fireEvent.click(within(reader).getByRole("button", { name: "Send answer" }));
  h.epoch += 1;
  settle({});

  await waitFor(() => expect(h.toast.dismiss).toHaveBeenCalledWith("mail-answer-q1"));
  expect(h.answer).toHaveBeenCalledOnce();
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.stewardship).toHaveBeenCalledOnce();
});

it("keeps the conversation readable and raises one toast when the findings cannot be read", async () => {
  h.stewardship.mockRejectedValue(new Error("offline"));
  const reader = await openReader();

  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t load what nohmi found in this conversation.",
      { id: `mail-stewardship-${ONE}` },
    ),
  );
  expect(within(reader).getByText("Please review before Thursday.")).toBeTruthy();
  expect(within(reader).queryByRole("heading", { name: "What nohmi found" })).toBeNull();
  expect(within(reader).queryByText("This conversation isn’t available")).toBeNull();
  expectNoInlineResult();
});

it("drops a choice the reloaded question no longer offers, so nothing unseen can be sent", async () => {
  h.stewardship.mockResolvedValueOnce(found());
  h.stewardship.mockResolvedValue(
    found({
      questions: [
        question("q1", {
          version: 5,
          options: [
            { label: "Reply today", value: "today" },
            { label: "I’ll reply", value: "me" },
          ],
        }),
      ],
    }),
  );
  h.answer.mockRejectedValue(rejection(409));
  const reader = await openReader();

  fireEvent.click(await within(reader).findByRole("radio", { name: "I’ll reply" }));
  fireEvent.click(within(reader).getByRole("button", { name: "Send answer" }));

  await within(reader).findByRole("radio", { name: "Reply today" });
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledOnce());
  // The earlier choice is not carried onto the changed question, even where a value survives.
  expect(within(reader).queryByRole("radio", { checked: true })).toBeNull();
  const send = within(reader).getByRole("button", { name: "Send answer" });
  expect(send).toHaveProperty("disabled", true);
  fireEvent.click(send);
  expect(h.answer).toHaveBeenCalledOnce();

  // A fresh choice is sent against the version now shown.
  h.answer.mockResolvedValue({});
  fireEvent.click(within(reader).getByRole("radio", { name: "Reply today" }));
  await waitFor(() => expect(send).toHaveProperty("disabled", false));
  fireEvent.click(send);
  await waitFor(() =>
    expect(h.answer).toHaveBeenLastCalledWith("q1", {
      answer: "today",
      expectedVersion: 5,
      generalize: false,
    }),
  );
});

it("treats a choice missing from the current options as no choice", async () => {
  h.stewardship.mockResolvedValueOnce(found());
  h.stewardship.mockResolvedValue(
    found({
      questions: [question("q1", { options: [{ label: "Reply today", value: "today" }] })],
    }),
  );
  // An unknown outcome keeps the choice, yet the question can still come back changed.
  h.answer.mockRejectedValue(rejection(503));
  const reader = await openReader();

  fireEvent.click(await within(reader).findByRole("radio", { name: "I’ll reply" }));
  fireEvent.click(within(reader).getByRole("button", { name: "Send answer" }));

  await within(reader).findByRole("radio", { name: "Reply today", checked: false });
  const send = within(reader).getByRole("button", { name: "Send answer" });
  await waitFor(() => expect(h.stewardship).toHaveBeenCalledTimes(2));
  expect(send).toHaveProperty("disabled", true);
  fireEvent.click(send);
  expect(h.answer).toHaveBeenCalledOnce();
});

it("raises no second toast when the read after an answer fails", async () => {
  h.stewardship.mockResolvedValueOnce(found());
  h.stewardship.mockRejectedValue(new Error("offline"));
  h.answer.mockResolvedValueOnce({}).mockRejectedValueOnce(rejection(503));
  const reader = await openReader();

  fireEvent.click(await within(reader).findByRole("radio", { name: "I’ll reply" }));
  fireEvent.click(within(reader).getByRole("button", { name: "Send answer" }));
  await waitFor(() => expect(h.stewardship).toHaveBeenCalledTimes(2));
  const send = within(reader).getByRole("button", { name: "Send answer" });
  await waitFor(() => expect(send).toHaveProperty("disabled", false));
  expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Answer sent", { id: "mail-answer-q1" });
  expect(h.toast.error).not.toHaveBeenCalled();

  fireEvent.click(send);
  await waitFor(() => expect(h.stewardship).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(send).toHaveProperty("disabled", false));
  expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
    "Couldn’t confirm the answer was sent. Check the question once it reloads before trying again.",
    { id: "mail-answer-q1" },
  );
  expectNoInlineResult();
});

it("raises one toast for a pull that fails to read both the messages and the findings", async () => {
  h.stewardship.mockResolvedValueOnce(found());
  const reader = await openReader();
  await within(reader).findByRole("heading", { name: "What nohmi found" });
  h.messages.mockRejectedValue(new Error("offline"));
  h.stewardship.mockRejectedValue(new Error("offline"));

  fireEvent.click(within(reader).getByRole("button", { name: "Refresh list" }));

  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t refresh. Pull down to try again.",
    ),
  );
  await waitFor(() => expect(h.stewardship).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(h.toast.error).toHaveBeenCalledOnce();

  // A pull where only the findings fail is still reported, once.
  h.messages.mockResolvedValue([message("m1")]);
  fireEvent.click(within(reader).getByRole("button", { name: "Refresh list" }));
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(h.toast.error).toHaveBeenCalledTimes(2);
  expect(h.toast.error).toHaveBeenLastCalledWith("Couldn’t refresh. Pull down to try again.");
});
