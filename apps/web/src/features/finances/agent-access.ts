import type { FinanceGuidedSetupContext } from "@personal-os/domain";
import {
  type ConnectedHostAuthority,
  type DomainCapability,
  type DomainReadinessItem,
  type DomainSetupStatus,
  type DomainSupport,
  hostPermissionReadiness,
  type Loadable,
  loadingReadiness,
  profileReadiness,
  unavailableReadiness,
  unsupportedCapability,
} from "../agent-access/readiness.js";

export function financeAgentAccessReadiness({
  hosts,
  profile,
  setup,
}: {
  hosts: Loadable<ConnectedHostAuthority[]>;
  profile: Loadable<DomainSetupStatus | undefined>;
  setup: Loadable<FinanceGuidedSetupContext>;
}): DomainReadinessItem[] {
  const access = hostPermissionReadiness({
    hosts,
    label: "Finances",
    readScope: "finances:read",
    writeCapability: "save Finance guidance drafts",
    writeScope: "finances:write",
  });
  if (setup.state !== "ready") {
    const unavailable = setup.state === "unavailable";
    return [
      unavailable
        ? unavailableReadiness("Accounts", "Finance sources are unavailable.")
        : loadingReadiness("Accounts", "Finance sources are loading."),
      profileReadiness("Finances", profile),
      unavailable
        ? unavailableReadiness("Workflow", "Finance workflow status is unavailable.")
        : loadingReadiness("Workflow", "Finance workflows are loading."),
      access,
    ];
  }
  const accountCount = setup.data.accountSources.length;
  const availableWorkflows = setup.data.suggestedWorkflows.filter(
    (workflow) => workflow.available,
  ).length;
  const staleAccounts = setup.data.ledgerHealth.staleAccounts;
  return [
    {
      ...(accountCount === 0
        ? {
            action: { label: "Open Finances", to: "/finances" },
            nextStep: "Connect a Finance account",
          }
        : {}),
      complete: accountCount > 0,
      description: `${accountCount} Finance account${accountCount === 1 ? "" : "s"}${staleAccounts > 0 ? ` · ${staleAccounts} stale` : ""}`,
      title: "Accounts",
    },
    profileReadiness("Finances", profile),
    {
      complete: availableWorkflows > 0,
      description:
        availableWorkflows > 0
          ? `${availableWorkflows} guidance or review ${availableWorkflows === 1 ? "workflow" : "workflows"} ready`
          : "No guidance or review workflow is set up",
      ...(availableWorkflows === 0
        ? { nextStep: "Set up a Finance guidance or review workflow" }
        : {}),
      title: "Workflow",
    },
    access,
  ];
}

export function financeAgentAccessCapability(
  support: DomainSupport,
  invocation: string,
): DomainCapability {
  if (support === "unsupported") return unsupportedCapability("Finance");
  return {
    allowed: ["Read connected Finance material", "Inspect source health", "Draft Finance guidance"],
    approvalRequired: ["Resolve Finance review cases", "Approve profile guidance"],
    sourceScope:
      "Finance permission applies to all connected Finance sources; per-account agent credentials are not available.",
    description:
      support === "executable_rules"
        ? "This deployment publishes Finance guidance, signed-in review, and Finance-owned executable rules."
        : "Finance setup can learn guidance, inspect account-source health, and prepare work for signed-in review. It does not grant transaction-edit authority.",
    setupPrompt: `Use ${invocation} to set up my Finances in Ilo. Inspect account-source health without exposing unnecessary balances, ask the shortest useful guidance interview, save a draft profile, and clearly route required decisions to signed-in Finance review${support === "executable_rules" ? " while using only the Finance-owned rules this deployment publishes" : ""}.`,
    title:
      support === "executable_rules"
        ? "Finance guidance, review, and rules"
        : "Finance guidance and signed-in review",
    unavailable: [
      "Transaction-edit authority",
      "Moving money",
      "Guessing decisions that require signed-in review",
    ],
  };
}
