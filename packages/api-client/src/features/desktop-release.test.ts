import { expect, it, vi } from "vitest";
import { createDesktopReleaseApiClient } from "./desktop-release.js";

it("reads public release metadata", async () => {
  const result = { status: "not_published", release: null };
  const request = vi.fn().mockResolvedValue(result);
  expect(await createDesktopReleaseApiClient(request).getDesktopRelease()).toBe(result);
  expect(request).toHaveBeenCalledWith("/v1/desktop-release");
});
