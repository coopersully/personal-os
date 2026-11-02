import {
  BankIcon,
  CalendarIcon,
  GridIcon,
  HistoryIcon,
  InboxIcon,
  ListTodoIcon,
  PinIcon,
  SettingsIcon,
  TargetIcon,
  UserIcon,
  WalletIcon,
} from "@/components/icons";
import type { MobileWorkspacePage } from "./mobile-workspace-dock";

/** Sidebar groups are the mobile navigation level; child routes retain their own URLs. */
const sections: Record<string, Array<Omit<MobileWorkspacePage, "path">>> = {
  tasks: [
    { id: "views", label: "views", icon: ListTodoIcon },
    { id: "pinned", label: "pinned", icon: PinIcon },
    { id: "history", label: "history", icon: HistoryIcon },
  ],
  mail: [{ id: "mailboxes", label: "mailboxes", icon: InboxIcon }],
  finances: [
    { id: "money", label: "money", icon: BankIcon },
    { id: "planning", label: "planning", icon: WalletIcon },
    { id: "manage", label: "manage", icon: SettingsIcon },
  ],
  settings: [
    { id: "account", label: "account", icon: UserIcon },
    { id: "personal", label: "personal", icon: TargetIcon },
    { id: "workspaces", label: "workspaces", icon: GridIcon },
    { id: "app", label: "app", icon: SettingsIcon },
  ],
};

export function workspaceSectionPages(owner: string, search: string): MobileWorkspacePage[] {
  const current = new URLSearchParams(search);
  const pages: MobileWorkspacePage[] = (sections[owner] ?? []).map((section) => {
    const params = new URLSearchParams({ navigation: section.id });
    // Folder navigation stays within the selected mail accounts, but exits a thread.
    if (owner === "mail") {
      for (const account of current.getAll("account")) params.append("account", account);
    }
    return { ...section, kind: "section", path: `/${owner}?${params}` };
  });
  const primary =
    owner === "tasks"
      ? { id: "today", label: "today", icon: CalendarIcon, path: "/tasks?view=today" }
      : owner === "mail"
        ? { id: "inbox", label: "inbox", icon: InboxIcon, path: "/mail" }
        : owner === "finances"
          ? { id: "overview", label: "overview", icon: GridIcon, path: "/finances" }
          : null;
  if (primary) {
    if (owner === "mail") {
      const accounts = new URLSearchParams();
      for (const account of current.getAll("account")) accounts.append("account", account);
      if (accounts.size) primary.path += `?${accounts}`;
    }
    pages.unshift({ ...primary, kind: "destination" });
  }
  return pages;
}

export function activeWorkspaceSection(owner: string, pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  const requested = params.get("navigation");
  if (sections[owner]?.some(({ id }) => id === requested)) return requested as string;
  if (owner === "tasks") {
    if (pathname === "/tasks" && params.get("view") === "today" && !params.has("archive"))
      return "today";
    return params.has("archive") ||
      ["history", "completed", "cancelled", "trash"].includes(params.get("view") ?? "")
      ? "history"
      : "views";
  }
  if (owner === "finances") {
    const page = pathname.split("/")[2];
    if (!page) return "overview";
    if (["plan", "budgets", "cashflow", "subscriptions", "wealth"].includes(page ?? ""))
      return "planning";
    if (["chat", "automations", "activity", "setup"].includes(page ?? "")) return "manage";
    return "money";
  }
  if (owner === "mail") {
    return pathname === "/mail" &&
      !params.has("mailbox") &&
      !params.has("unread") &&
      (!params.get("view") || params.get("view") === "all")
      ? "inbox"
      : "mailboxes";
  }
  return "account";
}
