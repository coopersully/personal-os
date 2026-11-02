import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";
// Older responses contain only the shared default. Normalize them at the contract
// boundary so clients always receive independent defaults.
export const activeReminderPreferencesSchema = z
  .object({
    defaultActiveReminder: z.boolean(),
    defaultTaskActiveReminder: z.boolean().optional(),
    defaultReminderActiveReminder: z.boolean().optional(),
    revision: z.number().int().nonnegative(),
  })
  .transform((value) => ({
    ...value,
    defaultTaskActiveReminder: value.defaultTaskActiveReminder ?? value.defaultActiveReminder,
    defaultReminderActiveReminder:
      value.defaultReminderActiveReminder ?? value.defaultActiveReminder,
  }));
export type ActiveReminderPreferences = z.infer<typeof activeReminderPreferencesSchema>;
export const saveActiveReminderPreferencesSchema = z.union([
  z
    .object({
      defaultActiveReminder: z.boolean(),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      defaultTaskActiveReminder: z.boolean(),
      defaultReminderActiveReminder: z.boolean(),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type SaveActiveReminderPreferences = z.infer<typeof saveActiveReminderPreferencesSchema>;
const candidateFields = {
  id: idSchema,
  title: z.string(),
  dueAt: isoDateTimeSchema,
  activeReminder: z.literal(true),
};
export const activeReminderCandidateSchema = z.discriminatedUnion("kind", [
  z.object({ ...candidateFields, kind: z.literal("task"), revision: z.number().int().positive() }),
  z.object({ ...candidateFields, kind: z.literal("reminder"), updatedAt: isoDateTimeSchema }),
]);
export type ActiveReminderCandidate = z.infer<typeof activeReminderCandidateSchema>;
export const activeReminderCandidatePageSchema = z.object({
  generatedAt: isoDateTimeSchema,
  items: z.array(activeReminderCandidateSchema),
  nextCursor: z.string().nullable(),
});
export type ActiveReminderCandidatePage = z.infer<typeof activeReminderCandidatePageSchema>;
