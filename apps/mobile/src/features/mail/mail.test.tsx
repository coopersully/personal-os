// @vitest-environment jsdom
import type { MailMessage, MailSetupAccount, MailThreadSummary } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import InboxRoute from "../../app/(workspaces)/mail/index";
import MailboxesRoute from "../../app/(workspaces)/mail/mailboxes";
import { MAIL_PAGE_SIZE } from "./logic";

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
  params: {} as { mailSearch?: string },
  setParams: vi.fn(),
  focus: undefined as undefined | (() => (() => void) | undefined),
  foreground: undefined as undefined | ((status: string) => void),
  summaries: vi.fn(),
  accounts: vi.fn(),
  messages: vi.fn(),
  fullThreads: vi.fn(),
  toast: { error: vi.fn(), loading: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  AppState: {
    addEventListener: (_event: string, listener: (status: string) => void) => {
      h.foreground = listener;
      return { remove: vi.fn() };
    },
  },
}));
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
      api: () => ({
        listMailThreadSummaries: h.summaries,
        getMailSetupContext: h.accounts,
        listMailMessages: h.messages,
        listMailThreads: h.fullThreads,
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
  h.params = {};
  h.focus = undefined;
  h.foreground = undefined;
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
    name: "Unread. Maya Chen. Board packet. The updated agenda is attached",
  });
  expect(within(unread).getByText("Board packet · 2")).toBeTruthy();
  const plain = screen.getByRole("button", { name: "billing@example.test. No subject" });
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

  fireEvent.click(await screen.findByRole("button", { name: "Load more messages" }));

  expect(await screen.findByText("Older")).toBeTruthy();
  expect(h.summaries).toHaveBeenLastCalledWith({
    mailboxRole: "inbox",
    limit: MAIL_PAGE_SIZE,
    beforeId: `thread-${MAIL_PAGE_SIZE - 1}`,
    beforeReceivedAt: first[MAIL_PAGE_SIZE - 1]?.receivedAt,
  });
  expect(screen.getAllByRole("button", { name: /Maya Chen/ })).toHaveLength(MAIL_PAGE_SIZE + 1);
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

it("lists each account's mailboxes and switches between them", async () => {
  h.params = { mailSearch: "stale" };
  render(wrap(<MailboxesRoute />));

  expect(await screen.findByRole("heading", { name: "Personal · me@example.test" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Work · work@example.test" })).toBeTruthy();
  const rows = screen.getAllByRole("button").map((row) => row.textContent);
  expect(rows).toEqual(["All inboxes", "Inbox3", "Sent", "Receipts", "Inbox"]);
  expect(h.summaries).not.toHaveBeenCalled();

  h.summaries.mockResolvedValue([summary("sent", { subject: "Sent note" })]);
  fireEvent.click(screen.getByRole("button", { name: "Sent" }));
  h.params = {};

  expect(h.setParams).toHaveBeenLastCalledWith({ mailSearch: "" });
  expect(screen.getByRole("heading", { name: "Sent" })).toBeTruthy();
  expect(screen.getByText("Personal")).toBeTruthy();
  expect(await screen.findByText("Sent note")).toBeTruthy();
  expect(h.summaries).toHaveBeenLastCalledWith({
    mailboxId: "personal-sent",
    limit: MAIL_PAGE_SIZE,
    query: "stale",
  });

  fireEvent.click(screen.getByRole("button", { name: "Back to mailboxes" }));
  expect(h.setParams).toHaveBeenCalledTimes(2);
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
