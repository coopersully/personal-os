// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  navigate: vi.fn(),
  error: vi.fn(),
  desktop: vi.fn(),
  reset: vi.fn(),
  assign: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("./bridge.js", () => ({
  isDesktop: mocks.desktop,
  resetDesktopConnection: mocks.reset,
}));

import { useDesktopActions } from "./events.js";

type Handler = (event: { payload: { serverChanged?: boolean } }) => void;
let handlers: Map<string, Handler>;
let stops: Array<ReturnType<typeof vi.fn>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function mount(capture = vi.fn(), strict = false) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    useDesktopActions(capture);
    return null;
  }
  const content = (
    <QueryClientProvider client={cache}>
      <Harness />
    </QueryClientProvider>
  );
  return {
    ...render(strict ? <StrictMode>{content}</StrictMode> : content),
    cache,
    capture,
  };
}
async function ready() {
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("desktop_take_action"));
}
async function emit(name: string, payload = {}) {
  await act(async () => {
    handlers.get(name)?.({ payload });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  handlers = new Map();
  stops = [];
  mocks.desktop.mockReturnValue(true);
  mocks.invoke.mockResolvedValue(null);
  mocks.listen.mockImplementation(async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    const stop = vi.fn();
    stops.push(stop);
    return stop;
  });
  const original = window;
  vi.stubGlobal(
    "window",
    new Proxy(original, {
      get(target, property) {
        if (property === "location") return { assign: mocks.assign };
        return Reflect.get(target, property, target);
      },
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("desktop action lifecycle", () => {
  it("does not subscribe or consume native actions in a browser", () => {
    mocks.desktop.mockReturnValue(false);
    mount();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("consumes an action queued before renderer mount", async () => {
    mocks.invoke.mockResolvedValueOnce({ action: "open", path: "/mail?thread=thread-1" });
    mount();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/mail?thread=thread-1"));
    expect(mocks.listen).toHaveBeenCalledTimes(4);
  });

  it("preserves a queued capture through StrictMode effect cleanup and remount", async () => {
    mocks.invoke.mockResolvedValueOnce({ action: "capture", kind: "task" });
    const { capture } = mount(vi.fn(), true);
    await waitFor(() => expect(capture).toHaveBeenCalledWith("task"));
    expect(capture).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(stops.filter((stop) => stop.mock.calls.length === 1)).toHaveLength(4);
  });

  it("handles native capture, errors, missing payloads and unsupported actions", async () => {
    const { capture } = mount();
    await ready();
    for (const kind of ["task", "reminder", "event"]) {
      mocks.invoke.mockResolvedValueOnce({ action: "capture", kind });
      await emit("desktop-action");
      expect(capture).toHaveBeenLastCalledWith(kind);
    }
    mocks.invoke.mockResolvedValueOnce({ action: "error", message: "Sign in again" });
    await emit("desktop-action");
    expect(mocks.error).toHaveBeenLastCalledWith("Sign in again");
    mocks.invoke.mockResolvedValueOnce({ action: "error" });
    await emit("desktop-action");
    expect(mocks.error).toHaveBeenLastCalledWith("The desktop action failed.");
    for (const payload of [
      null,
      { action: "open" },
      { action: "capture" },
      { action: "unknown" },
    ]) {
      mocks.invoke.mockResolvedValueOnce(payload);
      await emit("desktop-action");
    }
    expect(capture).toHaveBeenCalledTimes(3);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("refreshes material and clears private cache only on server/session changes", async () => {
    const { cache } = mount();
    await ready();
    cache.setQueryData(["private"], { title: "Private task" });
    await emit("desktop-material-changed");
    expect(cache.getQueryState(["private"])?.isInvalidated).toBe(true);
    await emit("desktop-settings-changed", { serverChanged: false });
    expect(cache.getQueryData(["private"])).toBeDefined();
    expect(mocks.assign).not.toHaveBeenCalled();
    await emit("desktop-settings-changed", { serverChanged: true });
    expect(cache.getQueryData(["private"])).toBeUndefined();
    expect(mocks.reset).toHaveBeenCalledOnce();
    expect(mocks.assign).not.toHaveBeenCalled();
    cache.setQueryData(["private"], "another session");
    await emit("desktop-session-invalidated");
    expect(cache.getQueryData(["private"])).toBeUndefined();
  });

  it("stops all listeners on unmount and ignores late action responses", async () => {
    const response = deferred<{ action: string; path: string }>();
    mocks.invoke.mockReturnValueOnce(response.promise);
    const { unmount } = mount();
    await ready();
    unmount();
    expect(stops).toHaveLength(4);
    for (const stop of stops) expect(stop).toHaveBeenCalledOnce();
    await act(async () => response.resolve({ action: "open", path: "/finances" }));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("cleans registrations that finish after unmount without consuming an action", async () => {
    const registration = deferred<() => void>();
    const stop = vi.fn();
    mocks.listen.mockReturnValue(registration.promise);
    const { unmount } = mount();
    unmount();
    await act(async () => registration.resolve(stop));
    expect(stop).toHaveBeenCalledTimes(4);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("ignores callbacks already queued when listeners are removed", async () => {
    const { cache, unmount } = mount();
    await ready();
    unmount();
    cache.setQueryData(["private"], "unmounted cache");
    mocks.invoke.mockClear();
    for (const name of handlers.keys()) await emit(name, { serverChanged: true });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(cache.getQueryData(["private"])).toBe("unmounted cache");
    expect(cache.getQueryState(["private"])?.isInvalidated).toBe(false);
  });

  it("releases successful registrations if a sibling subscription fails", async () => {
    mocks.listen.mockRejectedValueOnce(new Error("IPC unavailable"));
    mount();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(stops).toHaveLength(3);
    for (const stop of stops) expect(stop).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("reports an action fetch failure and keeps listening for a later action", async () => {
    mount();
    await ready();
    mocks.invoke.mockRejectedValueOnce(new Error("IPC unavailable"));
    await emit("desktop-action");
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    mocks.invoke.mockResolvedValueOnce({ action: "open", path: "/tasks" });
    await emit("desktop-action");
    expect(mocks.navigate).toHaveBeenCalledWith("/tasks");
  });
});
