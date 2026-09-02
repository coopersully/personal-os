import type { MailRule, MailSetupContext } from "@personal-os/domain";
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

export function mailAgentAccessReadiness({
  hosts,
  profile,
  rules,
  setup,
}: {
  hosts: Loadable<ConnectedHostAuthority[]>;
  profile: Loadable<DomainSetupStatus | undefined>;
  rules: Loadable<MailRule[]>;
  setup: Loadable<MailSetupContext>;
}): DomainReadinessItem[] {
  const material =
    setup.state === "loading"
      ? loadingReadiness("Accounts", "Mail accounts are loading.")
      : setup.state === "unavailable"
        ? unavailableReadiness("Accounts", "Mail accounts are unavailable.")
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
            title: "Accounts",
          };
  const preferences =
    rules.state === "loading"
      ? loadingReadiness("Rules", "Mail rules are loading.")
      : rules.state === "unavailable"
        ? unavailableReadiness(
            "Rules",
            "Mail rules are unavailable, so nohmi cannot report an approved-rule count.",
          )
        : mailPreferences(profile, rules.data);
  const automation =
    setup.state === "loading"
      ? loadingReadiness("Scheduled actions", "Scheduled Mail actions are loading.")
      : setup.state === "unavailable"
        ? unavailableReadiness("Scheduled actions", "Scheduled Mail actions are unavailable.")
        : {
            complete:
              setup.data.automation.reconciliationCount === 0 &&
              setup.data.automation.failedCount === 0,
            description: formatMailAutomationStatus(setup.data.automation),
            ...(setup.data.automation.reconciliationCount > 0 ||
            setup.data.automation.failedCount > 0
              ? { nextStep: "Review stopped or unreconciled Mail automation" }
              : {}),
            title: "Scheduled actions",
          };
  const commitmentIntake =
    setup.state === "loading"
      ? loadingReadiness("Calendar attachments", "Calendar attachment status is loading.")
      : setup.state === "unavailable" || setup.data.commitmentIntake === undefined
        ? unavailableReadiness("Calendar attachments", "Calendar attachment status is unavailable.")
        : {
            complete: setup.data.commitmentIntake.automaticCreationEnabled,
            description: formatMailCommitmentIntake(setup.data.commitmentIntake),
            title: "Calendar attachments",
          };
  return [
    material,
    preferences,
    automation,
    commitmentIntake,
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
      setupPrompt: `Use ${invocation} to set up my Mail in nohmi. Start with get_mail_setup_context, map the purpose of each inbox, and inspect only a small recent sample. Ask how important email should become attention and how long likely noise should remain before review, archive, or recoverable Trash—including a one-day preference. Save a draft profile, create source-linked attention items, and save proposed rules disabled. Show the preview window, truncation state, exact matches, actions, source scope, and recovery path. Explain any pending, reconciliation, or failed Mail rule work shown in setup context. Treat commitment intake as preview-only whenever automaticCreationEnabled is false; do not promise Mail-to-Calendar creation from cached prose or attachment metadata. After I explicitly accept a rule summary, use review_mail_rule, then tell me to activate it myself in nohmi Settings → Workspace access → Mail. Reviewed Google rules use bounded durable execution; Trash is recoverable and permanent deletion is unavailable.`,
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
    setupPrompt: `Use ${invocation} to set up my Mail preferences and attention in nohmi. Inspect connected inboxes, ask the shortest useful interview, save a draft profile, and do not claim executable rules are available.`,
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
        description: `Profile v${profile.data.profileVersion} · ${activeRules.length} approved ${activeRules.length === 1 ? "rule" : "rules"} active`,
        title: "Rules",
      }
    : { ...base, title: "Rules" };
}

function formatMailAutomationStatus(automation: MailSetupContext["automation"]): string {
  if (
    automation.pendingCount === 0 &&
    automation.inProgressCount === 0 &&
    automation.reconciliationCount === 0 &&
    automation.failedCount === 0
  ) {
    return "No pending or stopped actions";
  }
  return `${automation.pendingCount} pending · ${automation.inProgressCount} running · ${automation.reconciliationCount} need reconciliation · ${automation.failedCount} stopped`;
}

function formatMailCommitmentIntake(intake: MailSetupContext["commitmentIntake"]): string {
  return intake.automaticCreationEnabled
    ? `Automatic calendar creation is on · ${intake.serverVerifiedCount} verified`
    : `Automatic calendar creation is off · ${intake.previewOnlyCount} ${intake.previewOnlyCount === 1 ? "candidate" : "candidates"} waiting`;
}

function mailSourceSummary(accounts: MailSetupContext["accounts"]): string {
  const identities = accounts.map((account) => account.email ?? account.label);
  const failing = accounts.filter((account) => account.syncStatus === "error").length;
  const sourceSummary =
    identities.length <= 2
      ? identities.join(" and ")
      : `${identities.slice(0, 2).join(", ")} +${identities.length - 2}`;
  return `${accounts.length} connected · ${sourceSummary}${failing > 0 ? ` · ${failing} ${failing === 1 ? "needs" : "need"} reconnect` : ""}`;
}
