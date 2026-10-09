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
