import type { IconName } from "../../components/icons";

export const settingsGroups = ["Account", "Personal", "Workspaces", "Intelligence", "App"] as const;
export type SettingsGroup = (typeof settingsGroups)[number];
export const settingsDestinations = [
  {
    id: "profile",
    label: "Profile",
    group: "Account",
    icon: "profile",
    keywords: "name email phone timezone location planning",
  },
  {
    id: "connections",
    label: "Connections",
    group: "Account",
    icon: "disconnected",
    keywords: "providers reconnect accounts",
  },
  {
    id: "security",
    label: "Security & Access",
    group: "Account",
    icon: "people",
    keywords: "devices sessions invitations permissions",
  },
  {
    id: "activity",
    label: "Activity Log",
    group: "Account",
    icon: "history",
    keywords: "audit history",
  },
  {
    id: "goals",
    label: "Goals & Motives",
    group: "Personal",
    icon: "target",
    keywords: "outcomes purpose completed",
  },
  {
    id: "rituals",
    label: "Rituals",
    group: "Personal",
    icon: "today",
    keywords: "morning evening history",
  },
  {
    id: "tasks",
    label: "Tasks",
    group: "Workspaces",
    icon: "tasks",
    keywords: "preferences reminders lists",
  },
  {
    id: "mail",
    label: "Mail",
    group: "Workspaces",
    icon: "mail",
    keywords: "email inbox guidance",
  },
  {
    id: "calendar",
    label: "Calendar",
    group: "Workspaces",
    icon: "calendar",
    keywords: "events scheduling",
  },
  {
    id: "finances",
    label: "Finances",
    group: "Workspaces",
    icon: "finances",
    keywords: "budgets accounts guidance",
  },
  {
    id: "agents",
    label: "Agents",
    group: "Intelligence",
    icon: "star",
    keywords: "connections policy guidance execution",
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "App",
    icon: "settings",
    keywords: "theme dark light system",
  },
  {
    id: "notifications",
    label: "Notifications",
    group: "App",
    icon: "attention",
    keywords: "permission alerts reminders",
  },
  {
    id: "texting",
    label: "Texting",
    group: "App",
    icon: "inbox",
    keywords: "sms phone consent verification",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  group: SettingsGroup;
  icon: IconName;
  keywords: string;
}[];
export type SettingsDestinationId = (typeof settingsDestinations)[number]["id"];
export function settingsPath(id: SettingsDestinationId): `/settings/${SettingsDestinationId}` {
  return `/settings/${id}`;
}
export function findSettingsDestination(id: string | undefined) {
  return settingsDestinations.find((destination) => destination.id === id);
}
/** Pure filtering: searching never reads or writes a domain service. */
export function searchSettings(query: string, available: readonly SettingsDestinationId[]) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return settingsDestinations.filter(
    (destination) =>
      available.includes(destination.id) &&
      terms.every((term) =>
        `${destination.label} ${destination.group} ${destination.keywords}`
          .toLocaleLowerCase()
          .includes(term),
      ),
  );
}
export function workspaceSettingsPath(workspace: string) {
  return ["tasks", "mail", "calendar", "finances"].includes(workspace)
    ? settingsPath(workspace as SettingsDestinationId)
    : "/settings";
}
