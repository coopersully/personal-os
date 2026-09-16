import { z } from "zod";
import { accessScopeSchema } from "./auth.js";
import { idSchema, isoDateTimeSchema, timeZoneSchema } from "./common.js";

export const automationHostSurfaceSchema = z.enum(["codex_desktop", "claude_code_routine"]);
export type AutomationHostSurface = z.infer<typeof automationHostSurfaceSchema>;

const automationHostTimeZoneSchema = timeZoneSchema.refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Use a valid IANA timezone.");

const automationHostLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) =>
      !/\p{Cc}/u.test(value) &&
      value.replace(/\p{Default_Ignorable_Code_Point}/gu, "").trim().length > 0,
    "Label must contain visible characters without controls.",
  );

const accessScopesSchema = z
  .array(accessScopeSchema)
  .min(1)
  .max(accessScopeSchema.options.length)
  .transform((values) => [...new Set(values)]);

const recurringAutomationHostTriggerSchema = z
  .object({
    type: z.literal("recurring"),
    recurrence: z
      .object({
        type: z.literal("interval"),
        everyMinutes: z.int().min(1).max(10_080),
        timeZone: automationHostTimeZoneSchema,
      })
      .strict(),
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

const automationHostScheduleCreateCommonFields = {
  tenantAuthorizationConnectionId: idSchema,
  label: automationHostLabelSchema,
  requestedScopes: accessScopesSchema,
};

export const automationHostScheduleCreateInputSchema = z
  .discriminatedUnion("hostSurface", [
    z
      .object({
        ...automationHostScheduleCreateCommonFields,
        hostSurface: z.literal("codex_desktop"),
        trigger: recurringAutomationHostTriggerSchema,
      })
      .strict(),
    z
      .object({
        ...automationHostScheduleCreateCommonFields,
        hostSurface: z.literal("claude_code_routine"),
        trigger: eventAutomationHostTriggerSchema,
      })
      .strict(),
  ])
  .superRefine((input, context) => {
    if (!input.requestedScopes.includes("finances:maintain")) {
      context.addIssue({
        code: "custom",
        message: "A Finance automation schedule must request finances:maintain authority.",
        path: ["requestedScopes"],
      });
    }
  });
export type AutomationHostScheduleCreateInput = z.infer<
  typeof automationHostScheduleCreateInputSchema
>;

export const automationHostScheduleStateSchema = z.enum([
  "setup_pending",
  "active",
  "paused",
  "cancelled",
  "revoked",
]);
export type AutomationHostScheduleState = z.infer<typeof automationHostScheduleStateSchema>;

const hostAutomationIdSchema = z.string().trim().min(1).max(240);
const automationHostScheduleStoredCommonFields = {
  id: idSchema,
  tenantAuthorizationConnectionId: idSchema,
  label: automationHostLabelSchema,
  effectiveScopes: accessScopesSchema,
  lastObservedAt: isoDateTimeSchema.nullable(),
  version: z.int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};
const codexBoundScheduleFields = {
  ...automationHostScheduleStoredCommonFields,
  hostSurface: z.literal("codex_desktop"),
  hostAutomationId: hostAutomationIdSchema,
  trigger: recurringAutomationHostTriggerSchema,
};
const claudeBoundScheduleFields = {
  ...automationHostScheduleStoredCommonFields,
  hostSurface: z.literal("claude_code_routine"),
  hostAutomationId: hostAutomationIdSchema,
  trigger: eventAutomationHostTriggerSchema,
  nextExpectedAt: z.null(),
};

export const automationHostScheduleSchema = z
  .union([
    z
      .object({
        ...automationHostScheduleStoredCommonFields,
        hostSurface: z.literal("codex_desktop"),
        hostAutomationId: z.null(),
        trigger: recurringAutomationHostTriggerSchema,
        state: z.literal("setup_pending"),
        nextExpectedAt: z.null(),
      })
      .strict(),
    z
      .object({
        ...automationHostScheduleStoredCommonFields,
        hostSurface: z.literal("codex_desktop"),
        hostAutomationId: z.null(),
        trigger: recurringAutomationHostTriggerSchema,
        state: z.literal("cancelled"),
        nextExpectedAt: z.null(),
      })
      .strict(),
    z
      .object({
        ...codexBoundScheduleFields,
        state: z.literal("active"),
        nextExpectedAt: isoDateTimeSchema,
      })
      .strict(),
    z
      .object({
        ...codexBoundScheduleFields,
        state: z.literal("paused"),
        nextExpectedAt: z.null(),
      })
      .strict(),
    z
      .object({
        ...codexBoundScheduleFields,
        state: z.literal("revoked"),
        nextExpectedAt: z.null(),
      })
      .strict(),
    z
      .object({
        ...automationHostScheduleStoredCommonFields,
        hostSurface: z.literal("claude_code_routine"),
        hostAutomationId: z.null(),
        trigger: eventAutomationHostTriggerSchema,
        state: z.literal("setup_pending"),
        nextExpectedAt: z.null(),
      })
      .strict(),
    z
      .object({
        ...automationHostScheduleStoredCommonFields,
        hostSurface: z.literal("claude_code_routine"),
        hostAutomationId: z.null(),
        trigger: eventAutomationHostTriggerSchema,
        state: z.literal("cancelled"),
        nextExpectedAt: z.null(),
      })
      .strict(),
    z
      .object({
        ...claudeBoundScheduleFields,
        state: z.literal("active"),
      })
      .strict(),
    z
      .object({
        ...claudeBoundScheduleFields,
        state: z.literal("paused"),
      })
      .strict(),
    z
      .object({
        ...claudeBoundScheduleFields,
        state: z.literal("revoked"),
      })
      .strict(),
  ])
  .superRefine((input, context) => {
    if (!input.effectiveScopes.includes("finances:maintain")) {
      context.addIssue({
        code: "custom",
        message:
          "A stored Finance automation schedule requires effective finances:maintain authority.",
        path: ["effectiveScopes"],
      });
    }
  });
export type AutomationHostSchedule = z.infer<typeof automationHostScheduleSchema>;

const automationHostScheduleBindCommonFields = {
  expectedVersion: z.int().positive(),
  expectedState: z.literal("setup_pending"),
  hostAutomationId: hostAutomationIdSchema,
};

export const automationHostScheduleBindInputSchema = z.discriminatedUnion("hostSurface", [
  z
    .object({
      ...automationHostScheduleBindCommonFields,
      hostSurface: z.literal("codex_desktop"),
      nextExpectedAt: isoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      ...automationHostScheduleBindCommonFields,
      hostSurface: z.literal("claude_code_routine"),
    })
    .strict(),
]);
export type AutomationHostScheduleBindInput = z.infer<typeof automationHostScheduleBindInputSchema>;

export const automationHostScheduleUpdateInputSchema = z
  .object({
    expectedVersion: z.int().positive(),
    label: automationHostLabelSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.label === undefined) {
      context.addIssue({ code: "custom", message: "Provide at least one schedule change." });
    }
  });
export type AutomationHostScheduleUpdateInput = z.infer<
  typeof automationHostScheduleUpdateInputSchema
>;

export const automationHostScheduleCancelInputSchema = z
  .object({
    expectedVersion: z.int().positive(),
    expectedState: z.literal("setup_pending"),
  })
  .strict();
export type AutomationHostScheduleCancelInput = z.infer<
  typeof automationHostScheduleCancelInputSchema
>;

export const automationHostScheduleRevokeInputSchema = z
  .object({
    expectedVersion: z.int().positive(),
    expectedState: z.enum(["active", "paused"]),
  })
  .strict();
export type AutomationHostScheduleRevokeInput = z.infer<
  typeof automationHostScheduleRevokeInputSchema
>;

const automationHostScheduleObservationCommonFields = {
  expectedVersion: z.int().positive(),
  expectedState: z.enum(["active", "paused"]),
  observedAt: isoDateTimeSchema,
};

const activeCodexScheduleObservationInputSchema = z
  .object({
    ...automationHostScheduleObservationCommonFields,
    hostSurface: z.literal("codex_desktop"),
    observedState: z.literal("active"),
    nextExpectedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (new Date(input.nextExpectedAt).getTime() <= new Date(input.observedAt).getTime()) {
      context.addIssue({
        code: "custom",
        message: "An active recurring schedule requires a future expected host slot.",
        path: ["nextExpectedAt"],
      });
    }
  });

export const automationHostScheduleObservationInputSchema = z.union([
  activeCodexScheduleObservationInputSchema,
  z
    .object({
      ...automationHostScheduleObservationCommonFields,
      hostSurface: z.literal("codex_desktop"),
      observedState: z.literal("paused"),
      nextExpectedAt: z.null().default(null),
    })
    .strict(),
  z
    .object({
      ...automationHostScheduleObservationCommonFields,
      hostSurface: z.literal("claude_code_routine"),
      observedState: z.literal("active"),
    })
    .strict(),
  z
    .object({
      ...automationHostScheduleObservationCommonFields,
      hostSurface: z.literal("claude_code_routine"),
      observedState: z.literal("paused"),
    })
    .strict(),
]);
export type AutomationHostScheduleObservationInput = z.infer<
  typeof automationHostScheduleObservationInputSchema
>;

export const automationHostScheduleHealthSchema = z.object({
  state: z.enum([
    "setup_pending",
    "unknown",
    "observed",
    "expected",
    "overdue",
    "paused",
    "cancelled",
    "revoked",
  ]),
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
  if (schedule.state === "setup_pending") {
    return automationHostScheduleHealthSchema.parse({
      state: "setup_pending",
      lastObservedAt: schedule.lastObservedAt,
      nextExpectedAt: null,
      observedAt,
      repairOwner: null,
    });
  }
  if (schedule.state !== "active") {
    return automationHostScheduleHealthSchema.parse({
      state: schedule.state,
      lastObservedAt: schedule.lastObservedAt,
      nextExpectedAt: null,
      observedAt,
      repairOwner: null,
    });
  }
  if (schedule.trigger.type === "event") {
    return automationHostScheduleHealthSchema.parse({
      state: schedule.lastObservedAt === null ? "unknown" : "observed",
      lastObservedAt: schedule.lastObservedAt,
      nextExpectedAt: null,
      observedAt,
      repairOwner: schedule.lastObservedAt === null ? "host" : null,
    });
  }
  if (schedule.nextExpectedAt === null) {
    throw new Error("A bound recurring schedule requires its next expected host slot.");
  }
  const overdue = now.getTime() > new Date(schedule.nextExpectedAt).getTime();
  return automationHostScheduleHealthSchema.parse({
    state: overdue ? "overdue" : "expected",
    lastObservedAt: schedule.lastObservedAt,
    nextExpectedAt: schedule.nextExpectedAt,
    observedAt,
    repairOwner: overdue ? "host" : null,
  });
}
