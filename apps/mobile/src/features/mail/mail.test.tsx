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
import { MAIL_PAGE_SIZE } from "./logic";
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
  expect(rows).toEqual(["All inboxes", "Inbox3", "Sent", "Receipts", "Inbox"]);
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

  // One action is a direct control, not a menu.
  expect(screen.getByRole("button", { name: "Mark as unread" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Actions for Receipt" })).toBeNull();
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
