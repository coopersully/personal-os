import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { maintenanceRunStatusSchema } from "../maintenance.js";
import { financeConversationSequenceSchema } from "./conversation.js";

export const refreshFinanceMaintenanceExecutionInputSchema = z.strictObject({
  operationId: idSchema,
  candidateId: idSchema,
  candidateRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  expectedCurrentActorId: idSchema,
  expectedBindingRevision: financeConversationSequenceSchema,
  expectedRunUpdatedAt: isoDateTimeSchema,
});
export type RefreshFinanceMaintenanceExecutionInput = z.infer<
  typeof refreshFinanceMaintenanceExecutionInputSchema
>;
export const financeMaintenanceExecutionRefreshResultSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("pending"),
    operationId: idSchema,
    reason: z.enum(["active_claim", "control_progression"]),
    retryAt: isoDateTimeSchema.nullable(),
  }),
  z.strictObject({
    state: z.literal("refreshed"),
    operationId: idSchema,
    bindingId: idSchema,
    bindingRevision: financeConversationSequenceSchema,
    currentActorId: idSchema,
  }),
  z.strictObject({
    state: z.literal("blocked"),
    operationId: idSchema,
    reason: z.enum([
      "source_changed",
      "binding_unavailable",
      "lineage_unproven",
      "economic_reconciliation_required",
      "terminal_or_superseded",
    ]),
  }),
]);
export type FinanceMaintenanceExecutionRefreshResult = z.infer<
  typeof financeMaintenanceExecutionRefreshResultSchema
>;
/** Scheduling only. A prepared candidate has no binding until authenticated submit. */
export type FinanceMaintenanceControlInput =
  | {
      kind: "prepared_without_binding";
      runId: string;
      candidateId: string;
      candidateRevision: string;
    }
  | {
      kind: "submitted_with_binding";
      runId: string;
      candidateId: string;
      candidateRevision: string;
      expectedBindingRevision: string;
    };
export const FINANCE_EXECUTION_REFRESH_MAX_ATTEMPTS = 5;
export function financeExecutionRefreshDelay(
  attempt: number,
  now: number,
  leaseDeadline: number | null,
): number | null {
  if (
    !Number.isInteger(attempt) ||
    attempt < 0 ||
    attempt >= FINANCE_EXECUTION_REFRESH_MAX_ATTEMPTS
  )
    return null;
  return Math.max(Math.min(30_000, 1000 * 2 ** attempt), Math.max(0, (leaseDeadline ?? now) - now));
}

export const financeMaintenanceExecutionObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unavailable"), reason: z.literal("binding_unavailable") }),
  z.strictObject({
    state: z.literal("available"),
    runId: idSchema,
    candidateId: idSchema,
    candidateRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    currentActorId: idSchema,
    bindingRevision: financeConversationSequenceSchema,
    runUpdatedAt: isoDateTimeSchema,
    status: maintenanceRunStatusSchema,
    leaseExpiresAt: isoDateTimeSchema.nullable(),
  }),
]);
export type FinanceMaintenanceExecutionObservation = z.infer<
  typeof financeMaintenanceExecutionObservationSchema
>;
