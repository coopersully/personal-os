import type { AgentAccessWorkItem } from "@personal-os/domain";
import type { ProjectionInput } from "./review-projections/contract.js";
import { projectAttention } from "./review-projections/helpers.js";

export function projectTaskWork(input: ProjectionInput): AgentAccessWorkItem[] {
  return projectAttention("tasks", "Tasks", "/tasks", input);
}
