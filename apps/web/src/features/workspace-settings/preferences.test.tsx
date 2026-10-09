// @vitest-environment jsdom
import { resolveWorkspaceSettings } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { api } from "@/api";
import { useSaveWorkspacePreferences } from "./preferences";

afterEach(() => vi.restoreAllMocks());
it("serializes different controls in one workspace and resolves queued relative changes against fresh state", async () => {
  let settings = resolveWorkspaceSettings("tasks");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(async () => settings);
  const update = vi
    .spyOn(api, "updateWorkspaceSettings")
    .mockImplementation(async (_workspace, input) => {
      if (input.expectedRevision === 0) await held;
      expect(input.expectedRevision).toBe(settings.revision);
      settings = resolveWorkspaceSettings("tasks", {
        ...settings.preferences,
        ...input.preferences,
        revision: settings.revision + 1,
      });
      return settings;
    });
  const cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  cache.setQueryData(["workspace-settings", "tasks"], settings);
  const hooks = renderHook(
    () => ({
      first: useSaveWorkspacePreferences("tasks"),
      second: useSaveWorkspacePreferences("tasks"),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={cache}>{children}</QueryClientProvider>
      ),
    },
  );
  act(() => {
    hooks.result.current.first.mutate({ taskRowDetails: ["notes"] });
    hooks.result.current.second.mutate((current) => ({
      taskRowDetails: [...current.taskRowDetails, "tags"],
    }));
  });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  release();
  await waitFor(() => expect(hooks.result.current.second.isSuccess).toBe(true));
  expect(settings.preferences.taskRowDetails).toEqual(["notes", "tags"]);
  expect(cache.getQueryData(["workspace-settings", "tasks"])).toEqual(settings);
});

it("rejects a captured same-field edit after another client saves instead of borrowing its revision", async () => {
  const original = resolveWorkspaceSettings("tasks");
  let settings = resolveWorkspaceSettings("tasks", { taskSort: "title", revision: 1 });
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(async () => settings);
  const update = vi
    .spyOn(api, "updateWorkspaceSettings")
    .mockImplementation(async (_workspace, input) => {
      if (input.expectedRevision !== settings.revision)
        throw new Error("Workspace preferences changed. Reload before saving.");
      settings = resolveWorkspaceSettings("tasks", {
        ...settings.preferences,
        ...input.preferences,
        revision: settings.revision + 1,
      });
      return settings;
    });
  const cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  cache.setQueryData(["workspace-settings", "tasks"], original);
  const hook = renderHook(() => useSaveWorkspacePreferences("tasks"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  act(() => hook.result.current.mutate({ taskSort: "priority" }));
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(update).toHaveBeenCalledWith("tasks", {
    expectedRevision: 0,
    preferences: { taskSort: "priority" },
  });
  expect(settings.revision).toBe(1);
  expect(settings.preferences.taskSort).toBe("title");
});

it("does not rebase a queued local edit over a remote write after its predecessor succeeds", async () => {
  let settings = resolveWorkspaceSettings("tasks");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  cache.setQueryData(["workspace-settings", "tasks"], settings);
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(async () => settings);
  const update = vi
    .spyOn(api, "updateWorkspaceSettings")
    .mockImplementation(async (_workspace, input) => {
      if (input.expectedRevision === 0) {
        await held;
        const local = resolveWorkspaceSettings("tasks", {
          ...settings.preferences,
          ...input.preferences,
          revision: 1,
        });
        settings = resolveWorkspaceSettings("tasks", {
          ...local.preferences,
          taskSort: "title",
          revision: 2,
        });
        return local;
      }
      if (input.expectedRevision !== settings.revision)
        throw new Error("Workspace preferences changed. Reload before saving.");
      throw new Error("Unexpected update");
    });
  const hook = renderHook(
    () => ({
      first: useSaveWorkspacePreferences("tasks"),
      second: useSaveWorkspacePreferences("tasks"),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={cache}>{children}</QueryClientProvider>
      ),
    },
  );
  act(() => {
    hook.result.current.first.mutate({ taskRowDetails: ["notes"] });
    hook.result.current.second.mutate({ taskSort: "priority" });
  });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  release();
  await waitFor(() => expect(hook.result.current.second.isError).toBe(true));
  expect(update.mock.calls[1]?.[1].expectedRevision).toBe(1);
  expect(settings.revision).toBe(2);
  expect(settings.preferences.taskSort).toBe("title");
  expect(settings.preferences.taskRowDetails).toEqual(["notes"]);
});

it("retains attempted values across refresh failure and uses only the explicitly reviewed revision", async () => {
  let settings = resolveWorkspaceSettings("tasks");
  const read = vi.spyOn(api, "getWorkspaceSettings").mockImplementation(async () => settings);
  const update = vi.spyOn(api, "updateWorkspaceSettings").mockRejectedValue(new Error("Changed"));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  cache.setQueryData(["workspace-settings", "tasks"], settings);
  const hook = renderHook(() => useSaveWorkspacePreferences("tasks"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  act(() => hook.result.current.mutate({ taskSort: "priority" }));
  await waitFor(() =>
    expect(hook.result.current.recovery?.attempted).toEqual({ taskSort: "priority" }),
  );
  await waitFor(() => expect(cache.isFetching()).toBe(0));
  read.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => {
    await hook.result.current.refreshRecovery();
  });
  expect(hook.result.current.recovery?.reviewed).toBeUndefined();
  act(() => hook.result.current.reapplyReviewed());
  expect(update).toHaveBeenCalledTimes(1);
  settings = resolveWorkspaceSettings("tasks", { revision: 4, taskSort: "title" });
  await act(async () => {
    await hook.result.current.refreshRecovery();
  });
  expect(update).toHaveBeenCalledTimes(1);
  // A later remote change must not become an unseen revision for reapply.
  settings = resolveWorkspaceSettings("tasks", { revision: 5, taskSort: "date" });
  act(() => hook.result.current.reapplyReviewed());
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith("tasks", {
    expectedRevision: 4,
    preferences: { taskSort: "priority" },
  });
  await waitFor(() => expect(hook.result.current.recovery?.reviewed).toBeUndefined());
  await act(async () => {
    await hook.result.current.refreshRecovery();
  });
  update.mockResolvedValue(
    resolveWorkspaceSettings("tasks", { revision: 6, taskSort: "priority" }),
  );
  act(() => hook.result.current.reapplyReviewed());
  await waitFor(() => expect(hook.result.current.recovery).toBeUndefined());
  expect(update).toHaveBeenLastCalledWith("tasks", {
    expectedRevision: 5,
    preferences: { taskSort: "priority" },
  });
});

it("merges queued failed fields across hook instances and retains them after unrelated successful writes and navigation", async () => {
  let settings = resolveWorkspaceSettings("tasks");
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(async () => settings);
  const update = vi
    .spyOn(api, "updateWorkspaceSettings")
    .mockRejectedValueOnce(new Error("Offline sort"))
    .mockRejectedValueOnce(new Error("Offline grouping"))
    .mockImplementation(async (_workspace, input) => {
      settings = resolveWorkspaceSettings("tasks", {
        ...settings.preferences,
        ...input.preferences,
        revision: settings.revision + 1,
      });
      return settings;
    });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  cache.setQueryData(["workspace-settings", "tasks"], settings);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  const hooks = renderHook(
    () => ({
      first: useSaveWorkspacePreferences("tasks"),
      second: useSaveWorkspacePreferences("tasks"),
    }),
    { wrapper },
  );
  act(() => {
    hooks.result.current.first.mutate({ taskSort: "priority" });
    hooks.result.current.second.mutate({ taskGroup: "list" });
    hooks.result.current.first.mutate({ showCompletedTasks: false });
  });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(hooks.result.current.first.isSuccess).toBe(true));
  expect(hooks.result.current.first.recovery?.attempted).toEqual({
    taskSort: "priority",
    taskGroup: "list",
  });
  expect(hooks.result.current.second.recovery?.attempted).toEqual({
    taskSort: "priority",
    taskGroup: "list",
  });
  hooks.unmount();
  const settingsPage = renderHook(() => useSaveWorkspacePreferences("tasks"), { wrapper });
  expect(settingsPage.result.current.recovery?.attempted).toEqual({
    taskSort: "priority",
    taskGroup: "list",
  });
  await act(async () => {
    await settingsPage.result.current.refreshRecovery();
  });
  expect(update).toHaveBeenCalledTimes(3);
  act(() => settingsPage.result.current.reapplyReviewed());
  await waitFor(() => expect(settingsPage.result.current.recovery).toBeUndefined());
  expect(update).toHaveBeenLastCalledWith("tasks", {
    expectedRevision: 1,
    preferences: { taskSort: "priority", taskGroup: "list" },
  });
  expect(settings.preferences.showCompletedTasks).toBe(false);
});

it("keeps the newest failed same-field intent and does not clear it for a different confirmed value", async () => {
  const settings = resolveWorkspaceSettings("tasks");
  vi.spyOn(api, "getWorkspaceSettings").mockResolvedValue(settings);
  const update = vi
    .spyOn(api, "updateWorkspaceSettings")
    .mockRejectedValueOnce(new Error("First failed"))
    .mockRejectedValueOnce(new Error("Second failed"))
    .mockResolvedValue(resolveWorkspaceSettings("tasks", { taskSort: "title", revision: 1 }));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  cache.setQueryData(["workspace-settings", "tasks"], settings);
  const hook = renderHook(() => useSaveWorkspacePreferences("tasks"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  act(() => {
    hook.result.current.mutate({ taskSort: "priority" });
    hook.result.current.mutate({ taskSort: "date" });
    hook.result.current.mutate({ taskSort: "title" });
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.recovery?.attempted).toEqual({ taskSort: "date" });
  act(() => hook.result.current.acceptLatest());
  await waitFor(() => expect(hook.result.current.recovery).toBeUndefined());
  expect(update).toHaveBeenCalledTimes(3);
});

it("clears attempts on account transitions and fences deferred old-account failures through A to B to A", async () => {
  const settings = resolveWorkspaceSettings("tasks");
  vi.spyOn(api, "getWorkspaceSettings").mockResolvedValue(settings);
  let fail!: (error: Error) => void;
  vi.spyOn(api, "updateWorkspaceSettings").mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const onError = vi.fn();
  const onSettled = vi.fn();
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner-a" });
  cache.setQueryData(["workspace-settings", "tasks"], settings);
  const hook = renderHook(() => useSaveWorkspacePreferences("tasks"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  act(() => hook.result.current.mutate({ taskSort: "priority" }, { onError, onSettled }));
  await waitFor(() => expect(fail).toBeDefined());
  act(() => {
    cache.removeQueries({ queryKey: ["me"] });
    cache.setQueryData(["me"], { id: "owner-b" });
    cache.setQueryData(["me"], { id: "owner-a" });
  });
  await act(async () => fail(new Error("Old request failed")));
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.recovery).toBeUndefined();
  expect(onError).not.toHaveBeenCalled();
  expect(onSettled).not.toHaveBeenCalled();
  expect(
    cache
      .getQueryCache()
      .findAll({ queryKey: ["workspace-settings-recovery"] })
      .every((query) => !query.state.data),
  ).toBe(true);
});

it("rechecks the session after asynchronous cancellation and does not commit old-account success or caller callbacks", async () => {
  const original = resolveWorkspaceSettings("tasks");
  const saved = resolveWorkspaceSettings("tasks", { taskSort: "priority", revision: 1 });
  vi.spyOn(api, "getWorkspaceSettings").mockResolvedValue(original);
  vi.spyOn(api, "updateWorkspaceSettings").mockResolvedValue(saved);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner-a" });
  cache.setQueryData(["workspace-settings", "tasks"], original);
  let release!: () => void;
  const canceled = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cancel = vi.spyOn(cache, "cancelQueries").mockReturnValue(canceled);
  const onSuccess = vi.fn();
  const onSettled = vi.fn();
  const hook = renderHook(() => useSaveWorkspacePreferences("tasks"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  act(() => hook.result.current.mutate({ taskSort: "priority" }, { onSuccess, onSettled }));
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  act(() => {
    cache.setQueryData(["me"], { id: "owner-b" });
    cache.setQueryData(["me"], { id: "owner-a" });
  });
  await act(async () => release());
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(cache.getQueryData(["workspace-settings", "tasks"])).not.toEqual(saved);
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onSettled).not.toHaveBeenCalled();
});

it("rejects late reads from a replaced session and never writes without an authenticated owner", async () => {
  let finish!: (settings: ReturnType<typeof resolveWorkspaceSettings<"tasks">>) => void;
  const read = vi.spyOn(api, "getWorkspaceSettings").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const update = vi.spyOn(api, "updateWorkspaceSettings");
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useSaveWorkspacePreferences("tasks"), { wrapper });
  act(() => hook.result.current.mutate({ taskSort: "priority" }));
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(update).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  act(() => cache.setQueryData(["me"], { id: "owner-a" }));
  await waitFor(() => expect(finish).toBeDefined());
  const oldFinish = finish;
  act(() => {
    cache.removeQueries({ queryKey: ["me"] });
    cache.setQueryData(["me"], { id: "owner-b" });
  });
  await act(async () =>
    oldFinish(resolveWorkspaceSettings("tasks", { taskSort: "priority", revision: 7 })),
  );
  expect(cache.getQueryData(["workspace-settings", "tasks"])).not.toEqual(
    resolveWorkspaceSettings("tasks", { taskSort: "priority", revision: 7 }),
  );
  expect(hook.result.current.recovery).toBeUndefined();
});
