// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { holdReadFeedback, isReadFeedbackHeld } from "../../components/read-feedback-scope";
import { MobileDataProvider } from "../tasks/data";
import { useSettingsRefresh, useSettingsResource } from "./data";

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
  epoch: 1,
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "refresh-toast"),
  dismiss: vi.fn(),
  api: { listActivity: vi.fn(), listSessions: vi.fn(), listConnectors: vi.fn() },
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: h.owner } },
    session: { epoch: () => h.epoch, api: () => h.api },
  }),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, loading: h.loading, dismiss: h.dismiss },
}));
const wrapper = ({ children }: PropsWithChildren) => (
  <MobileDataProvider>{children}</MobileDataProvider>
);
const key = (name: string) => ["settings", h.owner, h.epoch, name];
function useReads() {
  const activity = useSettingsResource("activity", (api) => api.listActivity(100));
  const sessions = useSettingsResource("sessions", (api) => api.listSessions());
  const other = useSettingsResource("connectors", (api) => api.listConnectors());
  const group = useSettingsRefresh(
    [key("activity"), key("sessions")],
    [
      () => activity.refetch({ throwOnError: true, cancelRefetch: false }),
      () => sessions.refetch({ throwOnError: true, cancelRefetch: false }),
    ],
    "Settings refreshed",
  );
  const single = useSettingsRefresh(
    [key("activity")],
    [() => activity.refetch({ throwOnError: true, cancelRefetch: false })],
    "Activity refreshed",
  );
  return { activity, sessions, other, group, single, client: useQueryClient() };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const denied = (message: string) =>
  new ApiClientError({ status: 400, code: "invalid_request", message });
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  h.epoch = 1;
  h.api.listActivity.mockResolvedValue([]);
  h.api.listSessions.mockResolvedValue([]);
  h.api.listConnectors.mockResolvedValue([]);
});
afterEach(cleanup);
it("uses one loading→success ID after all selected reads settle and releases ownership", async () => {
  const { result } = renderHook(useReads, { wrapper });
  await waitFor(() =>
    expect(
      result.current.other.isSuccess &&
        result.current.activity.isSuccess &&
        result.current.sessions.isSuccess,
    ).toBe(true),
  );
  await act(async () => {
    await result.current.group.refresh();
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Refreshing…");
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Settings refreshed", { id: "refresh-toast" });
  expect(h.error).not.toHaveBeenCalled();
  for (const query of result.current.client.getQueryCache().getAll())
    expect(isReadFeedbackHeld(query)).toBe(false);
});
it("waits for multiple failed reads, reports one scoped error and does not suppress unrelated reads", async () => {
  const { result } = renderHook(useReads, { wrapper });
  await waitFor(() =>
    expect(
      result.current.other.isSuccess &&
        result.current.activity.isSuccess &&
        result.current.sessions.isSuccess,
    ).toBe(true),
  );
  const first = deferred<[]>(),
    second = deferred<[]>();
  h.api.listActivity.mockImplementationOnce(() => first.promise);
  h.api.listSessions.mockImplementationOnce(() => second.promise);
  let operation: ReturnType<typeof result.current.group.refresh>;
  act(() => {
    operation = result.current.group.refresh();
  });
  await waitFor(() => expect(h.api.listSessions).toHaveBeenCalledTimes(2));
  await act(async () => first.reject(denied("Activity failed")));
  expect(h.error).not.toHaveBeenCalled();
  expect(result.current.group.pending).toBe(true);
  h.api.listConnectors.mockRejectedValueOnce(denied("Unrelated failed"));
  await act(async () => {
    await result.current.other.refetch();
  });
  expect(h.error).toHaveBeenCalledExactlyOnceWith("Unrelated failed");
  expect(
    isReadFeedbackHeld(
      result.current.client
        .getQueryCache()
        .find({ queryKey: key("sessions"), exact: true }) as object,
    ),
  ).toBe(true);
  await act(async () => {
    second.reject(denied("Sessions failed"));
    await operation;
  });
  expect(h.error).toHaveBeenCalledTimes(2);
  expect(h.error).toHaveBeenLastCalledWith("Activity failed", { id: "refresh-toast" });
  expect(h.success).not.toHaveBeenCalled();
  for (const query of result.current.client.getQueryCache().getAll())
    expect(isReadFeedbackHeld(query)).toBe(false);
});
it("refcounts exact query objects across overlapping owners and releases each scope only once", async () => {
  const { result } = renderHook(useReads, { wrapper });
  await waitFor(() => expect(result.current.activity.isSuccess).toBe(true));
  const query = result.current.client
    .getQueryCache()
    .find({ queryKey: key("activity"), exact: true });
  if (!query) throw new Error("Expected mounted query");
  const releaseFirst = holdReadFeedback([query, query]),
    releaseSecond = holdReadFeedback([query]);
  expect(isReadFeedbackHeld(query)).toBe(true);
  releaseFirst();
  releaseFirst();
  expect(isReadFeedbackHeld(query)).toBe(true);
  releaseSecond();
  expect(isReadFeedbackHeld(query)).toBe(false);
});
it("locks repeated refresh and suppresses completion after owner change without leaking read scopes", async () => {
  const { result, rerender } = renderHook(useReads, { wrapper });
  await waitFor(() => expect(result.current.activity.isSuccess).toBe(true));
  const first = deferred<[]>();
  h.api.listActivity.mockImplementationOnce(() => first.promise);
  let operation: ReturnType<typeof result.current.single.refresh>;
  act(() => {
    operation = result.current.single.refresh();
  });
  await waitFor(() => expect(h.api.listActivity).toHaveBeenCalledTimes(2));
  await act(async () => {
    await result.current.single.refresh();
  });
  expect(h.loading).toHaveBeenCalledOnce();
  h.owner = "other-owner";
  h.epoch = 2;
  rerender();
  await act(async () => {
    first.reject(denied("Old owner failed"));
    await operation;
  });
  expect(h.dismiss).toHaveBeenCalledWith("refresh-toast");
  expect(h.error).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  for (const query of result.current.client.getQueryCache().getAll())
    expect(isReadFeedbackHeld(query)).toBe(false);
});

it("keeps shared-query ownership until both independently requested refresh scopes settle", async () => {
  const { result } = renderHook(useReads, { wrapper });
  await waitFor(() =>
    expect(result.current.activity.isSuccess && result.current.sessions.isSuccess).toBe(true),
  );
  const activity = deferred<[]>(),
    sessions = deferred<[]>();
  h.api.listActivity.mockImplementationOnce(() => activity.promise);
  h.api.listSessions.mockImplementationOnce(() => sessions.promise);
  h.loading.mockReturnValueOnce("group-toast").mockReturnValueOnce("single-toast");
  let group: ReturnType<typeof result.current.group.refresh>,
    single: ReturnType<typeof result.current.single.refresh>;
  act(() => {
    group = result.current.group.refresh();
    single = result.current.single.refresh();
  });
  await waitFor(() => expect(h.api.listSessions).toHaveBeenCalledTimes(2));
  await act(async () => {
    activity.resolve([]);
    await single;
  });
  expect(h.success).toHaveBeenCalledWith("Activity refreshed", { id: "single-toast" });
  const query = result.current.client
    .getQueryCache()
    .find({ queryKey: key("activity"), exact: true });
  if (!query) throw new Error("Missing mounted activity query");
  expect(isReadFeedbackHeld(query)).toBe(true);
  await act(async () => {
    sessions.reject(denied("Sessions failed"));
    await group;
  });
  expect(h.error).toHaveBeenCalledExactlyOnceWith("Sessions failed", { id: "group-toast" });
  expect(isReadFeedbackHeld(query)).toBe(false);
  h.api.listActivity.mockRejectedValueOnce(denied("Later background read failed"));
  await act(async () => {
    await result.current.activity.refetch();
  });
  expect(h.error).toHaveBeenLastCalledWith("Later background read failed");
});

it("treats a settled refetch error result as failure rather than confirming an empty success", async () => {
  const { result } = renderHook(
    () => {
      const resource = useSettingsResource("activity", (api) => api.listActivity(100));
      return {
        resource,
        refresh: useSettingsRefresh(
          [key("activity")],
          [() => resource.refetch()],
          "Activity refreshed",
        ),
      };
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.resource.isSuccess).toBe(true));
  h.api.listActivity.mockRejectedValueOnce(denied("Read rejected"));
  await act(async () => {
    await result.current.refresh.refresh();
  });
  expect(h.error).toHaveBeenCalledExactlyOnceWith("Read rejected", { id: "refresh-toast" });
  expect(h.success).not.toHaveBeenCalled();
  expect(result.current.resource.data).toEqual([]);
});
