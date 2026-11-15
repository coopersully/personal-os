import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";
import type { KnowledgeRecordSnapshot } from "./knowledge.js";
import { knowledgeClaimKey, knowledgeMutationResultSchema } from "./knowledge-lifecycle.js";

export const knowledgePreferenceKeySchema = z.enum(["presentation.detail", "presentation.format"]);
export type KnowledgePreferenceKey = z.infer<typeof knowledgePreferenceKeySchema>;

const detail = z.object({
  key: z.literal("presentation.detail"),
  value: z.enum(["concise", "detailed"]),
});
const format = z.object({
  key: z.literal("presentation.format"),
  value: z.enum(["prose", "bullets"]),
});
export const knowledgePreferenceSelectionSchema = z.discriminatedUnion("key", [
  detail.strict(),
  format.strict(),
]);
export type KnowledgePreferenceSelection = z.infer<typeof knowledgePreferenceSelectionSchema>;

const sourceEvent = { sourceEventId: z.uuid() };
export const knowledgeSelectionInputSchema = z.discriminatedUnion("key", [
  detail.extend(sourceEvent).strict(),
  format.extend(sourceEvent).strict(),
]);
export type KnowledgeSelectionInput = z.infer<typeof knowledgeSelectionInputSchema>;
export const knowledgeSelectionResultSchema = z.discriminatedUnion("outcome", [
  ...knowledgeMutationResultSchema.options,
  z.object({ outcome: z.literal("recorded") }).strict(),
]);
export type KnowledgeSelectionResult = z.infer<typeof knowledgeSelectionResultSchema>;
export const knowledgeSelectionInteractionSchema = z
  .object({ ...sourceEvent, expiresAt: isoDateTimeSchema })
  .strict();
export type KnowledgeSelectionInteraction = z.infer<typeof knowledgeSelectionInteractionSchema>;

export const knowledgeSettingsSchema = z
  .object({ automaticPreferenceAcceptance: z.boolean(), revision: z.int().nonnegative() })
  .strict();
export type KnowledgeSettings = z.infer<typeof knowledgeSettingsSchema>;
export const knowledgeSettingsInputSchema = z
  .object({
    automaticPreferenceAcceptance: z.boolean(),
    expectedRevision: z.int().nonnegative(),
    mutationKey: z.uuid(),
  })
  .strict();
export type KnowledgeSettingsInput = z.infer<typeof knowledgeSettingsInputSchema>;

export function knowledgePreferenceContent(
  selection: KnowledgePreferenceSelection,
): Extract<KnowledgeRecordSnapshot["content"], { kind: "preference" }> {
  return {
    kind: "preference",
    value: {
      subject: "owner",
      key: selection.key,
      value: { type: "string", value: selection.value },
    },
  };
}

export function knowledgePreferenceClaimKey(key: KnowledgePreferenceKey): string {
  return knowledgeClaimKey(null, {
    kind: "preference",
    value: { subject: "owner", key, value: { type: "string", value: "" } },
  }) as string;
}

export function preferenceKeyForClaim(claimKey: string | null) {
  return knowledgePreferenceKeySchema.options.find(
    (key) => knowledgePreferenceClaimKey(key) === claimKey,
  );
}

export const knowledgeSuppressionResetInputSchema = z
  .object({
    claimKey: z.string().refine((key) => preferenceKeyForClaim(key) !== undefined),
    expectedEpoch: z.int().nonnegative(),
    mutationKey: z.uuid(),
  })
  .strict();
export type KnowledgeSuppressionResetInput = z.infer<typeof knowledgeSuppressionResetInputSchema>;
export const knowledgeSuppressionResetResultSchema = z
  .object({ epoch: z.int().nonnegative() })
  .strict();
export type KnowledgeSuppressionResetResult = z.infer<typeof knowledgeSuppressionResetResultSchema>;
