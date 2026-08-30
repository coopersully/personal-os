import type { Calendar } from "@personal-os/domain";
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

export function calendarAgentAccessReadiness({
  calendars,
  hosts,
  profile,
}: {
  calendars: Loadable<Calendar[]>;
  hosts: Loadable<ConnectedHostAuthority[]>;
  profile: Loadable<DomainSetupStatus | undefined>;
}): DomainReadinessItem[] {
  if (calendars.state !== "ready") {
    const unavailable = calendars.state === "unavailable";
    return [
      unavailable
        ? unavailableReadiness("Calendars", "Calendar sources are unavailable.")
        : loadingReadiness("Calendars", "Calendar sources are loading."),
      profileReadiness("Calendar", profile),
      unavailable
        ? unavailableReadiness("Writable calendar", "Writable calendar status is unavailable.")
        : loadingReadiness("Writable calendar", "Writable calendar status is loading."),
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
      title: "Calendars",
    },
    profileReadiness("Calendar", profile),
    {
      complete: writable.length > 0,
      description:
        writable.length > 0
          ? `${writable.length} writable destination${writable.length === 1 ? "" : "s"}. Ilo can preview strong-evidence commitments; automatic creation is not enabled.`
          : "A selected writable calendar is required for commitment previews.",
      ...(writable.length === 0 ? { nextStep: "Select a writable calendar" } : {}),
      title: "Writable calendar",
    },
    calendarHostAccess(hosts),
  ];
}

export function calendarAgentAccessCapability(
  support: DomainSupport,
  invocation: string,
): DomainCapability {
  if (support === "unsupported") return unsupportedCapability("Calendar");
  return {
    allowed: [
      "Read selected calendars",
      "Preview strong-evidence commitments",
      "Use scoped Calendar actions",
    ],
    approvalRequired: [
      "Approve profile guidance",
      "Confirm changes outside an approved Calendar rule",
    ],
    sourceScope:
      "Calendar permission applies to selected calendars; writable destinations remain limited by provider access.",
    description:
      support === "executable_rules"
        ? "This deployment publishes Calendar profiles, commitment previews, and Calendar-owned executable rules."
        : "Calendar setup can learn preferences, inspect selected destinations, and preview strong-evidence commitments. Automatic event creation is not enabled.",
    setupPrompt: `Use ${invocation} to set up my Calendar in Ilo. Inspect selected and writable calendars, ask the shortest useful preference interview, save a draft profile, and preview strong-evidence commitments without claiming automatic event creation${support === "executable_rules" ? " beyond the Calendar-owned rules this deployment publishes" : ""}.`,
    title:
      support === "executable_rules"
        ? "Calendar profiles, previews, and rules"
        : "Calendar preferences and commitment previews",
    unavailable: ["Automatic event creation from cached prose", "Writing to read-only calendars"],
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
