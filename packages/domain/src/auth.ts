import { z } from "zod";
import { idSchema, isoDateTimeSchema, timeZoneSchema } from "./common.js";
import { weatherLocationSchema } from "./weather.js";

/** A durable place used as the user's home and location-aware fallback. */
export const homeLocationSchema = weatherLocationSchema;
export type HomeLocation = z.infer<typeof homeLocationSchema>;

export const registerInputSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.email().transform((value) => value.toLowerCase()),
  inviteCode: z.string().trim().min(16).max(128).optional(),
  password: z.string().min(12).max(128),
  planningTimezone: timeZoneSchema.default("UTC"),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const themeSchema = z.enum(["system", "light", "dark"]);
export type Theme = z.infer<typeof themeSchema>;

export const requestPasswordResetInputSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetInputSchema>;

export const resetPasswordInputSchema = z.object({
  password: z.string().min(12).max(128),
  token: z.string().min(1).max(256),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

export const confirmEmailVerificationInputSchema = z.object({
  token: z.string().min(1).max(256),
});
export type ConfirmEmailVerificationInput = z.infer<typeof confirmEmailVerificationInputSchema>;

export const createInvitationInputSchema = z.object({
  email: z
    .email()
    .transform((value) => value.toLowerCase())
    .optional(),
  expiresInDays: z.int().min(1).max(90).default(14),
});
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;

export const invitationSchema = z.object({
  createdAt: isoDateTimeSchema,
  email: z.email().nullable(),
  expiresAt: isoDateTimeSchema,
  id: idSchema,
  redeemedAt: isoDateTimeSchema.nullable(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const userSchema = z
  .object({
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    canManageInvitations: z.boolean().optional(),
    id: idSchema,
    displayName: z.string(),
    email: z.email(),
    theme: themeSchema,
    emailVerified: z.boolean(),
    planningTimezone: timeZoneSchema,
    homeLocation: homeLocationSchema.nullable().default(null),
    workdayEndMinute: z
      .int()
      .min(1)
      .max(24 * 60),
    workdayStartMinute: z
      .int()
      .min(0)
      .max(24 * 60 - 1),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .refine((user) => user.workdayStartMinute < user.workdayEndMinute, {
    message: "Workday end must be after the start.",
  });
export type User = z.infer<typeof userSchema>;

export const updateUserInputSchema = z
  .object({
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
    email: z
      .email()
      .transform((value) => value.toLowerCase())
      .optional(),
    theme: themeSchema.optional(),
    planningTimezone: timeZoneSchema.optional(),
    homeLocation: homeLocationSchema.nullable().optional(),
    workdayEndMinute: z
      .int()
      .min(1)
      .max(24 * 60)
      .optional(),
    workdayStartMinute: z
      .int()
      .min(0)
      .max(24 * 60 - 1)
      .optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Provide at least one account setting to update.",
  });
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export const accessScopeSchema = z.enum([
  "reminders:read",
  "reminders:write",
  "tasks:read",
  "tasks:write",
  "calendar:read",
  "calendar:write",
  "mail:read",
  "mail:write",
  "goals:read",
  "goals:write",
  "automations:read",
  "automations:write",
  "audit:read",
  "finances:read",
  "finances:write",
  "bookmarks:read",
]);
export type AccessScope = z.infer<typeof accessScopeSchema>;

export const createAccessTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(accessScopeSchema)
    .min(1)
    .transform((values) => [...new Set(values)]),
  expiresAt: isoDateTimeSchema.optional(),
});
export type CreateAccessTokenInput = z.infer<typeof createAccessTokenInputSchema>;
