// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { useFeedbackMutation } from "./use-feedback-mutation.js";

vi.mock("sonner", () => ({ toast: { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() } }));
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: 2 } } })}>
      {children}
    </QueryClientProvider>
  );
}
describe("useFeedbackMutation", () => {
  it("announces a safe failure once and clears feedback on retry and success", async () => {
    vi.clearAllMocks();
    const mutationFn = vi.fn().mockRejectedValueOnce(new Error("secret")).mockResolvedValue("ok");
    const { result } = renderHook(
      () =>
        useFeedbackMutation({
          mutationFn,
          retry: false,
          feedback: {
            action: "refresh wallpaper",
            success: "Wallpaper refreshed.",
            safeToRetry: true,
          },
        }),
      { wrapper },
    );
    act(() => result.current.mutate(undefined));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(result.current.feedback?.persistent).toBe(false);
    act(() => result.current.mutate(undefined));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.feedback).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Wallpaper refreshed.", expect.anything());
    const successId = vi.mocked(toast.success).mock.calls[0]?.[1]?.id;
    const failureId = vi.mocked(toast.error).mock.calls[0]?.[1]?.id;
    expect(successId).not.toBe(failureId);
    expect(toast.dismiss).toHaveBeenCalledWith(failureId);
    expect(toast.dismiss).not.toHaveBeenCalledWith(successId);
  });
  it("does not toast or automatically retry an uncertain form write", async () => {
    vi.clearAllMocks();
    const mutationFn = vi.fn().mockRejectedValue(new Error("secret"));
    const { result } = renderHook(
      () => useFeedbackMutation({ mutationFn, feedback: { action: "create event", form: true } }),
      { wrapper },
    );
    act(() => result.current.mutate(undefined));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mutationFn).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.feedback?.kind).toBe("uncertain");
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.feedback).toBeNull());
  });
  it("keeps a confirmed write successful when refreshing its view fails", async () => {
    vi.clearAllMocks();
    const { result } = renderHook(
      () =>
        useFeedbackMutation({
          mutationFn: async () => "saved",
          onSuccess: async () => {
            throw new Error("cache refresh failed");
          },
          feedback: { action: "save profile" },
        }),
      { wrapper },
    );
    act(() => result.current.mutate(undefined));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.feedback).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("change was saved"),
      expect.anything(),
    );
  });
  it("preserves mutation variables and optimistic context for caller error recovery", async () => {
    const failure = new Error("failed");
    const onError = vi.fn();
    const { result } = renderHook(
      () =>
        useFeedbackMutation({
          mutationFn: async (_name: string) => {
            throw failure;
          },
          onMutate: (name: string) => ({ previous: name }),
          onError,
          feedback: { action: "rename calendar" },
        }),
      { wrapper },
    );
    act(() => result.current.mutate("My calendar"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onError).toHaveBeenCalledWith(
      failure,
      "My calendar",
      { previous: "My calendar" },
      expect.anything(),
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

it("keeps a newer failure visible when an older save completes", async () => {
  vi.clearAllMocks();
  const older = deferred<string>();
  const newer = deferred<string>();
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const onSettled = vi.fn();
  const { result } = renderHook(
    () =>
      useFeedbackMutation({
        mutationFn: (name: string) => (name === "older" ? older.promise : newer.promise),
        onMutate: (name: string) => ({ previous: name }),
        onSuccess,
        onError,
        onSettled,
        feedback: { action: "save wallpaper settings", safeToRetry: true },
        retry: false,
      }),
    { wrapper },
  );
  act(() => result.current.mutate("older"));
  act(() => result.current.mutate("newer"));
  const failure = new Error("newer request failed");
  await act(async () => newer.reject(failure));
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  const failureId = vi.mocked(toast.error).mock.calls[0]?.[1]?.id;
  await act(async () => older.resolve("saved"));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  expect(toast.dismiss).not.toHaveBeenCalledWith(failureId);
  expect(onError).toHaveBeenCalledWith(failure, "newer", { previous: "newer" }, expect.anything());
  expect(onSuccess).toHaveBeenCalledWith(
    "saved",
    "older",
    { previous: "older" },
    expect.anything(),
  );
  expect(onSettled).toHaveBeenCalledWith(
    "saved",
    null,
    "older",
    { previous: "older" },
    expect.anything(),
  );
  expect(onSettled).toHaveBeenCalledWith(
    undefined,
    failure,
    "newer",
    { previous: "newer" },
    expect.anything(),
  );
  expect(result.current.context).toEqual({ previous: "newer" });
});

it("does not publish an obsolete failure after a newer success", async () => {
  vi.clearAllMocks();
  const older = deferred<string>();
  const onError = vi.fn();
  const { result } = renderHook(
    () =>
      useFeedbackMutation({
        mutationFn: (name: string) => (name === "older" ? older.promise : Promise.resolve("saved")),
        onError,
        feedback: { action: "save settings", safeToRetry: true, success: "Settings saved." },
        retry: false,
      }),
    { wrapper },
  );
  act(() => result.current.mutate("older"));
  act(() => result.current.mutate("newer"));
  await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
  await act(async () => older.reject(new Error("old failure")));
  await waitFor(() => expect(onError).toHaveBeenCalledOnce());
  expect(toast.error).not.toHaveBeenCalled();
  expect(result.current.isSuccess).toBe(true);
});

it("preserves per-call callbacks and context for mutateAsync", async () => {
  const onSuccess = vi.fn();
  const onSettled = vi.fn();
  const { result } = renderHook(
    () =>
      useFeedbackMutation({
        mutationFn: async (name: string) => name.toUpperCase(),
        onMutate: (name: string) => ({ previous: name }),
        feedback: { action: "save settings" },
      }),
    { wrapper },
  );
  await act(async () => {
    expect(await result.current.mutateAsync("saved", { onSuccess, onSettled })).toBe("SAVED");
  });
  expect(onSuccess).toHaveBeenCalledWith(
    "SAVED",
    "saved",
    { previous: "saved" },
    expect.anything(),
  );
  expect(onSettled).toHaveBeenCalledWith(
    "SAVED",
    null,
    "saved",
    { previous: "saved" },
    expect.anything(),
  );
});

it("retains the original preparation error without executing or claiming an uncertain write", async () => {
  vi.clearAllMocks();
  const failure = new Error("optimistic preparation failed");
  const mutationFn = vi.fn();
  const onError = vi.fn();
  const onSettled = vi.fn();
  const callError = vi.fn();
  const { result } = renderHook(
    () =>
      useFeedbackMutation({
        mutationFn,
        onMutate: async () => {
          throw failure;
        },
        onError,
        onSettled,
        feedback: { action: "create event", form: true },
      }),
    { wrapper },
  );
  act(() => result.current.mutate(undefined, { onError: callError }));
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(mutationFn).not.toHaveBeenCalled();
  expect(result.current.error).toBe(failure);
  expect(result.current.context).toBeUndefined();
  expect(result.current.feedback?.kind).toBe("unsaved");
  expect(onError).toHaveBeenCalledWith(failure, undefined, undefined, expect.anything());
  expect(callError).toHaveBeenCalledWith(failure, undefined, undefined, expect.anything());
  expect(onSettled).toHaveBeenCalledWith(
    undefined,
    failure,
    undefined,
    undefined,
    expect.anything(),
  );
  expect(toast.error).not.toHaveBeenCalled();
});
