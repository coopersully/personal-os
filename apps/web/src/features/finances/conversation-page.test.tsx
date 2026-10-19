// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createAppQueryClient } from "../../lib/query-client.js";
import { FinanceActivityEntry } from "./activity-entry.js";
import { FinanceAutomationsPage } from "./automations-page.js";
import { FinanceConversationPage } from "./conversation-page.js";

const api = vi.hoisted(() => ({
  getFinanceConversationReadiness: vi.fn(),
  getFinanceConversationHistory: vi.fn(),
  getFinanceConversationMessageContext: vi.fn(),
  sendFinanceConversationMessage: vi.fn(),
  markFinanceConversationRendered: vi.fn(),
  getFinanceContextualQuestion: vi.fn(),
  answerFinanceContextualQuestion: vi.fn(),
  listAutomationHostSchedules: vi.fn(),
  listAutomationHostConnections: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  loading: vi.fn(() => "toast-id"),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
vi.mock("sonner", () => ({ toast }));
const message = {
  id: "m",
  sequence: "9007199254740993",
  authorKind: "agent",
  text: "A retained question",
  caseId: null,
  recordRefs: [],
  runId: null,
  sourceMessageIds: [],
  createdAt: "2026-10-18T12:00:00Z",
};
let intersect: IntersectionObserverCallback;
beforeEach(() => {
  vi.resetAllMocks();
  toast.loading.mockReturnValue("toast-id");
  api.getFinanceConversationReadiness.mockResolvedValue({ canSend: true, reason: "ready" });
  api.listAutomationHostSchedules.mockResolvedValue([]);
  api.listAutomationHostConnections.mockResolvedValue([]);
  api.getFinanceConversationHistory.mockResolvedValue({ messages: [message], nextCursor: null });
  api.markFinanceConversationRendered.mockResolvedValue({});
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
function show(
  route = "/finances/chat",
  ownerId = "owner",
  client = createAppQueryClient({ queries: { retry: false } }),
) {
  client.setQueryData(["me"], { id: ownerId });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <FinanceConversationPage ownerId={ownerId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("retains history while locked and marks only actually visible rendered sequence without precision loss", async () => {
  api.getFinanceConversationReadiness.mockResolvedValue({
    canSend: false,
    reason: "challenge_required",
  });
  const client = createAppQueryClient({ queries: { retry: false } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  show("/finances/chat", "owner", client);
  const row = await screen.findByText(message.text);
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  expect(api.markFinanceConversationRendered).not.toHaveBeenCalled();
  act(() =>
    intersect(
      [{ isIntersecting: true, target: row.closest("li") } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  await waitFor(() =>
    expect(api.markFinanceConversationRendered).toHaveBeenCalledWith(message.sequence),
  );
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["finance-conversation-unread", "owner"] }),
  );
  expect(screen.getByRole("link", { name: "Verify message access" })).toHaveAttribute(
    "href",
    "/finances/automations?returnTo=%2Ffinances%2Fchat",
  );
});
it("preserves failed draft and exact retry identity with one toast outcome and no inline result", async () => {
  api.sendFinanceConversationMessage
    .mockRejectedValueOnce(new Error("private secret"))
    .mockResolvedValue({
      ...message,
      id: "sent",
      sequence: "9007199254740994",
      authorKind: "user",
      text: "My note",
    });
  show();
  const user = userEvent.setup();
  await screen.findByText(message.text);
  await user.type(screen.getByLabelText("Message"), "My note");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), { id: "toast-id" }),
  );
  expect(screen.getByLabelText("Message")).toHaveValue("My note");
  expect(screen.queryByText(/Couldn’t save/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(api.sendFinanceConversationMessage.mock.calls[0]).toEqual(
    api.sendFinanceConversationMessage.mock.calls[1],
  );
  expect(screen.getByLabelText("Message")).toHaveValue("");
});
it("uses canonical answer only, retaining the original work and stable retry operation", async () => {
  const work = {
    domain: "finances",
    kind: "question",
    id: "q",
    revision: "9007199254740993",
    actionRevision: "1",
  };
  api.getFinanceContextualQuestion.mockResolvedValue({
    state: "available",
    question: { id: "q", prompt: "What was it for?", transactionId: "t", status: "open", work },
  });
  api.answerFinanceContextualQuestion
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ state: "accepted" });
  show("/finances/chat?question=q");
  const user = userEvent.setup();
  await screen.findByText("What was it for?");
  await user.type(screen.getByLabelText("Answer"), "Lunch");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(api.answerFinanceContextualQuestion.mock.calls[0]).toEqual(
    api.answerFinanceContextualQuestion.mock.calls[1],
  );
  expect(api.answerFinanceContextualQuestion).toHaveBeenCalledWith(
    expect.objectContaining({ work, text: "Lunch", source: { kind: "app", messageId: null } }),
  );
  expect(api.sendFinanceConversationMessage).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Answer")).toHaveValue("");
});
it("keeps contextual drafts after blocked acceptance even when chat is locked", async () => {
  api.getFinanceConversationReadiness.mockResolvedValue({
    canSend: false,
    reason: "registration_paused",
  });
  api.getFinanceContextualQuestion.mockResolvedValue({
    state: "available",
    question: {
      prompt: "Purpose?",
      status: "open",
      transactionId: "t",
      work: { id: "q", revision: "1" },
    },
  });
  api.answerFinanceContextualQuestion.mockResolvedValue({ state: "blocked" });
  show("/finances/chat?question=q");
  const user = userEvent.setup();
  await screen.findByText("Purpose?");
  await user.type(screen.getByLabelText("Answer"), "Keep this");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByLabelText("Answer")).toHaveValue("Keep this");
  expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled();
  expect(api.sendFinanceConversationMessage).not.toHaveBeenCalled();
});
it("retains visible history and draft when refresh fails", async () => {
  show();
  const user = userEvent.setup();
  await screen.findByText(message.text);
  await user.type(screen.getByLabelText("Message"), "Unsaved context");
  api.getFinanceConversationHistory.mockRejectedValue(new Error("private failure"));
  await user.click(screen.getByRole("button", { name: "Refresh conversation" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), { id: "toast-id" }),
  );
  expect(screen.getByText(message.text)).toBeInTheDocument();
  expect(screen.getByLabelText("Message")).toHaveValue("Unsaved context");
  expect(screen.queryByText(/Couldn’t load/)).not.toBeInTheDocument();
});
it("allocates a new identity for a new successful message with identical text", async () => {
  api.sendFinanceConversationMessage.mockResolvedValue({
    ...message,
    authorKind: "user",
    text: "Again",
  });
  show();
  const user = userEvent.setup();
  await screen.findByText(message.text);
  for (let i = 0; i < 2; i++) {
    await user.type(screen.getByLabelText("Message"), "Again");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
  }
  expect(api.sendFinanceConversationMessage.mock.calls[0]?.[0].idempotencyKey).not.toEqual(
    api.sendFinanceConversationMessage.mock.calls[1]?.[0].idempotencyKey,
  );
});
it("does not advance rendered cursor across unfetched history when an outgoing message appears", async () => {
  api.getFinanceConversationHistory.mockResolvedValue({
    messages: [message],
    nextCursor: message.sequence,
  });
  api.sendFinanceConversationMessage.mockResolvedValue({
    ...message,
    id: "outgoing",
    sequence: "9007199254741999",
    authorKind: "user",
    text: "New note",
  });
  show();
  const user = userEvent.setup();
  await screen.findByText(message.text);
  await user.type(screen.getByLabelText("Message"), "New note");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  const outgoing = await screen.findByText("New note");
  act(() =>
    intersect(
      [
        {
          isIntersecting: true,
          target: outgoing.closest("li"),
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    ),
  );
  expect(api.markFinanceConversationRendered).not.toHaveBeenCalled();
});
it("refreshes forward after exhausting multiple pages and retains all earlier messages", async () => {
  const firstPage = Array.from({ length: 50 }, (_, index) => ({
    ...message,
    id: `first-${index}`,
    sequence: (BigInt(message.sequence) + BigInt(index)).toString(),
    text: index === 0 ? message.text : `Earlier message ${index}`,
  }));
  const second = { ...message, id: "second", sequence: "9007199254741043", text: "Second page" };
  const late = { ...message, id: "late", sequence: "9007199254741044", text: "Late agent reply" };
  api.getFinanceConversationHistory
    .mockReset()
    .mockResolvedValueOnce({ messages: firstPage, nextCursor: firstPage[49]?.sequence })
    .mockResolvedValueOnce({ messages: [second], nextCursor: null })
    .mockResolvedValueOnce({ messages: [late], nextCursor: null });
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Load more messages" }));
  await screen.findByText(second.text);
  expect(screen.queryByRole("button", { name: "Load more messages" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Refresh conversation" }));
  await screen.findByText(late.text);
  expect(api.getFinanceConversationHistory).toHaveBeenLastCalledWith({
    after: second.sequence,
    limit: 50,
  });
  expect(screen.getByText(message.text)).toBeInTheDocument();
  expect(screen.getByText(second.text)).toBeInTheDocument();
});
it("reports initial history rejection through Sonner and provides a working retry", async () => {
  api.getFinanceConversationHistory.mockRejectedValueOnce(new Error("private provider detail"));
  show();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t load conversation. Try Refresh conversation.",
    ),
  );
  expect(screen.queryByText(/private provider|Couldn’t load/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Refresh conversation" }));
  await screen.findByText(message.text);
  expect(toast.success).toHaveBeenCalledWith("Conversation loaded", { id: "toast-id" });
});
it.each([
  401, 403,
])("hides paged and sent history on authoritative %s refresh denial using the app query client", async (status) => {
  const second = {
    ...message,
    id: "second",
    sequence: "9007199254740994",
    text: "Private second page",
  };
  api.getFinanceConversationHistory
    .mockResolvedValueOnce({ messages: [message], nextCursor: message.sequence })
    .mockResolvedValueOnce({ messages: [second], nextCursor: null });
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Load more messages" }));
  await screen.findByText(second.text);
  api.sendFinanceConversationMessage.mockResolvedValue({
    ...message,
    id: "sent",
    sequence: "9007199254741999",
    authorKind: "user",
    text: "Private outgoing",
  });
  await user.type(screen.getByLabelText("Message"), "Private outgoing");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Private outgoing");
  api.getFinanceConversationHistory.mockRejectedValue(
    new ApiClientError({ status, code: "forbidden", message: "denied" }),
  );
  await user.click(screen.getByRole("button", { name: "Refresh conversation" }));
  await waitFor(() => expect(screen.queryByText(second.text)).not.toBeInTheDocument());
  expect(screen.queryByText(message.text)).not.toBeInTheDocument();
  expect(screen.queryByText("Private outgoing")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more messages" })).not.toBeInTheDocument();
});
it.each([401, 403])("clears all history on direct pagination %s denial", async (status) => {
  api.getFinanceConversationHistory
    .mockResolvedValueOnce({ messages: [message], nextCursor: message.sequence })
    .mockRejectedValue(new ApiClientError({ status, code: "forbidden", message: "denied" }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Load more messages" }));
  await waitFor(() => expect(screen.queryByText(message.text)).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Load more messages" })).not.toBeInTheDocument();
});
it("retains paged history on transient pagination failure and sending-policy lock", async () => {
  const second = {
    ...message,
    id: "second",
    sequence: "9007199254740994",
    text: "Retain second page",
  };
  api.getFinanceConversationReadiness.mockResolvedValue({
    canSend: false,
    reason: "registration_paused",
  });
  api.getFinanceConversationHistory
    .mockResolvedValueOnce({ messages: [message], nextCursor: message.sequence })
    .mockResolvedValueOnce({ messages: [second], nextCursor: second.sequence })
    .mockRejectedValue(new Error("offline"));
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Load more messages" }));
  await screen.findByText(second.text);
  await user.click(screen.getByRole("button", { name: "Load more messages" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByText(message.text)).toBeInTheDocument();
  expect(screen.getByText(second.text)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
});
it("reports background query failure and clears the real app cache on forbidden history", async () => {
  const client = createAppQueryClient({ queries: { retry: false } });
  show("/finances/chat", "owner", client);
  await screen.findByText(message.text);
  api.getFinanceConversationHistory.mockRejectedValue(
    new ApiClientError({ status: 403, code: "forbidden", message: "denied" }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: ["finance-conversation-history", "owner"] });
  });
  await waitFor(() => expect(screen.queryByText(message.text)).not.toBeInTheDocument());
  expect(client.getQueryData(["finance-conversation-history", "owner"])).toBeUndefined();
  expect(toast.error).toHaveBeenCalledWith("Couldn’t load conversation. Try Refresh conversation.");
});

it("follows the actual Activity source link to a bounded message beyond the first 50 and focuses that row", async () => {
  const target = {
    ...message,
    id: "11111111-1111-4111-8111-111111111111",
    sequence: "9007199254741099",
    text: "Exact later source",
  };
  api.getFinanceConversationReadiness.mockResolvedValue({
    canSend: false,
    reason: "registration_paused",
  });
  api.getFinanceConversationHistory.mockResolvedValue({
    messages: Array.from({ length: 50 }, (_, i) => ({
      ...message,
      id: `old-${i}`,
      sequence: (BigInt(message.sequence) + BigInt(i)).toString(),
      text: `Earlier ${i}`,
    })),
    nextCursor: "9007199254741042",
  });
  api.getFinanceConversationMessageContext.mockResolvedValue({
    targetMessageId: target.id,
    messages: [target],
  });
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  const contextClient = createAppQueryClient({ queries: { retry: false } });
  contextClient.setQueryData(["me"], { id: "owner" });
  render(
    <QueryClientProvider client={contextClient}>
      <MemoryRouter initialEntries={["/finances/activity"]}>
        <Routes>
          <Route
            path="/finances/activity"
            element={
              <FinanceActivityEntry
                entry={{
                  id: "entry",
                  occurredAt: message.createdAt,
                  kind: "human_answer_decision",
                  status: "accepted",
                  actor: { type: "user", id: "owner" },
                  action: "Answer accepted",
                  explanation: "Source evidence",
                  caseId: null,
                  runId: null,
                  actionId: null,
                  sourceOperationId: "operation",
                  auditEventIds: [],
                  recordRefs: [],
                  changes: [],
                  targets: [],
                  sourceMessages: [{ ...target, contentHash: "a".repeat(64), excerpt: null }],
                }}
              />
            }
          />
          <Route path="/finances/chat" element={<FinanceConversationPage ownerId="owner" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Inspect evidence" }));
  await user.click(screen.getByRole("link", { name: "Open source message" }));
  const row = await screen.findByRole("listitem", { name: "Source message" });
  expect(row).toHaveTextContent(target.text);
  await waitFor(() => expect(row).toHaveFocus());
  expect(scroll).toHaveBeenCalledWith({ block: "center" });
  expect(api.getFinanceConversationMessageContext).toHaveBeenCalledWith(target.id);
  expect(api.getFinanceConversationHistory).toHaveBeenCalledTimes(1);
  expect(api.markFinanceConversationRendered).not.toHaveBeenCalled();
  act(() =>
    intersect(
      [{ isIntersecting: true, target: row } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(api.markFinanceConversationRendered).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
});
it.each([
  404, 403,
])("reports missing/foreign or denied source %s without fabricating target success", async (status) => {
  api.getFinanceConversationMessageContext.mockRejectedValue(
    new ApiClientError({
      status,
      code: status === 404 ? "not_found" : "forbidden",
      message: "private detail",
    }),
  );
  api.getFinanceContextualQuestion.mockResolvedValue({ state: "unavailable" });
  show("/finances/chat?message=11111111-1111-4111-8111-111111111111&question=q");
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: "Retry source message" })).toBeInTheDocument();
  expect(screen.queryByRole("listitem", { name: "Source message" })).not.toBeInTheDocument();
  expect(toast.success).not.toHaveBeenCalledWith("Source message loaded", expect.anything());
  expect(api.markFinanceConversationRendered).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Answer")).toBeInTheDocument();
});

it("retains an answer draft through unavailable question reload and recovers current work", async () => {
  api.getFinanceContextualQuestion.mockResolvedValue({ state: "unavailable" });
  show("/finances/chat?question=q");
  const user = userEvent.setup();
  await screen.findByText("This question is unavailable. Your draft is retained.");
  await user.type(screen.getByLabelText("Answer"), "Retained explanation");
  expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled();
  api.getFinanceContextualQuestion.mockRejectedValueOnce(new Error("private"));
  await user.click(screen.getByRole("button", { name: "Reload question" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Couldn’t reload question. Your draft is retained.", {
      id: "toast-id",
    }),
  );
  expect(screen.getByLabelText("Answer")).toHaveValue("Retained explanation");
  api.getFinanceContextualQuestion.mockResolvedValue({
    state: "available",
    question: {
      id: "q",
      prompt: "Current question",
      status: "open",
      transactionId: "t",
      work: { id: "q", revision: "2" },
    },
  });
  await user.click(screen.getByRole("button", { name: "Reload question" }));
  await screen.findByText("Current question");
  expect(screen.getByRole("button", { name: "Save answer" })).toBeEnabled();
  expect(screen.getByLabelText("Answer")).toHaveValue("Retained explanation");
  expect(api.answerFinanceContextualQuestion).not.toHaveBeenCalled();
});
it("rejects malformed source context and retries without losing the question query", async () => {
  api.getFinanceConversationMessageContext
    .mockResolvedValueOnce({ targetMessageId: "wrong", messages: [message] })
    .mockResolvedValue({ targetMessageId: "m", messages: [message] });
  api.getFinanceContextualQuestion.mockResolvedValue({ state: "unavailable" });
  show("/finances/chat?message=m&question=q");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Retry source message" }));
  await screen.findByRole("listitem", { name: "Source message" });
  expect(screen.getByLabelText("Answer")).toBeInTheDocument();
  expect(toast.success).toHaveBeenCalledWith("Source message loaded", { id: "toast-id" });
});
it("rejects a source context that omits the requested message", async () => {
  api.getFinanceConversationMessageContext.mockResolvedValue({
    targetMessageId: "missing",
    messages: [message],
  });
  show("/finances/chat?message=missing");
  await screen.findByRole("button", { name: "Retry source message" });
  expect(toast.success).not.toHaveBeenCalledWith("Source message loaded", expect.anything());
});
it("keeps the conversation locked when readiness fails while readable history remains", async () => {
  api.getFinanceConversationReadiness.mockRejectedValue(new Error("offline"));
  show();
  await screen.findByText(message.text);
  await screen.findByText(/Automation access could not be checked/);
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
});
it("retries a failed rendered acknowledgement and ignores duplicate visible callbacks", async () => {
  api.markFinanceConversationRendered
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({});
  show();
  const row = (await screen.findByText(message.text)).closest("li");
  const notify = () =>
    act(() =>
      intersect(
        [{ isIntersecting: true, target: row } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
  notify();
  await waitFor(() => expect(api.markFinanceConversationRendered).toHaveBeenCalledTimes(1));
  await act(async () => {});
  notify();
  await waitFor(() => expect(api.markFinanceConversationRendered).toHaveBeenCalledTimes(2));
  notify();
  expect(api.markFinanceConversationRendered).toHaveBeenCalledTimes(2);
});
it("locks the pending composer until the submitted snapshot is accepted", async () => {
  let resolve!: (value: unknown) => void;
  api.sendFinanceConversationMessage.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  show();
  const user = userEvent.setup();
  await screen.findByText(message.text);
  await user.type(screen.getByLabelText("Message"), "First draft");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  // Pending acceptance disables editing and repeated submissions.
  expect(screen.getByLabelText("Message")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await act(async () =>
    resolve({
      ...message,
      id: "sent",
      sequence: "9007199254740994",
      authorKind: "user",
      text: "First draft",
    }),
  );
  expect(screen.getByLabelText("Message")).toHaveValue("");
  expect(api.sendFinanceConversationMessage).toHaveBeenCalledOnce();
});
it("discards a late history page after authoritative denial", async () => {
  let resolve!: (value: unknown) => void;
  api.getFinanceConversationHistory
    .mockResolvedValueOnce({ messages: [message], nextCursor: message.sequence })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  api.markFinanceConversationRendered.mockRejectedValue(
    new ApiClientError({ status: 403, code: "forbidden", message: "denied" }),
  );
  show();
  const user = userEvent.setup();
  const row = (await screen.findByText(message.text)).closest("li");
  await user.click(screen.getByRole("button", { name: "Load more messages" }));
  act(() =>
    intersect(
      [{ isIntersecting: true, target: row } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  await screen.findByText(/Conversation access was denied/);
  await act(async () =>
    resolve({
      messages: [
        { ...message, id: "late", sequence: "9007199254740994", text: "Late confidential page" },
      ],
      nextCursor: null,
    }),
  );
  expect(screen.queryByText("Late confidential page")).not.toBeInTheDocument();
  expect(toast.error).toHaveBeenCalledWith(
    "Access changed. Reload the conversation before continuing.",
    { id: "toast-id" },
  );
});
it("discards a late accepted send after conversation access is denied", async () => {
  let resolve!: (value: unknown) => void;
  api.sendFinanceConversationMessage.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  api.markFinanceConversationRendered.mockRejectedValue(
    new ApiClientError({ status: 401, code: "unauthorized", message: "denied" }),
  );
  show();
  const user = userEvent.setup();
  const row = (await screen.findByText(message.text)).closest("li");
  await user.type(screen.getByLabelText("Message"), "Pending note");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  act(() =>
    intersect(
      [{ isIntersecting: true, target: row } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  await screen.findByText(/Conversation access was denied/);
  await act(async () =>
    resolve({
      ...message,
      id: "late",
      text: "Accepted confidential note",
      sequence: "9007199254740994",
    }),
  );
  expect(screen.queryByText("Accepted confidential note")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Message")).toHaveValue("Pending note");
});
it("reports an unsuccessful manual initial-history retry once", async () => {
  api.getFinanceConversationHistory.mockRejectedValue(new Error("offline"));
  show();
  const user = userEvent.setup();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t load conversation. Try Refresh conversation.",
    ),
  );
  toast.error.mockClear();
  await user.click(screen.getByRole("button", { name: "Refresh conversation" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Couldn’t load conversation. Try again.", {
      id: "toast-id",
    }),
  );
  expect(toast.error).toHaveBeenCalledOnce();
});
it("orders out-of-order history with equal sequences without dropping distinct messages", async () => {
  api.getFinanceConversationHistory.mockResolvedValue({
    messages: [
      { ...message, id: "later", sequence: "9007199254740995", text: "Later" },
      { ...message, id: "equal-a", text: "Equal A" },
      { ...message, id: "equal-b", text: "Equal B" },
      { ...message, id: "earlier", sequence: "9007199254740992", text: "Earlier" },
    ],
    nextCursor: null,
  });
  show();
  await screen.findByText("Earlier");
  expect(screen.getAllByRole("article").map((row) => row.textContent)).toEqual([
    expect.stringContaining("Earlier"),
    expect.stringContaining("Equal A"),
    expect.stringContaining("Equal B"),
    expect.stringContaining("Later"),
  ]);
});
it("rejects a source context that finishes after history denial", async () => {
  let resolve!: (value: unknown) => void;
  api.getFinanceConversationMessageContext.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  api.markFinanceConversationRendered.mockRejectedValue(
    new ApiClientError({ status: 403, code: "forbidden", message: "denied" }),
  );
  show("/finances/chat?message=target");
  const row = (await screen.findByText(message.text)).closest("li");
  act(() =>
    intersect(
      [{ isIntersecting: true, target: row } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  await screen.findByText(/Conversation access was denied/);
  await act(async () =>
    resolve({
      targetMessageId: "target",
      messages: [{ ...message, id: "target", text: "Late target" }],
    }),
  );
  expect(screen.queryByText("Late target")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry source message" })).toBeInTheDocument();
});
it("rejects initial history that finishes after source access denial", async () => {
  let resolve!: (value: unknown) => void;
  api.getFinanceConversationHistory.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  api.getFinanceConversationMessageContext.mockRejectedValue(
    new ApiClientError({ status: 403, code: "forbidden", message: "denied" }),
  );
  show("/finances/chat?message=target");
  await screen.findByText(/Conversation access was denied/);
  await act(async () => resolve({ messages: [message], nextCursor: null }));
  expect(screen.queryByText(message.text)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
});
it("keeps an answered contextual question read-only after a successful reload", async () => {
  api.getFinanceContextualQuestion.mockResolvedValue({
    state: "available",
    question: {
      id: "q",
      prompt: "Already answered",
      status: "answered",
      transactionId: "t",
      work: {},
    },
  });
  show("/finances/chat?question=q");
  const user = userEvent.setup();
  await screen.findByText("Already answered");
  await user.type(screen.getByLabelText("Answer"), "Unsaved note");
  await user.click(screen.getByRole("button", { name: "Reload question" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Question reloaded", { id: "toast-id" }),
  );
  expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled();
  expect(api.answerFinanceContextualQuestion).not.toHaveBeenCalled();
});
it("shows the empty conversation honestly and rechecks it without fabricating messages", async () => {
  api.getFinanceConversationHistory.mockResolvedValue({ messages: [], nextCursor: null });
  show();
  const user = userEvent.setup();
  expect(await screen.findByText("No messages yet.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Refresh conversation" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Conversation loaded", { id: "toast-id" }),
  );
  expect(screen.getByText("No messages yet.")).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(api.markFinanceConversationRendered).not.toHaveBeenCalled();
});
it("retains the highest fetched cursor when refresh repeats older messages", async () => {
  const newer = { ...message, id: "newer", sequence: "9007199254740994", text: "Newer history" };
  api.getFinanceConversationHistory
    .mockResolvedValueOnce({ messages: [message], nextCursor: message.sequence })
    .mockResolvedValueOnce({ messages: [newer, message], nextCursor: null })
    .mockResolvedValueOnce({ messages: [message], nextCursor: null })
    .mockResolvedValue({ messages: [], nextCursor: null });
  show();
  const user = userEvent.setup();
  await screen.findByText(message.text);
  await user.click(screen.getByRole("button", { name: "Load more messages" }));
  await screen.findByText(newer.text);
  await user.click(screen.getByRole("button", { name: "Refresh conversation" }));
  await waitFor(() => expect(api.getFinanceConversationHistory).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh conversation" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Refresh conversation" }));
  await waitFor(() => expect(api.getFinanceConversationHistory).toHaveBeenCalledTimes(4));
  expect(api.getFinanceConversationHistory.mock.calls.slice(2)).toEqual([
    [{ after: newer.sequence, limit: 50 }],
    [{ after: newer.sequence, limit: 50 }],
  ]);
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.getByText(newer.text)).toBeInTheDocument();
});

it.each([
  ["registration_missing", "Set up automation", "/finances/automations"],
  ["registration_paused", "Review host setup", "/finances/automations"],
  ["registration_revoked", "Register automation", "/finances/automations"],
  ["connection_missing", "Connect host", "/settings?section=agent-connections"],
  ["connection_disconnected", "Reconnect host", "/settings?section=agent-connections"],
  ["connection_revoked", "Reconnect host", "/settings?section=agent-connections"],
  ["execution_not_authorized", "Review host permissions", "/settings?section=workspace-access"],
  ["challenge_expired", "Verify message access again", "/finances/automations"],
  ["challenge_required", "Verify message access", "/finances/automations"],
  ["message_protocol_unavailable", "Review message verification", "/finances/automations"],
  ["protocol_upgrade_required", "Review message verification", "/finances/automations"],
])("keeps a draft locked with a precise recovery destination for %s", async (reason, action, href) => {
  api.getFinanceConversationReadiness.mockResolvedValue({ canSend: false, reason });
  const user = userEvent.setup();
  show("/finances/chat?message=source-message");
  const link = await screen.findByRole("link", { name: action });
  const target = new URL(link.getAttribute("href") ?? "", "https://example.com");
  expect(
    `${target.pathname}${target.searchParams.has("section") ? `?section=${target.searchParams.get("section")}` : ""}`,
  ).toBe(href);
  expect(target.searchParams.get("returnTo")).toBe("/finances/chat?message=source-message");
  await user.type(screen.getByLabelText("Message"), "Keep my own draft");
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  expect(screen.getByLabelText("Message")).toHaveValue("Keep my own draft");
  expect(api.sendFinanceConversationMessage).not.toHaveBeenCalled();
});

it("retains a failed message and exact retry command across recovery remount, then clears only after success", async () => {
  api.sendFinanceConversationMessage
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue({
      ...message,
      id: "saved",
      authorKind: "user",
      text: "My retained message",
    });
  const client = createAppQueryClient({ queries: { retry: false } });
  const user = userEvent.setup();
  let page = show("/finances/chat", "owner", client);
  await user.type(screen.getByLabelText("Message"), "My retained message");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  const first = api.sendFinanceConversationMessage.mock.calls[0]?.[0];
  page.unmount();
  page = show("/finances/chat", "owner", client);
  expect(screen.getByLabelText("Message")).toHaveValue("My retained message");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Message saved for the next run",
      expect.any(Object),
    ),
  );
  expect(api.sendFinanceConversationMessage.mock.calls[1]?.[0]).toEqual(first);
  page.unmount();
  show("/finances/chat", "owner", client);
  expect(screen.getByLabelText("Message")).toHaveValue("");
});

it("retains separate contextual and general drafts across remount without changing the question link", async () => {
  api.getFinanceContextualQuestion.mockResolvedValue({ state: "unavailable" });
  const client = createAppQueryClient({ queries: { retry: false } });
  const user = userEvent.setup();
  let page = show("/finances/chat?question=question-a", "owner", client);
  await user.type(screen.getByLabelText("Answer"), "My answer draft");
  page.unmount();
  page = show("/finances/chat", "owner", client);
  expect(screen.getByLabelText("Message")).toHaveValue("");
  await user.type(screen.getByLabelText("Message"), "A different general draft");
  page.unmount();
  show("/finances/chat?question=question-a", "owner", client);
  expect(screen.getByLabelText("Answer")).toHaveValue("My answer draft");
  expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled();
  expect(api.answerFinanceContextualQuestion).not.toHaveBeenCalled();
});

it("does not expose another owner's draft and discards drafts when the auth cache is cleared", async () => {
  const client = createAppQueryClient({ queries: { retry: false } });
  const user = userEvent.setup();
  let page = show("/finances/chat", "owner-a", client);
  await user.type(screen.getByLabelText("Message"), "Owner A private draft");
  page.unmount();
  page = show("/finances/chat", "owner-b", client);
  expect(screen.getByLabelText("Message")).toHaveValue("");
  page.unmount();
  client.clear();
  show("/finances/chat", "owner-a", client);
  expect(screen.getByLabelText("Message")).toHaveValue("");
});

it.each([
  "resolve",
  "reject",
])("fences a late %s send after A to B to A and never restores its draft or retry key", async (outcome) => {
  let finish!: (value: typeof message) => void;
  let fail!: (reason: Error) => void;
  api.sendFinanceConversationMessage.mockReturnValueOnce(
    new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    }),
  );
  const client = createAppQueryClient({ queries: { retry: false } });
  const user = userEvent.setup();
  let page = show("/finances/chat", "owner-a", client);
  await user.type(screen.getByLabelText("Message"), "Old session message");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(api.sendFinanceConversationMessage).toHaveBeenCalledTimes(1));
  const oldCommand = api.sendFinanceConversationMessage.mock.calls[0]?.[0];
  page.unmount();
  act(() => {
    client.setQueryData(["me"], { id: "owner-b" });
    client.setQueryData(["me"], { id: "owner-a" });
  });
  page = show("/finances/chat", "owner-a", client);
  expect(screen.getByLabelText("Message")).toHaveValue("");
  await user.type(screen.getByLabelText("Message"), "New session draft");
  await act(async () => {
    if (outcome === "resolve") finish({ ...message, id: "old-accepted" });
    else fail(new Error("old failure"));
  });
  expect(screen.getByLabelText("Message")).toHaveValue("New session draft");
  expect(toast.success).not.toHaveBeenCalledWith(
    "Message saved for the next run",
    expect.any(Object),
  );
  expect(toast.error).not.toHaveBeenCalledWith(
    "Couldn’t save. Your draft is retained; try again.",
    expect.any(Object),
  );
  page.unmount();
  show("/finances/chat", "owner-a", client);
  expect(screen.getByLabelText("Message")).toHaveValue("New session draft");
  api.sendFinanceConversationMessage.mockResolvedValue({ ...message, id: "new-accepted" });
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(api.sendFinanceConversationMessage).toHaveBeenCalledTimes(2));
  expect(api.sendFinanceConversationMessage.mock.calls[1]?.[0].idempotencyKey).not.toBe(
    oldCommand.idempotencyKey,
  );
});

it("retains a draft after a scoped403 but discards it on401 session expiry", async () => {
  const client = createAppQueryClient({ queries: { retry: false } });
  const user = userEvent.setup();
  const page = show("/finances/chat", "owner", client);
  await screen.findByText(message.text);
  await user.type(screen.getByLabelText("Message"), "A draft before access changes");
  api.getFinanceConversationHistory.mockRejectedValue(
    new ApiClientError({ status: 403, code: "forbidden", message: "denied" }),
  );
  await user.click(screen.getByRole("button", { name: "Refresh conversation" }));
  await waitFor(() => expect(screen.queryByText(message.text)).not.toBeInTheDocument());
  expect(screen.getByLabelText("Message")).toHaveValue("A draft before access changes");
  api.getFinanceConversationHistory.mockRejectedValue(
    new ApiClientError({ status: 401, code: "unauthorized", message: "expired" }),
  );
  await user.click(screen.getByRole("button", { name: "Refresh conversation" }));
  await screen.findByText("Sign in again to open your Finance conversation.");
  page.unmount();
  api.getFinanceConversationHistory.mockResolvedValue({ messages: [], nextCursor: null });
  show("/finances/chat", "owner", client);
  expect(screen.getByLabelText("Message")).toHaveValue("");
});

it("preserves the contextual answer through actual Automations navigation and return", async () => {
  const client = createAppQueryClient({ queries: { retry: false } });
  client.setQueryData(["me"], { id: "owner" });
  api.getFinanceConversationReadiness.mockResolvedValue({
    canSend: false,
    reason: "registration_paused",
  });
  api.getFinanceContextualQuestion.mockResolvedValue({ state: "unavailable" });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/finances/chat?question=question-a"]}>
        <Routes>
          <Route path="/finances/chat" element={<FinanceConversationPage ownerId="owner" />} />
          <Route path="/finances/automations" element={<FinanceAutomationsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Answer"), "Keep this answer exactly");
  await user.click(await screen.findByRole("link", { name: "Review host setup" }));
  const back = await screen.findByRole("link", { name: "Return to conversation" });
  expect(back).toHaveAttribute("href", "/finances/chat?question=question-a");
  await user.click(back);
  expect(screen.getByLabelText("Answer")).toHaveValue("Keep this answer exactly");
  expect(api.answerFinanceContextualQuestion).not.toHaveBeenCalled();
  expect(api.markFinanceConversationRendered).not.toHaveBeenCalled();
});

it.each([
  "accepted",
  "rejected",
])("ignores a late %s contextual answer after the owner session changes", async (outcome) => {
  let finish!: (value: { state: string }) => void;
  let fail!: (reason: Error) => void;
  const client = createAppQueryClient({ queries: { retry: false } });
  api.getFinanceContextualQuestion.mockResolvedValue({
    state: "available",
    question: {
      id: "q",
      prompt: "Purpose?",
      transactionId: "t",
      status: "open",
      work: { id: "q", revision: "1" },
    },
  });
  api.answerFinanceContextualQuestion.mockReturnValue(
    new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    }),
  );
  const user = userEvent.setup();
  const page = show("/finances/chat?question=q", "owner-a", client);
  await screen.findByText("Purpose?");
  await user.type(screen.getByLabelText("Answer"), "Old answer");
  await user.click(screen.getByRole("button", { name: "Save answer" }));
  await waitFor(() => expect(api.answerFinanceContextualQuestion).toHaveBeenCalledTimes(1));
  page.unmount();
  show("/finances/chat?question=q", "owner-b", client);
  await user.type(screen.getByLabelText("Answer"), "New owner's draft");
  await act(async () => {
    if (outcome === "accepted") finish({ state: "accepted" });
    else fail(new Error("Old answer failed"));
  });
  expect(screen.getByLabelText("Answer")).toHaveValue("New owner's draft");
  expect(toast.success).not.toHaveBeenCalledWith("Answer saved", expect.any(Object));
  expect(toast.error).not.toHaveBeenCalledWith(
    "Couldn’t save. Your draft is retained; try again.",
    expect.any(Object),
  );
});

it.each([
  "unchanged",
  "edited",
])("reconciles an in-flight accepted send across a same-session remount with an %s draft", async (kind) => {
  let finish!: (value: typeof message) => void;
  api.sendFinanceConversationMessage.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const client = createAppQueryClient({ queries: { retry: false } });
  const user = userEvent.setup();
  let page = show("/finances/chat", "owner", client);
  await user.type(screen.getByLabelText("Message"), "Original pending message");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(api.sendFinanceConversationMessage).toHaveBeenCalledTimes(1));
  page.unmount();
  page = show("/finances/chat", "owner", client);
  expect(screen.getByLabelText("Message")).toHaveValue("Original pending message");
  if (kind === "edited") {
    await user.clear(screen.getByLabelText("Message"));
    await user.type(screen.getByLabelText("Message"), "Newer unsent draft");
  }
  await act(async () =>
    finish({ ...message, id: "accepted-original", text: "Original pending message" }),
  );
  const expected = kind === "edited" ? "Newer unsent draft" : "";
  expect(screen.getByLabelText("Message")).toHaveValue(expected);
  page.unmount();
  show("/finances/chat", "owner", client);
  expect(screen.getByLabelText("Message")).toHaveValue(expected);
  if (kind === "unchanged")
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  expect(api.sendFinanceConversationMessage).toHaveBeenCalledTimes(1);
});
