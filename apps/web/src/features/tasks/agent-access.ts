import type { AttentionItem, Task } from "@personal-os/domain";
import {
  attentionReadiness,
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
  attention,
  hosts,
  profile,
  tasks,
}: {
  attention: Loadable<AttentionItem[]>;
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
      ? loadingReadiness("Task material", "Task material is loading.")
      : tasks.state === "unavailable"
        ? unavailableReadiness("Task material", "Task material is unavailable.")
        : {
            ...(tasks.data.items.length === 0
              ? { action: { label: "Open Tasks", to: "/tasks" } }
              : {}),
            complete: true,
            description:
              tasks.data.items.length > 0
                ? `${tasks.data.items.length}${tasks.data.nextCursor ? "+" : ""} open Task${tasks.data.items.length === 1 ? "" : "s"} in Ilo.`
                : "No open Tasks. Local capture is available whenever you need it.",
            title: "Task material",
          };
  return [
    material,
    profileReadiness("Tasks", profile),
    {
      complete: true,
      description:
        "Ilo supports capture, prioritization, scheduling, and bounded single-item Task actions.",
      title: "Task workflow",
    },
    attentionReadiness("Tasks", attention),
    access,
  ];
}

export function taskAgentAccessCapability(
  support: DomainSupport,
  invocation: string,
): DomainCapability {
  if (support === "unsupported") return unsupportedCapability("Tasks");
  return {
    description:
      support === "executable_rules"
        ? "This deployment publishes Task preferences, bounded actions, and Task-owned executable rules."
        : "Task setup can learn capture, priority, estimate, scheduling, and deadline preferences and use bounded single-item actions.",
    setupPrompt: `Use ${invocation} to set up my Tasks in Ilo. Inspect a bounded sample across inbox, planned, scheduled, overdue, and completed work. Ask the shortest useful preference interview, save a draft profile with explicit exceptions, and distinguish scheduling from deadlines${support === "executable_rules" ? " while using only the Task-owned rules this deployment publishes" : ""}.`,
    title:
      support === "executable_rules"
        ? "Task preferences, actions, and rules"
        : "Task preferences and bounded actions",
  };
}
