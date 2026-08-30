import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";

export const textingConsentVersion = "2026-08-28-v1" as const;
export const textingCountrySchema = z.enum(["US", "CA"]);
export const textingConnectionStateSchema = z.enum([
  "active",
  "opted_out",
  "sync_error",
  "suspended",
  "disconnected",
]);
export const textMessageDirectionSchema = z.enum(["inbound", "outbound"]);
export const textMessageStatusSchema = z.enum([
  "accepted",
  "queued",
  "sending",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "unknown",
]);
export const textContentKindSchema = z.enum([
  "concise",
  "essential_context",
  "structured_data",
  "requested_large_content",
  "safety_critical",
]);
export const textOccurredAtSourceSchema = z.enum(["provider", "ilo"]);

export const startTextingVerificationInputSchema = z.object({
  consentAccepted: z.literal(true),
  country: textingCountrySchema,
  phoneNumber: z.string().trim().min(7).max(32),
});
export const checkTextingVerificationInputSchema = z.object({
  code: z.string().regex(/^\d{4,10}$/u),
});
export const textingVerificationChallengeSchema = z.object({
  expiresAt: isoDateTimeSchema,
  id: idSchema,
  maskedPhoneNumber: z.string(),
  status: z.enum(["pending", "approved", "expired", "failed", "cancelled"]),
});
export const textingConnectionSchema = z.object({
  consentEpoch: z.int().nonnegative(),
  country: textingCountrySchema.nullable(),
  id: idSchema.nullable(),
  maskedPhoneNumber: z.string().nullable(),
  providerReady: z.boolean(),
  senderPhoneNumber: z.string().nullable(),
  state: textingConnectionStateSchema.nullable(),
  verifiedAt: isoDateTimeSchema.nullable(),
});
export const textMessageSchema = z.object({
  actualSegments: z.int().positive().nullable(),
  contentKind: textContentKindSchema.nullable(),
  deliveredAt: isoDateTimeSchema.nullable(),
  direction: textMessageDirectionSchema,
  id: idSchema,
  localDateTime: z.string().min(1),
  occurredAt: isoDateTimeSchema,
  occurredAtSource: textOccurredAtSourceSchema,
  predictedSegments: z.int().positive().nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  seriesId: z.uuid().nullable(),
  seriesPart: z.int().min(1).max(3).nullable(),
  seriesTotal: z.int().min(2).max(3).nullable(),
  status: textMessageStatusSchema,
  text: z.string(),
});
export const textConversationQuerySchema = z
  .object({
    afterCursor: z.string().min(1).optional(),
    beforeCursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .refine((value) => !(value.afterCursor && value.beforeCursor), {
    message: "Use either afterCursor or beforeCursor, not both.",
  });
export const textConversationPageSchema = z.object({
  asOf: isoDateTimeSchema,
  connection: textingConnectionSchema,
  conversationReceipt: z.string().nullable(),
  currentLocalDateTime: z.string().min(1),
  earlierCursor: z.string().nullable(),
  hasEarlierMessages: z.boolean(),
  messages: z.array(textMessageSchema),
  newerCursor: z.string().nullable(),
  timeZone: z.string().min(1),
});
export const sendTextMessageInputSchema = z.object({
  body: z.string().trim().min(1).max(1_600),
  contentKind: textContentKindSchema.default("concise"),
  conversationReceipt: z.string().min(1),
  exceptionalLengthToken: z.string().min(1).optional(),
  lengthReviewToken: z.string().min(1).optional(),
  necessity: z.string().trim().min(1).max(240).optional(),
  seriesId: z.uuid().optional(),
  seriesPart: z.int().min(1).max(3).optional(),
  seriesTotal: z.int().min(2).max(3).optional(),
});

export function normalizeTextingPhoneNumber(input: {
  country: TextingCountry;
  phoneNumber: string;
}): { country: TextingCountry; e164: string; lastFour: string } {
  const parsed = parsePhoneNumberFromString(input.phoneNumber, input.country);
  if (!parsed?.isValid() || parsed.country !== input.country || parsed.countryCallingCode !== "1") {
    throw new Error("Enter a valid US or Canadian phone number.");
  }
  return {
    country: input.country,
    e164: parsed.number,
    lastFour: parsed.nationalNumber.slice(-4),
  };
}

export type CheckTextingVerificationInput = z.infer<typeof checkTextingVerificationInputSchema>;
export type SendTextMessageInput = z.infer<typeof sendTextMessageInputSchema>;
export type StartTextingVerificationInput = z.infer<typeof startTextingVerificationInputSchema>;
export type TextContentKind = z.infer<typeof textContentKindSchema>;
export type TextConversationPage = z.infer<typeof textConversationPageSchema>;
export type TextConversationQuery = z.infer<typeof textConversationQuerySchema>;
export type TextMessage = z.infer<typeof textMessageSchema>;
export type TextMessageDirection = z.infer<typeof textMessageDirectionSchema>;
export type TextMessageStatus = z.infer<typeof textMessageStatusSchema>;
export type TextOccurredAtSource = z.infer<typeof textOccurredAtSourceSchema>;
export type TextingConnection = z.infer<typeof textingConnectionSchema>;
export type TextingConnectionState = z.infer<typeof textingConnectionStateSchema>;
export type TextingCountry = z.infer<typeof textingCountrySchema>;
export type TextingVerificationChallenge = z.infer<typeof textingVerificationChallengeSchema>;
