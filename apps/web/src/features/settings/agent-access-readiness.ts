import type {
  AssistantDomain,
  AssistantSetupStatus,
  AttentionItem,
  Calendar,
  FinanceGuidedSetupContext,
  MailRule,
  MailSetupAccount,
  MailSetupContext,
  Reminder,
} from "@personal-os/domain";

export type SetupDomain = Extract<AssistantDomain, "mail" | "finances" | "calendar" | "reminders">;

export const setupDomainOptions: Array<{
  domain: SetupDomain;
  label: string;
  shortLabel: string;
}> = [
  { domain: "mail", label: "Mail", shortLabel: "Mail" },
  { domain: "finances", label: "Finances", shortLabel: "Finances" },
  { domain: "calendar", label: "Calendar", shortLabel: "Calendar" },
  { domain: "reminders", label: "Reminders", shortLabel: "Reminders" },
];

export const setupDomainLabels: Record<SetupDomain, string> = Object.fromEntries(
  setupDomainOptions.map((option) => [option.domain, option.label]),
) as Record<SetupDomain, string>;

type DomainSetupStatus = AssistantSetupStatus["domains"][number];

export type DomainReadinessItem = {
  action?: { label: string; to: string };
  complete: boolean;
  description: string;
  title: string;
};

export function domainReadiness({
  attentionItems,
  calendars,
  domain,
  financeSetup,
  mailAutomation,
  mailLoaded,
  mailRules,
  mailSources,
  profile,
  reminders,
}: {
  attentionItems: AttentionItem[] | undefined;
  calendars: Calendar[] | undefined;
  domain: SetupDomain;
  financeSetup: FinanceGuidedSetupContext | undefined;
  mailAutomation: MailSetupContext["automation"] | undefined;
  mailLoaded: boolean;
  mailRules: MailRule[] | undefined;
  mailSources: MailSetupAccount[];
  profile: DomainSetupStatus | undefined;
  reminders: { items: Reminder[]; nextCursor: string | null } | undefined;
}): DomainReadinessItem[] {
  const label = setupDomainLabels[domain];
  const attention = attentionReadiness(label, attentionItems);
  const preferences = profileReadiness(label, profile);

  if (domain === "mail") {
    const activeRules = (mailRules ?? []).filter(
      (rule) => rule.enabled && rule.policy === "approved_rule",
    );
    return [
      {
        ...(mailLoaded && mailSources.length === 0
          ? { action: { label: "Connect Mail", to: "/settings?section=connections" } }
          : {}),
        complete: mailSources.length > 0,
        description:
          mailSources.length > 0
            ? mailSourceSummary(mailSources)
            : mailLoaded
              ? "No Mail account is connected yet."
              : "Mail sources are loading.",
        title: "Mail material",
      },
      {
        ...preferences,
        description:
          profile?.profileStatus === "active"
            ? `${activeRules.length} active approved Mail rule${activeRules.length === 1 ? "" : "s"} · profile v${profile.profileVersion}`
            : preferences.description,
      },
      {
        complete:
          mailAutomation !== undefined &&
          mailAutomation.reconciliationCount === 0 &&
          mailAutomation.failedCount === 0,
        description: mailAutomation
          ? formatMailAutomationStatus(mailAutomation)
          : "Delayed Mail automation status is loading.",
        title: "Mail automation",
      },
      attention,
    ];
  }

  if (domain === "calendar") {
    const selectedCalendars = calendars?.filter((calendar) => calendar.isSelected) ?? [];
    const writableCalendars = selectedCalendars.filter((calendar) => calendar.isWritable);
    const sourceErrors =
      calendars?.filter((calendar) => calendar.source?.syncStatus === "error").length ?? 0;
    return [
      {
        ...(!calendars || selectedCalendars.length > 0
          ? {}
          : { action: { label: "Open Calendar", to: "/calendar" } }),
        complete: selectedCalendars.length > 0,
        description: calendars
          ? `${calendars.length} calendar${calendars.length === 1 ? "" : "s"} · ${selectedCalendars.length} selected · ${writableCalendars.length} writable${sourceErrors > 0 ? ` · ${sourceErrors} ${sourceErrors === 1 ? "needs" : "need"} reconnect` : ""}`
          : "Calendar sources are loading.",
        title: "Calendar material",
      },
      preferences,
      {
        complete: writableCalendars.length > 0,
        description:
          writableCalendars.length > 0
            ? `${writableCalendars.length} writable destination${writableCalendars.length === 1 ? "" : "s"}. Strong-evidence commitments can be previewed; automatic creation is not enabled.`
            : "A selected writable calendar is required for commitment previews.",
        title: "Calendar workflow",
      },
      attention,
    ];
  }

  if (domain === "reminders") {
    const reminderCount = reminders?.items.length ?? 0;
    return [
      {
        ...(reminders && reminderCount === 0
          ? { action: { label: "Open Reminders", to: "/reminders" } }
          : {}),
        complete: reminders !== undefined,
        description: reminders
          ? reminderCount > 0
            ? `${reminderCount}${reminders.nextCursor ? "+" : ""} open Reminder${reminderCount === 1 ? "" : "s"} available to the agent.`
            : "No open Reminders. Local capture is available whenever you need it."
          : "Reminder material is loading.",
        title: "Reminder material",
      },
      preferences,
      {
        complete: profile?.canWrite === true,
        description:
          profile?.canWrite === true
            ? "Bounded single-item actions and exact overdue-deferral previews are available. Setup does not install notifications."
            : "This connection does not have Reminder write access.",
        title: "Reminder workflow",
      },
      attention,
    ];
  }

  const accountCount = financeSetup?.accountSources.length ?? 0;
  const availableWorkflows =
    financeSetup?.suggestedWorkflows.filter((workflow) => workflow.available).length ?? 0;
  const staleAccounts = financeSetup?.ledgerHealth.staleAccounts ?? 0;
  return [
    {
      ...(financeSetup && accountCount === 0
        ? { action: { label: "Open Finances", to: "/finances" } }
        : {}),
      complete: accountCount > 0,
      description: financeSetup
        ? `${accountCount} Finance account${accountCount === 1 ? "" : "s"}${staleAccounts > 0 ? ` · ${staleAccounts} stale` : ""}`
        : "Finance sources are loading.",
      title: "Finance material",
    },
    preferences,
    {
      complete: availableWorkflows > 0,
      description: financeSetup
        ? `${availableWorkflows} guidance or review workflow${availableWorkflows === 1 ? "" : "s"} available · ${financeSetup.reviewSummary.count} item${financeSetup.reviewSummary.count === 1 ? "" : "s"} ${financeSetup.reviewSummary.count === 1 ? "needs" : "need"} signed-in review.`
        : "Finance workflows are loading.",
      title: "Finance workflow",
    },
    attention,
  ];
}

function profileReadiness(
  label: string,
  profile: DomainSetupStatus | undefined,
): DomainReadinessItem {
  if (profile?.approvedProfileStatus === "active") {
    return {
      complete: true,
      description: profile.pendingDraftVersion
        ? `Approved guidance v${profile.approvedProfileVersion} is active; draft v${profile.pendingDraftVersion} awaits signed-in review.`
        : `Approved guidance v${profile.approvedProfileVersion} is active.`,
      title: `${label} preferences`,
    };
  }
  if (profile?.profileStatus === "active") {
    return {
      complete: true,
      description: `Profile v${profile.profileVersion} is active.`,
      title: `${label} preferences`,
    };
  }
  if (profile?.profileStatus === "draft") {
    return {
      complete: false,
      description: `Draft profile v${profile.profileVersion} is waiting for review.`,
      title: `${label} preferences`,
    };
  }
  return {
    complete: false,
    description: `Run the guided interview to teach Ilo your ${label} preferences.`,
    title: `${label} preferences`,
  };
}

function attentionReadiness(
  label: string,
  items: AttentionItem[] | undefined,
): DomainReadinessItem {
  if (!items) {
    return {
      complete: false,
      description: `${label} attention is loading.`,
      title: `${label} attention`,
    };
  }
  return {
    complete: true,
    description:
      items.length === 0
        ? `No open ${label} attention items.`
        : `${items.length}${items.length === 100 ? "+" : ""} open ${label} attention item${items.length === 1 ? "" : "s"}.`,
    title: `${label} attention`,
  };
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

function mailSourceSummary(accounts: MailSetupAccount[]): string {
  const identities = accounts.map((account) => account.email ?? account.label);
  const failing = accounts.filter((account) => account.syncStatus === "error").length;
  const sourceSummary =
    identities.length <= 2
      ? identities.join(" and ")
      : `${identities.slice(0, 2).join(", ")} +${identities.length - 2}`;
  return `${accounts.length} Mail account${accounts.length === 1 ? "" : "s"} · ${sourceSummary}${failing > 0 ? ` · ${failing} ${failing === 1 ? "needs" : "need"} reconnect` : ""}`;
}
