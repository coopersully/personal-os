// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useTaskAction } from "./data";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(() => "toast"),
  invalidateQueries: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("sonner-native", () => ({ toast: mocks }));
vi.mock("../notifications/events", () => ({ refreshDueAlerts: mocks.refresh }));
vi.mock("../auth/context", () => ({ useAuth: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
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
