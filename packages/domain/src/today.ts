import { z } from "zod";
import type { Reminder } from "./reminder.js";
import type { Task } from "./task.js";
import { addLocalDays, localDateAt, localDateRange, localDateToIso } from "./time.js";

const fields = {
  background: z.enum(["default", "weather", "map"]),
  showSpending: z.boolean(),
  showRitual: z.boolean(),
  showPet: z.boolean(),
  spendingWindow: z.enum(["week", "month"]),
  commitmentFilter: z.enum(["all", "overdue", "tasks", "reminders"]),
  includeUndated: z.boolean(),
};
export const todayPreferencesSchema = z.object(fields).strict();
export type TodayPreferences = z.infer<typeof todayPreferencesSchema>;
export const defaultTodayPreferences: TodayPreferences = {
  background: "default",
  showSpending: false,
  showRitual: false,
  showPet: true,
  spendingWindow: "week",
  commitmentFilter: "all",
  includeUndated: false,
};
export const updateTodaySettingsSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    preferences: todayPreferencesSchema.partial(),
  })
  .strict();
export type UpdateTodaySettings = z.infer<typeof updateTodaySettingsSchema>;
export type TodaySettings = { revision: number; preferences: TodayPreferences };
export function resolveTodaySettings(
  row: (Partial<TodayPreferences> & { revision: number }) | null | undefined,
): TodaySettings {
  const { revision = 0, ...preferences } = row ?? {};
  return {
    revision,
    preferences: todayPreferencesSchema.parse({ ...defaultTodayPreferences, ...preferences }),
  };
}
export function todayWeekRange(now: Date, timeZone: string, weekStartsOn: "sunday" | "monday") {
  const day = localDateAt(now, timeZone);
  const weekday = new Date(`${localDateToIso(day)}T12:00:00Z`).getUTCDay();
  const start = addLocalDays(day, -((weekday - (weekStartsOn === "monday" ? 1 : 0) + 7) % 7));
  const end = addLocalDays(start, 7);
  return {
    weekStart: localDateToIso(start),
    weekEndExclusive: localDateToIso(end),
    ...localDateRange(start, end, timeZone),
  };
}
export type TodayCommitmentGroup = "overdue" | "today" | "later_this_week" | "undated";
export type TodayCommitment =
  | { kind: "task"; group: TodayCommitmentGroup; material: Task }
  | { kind: "reminder"; group: TodayCommitmentGroup; material: Reminder };
export const todayCommitmentsQuerySchema = z.object({
  filter: fields.commitmentFilter.default("all"),
  includeUndated: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  cursor: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(6),
});
export type TodayCommitmentQuery = {
  filter: TodayPreferences["commitmentFilter"];
  includeUndated: boolean;
  cursor?: string | undefined;
  limit?: number;
};
export type TodayCommitmentPage = {
  generatedAt: string;
  timeZone: string;
  weekStart: string;
  weekEndExclusive: string;
  items: TodayCommitment[];
  nextCursor: string | null;
  counts: Record<TodayPreferences["commitmentFilter"], number | null>;
  unavailableSources: Array<"tasks" | "reminders">;
};
