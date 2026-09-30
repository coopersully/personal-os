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
