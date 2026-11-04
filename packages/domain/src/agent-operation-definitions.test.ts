import { describe, expect, it } from "vitest";
import {
  type AgentOperationDefinition,
  agentOperationConnectionSelected,
  agentOperationDefinitions,
  agentOperationRequiredCapabilities,
} from "./agent-operation-definitions.js";
import {
  type AgentActionDraft,
  type AgentPermissionPolicy,
  agentActionDraftSchema,
  agentActionSnapshotSchema,
  agentPermissionDefaults,
  agentPermissionPolicySchema,
  bindAgentActionSnapshot,
  isDangerousAgentPolicyChange,
  resolveAgentPermission,
} from "./agent-permissions.js";
import type { AccessScope } from "./auth.js";

const policy: AgentPermissionPolicy = { ...agentPermissionDefaults, version: 1 };
const connection = {
  active: true,
  ownerId: "owner",
  selectedWorkspaces: ["finances"] as const,
};
const draft: AgentActionDraft = {
  operation: "account.policy.change",
  targets: ["owner"],
  arguments: { mode: "eager" },
  revisions: { policy: "1" },
};

/** These pure contracts do not prove any API writer uses the registry or resolver. */
describe("unconsumed agent operation contracts", () => {
  it.each([
    "finances:read",
    "texting:read",
  ] as const)("requires every selected read scope, including %s", (omitted) => {
    const definition = agentOperationDefinitions.get_notification_settings;
    const all: AccessScope[] = ["finances:read", "texting:read"];
    expect(agentOperationConnectionSelected(definition, new Set(all))).toBe(true);
    expect(
      agentOperationConnectionSelected(definition, new Set(all.filter((s) => s !== omitted))),
    ).toBe(false);
  });

  it("does not treat absent selected-scope metadata as a runtime authorization grant", () => {
    expect(
      agentOperationConnectionSelected(
        agentOperationDefinitions.get_agent_permission_policy,
        new Set(),
      ),
    ).toBe(true);
    expect(
      resolveAgentPermission(
        policy,
        { ...connection, active: false },
        {
          ownerId: "owner",
          operation: "get_agent_permission_policy",
          requiredCapabilities: [],
          workspace: null,
          risk: "ordinary",
        },
      ),
    ).toMatchObject({ allowed: false, reason: "inactive_connection" });
  });

  it("permits the access alternative only for a declared supporting read", () => {
    const definition = agentOperationDefinitions.get_execution_policy_settings;
    expect(agentOperationRequiredCapabilities(definition, policy)).toEqual(["settings"]);
    expect(
      agentOperationRequiredCapabilities(definition, {
        capabilities: { ...policy.capabilities, access: true },
      }),
    ).toEqual(["access"]);
  });

  it.each([
    { readOnly: false, supportingRead: true },
    { readOnly: true, supportingRead: false },
  ])("never applies supporting-read alternatives for %j", (flags) => {
    const definition: AgentOperationDefinition = {
      ...agentOperationDefinitions.get_execution_policy_settings,
      ...flags,
      capabilities: ["routines", "external"],
    };
    expect(
      agentOperationRequiredCapabilities(definition, {
        capabilities: { ...policy.capabilities, access: true },
      }),
    ).toEqual(["routines", "external"]);
  });

  it.each([
    "cautious",
    "eager",
  ] as const)("requires records, access and external for duplicate resolution in %s", (mode) => {
    const definition = agentOperationDefinitions.resolve_finance_account_duplicate;
    expect(definition.capabilities).toEqual(["records", "access", "external"]);
    const action = {
      ownerId: "owner",
      operation: "resolve_finance_account_duplicate",
      requiredCapabilities: definition.capabilities,
      workspace: definition.workspace,
      risk: definition.risk,
    };
    const capabilities = { ...policy.capabilities, access: true, external: true };
    expect(
      resolveAgentPermission({ ...policy, mode, capabilities }, connection, action),
    ).toMatchObject({
      allowed: true,
      confirmationRequired: mode === "cautious",
    });
    for (const missing of ["records", "access", "external"] as const) {
      expect(
        resolveAgentPermission(
          { ...policy, mode, capabilities: { ...capabilities, [missing]: false } },
          connection,
          action,
        ),
      ).toMatchObject({
        allowed: false,
        reason: "missing_capability",
        missingCapabilities: [missing],
      });
    }
  });

  it.each([
    "cautious",
    "eager",
  ] as const)("binds registered workspace metadata without changing unrelated authority in %s", (mode) => {
    const currentPolicy = { ...policy, mode };
    const definition = agentOperationDefinitions.apply_finance_provider_snapshot;
    const action = {
      ownerId: "owner",
      operation: "apply_finance_provider_snapshot",
      requiredCapabilities: definition.capabilities,
      workspace: definition.workspace,
      risk: definition.risk,
    };
    const tasksOnly = { ...connection, selectedWorkspaces: ["tasks"] as const };
    for (const workspace of [null, "tasks"] as const) {
      expect(
        resolveAgentPermission(currentPolicy, tasksOnly, { ...action, workspace }),
      ).toMatchObject({ allowed: false, reason: "workspace_not_selected" });
      expect(
        resolveAgentPermission(currentPolicy, connection, { ...action, workspace }),
      ).toMatchObject({ allowed: false, reason: "workspace_not_selected" });
    }
    expect(resolveAgentPermission(currentPolicy, tasksOnly, action)).toMatchObject({
      allowed: false,
      reason: "workspace_not_selected",
    });
    expect(resolveAgentPermission(currentPolicy, connection, action)).toMatchObject({
      allowed: true,
      confirmationRequired: false,
    });
    expect(
      resolveAgentPermission(
        { ...currentPolicy, capabilities: { ...policy.capabilities, records: false } },
        connection,
        action,
      ),
    ).toMatchObject({ allowed: false, reason: "missing_capability" });
    const unscoped = {
      ...action,
      operation: "get_agent_permission_policy",
      requiredCapabilities: [],
      workspace: null,
    };
    expect(resolveAgentPermission(currentPolicy, tasksOnly, unscoped).allowed).toBe(true);
    for (const operation of ["task.update", "toString", "__proto__"]) {
      expect(
        resolveAgentPermission(currentPolicy, tasksOnly, {
          ...action,
          operation,
          workspace: "tasks",
        }).allowed,
      ).toBe(true);
    }
    const contradictory = { ...action, workspace: null, risk: "dangerous" as const };
    expect(
      resolveAgentPermission({ ...currentPolicy, adoption: "legacy" }, tasksOnly, contradictory),
    ).toMatchObject({ allowed: false, reason: "legacy_policy" });
    const rootPolicy = {
      ...currentPolicy,
      adoption: "legacy" as const,
      fullAccess: true,
      capabilities: { ...policy.capabilities, records: false },
    };
    expect(resolveAgentPermission(rootPolicy, tasksOnly, contradictory)).toMatchObject({
      allowed: true,
      confirmationRequired: mode === "cautious",
    });
    for (const fullAccess of [false, true]) {
      const identityPolicy = { ...currentPolicy, adoption: "legacy" as const, fullAccess };
      expect(
        resolveAgentPermission(
          identityPolicy,
          { ...tasksOnly, active: false, ownerId: "other" },
          contradictory,
        ),
      ).toMatchObject({ allowed: false, reason: "inactive_connection" });
      expect(
        resolveAgentPermission(identityPolicy, { ...tasksOnly, ownerId: "other" }, contradictory),
      ).toMatchObject({ allowed: false, reason: "different_owner" });
    }
  });

  it.each([
    "cautious",
    "eager",
  ] as const)("enforces the canonical capability and risk floor in %s", (mode) => {
    const action = {
      ownerId: "owner",
      operation: "update_execution_policy_settings",
      workspace: null,
      requiredCapabilities: [],
      risk: "ordinary" as const,
    };
    expect(resolveAgentPermission({ ...policy, mode }, connection, action)).toMatchObject({
      allowed: false,
      reason: "missing_capability",
      missingCapabilities: ["access"],
    });
    expect(
      resolveAgentPermission(
        { ...policy, mode, capabilities: { ...policy.capabilities, access: true } },
        connection,
        action,
      ),
    ).toMatchObject({ allowed: true, confirmationRequired: mode === "cautious" });
  });

  it.each([
    "cautious",
    "eager",
  ] as const)("preserves stronger descriptor constraints in %s", (mode) => {
    const action = {
      ownerId: "owner",
      operation: "apply_finance_provider_snapshot",
      workspace: "finances" as const,
      requiredCapabilities: ["external"] as const,
      risk: "dangerous" as const,
    };
    expect(resolveAgentPermission({ ...policy, mode }, connection, action)).toMatchObject({
      allowed: false,
      reason: "missing_capability",
      missingCapabilities: ["external"],
    });
    const allowedPolicy = {
      ...policy,
      mode,
      capabilities: { ...policy.capabilities, external: true },
    };
    expect(resolveAgentPermission(allowedPolicy, connection, action)).toMatchObject({
      allowed: true,
      confirmationRequired: mode === "cautious",
    });
    expect(
      resolveAgentPermission(
        { ...allowedPolicy, capabilities: { ...allowedPolicy.capabilities, records: false } },
        connection,
        action,
      ),
    ).toMatchObject({ allowed: false, missingCapabilities: ["records"] });
  });

  it.each([
    "cautious",
    "eager",
  ] as const)("keeps supporting read alternatives and explicit extras in %s", (mode) => {
    const action = {
      ownerId: "owner",
      operation: "get_execution_policy_settings",
      workspace: null,
      requiredCapabilities: [],
      risk: "ordinary" as const,
    };
    expect(resolveAgentPermission({ ...policy, mode }, connection, action)).toMatchObject({
      allowed: false,
      reason: "missing_capability",
      missingCapabilities: ["settings"],
    });
    for (const alternative of ["settings", "access"] as const) {
      const readPolicy = {
        ...policy,
        mode,
        capabilities: { ...policy.capabilities, [alternative]: true },
      };
      expect(resolveAgentPermission(readPolicy, connection, action)).toMatchObject({
        allowed: true,
        confirmationRequired: false,
      });
      const constrained = { ...action, requiredCapabilities: ["external"] as const };
      expect(resolveAgentPermission(readPolicy, connection, constrained)).toMatchObject({
        allowed: false,
        missingCapabilities: ["external"],
      });
      expect(
        resolveAgentPermission(
          { ...readPolicy, capabilities: { ...readPolicy.capabilities, external: true } },
          connection,
          constrained,
        ),
      ).toMatchObject({ allowed: true });
    }
    expect(
      resolveAgentPermission(
        { ...policy, mode, capabilities: { ...policy.capabilities, access: true } },
        connection,
        { ...action, requiredCapabilities: ["settings"] },
      ),
    ).toMatchObject({ allowed: false, missingCapabilities: ["settings"] });
  });

  it.each([
    "cautious",
    "eager",
  ] as const)("preserves identity, legacy and full access ordering in %s", (mode) => {
    const action = {
      ownerId: "owner",
      operation: "update_execution_policy_settings",
      workspace: "tasks" as const,
      requiredCapabilities: ["external"] as const,
      risk: "ordinary" as const,
    };
    const legacy = { ...policy, mode, adoption: "legacy" as const };
    expect(resolveAgentPermission(legacy, connection, action)).toMatchObject({
      allowed: false,
      reason: "legacy_policy",
      confirmationRequired: false,
    });
    const rootPolicy = { ...legacy, fullAccess: true };
    expect(resolveAgentPermission(rootPolicy, connection, action)).toMatchObject({
      allowed: true,
      confirmationRequired: mode === "cautious",
    });
    for (const fullAccess of [false, true]) {
      const identityPolicy = { ...legacy, fullAccess };
      expect(
        resolveAgentPermission(
          identityPolicy,
          { ...connection, active: false, ownerId: "other" },
          action,
        ),
      ).toMatchObject({ allowed: false, reason: "inactive_connection" });
      expect(
        resolveAgentPermission(identityPolicy, { ...connection, ownerId: "other" }, action),
      ).toMatchObject({ allowed: false, reason: "different_owner" });
    }
    for (const operation of ["task.update", "toString", "__proto__"]) {
      const unknown = {
        ...action,
        operation,
        workspace: null,
        requiredCapabilities: [],
        risk: "dangerous" as const,
      };
      expect(resolveAgentPermission({ ...policy, mode }, connection, unknown)).toMatchObject({
        allowed: true,
        confirmationRequired: mode === "cautious",
      });
      expect(
        resolveAgentPermission({ ...policy, mode }, connection, {
          ...unknown,
          requiredCapabilities: ["external"],
        }),
      ).toMatchObject({ allowed: false, missingCapabilities: ["external"] });
    }
  });

  it.each([
    "cautious",
    "eager",
  ] as const)("deduplicates canonical and explicit requirements in %s", (mode) => {
    expect(
      resolveAgentPermission(
        { ...policy, mode, capabilities: { ...policy.capabilities, records: false } },
        connection,
        {
          ownerId: "owner",
          operation: "apply_finance_provider_snapshot",
          workspace: "finances",
          requiredCapabilities: ["records", "records", "external"],
          risk: "ordinary",
        },
      ),
    ).toMatchObject({ allowed: false, missingCapabilities: ["records", "external"] });
  });

  it("preserves legacy adoption instead of converting the saved default into live authority", () => {
    const action = {
      ownerId: "owner",
      operation: "update_agent_permission_policy",
      requiredCapabilities: ["access"] as const,
      workspace: null,
      risk: "dangerous" as const,
    };
    expect(
      resolveAgentPermission({ ...policy, adoption: "legacy", mode: "eager" }, connection, action),
    ).toMatchObject({ allowed: false, reason: "legacy_policy" });
    expect(
      resolveAgentPermission(
        { ...policy, adoption: "legacy", fullAccess: true },
        connection,
        action,
      ),
    ).toMatchObject({ allowed: true, confirmationRequired: true });
    expect(policy.adoption).toBe("account");
    expect(policy.fullAccess).toBe(false);
  });

  it.each([
    "adoption",
    "mode",
    "access",
  ] as const)("classifies %s escalation as dangerous", (kind) => {
    const before = kind === "adoption" ? { ...policy, adoption: "legacy" as const } : policy;
    expect(
      isDangerousAgentPolicyChange(before, {
        ...agentPermissionDefaults,
        ...(kind === "mode" ? { mode: "eager" as const } : {}),
        ...(kind === "access" ? { capabilities: { ...policy.capabilities, access: true } } : {}),
        expectedVersion: 1,
      }),
    ).toBe(true);
  });

  it("requires a registry operation on every canonical snapshot while permitting an unbound draft", () => {
    expect(agentActionDraftSchema.safeParse(draft).success).toBe(true);
    expect(agentActionSnapshotSchema.safeParse(draft).success).toBe(false);
    expect(bindAgentActionSnapshot(draft, "update_agent_permission_policy")).toMatchObject({
      operation: draft.operation,
      authorityOperation: "update_agent_permission_policy",
      revisions: draft.revisions,
    });
  });

  it("rejects unknown authority operation names and extras rather than trusting a caller label", () => {
    expect(
      agentActionSnapshotSchema.safeParse({ ...draft, authorityOperation: "unknown_operation" })
        .success,
    ).toBe(false);
    expect(
      agentActionSnapshotSchema.safeParse({
        ...draft,
        authorityOperation: "update_agent_permission_policy",
        approved: true,
      }).success,
    ).toBe(false);
  });

  it.each([
    { mode: "automatic" },
    { capabilities: { ...policy.capabilities, money: true } },
  ])("rejects unsupported policy vocabulary %j", (change) => {
    expect(agentPermissionPolicySchema.safeParse({ ...policy, ...change }).success).toBe(false);
  });
});
