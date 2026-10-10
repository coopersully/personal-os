import type { AgentAccessWorkItem } from "@personal-os/domain";
import type { ProjectionInput } from "./review-projections/contract.js";
import { projectAttention, projectReconnect } from "./review-projections/helpers.js";

export function projectCalendarWork(input: ProjectionInput): AgentAccessWorkItem[] {
  const items = projectAttention("calendar", "Calendar", "/calendar", input);
  for (const account of input.results.accounts ?? []) {
    if (account.calendarEnabled) items.push(...projectReconnect("calendar", "Calendar", account));
  }
  return items;
}
