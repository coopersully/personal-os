import { z } from "zod";
import { accessScopeSchema } from "./auth.js";
import { idSchema, isoDateTimeSchema } from "./common.js";

export const automationHostSurfaceSchema = z.enum(["codex_desktop", "claude_code_routine"]);
export type AutomationHostSurface = z.infer<typeof automationHostSurfaceSchema>;

const recurringAutomationHostTriggerSchema = z
  .object({
    type: z.literal("recurring"),
    expectedIntervalMinutes: z.int().min(1).max(10_080),
  })
  .strict();
const eventAutomationHostTriggerSchema = z
  .object({
    type: z.literal("event"),
    expectedMaximumLatencyMinutes: z.int().min(1).max(60),
  })
  .strict();

export const automationHostTriggerSchema = z.discriminatedUnion("type", [
  recurringAutomationHostTriggerSchema,
  eventAutomationHostTriggerSchema,
]);
export type AutomationHostTrigger = z.infer<typeof automationHostTriggerSchema>;

const automationHostScheduleCommonFields = {
  connectionId: idSchema,
  hostAutomationId: z.string().trim().min(1).max(240).nullable().default(null),
  label: z.string().trim().min(1).max(100),
  scopes: z
    .array(accessScopeSchema)
    .min(1)
    .max(accessScopeSchema.options.length)
    .transform((values) => [...new Set(values)]),
};

const automationHostScheduleFieldsSchema = z
  .discriminatedUnion("hostSurface", [
    z
      .object({
        ...automationHostScheduleCommonFields,
        hostSurface: z.literal("codex_desktop"),
        trigger: recurringAutomationHostTriggerSchema,
      })
      .strict(),
    z
      .object({
        ...automationHostScheduleCommonFields,
        hostSurface: z.literal("claude_code_routine"),
        trigger: eventAutomationHostTriggerSchema,
      })
      .strict(),
  ])
  .superRefine((input, context) => {
    if (!input.scopes.includes("finances:maintain")) {
      context.addIssue({
        code: "custom",
        message: "A Finance automation schedule requires finances:maintain authority.",
        path: ["scopes"],
      });
    }
  });

export const automationHostScheduleCreateInputSchema = automationHostScheduleFieldsSchema;
export type AutomationHostScheduleCreateInput = z.infer<
  typeof automationHostScheduleCreateInputSchema
>;

export const automationHostScheduleStateSchema = z.enum(["active", "paused", "revoked"]);
export type AutomationHostScheduleState = z.infer<typeof automationHostScheduleStateSchema>;

export const automationHostScheduleSchema = automationHostScheduleFieldsSchema.and(
  z
    .object({
      id: idSchema,
      state: automationHostScheduleStateSchema,
      lastObservedAt: isoDateTimeSchema.nullable(),
      version: z.int().positive(),
      createdAt: isoDateTimeSchema,
      updatedAt: isoDateTimeSchema,
    })
    .strict(),
);
export type AutomationHostSchedule = z.infer<typeof automationHostScheduleSchema>;

export const automationHostScheduleUpdateInputSchema = z
  .object({
    expectedVersion: z.int().positive(),
    hostAutomationId: z.string().trim().min(1).max(240).nullable().optional(),
    label: z.string().trim().min(1).max(100).optional(),
    scopes: z
      .array(accessScopeSchema)
      .min(1)
      .max(accessScopeSchema.options.length)
      .transform((values) => [...new Set(values)])
      .optional(),
    state: automationHostScheduleStateSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.hostAutomationId === undefined &&
      input.label === undefined &&
      input.scopes === undefined &&
      input.state === undefined
    ) {
      context.addIssue({ code: "custom", message: "Provide at least one schedule change." });
    }
    if (input.scopes !== undefined && !input.scopes.includes("finances:maintain")) {
      context.addIssue({
        code: "custom",
        message: "A Finance automation schedule requires finances:maintain authority.",
        path: ["scopes"],
      });
    }
  });
export type AutomationHostScheduleUpdateInput = z.infer<
  typeof automationHostScheduleUpdateInputSchema
>;

export const automationHostScheduleHealthSchema = z.object({
  state: z.enum(["unknown", "observed", "expected", "overdue", "paused", "revoked"]),
  lastObservedAt: isoDateTimeSchema.nullable(),
  nextExpectedAt: isoDateTimeSchema.nullable(),
  observedAt: isoDateTimeSchema,
  repairOwner: z.enum(["host"]).nullable(),
});
export type AutomationHostScheduleHealth = z.infer<typeof automationHostScheduleHealthSchema>;

/** Derives observational health only; it never starts, pauses, repairs, or reschedules host work. */
export function observeAutomationHostScheduleHealth(
  rawSchedule: AutomationHostSchedule,
  now: Date,
): AutomationHostScheduleHealth {
  const schedule = automationHostScheduleSchema.parse(rawSchedule);
  const observedAt = now.toISOString();
  if (schedule.state !== "active") {
    return automationHostScheduleHealthSchema.parse({
      state: schedule.state,
      lastObservedAt: schedule.lastObservedAt,
      nextExpectedAt: null,
      observedAt,
      repairOwner: schedule.state === "revoked" ? "host" : null,
    });
  }
  if (schedule.lastObservedAt === null) {
    return automationHostScheduleHealthSchema.parse({
      state: "unknown",
      lastObservedAt: null,
      nextExpectedAt: null,
      observedAt,
      repairOwner: "host",
    });
  }
  if (schedule.trigger.type === "event") {
    return automationHostScheduleHealthSchema.parse({
      state: "observed",
      lastObservedAt: schedule.lastObservedAt,
      nextExpectedAt: null,
      observedAt,
      repairOwner: null,
    });
  }
  const nextExpectedAt = new Date(
    new Date(schedule.lastObservedAt).getTime() + schedule.trigger.expectedIntervalMinutes * 60_000,
  ).toISOString();
  const overdue = now.getTime() > new Date(nextExpectedAt).getTime();
  return automationHostScheduleHealthSchema.parse({
    state: overdue ? "overdue" : "expected",
    lastObservedAt: schedule.lastObservedAt,
    nextExpectedAt,
    observedAt,
    repairOwner: overdue ? "host" : null,
  });
}
