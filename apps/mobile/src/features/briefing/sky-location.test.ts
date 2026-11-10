import { afterEach, expect, it, vi } from "vitest";
import { readSkyLocation } from "./sky-location";

const h = vi.hoisted(() => ({ get: vi.fn(), request: vi.fn(), watch: vi.fn(), remove: vi.fn() }));
vi.mock("expo-location", () => ({
  Accuracy: { Low: 2 },
  getForegroundPermissionsAsync: h.get,
  requestForegroundPermissionsAsync: h.request,
  watchPositionAsync: h.watch,
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});
it("never prompts automatically, including denied location", async () => {
  h.get.mockResolvedValue({ granted: false });
  expect(await readSkyLocation()).toEqual({ granted: false });
  expect(h.request).not.toHaveBeenCalled();
  expect(h.watch).not.toHaveBeenCalled();
});
it("reads coarse coordinates only after consent and removes the short-lived watch", async () => {
  h.request.mockResolvedValue({ granted: true });
  h.watch.mockImplementation(async (_options, callback) => {
    callback({ coords: { latitude: 40.7, longitude: -74 } });
    return { remove: h.remove };
  });
  expect(await readSkyLocation(true)).toEqual({
    granted: true,
    coordinates: { latitude: 40.7, longitude: -74 },
  });
  await Promise.resolve();
  expect(h.remove).toHaveBeenCalledOnce();
  expect(h.watch).toHaveBeenCalledWith(
    expect.objectContaining({ accuracy: 2 }),
    expect.any(Function),
    expect.any(Function),
  );
});
it("times out a missing fix and also cleans up a subscription returned after the deadline", async () => {
  vi.useFakeTimers();
  h.get.mockResolvedValue({ granted: true });
  let finish!: (value: { remove: () => void }) => void;
  h.watch.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const read = readSkyLocation();
  await vi.waitFor(() => expect(h.watch).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(5001);
  expect(await read).toEqual({ granted: true, coordinates: undefined });
  finish({ remove: h.remove });
  await Promise.resolve();
  expect(h.remove).toHaveBeenCalledOnce();
});

it("cancels its location watch when the caller backgrounds or changes owner", async () => {
  h.get.mockResolvedValue({ granted: true });
  h.watch.mockResolvedValue({ remove: h.remove });
  const controller = new AbortController();
  const read = readSkyLocation(false, controller.signal);
  await vi.waitFor(() => expect(h.watch).toHaveBeenCalled());
  controller.abort();
  expect(await read).toEqual({ granted: true, coordinates: undefined });
  expect(h.remove).toHaveBeenCalledOnce();
});

it("does not start location work after cancellation, even when permission resolves late", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await readSkyLocation(false, controller.signal)).toEqual({ granted: false });
  expect(h.get).not.toHaveBeenCalled();
  const pending = new AbortController();
  let finish!: (value: { granted: boolean }) => void;
  h.get.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const read = readSkyLocation(false, pending.signal);
  await vi.waitFor(() => expect(h.get).toHaveBeenCalledOnce());
  pending.abort();
  finish({ granted: true });
  expect(await read).toEqual({ granted: false });
  expect(h.watch).not.toHaveBeenCalled();
});
it.each([
  "callback",
  "promise",
])("returns no coordinates when the location watch fails by %s", async (mode) => {
  h.get.mockResolvedValue({ granted: true });
  h.watch.mockImplementation(async (_options, _position, fail) => {
    if (mode === "promise") throw new Error("provider failed");
    fail("provider failed");
    return { remove: h.remove };
  });
  expect(await readSkyLocation()).toEqual({ granted: true, coordinates: undefined });
  if (mode === "callback") expect(h.remove).toHaveBeenCalledOnce();
});
