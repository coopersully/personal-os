import type { Task } from "@personal-os/domain";
import {
  type ConnectedHostAuthority,
  type DomainCapability,
  type DomainReadinessItem,
  type DomainSetupStatus,
  type DomainSupport,
  hostPermissionReadiness,
  type Loadable,
  loadingReadiness,
  profileReadiness,
  unavailableReadiness,
  unsupportedCapability,
} from "../agent-access/readiness.js";

type TaskPage = { items: Task[]; nextCursor: string | null };

export function taskAgentAccessReadiness({
  hosts,
  profile,
  tasks,
}: {
  hosts: Loadable<ConnectedHostAuthority[]>;
  profile: Loadable<DomainSetupStatus | undefined>;
  tasks: Loadable<TaskPage>;
}): DomainReadinessItem[] {
  const access = hostPermissionReadiness({
    hosts,
    label: "Tasks",
    readScope: "tasks:read",
    writeCapability: "use scoped Task actions",
    writeScope: "tasks:write",
  });
  const material =
    tasks.state === "loading"
      ? loadingReadiness("Tasks", "Tasks are loading.")
      : tasks.state === "unavailable"
        ? unavailableReadiness("Tasks", "Tasks are unavailable.")
        : {
            ...(tasks.data.items.length === 0
              ? { action: { label: "Open Tasks", to: "/tasks" } }
              : {}),
            complete: true,
            description:
              tasks.data.items.length > 0
                ? `${tasks.data.items.length}${tasks.data.nextCursor ? "+" : ""} open Task${tasks.data.items.length === 1 ? "" : "s"} in nohmi.`
                : "No open Tasks. Local capture is available whenever you need it.",
            title: "Tasks",
          };
  return [
    material,
    profileReadiness("Tasks", profile),
    {
      complete: true,
      description:
        "nohmi supports capture, prioritization, scheduling, and bounded single-item Task actions.",
      title: "Task actions",
    },
    access,
  ];
}

export function taskAgentAccessCapability(
  support: DomainSupport,
  invocation: string,
): DomainCapability {
  if (support === "unsupported") return unsupportedCapability("Tasks");
  return {
    allowed: [
      "Read Tasks",
      "Capture and update individual Tasks",
      "Prioritize and schedule bounded work",
    ],
    approvalRequired: ["Approve profile guidance", "Approve any published Task-owned rule"],
    sourceScope:
      "Task permission applies to the nohmi Task workspace; per-list agent credentials are not available.",
    description:
      support === "executable_rules"
        ? "This deployment publishes Task preferences, bounded actions, and Task-owned executable rules."
        : "Task setup can learn capture, priority, estimate, scheduling, and deadline preferences and use bounded single-item actions.",
    setupPrompt: `Use ${invocation} to set up my Tasks in nohmi. Inspect a bounded sample across inbox, planned, scheduled, overdue, and completed work. Ask the shortest useful preference interview, save a draft profile with explicit exceptions, and distinguish scheduling from deadlines${support === "executable_rules" ? " while using only the Task-owned rules this deployment publishes" : ""}.`,
    title:
      support === "executable_rules"
        ? "Task preferences, actions, and rules"
        : "Task preferences and bounded actions",
    unavailable: ["Bulk destructive changes", "Treating a scheduled time as a deadline"],
  };
}
