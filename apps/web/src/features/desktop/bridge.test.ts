// @vitest-environment jsdom
import { transferableAbortController } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { desktopFetch, isDesktop, resetDesktopConnection } from "./bridge.js";

beforeEach(() => {
  invoke.mockReset();
  resetDesktopConnection();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("desktop API transport", () => {
  it("uses selected native origin and only sends the API path", async () => {
    invoke
      .mockResolvedValueOnce({ settings: { serverUrl: "https://custom.test" } })
      .mockResolvedValueOnce({ status: 200, body: '{"ok":true}' });
    const response = await desktopFetch("https://hosted.test/v1/tasks?q=a", {
      headers: { authorization: "Session must-not-cross-bridge" },
    });
    expect(await response.json()).toEqual({ ok: true });
    expect(invoke).toHaveBeenLastCalledWith("desktop_request", {
      request: {
        serverUrl: "https://custom.test",
        path: "/v1/tasks?q=a",
        method: "GET",
        body: null,
      },
    });
  });
  it("preserves the expected owner without forwarding arbitrary credentials", async () => {
    invoke
      .mockResolvedValueOnce({ settings: { serverUrl: "https://custom.test" } })
      .mockResolvedValueOnce({ status: 200, body: "{}" });
    await desktopFetch("https://api.test/v1/active-reminders/preferences", {
      headers: { "X-Nohmi-Account": "account-a", authorization: "Session never-forward" },
    });
    expect(invoke).toHaveBeenLastCalledWith("desktop_request", {
      request: {
        serverUrl: "https://custom.test",
        path: "/v1/active-reminders/preferences",
        method: "GET",
        body: null,
        expectedAccountId: "account-a",
      },
    });
  });
  it("reloads origin after settings change and supports empty responses", async () => {
    invoke
      .mockResolvedValueOnce({ settings: { serverUrl: "https://first.test" } })
      .mockResolvedValueOnce({ status: 204, body: "" });
    expect((await desktopFetch("https://api.test/v1/auth/logout", { method: "POST" })).status).toBe(
      204,
    );
    resetDesktopConnection();
    invoke
      .mockResolvedValueOnce({ settings: { serverUrl: "https://second.test" } })
      .mockResolvedValueOnce({ status: 401, body: '{"error":{"code":"unauthorized"}}' });
    const response = await desktopFetch("https://api.test/v1/me");
    expect(response.status).toBe(401);
    expect(invoke).toHaveBeenLastCalledWith("desktop_request", {
      request: { serverUrl: "https://second.test", path: "/v1/me", method: "GET", body: null },
    });
  });
  it("retries failed configuration and honors cancellation", async () => {
    invoke.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(desktopFetch("https://api.test/v1/me")).rejects.toThrow("Unavailable");
    invoke.mockResolvedValueOnce({ settings: { serverUrl: "https://api.test" } });
    // Request is Node's native Fetch implementation in jsdom. Its signal fixture
    // must come from that same realm, rather than jsdom's DOM AbortController.
    const cancelled = transferableAbortController();
    cancelled.abort();
    await expect(
      desktopFetch("https://api.test/v1/me", { signal: cancelled.signal }),
    ).rejects.toThrow("Request cancelled");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("recognizes the native runtime and forwards Request bodies", async () => {
    expect(isDesktop()).toBe(false);
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    expect(isDesktop()).toBe(true);
    invoke
      .mockResolvedValueOnce({ settings: { serverUrl: "https://api.test" } })
      .mockResolvedValueOnce({ status: 200, body: '{"ok":true}' });
    await desktopFetch(
      new Request("https://api.test/v1/tasks", { body: '{"title":"Test"}', method: "POST" }),
    );
    expect(invoke).toHaveBeenLastCalledWith("desktop_request", {
      request: {
        serverUrl: "https://api.test",
        path: "/v1/tasks",
        method: "POST",
        body: '{"title":"Test"}',
      },
    });
    invoke.mockResolvedValueOnce({ status: 200, body: '{"ok":true}' });
    await desktopFetch(
      new Request("https://api.test/v1/tasks", { body: '{"title":"Original"}', method: "POST" }),
      { body: '{"title":"Override"}', method: "PUT" },
    );
    expect(invoke).toHaveBeenLastCalledWith("desktop_request", {
      request: {
        serverUrl: "https://api.test",
        path: "/v1/tasks",
        method: "PUT",
        body: '{"title":"Override"}',
      },
    });
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });
  it("honors cancellation while a native request is in flight", async () => {
    const controller = transferableAbortController();
    const NativeRequest = Request;
    const requests: Request[] = [];
    class ObservedRequest extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init);
        requests.push(this);
      }
    }
    vi.stubGlobal("Request", ObservedRequest);
    let resolveRequest: ((value: { status: number; body: string }) => void) | undefined;
    const nativeRequest = new Promise<{ status: number; body: string }>((resolve) => {
      resolveRequest = resolve;
    });
    invoke
      .mockResolvedValueOnce({ settings: { serverUrl: "https://api.test" } })
      .mockReturnValueOnce(nativeRequest);
    const response = desktopFetch("https://api.test/v1/tasks", { signal: controller.signal });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    // Request follows the caller's signal; observe the bridge's actual signal
    // rather than assuming the input signal and its followed signal are identical.
    const requestSignal = requests[0]?.signal;
    expect(requestSignal).toBeDefined();
    expect(requestSignal).not.toBe(controller.signal);
    const removeAbortListener = vi.spyOn(requestSignal as AbortSignal, "removeEventListener");
    controller.abort();
    await expect(response).rejects.toThrow("Request cancelled");
    expect(removeAbortListener).toHaveBeenCalledWith("abort", expect.any(Function));
    resolveRequest?.({ status: 200, body: '{"ok":true}' });
  });
  it("honors cancellation raised while dispatching the native request", async () => {
    const controller = transferableAbortController();
    invoke
      .mockResolvedValueOnce({ settings: { serverUrl: "https://api.test" } })
      .mockImplementationOnce(() => {
        controller.abort();
        return new Promise(() => undefined);
      });

    await expect(
      desktopFetch("https://api.test/v1/tasks", { signal: controller.signal }),
    ).rejects.toThrow("Request cancelled");
  });
});
