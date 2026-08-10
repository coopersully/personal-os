import { type LucideIcon, PanelTop } from "lucide-react";
import { workspaceIdentities } from "../components/workspace-identity.js";

export const workspaceIds = ["today", "calendar", "tasks", "mail", "finances"] as const;

export type WorkspaceId = (typeof workspaceIds)[number];

export type WorkspaceDefinition = {
  description: string;
  icon: LucideIcon;
  id: WorkspaceId;
  label: string;
  path: string;
};

export type NavigationOwner =
  | { kind: "workspace"; workspace: WorkspaceId }
  | { kind: "account-utility" };

export const workspaceDefinitions: WorkspaceDefinition[] = [
  {
    description: "See your day and personal direction.",
    icon: PanelTop,
    id: "today",
    label: "Today at a Glance",
    path: "/today",
  },
  { ...workspaceIdentities.calendar, description: "Plan and review your time." },
  { ...workspaceIdentities.tasks, description: "Capture and complete what matters." },
  { ...workspaceIdentities.mail, description: "Read and act on your messages." },
  { ...workspaceIdentities.finances, description: "Understand your money and decisions." },
];

export function navigationOwnerForLocation(pathname: string): NavigationOwner {
  if (pathname === "/settings" || pathname === "/setup") return { kind: "account-utility" };
  if (["/today", "/goals", "/motives", "/activity"].includes(pathname)) {
    return { kind: "workspace", workspace: "today" };
  }
  if (pathname === "/reminders" || pathname === "/tasks") {
    return { kind: "workspace", workspace: "tasks" };
  }
  if (pathname === "/calendar" || pathname.startsWith("/calendar/")) {
    return { kind: "workspace", workspace: "calendar" };
  }
  if (pathname === "/mail" || pathname.startsWith("/mail/")) {
    return { kind: "workspace", workspace: "mail" };
  }
  if (pathname === "/finances" || pathname.startsWith("/finances/")) {
    return { kind: "workspace", workspace: "finances" };
  }
  return { kind: "workspace", workspace: "today" };
}

export function workspaceForLocation(pathname: string): WorkspaceDefinition | undefined {
  const owner = navigationOwnerForLocation(pathname);
  return owner.kind === "workspace"
    ? workspaceDefinitions.find((workspace) => workspace.id === owner.workspace)
    : undefined;
}
