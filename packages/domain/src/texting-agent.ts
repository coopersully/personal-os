import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";

export const textingAgentSettingsInputSchema = z
  .object({
    scheduleId: idSchema.nullable(),
    subscriptionOnlyConfirmed: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.scheduleId === null || v.subscriptionOnlyConfirmed === true, {
    message:
      "Confirm that paid extra usage is disabled in Claude before enabling automatic replies.",
  });
export const textingAgentWorkSchema = z
  .object({
    domain: z.enum(["mail", "tasks", "calendar", "finances", "knowledge"]),
    key: z.string().trim().min(1).max(80),
    state: z.enum(["pending", "completed", "blocked", "uncertain"]),
    note: z.string().trim().min(1).max(1000),
    references: z.array(z.string().trim().min(1).max(240)).max(10),
  })
  .strict();
const textingAgentInvocationSchema = z.object({ invocationId: idSchema }).strict();
export const textingAgentWorkCursorSchema = z
  .object({ domain: textingAgentWorkSchema.shape.domain, key: textingAgentWorkSchema.shape.key })
  .strict();
export const textingAgentClaimSchema = textingAgentInvocationSchema.extend({
  pendingWorkAfter: textingAgentWorkCursorSchema.optional(),
});
export type TextingAgentClaimInput = z.infer<typeof textingAgentClaimSchema>;
export const textingAgentCheckpointSchema = textingAgentInvocationSchema
  .extend({
    work: z.array(textingAgentWorkSchema).max(20),
  })
  .strict();
export const textingAgentReplySchema = textingAgentInvocationSchema
  .extend({
    body: z.string().trim().min(1).max(480),
  })
  .strict();
export const textingAgentRunSchema = z.object({
  id: idSchema,
  state: z.enum(["submitting", "started", "running", "completed", "uncertain", "blocked"]),
  reason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  hostSessionId: z.string().nullable(),
  replyMessageId: idSchema.nullable(),
  work: z.array(textingAgentWorkSchema),
});
export const textingAgentStatusSchema = z.object({
  enabled: z.boolean(),
  scheduleId: idSchema.nullable(),
  readiness: z.enum([
    "disabled",
    "ready",
    "consent_required",
    "host_unavailable",
    "permission_required",
  ]),
  pendingCount: z.number().int().nonnegative(),
  routines: z.array(z.object({ id: idSchema, label: z.string() })),
  runs: z.array(textingAgentRunSchema),
  nextRunCursor: idSchema.nullable(),
  instructions: z.string(),
});
export type TextingAgentSettingsInput = z.infer<typeof textingAgentSettingsInputSchema>;
export type TextingAgentWork = z.infer<typeof textingAgentWorkSchema>;
export type TextingAgentRun = z.infer<typeof textingAgentRunSchema>;
export type TextingAgentStatus = z.infer<typeof textingAgentStatusSchema>;
export type TextingAgentCheckpoint = z.infer<typeof textingAgentCheckpointSchema>;
export type TextingAgentReply = z.infer<typeof textingAgentReplySchema>;
export type TextingAgentClaim = {
  run: TextingAgentRun;
  pendingWork: { runId: string; item: TextingAgentWork }[];
  nextPendingWorkCursor: z.infer<typeof textingAgentWorkCursorSchema> | null;
  messages: { id: string; text: string; occurredAt: string }[];
  instructions: string;
};

export const textingAgentRecoverySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry") }).strict(),
  z.object({ action: z.literal("close"), hostStopped: z.literal(true) }).strict(),
]);
export type TextingAgentRecovery = z.infer<typeof textingAgentRecoverySchema>;
