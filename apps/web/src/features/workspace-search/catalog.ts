import type { SearchableWorkspace, WorkspaceSearchResult } from "@personal-os/domain";
import { settingMatchScore, settingsFieldId, settingsFields } from "../settings/settings-fields";

export type SearchAction =
  | "new-task"
  | "new-reminder"
  | "new-event"
  | "new-message"
  | "new-transaction";
export type SearchOption = WorkspaceSearchResult & { action?: SearchAction };
const actions: Record<SearchableWorkspace, Array<[SearchAction, string]>> = {
  calendar: [["new-event", "New event"]],
  tasks: [
    ["new-task", "New task"],
    ["new-reminder", "New reminder"],
  ],
  mail: [["new-message", "New message"]],
  finances: [["new-transaction", "Add transaction"]],
};
const destinations: Record<SearchableWorkspace, Array<[string, string, string]>> = {
  calendar: [
    ["Today", "/calendar?follow=1", "today calendar current day"],
    ["Day view", "/calendar?view=day", "day"],
    ["Week view", "/calendar?view=week", "week"],
    ["Month view", "/calendar?view=month", "month"],
  ],
  tasks: [
    ["Lists", "/tasks?view=lists", "lists collections areas"],
    ["Projects", "/tasks?view=projects", "projects outcomes goals"],
    ["All tasks", "/tasks?view=all", "tasks"],
    ["Inbox", "/tasks", "inbox"],
    ["Today", "/tasks?view=today", "today due overdue"],
    ["Upcoming", "/tasks?view=upcoming", "upcoming scheduled"],
    ["History", "/tasks?view=history", "history completed cancelled"],
    ["Trash", "/tasks?view=trash", "trash deleted restore"],
    ["Reminders", "/reminders", "reminders"],
    ["Archive", "/tasks?archive=all", "completed archived"],
  ],
  mail: [
    ["Inbox", "/mail", "inbox"],
    ["Unread", "/mail?unread=1", "unread"],
    ["Starred", "/mail?view=starred", "starred favorites"],
    ["Snoozed", "/mail?view=snoozed", "snoozed"],
    ["Sent", "/mail?view=sent", "sent"],
    ["Drafts", "/mail?view=drafts", "drafts"],
  ],
  finances: [
    ["Overview", "/finances", "overview financial position"],
    ["Transactions", "/finances/transactions", "transactions ledger"],
    ["Budget", "/finances/plan", "budget plan"],
    ["Cash flow", "/finances/cashflow", "cash flow"],
    ["Wealth", "/finances/wealth", "wealth net worth"],
    ["Accounts", "/finances/accounts", "accounts banks"],
  ],
};
export function workspaceCatalog(workspace: SearchableWorkspace, query: string): SearchOption[] {
  const label = workspace[0]?.toUpperCase() + workspace.slice(1);
  const options: Array<SearchOption & { aliases: string }> = [
    ...destinations[workspace].map(([title, href, aliases]) => ({
      id: href,
      kind: "Navigation",
      title,
      href,
      preview: label,
      state: null,
      aliases,
    })),
    ...actions[workspace].map(([action, title]) => ({
      id: action,
      kind: "Action",
      action,
      title,
      href: "",
      preview: "Open the creation form",
      state: null,
      aliases: "create add compose",
    })),
    {
      id: "reviews",
      kind: "Review",
      title: "Items needing review",
      href: `/${workspace}?review=open`,
      preview: `Open ${label} decisions`,
      state: null,
      aliases: "reviews approvals attention decisions feedback",
    },
    {
      id: "settings",
      kind: "Settings",
      title: `${label} settings`,
      href: `/settings?section=${workspace}`,
      preview: "Workspace preferences",
      state: null,
      aliases: "preferences configuration",
    },
    ...settingsFields
      .filter(
        (field) =>
          field.section === workspace ||
          (workspace === "calendar" &&
            field.section === "profile" &&
            ["Time zone", "Day start", "Day end"].includes(field.label)),
      )
      .map((field) => ({
        id: settingsFieldId(field),
        kind: "Settings",
        title: field.label,
        href: `/settings?section=${field.section}&field=${encodeURIComponent(settingsFieldId(field))}`,
        preview: `${label} settings`,
        state: null,
        aliases: field.aliases ?? "",
      })),
  ];
  return options
    .map((option) => ({
      option,
      score: query.trim() ? settingMatchScore(query, option.title, option.aliases) : 1,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.option);
}
