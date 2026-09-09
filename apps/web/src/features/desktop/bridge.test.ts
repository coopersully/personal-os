// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { desktopFetch, resetDesktopConnection } from "./bridge.js";

beforeEach(() => {
  invoke.mockReset();
  resetDesktopConnection();
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
    await expect(
      desktopFetch("https://api.test/v1/me", { signal: AbortSignal.abort() }),
    ).rejects.toThrow("Request cancelled");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
