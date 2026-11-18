// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LinkOpener } from "./opener";
import { offerLink, pendingLink, takeLink } from "./pending";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  ready: true,
  push: vi.fn(),
  getMailThread: vi.fn(),
  toast: { loading: vi.fn(), error: vi.fn(), dismiss: vi.fn(), success: vi.fn() },
}));
vi.mock("expo-router", () => ({
  router: { push: h.push },
  useRootNavigationState: () => (h.ready ? { key: "root" } : undefined),
}));
vi.mock("sonner-native", () => ({ toast: h.toast }));
vi.mock("../auth/context", () => {
  const session = { api: () => ({ getMailThread: h.getMailThread }) };
  return { useAuth: () => ({ session }) };
});
vi.mock("../mail/reader", () => ({
  MailReader: ({ thread, close }: { thread: { subject: string }; close: () => void }) => (
    <div>
      <h1>{thread.subject}</h1>
      <button type="button" onClick={close}>
        Close conversation
      </button>
    </div>
  ),
}));

const uuid = (n: number) => `0b9c2f4e-6a51-4c0e-9a3d-2f1f6f0d8e1${n}`;
const thread = (n: number, subject: string) => ({
  accountId: uuid(0),
  bodyText: "private",
  from: { name: "Ada", address: "ada@example.com" },
  id: uuid(n),
  mailboxIds: [uuid(9)],
  messageCount: 1,
  provider: "google",
  receivedAt: "2026-11-17T12:00:00.000Z",
  remoteThreadId: "remote",
  snippet: "",
  starred: false,
  subject,
  to: [],
  unread: false,
  updatedAt: "2026-11-17T12:00:00.000Z",
});
const feedback = { id: "open-link" };
beforeEach(() => {
  h.ready = true;
});
afterEach(() => {
  cleanup();
  takeLink();
  vi.clearAllMocks();
});

it("pushes a queued record screen once and reports nothing", () => {
  const href = { pathname: "/task-editor", params: { id: "t1", kind: "task" } } as never;
  offerLink({ kind: "screen", href });
  const { container, rerender } = render(<LinkOpener />);
  rerender(<LinkOpener />);
  expect(h.push).toHaveBeenCalledTimes(1);
  expect(h.push).toHaveBeenCalledWith(href);
  expect(pendingLink()).toBeNull();
  expect(h.toast.error).not.toHaveBeenCalled();
  expect(h.toast.loading).not.toHaveBeenCalled();
  expect(container).toBeEmptyDOMElement();
});

it("holds a link until navigation is ready, then opens one that arrives later", () => {
  h.ready = false;
  offerLink({ kind: "screen", href: "/finance-transaction?id=one" as never });
  const { rerender } = render(<LinkOpener />);
  expect(h.push).not.toHaveBeenCalled();
  expect(pendingLink()).not.toBeNull();
  h.ready = true;
  rerender(<LinkOpener />);
  expect(h.push).toHaveBeenCalledWith("/finance-transaction?id=one");
  act(() => offerLink({ kind: "screen", href: "/calendar-event?id=two" as never }));
  expect(h.push).toHaveBeenLastCalledWith("/calendar-event?id=two");
  expect(h.push).toHaveBeenCalledTimes(2);
});

it("says through Sonner alone that an unsupported link cannot be opened", () => {
  offerLink({ kind: "unsupported" });
  const { container } = render(<LinkOpener />);
  expect(h.toast.error).toHaveBeenCalledWith("This link can’t be opened in nohmi.", feedback);
  expect(h.push).not.toHaveBeenCalled();
  expect(container).toBeEmptyDOMElement();
});

it("reads a conversation and shows the reader without its message text", async () => {
  h.getMailThread.mockResolvedValue(thread(1, "Lease renewal"));
  offerLink({ kind: "conversation", id: "c1" });
  render(<LinkOpener />);
  expect(h.toast.loading).toHaveBeenCalledWith("Opening conversation…", feedback);
  expect(await screen.findByRole("heading", { name: "Lease renewal" })).toBeVisible();
  expect(h.getMailThread).toHaveBeenCalledWith("c1");
  expect(h.toast.dismiss).toHaveBeenCalledWith("open-link");
  expect(h.toast.error).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close conversation" }));
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
});

it("reports a missing conversation and a failed read through Sonner with no inline copy", async () => {
  h.getMailThread.mockRejectedValueOnce(
    new ApiClientError({ code: "NOT_FOUND", status: 404, message: "Not found" }),
  );
  offerLink({ kind: "conversation", id: "gone" });
  const { container } = render(<LinkOpener />);
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledWith(
      "This conversation is no longer available.",
      feedback,
    ),
  );
  h.getMailThread.mockRejectedValueOnce(new TypeError("Network request failed"));
  act(() => offerLink({ kind: "conversation", id: "offline" }));
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Couldn’t open this conversation. Check your connection and try again.",
      feedback,
    ),
  );
  h.getMailThread.mockResolvedValueOnce({ id: "malformed" });
  act(() => offerLink({ kind: "conversation", id: "malformed" }));
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByText(/available|connection|Network/)).not.toBeInTheDocument();
});

it("drops a conversation read that a newer link, a close or sign-out has replaced", async () => {
  let finish = (_value: unknown) => {};
  let fail = (_error: unknown) => {};
  h.getMailThread.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  offerLink({ kind: "conversation", id: "slow" });
  const { container, unmount } = render(<LinkOpener />);
  h.getMailThread.mockResolvedValueOnce(thread(2, "Newer"));
  act(() => offerLink({ kind: "conversation", id: "c2" }));
  expect(await screen.findByRole("heading", { name: "Newer" })).toBeVisible();
  await act(async () => finish(thread(3, "Older")));
  expect(screen.queryByRole("heading", { name: "Older" })).not.toBeInTheDocument();
  // A record link closes the open reader so the pushed screen is not hidden behind it.
  act(() => offerLink({ kind: "screen", href: "/task-editor?id=t2&kind=task" as never }));
  expect(container).toBeEmptyDOMElement();
  h.getMailThread.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  act(() => offerLink({ kind: "conversation", id: "abandoned" }));
  h.toast.error.mockClear();
  h.toast.dismiss.mockClear();
  unmount();
  expect(h.toast.dismiss).toHaveBeenCalledWith("open-link");
  await act(async () => fail(new TypeError("Network request failed")));
  expect(h.toast.error).not.toHaveBeenCalled();
});
