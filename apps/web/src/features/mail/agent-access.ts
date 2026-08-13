import type { AttentionItem, MailRule, MailSetupContext } from "@personal-os/domain";
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

export function mailAgentAccessReadiness({
  attention,
  hosts,
  profile,
  rules,
  setup,
}: {
  attention: Loadable<AttentionItem[]>;
  hosts: Loadable<ConnectedHostAuthority[]>;
  profile: Loadable<DomainSetupStatus | undefined>;
  rules: Loadable<MailRule[]>;
  setup: Loadable<MailSetupContext>;
}): DomainReadinessItem[] {
  const material =
    setup.state === "loading"
      ? loadingReadiness("Mail material", "Mail sources are loading.")
      : setup.state === "unavailable"
        ? unavailableReadiness(
            "Mail material",
            "Mail sources are unavailable until Ilo can load setup context.",
          )
        : {
            ...(setup.data.accounts.length === 0
              ? {
                  action: { label: "Connect Mail", to: "/settings?section=connections" },
                  nextStep: "Connect a Mail account",
                }
              : {}),
            complete: setup.data.accounts.length > 0,
            description:
              setup.data.accounts.length > 0
                ? mailSourceSummary(setup.data.accounts)
                : "No Mail account is connected yet.",
            title: "Mail material",
          };
  const preferences =
    rules.state === "loading"
      ? loadingReadiness("Mail preferences", "Mail rules are loading.")
      : rules.state === "unavailable"
        ? unavailableReadiness(
            "Mail preferences",
            "Mail rules are unavailable, so Ilo cannot report an approved-rule count.",
          )
        : mailPreferences(profile, rules.data);
  const automation =
    setup.state === "loading"
      ? loadingReadiness("Mail automation", "Delayed Mail automation status is loading.")
      : setup.state === "unavailable"
        ? unavailableReadiness("Mail automation", "Delayed Mail automation status is unavailable.")
        : {
            complete:
              setup.data.automation.reconciliationCount === 0 &&
              setup.data.automation.failedCount === 0,
            description: formatMailAutomationStatus(setup.data.automation),
            ...(setup.data.automation.reconciliationCount > 0 ||
            setup.data.automation.failedCount > 0
              ? { nextStep: "Review stopped or unreconciled Mail automation" }
              : {}),
            title: "Mail automation",
          };
  const commitmentIntake =
    setup.state === "loading"
      ? loadingReadiness("Mail commitment intake", "Mail commitment intake status is loading.")
      : setup.state === "unavailable" || setup.data.commitmentIntake === undefined
        ? unavailableReadiness(
            "Mail commitment intake",
            "Mail commitment intake is unavailable, so Ilo cannot claim verified commitment evidence.",
          )
        : {
            complete: setup.data.commitmentIntake.automaticCreationEnabled,
            description: formatMailCommitmentIntake(setup.data.commitmentIntake),
            title: "Mail commitment intake",
          };
  return [
    material,
    preferences,
    automation,
    commitmentIntake,
    attentionReadiness("Mail", attention),
    hostPermissionReadiness({
      hosts,
      label: "Mail",
      readScope: "mail:read",
      writeCapability: "manage Mail through scoped actions",
      writeScope: "mail:write",
    }),
  ];
}

export function mailAgentAccessCapability(
  support: DomainSupport,
  invocation: string,
): DomainCapability {
  if (support === "unsupported") return unsupportedCapability("Mail");
  if (support === "executable_rules") {
    return {
      allowed: [
        "Read connected inboxes",
        "Create source-linked attention",
        "Draft disabled Mail rules",
      ],
      approvalRequired: ["Activate a proposed rule", "Expand a rule’s source scope"],
      sourceScope:
        "Mail permission applies to every connected Mail source; per-inbox agent credentials are not available.",
      description:
        "Mail setup maps every inbox before sampling it, records important conversations as source-linked attention, and captures delayed archive or recoverable Trash preferences. Approved work is bounded, durable, and activated by the signed-in person.",
      setupPrompt: `Use ${invocation} to set up my Mail in Ilo. Start with get_mail_setup_context, map the purpose of each inbox, and inspect only a small recent sample. Ask how important email should become attention and how long likely noise should remain before review, archive, or recoverable Trash—including a one-day preference. Save a draft profile, create source-linked attention items, and save proposed rules disabled. Show the preview window, truncation state, exact matches, actions, source scope, and recovery path. Explain any pending, reconciliation, or failed Mail rule work shown in setup context. Treat commitment intake as preview-only whenever automaticCreationEnabled is false; do not promise Mail-to-Calendar creation from cached prose or attachment metadata. After I explicitly accept a rule summary, use review_mail_rule, then tell me to activate it myself in Ilo Settings → Workspace access → Mail. Reviewed Google rules use bounded durable execution; Trash is recoverable and permanent deletion is unavailable.`,
      title: "Mail profiles, previews, and approved rules",
      unavailable: [
        "Permanent deletion",
        "Unreviewed rule activation",
        "Automatic Calendar creation from cached Mail content",
      ],
    };
  }
  return {
    allowed: ["Read connected inboxes", "Create source-linked attention", "Draft Mail preferences"],
    approvalRequired: ["Approve profile guidance"],
    sourceScope:
      "Mail permission applies to every connected Mail source; per-inbox agent credentials are not available.",
    description:
      "This deployment publishes Mail preferences and attention setup, but not executable Mail rules.",
    setupPrompt: `Use ${invocation} to set up my Mail preferences and attention in Ilo. Inspect connected inboxes, ask the shortest useful interview, save a draft profile, and do not claim executable rules are available.`,
    title: "Mail preferences and attention",
    unavailable: ["Executable Mail rules", "Permanent deletion"],
  };
}

function mailPreferences(
  profile: Loadable<DomainSetupStatus | undefined>,
  rules: MailRule[],
): DomainReadinessItem {
  if (profile.state !== "ready") return profileReadiness("Mail", profile);
  const base = profileReadiness("Mail", profile);
  const activeRules = rules.filter((rule) => rule.enabled && rule.policy === "approved_rule");
  return profile.data?.profileStatus === "active"
    ? {
        ...base,
        description: `${activeRules.length} active approved Mail rule${activeRules.length === 1 ? "" : "s"} · profile v${profile.data.profileVersion}`,
      }
    : base;
}

function formatMailAutomationStatus(automation: MailSetupContext["automation"]): string {
  const oldestDue = automation.oldestDueAt
    ? ` Oldest due: ${new Date(automation.oldestDueAt).toLocaleString()}.`
    : "";
  const lastCompleted = automation.lastCompletedAt
    ? ` Last completed: ${new Date(automation.lastCompletedAt).toLocaleString()}.`
    : "";
  return `${automation.pendingCount} delayed action${automation.pendingCount === 1 ? "" : "s"} pending; ${automation.inProgressCount} in progress; ${automation.reconciliationCount} need provider reconciliation; ${automation.failedCount} stopped safely. Ilo processes at most ${automation.executionLimitPerRun} conversations per scheduled run.${oldestDue}${lastCompleted}`;
}

function formatMailCommitmentIntake(intake: MailSetupContext["commitmentIntake"]): string {
  return `${intake.previewOnlyCount} preview-only calendar attachment candidate${intake.previewOnlyCount === 1 ? "" : "s"}; ${intake.serverVerifiedCount} server-verified. Automatic Calendar creation is not enabled; cached prose and attachment metadata cannot authorize an event.`;
}

function mailSourceSummary(accounts: MailSetupContext["accounts"]): string {
  const identities = accounts.map((account) => account.email ?? account.label);
  const failing = accounts.filter((account) => account.syncStatus === "error").length;
  const sourceSummary =
    identities.length <= 2
      ? identities.join(" and ")
      : `${identities.slice(0, 2).join(", ")} +${identities.length - 2}`;
  return `${accounts.length} Mail account${accounts.length === 1 ? "" : "s"} · ${sourceSummary}${failing > 0 ? ` · ${failing} ${failing === 1 ? "needs" : "need"} reconnect` : ""}`;
}
