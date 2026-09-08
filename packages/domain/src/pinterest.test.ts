import { describe, expect, it } from "vitest";
import {
  pinterestBoardUrlSchema,
  pinterestPinsQuerySchema,
  updatePinterestWallpaperSettingsInputSchema,
} from "./pinterest.js";

describe("Pinterest wallpaper inputs", () => {
  it("accepts real ISO planning dates and rejects impossible or ambiguous dates", () => {
    expect(pinterestPinsQuerySchema.parse({})).toEqual({ limit: 12 });
    expect(pinterestPinsQuerySchema.parse({ limit: "4", planningDate: "2024-02-29" })).toEqual({
      limit: 4,
      planningDate: "2024-02-29",
    });
    for (const planningDate of [
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
      "2026-9-8",
      "2026-09-08T00:00:00Z",
    ]) {
      expect(pinterestPinsQuerySchema.safeParse({ planningDate }).success).toBe(false);
    }
  });
  it("requires a supported HTTPS board origin without credentials or alternate ports", () => {
    expect(pinterestBoardUrlSchema.safeParse("https://uk.pinterest.com/a/board/").success).toBe(
      true,
    );
    expect(updatePinterestWallpaperSettingsInputSchema.parse({ boardUrl: null })).toEqual({
      boardUrl: null,
    });
    for (const boardUrl of [
      "not a url",
      "http://pinterest.com/a/b/",
      "https://pinterest.com:8443/a/b/",
      "https://x@pinterest.com/a/b/",
      "https://pinterest.com.evil.test/a/b/",
      "https://pinterest.com/a/",
    ]) {
      expect(pinterestBoardUrlSchema.safeParse(boardUrl).success).toBe(false);
    }
  });
});
