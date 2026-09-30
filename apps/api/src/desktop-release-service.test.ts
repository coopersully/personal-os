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
