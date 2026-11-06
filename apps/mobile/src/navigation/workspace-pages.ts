import type { IconName } from "../components/icons";

// Mirrors apps/web/src/navigation/workspace-sections.ts. These are page shells,
// not new task/mail/finance domain data or a second source of business rules.
export type WorkspacePageDefinition = { name: string; label: string; icon: IconName };
export const workspacePages = {
  tasks: [
    { name: "index", label: "today", icon: "calendar" },
    { name: "views", label: "views", icon: "views" },
    { name: "pinned", label: "pinned", icon: "pin" },
    { name: "history", label: "history", icon: "history" },
  ],
  mail: [
    { name: "index", label: "inbox", icon: "inbox" },
    { name: "mailboxes", label: "mailboxes", icon: "inbox" },
  ],
  finances: [
    { name: "index", label: "overview", icon: "grid" },
    { name: "money", label: "money", icon: "finances" },
    { name: "planning", label: "planning", icon: "wallet" },
    { name: "manage", label: "manage", icon: "settings" },
  ],
  settings: [
    { name: "index", label: "account", icon: "profile" },
    { name: "personal", label: "personal", icon: "target" },
    { name: "workspaces", label: "workspaces", icon: "grid" },
    { name: "app", label: "app", icon: "settings" },
  ],
} as const satisfies Record<string, readonly WorkspacePageDefinition[]>;
export type WorkspaceWithPages = keyof typeof workspacePages;
