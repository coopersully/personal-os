import type { AttentionItem, Calendar } from "@personal-os/domain";
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

export function calendarAgentAccessReadiness({
  attention,
  calendars,
  hosts,
  profile,
}: {
  attention: Loadable<AttentionItem[]>;
  calendars: Loadable<Calendar[]>;
  hosts: Loadable<ConnectedHostAuthority[]>;
  profile: Loadable<DomainSetupStatus | undefined>;
}): DomainReadinessItem[] {
  if (calendars.state !== "ready") {
    const unavailable = calendars.state === "unavailable";
    return [
      unavailable
        ? unavailableReadiness("Calendar material", "Calendar sources are unavailable.")
        : loadingReadiness("Calendar material", "Calendar sources are loading."),
      profileReadiness("Calendar", profile),
      unavailable
        ? unavailableReadiness("Calendar workflow", "Calendar workflow readiness is unavailable.")
        : loadingReadiness("Calendar workflow", "Calendar workflow readiness is loading."),
      attentionReadiness("Calendar", attention),
      calendarHostAccess(hosts),
    ];
  }
  const selected = calendars.data.filter((calendar) => calendar.isSelected);
  const writable = selected.filter((calendar) => calendar.isWritable);
  const sourceErrors = calendars.data.filter(
    (calendar) => calendar.source?.syncStatus === "error",
  ).length;
  return [
    {
      ...(selected.length === 0
        ? {
            action: { label: "Open Calendar", to: "/calendar" },
            nextStep: "Select a calendar for Ilo to use",
          }
        : {}),
      complete: selected.length > 0,
      description: `${calendars.data.length} calendar${calendars.data.length === 1 ? "" : "s"} · ${selected.length} selected · ${writable.length} writable${sourceErrors > 0 ? ` · ${sourceErrors} ${sourceErrors === 1 ? "needs" : "need"} reconnect` : ""}`,
      title: "Calendar material",
    },
    profileReadiness("Calendar", profile),
    {
      complete: writable.length > 0,
      description:
        writable.length > 0
          ? `${writable.length} writable destination${writable.length === 1 ? "" : "s"}. Ilo can preview strong-evidence commitments; automatic creation is not enabled.`
          : "A selected writable calendar is required for commitment previews.",
      ...(writable.length === 0 ? { nextStep: "Select a writable calendar" } : {}),
      title: "Calendar workflow",
    },
    attentionReadiness("Calendar", attention),
    calendarHostAccess(hosts),
  ];
}

export function calendarAgentAccessCapability(
  support: DomainSupport,
  invocation: string,
): DomainCapability {
  if (support === "unsupported") return unsupportedCapability("Calendar");
  return {
    description:
      support === "executable_rules"
        ? "This deployment publishes Calendar profiles, commitment previews, and Calendar-owned executable rules."
        : "Calendar setup can learn preferences, inspect selected destinations, and preview strong-evidence commitments. Automatic event creation is not enabled.",
    setupPrompt: `Use ${invocation} to set up my Calendar in Ilo. Inspect selected and writable calendars, ask the shortest useful preference interview, save a draft profile, and preview strong-evidence commitments without claiming automatic event creation${support === "executable_rules" ? " beyond the Calendar-owned rules this deployment publishes" : ""}.`,
    title:
      support === "executable_rules"
        ? "Calendar profiles, previews, and rules"
        : "Calendar preferences and commitment previews",
  };
}

function calendarHostAccess(hosts: Loadable<ConnectedHostAuthority[]>): DomainReadinessItem {
  return hostPermissionReadiness({
    hosts,
    label: "Calendar",
    readScope: "calendar:read",
    writeCapability: "use scoped Calendar write actions",
    writeScope: "calendar:write",
  });
}
