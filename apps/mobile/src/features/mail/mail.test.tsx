// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type {
  MailMessage,
  MailSetupAccount,
  MailThread,
  MailThreadSummary,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import InboxRoute from "../../app/(workspaces)/mail/index";
import MailboxesRoute from "../../app/(workspaces)/mail/mailboxes";
import { MAIL_PAGE_SIZE, MAIL_SELECTION_LIMIT, snoozeChoices, snoozeTime } from "./logic";
import { MailReader } from "./reader";
import { UNCONFIRMED_RECHECK_MS } from "./triage";

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
  zone: "UTC",
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
  unsnooze: vi.fn(),
  drafts: vi.fn(),
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
    state: { user: h.owner ? { id: h.owner, planningTimezone: h.zone } : null },
    session: {
      epoch: () => h.epoch,
      api: () => ({
        listMailThreadSummaries: h.summaries,
        getMailSetupContext: h.accounts,
        listMailMessages: h.messages,
        listMailThreads: h.fullThreads,
        updateMailThread: h.update,
        snoozeMailThread: h.snooze,
        unsnoozeMailThread: h.unsnooze,
        listMailDrafts: h.drafts,
        listAttentionItems: async () => [],
        getMailThreadStewardship: async () => ({
          disposition: null,
          obligations: [],
          questions: [],
        }),
      }),
    },
  }),
}));

const summary = (id: string, patch: Partial<MailThreadSummary> = {}): MailThreadSummary => ({
  accountId: "personal",
  from: { name: "Maya Chen", address: "maya@example.test" },
  id,
  mailboxIds: ["personal-inbox"],
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
  threadId: "one",
  to: [{ name: null, address: "me@example.test" }],
  ...patch,
});
const mailbox = (id: string, role: string, name: string, unreadCount = 0) => ({
  accountId: id.split("-")[0],
  id,
  name,
  provider: "google",
  role,
  totalCount: 10,
  unreadCount,
});
const accounts = [
  {
    accountId: "personal",
    label: "Personal",
    email: "me@example.test",
    mailboxes: [
      mailbox("personal-receipts", "custom", "Receipts"),
      mailbox("personal-sent", "sent", "[Gmail]/Sent Mail"),
      mailbox("personal-inbox", "inbox", "INBOX", 3),
    ],
  },
  {
    accountId: "work",
    label: "Work",
    email: "work@example.test",
    mailboxes: [mailbox("work-inbox", "inbox", "INBOX")],
  },
] as unknown as MailSetupAccount[];

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  h.zone = "UTC";
  h.epoch = 0;
  h.params = {};
  h.focus = undefined;
  h.foreground = undefined;
  h.endReached = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.summaries.mockResolvedValue([
    summary("one", { unread: true, messageCount: 2 }),
    summary("two", {
      from: { name: null, address: "billing@example.test" },
      subject: "",
      snippet: "",
    }),
  ]);
  h.accounts.mockResolvedValue({ accounts });
  h.drafts.mockResolvedValue([]);
  h.messages.mockResolvedValue([message("m1")]);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  client.clear();
});
const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={client}>{node}</QueryClientProvider>
);
const cached = (kind: string) =>
  client.getQueryCache().findAll({ predicate: (query) => query.queryKey[2] === kind });

it("lists the unified inbox from body-free summaries", async () => {
  render(wrap(<InboxRoute />));

  expect(screen.getByRole("heading", { name: "Inbox" })).toBeTruthy();
  expect(screen.getByRole("progressbar")).toBeTruthy();
  const unread = await screen.findByRole("button", {
    name: "Unread. Maya Chen. Board packet. The updated agenda is attached. Nov 9. 2 messages",
  });
  expect(within(unread).getByText("Board packet · 2")).toBeTruthy();
  const plain = screen.getByRole("button", { name: "billing@example.test. No subject. Nov 9" });
  expect(within(plain).getByText("No preview available")).toBeTruthy();
  expect(h.summaries).toHaveBeenCalledExactlyOnceWith({
    mailboxRole: "inbox",
    limit: MAIL_PAGE_SIZE,
  });
  // The list never reads the full-thread contract or any message body.
  expect(h.fullThreads).not.toHaveBeenCalled();
  expect(h.messages).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Back to mailboxes" })).toBeNull();
});

it("pages with the last row's cursor and shows each conversation once", async () => {
  const first = Array.from({ length: MAIL_PAGE_SIZE }, (_, index) =>
    summary(`thread-${index}`, {
      receivedAt: `2026-11-09T12:00:${String(index).padStart(2, "0")}.000Z`,
    }),
  );
  h.summaries
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce([first[MAIL_PAGE_SIZE - 1], summary("older", { subject: "Older" })]);
  render(wrap(<InboxRoute />));
  await screen.findAllByRole("button", { name: /Maya Chen/ });
  // Paging is automatic, so a healthy list never offers a manual command.
  expect(screen.queryByRole("button", { name: "Load more messages" })).toBeNull();

  act(() => h.endReached?.());

  expect(await screen.findByText("Older")).toBeTruthy();
  expect(h.summaries).toHaveBeenLastCalledWith({
    mailboxRole: "inbox",
    limit: MAIL_PAGE_SIZE,
    beforeId: `thread-${MAIL_PAGE_SIZE - 1}`,
    beforeReceivedAt: first[MAIL_PAGE_SIZE - 1]?.receivedAt,
  });
  expect(screen.getAllByRole("button", { name: /Maya Chen/ })).toHaveLength(MAIL_PAGE_SIZE + 1);
  expect(screen.queryByRole("button", { name: "Load more messages" })).toBeNull();
  // The short last page ends the list: reaching the end again reads nothing more.
  act(() => h.endReached?.());
  expect(h.summaries).toHaveBeenCalledTimes(2);
});

it("offers Load more only after a page fails, and retries it with one toast", async () => {
  const first = Array.from({ length: MAIL_PAGE_SIZE }, (_, index) => summary(`thread-${index}`));
  h.summaries
    .mockResolvedValueOnce(first)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([summary("older", { subject: "Older", starred: true })]);
  render(wrap(<InboxRoute />));
  await screen.findAllByRole("button", { name: /Maya Chen/ });

  act(() => h.endReached?.());

  const more = await screen.findByRole("button", { name: "Load more messages" });
  // The rows already read stay, and a failed page is not retried by scrolling alone.
  expect(screen.getAllByRole("button", { name: /Maya Chen/ })).toHaveLength(MAIL_PAGE_SIZE);
  expect(h.toast.error).not.toHaveBeenCalled();
  act(() => h.endReached?.());
  expect(h.summaries).toHaveBeenCalledTimes(2);

  fireEvent.click(more);

  expect(
    await screen.findByRole("button", { name: /^Starred\. Maya Chen\. Older\./ }),
  ).toBeTruthy();
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Loading mail…", {
    id: "mail-read-retry",
  });
  expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Mail loaded", {
    id: "mail-read-retry",
  });
  expect(screen.queryByRole("button", { name: "Load more messages" })).toBeNull();
});

it("tells an empty inbox, an unconnected account and a failed read apart", async () => {
  h.summaries.mockResolvedValue([]);
  const view = render(wrap(<InboxRoute />));
  expect(await screen.findByText("You’re all caught up")).toBeTruthy();

  view.unmount();
  client.clear();
  h.accounts.mockResolvedValue({ accounts: [] });
  render(wrap(<InboxRoute />));
  expect(await screen.findByText("Your inbox starts here")).toBeTruthy();
  expect(screen.getByText("Connect a mailbox in Settings to see your messages.")).toBeTruthy();

  cleanup();
  client.clear();
  h.summaries.mockRejectedValueOnce(new Error("offline"));
  h.summaries.mockResolvedValueOnce([summary("one")]);
  render(wrap(<InboxRoute />));
  expect(await screen.findByText("Mail isn’t available")).toBeTruthy();
  expect(screen.queryByText("You’re all caught up")).toBeNull();
  expect(h.toast.error).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: /Maya Chen/ })).toBeTruthy();
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Loading mail…", {
    id: "mail-read-retry",
  });
  expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Mail loaded", {
    id: "mail-read-retry",
  });
});

it("searches on the server after a pause and keeps results apart from the inbox", async () => {
  const view = render(wrap(<InboxRoute />));
  await screen.findByRole("button", { name: /Unread. Maya Chen/ });
  h.summaries.mockResolvedValue([summary("match", { subject: "Venue contract" })]);

  h.params = { mailSearch: "  venue " };
  view.rerender(wrap(<InboxRoute />));
  expect(screen.getByRole("progressbar")).toBeTruthy();
  // The indicator stays through the server read, not only the typing pause.
  let finish: (rows: MailThreadSummary[]) => void = () => {};
  h.summaries.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  expect(screen.getByRole("progressbar", { name: "Searching mail" })).toBeTruthy();
  expect(screen.queryByText("No matching messages")).toBeNull();
  finish([summary("match", { subject: "Venue contract" })]);

  expect(await screen.findByText("Venue contract")).toBeTruthy();
  expect(screen.getByText("Results for “venue”")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText("Board packet · 2")).toBeNull();
  expect(h.summaries).toHaveBeenLastCalledWith({
    mailboxRole: "inbox",
    limit: MAIL_PAGE_SIZE,
    query: "venue",
  });
  expect(h.summaries).toHaveBeenCalledTimes(2);

  h.summaries.mockResolvedValue([]);
  h.params = { mailSearch: "nothing" };
  view.rerender(wrap(<InboxRoute />));
  expect(await screen.findByText("No matching messages")).toBeTruthy();
  expect(screen.queryByText("You’re all caught up")).toBeNull();

  // Clearing the search returns to the inbox pages already read.
  h.params = {};
  view.rerender(wrap(<InboxRoute />));
  expect(await screen.findByText("Board packet · 2")).toBeTruthy();
  expect(screen.queryByText(/Results for/)).toBeNull();
});

it("opens a conversation, reads its messages on demand and discards them on close", async () => {
  h.messages.mockResolvedValue([
    message("m1", {
      cc: [{ name: "Sam", address: "sam@example.test" }],
      attachments: [
        { id: "file", filename: "agenda.pdf", contentType: "application/pdf", size: 9 },
      ],
    }),
    message("m2", { bodyText: "", from: { name: null, address: "me@example.test" }, to: [] }),
  ]);
  render(wrap(<InboxRoute />));
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(await screen.findByRole("button", { name: /Unread. Maya Chen/ }));

  const reader = within(screen.getByRole("dialog"));
  expect(reader.getByRole("heading", { name: "Conversation" })).toBeTruthy();
  expect(reader.getByRole("heading", { name: "Board packet" })).toBeTruthy();
  expect(reader.getByRole("progressbar")).toBeTruthy();
  expect(await reader.findByText("Please review before Thursday.")).toBeTruthy();
  expect(h.messages).toHaveBeenCalledExactlyOnceWith("one");
  expect(reader.getByText(/To me@example\.test/)).toBeTruthy();
  expect(reader.getByText(/Cc Sam/)).toBeTruthy();
  expect(reader.getByText("agenda.pdf")).toBeTruthy();
  expect(reader.getByText("This message has no text content.")).toBeTruthy();
  expect(cached("messages")).toHaveLength(1);

  fireEvent.click(reader.getByRole("button", { name: "Close" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(cached("messages")).toHaveLength(0));
  // Only summaries stay cached, and none of them carries message text or recipients.
  expect(cached("summaries")).toHaveLength(1);
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .findAll()
        .map((query) => query.state.data),
    ),
  ).not.toMatch(/Please review|bodyText|sam@example/);

  fireEvent.click(screen.getByRole("button", { name: /Unread. Maya Chen/ }));
  await within(screen.getByRole("dialog")).findByText("Please review before Thursday.");
  expect(h.messages).toHaveBeenCalledTimes(2);
});

it("explains that message text needs a connection when a conversation cannot be read", async () => {
  h.messages.mockRejectedValueOnce(new Error("offline"));
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: /Unread. Maya Chen/ }));

  const reader = within(screen.getByRole("dialog"));
  expect(await reader.findByText("This conversation isn’t available")).toBeTruthy();
  expect(
    reader.getByText(
      "Message text is never stored on this iPhone, so reading it needs a connection.",
    ),
  ).toBeTruthy();
  // The summary stays readable while the body is unavailable.
  expect(reader.getByRole("heading", { name: "Board packet" })).toBeTruthy();

  h.messages.mockRejectedValueOnce(new Error("still offline"));
  fireEvent.click(reader.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t load mail. Check your connection and try again.",
      { id: "mail-read-retry" },
    ),
  );
  expect(h.toast.success).not.toHaveBeenCalled();

  fireEvent.click(reader.getByRole("button", { name: "Try again" }));
  expect(await reader.findByText("Please review before Thursday.")).toBeTruthy();
  expect(reader.queryByText("This conversation isn’t available")).toBeNull();
  expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Mail loaded", {
    id: "mail-read-retry",
  });
});

it("searches every inbox when typing over the mailbox list", async () => {
  const view = render(wrap(<MailboxesRoute />));
  await screen.findByRole("button", { name: "Inbox, 3 unread" });
  expect(h.summaries).not.toHaveBeenCalled();

  h.summaries.mockResolvedValue([summary("match", { subject: "Venue contract" })]);
  h.params = { mailSearch: "venue" };
  view.rerender(wrap(<MailboxesRoute />));

  expect(await screen.findByText("Venue contract")).toBeTruthy();
  expect(screen.getByText("Results for “venue”")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Mailboxes" })).toBeNull();
  expect(h.summaries).toHaveBeenCalledExactlyOnceWith({
    mailboxRole: "inbox",
    limit: MAIL_PAGE_SIZE,
    query: "venue",
  });

  // Going back clears the search, and clearing the search returns to the mailbox list.
  fireEvent.click(screen.getByRole("button", { name: "Back to mailboxes" }));
  expect(h.setParams).toHaveBeenLastCalledWith({ mailSearch: "" });
  h.params = {};
  view.rerender(wrap(<MailboxesRoute />));
  expect(screen.getByRole("heading", { name: "Mailboxes" })).toBeTruthy();
  expect(screen.queryByText("Venue contract")).toBeNull();
});

it("lists each account's mailboxes and switches between them", async () => {
  render(wrap(<MailboxesRoute />));

  expect(await screen.findByRole("heading", { name: "Personal · me@example.test" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Work · work@example.test" })).toBeTruthy();
  const rows = screen.getAllByRole("button").map((row) => row.textContent);
  expect(rows).toEqual(["All inboxes", "Snoozed", "Inbox3", "Sent", "Receipts", "Inbox"]);
  // The unread count is part of the row's name; a mailbox with none is named plainly.
  expect(screen.getByRole("button", { name: "Inbox, 3 unread" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Inbox" })).toBeTruthy();
  expect(h.summaries).not.toHaveBeenCalled();

  h.summaries.mockResolvedValue([summary("sent", { subject: "Sent note" })]);
  fireEvent.click(screen.getByRole("button", { name: "Sent" }));

  expect(h.setParams).toHaveBeenLastCalledWith({ mailSearch: "" });
  expect(screen.getByRole("heading", { name: "Sent" })).toBeTruthy();
  expect(screen.getByText("Personal")).toBeTruthy();
  expect(await screen.findByText("Sent note")).toBeTruthy();
  expect(h.summaries).toHaveBeenLastCalledWith({
    mailboxId: "personal-sent",
    limit: MAIL_PAGE_SIZE,
  });

  // The way back is the shared link: the registry chevron and the parent's name, no typed glyph.
  const back = screen.getByRole("button", { name: "Back to mailboxes" });
  expect(back.textContent).toBe("Mailboxes");
  expect(within(back).getByTestId("icon-chevron")).toBeTruthy();
  fireEvent.click(back);
  expect(h.setParams).toHaveBeenCalledTimes(2);
  // Mailbox rows sit in the shared group, which owns their surface, seams and side padding.
  const row = screen.getByRole("button", { name: "Sent" });
  expect(row.closest('[data-testid="section-item"]')).not.toBeNull();
  expect(row.closest('[data-testid="form-group"]')).not.toBeNull();
  expect(screen.getByRole("heading", { name: "Mailboxes" })).toBeTruthy();

  h.summaries.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "Receipts" }));
  expect(await screen.findByText("No messages in Receipts")).toBeTruthy();
  expect(h.summaries).toHaveBeenLastCalledWith({
    mailboxId: "personal-receipts",
    limit: MAIL_PAGE_SIZE,
  });

  fireEvent.click(screen.getByRole("button", { name: "Back to mailboxes" }));
  h.summaries.mockResolvedValue([summary("one")]);
  fireEvent.click(screen.getByRole("button", { name: "All inboxes" }));
  expect(await screen.findByRole("button", { name: /Maya Chen/ })).toBeTruthy();
  expect(h.summaries).toHaveBeenLastCalledWith({ mailboxRole: "inbox", limit: MAIL_PAGE_SIZE });
});

it("tells missing accounts, unsynced accounts and a failed mailbox read apart", async () => {
  h.accounts.mockResolvedValue({ accounts: [] });
  render(wrap(<MailboxesRoute />));
  expect(
    await screen.findByText("Connect a mailbox in Settings to see your messages."),
  ).toBeTruthy();

  cleanup();
  client.clear();
  h.accounts.mockResolvedValue({
    accounts: [
      { accountId: "new", label: "new@example.test", email: "new@example.test", mailboxes: [] },
    ],
  });
  render(wrap(<MailboxesRoute />));
  expect(await screen.findByText("No mailboxes have synced for this account yet.")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "new@example.test" })).toBeTruthy();

  cleanup();
  client.clear();
  h.accounts.mockRejectedValueOnce(new Error("offline"));
  h.accounts.mockResolvedValueOnce({ accounts });
  render(wrap(<MailboxesRoute />));
  expect(await screen.findByText("Mailboxes aren’t available")).toBeTruthy();
  expect(screen.queryByText("Connect a mailbox in Settings to see your messages.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Receipts" })).toBeTruthy();
});

it("keeps one signed-in owner's mail out of another's and waits for an owner", async () => {
  const view = render(wrap(<InboxRoute />));
  await screen.findByRole("button", { name: /Unread. Maya Chen/ });

  h.owner = "other";
  h.summaries.mockResolvedValue([summary("theirs", { subject: "Their mail" })]);
  view.rerender(wrap(<InboxRoute />));
  expect(screen.queryByText("Board packet · 2")).toBeNull();
  expect(await screen.findByText("Their mail")).toBeTruthy();

  h.owner = undefined;
  h.summaries.mockClear();
  view.rerender(wrap(<InboxRoute />));
  expect(screen.queryByText("Their mail")).toBeNull();
  expect(h.summaries).not.toHaveBeenCalled();
});

it("revalidates stale mail when the tab regains focus or the app returns to the foreground", async () => {
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", { name: /Unread. Maya Chen/ });
  const refetch = vi.spyOn(client, "refetchQueries");

  const blur = h.focus?.();
  h.foreground?.("background");
  expect(refetch).toHaveBeenCalledTimes(1);
  h.foreground?.("active");
  expect(refetch).toHaveBeenCalledTimes(2);
  expect(refetch).toHaveBeenLastCalledWith({
    queryKey: ["mail", "owner"],
    type: "active",
    stale: true,
  });
  blur?.();
});

it("refreshes on pull and reports a failed refresh once with Sonner, never inline", async () => {
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", { name: /Unread. Maya Chen/ });
  h.summaries.mockResolvedValue([summary("fresh", { subject: "Fresh mail" })]);

  fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  expect(await screen.findByText("Fresh mail")).toBeTruthy();
  expect(h.toast.loading).not.toHaveBeenCalled();
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.toast.error).not.toHaveBeenCalled();

  h.summaries.mockRejectedValue(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t refresh. Pull down to try again.",
    ),
  );
  expect(h.toast.loading).not.toHaveBeenCalled();
  // The last good list stays; no failure copy is rendered beside it.
  expect(screen.getByText("Fresh mail")).toBeTruthy();
  expect(screen.queryByText(/isn’t available|Couldn’t/)).toBeNull();
});

// What the API returns for a confirmed change: the full thread, body and recipients included.
const confirmedThread = (id: string, patch: Partial<MailThread> = {}): MailThread => ({
  ...summary(id),
  bodyText: "Please review before Thursday.",
  remoteThreadId: "provider-thread",
  to: [{ name: null, address: "me@example.test" }],
  updatedAt: "2026-11-09T12:05:00.000Z",
  ...patch,
});
const rejection = (status: number, details?: unknown) =>
  new ApiClientError({ code: "rejected", message: "Rejected", status, details });
const unreadRow = { name: /^Unread\. Maya Chen/ };
const readRow = { name: /^Maya Chen/ };
const choose = (menu: string, action: string) => {
  fireEvent.click(screen.getByRole("button", { name: menu }));
  fireEvent.click(screen.getByRole("button", { name: action }));
};
const noInlineResult = () =>
  expect(
    screen.queryByText(/Marked as|Marking as|archived|Archiving|Couldn’t|no longer available/),
  ).toBeNull();

it("marks a conversation read from the list once the API confirms it", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  let confirm: (thread: MailThread) => void = () => {};
  h.update.mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);

  choose("Actions for Board packet", "Mark as read");
  // The row reads as read at once, and takes no second change while this one is in flight.
  expect(await screen.findByRole("button", readRow)).toBeTruthy();
  expect(screen.queryByRole("button", unreadRow)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Actions for Board packet" }));
  expect(screen.getByRole("button", { name: "Mark as unread" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Archive" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss actions" }));
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Marking as read…");
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.update).toHaveBeenCalledExactlyOnceWith("one", {
    unread: false,
    expectedUpdatedAt: "2026-11-09T12:00:00.000Z",
  });

  h.summaries.mockResolvedValue([summary("one", { updatedAt: "2026-11-09T12:05:00.000Z" })]);
  await act(async () => confirm(confirmedThread("one")));
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Marked as read", { id: "toast-1" }),
  );
  expect(h.toast.error).not.toHaveBeenCalled();
  // Unread counts and the list are read again, and the cached list stays body-free.
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(h.accounts).toHaveBeenCalledTimes(2));
  expect(JSON.stringify(cached("summaries").map((query) => query.state.data))).not.toMatch(
    /bodyText|remoteThreadId|me@example\.test/,
  );
  expect(screen.getByRole("button", readRow)).toBeTruthy();
  noInlineResult();

  // The next change is guarded by the revision the API returned.
  h.update.mockResolvedValueOnce(confirmedThread("one", { unread: true }));
  choose("Actions for Board packet", "Mark as unread");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith("Marked as unread", { id: "toast-1" }),
  );
  expect(h.update).toHaveBeenLastCalledWith("one", {
    unread: true,
    expectedUpdatedAt: "2026-11-09T12:05:00.000Z",
  });
});

it("keeps the confirmed state when the read after it fails", async () => {
  h.update.mockResolvedValueOnce(confirmedThread("one"));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  h.summaries.mockRejectedValue(new Error("offline"));

  choose("Actions for Board packet", "Mark as read");
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", readRow)).toBeTruthy();
  expect(h.toast.success).toHaveBeenCalledTimes(1);
  // A failed refresh after a confirmed write never says the write failed.
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("archives from the list and offers one Undo that moves the conversation back", async () => {
  h.toast.loading.mockReturnValueOnce("archive-toast").mockReturnValueOnce("undo-toast");
  let confirm: (thread: MailThread) => void = () => {};
  h.update.mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);

  choose("Actions for Board packet", "Archive");
  // The conversation leaves the inbox while the provider is asked; nothing is claimed yet.
  await waitFor(() => expect(screen.queryByRole("button", unreadRow)).toBeNull());
  expect(screen.getByRole("button", { name: /billing@example\.test/ })).toBeTruthy();
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Archiving conversation…");
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.update).toHaveBeenCalledExactlyOnceWith("one", {
    mailboxIds: [],
    expectedUpdatedAt: "2026-11-09T12:00:00.000Z",
  });

  h.summaries.mockResolvedValue([summary("two")]);
  await act(async () => confirm(confirmedThread("one", { mailboxIds: [], unread: true })));
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  const [title, options] = h.toast.success.mock.calls[0];
  expect(title).toBe("Conversation archived");
  expect(options).toMatchObject({ id: "archive-toast", duration: 10_000 });
  expect(options.action.label).toBe("Undo");
  expect(screen.queryByRole("button", unreadRow)).toBeNull();
  noInlineResult();

  // Undo restores the mailboxes it had, against the revision the archive returned.
  h.update.mockResolvedValueOnce(confirmedThread("one", { updatedAt: "2026-11-09T12:06:00.000Z" }));
  h.summaries.mockResolvedValue([summary("one", { unread: true }), summary("two")]);
  await act(async () => {
    options.action.onClick();
    options.action.onClick();
  });
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith("Conversation moved back to Inbox", {
      id: "undo-toast",
    }),
  );
  expect(h.toast.loading).toHaveBeenLastCalledWith("Moving back to Inbox…");
  expect(h.update).toHaveBeenCalledTimes(2);
  expect(h.update).toHaveBeenLastCalledWith("one", {
    mailboxIds: ["personal-inbox"],
    expectedUpdatedAt: "2026-11-09T12:05:00.000Z",
  });
  expect(await screen.findByRole("button", unreadRow)).toBeTruthy();
  expect(h.toast.error).not.toHaveBeenCalled();
});

it.each([
  [404, "This conversation is no longer available."],
  [409, "Couldn’t archive the conversation because it changed. Review it and try again."],
  [422, "Couldn’t archive the conversation. It was not changed."],
])("puts an archived conversation back when the API rejects it with %i", async (status, text) => {
  h.toast.loading.mockReturnValue("toast-1");
  let reject: (error: unknown) => void = () => {};
  h.update.mockReturnValueOnce(new Promise((_, fail) => (reject = fail)));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);

  choose("Actions for Board packet", "Archive");
  await waitFor(() => expect(screen.queryByRole("button", unreadRow)).toBeNull());
  await act(async () => reject(rejection(status)));

  // Back in the list, unchanged, with one toast and no result copy on the page.
  expect(await screen.findByRole("button", unreadRow)).toBeTruthy();
  expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(text, { id: "toast-1" });
  expect(h.toast.success).not.toHaveBeenCalled();
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  noInlineResult();
});

it.each([
  ["a lost connection", () => new TypeError("Network request failed")],
  ["a server fault", () => rejection(503)],
  ["a timeout", () => rejection(408)],
  ["a provider change nohmi could not record", () => rejection(503, { partialEffect: true })],
  ["a conflict after the provider changed", () => rejection(409, { partialEffect: true })],
])("never assumes the outcome of an archive after %s", async (_name, fault) => {
  h.toast.loading.mockReturnValue("toast-1");
  h.update.mockRejectedValueOnce(fault());
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  // The fresh read is the authority: here the provider did archive it.
  h.summaries.mockResolvedValue([summary("two")]);

  choose("Actions for Board packet", "Archive");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the conversation was archived. It may have changed in your mailbox; check it once Mail refreshes before trying again.",
      { id: "toast-1" },
    ),
  );
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.update).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(h.accounts).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("button", unreadRow)).toBeNull());
  noInlineResult();
});

it("restores the unread state when marking read is rejected or unconfirmed", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  h.update.mockRejectedValueOnce(rejection(409)).mockRejectedValueOnce(new Error("offline"));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);

  choose("Actions for Board packet", "Mark as read");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t mark the conversation as read because it changed. Review it and try again.",
      { id: "toast-1" },
    ),
  );
  expect(screen.getByRole("button", unreadRow)).toBeTruthy();

  choose("Actions for Board packet", "Mark as read");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Couldn’t confirm the conversation was marked as read. It may have changed in your mailbox; check it once Mail refreshes before trying again.",
      { id: "toast-1" },
    ),
  );
  expect(screen.getByRole("button", unreadRow)).toBeTruthy();
  expect(h.toast.success).not.toHaveBeenCalled();
  noInlineResult();
});

it("marks unread and archives from the open conversation", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  h.update.mockResolvedValueOnce(confirmedThread("two", { unread: true }));
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: /billing@example\.test/ }));
  const reader = await screen.findByRole("dialog");
  await within(reader).findByText("Please review before Thursday.");
  h.summaries.mockResolvedValue([
    summary("two", {
      from: { name: null, address: "billing@example.test" },
      unread: true,
      updatedAt: "2026-11-09T12:05:00.000Z",
    }),
  ]);

  fireEvent.click(within(reader).getByRole("button", { name: "Conversation actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark as unread" }));
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Marked as unread", { id: "toast-1" }),
  );
  expect(h.update).toHaveBeenCalledExactlyOnceWith("two", {
    unread: true,
    expectedUpdatedAt: "2026-11-09T12:00:00.000Z",
  });
  // The conversation stays open and now offers the opposite change.
  expect(within(reader).getByText("Please review before Thursday.")).toBeTruthy();
  fireEvent.click(within(reader).getByRole("button", { name: "Conversation actions" }));
  expect(screen.getByRole("button", { name: "Mark as read" })).toBeTruthy();

  // Archiving closes the conversation at once; a rejection puts it back in the list.
  h.update.mockRejectedValueOnce(rejection(422));
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  await waitFor(() => expect(screen.queryByText("Please review before Thursday.")).toBeNull());
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t archive the conversation. It was not changed.",
      { id: "toast-1" },
    ),
  );
  expect(h.update).toHaveBeenLastCalledWith("two", {
    mailboxIds: [],
    expectedUpdatedAt: "2026-11-09T12:05:00.000Z",
  });
  expect(await screen.findByRole("button", { name: /billing@example\.test/ })).toBeTruthy();
  noInlineResult();
});

it("offers Archive only for a conversation that is in an inbox", async () => {
  h.summaries.mockResolvedValue([
    summary("filed", { mailboxIds: ["personal-receipts"], subject: "Receipt" }),
  ]);
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", readRow);

  fireEvent.click(screen.getByRole("button", { name: "Actions for Receipt" }));
  expect(screen.getByRole("button", { name: "Mark as unread" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Snooze" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
});

it.each([
  ["confirmed", () => Promise.resolve(confirmedThread("one"))],
  ["rejected", () => Promise.reject(rejection(422))],
])("drops a %s change that settles after the session changed", async (_name, settle) => {
  h.toast.loading.mockReturnValue("toast-1");
  let release: () => void = () => {};
  h.update.mockReturnValueOnce(
    new Promise<void>((resolve) => (release = resolve)).then(() => settle()),
  );
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  choose("Actions for Board packet", "Mark as read");

  // Read from the session when the write settles, whether or not the list has re-rendered.
  h.epoch += 1;
  await act(async () => release());
  await waitFor(() => expect(h.toast.dismiss).toHaveBeenCalledExactlyOnceWith("toast-1"));
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("reports the outcome of a change that settles after its list has closed", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  let confirm: (thread: MailThread) => void = () => {};
  h.update.mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)));
  const view = render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  choose("Actions for Board packet", "Archive");

  view.unmount();
  await act(async () => confirm(confirmedThread("one", { mailboxIds: [] })));
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  expect(h.toast.success.mock.calls[0][0]).toBe("Conversation archived");
  expect(h.toast.dismiss).not.toHaveBeenCalled();
});

it("does not undo an archive once the session has changed", async () => {
  h.update.mockResolvedValueOnce(confirmedThread("one", { mailboxIds: [] }));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  choose("Actions for Board packet", "Archive");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));

  h.epoch += 1;
  await act(async () => h.toast.success.mock.calls[0][1].action.onClick());
  expect(h.update).toHaveBeenCalledTimes(1);
  expect(h.toast.loading).toHaveBeenCalledTimes(1);
});

it("offers no Undo after archiving an iCloud conversation", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  h.summaries.mockResolvedValue([summary("one", { provider: "icloud", unread: true })]);
  h.update.mockResolvedValueOnce(confirmedThread("one", { provider: "icloud", mailboxIds: [] }));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  h.summaries.mockResolvedValue([]);

  choose("Actions for Board packet", "Archive");
  // The API cannot move an archived iCloud message back, so no inverse is advertised.
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Conversation archived", {
      id: "toast-1",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("button", unreadRow)).toBeNull());
});

it.each([
  [
    "rejected",
    () => rejection(409),
    "Couldn’t move the conversation back to Inbox because it changed. Review it and try again.",
  ],
  [
    "unconfirmed",
    () => new TypeError("Network request failed"),
    "Couldn’t confirm the conversation was moved back to Inbox. It may have changed in your mailbox; check it once Mail refreshes before trying again.",
  ],
])("keeps an archived conversation out of the inbox when Undo is %s", async (_name, fault, text) => {
  h.toast.loading.mockReturnValueOnce("archive-toast").mockReturnValueOnce("undo-toast");
  h.update.mockResolvedValueOnce(confirmedThread("one", { mailboxIds: [], unread: true }));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  h.summaries.mockResolvedValue([summary("two")]);
  choose("Actions for Board packet", "Archive");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(h.accounts).toHaveBeenCalledTimes(2));
  const undo = h.toast.success.mock.calls[0][1].action.onClick;

  h.update.mockRejectedValueOnce(fault());
  await act(async () => undo());
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(text, { id: "undo-toast" }),
  );
  // Nothing claims it is back: the row stays out, and only a fresh read can return it.
  expect(h.toast.success).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", unreadRow)).toBeNull();
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(h.accounts).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("button", unreadRow)).toBeNull();
  // The failed Undo offers no further Undo, and the first one is spent.
  await act(async () => undo());
  expect(h.update).toHaveBeenCalledTimes(2);
  noInlineResult();
});

it("archives from the open conversation and closes it once confirmed", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  h.update.mockResolvedValueOnce(confirmedThread("one", { mailboxIds: [], unread: true }));
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", unreadRow));
  const reader = await screen.findByRole("dialog");
  await within(reader).findByText("Please review before Thursday.");
  h.summaries.mockResolvedValue([summary("two")]);

  fireEvent.click(within(reader).getByRole("button", { name: "Conversation actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  await waitFor(() => expect(screen.queryByText("Please review before Thursday.")).toBeNull());
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  expect(h.toast.success.mock.calls[0][0]).toBe("Conversation archived");
  expect(h.update).toHaveBeenCalledExactlyOnceWith("one", {
    mailboxIds: [],
    expectedUpdatedAt: "2026-11-09T12:00:00.000Z",
  });
  expect(h.toast.error).not.toHaveBeenCalled();
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("button", unreadRow)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("reads Mail a second time a few seconds after an unconfirmed change, never after a rejection", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
  h.update.mockRejectedValueOnce(rejection(503)).mockRejectedValueOnce(rejection(422));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);

  choose("Actions for Board packet", "Mark as read");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  await act(async () => vi.advanceTimersByTimeAsync(UNCONFIRMED_RECHECK_MS));
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(h.accounts).toHaveBeenCalledTimes(3));

  choose("Actions for Board packet", "Mark as read");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(4));
  await act(async () => vi.advanceTimersByTimeAsync(UNCONFIRMED_RECHECK_MS));
  expect(h.summaries).toHaveBeenCalledTimes(4);

  // A session that changed during the wait is not read for.
  h.update.mockRejectedValueOnce(rejection(503));
  choose("Actions for Board packet", "Mark as read");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(5));
  h.epoch += 1;
  await act(async () => vi.advanceTimersByTimeAsync(UNCONFIRMED_RECHECK_MS));
  expect(h.summaries).toHaveBeenCalledTimes(5);
});

it("reads a conversation without an actions control when its opener offers none", async () => {
  h.messages.mockResolvedValue([message("m1", { bodyText: "Please review before Thursday." })]);
  const close = vi.fn();
  render(wrap(<MailReader thread={summary("two")} close={close} />));

  const reader = await screen.findByRole("dialog");
  await within(reader).findByText("Please review before Thursday.");
  expect(within(reader).queryByRole("button", { name: "Conversation actions" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^(Mark as|Archive)/ })).toBeNull();
  fireEvent.click(within(reader).getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalledOnce();
});

it("puts a conversation back in the inbox when the read after a confirmed Undo fails", async () => {
  h.update.mockResolvedValueOnce(confirmedThread("one", { mailboxIds: [], unread: true }));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  h.summaries.mockResolvedValue([summary("two", { from: { name: null, address: "b@x.test" } })]);
  choose("Actions for Board packet", "Archive");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("button", unreadRow)).toBeNull());

  h.summaries.mockRejectedValue(new Error("offline"));
  h.update.mockResolvedValueOnce(
    confirmedThread("one", { unread: true, updatedAt: "2026-11-09T12:06:00.000Z" }),
  );
  await act(async () => h.toast.success.mock.calls[0][1].action.onClick());
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith(
      "Conversation moved back to Inbox",
      expect.anything(),
    ),
  );
  // The confirmed restore is in the list without the read, and still carries no body.
  expect(await screen.findByRole("button", unreadRow)).toBeTruthy();
  expect(JSON.stringify(cached("summaries").map((query) => query.state.data))).not.toMatch(
    /bodyText|remoteThreadId/,
  );
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("reports nothing when the session changes while reads are being cancelled", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  h.update.mockResolvedValueOnce(confirmedThread("one"));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  const reads = h.summaries.mock.calls.length;
  vi.spyOn(client, "cancelQueries").mockImplementationOnce(async () => {
    h.epoch += 1;
  });

  choose("Actions for Board packet", "Mark as read");
  await waitFor(() => expect(h.toast.dismiss).toHaveBeenCalledExactlyOnceWith("toast-1"));
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.toast.error).not.toHaveBeenCalled();
  // The earlier person's confirmed state is not written into the caches, and nothing is re-read.
  expect(screen.getByRole("button", unreadRow)).toBeTruthy();
  expect(h.summaries).toHaveBeenCalledTimes(reads);
});

/** Snooze and selection results reach the person only as a toast, never as copy on the screen. */
const noSnoozeResult = () =>
  expect(
    screen.queryByText(
      /Snoozed until|Snoozing|Snooze ended|Ending|conversations? (snoozed|archived|marked|unsnoozed)|not confirmed|Couldn’t/,
    ),
  ).toBeNull();
const hold = (name: RegExp) => fireEvent.contextMenu(screen.getByRole("button", { name }));
const row = (name: RegExp, pressed?: boolean) =>
  screen.queryByRole("button", pressed === undefined ? { name } : { name, pressed });
const maya = /Maya Chen/;
const billing = /billing@example\.test/;
const undoOf = (calls: unknown[][]) =>
  (calls.at(-1)?.[1] as { action?: { label: string; onClick: () => void } } | undefined)?.action;

const tokyo = "Asia/Tokyo";

it("snoozes a conversation until a chosen time and ends the snooze on Undo", async () => {
  // The planning time zone decides what tomorrow morning is, not the zone this device is in.
  h.zone = tokyo;
  h.toast.loading.mockReturnValueOnce("snooze-toast").mockReturnValueOnce("undo-toast");
  let confirm: () => void = () => {};
  h.snooze.mockReturnValueOnce(new Promise<void>((resolve) => (confirm = resolve)));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);

  choose("Actions for Board packet", "Snooze");
  const sheet = await screen.findByRole("dialog");
  expect(within(sheet).getByRole("heading", { name: "Snooze" })).toBeTruthy();
  expect(h.snooze).not.toHaveBeenCalled();
  const before = Date.now();
  fireEvent.click(within(sheet).getByRole("button", { name: /Tomorrow morning/ }));

  // Choosing the time is the whole decision: the sheet closes and the conversation leaves.
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(screen.queryByRole("button", unreadRow)).toBeNull());
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Snoozing conversation…");
  expect(h.toast.success).not.toHaveBeenCalled();
  const [id, until] = h.snooze.mock.calls[0];
  expect(id).toBe("one");
  const expected = snoozeChoices(new Date(before), tokyo)[1].until;
  expect(until).toBe(expected.toISOString());
  expect(new Date(until).toLocaleTimeString("en-GB", { timeZone: tokyo })).toBe("08:00:00");
  expect(h.update).not.toHaveBeenCalled();

  h.summaries.mockResolvedValue([summary("two")]);
  await act(async () => confirm());
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  const [title, options] = h.toast.success.mock.calls[0];
  expect(title).toBe(`Snoozed until ${snoozeTime(expected, new Date(), tokyo)}`);
  expect(options).toMatchObject({ id: "snooze-toast", duration: 10_000 });
  expect(options.action.label).toBe("Undo");
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  noSnoozeResult();

  // Undo removes the snooze, once, and offers no further Undo.
  h.unsnooze.mockResolvedValueOnce(undefined);
  h.summaries.mockResolvedValue([summary("one", { unread: true }), summary("two")]);
  await act(async () => {
    options.action.onClick();
    options.action.onClick();
  });
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith("Snooze ended", { id: "undo-toast" }),
  );
  expect(h.toast.loading).toHaveBeenLastCalledWith("Ending snooze…");
  expect(h.snooze).toHaveBeenCalledTimes(1);
  expect(h.unsnooze).toHaveBeenCalledExactlyOnceWith("one");
  expect(await screen.findByRole("button", unreadRow)).toBeTruthy();
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("snoozes until a picked day and time, and refuses one that is not ahead", async () => {
  h.zone = tokyo;
  h.snooze.mockResolvedValue(undefined);
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  choose("Actions for Board packet", "Snooze");
  const sheet = await screen.findByRole("dialog");
  const set = (label: string, value: string) =>
    fireEvent.change(within(sheet).getByRole("textbox", { name: label }), { target: { value } });

  set("Day", "2020-01-01");
  fireEvent.click(within(sheet).getByRole("button", { name: "Snooze until this time" }));
  expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
    "Choose a day and time that are still ahead.",
  );
  expect(h.snooze).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();

  const year = new Date().getFullYear() + 1;
  set("Day", `${year}-03-04`);
  set("Time", "09:30");
  fireEvent.click(within(sheet).getByRole("button", { name: "Snooze until this time" }));
  await waitFor(() => expect(h.snooze).toHaveBeenCalledTimes(1));
  // Half past nine in Tokyo, nine hours ahead of UTC.
  expect(h.snooze).toHaveBeenCalledWith("one", `${year}-03-04T00:30:00.000Z`);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("works out an offered time when it is pressed, not when the sheet opened", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  h.snooze.mockResolvedValue(undefined);
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  choose("Actions for Board packet", "Snooze");
  const sheet = await screen.findByRole("dialog");
  const opened = Date.now();

  // The sheet is left open for five hours: the time it opened with is long past.
  vi.setSystemTime(opened + 5 * 3_600_000);
  fireEvent.click(within(sheet).getByRole("button", { name: /In 3 hours/ }));
  await waitFor(() => expect(h.snooze).toHaveBeenCalledTimes(1));
  const until = new Date(h.snooze.mock.calls[0][1]).getTime();
  expect(until - opened).toBeGreaterThanOrEqual(8 * 3_600_000);
  expect(until).toBeGreaterThan(Date.now());
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("closes the snooze sheet without snoozing", async () => {
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  choose("Actions for Board packet", "Snooze");
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(h.snooze).not.toHaveBeenCalled();
  expect(h.toast.loading).not.toHaveBeenCalled();
  expect(screen.getByRole("button", unreadRow)).toBeTruthy();
});

it.each([
  ["no longer exists", () => rejection(404), "This conversation is no longer available.", false],
  [
    "is refused",
    () => rejection(400),
    "Couldn’t snooze the conversation. It was not changed.",
    false,
  ],
  [
    "is unconfirmed",
    () => new TypeError("Network request failed"),
    "Couldn’t confirm the conversation was snoozed. Check it once Mail refreshes before trying again.",
    true,
  ],
])("puts the conversation back when the snooze %s", async (_name, fault, text, again) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  h.toast.loading.mockReturnValue("toast-1");
  h.snooze.mockRejectedValueOnce(fault());
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  choose("Actions for Board packet", "Snooze");
  fireEvent.click(await screen.findByRole("button", { name: /In 3 hours/ }));

  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(text, { id: "toast-1" }),
  );
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(await screen.findByRole("button", unreadRow)).toBeTruthy();
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  // Only an unknown outcome is worth a second look.
  await act(async () => vi.advanceTimersByTime(UNCONFIRMED_RECHECK_MS));
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(again ? 3 : 2));
  noSnoozeResult();
});

it("lists snoozed conversations and ends a snooze from the list", async () => {
  h.zone = tokyo;
  h.toast.loading.mockReturnValueOnce("toast-1").mockReturnValueOnce("undo-toast");
  h.unsnooze.mockResolvedValueOnce(undefined);
  const wake = new Date(Date.now() + 3 * 86_400_000).toISOString();
  h.summaries.mockResolvedValue([summary("later", { subject: "Renewal", snoozedUntil: wake })]);
  render(wrap(<MailboxesRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "Snoozed" }));

  expect(screen.getByRole("heading", { name: "Snoozed" })).toBeTruthy();
  expect(await screen.findByText("Renewal")).toBeTruthy();
  expect(h.summaries).toHaveBeenLastCalledWith({ snoozed: true, limit: MAIL_PAGE_SIZE });
  // Each conversation says when it returns, read in the planning time zone.
  const returns = `Returns ${snoozeTime(new Date(wake), new Date(), tokyo)}`;
  expect(returns).toContain(
    new Date(wake).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tokyo }),
  );
  expect(screen.getByText(returns)).toBeTruthy();
  expect(screen.getByRole("button", { name: new RegExp(`\\. ${returns}$`) })).toBeTruthy();

  // A snoozed conversation offers to end its snooze, never a second snooze.
  fireEvent.click(screen.getByRole("button", { name: "Actions for Renewal" }));
  expect(screen.queryByRole("button", { name: "Snooze" })).toBeNull();
  h.summaries.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "End snooze" }));
  await waitFor(() => expect(screen.queryByText("Renewal")).toBeNull());
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  const [title, options] = h.toast.success.mock.calls[0];
  expect(title).toBe("Snooze ended");
  expect(options).toMatchObject({ id: "toast-1", duration: 10_000 });
  expect(options.action.label).toBe("Undo");
  // The snooze is removed outright; no time is written to end it.
  expect(h.unsnooze).toHaveBeenCalledExactlyOnceWith("later");
  expect(h.snooze).not.toHaveBeenCalled();
  expect(await screen.findByText("Nothing is snoozed")).toBeTruthy();
  expect(screen.getByText("Conversations you snooze wait here until they return.")).toBeTruthy();
  noSnoozeResult();

  // Undo snoozes it again until the time it was waiting for, and offers no further Undo.
  h.snooze.mockResolvedValueOnce(undefined);
  let reread: (rows: MailThreadSummary[]) => void = () => {};
  h.summaries.mockReturnValue(new Promise((resolve) => (reread = resolve)));
  await act(async () => {
    options.action.onClick();
    options.action.onClick();
  });
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith(
      `Snoozed until ${snoozeTime(new Date(wake), new Date(), tokyo)}`,
      { id: "undo-toast" },
    ),
  );
  expect(h.snooze).toHaveBeenCalledExactlyOnceWith("later", wake);
  expect(h.unsnooze).toHaveBeenCalledTimes(1);
  // It is back in the list with its time before Mail is read again.
  expect(await screen.findByText(returns)).toBeTruthy();
  await act(async () => reread([summary("later", { subject: "Renewal", snoozedUntil: wake })]));
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("offers no Undo for an ended snooze whose time has already passed", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  h.unsnooze.mockResolvedValueOnce(undefined);
  h.summaries.mockResolvedValue([
    summary("later", { subject: "Renewal", snoozedUntil: new Date(Date.now() - 1).toISOString() }),
  ]);
  render(wrap(<MailboxesRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "Snoozed" }));
  await screen.findByText("Renewal");
  choose("Actions for Renewal", "End snooze");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Snooze ended", { id: "toast-1" }),
  );
});

it("keeps an archived snoozed conversation out of the inbox when the archive is undone", async () => {
  h.toast.loading.mockReturnValueOnce("archive-toast").mockReturnValueOnce("undo-toast");
  const wake = new Date(Date.now() + 86_400_000).toISOString();
  const later = summary("later", { subject: "Renewal", snoozedUntil: wake });
  h.summaries.mockImplementation(async (query: { snoozed?: boolean }) =>
    query.snoozed ? [later] : [summary("two")],
  );
  // The inbox was read earlier and is still cached behind the Snoozed list.
  const inbox = ["mail", "owner", "summaries", "inbox", ""];
  client.setQueryData(inbox, { pages: [[summary("two")]], pageParams: [undefined] });
  const listed = () =>
    client
      .getQueryData<{ pages: MailThreadSummary[][] }>(inbox)
      ?.pages.flat()
      .map((thread) => thread.id);
  render(wrap(<MailboxesRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "Snoozed" }));
  await screen.findByText("Renewal");

  h.update.mockResolvedValueOnce(confirmedThread("later", { mailboxIds: [] }));
  choose("Actions for Renewal", "Archive");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  // Archived or not, it is still snoozed and still listed here.
  expect(screen.getByText("Renewal")).toBeTruthy();
  expect(listed()).toEqual(["two"]);

  h.update.mockResolvedValueOnce(confirmedThread("later"));
  await act(async () => undoOf(h.toast.success.mock.calls)?.onClick());
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith("Conversation moved back to Inbox", {
      id: "undo-toast",
    }),
  );
  // A snoozed conversation is listed only under Snoozed, so the inbox never shows it.
  expect(listed()).toEqual(["two"]);
  expect(screen.getByText("Renewal")).toBeTruthy();
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("snoozes from the open conversation and closes it", async () => {
  h.snooze.mockResolvedValueOnce(undefined);
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", unreadRow));
  const reader = await screen.findByRole("dialog");
  fireEvent.click(within(reader).getByRole("button", { name: "Conversation actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
  // The time is asked over the conversation, which is still open underneath.
  expect(screen.getByText("Conversation")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: /Next week/ }));

  await waitFor(() => expect(h.snooze).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
});

it("starts a selection on a long press and selects by tapping, without opening anything", async () => {
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  expect(screen.queryByText(/selected$/)).toBeNull();

  hold(maya);
  expect(screen.getByText("1 selected")).toBeTruthy();
  expect(row(maya, true)).toBeTruthy();
  expect(row(billing, false)).toBeTruthy();
  // While selecting, a row's own actions step aside and a tap selects.
  expect(screen.queryByRole("button", { name: "Actions for Board packet" })).toBeNull();
  fireEvent.click(row(billing) as HTMLElement);
  expect(screen.getByText("2 selected")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(h.messages).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();

  fireEvent.click(row(maya) as HTMLElement);
  expect(screen.getByText("1 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("2 selected")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByText(/selected$/)).toBeNull();
  expect(screen.getByRole("button", { name: "Actions for Board packet" })).toBeTruthy();
  expect(h.update).not.toHaveBeenCalled();
});

it("selects at most a hundred conversations and drops the selection when the search changes", async () => {
  expect(MAIL_SELECTION_LIMIT).toBe(100);
  const page = (from: number) =>
    Array.from({ length: MAIL_PAGE_SIZE }, (_, index) =>
      summary(`t${from + index}`, { subject: `Note ${from + index}` }),
    );
  h.summaries.mockResolvedValueOnce(page(0));
  const view = render(wrap(<InboxRoute />));
  await screen.findByText("Note 0");
  // Two more pages bring the list past the limit.
  h.summaries.mockResolvedValueOnce(page(MAIL_PAGE_SIZE));
  await act(async () => h.endReached?.());
  await screen.findByText(`Note ${MAIL_PAGE_SIZE}`);
  h.summaries.mockResolvedValueOnce([summary("extra", { subject: "Extra" })]);
  await act(async () => h.endReached?.());
  await screen.findByText("Extra");

  hold(/^Maya Chen\. Extra/);
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("100 selected")).toBeTruthy();
  // The limit is reached, so one more is not taken.
  fireEvent.click(row(/^Maya Chen\. Extra/) as HTMLElement);
  expect(screen.getByText("100 selected")).toBeTruthy();

  h.params = { mailSearch: "note" };
  h.summaries.mockResolvedValue([summary("t1", { subject: "Note 1" })]);
  view.rerender(wrap(<InboxRoute />));
  await waitFor(() => expect(screen.queryByText(/selected$/)).toBeNull());
});

const three = () => [
  summary("one", { unread: true }),
  summary("two", {
    unread: true,
    subject: "Invoice",
    from: { name: "Sam", address: "sam@example.test" },
  }),
  summary("three", { subject: "Minutes", from: { name: "Lee", address: "lee@example.test" } }),
];
const selectAll = async () => {
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  hold(maya);
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
};

it("marks the selection read, keeps a failed conversation selected and offers no Undo", async () => {
  h.summaries.mockResolvedValue([
    ...three(),
    summary("four", {
      unread: true,
      subject: "Agenda",
      from: { name: "Ana", address: "ana@example.test" },
    }),
  ]);
  h.toast.loading.mockReturnValueOnce("bulk-toast");
  let last: (thread: MailThread) => void = () => {};
  h.update
    .mockResolvedValueOnce(confirmedThread("one"))
    .mockRejectedValueOnce(new TypeError("Network request failed"))
    .mockReturnValueOnce(new Promise((resolve) => (last = resolve)));
  await selectAll();
  expect(screen.getByText("4 selected")).toBeTruthy();

  const act1 = screen.getByRole("button", { name: "Mark 3 conversations as read" });
  fireEvent.click(act1);
  fireEvent.click(act1);
  // Only the three unread conversations are asked to change, one write at a time.
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Marking 3 conversations as read…");
  await waitFor(() => expect(h.update).toHaveBeenCalledTimes(3));
  expect(h.update.mock.calls.map(([id]) => id)).toEqual(["one", "two", "four"]);
  expect(h.update).toHaveBeenLastCalledWith("four", {
    unread: false,
    expectedUpdatedAt: "2026-11-09T12:00:00.000Z",
  });
  // The selection takes no second action while this one is in flight.
  expect(screen.getByRole("button", { name: "Archive 4 conversations" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(h.toast.error).not.toHaveBeenCalled();

  h.summaries.mockResolvedValue([
    summary("one", { updatedAt: "2026-11-09T12:05:00.000Z" }),
    three()[1],
    three()[2],
    summary("four", {
      subject: "Agenda",
      from: { name: "Ana", address: "ana@example.test" },
      updatedAt: "2026-11-09T12:05:00.000Z",
    }),
  ]);
  await act(async () => last(confirmedThread("four")));
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  const [text, options] = h.toast.error.mock.calls[0];
  expect(text).toBe(
    "2 conversations marked as read; 1 not confirmed. Check Mail before trying again.",
  );
  // Read and unread are reversed from the selection itself, so the toast offers no Undo.
  expect(options).toEqual({ id: "bulk-toast" });
  expect(h.toast.success).not.toHaveBeenCalled();
  // The conversation that was not confirmed stays selected, and only it.
  expect(await screen.findByText("1 selected")).toBeTruthy();
  expect(row(/Sam/, true)).toBeTruthy();
  expect(row(maya, false)).toBeTruthy();
  noSnoozeResult();
  expect(h.update).toHaveBeenCalledTimes(3);
});

it("holds the selection still while its action runs and keeps what was not confirmed", async () => {
  h.summaries.mockResolvedValue(three());
  h.toast.loading.mockReturnValue("bulk-toast");
  let first: (thread: MailThread) => void = () => {};
  h.update
    .mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
    .mockRejectedValueOnce(new TypeError("Network request failed"));
  await selectAll();
  fireEvent.click(screen.getByRole("button", { name: "Mark 2 conversations as read" }));
  await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));

  // Nothing about the selection can be changed until the action reports.
  fireEvent.click(row(/Sam/) as HTMLElement);
  fireEvent.click(row(/Lee/) as HTMLElement);
  hold(maya);
  expect(screen.getByText("3 selected")).toBeTruthy();
  expect(row(/Sam/, true)).toBeTruthy();
  expect(row(/Lee/, true)).toBeTruthy();
  for (const name of ["Cancel", "Archive 3 conversations", "Snooze 3 conversations"])
    expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("3 selected")).toBeTruthy();

  await act(async () => first(confirmedThread("one")));
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "1 conversation marked as read; 1 not confirmed. Check Mail before trying again.",
      { id: "bulk-toast" },
    ),
  );
  // Exactly the unconfirmed conversation is left selected, and the selection is free again.
  expect(await screen.findByText("1 selected")).toBeTruthy();
  expect(row(/Sam/, true)).toBeTruthy();
  fireEvent.click(row(/Lee/) as HTMLElement);
  expect(screen.getByText("2 selected")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", false);
});

it("marks the selection unread", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  h.summaries.mockResolvedValue(three());
  h.update.mockResolvedValueOnce(confirmedThread("three", { unread: true }));
  await selectAll();
  fireEvent.click(screen.getByRole("button", { name: "Mark 1 conversation as unread" }));
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("1 conversation marked as unread", {
    id: "toast-1",
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith("three", {
    unread: true,
    expectedUpdatedAt: "2026-11-09T12:00:00.000Z",
  });
  // Nothing failed, so nothing stays selected.
  await waitFor(() => expect(screen.queryByText(/selected$/)).toBeNull());
});

it("archives the selection and moves back only what Gmail can restore", async () => {
  h.toast.loading.mockReturnValueOnce("bulk-toast").mockReturnValueOnce("undo-toast");
  h.summaries.mockResolvedValue([
    summary("one", { unread: true }),
    summary("cloud", {
      provider: "icloud",
      subject: "Statement",
      from: { name: "Bank", address: "bank@example.test" },
    } as Partial<MailThreadSummary>),
  ]);
  h.update
    .mockResolvedValueOnce(confirmedThread("one", { mailboxIds: [], unread: true }))
    .mockResolvedValueOnce(confirmedThread("cloud", { mailboxIds: ["personal-receipts"] }));
  await selectAll();
  h.summaries.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "Archive 2 conversations" }));

  // Both leave the inbox as they are asked to.
  await waitFor(() => expect(screen.queryByRole("button", { name: maya })).toBeNull());
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Archiving 2 conversations…");
  const [text, options] = h.toast.success.mock.calls[0];
  expect(text).toBe("2 conversations archived");
  expect(options.id).toBe("bulk-toast");
  expect(h.update.mock.calls).toEqual([
    ["one", { mailboxIds: [], expectedUpdatedAt: "2026-11-09T12:00:00.000Z" }],
    ["cloud", { mailboxIds: [], expectedUpdatedAt: "2026-11-09T12:00:00.000Z" }],
  ]);
  expect(screen.queryByText(/selected$/)).toBeNull();
  noSnoozeResult();

  h.update.mockResolvedValueOnce(confirmedThread("one", { updatedAt: "2026-11-09T12:06:00.000Z" }));
  await act(async () => options.action.onClick());
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith("1 conversation moved back to Inbox", {
      id: "undo-toast",
    }),
  );
  expect(h.update).toHaveBeenCalledTimes(3);
  expect(h.update).toHaveBeenLastCalledWith("one", {
    mailboxIds: ["personal-inbox"],
    expectedUpdatedAt: "2026-11-09T12:05:00.000Z",
  });
});

it("offers no Undo when nothing archived can be moved back, and no Archive outside an inbox", async () => {
  h.summaries.mockResolvedValue([
    summary("cloud", { provider: "icloud" } as Partial<MailThreadSummary>),
    summary("filed", {
      mailboxIds: ["personal-receipts"],
      subject: "Receipt",
      from: { name: "Shop", address: "shop@example.test" },
    }),
  ]);
  h.update.mockResolvedValueOnce(confirmedThread("cloud", { mailboxIds: [] }));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", readRow);
  hold(/Shop/);
  hold(maya);
  // One selected conversation is in no inbox, so the selection cannot be archived.
  expect(screen.queryByRole("button", { name: /^Archive/ })).toBeNull();
  fireEvent.click(row(/Shop/) as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: "Archive 1 conversation" }));
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  expect(h.toast.success.mock.calls[0][0]).toBe("1 conversation archived");
  expect(undoOf(h.toast.success.mock.calls)).toBeUndefined();
});

it("snoozes the selection until one chosen time and ends those snoozes on Undo", async () => {
  h.toast.loading.mockReturnValueOnce("bulk-toast").mockReturnValueOnce("undo-toast");
  h.summaries.mockResolvedValue(three());
  h.snooze.mockResolvedValueOnce(undefined).mockRejectedValueOnce(rejection(404));
  h.snooze.mockResolvedValueOnce(undefined);
  h.unsnooze.mockResolvedValue(undefined);
  await selectAll();
  fireEvent.click(screen.getByRole("button", { name: "Snooze 3 conversations" }));
  const sheet = await screen.findByRole("dialog");
  expect(within(sheet).getByRole("heading", { name: "Snooze 3 conversations" })).toBeTruthy();
  const before = Date.now();
  fireEvent.click(within(sheet).getByRole("button", { name: /Tomorrow morning/ }));
  const expected = snoozeChoices(new Date(before), "UTC")[1].until;

  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Snoozing 3 conversations…");
  expect(h.snooze.mock.calls).toEqual(
    ["one", "two", "three"].map((id) => [id, expected.toISOString()]),
  );
  const [text, options] = h.toast.error.mock.calls[0];
  expect(text).toBe(
    `2 conversations snoozed until ${snoozeTime(expected, new Date(), "UTC")}; 1 not confirmed. Check Mail before trying again.`,
  );
  // A definite refusal is not looked at again; the refused conversation stays selected.
  expect(await screen.findByText("1 selected")).toBeTruthy();
  expect(row(/Sam/, true)).toBeTruthy();
  noSnoozeResult();

  await act(async () => options.action.onClick());
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("2 conversations unsnoozed", {
      id: "undo-toast",
    }),
  );
  expect(h.toast.loading).toHaveBeenLastCalledWith("Ending the snooze on 2 conversations…");
  // Only the two confirmed snoozes are removed, and nothing is snoozed a second time.
  expect(h.unsnooze.mock.calls).toEqual([["one"], ["three"]]);
  expect(h.snooze).toHaveBeenCalledTimes(3);
  expect(undoOf(h.toast.success.mock.calls)).toBeUndefined();
});

it("ends the snooze on a selection and puts back only the confirmed ones on Undo", async () => {
  h.toast.loading.mockReturnValueOnce("toast-1").mockReturnValueOnce("undo-toast");
  const wakes = [2, 3, 4].map((days) => new Date(Date.now() + days * 86_400_000).toISOString());
  h.summaries.mockResolvedValue(
    three().map((thread, index) => ({ ...thread, snoozedUntil: wakes[index] })),
  );
  h.unsnooze
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(
      new ApiClientError({ code: "timeout", message: "Request timed out", status: 408 }),
    )
    .mockResolvedValueOnce(undefined);
  h.snooze.mockResolvedValue(undefined);
  render(wrap(<MailboxesRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "Snoozed" }));
  await screen.findByRole("button", unreadRow);
  hold(maya);
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  // Snoozed conversations are not snoozed again from here.
  expect(screen.queryByRole("button", { name: /^Snooze 3/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "End the snooze on 3 conversations" }));

  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  const [text, options] = h.toast.error.mock.calls[0];
  expect(text).toBe("2 conversations unsnoozed; 1 not confirmed. Check Mail before trying again.");
  expect(options).toMatchObject({ id: "toast-1", duration: 10_000 });
  expect(h.unsnooze.mock.calls).toEqual([["one"], ["two"], ["three"]]);
  expect(h.snooze).not.toHaveBeenCalled();
  // The timed-out conversation stays selected and is never asked a second time.
  expect(await screen.findByText("1 selected")).toBeTruthy();
  expect(row(/Sam/, true)).toBeTruthy();
  noSnoozeResult();

  // Undo snoozes each confirmed conversation until its own earlier time.
  await act(async () => options.action.onClick());
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("2 conversations snoozed", {
      id: "undo-toast",
    }),
  );
  expect(h.snooze.mock.calls).toEqual([
    ["one", wakes[0]],
    ["three", wakes[2]],
  ]);
  expect(h.unsnooze).toHaveBeenCalledTimes(3);
});

it("ends snoozes with no Undo when the list carried no time to go back to", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  h.summaries.mockResolvedValue(three());
  h.unsnooze.mockResolvedValue(undefined);
  render(wrap(<MailboxesRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "Snoozed" }));
  await screen.findByRole("button", unreadRow);
  hold(maya);
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  h.summaries.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "End the snooze on 3 conversations" }));

  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("3 conversations unsnoozed", {
      id: "toast-1",
    }),
  );
  expect(h.unsnooze).toHaveBeenCalledTimes(3);
  expect(h.snooze).not.toHaveBeenCalled();
  expect(await screen.findByText("Nothing is snoozed")).toBeTruthy();
});

it.each([
  [
    "refused",
    () => rejection(409),
    "Couldn’t change these conversations. They were not archived.",
    false,
  ],
  [
    "unconfirmed",
    () => new TypeError("Network request failed"),
    "Couldn’t confirm these conversations were archived. Check Mail before trying again.",
    true,
  ],
])("keeps the whole selection when every change is %s", async (_name, fault, text, again) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  h.toast.loading.mockReturnValue("toast-1");
  h.update.mockImplementation(async () => {
    throw fault();
  });
  await selectAll();
  fireEvent.click(screen.getByRole("button", { name: "Archive 2 conversations" }));

  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(text, { id: "toast-1" }),
  );
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.update).toHaveBeenCalledTimes(2);
  // Both come back to the list and stay selected.
  expect(await screen.findByText("2 selected")).toBeTruthy();
  expect(row(maya, true)).toBeTruthy();
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(2));
  await act(async () => vi.advanceTimersByTime(UNCONFIRMED_RECHECK_MS));
  await waitFor(() => expect(h.summaries).toHaveBeenCalledTimes(again ? 3 : 2));
  noSnoozeResult();
});

it("says one conversation was not changed when a selection of one is refused", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  h.update.mockRejectedValueOnce(rejection(409));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  hold(maya);
  fireEvent.click(screen.getByRole("button", { name: "Mark 1 conversation as read" }));
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t change this conversation. It was not marked as read.",
      { id: "toast-1" },
    ),
  );
});

it("says one conversation could not be confirmed when a selection of one is interrupted", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  h.snooze.mockRejectedValueOnce(new TypeError("Network request failed"));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  hold(maya);
  fireEvent.click(screen.getByRole("button", { name: "Snooze 1 conversation" }));
  const before = Date.now();
  fireEvent.click(await screen.findByRole("button", { name: /In 3 hours/ }));
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  const until = new Date(h.snooze.mock.calls[0][1]);
  expect(until.getTime() - before).toBeGreaterThanOrEqual(3 * 3_600_000 - 5_000);
  expect(h.toast.error).toHaveBeenCalledWith(
    `Couldn’t confirm this conversation was snoozed until ${snoozeTime(until, new Date(), "UTC")}. Check Mail before trying again.`,
    { id: "toast-1" },
  );
});

it("reports nothing and stops when the session changes during a selection's action", async () => {
  h.toast.loading.mockReturnValue("toast-1");
  let confirm: (thread: MailThread) => void = () => {};
  h.update.mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)));
  await selectAll();
  fireEvent.click(screen.getByRole("button", { name: "Archive 2 conversations" }));
  await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));

  h.epoch = 1;
  await act(async () => confirm(confirmedThread("one", { mailboxIds: [] })));
  await waitFor(() => expect(h.toast.dismiss).toHaveBeenCalledExactlyOnceWith("toast-1"));
  // The second conversation is never asked to change for the person who left.
  expect(h.update).toHaveBeenCalledTimes(1);
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("does not undo a selection's change once the session has changed", async () => {
  h.update.mockResolvedValue(confirmedThread("one", { mailboxIds: [], unread: true }));
  await selectAll();
  fireEvent.click(screen.getByRole("button", { name: "Archive 2 conversations" }));
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  h.epoch = 1;
  await act(async () => undoOf(h.toast.success.mock.calls)?.onClick());
  expect(h.update).toHaveBeenCalledTimes(2);
  expect(h.toast.loading).toHaveBeenCalledTimes(1);
});

it("counts a conversation that already has a change in flight as not confirmed", async () => {
  h.toast.loading.mockReturnValueOnce("single").mockReturnValueOnce("bulk");
  h.summaries.mockResolvedValue(three());
  let confirm: (thread: MailThread) => void = () => {};
  h.update
    .mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)))
    .mockResolvedValueOnce(confirmedThread("two", { mailboxIds: [] }))
    .mockResolvedValueOnce(confirmedThread("three", { mailboxIds: [] }));
  render(wrap(<InboxRoute />));
  await screen.findByRole("button", unreadRow);
  choose("Actions for Board packet", "Mark as read");
  hold(/Sam/);
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  fireEvent.click(screen.getByRole("button", { name: "Archive 3 conversations" }));

  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledWith(
      "2 conversations archived; 1 not confirmed. Check Mail before trying again.",
      expect.objectContaining({ id: "bulk" }),
    ),
  );
  // The busy conversation was never sent a second change.
  expect(h.update.mock.calls.map(([id]) => id)).toEqual(["one", "two", "three"]);
  await act(async () => confirm(confirmedThread("one")));
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledWith("Marked as read", { id: "single" }),
  );
});
