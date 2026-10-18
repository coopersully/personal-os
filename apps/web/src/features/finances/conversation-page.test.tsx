// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinanceConversationPage } from "./conversation-page.js";

const api = vi.hoisted(() => ({
  getFinanceConversationReadiness: vi.fn(),
  getFinanceConversationHistory: vi.fn(),
  sendFinanceConversationMessage: vi.fn(),
  markFinanceConversationRendered: vi.fn(),
  getFinanceContextualQuestion: vi.fn(),
  answerFinanceContextualQuestion: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  loading: vi.fn(() => "toast-id"),
  success: vi.fn(),
  error: vi.fn(),
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
function show(route = "/finances/chat", ownerId = "owner") {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
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
  show();
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
  expect(screen.getByRole("link", { name: "Open Automations" })).toHaveAttribute(
    "href",
    "/finances/automations",
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
