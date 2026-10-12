import { expect, it, vi } from "vitest";
import { createDesktopReleaseService } from "./desktop-release-service.js";

it("advertises official downloads only for the official API", async () => {
  const read = vi.fn().mockResolvedValue({ status: "not_published", release: null });
  expect(await createDesktopReleaseService("https://self-hosted.example", read)()).toEqual({
    status: "disabled",
    release: null,
  });
  expect(read).not.toHaveBeenCalled();
  expect(await createDesktopReleaseService("https://nohmi-api.coopersully.me/", read)()).toEqual({
    status: "not_published",
    release: null,
  });
  expect(read).toHaveBeenCalledOnce();
});

it("sends release failures through the API structured logger", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 429 }));
  const log = vi.fn();
  try {
    const read = createDesktopReleaseService("https://nohmi-api.coopersully.me", undefined, log);
    expect(await read()).toEqual({ status: "unavailable", release: null });
    await read();
    expect(log).toHaveBeenCalledExactlyOnceWith({
      event: "desktop_release_unavailable",
      code: "http",
      status: 429,
      durationMs: expect.any(Number),
      method: "GET",
      path: "/v1/desktop-release",
      requestId: expect.any(String),
    });
  } finally {
    fetcher.mockRestore();
  }
});
