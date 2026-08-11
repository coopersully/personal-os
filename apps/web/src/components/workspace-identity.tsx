import { BankIcon, CalendarIcon, type Icon, ListChecksIcon, MailIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export const workspaceIds = ["calendar", "tasks", "mail", "finances"] as const;

export type WorkspaceId = (typeof workspaceIds)[number];

export type WorkspaceIdentity = {
  icon: Icon;
  id: WorkspaceId;
  label: string;
  path: `/${WorkspaceId}`;
};

export const workspaceIdentities: Record<WorkspaceId, WorkspaceIdentity> = {
  calendar: {
    icon: CalendarIcon,
    id: "calendar",
    label: "Calendar",
    path: "/calendar",
  },
  tasks: {
    icon: ListChecksIcon,
    id: "tasks",
    label: "Tasks",
    path: "/tasks",
  },
  mail: {
    icon: MailIcon,
    id: "mail",
    label: "Mail",
    path: "/mail",
  },
  finances: {
    icon: BankIcon,
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
