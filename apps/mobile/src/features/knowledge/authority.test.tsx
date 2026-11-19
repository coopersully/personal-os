// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useMemoryResource } from "./authority";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("sonner-native", () => ({ toast: {} }));

it("a_refresh_replaced_by_a_newer_read_fails_silently", async () => {
  let fail!: (error: Error) => void;
  const load = vi
    .fn<(signal: AbortSignal) => Promise<string | undefined>>()
    .mockResolvedValueOnce("first")
    .mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
    .mockResolvedValueOnce("newer");
  const { result } = renderHook(() => useMemoryResource(load));
  await act(async () => {});
  expect(result.current.value).toBe("first");
  let stale!: Promise<unknown>;
  act(() => {
    stale = result.current.refresh();
  });
  await act(async () => {
    await result.current.refresh();
  });
  fail(new Error("offline"));
  await expect(stale).resolves.toBeUndefined();
  expect(result.current.value).toBe("newer");
  // A refresh that is still current reports its failure to the caller.
  load.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await expect(result.current.refresh()).rejects.toThrow("offline");
  });
  expect(result.current.value).toBe("newer");
});

it("a_refresh_that_replaces_the_first_load_and_fails_offers_a_retry", async () => {
  let fail!: (error: Error) => void;
  const load = vi
    .fn<(signal: AbortSignal) => Promise<string | undefined>>()
    .mockReturnValueOnce(new Promise(() => {}))
    .mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
  const { result } = renderHook(() => useMemoryResource(load));
  expect(result.current.loading).toBe(true);
  let refreshed!: Promise<unknown>;
  act(() => {
    refreshed = result.current.refresh();
  });
  await act(async () => {
    fail(new Error("offline"));
    await expect(refreshed).rejects.toThrow("offline");
  });
  // Nothing was ever shown, so the failure leaves Retry rather than a spinner.
  expect(result.current).toMatchObject({ loading: false, failed: true });
});
