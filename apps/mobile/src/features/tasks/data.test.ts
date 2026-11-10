// @vitest-environment jsdom

import { ApiClientError } from "@personal-os/api-client";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { errorMessage, useTaskAction } from "./data";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(() => "toast"),
  invalidateQueries: vi.fn(),
  refetchQueries: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("sonner-native", () => ({ toast: mocks }));
vi.mock("../notifications/events", () => ({ refreshDueAlerts: mocks.refresh }));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    refetchQueries: mocks.refetchQueries,
  }),
  QueryCache: vi.fn(),
  QueryClient: vi.fn(),
  QueryClientProvider: vi.fn(),
  useQuery: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
it("offers Sonner Undo only after acceptance and consumes it once", async () => {
  const undo = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useTaskAction());
  await act(async () => {
    await result.current.run(
      "Completing…",
      async () => 8,
      undefined,
      undefined,
      () => ({ message: "Completed" }),
      undo,
    );
  });
  const options = mocks.success.mock.calls[0][1];
  expect(options.action.label).toBe("Undo");
  await act(async () => {
    options.action.onClick();
    options.action.onClick();
  });
  expect(undo).toHaveBeenCalledExactlyOnceWith(8);
  expect(mocks.success).toHaveBeenLastCalledWith("Action undone", { id: "toast" });
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
  expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);
});
it("reports failed reversals through Sonner without claiming success", async () => {
  const { result } = renderHook(() => useTaskAction());
  await act(async () => {
    await result.current.run(
      "Trashing…",
      async () => 8,
      undefined,
      undefined,
      undefined,
      async () => {
        throw new Error("conflict");
      },
    );
  });
  const options = mocks.success.mock.calls[0][1];
  await act(async () => {
    options.action.onClick();
  });
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(mocks.success).toHaveBeenCalledTimes(1);
});
it("does not offer Undo for an unconfirmed mutation", async () => {
  const { result } = renderHook(() => useTaskAction());
  await act(async () => {
    await result.current.run(
      "Updating…",
      async () => {
        throw new Error("offline");
      },
      undefined,
      undefined,
      undefined,
      vi.fn(),
    );
  });
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith(expect.any(String), { id: "toast" });
});
it("rejects repeated actions while a request is in flight and unlocks after failure", async () => {
  let fail!: (error: Error) => void;
  const request = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const onError = vi.fn();
  const { result } = renderHook(() => useTaskAction());
  let pending!: Promise<boolean>;
  act(() => {
    pending = result.current.run("Saving…", request, undefined, onError);
  });
  expect(result.current.pending).toBe(true);
  await act(async () => {
    expect(await result.current.run("Saving…", request)).toBe(false);
  });
  expect(request).toHaveBeenCalledOnce();
  const failure = new Error("offline");
  await act(async () => {
    fail(failure);
    expect(await pending).toBe(false);
  });
  expect(onError).toHaveBeenCalledWith(failure);
  expect(result.current.pending).toBe(false);
  await act(async () => {
    expect(await result.current.run("Retrying…", async () => "ok")).toBe(true);
  });
  expect(mocks.success).toHaveBeenCalledWith(
    "Saved",
    expect.objectContaining({ action: undefined }),
  );
});
it("distinguishes a confirmed preview warning from a successful mutation", async () => {
  const accepted = vi.fn();
  const { result } = renderHook(() => useTaskAction());
  await act(async () => {
    await result.current.run(
      "Checking…",
      async () => ({ blocked: true }),
      accepted,
      undefined,
      () => ({ message: "Choose how to move the contents", error: true }),
    );
  });
  expect(mocks.error).toHaveBeenCalledWith(
    "Choose how to move the contents",
    expect.objectContaining({ id: "toast" }),
  );
  expect(mocks.success).not.toHaveBeenCalled();
  expect(accepted).toHaveBeenCalledWith({ blocked: true });
});
it("keeps conflict drafts actionable, exposes safe client errors and hides server details", () => {
  expect(
    errorMessage(new ApiClientError({ status: 409, code: "CONFLICT", message: "internal" })),
  ).toContain("your draft is still here");
  expect(
    errorMessage(new ApiClientError({ status: 422, code: "INVALID", message: "Choose a list" })),
  ).toBe("Choose a list");
  expect(
    errorMessage(
      new ApiClientError({ status: 500, code: "ERROR", message: "private server detail" }),
    ),
  ).not.toContain("private server detail");
});
