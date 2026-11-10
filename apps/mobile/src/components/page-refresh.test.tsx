// @vitest-environment jsdom
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RefreshClient, RefreshScope, usePageRefresh } from "./page-refresh";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
vi.mock("react-native", async () => import("../../test/native"));
const h = vi.hoisted(() => ({
  loading: vi.fn(() => "refresh"),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner-native", () => ({ toast: h }));
let client: QueryClient;
let off: (() => void)[];
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  off = [];
});
afterEach(() => {
  cleanup();
  for (const dispose of off) dispose();
  client.clear();
});
const wrapper = ({ children }: PropsWithChildren) => (
  <RefreshClient.Provider value={client}>
    <RefreshScope.Provider value={["mail"]}>{children}</RefreshScope.Provider>
  </RefreshClient.Provider>
);
async function observe(key: string[], read: () => Promise<unknown>, enabled = true) {
  const observer = new QueryObserver(client, { queryKey: key, queryFn: read, enabled });
  off.push(observer.subscribe(() => {}));
  if (enabled) await observer.refetch();
  return observer;
}
it("refreshes only active reads in this workspace, including fresh data", async () => {
  const mail = vi.fn().mockResolvedValue("mail");
  const tasks = vi.fn().mockResolvedValue("tasks");
  const disabled = vi.fn().mockResolvedValue("disabled");
  await observe(["mail", "inbox"], mail);
  await observe(["tasks", "list"], tasks);
  await observe(["mail", "disabled"], disabled, false);
  mail.mockClear();
  tasks.mockClear();
  const { result } = renderHook(() => usePageRefresh(), { wrapper });
  await act(() => result.current.refresh());
  expect(mail).toHaveBeenCalledOnce();
  expect(tasks).not.toHaveBeenCalled();
  expect(disabled).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(h.loading).not.toHaveBeenCalled();
});
it("locks overlapping refreshes and suppresses late feedback after leaving the page", async () => {
  let resolve!: (value: unknown) => void;
  const read = vi.fn().mockResolvedValue("first");
  await observe(["mail", "inbox"], read);
  read.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  read.mockClear();
  const { result, unmount } = renderHook(() => usePageRefresh(), { wrapper });
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.refresh();
  });
  await act(() => result.current.refresh());
  expect(read).toHaveBeenCalledOnce();
  expect(result.current.refreshing).toBe(true);
  unmount();
  await act(async () => {
    resolve("new");
    await pending;
  });
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
});
it("reports failed reads honestly and releases the refresh spinner", async () => {
  const read = vi.fn().mockResolvedValue("first");
  await observe(["mail", "inbox"], read);
  read.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => usePageRefresh(), { wrapper });
  await act(() => result.current.refresh());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Couldn’t refresh"));
  expect(h.success).not.toHaveBeenCalled();
  expect(result.current.refreshing).toBe(false);
});
it("supports Today’s existing refresh handler and never invents a data refresh on static pages", async () => {
  const custom = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => usePageRefresh(undefined, custom), { wrapper });
  await act(() => hook.result.current.refresh());
  expect(custom).toHaveBeenCalledOnce();
  expect(h.loading).not.toHaveBeenCalled();
  hook.unmount();
  const { result } = renderHook(() => usePageRefresh(), { wrapper });
  await act(() => result.current.refresh());
  expect(h.info).not.toHaveBeenCalled();
});
