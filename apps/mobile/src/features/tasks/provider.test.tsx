// @vitest-environment jsdom

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider, useTaskAction, useTaskResources, useTaskSearch } from "./data";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
// Use the same React peer as the DOM renderer; this is the real QueryClient implementation.
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  listTaskLists: vi.fn(),
  listTaskProjects: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "action"),
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({ session: { api: () => h } }),
}));
vi.mock("sonner-native", () => ({ toast: h }));
beforeEach(() => {
  vi.clearAllMocks();
  h.listTaskLists.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  h.listTaskProjects.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  h.getWorkspaceSettings.mockReset().mockResolvedValue({ preferences: {} });
});
afterEach(cleanup);
it("loads every resource page, shares search, and discards data when the owner provider unmounts", async () => {
  h.listTaskLists
    .mockResolvedValueOnce({ items: [{ id: "inbox" }], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [{ id: "list" }], nextCursor: null });
  const { result, unmount } = renderHook(
    () => ({ resources: useTaskResources(), search: useTaskSearch() }),
    { wrapper: MobileDataProvider },
  );
  await waitFor(() =>
    expect(result.current.resources.lists.data).toEqual([{ id: "inbox" }, { id: "list" }]),
  );
  expect(h.listTaskLists).toHaveBeenLastCalledWith({ limit: 100, cursor: "next" });
  await waitFor(() => expect(result.current.resources.settings.data).toEqual({ preferences: {} }));
  expect(h.listTaskProjects).toHaveBeenCalledWith({ limit: 100, cursor: undefined });
  expect(h.getWorkspaceSettings).toHaveBeenCalledWith("tasks");
  act(() => result.current.search.setSearch("garden"));
  expect(result.current.search.search).toBe("garden");
  unmount();
  const next = renderHook(() => ({ resources: useTaskResources(), search: useTaskSearch() }), {
    wrapper: MobileDataProvider,
  });
  expect(next.result.current.search.search).toBe("");
  await waitFor(() => expect(next.result.current.resources.lists.data).toEqual([]));
});
it("reports resource failures through Sonner without silently retrying", async () => {
  h.listTaskProjects.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(useTaskResources, { wrapper: MobileDataProvider });
  await waitFor(() => expect(result.current.projects.isError).toBe(true));
  expect(h.listTaskProjects).toHaveBeenCalledOnce();
  expect(h.error).toHaveBeenCalledOnce();
  expect(result.current.projects.data).toBeUndefined();
});

it.each([
  "detail",
  "container",
])("refreshes lists without refetching a closing %s editor after a successful action", async (kind) => {
  const record = vi.fn().mockResolvedValue({ id: "one", revision: 1 });
  const list = vi.fn().mockResolvedValue([]);
  const key = ["tasks", kind, "task", "one"];
  const { result, rerender } = renderHook(
    ({ visible }) => ({
      record: useQuery({ queryKey: key, queryFn: record, enabled: visible }),
      list: useQuery({ queryKey: ["tasks", "workspace", {}], queryFn: list }),
      action: useTaskAction(),
      client: useQueryClient(),
    }),
    { wrapper: MobileDataProvider, initialProps: { visible: true } },
  );
  await waitFor(() => expect(result.current.record.data).toEqual({ id: "one", revision: 1 }));
  await waitFor(() => expect(result.current.list.data).toEqual([]));
  record.mockRejectedValue(new Error("Deleted record is no longer readable"));
  await act(async () => {
    await result.current.action.run("Trashing…", async () => ({ id: "one", revision: 2 }));
  });
  expect(record).toHaveBeenCalledOnce();
  expect(h.error).not.toHaveBeenCalled();
  expect(h.success).toHaveBeenCalledWith("Saved", expect.anything());
  expect(list).toHaveBeenCalledTimes(2);
  expect(result.current.client.getQueryState(key)?.isInvalidated).toBe(true);
  rerender({ visible: false });
  record.mockResolvedValue({ id: "one", revision: 3 });
  rerender({ visible: true });
  await waitFor(() => expect(result.current.record.data).toEqual({ id: "one", revision: 3 }));
  expect(record).toHaveBeenCalledTimes(2);
});
