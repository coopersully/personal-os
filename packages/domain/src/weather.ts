import { z } from "zod";
import { isoDateTimeSchema, timeZoneSchema } from "./common.js";

export const weatherLocationSearchQuerySchema = z.object({
  query: z.string().trim().min(2).max(120),
});
export type WeatherLocationSearchQuery = z.infer<typeof weatherLocationSearchQuerySchema>;

export const weatherCoordinatesSchema = z.object({
  latitude: z.coerce.number().finite().min(-90).max(90),
  longitude: z.coerce.number().finite().min(-180).max(180),
});
export type WeatherCoordinates = z.infer<typeof weatherCoordinatesSchema>;

export const weatherLocationOptionSchema = z.object({
  coordinates: weatherCoordinatesSchema,
  label: z.string().trim().min(1).max(120),
  timezone: timeZoneSchema.optional(),
});
export type WeatherLocationOption = z.infer<typeof weatherLocationOptionSchema>;

export const weatherLocationSchema = weatherLocationOptionSchema.extend({
  coordinates: weatherCoordinatesSchema.optional(),
});
export type WeatherLocation = z.infer<typeof weatherLocationSchema>;

export const weatherQuerySchema = weatherCoordinatesSchema
  .partial()
  .refine(
    (value) =>
      (value.latitude === undefined && value.longitude === undefined) ||
      (value.latitude !== undefined && value.longitude !== undefined),
    { message: "Latitude and longitude must be provided together." },
  );
export type WeatherQuery = z.infer<typeof weatherQuerySchema>;

export const weatherAlertSchema = z.object({
  kind: z.enum(["air_quality", "rain"]),
  label: z.string().min(1),
});
export type WeatherAlert = z.infer<typeof weatherAlertSchema>;

export const weatherLocationDetailsSchema = z.object({
  city: z.string().min(1).nullable(),
  coordinates: weatherCoordinatesSchema,
  country: z.string().min(1).nullable(),
  label: z.string().min(1),
  mapUrl: z.url(),
  region: z.string().min(1).nullable(),
  shortLabel: z.string().min(1),
  source: z.enum(["device", "saved"]),
});
export type WeatherLocationDetails = z.infer<typeof weatherLocationDetailsSchema>;

export const weatherSnapshotSchema = z.object({
  alerts: z.array(weatherAlertSchema),
  condition: z.string().min(1),
  location: weatherLocationDetailsSchema,
  observedAt: isoDateTimeSchema,
  temperatureF: z.number().finite(),
  usAqi: z.number().int().min(0).nullable(),
});
export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>;
