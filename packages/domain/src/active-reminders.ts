import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";
export const activeReminderPreferencesSchema = z.object({
  defaultActiveReminder: z.boolean(),
  revision: z.number().int().nonnegative(),
});
export type ActiveReminderPreferences = z.infer<typeof activeReminderPreferencesSchema>;
export const saveActiveReminderPreferencesSchema = z
  .object({ defaultActiveReminder: z.boolean(), expectedRevision: z.number().int().nonnegative() })
  .strict();
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
