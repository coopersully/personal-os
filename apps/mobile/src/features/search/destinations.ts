import type { SearchableWorkspace, WorkspaceSearchResult } from "@personal-os/domain";
import type { Href } from "expo-router";
import type { IconName } from "../../components/icons";
import { workspaceSettingsPath } from "../settings/navigation";

const icons: Record<string, IconName> = {
  Event: "calendar",
  Calendar: "calendar",
  Task: "tasks",
  Reminder: "clock",
  List: "views",
  Project: "project",
  Conversation: "mail",
  Mailbox: "inbox",
  Rule: "settings",
  Transaction: "receipt",
  Account: "wallet",
  Category: "categoryTags",
  Plan: "target",
};
export function searchResultIcon(workspace: SearchableWorkspace, kind: string): IconName {
  return icons[kind] ?? workspace;
}

/** Server previews join optional parts with " · "; drop the parts a record does not have. */
export function searchResultPreview(preview: string) {
  return preview
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}

export type SearchDestination = {
  href: Href;
  /** Tab pages are switched to; details and settings open above the tabs. */
  open: "push" | "navigate";
};
const detail = (href: Href): SearchDestination => ({ href, open: "push" });
const page = (href: Href): SearchDestination => ({ href, open: "navigate" });

/**
 * The existing native screen for a search result. Search never mutates and never invents a
 * screen: a kind without its own record route opens the nearest screen that shows the record.
 */
export function searchDestination(
  workspace: SearchableWorkspace,
  result: WorkspaceSearchResult,
): SearchDestination {
  const { id, kind, title } = result;
  // A closed or archived container lists nothing under the default open-work status.
  const closed = result.state ? { status: "all" } : {};
  switch (kind) {
    case "Event":
      return detail({ pathname: "/calendar-event", params: { id } });
    case "Calendar":
      return detail({ pathname: "/settings/calendar/source", params: { id } });
    case "Task":
      return detail({ pathname: "/task-editor", params: { id, kind: "task" } });
    case "Reminder":
      return detail({ pathname: "/task-editor", params: { id, kind: "reminder" } });
    case "List":
      return detail({
        pathname: "/task-browser",
        params: { title, view: "all", kind: "task", listId: id, ...closed },
      });
    case "Project":
      return detail({
        pathname: "/task-browser",
        params: { title, view: "all", kind: "task", projectId: id, ...closed },
      });
    case "Conversation":
      // Mail has no conversation route. Its list search covers inboxes only, so a conversation
      // outside them (Archived) opens the mailbox list, where its mailbox can be chosen.
      if (result.state) return page("/mail/mailboxes");
      return page(title.trim() ? { pathname: "/mail", params: { mailSearch: title } } : "/mail");
    case "Mailbox":
      return page("/mail/mailboxes");
    case "Rule":
      return detail({ pathname: "/settings/mail/rule", params: { id } });
    case "Transaction":
      return detail({ pathname: "/finance-transaction", params: { id } });
    case "Account":
      return detail({ pathname: "/finance-account", params: { id } });
    case "Category":
      return detail(workspaceSettingsPath("finances"));
    case "Plan":
      return page("/finances/plan");
    default:
      return page(`/${workspace}`);
  }
}
