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
  it("returns defaults and persisted wallpaper settings", async () => {
    const selectResults = [
      [],
      [
        {
          backgroundColor: "#123456",
          backgroundMode: "custom",
          boardUrl: "https://www.pinterest.com/example/mindset/",
          cornerRadius: 12,
          enabled: true,
          frameSpacing: 24,
          lastAppliedAt: new Date("2026-07-21T08:00:00.000Z"),
          layout: "stack",
          mosaicFit: "fill",
          paddingBottom: 20,
          paddingEnd: 24,
          paddingLinked: false,
          paddingStart: 28,
          paddingTop: 32,
          rotationDegrees: 4,
          tileSize: 72,
        },
      ],
    ];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => selectResults.shift() ?? [],
          }),
        }),
      }),
    } as unknown as Database;
    const service = createPinterestService({ db });

    await expect(service.settings("user-1")).resolves.toMatchObject({
      backgroundColor: "#ffffff",
      boardUrl: null,
      enabled: false,
      layout: "grid",
    });
    await expect(service.settings("user-1")).resolves.toEqual({
      backgroundColor: "#123456",
      backgroundMode: "custom",
      boardUrl: "https://www.pinterest.com/example/mindset/",
      cornerRadius: 12,
      enabled: true,
      frameSpacing: 24,
      lastAppliedAt: "2026-07-21T08:00:00.000Z",
      layout: "stack",
      mosaicFit: "fill",
      paddingBottom: 20,
      paddingEnd: 24,
      paddingLinked: false,
      paddingStart: 28,
      paddingTop: 32,
      rotationDegrees: 4,
      tileSize: 72,
    });
  });

  it("updates, creates, and records wallpaper settings", async () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    const persisted = {
      backgroundColor: "#123456",
      backgroundMode: "custom",
      boardUrl: "https://www.pinterest.com/example/mindset/",
      cornerRadius: 12,
      enabled: true,
      frameSpacing: 24,
      id: "connection-1",
      lastAppliedAt: now,
      layout: "stack",
      mosaicFit: "fill",
      paddingBottom: 20,
      paddingEnd: 24,
      paddingLinked: false,
      paddingStart: 28,
      paddingTop: 32,
      rotationDegrees: 4,
      tileSize: 72,
    };
    const selectResults = [[persisted], []];
    const updatedValues: unknown[] = [];
    const insertedValues: unknown[] = [];
    const update = vi.fn(() => ({
      set: (values: unknown) => {
        updatedValues.push(values);
        return {
          where: () => ({
            returning: async () => [persisted],
          }),
        };
      },
    }));
    const insert = vi.fn(() => ({
      values: (values: unknown) => {
        insertedValues.push(values);
        return { returning: async () => [persisted] };
      },
    }));
    const db = {
      insert,
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => selectResults.shift() ?? [],
          }),
        }),
      }),
      update,
    } as unknown as Database;
    const service = createPinterestService({ db, now: () => now });
    const input = {
      backgroundColor: "#123456",
      backgroundMode: "custom" as const,
      boardUrl: "https://www.pinterest.com/example/mindset/",
      cornerRadius: 12,
      enabled: true,
      frameSpacing: 24,
      layout: "stack" as const,
      mosaicFit: "fill" as const,
      paddingBottom: 20,
      paddingEnd: 24,
      paddingLinked: false,
      paddingStart: 28,
      paddingTop: 32,
      rotationDegrees: 4,
      tileSize: 72,
    };

    await expect(service.updateSettings("user-1", input)).resolves.toMatchObject(input);
    await expect(service.updateSettings("user-2", {})).resolves.toMatchObject({
      backgroundColor: "#123456",
    });
    await service.recordApplied("user-1");

    expect(updatedValues).toContainEqual(expect.objectContaining({ backgroundColor: "#123456" }));
    expect(updatedValues).toContainEqual({ lastAppliedAt: now, updatedAt: now });
    expect(insertedValues).toContainEqual(
      expect.objectContaining({
        backgroundColor: "#ffffff",
        enabled: false,
        userId: "user-2",
      }),
    );
  });

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
      headers: { "user-agent": "ilo wallpaper/1.0" },
      signal: expect.any(AbortSignal),
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

  it("explains missing, invalid, and temporarily unavailable public boards", async () => {
    await expect(
      createPinterestService({ db: databaseWithBoard(null) }).pins("user-1", 4),
    ).rejects.toMatchObject({
      message: "Paste a public Pinterest board URL before refreshing your wallpaper.",
    });
    await expect(
      createPinterestService({
        db: databaseWithBoard("https://example.com/example/mindset/"),
      }).pins("user-1", 4),
    ).rejects.toMatchObject({ message: "Provide the URL of a public Pinterest board." });
    await expect(
      createPinterestService({
        db: databaseWithBoard("https://www.pinterest.com/example/"),
      }).pins("user-1", 4),
    ).rejects.toMatchObject({ message: "Provide the URL of a public Pinterest board." });
    await expect(
      createPinterestService({
        db: databaseWithBoard("https://www.pinterest.com/example/mindset/"),
        fetch: vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })),
      }).pins("user-1", 4),
    ).rejects.toMatchObject({ message: "Pinterest could not load that public board right now." });
  });

  it("preserves original-size Pinterest images", async () => {
    const service = createPinterestService({
      db: databaseWithBoard("https://pinterest.com/example/mindset/"),
      fetch: vi
        .fn()
        .mockResolvedValue(new Response('"https://i.pinimg.com/originals/original.webp"')),
    });

    await expect(service.pins("user-1", 1)).resolves.toEqual([
      {
        id: "https://i.pinimg.com/originals/original.webp:0",
        imageUrl: "https://i.pinimg.com/originals/original.webp",
        title: null,
      },
    ]);
  });

  it("reports a storage failure when settings cannot be returned", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: "connection-1" }],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [],
          }),
        }),
      }),
    } as unknown as Database;

    await expect(createPinterestService({ db }).updateSettings("user-1", {})).rejects.toMatchObject(
      {
        message: "The Pinterest wallpaper settings could not be saved.",
      },
    );
  });

  it("returns a null application timestamp before a wallpaper is first applied", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                backgroundColor: "#ffffff",
                backgroundMode: "white",
                boardUrl: null,
                cornerRadius: 0,
                enabled: false,
                frameSpacing: 16,
                lastAppliedAt: null,
                layout: "grid",
                mosaicFit: "preserve",
                paddingBottom: 16,
                paddingEnd: 16,
                paddingLinked: true,
                paddingStart: 16,
                paddingTop: 16,
                rotationDegrees: 0,
                tileSize: 64,
              },
            ],
          }),
        }),
      }),
    } as unknown as Database;

    await expect(createPinterestService({ db }).settings("user-1")).resolves.toMatchObject({
      lastAppliedAt: null,
    });
  });
});
