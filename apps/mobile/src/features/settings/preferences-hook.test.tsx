// @vitest-environment jsdom

import type { WorkspaceSettings } from "@personal-os/domain";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useWorkspacePreferenceQueue } from "./preferences-hook";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  epoch: 1,
  write: vi.fn(),
  session: {} as {
    epoch: () => number;
    api: () => { updateWorkspaceSettings: ReturnType<typeof vi.fn> };
  },
}));
vi.mock("../auth/context", () => ({ useAuth: () => ({ session: h.session }) }));
const initial = {
  workspace: "finances",
  revision: 8,
  preferences: { financeSpendingIncludePending: true, spendAccountIds: null },
} as WorkspaceSettings<"finances">;
beforeEach(() => {
  h.epoch = 1;
  h.write = vi.fn();
  h.session = { epoch: () => h.epoch, api: () => ({ updateWorkspaceSettings: h.write }) };
});
it("shares sequential revisions across sibling editors without adopting unseen remote revisions", async () => {
  h.write.mockImplementation(async (_workspace, input) => ({
    ...initial,
    revision: input.expectedRevision + 1,
    preferences: { ...initial.preferences, ...input.preferences },
  }));
  const first = renderHook(() => useWorkspacePreferenceQueue(initial));
  const second = renderHook(() => useWorkspacePreferenceQueue({ ...initial, revision: 42 }));
  expect(first.result.current).toBe(second.result.current);
  await first.result.current.save({ financeSpendingIncludePending: false });
  await second.result.current.save({ spendAccountIds: [] });
  expect(h.write.mock.calls.map((call) => call[1].expectedRevision)).toEqual([8, 9]);
  expect(h.write.mock.calls[1]?.[1].preferences).toEqual({ spendAccountIds: [] });
});
it("blocks sibling writes after conflict until explicitly reviewed recovery", async () => {
  h.write
    .mockRejectedValueOnce(new Error("Conflict"))
    .mockResolvedValue({ ...initial, revision: 13 });
  const first = renderHook(() => useWorkspacePreferenceQueue(initial));
  const second = renderHook(() => useWorkspacePreferenceQueue(initial));
  await expect(first.result.current.save({ spendAccountIds: [] })).rejects.toThrow("Conflict");
  await expect(second.result.current.save({ spendAccountIds: null })).rejects.toThrow(
    "Refresh and review",
  );
  expect(h.write).toHaveBeenCalledTimes(1);
  second.result.current.recover({ ...initial, revision: 12 });
  await first.result.current.save({ spendAccountIds: [] });
  expect(h.write.mock.calls[1]?.[1].expectedRevision).toBe(12);
});
it("rejects old queues before transport after an authentication epoch change", async () => {
  const { result } = renderHook(() => useWorkspacePreferenceQueue(initial));
  h.epoch = 2;
  await expect(result.current.save({ spendAccountIds: [] })).rejects.toThrow("session changed");
  expect(h.write).not.toHaveBeenCalled();
});
it("rejects a late response after an authentication epoch change", async () => {
  let finish!: (value: WorkspaceSettings<"finances">) => void;
  h.write.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = renderHook(() => useWorkspacePreferenceQueue(initial));
  const operation = result.current.save({ spendAccountIds: [] });
  await Promise.resolve();
  h.epoch = 2;
  finish({ ...initial, revision: 9 });
  await expect(operation).rejects.toThrow("session changed");
  expect(result.current.current.revision).toBe(8);
});

it("adopts a newly reviewed server revision only after earlier editors close", async () => {
  h.write.mockImplementation(async (_workspace, input) => ({
    ...initial,
    revision: input.expectedRevision + 1,
  }));
  const first = renderHook(() => useWorkspacePreferenceQueue(initial));
  await first.result.current.save({ spendAccountIds: [] });
  first.unmount();
  const reopened = renderHook(() => useWorkspacePreferenceQueue({ ...initial, revision: 15 }));
  await reopened.result.current.save({ spendAccountIds: null });
  expect(h.write.mock.calls[1]?.[1].expectedRevision).toBe(15);
});
it("surfaces an uncertain blocked queue on reopen until explicit reviewed recovery", async () => {
  h.write.mockRejectedValueOnce(new Error("Uncertain"));
  const first = renderHook(() => useWorkspacePreferenceQueue(initial));
  await expect(first.result.current.save({ spendAccountIds: [] })).rejects.toThrow();
  first.unmount();
  const reopened = renderHook(() => useWorkspacePreferenceQueue({ ...initial, revision: 15 }));
  expect(reopened.result.current.blocked).toBe(true);
  await expect(reopened.result.current.save({ spendAccountIds: null })).rejects.toThrow(
    "Refresh and review",
  );
  expect(h.write).toHaveBeenCalledTimes(1);
});
it("does not replace an in-flight queue when an editor reopens", async () => {
  let finish!: (value: WorkspaceSettings<"finances">) => void;
  h.write.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const first = renderHook(() => useWorkspacePreferenceQueue(initial));
  const operation = first.result.current.save({ spendAccountIds: [] });
  await Promise.resolve();
  first.unmount();
  const reopened = renderHook(() => useWorkspacePreferenceQueue({ ...initial, revision: 15 }));
  expect(reopened.result.current.current.revision).toBe(8);
  await act(async () => {
    finish({ ...initial, revision: 9 });
    await operation;
  });
  await waitFor(() => expect(reopened.result.current.current.revision).toBe(15));
});

it("rejects reviewed recovery that became stale while loading", async () => {
  h.write.mockResolvedValue({ ...initial, revision: 9 });
  const { result } = renderHook(() => useWorkspacePreferenceQueue(initial));
  await act(async () => {
    await result.current.save({ spendAccountIds: [] });
  });
  expect(() => result.current.recover(initial)).toThrow("changed while reloading");
  expect(result.current.current.revision).toBe(9);
});
