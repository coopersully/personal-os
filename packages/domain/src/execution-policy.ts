import { z } from "zod";
import { assistantDomainSchema } from "./assistant.js";

export const executionPolicySettingsSchema = z
  .object({
    reviewBypassEnabled: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();
export type ExecutionPolicySettings = z.infer<typeof executionPolicySettingsSchema>;

export const updateExecutionPolicySettingsInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reviewBypassEnabled: z.boolean(),
  })
  .strict();
export type UpdateExecutionPolicySettingsInput = z.infer<
  typeof updateExecutionPolicySettingsInputSchema
>;

export const executionPolicyActionSchema = z
  .object({
    domain: assistantDomainSchema,
    operation: z.string().trim().min(1).max(120),
    authority: z.enum([
      "read_only",
      "policy_authorized",
      "approval_required",
      "missing_information",
      "blocked",
      "unsupported",
    ]),
    effect: z.enum(["none", "reversible", "irreversible"]),
    capabilityAvailable: z.boolean(),
    requiredScopeGranted: z.boolean(),
  })
  .strict();
export type ExecutionPolicyAction = z.infer<typeof executionPolicyActionSchema>;

export const executionPolicyDecisionSchema = z
  .object({
    state: z.enum([
      "execute",
      "queue_review",
      "require_approval",
      "needs_input",
      "blocked",
      "unavailable",
    ]),
    reasonCode: z.enum([
      "read_only",
      "registered_bypass",
      "review_required",
      "explicit_approval_required",
      "missing_information",
      "policy_blocked",
      "scope_denied",
      "capability_unavailable",
      "unsupported_operation",
    ]),
  })
  .strict();
export type ExecutionPolicyDecision = z.infer<typeof executionPolicyDecisionSchema>;

/** Operations enter this list only after their action semantics have been independently reviewed. */
export const executionPolicyBypassOperations = {
  finances: [
    "alert",
    "budget_plan",
    "categorization",
    "income_stream",
    "merchant",
    "profile",
    "recurring_obligation",
    "reimbursement",
    "transaction",
    "transaction_breakdown",
  ],
} as const;

export function evaluateExecutionPolicy(
  settings: ExecutionPolicySettings,
  action: ExecutionPolicyAction,
): ExecutionPolicyDecision {
  if (!action.capabilityAvailable) {
    return { state: "unavailable", reasonCode: "capability_unavailable" };
  }
  if (!action.requiredScopeGranted) {
    return { state: "blocked", reasonCode: "scope_denied" };
  }
  if (action.authority === "unsupported") {
    return { state: "unavailable", reasonCode: "unsupported_operation" };
  }
  if (action.authority === "blocked") {
    return { state: "blocked", reasonCode: "policy_blocked" };
  }
  if (action.authority === "missing_information") {
    return { state: "needs_input", reasonCode: "missing_information" };
  }
  if (action.authority === "read_only" && action.effect === "none") {
    return { state: "execute", reasonCode: "read_only" };
  }
  if (action.authority === "approval_required" || action.effect === "irreversible") {
    return { state: "require_approval", reasonCode: "explicit_approval_required" };
  }

  const bypassRegistered =
    action.domain === "finances" &&
    (executionPolicyBypassOperations.finances as readonly string[]).includes(action.operation);
  if (settings.reviewBypassEnabled && bypassRegistered && action.effect === "reversible") {
    return { state: "execute", reasonCode: "registered_bypass" };
  }
  return { state: "queue_review", reasonCode: "review_required" };
}
