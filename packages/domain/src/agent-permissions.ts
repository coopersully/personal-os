import { z } from "zod";
import { agentOperationDefinitions } from "./agent-operation-definitions.js";
import { accessScopeSchema } from "./auth.js";
import { idSchema, isoDateTimeSchema } from "./common.js";

export const agentCapabilitySchema = z.enum([
  "records",
  "settings",
  "routines",
  "external",
  "access",
]);
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;
export const agentExecutionModeSchema = z.enum(["cautious", "eager"]);
export const agentCapabilitiesSchema = z
  .object({
    records: z.boolean(),
    settings: z.boolean(),
    routines: z.boolean(),
    external: z.boolean(),
    access: z.boolean(),
  })
  .strict();
export const agentPermissionPolicySchema = z
  .object({
    adoption: z.enum(["legacy", "account"]),
    capabilities: agentCapabilitiesSchema,
    fullAccess: z.boolean(),
    mode: agentExecutionModeSchema,
    version: z.int().positive(),
  })
  .strict();
export type AgentPermissionPolicy = z.infer<typeof agentPermissionPolicySchema>;
export const agentPermissionDefaults = {
  adoption: "account",
  capabilities: { records: true, settings: false, routines: false, external: false, access: false },
  fullAccess: false,
  mode: "cautious",
} as const satisfies Omit<AgentPermissionPolicy, "version">;

export const updateAgentPermissionPolicySchema = agentPermissionPolicySchema
  .omit({ version: true })
  .extend({ expectedVersion: z.int().positive() })
  .strict();
export type UpdateAgentPermissionPolicy = z.infer<typeof updateAgentPermissionPolicySchema>;
/** Resulting authority includes restoration of older execution/confirmation rules. */
export function isDangerousAgentPolicyChange(
  before: AgentPermissionPolicy,
  after: UpdateAgentPermissionPolicy,
): boolean {
  return (
    before.adoption !== after.adoption ||
    (!before.fullAccess && after.fullAccess) ||
    (before.mode === "cautious" && after.mode === "eager") ||
    (before.fullAccess && !after.fullAccess && after.adoption === "legacy") ||
    agentCapabilitySchema.options.some(
      (key) => !before.capabilities[key] && after.capabilities[key],
    )
  );
}

export type AgentWorkspace = "tasks" | "calendar" | "mail" | "finances";

/** Constructed by the owning API operation, never accepted as client authority. */
export type AgentActionDescriptor = {
  ownerId: string;
  operation: string;
  requiredCapabilities: readonly AgentCapability[];
  risk: "ordinary" | "dangerous";
  workspace: AgentWorkspace | null;
};
export type AgentPermissionConnection = {
  active: boolean;
  ownerId: string;
  selectedWorkspaces: readonly AgentWorkspace[];
};
export type AgentPermissionDecision = {
  allowed: boolean;
  confirmationRequired: boolean;
  reason:
    | "allowed"
    | "inactive_connection"
    | "different_owner"
    | "legacy_policy"
    | "workspace_not_selected"
    | "missing_capability";
  missingCapabilities: AgentCapability[];
};

/** Capability resolution does not waive record revisions, provider capability or human confirmation. */
export function resolveAgentPermission(
  policy: AgentPermissionPolicy,
  connection: AgentPermissionConnection,
  action: AgentActionDescriptor,
): AgentPermissionDecision {
  const deny = (
    reason: AgentPermissionDecision["reason"],
    missingCapabilities: AgentCapability[] = [],
  ) => ({ allowed: false, confirmationRequired: false, reason, missingCapabilities });
  if (!connection.active) return deny("inactive_connection");
  if (connection.ownerId !== action.ownerId) return deny("different_owner");
  if (!policy.fullAccess) {
    if (policy.adoption === "legacy") return deny("legacy_policy");
    if (action.workspace && !connection.selectedWorkspaces.includes(action.workspace))
      return deny("workspace_not_selected");
    const missing = action.requiredCapabilities.filter((key) => !policy.capabilities[key]);
    if (missing.length) return deny("missing_capability", [...missing]);
  }
  return {
    allowed: true,
    confirmationRequired: policy.mode === "cautious" && action.risk === "dangerous",
    reason: "allowed",
    missingCapabilities: [],
  };
}

/** Server-authored plain text preview, frozen and hashed with the exact effect. */
export const agentActionReviewSchema = z
  .object({
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(1000),
    details: z
      .array(
        z
          .object({
            label: z.string().min(1).max(80),
            value: z.string().max(100000),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type AgentActionReview = z.infer<typeof agentActionReviewSchema>;

const agentAuthorityOperationSchema = z.enum(
  Object.keys(agentOperationDefinitions) as [
    keyof typeof agentOperationDefinitions,
    ...(keyof typeof agentOperationDefinitions)[],
  ],
);
/** Server preparation only. Drafts cannot be persisted as canonical action snapshots. */
export const agentActionDraftSchema = z
  .object({
    operation: z.string().min(1).max(120),
    authorityOperation: agentAuthorityOperationSchema.optional(),
    review: agentActionReviewSchema.optional(),
    /** Private server-authored review. Randomized envelope is not part of action identity. */
    encryptedPrivateReview: z
      .object({
        contentBinding: z.string().regex(/^[a-f0-9]{64}$/),
        envelope: z
          .object({
            ciphertext: z.string().min(1),
            iv: z.string().min(1),
            tag: z.string().min(1),
            version: z.literal(1),
          })
          .strict(),
      })
      .strict()
      .optional(),
    execution: z
      .object({ mode: agentExecutionModeSchema, risk: z.enum(["ordinary", "dangerous"]) })
      .strict()
      .optional(),
    targets: z.array(z.string().min(1).max(200)).max(100),
    arguments: z.record(z.string(), z.unknown()),
    revisions: z.record(z.string(), z.string().min(1).max(200)),
  })
  .strict();
export type AgentActionDraft = z.infer<typeof agentActionDraftSchema>;
/** Every persisted proposal/origin binds the API registry operation; no unbound compatibility rows. */
export const agentActionSnapshotSchema = agentActionDraftSchema.safeExtend({
  authorityOperation: agentAuthorityOperationSchema,
});
export type AgentActionSnapshot = z.infer<typeof agentActionSnapshotSchema>;
export function bindAgentActionSnapshot(
  action: AgentActionDraft,
  operation: keyof typeof agentOperationDefinitions,
): AgentActionSnapshot {
  return agentActionSnapshotSchema.parse({ ...action, authorityOperation: operation });
}
export const agentConfirmationSchema = z
  .object({
    id: idSchema,
    actorId: idSchema,
    action: agentActionSnapshotSchema,
    policyVersion: z.int().positive(),
    status: z.enum([
      "pending",
      "approved",
      "rejected",
      "claimed",
      "completed",
      "failed",
      "uncertain",
    ]),
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    decidedAt: isoDateTimeSchema.nullable(),
    operationId: idSchema,
  })
  .strict();
export type AgentConfirmation = z.infer<typeof agentConfirmationSchema>;
export const agentConfirmationDecisionSchema = z
  .object({ decision: z.enum(["approve", "reject"]) })
  .strict();

export const agentPolicyUpdateResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("completed"), policy: agentPermissionPolicySchema }),
  z.object({
    status: z.literal("pending_confirmation"),
    confirmation: agentConfirmationSchema,
    reviewPath: z.string(),
  }),
]);
export type AgentPolicyUpdateResult = z.infer<typeof agentPolicyUpdateResultSchema>;

export const agentAuthoritySchema = z
  .object({
    policyVersion: z.int().positive(),
    adoption: z.enum(["legacy", "account"]),
    fullAccess: z.boolean(),
    mode: agentExecutionModeSchema,
    overrideReadOnly: z.boolean(),
    effectiveScopes: z.array(accessScopeSchema),
    allowedOperations: z.array(z.string()),
    confirmationRequiredOperations: z.array(z.string()),
  })
  .strict();
export type AgentAuthority = z.infer<typeof agentAuthoritySchema>;
