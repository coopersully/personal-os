import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

export const pinterestPinSchema = z.object({
  id: z.string().min(1),
  imageUrl: z.url(),
  title: z.string().nullable(),
});
export type PinterestPin = z.infer<typeof pinterestPinSchema>;

export const pinterestWallpaperLayoutSchema = z.enum(["grid", "stack"]);
export type PinterestWallpaperLayout = z.infer<typeof pinterestWallpaperLayoutSchema>;

export const pinterestWallpaperBackgroundModeSchema = z.enum([
  "white",
  "custom",
  "matched",
  "random",
]);
export type PinterestWallpaperBackgroundMode = z.infer<
  typeof pinterestWallpaperBackgroundModeSchema
>;

export const pinterestWallpaperMosaicFitSchema = z.enum(["preserve", "fill"]);
export type PinterestWallpaperMosaicFit = z.infer<typeof pinterestWallpaperMosaicFitSchema>;

const wallpaperColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a hex color.");
const wallpaperPaddingSchema = z.number().int().min(0).max(240);

export const pinterestWallpaperSettingsSchema = z.object({
  backgroundColor: wallpaperColorSchema,
  backgroundMode: pinterestWallpaperBackgroundModeSchema,
  boardUrl: z.url().nullable(),
  cornerRadius: z.number().int().min(0).max(80),
  enabled: z.boolean(),
  frameSpacing: z.number().int().min(0).max(72),
  layout: pinterestWallpaperLayoutSchema,
  lastAppliedAt: isoDateTimeSchema.nullable(),
  mosaicFit: pinterestWallpaperMosaicFitSchema,
  paddingBottom: wallpaperPaddingSchema,
  paddingEnd: wallpaperPaddingSchema,
  paddingLinked: z.boolean(),
  paddingStart: wallpaperPaddingSchema,
  paddingTop: wallpaperPaddingSchema,
  rotationDegrees: z.number().int().min(0).max(16),
  tileSize: z.number().int().min(32).max(96),
});
export type PinterestWallpaperSettings = z.infer<typeof pinterestWallpaperSettingsSchema>;

export const updatePinterestWallpaperSettingsInputSchema = z.object({
  backgroundColor: wallpaperColorSchema.optional(),
  backgroundMode: pinterestWallpaperBackgroundModeSchema.optional(),
  boardUrl: z
    .url()
    .refine((value) => {
      const host = new URL(value).hostname;
      return host === "pinterest.com" || host.endsWith(".pinterest.com");
    }, "Provide a public Pinterest board URL.")
    .nullable()
    .optional(),
  cornerRadius: z.number().int().min(0).max(80).optional(),
  enabled: z.boolean().optional(),
  frameSpacing: z.number().int().min(0).max(72).optional(),
  layout: pinterestWallpaperLayoutSchema.optional(),
  mosaicFit: pinterestWallpaperMosaicFitSchema.optional(),
  paddingBottom: wallpaperPaddingSchema.optional(),
  paddingEnd: wallpaperPaddingSchema.optional(),
  paddingLinked: z.boolean().optional(),
  paddingStart: wallpaperPaddingSchema.optional(),
  paddingTop: wallpaperPaddingSchema.optional(),
  rotationDegrees: z.number().int().min(0).max(16).optional(),
  tileSize: z.number().int().min(32).max(96).optional(),
});
export type UpdatePinterestWallpaperSettingsInput = z.infer<
  typeof updatePinterestWallpaperSettingsInputSchema
>;
