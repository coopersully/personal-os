import type {
  AccessScope,
  AgentAccessWorkItem,
  AgentAccount,
  AssistantSetupPlan,
} from "@personal-os/domain";

/**
 * Plain-language names for each permission, following the web Agents settings. A permission
 * with a condition keeps a short name here and its condition in `scopeDetails`.
 */
export const scopeLabels: Record<AccessScope, string> = {
  "mail:execute": "Execute Mail approvals, sending and settings",
  "finances:execute": "Execute Finance approvals, account changes and settings",
  "calendar:execute": "Change Calendar settings",
  "tasks:execute": "Change Tasks settings",
  "texting:execute": "Change notification preferences",
  "audit:read": "Read activity",
  "automations:read": "Read daily brief",
  "automations:write": "Legacy automation access (inactive)",
  "bookmarks:read": "Read X bookmarks",
  "calendar:read": "Read calendar",
  "calendar:write": "Manage calendar",
  "finances:read": "Read sensitive financial accounts and activity",
  "finances:write": "Manage financial records, plans, and reviews",
  "finances:maintain": "Maintain Finances",
  "goals:read": "Read goals & motives",
  "goals:write": "Manage goals & motives",
  "tracking:read": "Read private ritual responses",
  "tracking:write": "Manage rituals and responses",
  "mail:read": "Read mail",
  "mail:write": "Manage mail",
  "reminders:read": "Read reminders",
  "reminders:write": "Manage reminders",
  "tasks:read": "Read tasks",
  "tasks:write": "Manage tasks",
  "texting:read": "Read text conversation",
  "texting:write": "Send text messages",
};

const whenPolicyAllows = "Only when your review policy lets eligible work skip Reviews.";
/** The condition or reach of a permission whose short name alone would mislead. */
export const scopeDetails: Partial<Record<AccessScope, string>> = {
  "mail:execute": `${whenPolicyAllows} With Calendar and Tasks execution, it can also sync or disconnect shared sources.`,
  "finances:execute": whenPolicyAllows,
  "calendar:execute": `${whenPolicyAllows} With Mail and Tasks execution, it can also sync or disconnect shared sources.`,
  "tasks:execute": `${whenPolicyAllows} With Mail and Calendar execution, it can also sync or disconnect shared sources.`,
  "texting:execute": `Or disconnect the verified Texting destination. ${whenPolicyAllows}`,
  "finances:maintain":
    "Sync providers, reconcile and categorize under approved rules, and create durable runs. Questions and approvals stay pending.",
};

const areaLabels: Record<string, string> = {
  audit: "Activity",
  automations: "Daily brief",
  bookmarks: "X bookmarks",
  calendar: "Calendar",
  finances: "Finances",
  goals: "Goals & motives",
  mail: "Mail",
  reminders: "Reminders",
  tasks: "Tasks",
  texting: "Texting",
  tracking: "Rituals",
};
const areaOrder = Object.keys(areaLabels);
const verbLabels: Record<string, string> = {
  read: "read",
  write: "manage",
  execute: "execute without review",
  maintain: "maintain",
};
const verbOrder = Object.keys(verbLabels);
/** Permissions whose verb alone would overstate or misname what they allow. */
const summaryOverrides: Record<string, string> = {
  "automations:write": "legacy access (inactive)",
  "texting:write": "send",
};

export const areaLabel = (area: string) =>
  areaLabels[area] ?? area.charAt(0).toUpperCase() + area.slice(1);

/** Permissions grouped by the part of nohmi they reach, in a stable order. */
export function scopeGroups<Scope extends string>(scopes: readonly Scope[]) {
  const groups = new Map<string, Scope[]>();
  for (const scope of scopes) {
    const area = scope.split(":")[0] ?? scope;
    groups.set(area, [...(groups.get(area) ?? []), scope]);
  }
  const rank = (order: string[], value: string) =>
    order.includes(value) ? order.indexOf(value) : order.length;
  return [...groups.entries()]
    .sort(([a], [b]) => rank(areaOrder, a) - rank(areaOrder, b) || a.localeCompare(b))
    .map(([area, members]) => ({
      area,
      label: areaLabel(area),
      scopes: [...members].sort(
        (a, b) =>
          rank(verbOrder, a.split(":")[1] ?? "") - rank(verbOrder, b.split(":")[1] ?? "") ||
          a.localeCompare(b),
      ),
    }));
}

/** One short line per area, such as "Mail: read, manage". Unknown verbs stay as written. */
export function permissionLines(scopes: readonly string[]) {
  return scopeGroups(scopes).map(
    ({ label, scopes: members }) =>
      `${label}: ${members
        .map((scope) => {
          const verb = scope.split(":")[1] ?? "";
          return summaryOverrides[scope] ?? verbLabels[verb] ?? (verb || scope);
        })
        .join(", ")}`,
  );
}

export const platformLabels: Record<AgentAccount["platform"], string> = {
  claude: "Claude",
  codex: "Codex",
  other: "Other",
  unknown: "Unknown",
};

export const setupStatusLabels: Record<AssistantSetupPlan["status"], string> = {
  blocked: "Blocked",
  complete: "Complete",
  in_progress: "In progress",
  needs_connection: "Needs an agent connection",
  needs_input: "Needs your input",
};
export const stepStateLabels: Record<AssistantSetupPlan["steps"][number]["state"], string> = {
  blocked: "Waiting on an earlier step",
  complete: "Done",
  current: "Current step",
};
export const stepOwnerLabels: Record<AssistantSetupPlan["steps"][number]["owner"], string> = {
  agent: "Your agent",
  ilo: "nohmi",
  person: "You",
};
export const supportLabels: Record<string, string> = {
  executable_rules: "Preferences, actions and rules",
  profile_and_attention: "Preferences and actions",
  unsupported: "Not available",
};

export const workItemKindLabels: Record<AgentAccessWorkItem["kind"], string> = {
  attention: "Attention",
  review: "Review",
};
export const workItemPriorityLabels: Record<AgentAccessWorkItem["priority"], string> = {
  blocked: "Blocked",
  critical: "Critical",
  high: "High",
  low: "Low",
  normal: "Normal",
  person_review: "Needs your review",
};

export const dateTime = (value: string) => new Date(value).toLocaleString();
