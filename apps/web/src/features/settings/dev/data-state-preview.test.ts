// @vitest-environment jsdom
import { settingsDataPreviewFetch, settingsPreviewMode } from "./data-state-preview";
const realFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", realFetch);
  realFetch.mockResolvedValue(Response.json({ real: true }));
});
afterEach(() => {
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("limits state previews to development loopback settings", () => {
  expect(settingsPreviewMode(new URL("https://nohmi.app/settings?dataState=error"))).toBeNull();
  expect(settingsPreviewMode(new URL("http://localhost/today?dataState=empty"))).toBeNull();
  expect(settingsPreviewMode(new URL("http://localhost/settings?dataState=other"))).toBeNull();
  expect(settingsPreviewMode(new URL("http://localhost/settings?dataState=empty"))).toBe("empty");
});
it("simulates only allowlisted reads and never forwards a mutation during preview", async () => {
  history.replaceState(null, "", "/settings?dataState=empty");
  const origin = location.origin;
  expect(await (await settingsDataPreviewFetch(`${origin}/v1/goals`)).json()).toEqual({
    goals: [],
  });
  expect(
    await (await settingsDataPreviewFetch(`${origin}/v1/goals/123`, { method: "DELETE" })).status,
  ).toBe(409);
  expect(realFetch).not.toHaveBeenCalled();
  await settingsDataPreviewFetch(`${origin}/v1/auth/me`);
  await settingsDataPreviewFetch("https://example.com/v1/goals");
  expect(realFetch).toHaveBeenCalledTimes(2);
  history.replaceState(null, "", "/settings?dataState=error");
  expect((await settingsDataPreviewFetch(`${origin}/v1/goals`)).status).toBe(503);
  history.replaceState(null, "", "/settings");
  expect(await (await settingsDataPreviewFetch(`${origin}/v1/goals`)).json()).toEqual({
    real: true,
  });
});
it("hides only the ritual overlay in preview and preserves authoritative auth failures", async () => {
  history.replaceState(null, "", "/settings?dataState=error");
  realFetch.mockResolvedValueOnce(Response.json({ current: { id: "real" }, syncStatus: "saved", serverNow: "now" }));
  expect(await (await settingsDataPreviewFetch(`${location.origin}/v1/rituals/current`)).json()).toEqual({ current: null, upcoming: [], syncStatus: "saved", serverNow: "now" });
  realFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
  expect((await settingsDataPreviewFetch(`${location.origin}/v1/rituals/current`)).status).toBe(401);
});
