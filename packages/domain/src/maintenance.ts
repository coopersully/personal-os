import { z } from "zod";
import { assistantDomainSchema } from "./assistant.js";
import { idSchema, isoDateTimeSchema } from "./common.js";

const dateOnlySchema = z.iso.date();
const entityTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/u);

const maintenanceWindowScopeSchema = z
  .object({
    type: z.literal("window"),
    start: dateOnlySchema,
    end: dateOnlySchema,
  })
  .refine(({ end, start }) => start <= end, {
    message: "The maintenance window end must be on or after its start.",
    path: ["end"],
  });

export const maintenanceScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all_outstanding") }),
  maintenanceWindowScopeSchema,
  z.object({ type: z.literal("target"), entityType: entityTypeSchema, id: idSchema }),
]);
export type MaintenanceScope = z.infer<typeof maintenanceScopeSchema>;

const maintenanceScopeQueryInputSchema = z
  .object({
    scope: z.literal("all_outstanding").optional(),
    start: dateOnlySchema.optional(),
    end: dateOnlySchema.optional(),
    entityType: entityTypeSchema.optional(),
    targetId: idSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    const hasScope = query.scope !== undefined;
    const hasWindowMember = query.start !== undefined || query.end !== undefined;
    const hasTargetMember = query.entityType !== undefined || query.targetId !== undefined;
    const completeWindow = query.start !== undefined && query.end !== undefined;
    const completeTarget = query.entityType !== undefined && query.targetId !== undefined;

    if ((hasWindowMember && !completeWindow) || (hasTargetMember && !completeTarget)) {
      context.addIssue({
        code: "custom",
        message: "Maintenance window and target query fields must be supplied in pairs.",
      });
    }
    if ([hasScope, hasWindowMember, hasTargetMember].filter(Boolean).length > 1) {
      context.addIssue({
        code: "custom",
        message: "Choose exactly one maintenance scope query form.",
      });
    }
    if (completeWindow && (query.start as string) > (query.end as string)) {
      context.addIssue({
        code: "custom",
        message: "The maintenance window end must be on or after its start.",
        path: ["end"],
      });
    }
  });

export const maintenanceScopeQuerySchema = maintenanceScopeQueryInputSchema.transform(
  (query): MaintenanceScope => {
    if (query.start !== undefined && query.end !== undefined) {
      return { type: "window", start: query.start, end: query.end };
    }
    if (query.entityType !== undefined && query.targetId !== undefined) {
      return { type: "target", entityType: query.entityType, id: query.targetId };
    }
    return { type: "all_outstanding" };
  },
);

export const maintenanceRequestSchema = z.object({
  scope: maintenanceScopeSchema.default({ type: "all_outstanding" }),
});

export const workspaceBlockerSchema = z.object({
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1_000),
  recovery: z.string().trim().min(1).max(500).nullable().default(null),
});
export type WorkspaceBlocker = z.infer<typeof workspaceBlockerSchema>;

export const workspaceFreshnessSchema = z.object({
  observedAt: isoDateTimeSchema,
  state: z.enum(["current", "stale", "partial", "unavailable"]),
  blockers: z.array(workspaceBlockerSchema).max(100),
});
export type WorkspaceFreshness = z.infer<typeof workspaceFreshnessSchema>;

export const maintenanceWorkCountsSchema = z.object({
  actionable: z.int().nonnegative(),
  awaitingApproval: z.int().nonnegative(),
  awaitingInput: z.int().nonnegative(),
  blocked: z.int().nonnegative(),
  oldestOutstandingAt: isoDateTimeSchema.nullable(),
});
export type MaintenanceWorkCounts = z.infer<typeof maintenanceWorkCountsSchema>;

export const maintenanceOperationSchema = z.object({
  operation: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  href: z.string().startsWith("/").max(2_000).nullable().default(null),
});
export type MaintenanceOperation = z.infer<typeof maintenanceOperationSchema>;

export const maintenanceRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "completed_with_questions",
  "awaiting_agent_challenge",
  "awaiting_approval",
  "blocked",
  "failed_recoverable",
  "failed_terminal",
]);
export type MaintenanceRunStatus = z.infer<typeof maintenanceRunStatusSchema>;

export const maintenanceSettlementStatusSchema = z.enum([
  "completed",
  "completed_with_questions",
  "awaiting_agent_challenge",
  "awaiting_approval",
  "blocked",
  "failed_recoverable",
  "failed_terminal",
]);
export type MaintenanceSettlementStatus = z.infer<typeof maintenanceSettlementStatusSchema>;

const maintenanceSafeErrorSchema = z.object({
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1_000),
});

const maintenanceRunBaseSchema = z.object({
  id: idSchema,
  userId: idSchema,
  domain: assistantDomainSchema,
  scope: maintenanceScopeSchema,
  rulebookVersion: z.string().trim().min(1).max(200),
  sourceSnapshot: z.unknown().nullable(),
  checkpoint: z.unknown().nullable(),
  lastSafeError: maintenanceSafeErrorSchema.nullable(),
  settledResult: z.unknown().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const maintenanceRunSchema = z.discriminatedUnion("status", [
  maintenanceRunBaseSchema.extend({
    status: z.literal("queued"),
    leaseExpiresAt: z.null(),
    retryAt: z.null(),
  }),
  maintenanceRunBaseSchema.extend({
    status: z.literal("running"),
    leaseExpiresAt: isoDateTimeSchema,
    retryAt: z.null(),
  }),
  maintenanceRunBaseSchema.extend({
    status: z.literal("completed"),
    leaseExpiresAt: z.null(),
    retryAt: z.null(),
  }),
  maintenanceRunBaseSchema.extend({
    status: z.literal("completed_with_questions"),
    leaseExpiresAt: z.null(),
    retryAt: z.null(),
  }),
  maintenanceRunBaseSchema.extend({
    status: z.literal("awaiting_agent_challenge"),
    leaseExpiresAt: z.null(),
    retryAt: z.null(),
  }),
  maintenanceRunBaseSchema.extend({
    status: z.literal("awaiting_approval"),
    leaseExpiresAt: z.null(),
    retryAt: z.null(),
  }),
  maintenanceRunBaseSchema.extend({
    status: z.literal("blocked"),
    leaseExpiresAt: z.null(),
    retryAt: z.null(),
  }),
  maintenanceRunBaseSchema.extend({
    status: z.literal("failed_recoverable"),
    leaseExpiresAt: z.null(),
    retryAt: isoDateTimeSchema,
  }),
  maintenanceRunBaseSchema.extend({
    status: z.literal("failed_terminal"),
    leaseExpiresAt: z.null(),
    retryAt: z.null(),
  }),
]);
export type MaintenanceRun = z.infer<typeof maintenanceRunSchema>;

export const maintenanceRunSummarySchema = z.object({
  id: idSchema,
  domain: assistantDomainSchema,
  scope: maintenanceScopeSchema,
  status: maintenanceRunStatusSchema,
  rulebookVersion: z.string().trim().min(1).max(200),
  updatedAt: isoDateTimeSchema,
});
export type MaintenanceRunSummary = z.infer<typeof maintenanceRunSummarySchema>;

export const maintenanceStepResultSchema = z.object({
  step: z.string().trim().min(1).max(100),
  status: z.enum(["completed", "failed_recoverable", "failed_terminal"]),
  attemptCount: z.int().positive(),
  idempotencyKey: z.string().trim().min(1).max(200),
  result: z.unknown().nullable(),
  error: maintenanceSafeErrorSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export type MaintenanceStepResult = z.infer<typeof maintenanceStepResultSchema>;

export const maintenanceVerificationSchema = z.object({
  checkedAt: isoDateTimeSchema,
  status: z.enum(["passed", "questions", "blocked", "failed"]),
  blockers: z.array(workspaceBlockerSchema).max(100),
});
export type MaintenanceVerification = z.infer<typeof maintenanceVerificationSchema>;

export const workspaceStatusSchema = <TDetails extends z.ZodType>(details: TDetails) =>
  z.object({
    asOf: isoDateTimeSchema,
    domain: assistantDomainSchema,
    state: z.enum(["clean", "needs_work", "needs_input", "blocked"]),
    freshness: workspaceFreshnessSchema,
    work: maintenanceWorkCountsSchema,
    activeRun: maintenanceRunSummarySchema.nullable(),
    details,
    validNextOperations: z.array(maintenanceOperationSchema).max(100),
  });
export type WorkspaceStatus<TDetails> = z.infer<
  ReturnType<typeof workspaceStatusSchema<z.ZodType<TDetails>>>
>;

export type FinanceMaintenanceRun = MaintenanceRun;

export const financeMaintenanceDispatchResultSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  run: maintenanceRunSchema,
  verification: maintenanceVerificationSchema.nullable(),
});
export type FinanceMaintenanceDispatchResult = z.infer<
  typeof financeMaintenanceDispatchResultSchema
>;
