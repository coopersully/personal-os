import { z } from "zod";
import { addLocalDays, localDateAt, localDateTimeToUtc, localDateToIso } from "./time.js";

const key = z.string().min(1).max(100);
const instant = z.iso.datetime({ offset: true });
export const ritualStepSchema = z
  .object({
    id: key.refine(
      (value) => value !== "." && value !== ".." && !/[/\\%\p{Cc}]/u.test(value),
      "Step IDs cannot contain path separators, escapes, or control characters",
    ),
    label: z.string().trim().min(1).max(240),
    kind: z.enum(["checkbox", "short_text", "time", "date", "number", "multiple_choice"]),
    options: z.array(z.string().trim().min(1).max(240)).min(2).max(12).optional(),
  })
  .refine(
    (step) =>
      step.kind !== "multiple_choice" ||
      (step.options !== undefined && new Set(step.options).size === step.options.length),
    "Multiple choice needs 2–12 distinct options",
  );
export type RitualStep = z.infer<typeof ritualStepSchema>;
export const ritualDefinitionInputSchema = z.object({
  requestId: z.uuid(),
  deviceId: key,
  expectedRevision: z.number().int().min(0),
  kind: z.enum(["morning", "night"]),
  title: z.string().trim().min(1).max(240),
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z
    .string()
    .max(100)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid time zone."),
  steps: z
    .array(ritualStepSchema)
    .min(1)
    .max(20)
    .refine((v) => new Set(v.map((s) => s.id)).size === v.length, "Step IDs must be unique."),
});
export type RitualDefinitionInput = z.infer<typeof ritualDefinitionInputSchema>;
export type RitualDefinition = Omit<
  RitualDefinitionInput,
  "requestId" | "deviceId" | "expectedRevision"
> & { id: string; revision: number; enabledAt: string };
export type RitualWindow = {
  ritualId: string;
  definitionRevision: number;
  scheduledLocalDate: string;
  timeZone: string;
  dueAt: string;
  expiresAt: string;
};
export type RitualResponse = {
  id: string;
  requestId: string;
  stepId: string;
  value: string | boolean;
  submitted: boolean;
  observedAt: string;
  recordedAt: string;
};
export type RitualAction = {
  id: string;
  requestId: string;
  deviceId: string;
  kind:
    | "snooze_pressed"
    | "snooze_confirmed"
    | "snooze_cancelled"
    | "skip_pressed"
    | "skip_applied"
    | "complete_applied";
  observedAt: string;
  recordedAt: string;
  count: number;
  outcome: "applied" | "rejected" | "pending";
  challengeId?: string;
};
export type RitualOccurrence = RitualWindow & {
  id: string;
  definition: RitualDefinition;
  status: "pending" | "completed" | "skipped" | "missed" | "cancelled_configuration";
  revision: number;
  snoozedUntil: string | null;
  settledAt: string | null;
  responses: RitualResponse[];
  actions: RitualAction[];
};
export type RitualState = {
  preview?: boolean;
  definitions: RitualDefinition[];
  current: RitualOccurrence | null;
  upcoming?: RitualOccurrence[];
  serverNow: string;
  snoozeCount: number;
  syncStatus: "saved" | "queued" | "conflict";
};
const mutation = {
  requestId: z.uuid(),
  deviceId: key,
  expectedRevision: z.number().int().positive(),
  observedAt: instant,
};
export const ritualResponseInputSchema = z.object({
  ...mutation,
  value: z.union([z.boolean(), z.string().max(5000)]),
  submitted: z.boolean(),
});
export type RitualResponseInput = z.infer<typeof ritualResponseInputSchema>;
export const ritualActionInputSchema = z.object({
  ...mutation,
  kind: z.enum(["snooze", "confirm_snooze", "cancel_snooze", "skip", "complete"]),
  challengeId: z.uuid().optional(),
  displayedCount: z.number().int().min(0).optional(),
  requireConfirmation: z.boolean().optional(),
  historyUnavailable: z.boolean().optional(),
});
export type RitualActionInput = z.infer<typeof ritualActionInputSchema>;
export type RitualActionResult =
  | { outcome: "applied" | "conflict"; state: RitualState }
  | {
      outcome: "confirmation_required";
      count: number;
      historyUnavailable?: boolean;
      challengeId: string;
      state: RitualState;
    };
export function requiresSnoozeConfirmation(priorConfirmedCount: number) {
  return priorConfirmedCount >= 2;
}

// Resolve gaps to the first valid wall minute and overlaps to the earlier instant.
// A bounded search around the existing zone converter avoids assumed fixed offsets.
const boundaryCache = new Map<string, string>();
function boundary(definition: RitualDefinition, date: ReturnType<typeof localDateAt>): string {
  const dateKey = localDateToIso(date),
    cacheKey = `${definition.timeZone}/${dateKey}/${definition.time}`;
  const cached = boundaryCache.get(cacheKey);
  if (cached) return cached;
  const [hour, minute] = definition.time.split(":").map(Number);
  const target = (hour ?? 0) * 60 + (minute ?? 0);
  const approximate = localDateTimeToUtc(date, target, definition.timeZone).getTime();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: definition.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let best: number | undefined;
  let bestMinute = Infinity;
  for (let t = approximate - 4 * 3600000; t <= approximate + 4 * 3600000; t += 60000) {
    const parts = Object.fromEntries(formatter.formatToParts(t).map((p) => [p.type, p.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` !== dateKey) continue;
    const wall = Number(parts.hour) * 60 + Number(parts.minute);
    if (wall >= target && wall < bestMinute) {
      best = t;
      bestMinute = wall;
    }
  }
  if (best === undefined) throw new Error("Cannot resolve ritual schedule.");
  const value = new Date(best).toISOString();
  if (boundaryCache.size > 2048) boundaryCache.clear();
  boundaryCache.set(cacheKey, value);
  return value;
}
function ritualWindows(definitions: RitualDefinition[], now: string, days: number): RitualWindow[] {
  const windows: Omit<RitualWindow, "expiresAt">[] = [];
  for (const definition of definitions.filter((d) => d.enabled)) {
    const date = localDateAt(new Date(now), definition.timeZone);
    for (let delta = -2; delta <= days + 2; delta++) {
      const local = addLocalDays(date, delta);
      const dueAt = boundary(definition, local);
      if (new Date(dueAt).getTime() < new Date(definition.enabledAt).getTime()) continue;
      windows.push({
        ritualId: definition.id,
        definitionRevision: definition.revision,
        scheduledLocalDate: localDateToIso(local),
        timeZone: definition.timeZone,
        dueAt,
      });
    }
  }
  windows.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.ritualId.localeCompare(b.ritualId));
  return windows
    .slice(0, -1)
    .map((window, index) => ({ ...window, expiresAt: windows[index + 1]?.dueAt ?? window.dueAt }));
}
export function currentRitualWindow(
  definitions: RitualDefinition[],
  now: string,
): RitualWindow | null {
  return (
    ritualWindows(definitions, now, 1)
      .filter((w) => Date.parse(w.dueAt) <= Date.parse(now))
      .at(-1) ?? null
  );
}
export function upcomingRitualWindows(
  definitions: RitualDefinition[],
  now: string,
): RitualWindow[] {
  const end = Date.parse(now) + 7 * 86400000;
  return ritualWindows(definitions, now, 7).filter(
    (w) => Date.parse(w.dueAt) > Date.parse(now) && Date.parse(w.dueAt) <= end,
  );
}

export function latestRitualResponses(
  occurrence: RitualOccurrence,
): Record<string, RitualResponse> {
  return Object.fromEntries(occurrence.responses.map((r) => [r.stepId, r]));
}
export function ritualAnswerIsValid(step: RitualStep, value: string | boolean): boolean {
  if (step.kind === "checkbox") return value === true;
  if (typeof value !== "string" || !value.trim()) return false;
  if (step.kind === "time") return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (step.kind === "date")
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    );
  if (step.kind === "number")
    return (
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value))
    );
  if (step.kind === "multiple_choice") return step.options?.includes(value) ?? false;
  return true;
}
export function ritualIsAnswered(occurrence: RitualOccurrence): boolean {
  const values = latestRitualResponses(occurrence);
  return occurrence.definition.steps.every((step) => {
    const response = values[step.id];
    return response?.submitted && ritualAnswerIsValid(step, response.value);
  });
}
