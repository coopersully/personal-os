import type { AttentionItem, Reminder } from "@personal-os/domain";
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

type ReminderPage = { items: Reminder[]; nextCursor: string | null };

export function reminderAgentAccessReadiness({
  attention,
  hosts,
  profile,
  reminders,
}: {
  attention: Loadable<AttentionItem[]>;
  hosts: Loadable<ConnectedHostAuthority[]>;
  profile: Loadable<DomainSetupStatus | undefined>;
  reminders: Loadable<ReminderPage>;
}): DomainReadinessItem[] {
  const access = hostPermissionReadiness({
    hosts,
    label: "Reminders",
    readScope: "reminders:read",
    writeCapability: "use bounded Reminder write actions",
    writeScope: "reminders:write",
  });
  const material =
    reminders.state === "loading"
      ? loadingReadiness("Reminder material", "Reminder material is loading.")
      : reminders.state === "unavailable"
        ? unavailableReadiness("Reminder material", "Reminder material is unavailable.")
        : {
            ...(reminders.data.items.length === 0
              ? { action: { label: "Open Reminders", to: "/reminders" } }
              : {}),
            complete: true,
            description:
              reminders.data.items.length > 0
                ? `${reminders.data.items.length}${reminders.data.nextCursor ? "+" : ""} open Reminder${reminders.data.items.length === 1 ? "" : "s"} in Ilo.`
                : "No open Reminders. Local capture is available whenever you need it.",
            title: "Reminder material",
          };
  return [
    material,
    profileReadiness("Reminders", profile),
    {
      complete: true,
      description:
        "Ilo supports bounded single-item Reminder actions and exact overdue-deferral previews. Guided setup does not install notifications.",
      title: "Reminder workflow",
    },
    attentionReadiness("Reminders", attention),
    access,
  ];
}

export function reminderAgentAccessCapability(
  support: DomainSupport,
  invocation: string,
): DomainCapability {
  if (support === "unsupported") return unsupportedCapability("Reminders");
  return {
    description:
      support === "executable_rules"
        ? "This deployment publishes Reminder preferences, bounded actions, previews, and Reminder-owned executable rules. Setup does not install notifications."
        : "Reminder setup can learn preferences, use bounded single-item actions, and preview exact overdue deferrals. Setup does not install notifications.",
    setupPrompt: `Use ${invocation} to set up my Reminders in Ilo. Inspect the bounded open page, ask the shortest useful preference interview, save a draft profile, and distinguish direct single-item actions from exact overdue-deferral previews. Do not claim notification delivery${support === "executable_rules" ? " or rules beyond the Reminder-owned behavior this deployment publishes" : ""}.`,
    title:
      support === "executable_rules"
        ? "Reminder preferences, actions, and rules"
        : "Reminder preferences, actions, and previews",
  };
}
