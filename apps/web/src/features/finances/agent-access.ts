import type { AttentionItem, FinanceGuidedSetupContext } from "@personal-os/domain";
import {
  attentionReadiness,
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
  attention,
  hosts,
  profile,
  setup,
}: {
  attention: Loadable<AttentionItem[]>;
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
        ? unavailableReadiness("Finance material", "Finance sources are unavailable.")
        : loadingReadiness("Finance material", "Finance sources are loading."),
      profileReadiness("Finances", profile),
      unavailable
        ? unavailableReadiness("Finance workflow", "Finance workflow readiness is unavailable.")
        : loadingReadiness("Finance workflow", "Finance workflows are loading."),
      attentionReadiness("Finances", attention),
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
      title: "Finance material",
    },
    profileReadiness("Finances", profile),
    {
      complete: availableWorkflows > 0,
      description: `${availableWorkflows} guidance or review workflow${availableWorkflows === 1 ? "" : "s"} available · ${setup.data.reviewSummary.count} item${setup.data.reviewSummary.count === 1 ? "" : "s"} ${setup.data.reviewSummary.count === 1 ? "needs" : "need"} signed-in review.`,
      ...(availableWorkflows === 0
        ? { nextStep: "Set up a Finance guidance or review workflow" }
        : {}),
      title: "Finance workflow",
    },
    attentionReadiness("Finances", attention),
    access,
  ];
}

export function financeAgentAccessCapability(
  support: DomainSupport,
  invocation: string,
): DomainCapability {
  if (support === "unsupported") return unsupportedCapability("Finance");
  return {
    description:
      support === "executable_rules"
        ? "This deployment publishes Finance guidance, signed-in review, and Finance-owned executable rules."
        : "Finance setup can learn guidance, inspect account-source health, and prepare work for signed-in review. It does not grant transaction-edit authority.",
    setupPrompt: `Use ${invocation} to set up my Finances in Ilo. Inspect account-source health without exposing unnecessary balances, ask the shortest useful guidance interview, save a draft profile, and clearly route required decisions to signed-in Finance review${support === "executable_rules" ? " while using only the Finance-owned rules this deployment publishes" : ""}.`,
    title:
      support === "executable_rules"
        ? "Finance guidance, review, and rules"
        : "Finance guidance and signed-in review",
  };
}
