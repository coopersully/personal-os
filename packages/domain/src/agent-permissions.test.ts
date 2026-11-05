import { describe, expect, it } from "vitest";
import {
  type AgentActionDescriptor,
  type AgentPermissionPolicy,
  agentCapabilitySchema,
  agentPermissionDefaults,
  resolveAgentPermission,
} from "./agent-permissions.js";

const connection = {
  active: true,
  ownerId: "owner",
  selectedWorkspaces: ["tasks"] as const,
};
const action: AgentActionDescriptor = {
  ownerId: "owner",
  operation: "task.update",
  requiredCapabilities: ["records"],
  risk: "ordinary",
  workspace: "tasks",
};
const policy: AgentPermissionPolicy = {
  ...agentPermissionDefaults,
  adoption: "account",
  version: 1,
};

describe("agent account delegation", () => {
  it("defaults to Cautious, everyday records only and no full access", () => {
    expect(agentPermissionDefaults).toEqual({
      adoption: "account",
      capabilities: {
        records: true,
        settings: false,
        routines: false,
        external: false,
        access: false,
      },
      fullAccess: false,
      mode: "cautious",
    });
  });

  for (let mask = 0; mask < 32; mask++) {
    const capabilities = Object.fromEntries(
      agentCapabilitySchema.options.map((key, index) => [key, Boolean(mask & (1 << index))]),
    ) as AgentPermissionPolicy["capabilities"];
    it(`resolves every standalone and composed grant for combination ${mask}`, () => {
      for (const key of agentCapabilitySchema.options) {
        const requested = { ...action, requiredCapabilities: [key] };
        expect(
          resolveAgentPermission({ ...policy, capabilities }, connection, requested).allowed,
        ).toBe(capabilities[key]);
      }
      expect(
        resolveAgentPermission({ ...policy, capabilities }, connection, {
          ...action,
          requiredCapabilities: ["routines", "external"],
          risk: "dangerous",
        }),
      ).toMatchObject({
        allowed: capabilities.routines && capabilities.external,
        confirmationRequired: capabilities.routines && capabilities.external,
      });
    });
    for (const mode of ["cautious", "eager"] as const) {
      it(`full access overrides saved limits in ${mode}, combination ${mask}`, () => {
        expect(
          resolveAgentPermission({ ...policy, capabilities, fullAccess: true, mode }, connection, {
            ...action,
            workspace: "finances",
            requiredCapabilities: [...agentCapabilitySchema.options],
            risk: "dangerous",
          }),
        ).toMatchObject({ allowed: true, confirmationRequired: mode === "cautious" });
      });
    }
  }

  it("does not widen legacy entitlements or convert legacy bypass into full access", () => {
    expect(
      resolveAgentPermission({ ...policy, adoption: "legacy" }, connection, action),
    ).toMatchObject({ allowed: false, reason: "legacy_policy", confirmationRequired: false });
  });
  it("permits bounded settings reads independently of workspace selection", () => {
    expect(
      resolveAgentPermission(
        { ...policy, capabilities: { ...policy.capabilities, settings: true } },
        connection,
        { ...action, workspace: null, requiredCapabilities: ["settings"] },
      ),
    ).toMatchObject({ allowed: true, confirmationRequired: false });
    expect(
      resolveAgentPermission(policy, connection, { ...action, workspace: "mail" }),
    ).toMatchObject({ allowed: false, reason: "workspace_not_selected" });
  });
  it("never overrides inactive identity or tenant isolation", () => {
    for (const fullAccess of [false, true]) {
      expect(
        resolveAgentPermission({ ...policy, fullAccess }, { ...connection, active: false }, action),
      ).toMatchObject({ allowed: false, reason: "inactive_connection" });
      expect(
        resolveAgentPermission({ ...policy, fullAccess }, connection, {
          ...action,
          ownerId: "other",
        }),
      ).toMatchObject({ allowed: false, reason: "different_owner" });
    }
  });
});

it("preserves the legacy baseline under an explicit temporary full-access override", async () => {
  const { updateAgentPermissionPolicySchema } = await import("./agent-permissions.js");
  expect(
    updateAgentPermissionPolicySchema.safeParse({
      ...agentPermissionDefaults,
      adoption: "legacy",
      fullAccess: true,
      expectedVersion: 1,
    }).success,
  ).toBe(true);
});

it("classifies restoration to legacy execution as dangerous for a Cautious delegated actor", async () => {
  const { isDangerousAgentPolicyChange } = await import("./agent-permissions.js");
  const rootLegacy = { ...policy, adoption: "legacy" as const, fullAccess: true };
  expect(
    isDangerousAgentPolicyChange(rootLegacy, {
      ...agentPermissionDefaults,
      adoption: "legacy",
      expectedVersion: rootLegacy.version,
    }),
  ).toBe(true);
  expect(
    isDangerousAgentPolicyChange(
      { ...policy, fullAccess: true },
      {
        ...agentPermissionDefaults,
        expectedVersion: policy.version,
      },
    ),
  ).toBe(false);
});
