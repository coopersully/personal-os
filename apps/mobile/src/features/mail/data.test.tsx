// @vitest-environment jsdom

import type { Mailbox, MailThreadSummary } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInbox, useMailAction } from "./data";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner",
  update: vi.fn(),
  summaries: vi.fn(),
  boxes: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(() => "toast"),
  dismiss: vi.fn(),
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: h.owner } },
    session: {
      api: () => ({
        updateMailThread: h.update,
        listMailThreadSummaries: h.summaries,
        listMailboxes: h.boxes,
      }),
    },
  }),
}));
vi.mock("expo-router", () => ({ useFocusEffect: () => {} }));
vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: vi.fn() }) } }));
vi.mock("sonner-native", () => ({ toast: h }));
const thread = {
  id: "thread",
  accountId: "account",
  mailboxIds: ["inbox", "label"],
  unread: true,
  updatedAt: "before",
} as MailThreadSummary;
const boxes = [{ id: "inbox", accountId: "account", role: "inbox" }] as Mailbox[];
let client: QueryClient;
const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  h.update.mockResolvedValue({ ...thread, updatedAt: "after" });
  h.summaries.mockResolvedValue([]);
  h.boxes.mockResolvedValue(boxes);
});
afterEach(() => {
  cleanup();
  client.clear();
});
it("confirms archive then restores mailbox membership once with the returned revision", async () => {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => useMailAction(boxes), { wrapper });
  await act(() => result.current.run(thread, "archive"));
  expect(h.update).toHaveBeenCalledWith("thread", {
    expectedUpdatedAt: "before",
    mailboxIds: ["label"],
  });
  expect(h.success).toHaveBeenCalledWith("Message archived", expect.anything());
  const undo = h.success.mock.calls[0][1].action.onClick;
  await act(() => undo());
  await act(() => undo());
  expect(h.update).toHaveBeenCalledTimes(2);
  expect(h.update).toHaveBeenLastCalledWith("thread", {
    expectedUpdatedAt: "after",
    mailboxIds: ["inbox", "label"],
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["mail", "owner"] });
});
it("toggles read and provides Undo, without replaying an uncertain provider failure", async () => {
  const { result } = renderHook(() => useMailAction(boxes), { wrapper });
  h.update.mockRejectedValueOnce(new Error("timeout"));
  await act(() => result.current.run(thread, "read"));
  expect(h.update).toHaveBeenCalledTimes(1);
  expect(h.error).toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(result.current.pending.size).toBe(0);
  await act(() => result.current.run(thread, "read"));
  expect(h.success).toHaveBeenCalledWith("Marked as read", expect.anything());
  await act(() => h.success.mock.calls[0][1].action.onClick());
  expect(h.update).toHaveBeenLastCalledWith("thread", { expectedUpdatedAt: "after", unread: true });
});
it("suppresses duplicate swipes and fences late responses after an owner switch", async () => {
  let resolve!: (value: unknown) => void;
  h.update.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result, rerender } = renderHook(() => useMailAction(boxes), { wrapper });
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.run(thread, "read");
  });
  await act(() => result.current.run(thread, "read"));
  expect(h.update).toHaveBeenCalledTimes(1);
  h.owner = "other";
  rerender();
  await act(async () => {
    resolve({ ...thread, updatedAt: "after" });
    await pending;
  });
  expect(h.success).not.toHaveBeenCalled();
  expect(h.dismiss).toHaveBeenCalledWith("toast");
});
it("does not allow a stale account’s Undo after sign-out", async () => {
  const { result, rerender } = renderHook(() => useMailAction(boxes), { wrapper });
  await act(() => result.current.run(thread, "read"));
  const undo = h.success.mock.calls[0][1].action.onClick;
  h.owner = "other";
  rerender();
  await act(() => undo());
  expect(h.update).toHaveBeenCalledTimes(1);
});
it("reports a failed Undo without asserting success", async () => {
  const { result } = renderHook(() => useMailAction(boxes), { wrapper });
  await act(() => result.current.run(thread, "archive"));
  h.update.mockRejectedValueOnce(new Error("conflict"));
  await act(() => h.success.mock.calls[0][1].action.onClick());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Couldn’t undo"), expect.anything());
  expect(h.success).toHaveBeenCalledTimes(1);
});
it("loads the inbox with a stable owner-scoped summary contract", async () => {
  const { result } = renderHook(() => useInbox("board"), { wrapper });
  await waitFor(() => expect(result.current.inbox.isSuccess).toBe(true));
  expect(h.summaries).toHaveBeenCalledWith({ mailboxRole: "inbox", limit: 50, query: "board" });
  expect(client.getQueryData(["mail", "owner", "inbox", "board", "inbox", "", {}])).toBeDefined();
});

it("scopes each folder read and query cache to the selected account", async () => {
  const { result } = renderHook(() => useInbox("", "trash", "account-two"), { wrapper });
  await waitFor(() => expect(result.current.inbox.isSuccess).toBe(true));
  expect(h.summaries).toHaveBeenCalledWith({
    mailboxRole: "trash",
    accountIds: ["account-two"],
    limit: 50,
    query: undefined,
  });
  expect(
    client.getQueryData(["mail", "owner", "inbox", "", "trash", "account-two", {}]),
  ).toBeDefined();
});

it("applies combined filters on the server and separates their page cache", async () => {
  const { result } = renderHook(
    () => useInbox("board", "inbox", "account", { unread: true, starred: true }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.inbox.isSuccess).toBe(true));
  expect(h.summaries).toHaveBeenCalledWith({
    mailboxRole: "inbox",
    accountIds: ["account"],
    limit: 50,
    query: "board",
    unread: true,
    starred: true,
  });
  expect(
    client.getQueryData([
      "mail",
      "owner",
      "inbox",
      "board",
      "inbox",
      "account",
      { unread: true, starred: true },
    ]),
  ).toBeDefined();
});
