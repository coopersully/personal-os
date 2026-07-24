import type { Database } from "@personal-os/database";
import { describe, expect, it, vi } from "vitest";
import { createPinterestService } from "./pinterest-service.js";

function databaseWithBoard(boardUrl: string | null): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ boardUrl }],
        }),
      }),
    }),
  } as unknown as Database;
}

describe("Pinterest wallpaper service", () => {
  it("sanitizes a public board URL, upgrades image size, and repeats the available Pins", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          ['"https://i.pinimg.com/236x/first.jpg"', '"https://i.pinimg.com/474x/second.png"'].join(
            "",
          ),
        ),
      );
    const service = createPinterestService({
      db: databaseWithBoard("https://www.pinterest.com/example/mindset/?source=profile#saved"),
      fetch,
      now: () => new Date("2026-07-21T12:00:00.000Z"),
    });

    const pins = await service.pins("user-1", 12);

    expect(fetch).toHaveBeenCalledWith("https://www.pinterest.com/example/mindset/", {
      headers: { "user-agent": "Personal OS wallpaper/1.0" },
    });
    expect(pins).toHaveLength(12);
    expect(new Set(pins.map((pin) => pin.id)).size).toBe(12);
    expect(new Set(pins.map((pin) => pin.imageUrl))).toEqual(
      new Set(["https://i.pinimg.com/736x/first.jpg", "https://i.pinimg.com/736x/second.png"]),
    );
  });

  it("rejects an empty public board response", async () => {
    const service = createPinterestService({
      db: databaseWithBoard("https://www.pinterest.com/example/mindset/"),
      fetch: vi.fn().mockResolvedValue(new Response("No image data")),
    });

    await expect(service.pins("user-1", 4)).rejects.toMatchObject({
      message: "Pinterest did not expose any images from that public board.",
    });
  });
});
