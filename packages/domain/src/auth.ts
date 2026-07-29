import { z } from "zod";
import { idSchema, isoDateTimeSchema, timeZoneSchema } from "./common.js";
import { weatherLocationSchema } from "./weather.js";

/** A durable place used as the user's home and location-aware fallback. */
export const homeLocationSchema = weatherLocationSchema;
export type HomeLocation = z.infer<typeof homeLocationSchema>;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailAddressSchema = z.email().transform((value) => value.toLowerCase());

export const invitationCodeSchema = z
  .string()
  .trim()
  .length(8)
  .regex(/^[A-Z0-9]{8}$/i, "Use the eight letters and numbers from your invitation.")
  .transform((value) => value.toUpperCase());

export const validateInvitationInputSchema = z.object({
  inviteCode: invitationCodeSchema,
});
export type ValidateInvitationInput = z.infer<typeof validateInvitationInputSchema>;

export const invitationValidationSchema = z.object({
  valid: z.boolean(),
});
export type InvitationValidation = z.infer<typeof invitationValidationSchema>;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.")
  .regex(/[^A-Za-z0-9\s]/, "Include a symbol.");

export function passwordRequirementState(password: string) {
  return {
    length: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    mixedCase: /[a-z]/.test(password) && /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9\s]/.test(password),
  };
}

export const registerInputSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: emailAddressSchema,
  inviteCode: invitationCodeSchema.optional(),
  password: passwordSchema,
  planningTimezone: timeZoneSchema.default("UTC"),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: emailAddressSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const themeSchema = z.enum(["system", "light", "dark"]);
export type Theme = z.infer<typeof themeSchema>;

export const accountSetupStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "dismissed",
  "complete",
]);
export type AccountSetupStatus = z.infer<typeof accountSetupStatusSchema>;

export const accountSetupStepSchema = z.enum([
  "welcome",
  "workspaces",
  "verify_email",
  "google",
  "icloud",
  "finances",
  "ready",
]);
export type AccountSetupStep = z.infer<typeof accountSetupStepSchema>;

export const accountSetupWorkspaceSchema = z.enum(["calendar", "tasks", "mail", "finances"]);
export type AccountSetupWorkspace = z.infer<typeof accountSetupWorkspaceSchema>;

export const accountSetupStateSchema = z.object({
  completedAt: isoDateTimeSchema.nullable(),
  currentStep: accountSetupStepSchema,
  dismissedAt: isoDateTimeSchema.nullable(),
  selectedWorkspaces: z.array(accountSetupWorkspaceSchema),
  startedAt: isoDateTimeSchema.nullable(),
  status: accountSetupStatusSchema,
});
export type AccountSetupState = z.infer<typeof accountSetupStateSchema>;

export const updateAccountSetupInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("progress"),
    currentStep: accountSetupStepSchema,
    selectedWorkspaces: z.array(accountSetupWorkspaceSchema).optional(),
  }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("complete") }),
]);
export type UpdateAccountSetupInput = z.infer<typeof updateAccountSetupInputSchema>;

export const requestPasswordResetInputSchema = z.object({
  email: emailAddressSchema,
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetInputSchema>;

export const resetPasswordInputSchema = z.object({
  password: passwordSchema,
  token: z.string().min(1).max(256),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

export const confirmEmailVerificationInputSchema = z.object({
  token: z.string().min(1).max(256),
});
export type ConfirmEmailVerificationInput = z.infer<typeof confirmEmailVerificationInputSchema>;

export const createInvitationInputSchema = z.object({
  email: emailAddressSchema.optional(),
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
    setup: accountSetupStateSchema,
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
    email: emailAddressSchema.optional(),
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
