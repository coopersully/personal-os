import type { IconName } from "../components/icons";

// Mobile navigation shares domain data with web, with platform-specific grouping.
export type WorkspacePageDefinition = { name: string; label: string; icon: IconName };
export const workspacePages = {
  tasks: [
    { name: "index", label: "to-do", icon: "calendar" },
    { name: "projects", label: "projects", icon: "project" },
    { name: "lists", label: "lists", icon: "views" },
    { name: "views", label: "browse", icon: "grid" },
  ],
  mail: [
    { name: "index", label: "inbox", icon: "inbox" },
    { name: "mailboxes", label: "mailboxes", icon: "inbox" },
  ],
  finances: [
    { name: "index", label: "overview", icon: "grid" },
    { name: "spending", label: "spending", icon: "receipt" },
    { name: "plan", label: "plan", icon: "wallet" },
    { name: "accounts", label: "accounts", icon: "finances" },
    { name: "assistant", label: "assistant", icon: "star" },
  ],
} as const satisfies Record<string, readonly WorkspacePageDefinition[]>;
export type WorkspaceWithPages = keyof typeof workspacePages;
