import { type Icon, PanelTopIcon } from "../components/icons.js";
import { workspaceIdentities } from "../components/workspace-identity.js";

export const workspaceIds = ["today", "calendar", "tasks", "mail", "finances"] as const;

export type WorkspaceId = (typeof workspaceIds)[number];

export type WorkspaceDefinition = {
  description: string;
  icon: Icon;
  id: WorkspaceId;
  label: string;
  path: string;
};

/**
 * Every authenticated route declares one navigation owner, and the owner —
 * never a route name — decides which sidebar and frame the shell renders.
 *
 * `account-utility` is account administration. It is a tenant of the
 * application shell: it uses the shared frame and app bar, but it is not a
 * workspace and never enters the workspace switcher. `standalone-flow` is a
 * self-contained flow such as setup, which owns the whole viewport because
 * there is no workspace to return to yet.
 */
export type NavigationOwner =
  | { kind: "workspace"; workspace: WorkspaceId }
  | { kind: "account-utility" }
  | { kind: "standalone-flow" };

export const workspaceDefinitions: WorkspaceDefinition[] = [
  {
    description: "See what matters now and what comes next.",
    icon: PanelTopIcon,
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
  if (pathname === "/setup") return { kind: "standalone-flow" };
  if (["/settings", "/reviews", "/goals", "/motives", "/activity"].includes(pathname)) {
    return { kind: "account-utility" };
  }
  if (pathname === "/today") {
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

/** Only a self-contained flow may replace the application shell. */
export function rendersApplicationShell(owner: NavigationOwner): boolean {
  return owner.kind !== "standalone-flow";
}

export function workspaceForLocation(pathname: string): WorkspaceDefinition | undefined {
  const owner = navigationOwnerForLocation(pathname);
  return owner.kind === "workspace"
    ? workspaceDefinitions.find((workspace) => workspace.id === owner.workspace)
    : undefined;
}
