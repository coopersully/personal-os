// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider, useTaskResources, useTaskSearch } from "./data";

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
}));
vi.mock("../auth/context", () => ({ useAuth: () => ({ session: { api: () => h } }) }));
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
