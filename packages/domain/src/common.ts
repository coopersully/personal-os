import { z } from "zod";

const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Semantic Versioning 2.0.0, including prerelease and build metadata. */
export const semanticVersionSchema = z
  .string()
  .regex(semanticVersionPattern, "Use a valid semantic version.");

export const idSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const timeZoneSchema = z.string().trim().min(1).max(100);
export const completeInputSchema = z.object({ completed: z.boolean() });

export const paginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const actorTypeSchema = z.enum(["user", "agent", "connector", "system"]);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
