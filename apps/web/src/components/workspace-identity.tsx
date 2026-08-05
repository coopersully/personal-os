import { CalendarDays, Landmark, ListChecks, type LucideIcon, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

export const workspaceIds = ["calendar", "tasks", "mail", "finances"] as const;

export type WorkspaceId = (typeof workspaceIds)[number];

export type WorkspaceIdentity = {
  icon: LucideIcon;
  id: WorkspaceId;
  label: string;
  path: `/${WorkspaceId}`;
};

export const workspaceIdentities: Record<WorkspaceId, WorkspaceIdentity> = {
  calendar: {
    icon: CalendarDays,
    id: "calendar",
    label: "Calendar",
    path: "/calendar",
  },
  tasks: {
    icon: ListChecks,
    id: "tasks",
    label: "Tasks",
    path: "/tasks",
  },
  mail: {
    icon: Mail,
    id: "mail",
    label: "Mail",
    path: "/mail",
  },
  finances: {
    icon: Landmark,
    id: "finances",
    label: "Finances",
    path: "/finances",
  },
};

export function workspaceIdForPath(path: string): WorkspaceId | undefined {
  return workspaceIds.find((id) => {
    const workspacePath = workspaceIdentities[id].path;
    return path === workspacePath || (id === "finances" && path.startsWith(`${workspacePath}/`));
  });
}

export function WorkspaceIcon({
  className,
  size = "md",
  workspace,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  workspace: WorkspaceId;
}) {
  const Icon = workspaceIdentities[workspace].icon;
  return (
    <span
      aria-hidden="true"
      className={cn("workspace-icon", className)}
      data-size={size}
      data-workspace={workspace}
    >
      <Icon />
    </span>
  );
}
