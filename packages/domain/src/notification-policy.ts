import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";
import { financeHumanWorkRefSchema } from "./finance/workflow-contracts.js";

export const notificationDetailSchema = z.enum(["minimal", "context"]);
export const notificationScopeSchema = z.enum(["global", "finances"]);
export const notificationPreferencesSchema = z
  .object({
    enabled: z.boolean(),
    quietMode: z.enum(["window", "any_time"]),
    quietStartMinute: z.int().min(0).max(1439),
    quietEndMinute: z.int().min(0).max(1439),
    reminderDays: z.int().min(1).max(365).nullable(),
    detail: notificationDetailSchema,
  })
  .strict()
  .refine(
    (value) => value.quietMode !== "window" || value.quietStartMinute !== value.quietEndMinute,
    { message: "Quiet hours must have distinct start and end times." },
  );
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export const defaultNotificationPreferences: NotificationPreferences = {
  enabled: true,
  quietMode: "window",
  quietStartMinute: 1320,
  quietEndMinute: 480,
  reminderDays: 7,
  detail: "context",
};

/** Resolved by the owning domain, never accepted as client-authored notification evidence. */
export const notificationWorkSchema = z
  .object({
    work: financeHumanWorkRefSchema,
    active: z.boolean(),
    expiresAt: isoDateTimeSchema.nullable(),
    disclosure: notificationDetailSchema,
    context: z.string().trim().min(1).max(120).nullable(),
    occurredAt: isoDateTimeSchema.nullable(),
    destination: z.literal("/settings?section=reviews"),
  })
  .strict();
export type NotificationWork = z.infer<typeof notificationWorkSchema>;
export const publishNotificationInputSchema = z
  .object({
    work: z.array(financeHumanWorkRefSchema).min(1).max(100),
  })
  .strict();
export const saveNotificationPreferencesSchema = z
  .object({
    expectedRevision: z.int().positive().nullable(),
    preferences: notificationPreferencesSchema,
  })
  .strict();

export type NotificationAttemptHistory = {
  actionRevision: string;
  state: "accepted" | "submitting" | "uncertain" | "failed";
  submittedAt: Date;
};

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    minute: part("hour") * 60 + part("minute"),
    day: Date.UTC(part("year"), part("month") - 1, part("day")),
  };
}

/** Evaluate wall time at the attempt instant: both repeated DST hours remain quiet, skipped hours
 * need no invented offset. Call again at send time using the current canonical user timezone. */
export function notificationEligibility(input: {
  work: NotificationWork;
  preferences: NotificationPreferences;
  timeZone: string;
  now: Date;
  attempts: NotificationAttemptHistory[];
}) {
  const { work, preferences, now, attempts } = input;
  if (!work.active) return "resolved";
  if (work.expiresAt && new Date(work.expiresAt) <= now) return "expired";
  if (!preferences.enabled) return "disabled";
  let minute: number;
  try {
    minute = localParts(now, input.timeZone).minute;
  } catch {
    return "timezone_unavailable";
  }
  if (attempts.some((a) => a.state === "submitting" || a.state === "uncertain"))
    return "delivery_uncertain";
  const sameAction = attempts.filter((a) => a.actionRevision === work.work.actionRevision);
  const last = sameAction.reduce<Date | null>(
    (latest, a) => (!latest || a.submittedAt > latest ? a.submittedAt : latest),
    null,
  );
  if (last) {
    if (preferences.reminderDays === null) return "reminder_never";
    if (now.getTime() - last.getTime() < preferences.reminderDays * 86400000)
      return "reminder_wait";
  }
  const start = preferences.quietStartMinute;
  const end = preferences.quietEndMinute;
  const quiet = start > end ? minute >= start || minute < end : minute >= start && minute < end;
  if (preferences.quietMode === "window" && quiet) return "quiet_hours";
  return "eligible";
}

function relativeDate(instant: string, now: Date, timeZone: string) {
  const date = new Date(instant);
  const delta = (localParts(date, timeZone).day - localParts(now, timeZone).day) / 86400000;
  if (delta === -1) return "yesterday";
  if (delta === 0) return "today";
  if (delta === 1) return "tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** T0 directs review to the app; no reply vocabulary or numeric answer bindings are advertised. */
export function composeNotification(input: {
  works: NotificationWork[];
  now: Date;
  timeZone: string;
  detail: "minimal" | "context";
  origin: string;
}) {
  const labels = input.works.slice(0, 3).map((work) => {
    const label = work.context;
    // Defense in depth, not a sensitivity classifier: the domain's disclosure ceiling is mandatory.
    const safe = label && !/(?:\d[ .()-]*){5}|@|https?:|[\r\n]/iu.test(label);
    if (input.detail !== "context" || work.disclosure !== "context" || !safe) return "Finance item";
    const date = work.occurredAt
      ? ` (${relativeDate(work.occurredAt, input.now, input.timeZone)})`
      : "";
    return `${label.slice(0, 60)}${date}`;
  });
  const overflow = input.works.length > 3 ? `; ${input.works.length - 3} more` : "";
  const origin = new URL(input.origin).origin;
  return `nohmi: Review needed: ${labels.join("; ")}${overflow}. Review: ${origin}/settings?section=reviews`;
}

export const notificationResolutionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("current"), value: notificationWorkSchema }).strict(),
  z.object({ state: z.literal("unavailable") }).strict(),
  z.object({ state: z.literal("stale") }).strict(),
  z.object({ state: z.literal("resolved") }).strict(),
]);
export type NotificationResolution = z.infer<typeof notificationResolutionSchema>;

/** Never allow an adapter mismatch to become disclosure or channel authority. */
export function validateNotificationResolution(
  reference: NotificationWork["work"],
  result: unknown,
): NotificationResolution {
  const parsed = notificationResolutionSchema.safeParse(result);
  if (!parsed.success) return { state: "unavailable" };
  if (parsed.data.state !== "current") return parsed.data;
  const current = parsed.data.value;
  if (
    (["id", "domain", "kind", "revision", "actionRevision"] as const).some(
      (key) => reference[key] !== current.work[key],
    )
  )
    return { state: "stale" };
  if (!current.active) return { state: "resolved" };
  return parsed.data;
}

export const notificationDeliveryStateSchema = z.enum([
  "claimed",
  "submitting",
  "accepted",
  "uncertain",
  "failed",
  "suppressed",
]);
export type NotificationDeliveryState = z.infer<typeof notificationDeliveryStateSchema>;

export const notificationStatusSchema = z.object({
  capability: z.enum(["available", "unavailable"]),
  reason: z.literal("producer_not_registered").nullable(),
  timeZone: z.string(),
  preferences: z.array(
    z.object({
      scope: notificationScopeSchema,
      revision: z.int().positive(),
      preferences: notificationPreferencesSchema,
    }),
  ),
  effective: notificationPreferencesSchema,
  intents: z.array(
    z.object({
      id: z.uuid(),
      work: financeHumanWorkRefSchema,
      state: z.string(),
      reason: z.string().nullable(),
    }),
  ),
  attempts: z.array(
    z.object({
      id: z.uuid(),
      state: notificationDeliveryStateSchema,
      reason: z.string().nullable(),
      messageId: z.uuid().nullable(),
      submittedAt: isoDateTimeSchema.nullable(),
      updatedAt: isoDateTimeSchema,
      recovery: z.enum(["reconcile_delivery", "retry_after_lease", "review_in_app"]),
    }),
  ),
});
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;
export type PublishNotificationResult =
  | { state: "accepted"; intentIds: string[] }
  | { state: "unavailable"; reason: "producer_not_registered" };
