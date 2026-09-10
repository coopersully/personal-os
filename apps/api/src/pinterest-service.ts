import { fetchPinterestBoardPins, PinterestBoardError } from "@personal-os/connectors";
import { type Database, pinterestConnections } from "@personal-os/database";
import type {
  PinterestPin,
  PinterestWallpaperSettings,
  UpdatePinterestWallpaperSettingsInput,
} from "@personal-os/domain";
import { eq } from "drizzle-orm";
import { AppError } from "./errors.js";

type ServiceOptions = {
  db: Database;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
};

export function createPinterestService({
  db,
  fetch: requestFetch = globalThis.fetch,
  now = () => new Date(),
}: ServiceOptions) {
  async function settings(userId: string): Promise<PinterestWallpaperSettings> {
    const [connection] = await db
      .select()
      .from(pinterestConnections)
      .where(eq(pinterestConnections.userId, userId))
      .limit(1);
    return {
      backgroundColor: connection?.backgroundColor ?? "#ffffff",
      backgroundMode: connection?.backgroundMode ?? "white",
      boardUrl: connection?.boardUrl ?? null,
      cornerRadius: connection?.cornerRadius ?? 0,
      enabled: connection?.enabled ?? false,
      frameSpacing: connection?.frameSpacing ?? 16,
      layout: connection?.layout ?? "grid",
      lastAppliedAt: connection?.lastAppliedAt?.toISOString() ?? null,
      mosaicFit: connection?.mosaicFit ?? "preserve",
      paddingBottom: connection?.paddingBottom ?? 16,
      paddingEnd: connection?.paddingEnd ?? 16,
      paddingLinked: connection?.paddingLinked ?? true,
      paddingStart: connection?.paddingStart ?? 16,
      paddingTop: connection?.paddingTop ?? 16,
      rotationDegrees: connection?.rotationDegrees ?? 0,
      tileSize: connection?.tileSize ?? 64,
    };
  }

  async function updateSettings(userId: string, input: UpdatePinterestWallpaperSettingsInput) {
    const [connection] = await db
      .select()
      .from(pinterestConnections)
      .where(eq(pinterestConnections.userId, userId))
      .limit(1);
    const values = {
      ...(input.backgroundColor === undefined ? {} : { backgroundColor: input.backgroundColor }),
      ...(input.backgroundMode === undefined ? {} : { backgroundMode: input.backgroundMode }),
      ...(input.boardUrl === undefined ? {} : { boardUrl: input.boardUrl }),
      ...(input.cornerRadius === undefined ? {} : { cornerRadius: input.cornerRadius }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.frameSpacing === undefined ? {} : { frameSpacing: input.frameSpacing }),
      ...(input.layout === undefined ? {} : { layout: input.layout }),
      ...(input.mosaicFit === undefined ? {} : { mosaicFit: input.mosaicFit }),
      ...(input.paddingBottom === undefined ? {} : { paddingBottom: input.paddingBottom }),
      ...(input.paddingEnd === undefined ? {} : { paddingEnd: input.paddingEnd }),
      ...(input.paddingLinked === undefined ? {} : { paddingLinked: input.paddingLinked }),
      ...(input.paddingStart === undefined ? {} : { paddingStart: input.paddingStart }),
      ...(input.paddingTop === undefined ? {} : { paddingTop: input.paddingTop }),
      ...(input.rotationDegrees === undefined ? {} : { rotationDegrees: input.rotationDegrees }),
      ...(input.tileSize === undefined ? {} : { tileSize: input.tileSize }),
      updatedAt: now(),
    };
    const [updated] = connection
      ? await db
          .update(pinterestConnections)
          .set(values)
          .where(eq(pinterestConnections.id, connection.id))
          .returning()
      : await db
          .insert(pinterestConnections)
          .values({
            backgroundColor: input.backgroundColor ?? "#ffffff",
            backgroundMode: input.backgroundMode ?? "white",
            boardUrl: input.boardUrl ?? null,
            cornerRadius: input.cornerRadius ?? 0,
            enabled: input.enabled ?? false,
            frameSpacing: input.frameSpacing ?? 16,
            layout: input.layout ?? "grid",
            mosaicFit: input.mosaicFit ?? "preserve",
            paddingBottom: input.paddingBottom ?? 16,
            paddingEnd: input.paddingEnd ?? 16,
            paddingLinked: input.paddingLinked ?? true,
            paddingStart: input.paddingStart ?? 16,
            paddingTop: input.paddingTop ?? 16,
            rotationDegrees: input.rotationDegrees ?? 0,
            tileSize: input.tileSize ?? 64,
            userId,
          })
          .returning();
    if (!updated)
      throw new AppError("internal_error", "The Pinterest wallpaper settings could not be saved.");
    return {
      backgroundColor: updated.backgroundColor,
      backgroundMode: updated.backgroundMode,
      boardUrl: updated.boardUrl,
      cornerRadius: updated.cornerRadius,
      enabled: updated.enabled,
      frameSpacing: updated.frameSpacing,
      layout: updated.layout,
      lastAppliedAt: updated.lastAppliedAt?.toISOString() ?? null,
      mosaicFit: updated.mosaicFit,
      paddingBottom: updated.paddingBottom,
      paddingEnd: updated.paddingEnd,
      paddingLinked: updated.paddingLinked,
      paddingStart: updated.paddingStart,
      paddingTop: updated.paddingTop,
      rotationDegrees: updated.rotationDegrees,
      tileSize: updated.tileSize,
    } satisfies PinterestWallpaperSettings;
  }

  async function pins(
    userId: string,
    limit: number,
    planningDate?: string,
  ): Promise<PinterestPin[]> {
    const [connection] = await db
      .select()
      .from(pinterestConnections)
      .where(eq(pinterestConnections.userId, userId))
      .limit(1);
    if (!connection?.boardUrl) {
      throw new AppError(
        "invalid_request",
        "Paste a public Pinterest board URL before refreshing your wallpaper.",
      );
    }
    let images: PinterestPin[];
    try {
      images = await fetchPinterestBoardPins(connection.boardUrl, requestFetch);
    } catch (error) {
      if (error instanceof PinterestBoardError) throw new AppError(error.code, error.message);
      throw error;
    }
    return repeatPinsToLimit(
      shuffledForToday(images, planningDate ?? now().toISOString().slice(0, 10)),
      limit,
    );
  }

  async function recordApplied(userId: string) {
    await db
      .update(pinterestConnections)
      .set({ lastAppliedAt: now(), updatedAt: now() })
      .where(eq(pinterestConnections.userId, userId));
  }

  return { pins, recordApplied, settings, updateSettings };
}

function repeatPinsToLimit(pins: PinterestPin[], limit: number): PinterestPin[] {
  return Array.from({ length: limit }, (_, index) => {
    const pin = pins[index % pins.length];
    if (!pin) throw new Error("Pinterest pins are unexpectedly empty.");
    return { ...pin, id: `${pin.id}:${index}` };
  });
}

function shuffledForToday<T>(items: T[], planningDate: string): T[] {
  const seed = planningDate
    .split("-")
    .map(Number)
    .join("-")
    .split("")
    .reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
  let state = seed || 1;
  const next = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    const current = copy[index];
    const replacement = copy[swapIndex];
    if (current === undefined || replacement === undefined) continue;
    copy[index] = replacement;
    copy[swapIndex] = current;
  }
  return copy;
}
