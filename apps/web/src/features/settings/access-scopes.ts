import type { AccessScope } from "@personal-os/domain";
export const scopeLabels: Record<AccessScope, string> = {
  "audit:read": "Read activity",
  "automations:read": "Read daily brief",
  "automations:write": "Legacy automation access (inactive)",
  "bookmarks:read": "Read X bookmarks",
  "calendar:read": "Read calendar",
  "calendar:write": "Manage calendar",
  "finances:read": "Read sensitive financial accounts and activity",
  "finances:write": "Manage financial records, plans, and reviews",
  "finances:maintain":
    "Maintain Finances: sync providers, reconcile and categorize under approved rules, create durable runs; questions and approvals stay pending",
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

export const selectableScopes = (Object.keys(scopeLabels) as AccessScope[]).filter(
  (scope) => scope !== "automations:write" && scope !== "tracking:write",
);
