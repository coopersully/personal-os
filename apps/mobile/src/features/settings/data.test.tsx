// @vitest-environment jsdom

import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useSettingsAction, useSettingsResource } from "./data";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "one",
  epoch: 1,
  api: {},
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
  loading: vi.fn(() => "pending"),
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: h.owner } },
    session: { epoch: () => h.epoch, api: () => h.api },
  }),
}));
vi.mock("../tasks/data", () => ({ errorMessage: (error: Error) => error.message }));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, dismiss: h.dismiss, loading: h.loading },
}));
beforeEach(() => {
  h.owner = "one";
  h.epoch = 1;
  vi.clearAllMocks();
});
it("distinguishes successful void actions from rejected mutations and retains Sonner success", async () => {
  const { result } = renderHook(useSettingsAction);
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.run(async () => {}, "Saved");
  });
  expect(outcome).toEqual({ ok: true, value: undefined });
  expect(h.success).toHaveBeenCalledWith("Saved", { id: "pending" });
  expect(h.dismiss).not.toHaveBeenCalled();
  await act(async () => {
    outcome = await result.current.run(async () => {
      throw new Error("Denied");
    });
  });
  expect(outcome).toEqual({ ok: false });
  expect(h.error).toHaveBeenCalledWith("Denied", { id: undefined });
});
it("suppresses action completion after switching owners", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => (finish = resolve));
  const { result, rerender } = renderHook(useSettingsAction);
  let operation!: ReturnType<typeof result.current.run>;
  act(() => {
    operation = result.current.run(() => pending, "Saved");
  });
  h.owner = "two";
  h.epoch = 2;
  rerender();
  await act(async () => {
    finish();
    expect(await operation).toEqual({ ok: false });
  });
  expect(h.success).not.toHaveBeenCalled();
  expect(h.dismiss).toHaveBeenCalledWith("pending");
});
it("does not expose previous account reads or late results", async () => {
  let finish!: (value: string) => void;
  const old = new Promise<string>((resolve) => (finish = resolve));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const load = vi.fn(() => (h.owner === "one" ? old : Promise.resolve("two data")));
  const { result, rerender } = renderHook(() => useSettingsResource("test", load), { wrapper });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  h.owner = "two";
  h.epoch = 2;
  rerender();
  expect(result.current.data).toBeUndefined();
  await waitFor(() => expect(result.current.data).toBe("two data"));
  await act(async () => finish("one private data"));
  expect(result.current.data).toBe("two data");
  client.clear();
});
it("rejects an old confirmation callback before it can act for a newly signed-in account", async () => {
  const { result, rerender } = renderHook(useSettingsAction);
  const oldRun = result.current.run;
  h.owner = "two";
  h.epoch = 2;
  rerender();
  const mutation = vi.fn(async () => {});
  await act(async () => {
    expect(await oldRun(mutation, "Saved")).toEqual({ ok: false });
  });
  expect(mutation).not.toHaveBeenCalled();
});

it("uses one loading-to-error Sonner for a scoped cached refresh failure", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce(["cached audit event"])
    .mockRejectedValueOnce(new Error("Offline"));
  const client = new QueryClient({
    queryCache: new QueryCache({
      onError: (_error, query) => {
        if (!query.meta?.scopedReadFeedback) h.error("global error");
      },
    }),
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({
      resource: useSettingsResource("activity", load, true, true),
      action: useSettingsAction(),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.resource.data).toEqual(["cached audit event"]));
  await act(async () => {
    await result.current.action.run(async () => {
      const refreshed = await result.current.resource.refetch();
      if (refreshed.error) throw refreshed.error;
    }, "Activity refreshed");
  });
  expect(h.loading).toHaveBeenCalledTimes(1);
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(h.error).toHaveBeenCalledWith("Offline", { id: "pending" });
  expect(h.success).not.toHaveBeenCalled();
  expect(result.current.resource.data).toEqual(["cached audit event"]);
  client.clear();
});
