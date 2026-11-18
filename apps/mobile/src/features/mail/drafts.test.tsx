// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type {
  MailDraft,
  MailMessage,
  MailSetupAccount,
  MailThreadSummary,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import InboxRoute from "../../app/(workspaces)/mail/index";
import MailboxesRoute from "../../app/(workspaces)/mail/mailboxes";
import { forgetUnconfirmedSends, useDraftWrites } from "./drafts";

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
  summaries: vi.fn(),
  accounts: vi.fn(),
  messages: vi.fn(),
  drafts: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  send: vi.fn(),
  reconcile: vi.fn(),
  confirm: vi.fn(),
  store: new Map<string, string>(),
  storeFails: false,
  storeReadFails: false,
  storeDeleteGate: null as Promise<void> | null,
  toast: { error: vi.fn(), loading: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("react-native", async () => import("../../../test/native"));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("sonner-native", () => ({ toast: h.toast }));
vi.mock("expo-secure-store", () => {
  const guard = () => {
    if (h.storeFails) throw new Error("Keychain unavailable");
  };
  return {
    getItemAsync: async (key: string) => {
      guard();
      if (h.storeReadFails) throw new Error("Keychain read failed");
      return h.store.get(key) ?? null;
    },
    setItemAsync: async (key: string, value: string) => {
      guard();
      h.store.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      guard();
      await h.storeDeleteGate;
      h.store.delete(key);
    },
  };
});
vi.mock("expo-router", () => ({
  router: { setParams: vi.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => {},
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("../tasks/ui", () => ({ confirm: h.confirm }));
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
        listMailDrafts: h.drafts,
        createMailDraft: h.create,
        updateMailDraft: h.update,
        deleteMailDraft: h.remove,
        sendMailDraft: h.send,
        reconcileMailDraft: h.reconcile,
        updateMailThread: vi.fn(),
      }),
    },
  }),
}));

const account = (accountId: string, email: string) =>
  ({ accountId, label: accountId, email, mailboxes: [] }) as unknown as MailSetupAccount;
const draft = (patch: Partial<MailDraft> = {}): MailDraft => ({
  accountId: "personal",
  body: "See you at ten.",
  cc: [],
  createdAt: "2026-11-16T10:00:00.000Z",
  id: "draft-1",
  reconciliationState: "none",
  sendClaimedAt: null,
  sendStatus: "draft",
  sentAt: null,
  subject: "Thursday",
  threadId: null,
  to: [{ address: "maya@example.test", name: null }],
  updatedAt: "2026-11-16T10:00:00.000Z",
  ...patch,
});
const thread = {
  accountId: "personal",
  from: { name: "Maya Chen", address: "maya@example.test" },
  id: "thread-1",
  mailboxIds: [],
  messageCount: 1,
  provider: "google",
  receivedAt: "2026-11-09T12:00:00.000Z",
  snippet: "The updated agenda is attached",
  starred: false,
  subject: "Board packet",
  unread: false,
  updatedAt: "2026-11-09T12:00:00.000Z",
} as MailThreadSummary;
const received = {
  attachments: [],
  bodyText: "Please review before Thursday.",
  cc: [],
  from: thread.from,
  id: "m1",
  messageId: null,
  receivedAt: thread.receivedAt,
  references: [],
  replyTo: [],
  threadId: thread.id,
  to: [{ name: null, address: "me@example.test" }],
} as MailMessage;
const fault = (status: number, details?: unknown) =>
  new ApiClientError({ code: "fault", message: "Fault", status, details });
const offline = () => new TypeError("Network request failed");

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  forgetUnconfirmedSends();
  h.store.clear();
  h.storeFails = false;
  h.storeReadFails = false;
  h.storeDeleteGate = null;
  h.owner = "owner";
  h.epoch = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.summaries.mockResolvedValue([thread]);
  h.accounts.mockResolvedValue({ accounts: [account("personal", "me@example.test")] });
  h.messages.mockResolvedValue([received]);
  h.drafts.mockResolvedValue([draft()]);
  h.toast.loading.mockReturnValue("toast-1");
  // The person accepts every confirmation unless a test says otherwise.
  h.confirm.mockImplementation((_title: string, _message: string, accept: () => void) => accept());
});
afterEach(() => {
  cleanup();
  client.clear();
});
const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={client}>{node}</QueryClientProvider>
);
const field = (label: string) => screen.getByRole("textbox", { name: label }) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const composer = () => screen.queryByRole("textbox", { name: "Message" });
/** Action results reach the person only as a toast, never as copy on the screen. */
const noInlineResult = () =>
  expect(
    screen.queryByText(
      /Draft saved|Saving draft|Message sent|Sending message|Couldn’t|Draft discarded|Recorded as|not sent, and/,
    ),
  ).toBeNull();
const openDraft = async (name = /Thursday/) => {
  render(wrap(<MailboxesRoute />));
  fireEvent.click(await screen.findByRole("button", { name }));
};
/** Opens the saved draft and takes it to the review step without changing it. */
const review = async () => {
  await openDraft();
  press("Review and send");
  await screen.findByRole("button", { name: "Send message" });
};

it("lists unsent drafts with their state and leaves sent ones out", async () => {
  h.drafts.mockResolvedValue([
    draft(),
    draft({ id: "agent", subject: "", to: [] }),
    draft({ id: "review", subject: "Invoice", sendStatus: "reconcile" }),
    draft({ id: "busy", subject: "Hello", sendStatus: "sending" }),
    draft({ id: "sent", subject: "Already out", sendStatus: "sent" }),
  ]);
  render(wrap(<MailboxesRoute />));

  expect(await screen.findByRole("button", { name: /Thursday/ })).toBeTruthy();
  expect(screen.getAllByText("maya@example.test")).toHaveLength(3);
  expect(screen.getByText("No subject")).toBeTruthy();
  expect(screen.getByText("No recipients")).toBeTruthy();
  expect(screen.getByText("Needs review")).toBeTruthy();
  expect(screen.getByText("Sending")).toBeTruthy();
  expect(screen.queryByText("Already out")).toBeNull();
});

it("says when there are no drafts and offers a retry when they cannot be read", async () => {
  h.drafts.mockResolvedValueOnce([]);
  const view = render(wrap(<MailboxesRoute />));
  expect(await screen.findByText(/No drafts\./)).toBeTruthy();
  view.unmount();
  client.clear();

  h.drafts.mockRejectedValueOnce(offline()).mockResolvedValue([draft()]);
  render(wrap(<MailboxesRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "Load drafts" }));
  expect(await screen.findByRole("button", { name: /Thursday/ })).toBeTruthy();
  expect(h.toast.success).toHaveBeenCalledWith("Mail loaded", { id: "mail-read-retry" });
});

it("saves a new message as a draft with one toast and no inline result", async () => {
  let confirm: (saved: MailDraft) => void = () => {};
  h.create.mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)));
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "New message" }));
  type("To", "Maya Chen <maya@example.test>, sam@example.test");
  type("Cc", "lee@example.test");
  type("Subject", " Thursday ");
  type("Message", "See you at ten.");

  press("Save draft");
  press("Save draft");
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Saving draft…");
  await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
  expect(h.create).toHaveBeenCalledExactlyOnceWith({
    accountId: "personal",
    to: [
      { address: "maya@example.test", name: "Maya Chen" },
      { address: "sam@example.test", name: null },
    ],
    cc: [{ address: "lee@example.test", name: null }],
    subject: "Thursday",
    body: "See you at ten.",
    threadId: null,
  });
  expect(h.toast.success).not.toHaveBeenCalled();

  await act(async () => confirm(draft({ id: "new", subject: "Thursday" })));
  expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Draft saved", { id: "toast-1" });
  // The saved record is what the form now holds, and a further save updates it.
  expect(field("Subject").value).toBe("Thursday");
  noInlineResult();
  h.update.mockResolvedValueOnce(draft({ id: "new", body: "Changed" }));
  type("Message", "Changed");
  press("Save draft");
  await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
  expect(h.update.mock.calls[0]).toEqual([
    "new",
    expect.objectContaining({ body: "Changed", expectedUpdatedAt: "2026-11-16T10:00:00.000Z" }),
  ]);
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(h.send).not.toHaveBeenCalled();
});

it("refuses to save an address that is not one, without calling the API", async () => {
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "New message" }));
  type("To", "maya");
  press("Save draft");
  expect(h.toast.error).toHaveBeenCalledExactlyOnceWith("“maya” is not an email address.");
  press("Review and send");
  expect(h.toast.error).toHaveBeenCalledTimes(2);
  type("To", "");
  press("Review and send");
  expect(h.toast.error).toHaveBeenLastCalledWith("Add at least one recipient.");
  expect(h.create).not.toHaveBeenCalled();
  expect(h.toast.loading).not.toHaveBeenCalled();
  noInlineResult();
});

it("chooses the sending account when more than one is connected", async () => {
  h.accounts.mockResolvedValue({
    accounts: [account("personal", "me@example.test"), account("work", "work@example.test")],
  });
  h.create.mockResolvedValueOnce(draft({ accountId: "work" }));
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "New message" }));
  press("From, me@example.test");
  fireEvent.click(screen.getByRole("radio", { name: "work@example.test" }));
  type("To", "maya@example.test");
  press("Save draft");
  await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
  expect(h.create.mock.calls[0]?.[0]).toMatchObject({ accountId: "work" });
});

it("edits a draft an agent prepared against the revision it opened with", async () => {
  h.update.mockResolvedValueOnce(
    draft({ subject: "Thursday at ten", updatedAt: "2026-11-16T10:05:00.000Z" }),
  );
  await openDraft();
  expect(field("To").value).toBe("maya@example.test");
  expect(field("Message").value).toBe("See you at ten.");

  type("Subject", "Thursday at ten");
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Draft saved", { id: "toast-1" }),
  );
  expect(h.update).toHaveBeenCalledExactlyOnceWith("draft-1", {
    accountId: "personal",
    to: [{ address: "maya@example.test", name: null }],
    cc: [],
    subject: "Thursday at ten",
    body: "See you at ten.",
    threadId: null,
    expectedUpdatedAt: "2026-11-16T10:00:00.000Z",
  });
  expect(h.create).not.toHaveBeenCalled();
  noInlineResult();
});

it("keeps what was typed when the draft changed somewhere else", async () => {
  h.update.mockRejectedValueOnce(fault(409));
  h.drafts.mockResolvedValue([draft({ body: "Edited on the web", updatedAt: "later" })]);
  await openDraft();
  type("Message", "Edited here");
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "This draft changed somewhere else. Close it and open it again to continue.",
      { id: "toast-1" },
    ),
  );
  expect(field("Message").value).toBe("Edited here");
  expect(h.update).toHaveBeenCalledTimes(1);
  noInlineResult();
});

it.each([
  ["refused", () => fault(422), "Couldn’t save the draft. Check the recipients and try again."],
  ["interrupted", offline, "Couldn’t confirm the draft was saved. Try again."],
])("reports a %s save of an existing draft", async (_name, error, text) => {
  h.update.mockRejectedValueOnce(error());
  await openDraft();
  type("Message", "Edited here");
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(text, { id: "toast-1" }),
  );
  expect(field("Message").value).toBe("Edited here");
});

it("treats an interrupted save as saved once the draft holds that text", async () => {
  h.update.mockRejectedValueOnce(offline());
  await openDraft();
  h.drafts.mockResolvedValue([
    draft({ body: "Edited here", updatedAt: "2026-11-16T10:05:00.000Z" }),
  ]);
  type("Message", "Edited here");
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Draft saved", { id: "toast-1" }),
  );
  expect(h.toast.error).not.toHaveBeenCalled();
  expect(h.update).toHaveBeenCalledTimes(1);
});

it("says a draft is gone when it was deleted elsewhere", async () => {
  h.update.mockRejectedValueOnce(fault(404));
  await openDraft();
  h.drafts.mockResolvedValue([]);
  type("Message", "Edited here");
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith("This draft is no longer available.", {
      id: "toast-1",
    }),
  );
});

it("does not create a second draft after a create the API never confirmed", async () => {
  const first = draft({ id: "landed", subject: "Hello", body: "", to: [] });
  h.create.mockRejectedValueOnce(offline());
  h.drafts.mockResolvedValue([]);
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "New message" }));
  type("Subject", "Hello");
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the draft was saved. Try again; nohmi checks first.",
      { id: "toast-1" },
    ),
  );

  // The drafts cannot be read: nothing is written.
  h.drafts.mockRejectedValueOnce(offline());
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Couldn’t check your drafts, so nothing was saved. Try again.",
      { id: "toast-1" },
    ),
  );
  expect(h.create).toHaveBeenCalledTimes(1);

  // A new draft now holds this text. Nothing says whether the interrupted create made it,
  // so it is neither adopted nor copied, and the person is sent to Drafts.
  h.drafts.mockResolvedValue([first]);
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "A draft with this text is already in Drafts. Open it there to continue.",
      { id: "toast-1" },
    ),
  );
  // Editing after that unchanged retry makes a new draft; the matching one is never updated.
  h.create.mockResolvedValueOnce({ ...first, id: "second", body: "More" });
  type("Message", "More");
  press("Save draft");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  expect(h.create).toHaveBeenCalledTimes(2);
  expect(h.update).not.toHaveBeenCalled();
  expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Draft saved", { id: "toast-1" });
});

it("never writes over a draft that appeared while a create was unconfirmed", async () => {
  // The create never landed. Meanwhile an agent wrote a draft with the same text.
  h.drafts.mockResolvedValueOnce([draft()]);
  h.create.mockRejectedValueOnce(offline());
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "New message" }));
  type("Subject", "Hello");
  press("Save draft");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));

  const agents = draft({ id: "agents", subject: "Hello", body: "", to: [] });
  h.drafts.mockResolvedValue([draft(), agents]);
  h.create.mockResolvedValueOnce(draft({ id: "mine", subject: "Hello", body: "More", to: [] }));
  type("Message", "More");
  press("Save draft");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  // The changed text is a new draft; nothing can tell the agent's draft from the person's.
  expect(h.create).toHaveBeenCalledTimes(2);
  expect(h.create.mock.calls[1]?.[0]).toMatchObject({ subject: "Hello", body: "More" });
  expect(h.update).not.toHaveBeenCalled();
});

it("creates again after an unconfirmed create that left no draft", async () => {
  const first = draft({ id: "landed", subject: "Hello", body: "", to: [] });
  h.create.mockRejectedValueOnce(offline()).mockResolvedValueOnce(first);
  h.drafts.mockResolvedValue([]);
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "New message" }));
  type("Subject", "Hello");
  press("Save draft");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  press("Save draft");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  expect(h.create).toHaveBeenCalledTimes(2);
  expect(h.update).not.toHaveBeenCalled();
});

it("says a refused create was not saved", async () => {
  h.create.mockRejectedValueOnce(fault(400));
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "New message" }));
  type("Subject", "Hello");
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t save the draft. Check the recipients and try again.",
      { id: "toast-1" },
    ),
  );
  // Nothing landed, so the next save creates again rather than looking for a draft to adopt.
  h.drafts.mockResolvedValue([draft({ subject: "Hello", body: "", to: [] })]);
  h.create.mockResolvedValueOnce(draft());
  press("Save draft");
  await waitFor(() => expect(h.create).toHaveBeenCalledTimes(2));
  expect(h.update).not.toHaveBeenCalled();
});

it("writes no new draft when the existing drafts cannot be read first", async () => {
  h.drafts.mockRejectedValue(offline());
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "New message" }));
  type("Subject", "Hello");
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t check your drafts, so nothing was saved. Try again.",
      { id: "toast-1" },
    ),
  );
  expect(h.create).not.toHaveBeenCalled();
});

it("never takes over an older draft that holds the same text", async () => {
  // An agent's draft already says exactly what this new message says.
  const older = draft({ id: "older", subject: "Hello", body: "", to: [] });
  h.drafts.mockResolvedValue([older]);
  h.create.mockRejectedValueOnce(offline());
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "New message" }));
  type("Subject", "Hello");
  press("Save draft");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));

  // The interrupted create never landed. The changed text becomes a new draft; the older
  // draft is neither adopted nor overwritten.
  h.create.mockResolvedValueOnce(draft({ id: "new", subject: "Hello", body: "More", to: [] }));
  type("Message", "More");
  press("Save draft");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  expect(h.create).toHaveBeenCalledTimes(2);
  expect(h.update).not.toHaveBeenCalled();
});

it("discards a draft only after the person confirms", async () => {
  h.confirm.mockImplementationOnce(() => {});
  h.remove.mockResolvedValueOnce(undefined);
  await openDraft();
  press("Discard draft");
  expect(h.confirm).toHaveBeenCalledExactlyOnceWith(
    "Discard this draft?",
    "The draft is deleted. This can’t be undone.",
    expect.any(Function),
    true,
  );
  expect(h.remove).not.toHaveBeenCalled();

  press("Discard draft");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Draft discarded", { id: "toast-1" }),
  );
  expect(h.remove).toHaveBeenCalledExactlyOnceWith("draft-1");
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Discarding draft…");
  await waitFor(() => expect(composer()).toBeNull());
  noInlineResult();
});

it.each([
  ["refused", () => fault(404), "This draft can no longer be discarded."],
  [
    "interrupted",
    offline,
    "Couldn’t confirm the draft was discarded. Check Drafts before trying again.",
  ],
])("keeps the draft open when a discard is %s", async (_name, error, text) => {
  h.remove.mockRejectedValueOnce(error());
  await openDraft();
  press("Discard draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(text, { id: "toast-1" }),
  );
  expect(composer()).toBeTruthy();
  noInlineResult();
});

it("asks before closing over unsaved text, and closes a clean draft at once", async () => {
  h.confirm.mockImplementationOnce(() => {});
  await openDraft();
  type("Message", "Edited here");
  press("Cancel");
  expect(h.confirm).toHaveBeenCalledExactlyOnceWith(
    "Discard changes?",
    "What you typed since the last save will be lost.",
    expect.any(Function),
    true,
  );
  expect(composer()).toBeTruthy();
  press("Cancel");
  expect(composer()).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /Thursday/ }));
  press("Close");
  expect(composer()).toBeNull();
  expect(h.confirm).toHaveBeenCalledTimes(2);
  expect(h.remove).not.toHaveBeenCalled();
});

it("sends only from the review, once, at the revision that was reviewed", async () => {
  let confirm: () => void = () => {};
  h.send.mockReturnValueOnce(new Promise<void>((resolve) => (confirm = resolve)));
  await openDraft();
  press("Review and send");

  // The review shows who it goes to and what it says before anything is sent.
  const sheet = screen.getAllByRole("dialog").at(-1) as HTMLElement;
  expect(within(sheet).getByText("Review message")).toBeTruthy();
  expect(within(sheet).getByText("me@example.test")).toBeTruthy();
  expect(within(sheet).getByText("maya@example.test")).toBeTruthy();
  expect(within(sheet).getByText("Thursday")).toBeTruthy();
  expect(within(sheet).getByText("See you at ten.")).toBeTruthy();
  expect(h.send).not.toHaveBeenCalled();
  expect(h.update).not.toHaveBeenCalled();

  press("Send message");
  press("Send message");
  await waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
  expect(h.send).toHaveBeenCalledExactlyOnceWith({
    draftId: "draft-1",
    confirmedUpdatedAt: "2026-11-16T10:00:00.000Z",
  });
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Sending message…");
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(composer() ?? screen.queryByText("Review message")).toBeTruthy();

  await act(async () => confirm());
  expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Message sent", { id: "toast-1" });
  await waitFor(() => expect(screen.queryByText("Review message")).toBeNull());
  expect(h.send).toHaveBeenCalledTimes(1);
  noInlineResult();
});

it("saves edits before the review and sends the saved revision", async () => {
  h.update.mockResolvedValueOnce(
    draft({ body: "See you at eleven.", updatedAt: "2026-11-16T10:05:00.000Z" }),
  );
  h.send.mockResolvedValueOnce(undefined);
  await openDraft();
  type("Message", "See you at eleven.");
  press("Review and send");
  await screen.findByRole("button", { name: "Send message" });
  expect(screen.getByText("See you at eleven.")).toBeTruthy();
  expect(h.send).not.toHaveBeenCalled();

  press("Keep editing");
  expect(field("Message").value).toBe("See you at eleven.");
  press("Review and send");
  press("Send message");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith("Message sent", expect.anything()),
  );
  expect(h.update).toHaveBeenCalledTimes(1);
  expect(h.send).toHaveBeenCalledExactlyOnceWith({
    draftId: "draft-1",
    confirmedUpdatedAt: "2026-11-16T10:05:00.000Z",
  });
});

it("does not open the review when the draft could not be saved", async () => {
  h.update.mockRejectedValueOnce(fault(422));
  await openDraft();
  type("Message", "See you at eleven.");
  press("Review and send");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
  expect(h.send).not.toHaveBeenCalled();
});

it.each([
  [
    "the provider refused it",
    () => fault(503, { retrySafe: true, partialEffect: false }),
    "Couldn’t send the message. It was not sent, and your draft is saved.",
  ],
  [
    "the API refused it",
    () => fault(403),
    "Couldn’t send the message. It was not sent, and your draft is saved.",
  ],
  [
    "the draft changed after the review",
    () => fault(409),
    "This draft changed after you reviewed it. Review it again before sending.",
  ],
])("leaves the draft intact when %s", async (_name, error, text) => {
  h.send.mockRejectedValueOnce(error());
  await review();
  h.drafts.mockResolvedValue([draft({ updatedAt: "2026-11-16T10:06:00.000Z" })]);
  press("Send message");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(text, { id: "toast-1" }),
  );
  // Back to the draft, text intact; nothing is sent again without a new review.
  expect(field("Message").value).toBe("See you at ten.");
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.toast.success).not.toHaveBeenCalled();
  noInlineResult();

  h.send.mockResolvedValueOnce(undefined);
  press("Review and send");
  press("Send message");
  await waitFor(() => expect(h.send).toHaveBeenCalledTimes(2));
  expect(h.send).toHaveBeenLastCalledWith({
    draftId: "draft-1",
    confirmedUpdatedAt: "2026-11-16T10:06:00.000Z",
  });
});

it.each([
  ["a lost connection", offline, [draft()]],
  ["a server fault", () => fault(500), [draft({ sendStatus: "sending" })]],
  [
    "a provider effect",
    () => fault(503, { partialEffect: true }),
    [draft({ sendStatus: "reconcile" })],
  ],
  ["a refusal with the draft gone", () => fault(404), []],
  // A refusal that carries a provider effect proves nothing, even over an unsent record.
  ["a conflict with a provider effect", () => fault(409, { partialEffect: true }), [draft()]],
  ["a conflict while another send runs", () => fault(409), [draft({ sendStatus: "sending" })]],
  ["a conflict awaiting review", () => fault(409), [draft({ sendStatus: "reconcile" })]],
  ["a claim the API could not release", () => fault(503, { retrySafe: false }), [draft()]],
  ["a request timeout", () => fault(408), [draft()]],
])("locks the message after an interrupted send: %s", async (_name, error, after) => {
  h.send.mockRejectedValueOnce(error());
  await review();
  h.drafts.mockResolvedValue(after);
  press("Send message");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm whether this message was sent. Check Sent mail before sending again.",
      { id: "toast-1" },
    ),
  );
  // Nothing is sent again and nothing offers to: only a check, or the person's own record.
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review and send" })).toBeNull();
  expect(composer()).toBeNull();
  expect(screen.getByText("See you at ten.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  noInlineResult();
});

it("locks the message when the drafts cannot be read after an interrupted send", async () => {
  h.send.mockRejectedValueOnce(offline());
  await review();
  h.drafts.mockRejectedValue(offline());
  press("Send message");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();

  press("Check again");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith("Couldn’t check this message. Try again.", {
      id: "toast-1",
    }),
  );
  expect(h.toast.loading).toHaveBeenLastCalledWith("Checking this message…");
  expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
  expect(h.send).toHaveBeenCalledTimes(1);
});

it("reports an interrupted send as sent once the draft's record says so", async () => {
  h.send.mockRejectedValueOnce(offline());
  await review();
  h.drafts.mockResolvedValue([draft({ sendStatus: "sent", sentAt: "2026-11-16T10:06:00.000Z" })]);
  press("Send message");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Message sent", { id: "toast-1" }),
  );
  expect(h.toast.error).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText("Review message")).toBeNull());
  expect(h.send).toHaveBeenCalledTimes(1);
});

it("checks an unconfirmed send again without sending", async () => {
  h.send.mockRejectedValueOnce(offline());
  await review();
  h.drafts.mockResolvedValue([draft({ sendStatus: "sending" })]);
  press("Send message");
  await screen.findByRole("button", { name: "Check again" });
  expect(screen.getByText(/doesn’t know whether this message was sent/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "It was sent" })).toBeNull();

  press("Check again");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "This message is still being sent. Check again in a moment.",
      { id: "toast-1" },
    ),
  );

  h.drafts.mockResolvedValue([draft({ sendStatus: "reconcile" })]);
  press("Check again");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Delivery is still unconfirmed. Check Sent mail, then record what happened.",
      { id: "toast-1" },
    ),
  );
  expect(screen.getByRole("button", { name: "It was sent" })).toBeTruthy();

  // Recorded as unsent, but the revision cannot be retired: a late send could still land.
  h.drafts.mockResolvedValue([draft({ updatedAt: "2026-11-16T10:07:00.000Z" })]);
  h.update.mockRejectedValueOnce(fault(409));
  press("Check again");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Couldn’t confirm this message is safe to send again. Check again.",
      { id: "toast-1" },
    ),
  );
  expect(composer()).toBeNull();

  // The draft is saved again unchanged, so the revision that was sent can no longer send;
  // the draft opens at the new revision and sending needs a new review.
  h.update.mockResolvedValueOnce(draft({ updatedAt: "2026-11-16T10:08:00.000Z" }));
  press("Check again");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith(
      "This message is recorded as not sent. Review it before sending.",
      { id: "toast-1" },
    ),
  );
  expect(h.update).toHaveBeenLastCalledWith("draft-1", {
    accountId: "personal",
    to: [{ address: "maya@example.test", name: null }],
    cc: [],
    subject: "Thursday",
    body: "See you at ten.",
    threadId: null,
    expectedUpdatedAt: "2026-11-16T10:07:00.000Z",
  });
  expect(field("Message").value).toBe("See you at ten.");
  expect(h.send).toHaveBeenCalledTimes(1);
  h.send.mockResolvedValueOnce(undefined);
  press("Review and send");
  press("Send message");
  await waitFor(() => expect(h.send).toHaveBeenCalledTimes(2));
  expect(h.send).toHaveBeenLastCalledWith({
    draftId: "draft-1",
    confirmedUpdatedAt: "2026-11-16T10:08:00.000Z",
  });
});

it("closes a checked message the record shows as sent", async () => {
  h.drafts.mockResolvedValue([draft({ sendStatus: "reconcile" })]);
  await openDraft();
  h.drafts.mockResolvedValue([draft({ sendStatus: "sent" })]);
  press("Check again");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Message sent", { id: "toast-1" }),
  );
  await waitFor(() => expect(screen.queryByRole("button", { name: "Check again" })).toBeNull());
  expect(h.send).not.toHaveBeenCalled();
});

it("records what the person found for a send that needs review", async () => {
  h.drafts.mockResolvedValue([draft({ sendStatus: "reconcile" })]);
  h.reconcile.mockResolvedValueOnce(draft({ updatedAt: "2026-11-16T10:08:00.000Z" }));
  await openDraft();
  // A draft awaiting review opens locked: it shows the message and cannot be edited or sent.
  expect(composer()).toBeNull();
  expect(screen.getByText("See you at ten.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review and send" })).toBeNull();

  press("It was not sent");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Recorded as not sent", {
      id: "toast-1",
    }),
  );
  expect(h.reconcile).toHaveBeenCalledExactlyOnceWith("draft-1", { outcome: "not_sent" });
  expect(h.toast.loading).toHaveBeenCalledExactlyOnceWith("Recording…");
  expect(field("Message").value).toBe("See you at ten.");
  expect(h.send).not.toHaveBeenCalled();
  noInlineResult();
});

it("records a reviewed send as sent and closes the message", async () => {
  h.drafts.mockResolvedValue([draft({ sendStatus: "reconcile" })]);
  h.reconcile.mockResolvedValueOnce(draft({ sendStatus: "sent" }));
  await openDraft();
  press("It was sent");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Recorded as sent", { id: "toast-1" }),
  );
  expect(h.reconcile).toHaveBeenCalledExactlyOnceWith("draft-1", { outcome: "sent" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "It was sent" })).toBeNull());
  expect(h.send).not.toHaveBeenCalled();
});

it.each([
  ["refused", () => fault(409), "Couldn’t record that for this draft. Check it again."],
  ["interrupted", offline, "Couldn’t confirm that was recorded. Check this message again."],
])("stays locked when recording the outcome is %s", async (_name, error, text) => {
  h.drafts.mockResolvedValue([draft({ sendStatus: "reconcile" })]);
  h.reconcile.mockRejectedValueOnce(error());
  await openDraft();
  press("It was sent");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(text, { id: "toast-1" }),
  );
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  expect(composer()).toBeNull();
});

it("shows a draft that is being sent as locked", async () => {
  h.drafts.mockResolvedValue([draft({ sendStatus: "sending" })]);
  await openDraft();
  expect(screen.getByText("This message is being sent.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
  expect(screen.queryByRole("button", { name: "It was sent" })).toBeNull();
});

it("reports nothing to the next person when the session changes during a send", async () => {
  let fail: (error: unknown) => void = () => {};
  h.send.mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
  await review();
  press("Send message");
  h.epoch += 1;
  await act(async () => fail(offline()));
  await waitFor(() => expect(h.toast.dismiss).toHaveBeenCalledWith("toast-1"));
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("replies inside the conversation and forwards outside it", async () => {
  h.drafts.mockResolvedValue([]);
  h.create.mockImplementation(async (input) => draft({ ...input, id: "new" }));
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: /^Maya Chen/ }));
  const reader = await screen.findByRole("dialog");
  await within(reader).findByText("Please review before Thursday.");

  fireEvent.click(within(reader).getByRole("button", { name: "Conversation actions" }));
  press("Reply");
  expect(field("To").value).toBe("Maya Chen <maya@example.test>");
  expect(field("Subject").value).toBe("Re: Board packet");
  type("Message", "Looks good.");
  press("Save draft");
  await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
  expect(h.create.mock.calls[0]?.[0]).toMatchObject({
    accountId: "personal",
    threadId: "thread-1",
    to: [{ address: "maya@example.test", name: "Maya Chen" }],
    subject: "Re: Board packet",
    body: "Looks good.",
  });
  // Closing the composer returns to the conversation.
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement);
  expect(composer()).toBeNull();
  expect(within(reader).getByText("Please review before Thursday.")).toBeTruthy();

  fireEvent.click(within(reader).getByRole("button", { name: "Conversation actions" }));
  press("Forward");
  expect(field("To").value).toBe("");
  expect(field("Subject").value).toBe("Fwd: Board packet");
  expect(field("Message").value).toContain("Please review before Thursday.");
  type("To", "sam@example.test");
  press("Save draft");
  await waitFor(() => expect(h.create).toHaveBeenCalledTimes(2));
  expect(h.create.mock.calls[1]?.[0]).toMatchObject({ threadId: null });
  expect(h.send).not.toHaveBeenCalled();
});

it("offers no reply before the conversation has loaded", async () => {
  h.messages.mockReturnValue(new Promise(() => {}));
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: /^Maya Chen/ }));
  const reader = await screen.findByRole("dialog");
  // Only the read-state action is there, so it is a single button rather than a menu.
  expect(within(reader).getByRole("button", { name: "Mark as unread" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Conversation actions" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Forward" })).toBeNull();
});

it("writes nothing while no one is signed in", async () => {
  await openDraft();
  h.owner = undefined;
  type("Message", "Edited here");
  press("Save draft");
  expect(h.toast.loading).not.toHaveBeenCalled();
  expect(h.update).not.toHaveBeenCalled();
});

it.each([
  ["a confirmed send", async () => {}],
  [
    "a send confirmed by the record",
    async () => {
      throw offline();
    },
  ],
])("reports %s to no one once the session has changed", async (_name, outcome) => {
  let settle: () => void = () => {};
  h.send.mockReturnValueOnce(
    new Promise<void>((resolve, reject) => {
      settle = () => outcome().then(resolve, reject);
    }),
  );
  await review();
  h.drafts.mockResolvedValue([draft({ sendStatus: "sent" })]);
  press("Send message");
  h.epoch += 1;
  await act(async () => settle());
  await waitFor(() => expect(h.toast.dismiss).toHaveBeenCalledWith("toast-1"));
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.toast.error).not.toHaveBeenCalled();
});

it("reports a check to no one once the session has changed", async () => {
  h.drafts.mockResolvedValue([draft({ sendStatus: "reconcile" })]);
  await openDraft();
  let read: (drafts: MailDraft[]) => void = () => {};
  h.drafts.mockReturnValueOnce(new Promise((resolve) => (read = resolve)));
  press("Check again");
  h.epoch += 1;
  await act(async () => read([draft({ sendStatus: "sent" })]));
  await waitFor(() => expect(h.toast.dismiss).toHaveBeenCalledWith("toast-1"));
  expect(h.toast.success).not.toHaveBeenCalled();
});

it("looks for an interrupted save before saving over it again", async () => {
  h.update.mockRejectedValueOnce(offline());
  await openDraft();
  // The save landed, but neither it nor the read after it could be confirmed.
  h.drafts.mockRejectedValueOnce(offline());
  type("Message", "Edited here");
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the draft was saved. Try again.",
      { id: "toast-1" },
    ),
  );

  // The next save starts from the revision that landed, so more typing is not a conflict.
  const landed = draft({ body: "Edited here", updatedAt: "2026-11-16T10:05:00.000Z" });
  h.drafts.mockResolvedValue([landed]);
  h.update.mockResolvedValueOnce({ ...landed, body: "Edited here, twice" });
  type("Message", "Edited here, twice");
  press("Save draft");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
  expect(h.update).toHaveBeenLastCalledWith(
    "draft-1",
    expect.objectContaining({
      body: "Edited here, twice",
      expectedUpdatedAt: "2026-11-16T10:05:00.000Z",
    }),
  );
});

it("keeps a recipient whose name holds a comma as one recipient", async () => {
  h.drafts.mockResolvedValue([
    draft({ to: [{ address: "jane@example.test", name: "Doe, Jane" }] }),
  ]);
  h.send.mockResolvedValueOnce(undefined);
  await openDraft();
  expect(field("To").value).toBe('"Doe, Jane" <jane@example.test>');
  press("Review and send");
  press("Send message");
  await waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
  expect(h.toast.error).not.toHaveBeenCalled();
  expect(h.update).not.toHaveBeenCalled();
});

it("offers no reply until the person's own address is known", async () => {
  h.accounts.mockReturnValue(new Promise(() => {}));
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: /^Maya Chen/ }));
  const reader = await screen.findByRole("dialog");
  await within(reader).findByText("Please review before Thursday.");
  fireEvent.click(within(reader).getByRole("button", { name: "Conversation actions" }));
  expect(screen.getByRole("button", { name: "Forward" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
});

it("keeps an unconfirmed send locked when the draft is closed and opened again", async () => {
  h.send.mockRejectedValueOnce(offline());
  await review();
  // The record still reads unsent, which alone proves nothing after a lost connection.
  press("Send message");
  await screen.findByRole("button", { name: "Check again" });

  fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement);
  expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: /Thursday/ }));
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review and send" })).toBeNull();
  expect(composer()).toBeNull();

  // Only the check, which retires the sent revision, opens it again; then it stays open.
  h.update.mockResolvedValueOnce(draft({ updatedAt: "2026-11-16T10:08:00.000Z" }));
  press("Check again");
  await waitFor(() => expect(composer()).toBeTruthy());
  fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement);
  fireEvent.click(await screen.findByRole("button", { name: /Thursday/ }));
  expect(composer()).toBeTruthy();
  expect(h.send).toHaveBeenCalledTimes(1);
});

it("offers Forward but no Reply when the account's own address is unknown", async () => {
  h.accounts.mockResolvedValue({
    accounts: [{ ...account("personal", "me@example.test"), email: null }],
  });
  // The latest message is the person's own; without their address it would look incoming.
  h.messages.mockResolvedValue([
    { ...received, from: { name: null, address: "me@example.test" }, to: [thread.from] },
  ]);
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: /^Maya Chen/ }));
  const reader = await screen.findByRole("dialog");
  await within(reader).findByText("Please review before Thursday.");
  fireEvent.click(within(reader).getByRole("button", { name: "Conversation actions" }));
  expect(screen.getByRole("button", { name: "Forward" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
});

const marks = () => [...h.store.values()].map((value) => JSON.parse(value));

it("marks a draft on the device before its send leaves and lifts it once confirmed", async () => {
  let confirm: () => void = () => {};
  let stored: unknown[] = [];
  h.send.mockImplementationOnce(() => {
    stored = marks();
    return new Promise<void>((resolve) => (confirm = resolve));
  });
  await review();
  press("Send message");
  await waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
  expect(stored).toEqual([["draft-1"]]);

  await act(async () => confirm());
  await waitFor(() => expect(marks()).toEqual([]));
  expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Message sent", { id: "toast-1" });
});

it("opens a draft locked after a restart that interrupted its send", async () => {
  h.send.mockRejectedValueOnce(offline());
  await review();
  press("Send message");
  await screen.findByRole("button", { name: "Check again" });
  expect(marks()).toEqual([["draft-1"]]);

  // The app restarts: nothing is left in memory, and the API still reports an unsent draft.
  cleanup();
  client.clear();
  forgetUnconfirmedSends();
  render(wrap(<MailboxesRoute />));
  fireEvent.click(await screen.findByRole("button", { name: /Thursday/ }));
  expect(screen.getByText("Needs review")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review and send" })).toBeNull();
  expect(composer()).toBeNull();

  // A successful check retires the revision, lifts the mark and opens the draft.
  h.update.mockResolvedValueOnce(draft({ updatedAt: "2026-11-16T10:08:00.000Z" }));
  press("Check again");
  await waitFor(() => expect(composer()).toBeTruthy());
  await waitFor(() => expect(marks()).toEqual([]));
  expect(h.send).toHaveBeenCalledTimes(1);
});

it("sends nothing when the device cannot store the mark first", async () => {
  await review();
  h.storeFails = true;
  press("Send message");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t prepare this iPhone to send safely, so nothing was sent. Try again.",
      { id: "toast-1" },
    ),
  );
  expect(h.send).not.toHaveBeenCalled();
  // The draft is intact and unlocked: nothing left this device.
  expect(field("Message").value).toBe("See you at ten.");

  // Across a restart it is still an ordinary draft, and it sends once storage works.
  cleanup();
  client.clear();
  forgetUnconfirmedSends();
  h.storeFails = false;
  h.send.mockResolvedValueOnce(undefined);
  await review();
  press("Send message");
  await waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
});

it("keeps drafts closed after a restart until the stored marks can be read", async () => {
  h.send.mockRejectedValueOnce(offline());
  await review();
  press("Send message");
  await screen.findByRole("button", { name: "Check again" });

  // The app restarts and the device cannot read its marks: no draft can be opened.
  cleanup();
  client.clear();
  forgetUnconfirmedSends();
  h.storeFails = true;
  render(wrap(<MailboxesRoute />));
  const load = await screen.findByRole("button", { name: "Load drafts" });
  expect(screen.queryByRole("button", { name: /Thursday/ })).toBeNull();
  fireEvent.click(load);
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Couldn’t load mail. Check your connection and try again.",
      { id: "mail-read-retry" },
    ),
  );
  expect(screen.queryByRole("button", { name: /Thursday/ })).toBeNull();

  // Once they can be read, the draft opens locked.
  h.storeFails = false;
  fireEvent.click(screen.getByRole("button", { name: "Load drafts" }));
  fireEvent.click(await screen.findByRole("button", { name: /Thursday/ }));
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review and send" })).toBeNull();
  expect(h.send).toHaveBeenCalledTimes(1);
});

it("keeps drafts closed when stored marks are not what this app wrote", async () => {
  for (const stored of ["not json", JSON.stringify({ id: 1 }), JSON.stringify([7, "draft-1"])]) {
    h.store.set("personal-os.mail.unconfirmed-sends.v1.owner", stored);
    render(wrap(<MailboxesRoute />));
    expect(await screen.findByRole("button", { name: "Load drafts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Thursday/ })).toBeNull();
    cleanup();
    client.clear();
    forgetUnconfirmedSends();
  }
});

it("confirms an interrupted save from the draft's record without writing again", async () => {
  h.update.mockRejectedValueOnce(offline());
  await openDraft();
  h.drafts.mockRejectedValueOnce(offline());
  type("Message", "Edited here");
  press("Save draft");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));

  h.drafts.mockResolvedValue([
    draft({ body: "Edited here", updatedAt: "2026-11-16T10:05:00.000Z" }),
  ]);
  press("Save draft");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Draft saved", { id: "toast-1" }),
  );
  expect(h.update).toHaveBeenCalledTimes(1);
});

const writeNew = async () => {
  h.create.mockResolvedValueOnce(draft({ id: "new", subject: "Hello" }));
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: "New message" }));
  type("To", "maya@example.test");
  type("Subject", "Hello");
  press("Review and send");
  await screen.findByRole("button", { name: "Send message" });
};

it("keeps an earlier draft's mark when a new message is sent after a restart", async () => {
  // A restart left one unsettled send stored; the inbox composer never opens Drafts.
  h.store.set("personal-os.mail.unconfirmed-sends.v1.owner", JSON.stringify(["draft-1"]));
  let confirm: () => void = () => {};
  let stored: unknown[] = [];
  h.send.mockImplementationOnce(() => {
    stored = marks();
    return new Promise<void>((resolve) => (confirm = resolve));
  });
  await writeNew();
  press("Send message");
  await waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
  expect(stored).toEqual([["draft-1", "new"]]);

  await act(async () => confirm());
  await waitFor(() => expect(marks()).toEqual([["draft-1"]]));
  // The earlier draft still opens locked.
  cleanup();
  render(wrap(<MailboxesRoute />));
  fireEvent.click(await screen.findByRole("button", { name: /Thursday/ }));
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
});

it("sends nothing when stored marks cannot be read, even if they could be written", async () => {
  h.store.set("personal-os.mail.unconfirmed-sends.v1.owner", JSON.stringify(["draft-1"]));
  h.storeReadFails = true;
  await writeNew();
  press("Send message");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t prepare this iPhone to send safely, so nothing was sent. Try again.",
      { id: "toast-1" },
    ),
  );
  expect(h.send).not.toHaveBeenCalled();
  expect(marks()).toEqual([["draft-1"]]);
  // Nothing left the device, so the new draft is not locked.
  expect(field("Subject").value).toBe("Hello");
});

/** Leaves the saved draft locked: its send was interrupted and its record still reads unsent. */
const interrupt = async () => {
  h.send.mockRejectedValueOnce(offline());
  await review();
  press("Send message");
  await screen.findByRole("button", { name: "Check again" });
};

it("lets a locked draft be discarded when its revision cannot be retired", async () => {
  await interrupt();
  // The account was disconnected, so the save that would make another send safe is refused.
  h.update.mockRejectedValue(fault(400));
  press("Check again");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Couldn’t confirm this message is safe to send again. Check again.",
      { id: "toast-1" },
    ),
  );
  expect(screen.queryByRole("button", { name: "Review and send" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();

  h.confirm.mockImplementationOnce(() => {});
  press("Discard draft");
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Discard this message?",
    "It may already have been sent. Discarding deletes the draft from nohmi and can’t be undone. It does not unsend anything.",
    expect.any(Function),
    true,
  );
  expect(h.remove).not.toHaveBeenCalled();

  h.remove.mockResolvedValueOnce(undefined);
  press("Discard draft");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenCalledExactlyOnceWith("Draft discarded", { id: "toast-1" }),
  );
  expect(h.remove).toHaveBeenCalledExactlyOnceWith("draft-1");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Check again" })).toBeNull());
  await waitFor(() => expect(marks()).toEqual([]));
  expect(h.send).toHaveBeenCalledTimes(1);
  noInlineResult();
});

it("keeps a locked draft locked and marked when the discard is not confirmed", async () => {
  await interrupt();
  h.remove.mockRejectedValueOnce(offline());
  press("Discard draft");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Couldn’t confirm the draft was discarded. Check Drafts before trying again.",
      { id: "toast-1" },
    ),
  );
  expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  expect(marks()).toEqual([["draft-1"]]);
});

it("offers no discard while the API is reviewing the message", async () => {
  h.send.mockRejectedValueOnce(offline());
  await review();
  h.drafts.mockResolvedValue([draft({ sendStatus: "reconcile" })]);
  press("Send message");
  await screen.findByRole("button", { name: "It was sent" });
  expect(screen.queryByRole("button", { name: "Discard draft" })).toBeNull();
});

it("lifts the lock and closes a draft that no longer exists", async () => {
  await interrupt();
  expect(marks()).toEqual([["draft-1"]]);
  h.drafts.mockResolvedValue([]);
  press("Check again");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "This draft is no longer available. Check Sent mail to see whether it was sent.",
      { id: "toast-1" },
    ),
  );
  await waitFor(() => expect(screen.queryByRole("button", { name: "Check again" })).toBeNull());
  await waitFor(() => expect(marks()).toEqual([]));
  expect(h.send).toHaveBeenCalledTimes(1);
});

/** Drives the writes directly, for orders of events the composer never allows. */
function Writes() {
  const writes = useDraftWrites();
  return (
    <>
      <button type="button" onClick={() => void writes.send(draft())}>
        send one
      </button>
      <button type="button" onClick={() => void writes.send(draft({ id: "draft-2" }))}>
        send two
      </button>
    </>
  );
}

it("never sends a draft whose earlier send is still unconfirmed", async () => {
  h.send.mockRejectedValueOnce(offline());
  render(wrap(<Writes />));
  press("send one");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  expect(marks()).toEqual([["draft-1"]]);

  // Even with the device unable to store anything, the earlier lock stays.
  h.storeFails = true;
  press("send one");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Check whether this message was sent before sending it again.",
      { id: "toast-1" },
    ),
  );
  expect(h.send).toHaveBeenCalledTimes(1);
  h.storeFails = false;
  press("send one");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(marks()).toEqual([["draft-1"]]);
});

it("stores a new mark after an earlier unmark has finished writing", async () => {
  let release: () => void = () => {};
  h.send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(offline());
  render(wrap(<Writes />));
  // The first send is confirmed; removing its mark from the device is slow.
  h.storeDeleteGate = new Promise((resolve) => (release = resolve));
  press("send one");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));

  h.drafts.mockRejectedValue(offline());
  press("send two");
  await act(async () => {});
  // The second mark waits its turn, so the slow write cannot land on top of it.
  expect(h.send).toHaveBeenCalledTimes(1);
  await act(async () => release());
  await waitFor(() => expect(h.send).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  expect(marks()).toEqual([["draft-2"]]);
});

it("reads the conversation again after a reply is sent", async () => {
  h.drafts.mockResolvedValue([]);
  h.create.mockImplementation(async (input) => draft({ ...input, id: "new" }));
  h.send.mockResolvedValueOnce(undefined);
  render(wrap(<InboxRoute />));
  fireEvent.click(await screen.findByRole("button", { name: /^Maya Chen/ }));
  const reader = await screen.findByRole("dialog");
  await within(reader).findByText("Please review before Thursday.");
  fireEvent.click(within(reader).getByRole("button", { name: "Conversation actions" }));
  press("Reply");
  type("Message", "Looks good.");
  press("Review and send");
  fireEvent.click(await screen.findByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith("Message sent", { id: "toast-1" }),
  );
  await waitFor(() => expect(h.messages).toHaveBeenCalledTimes(2));
});

it("shows the sender of the saved draft on the review", async () => {
  h.accounts.mockResolvedValue({
    accounts: [account("personal", "me@example.test"), account("work", "me@work.test")],
  });
  h.drafts.mockResolvedValue([draft({ accountId: "work" })]);
  await review();
  expect(screen.getByText("me@work.test")).toBeTruthy();
  expect(screen.queryByText("me@example.test")).toBeNull();
});
