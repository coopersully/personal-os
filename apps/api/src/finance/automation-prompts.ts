import type { AutomationHostSchedule } from "@personal-os/domain";

/** Increment whenever issued instruction text or supported protocol changes. */
export const FINANCE_AUTOMATION_PROMPT_VERSION = 1;

export function renderFinanceAutomationPrompt(
  schedule: Pick<AutomationHostSchedule, "id" | "hostSurface">,
): string {
  const observation =
    schedule.hostSurface === "codex_desktop"
      ? "Include the actual next Codex host slot."
      : "This Claude event host has no next-run countdown.";
  return `Use the original nohmi connection bound to internal schedule ${schedule.id}. This ID identifies the schedule; it is not a credential. First read get_finance_continuations for this schedule to obtain its current version and state. Follow nextCursor while hasMore is true to read every page. Report actual host state using observe_finance_host_schedule with those expected values and a current observedAt; never invent an observation. ${observation} If pending or accepted answer continuations exist, continue each with maintain_finances operation continue, its continuationId, and automationScheduleId ${schedule.id}. Follow the returned next action and resume with the saved run ID until the case settles or needs a human decision. Do not start a broader run while an answer continuation is outstanding. Otherwise start maintain_finances operation start with automationScheduleId ${schedule.id}, then resume the returned run ID. Read the API-owned Finance playbook when instructed. Never guess answers. Never self-approve a budget or other financial change; use the existing human approval boundary. Keep financial context inside nohmi. Notify me only for decisions, failures, or completion. This prompt supports existing maintenance continuations; it does not verify Chat capability. External scheduling remains the host's responsibility.`;
}
