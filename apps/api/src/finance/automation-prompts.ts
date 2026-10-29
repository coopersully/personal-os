import type { AutomationHostSchedule } from "@personal-os/domain";

/** Increment whenever issued instruction text or supported protocol changes. */
export const FINANCE_AUTOMATION_PROMPT_VERSION = 3;

export function renderFinanceAutomationPrompt(
  schedule: Pick<AutomationHostSchedule, "id" | "hostSurface"> &
    Partial<Pick<AutomationHostSchedule, "trigger">>,
): string {
  const observation =
    schedule.hostSurface === "codex_desktop"
      ? "Include the actual next Codex host slot."
      : schedule.trigger?.type === "scheduled"
        ? `This is a scheduled-only Claude routine at ${schedule.trigger.localTimes.join(" and ")} in ${schedule.trigger.timeZone}. Configure these local wall times in the host, preserving daylight-saving changes. nohmi projects the next slot from the declared cadence, not verified provider configuration; do not submit nextExpectedAt. Only when this routine is actually invoking nohmi, report invocationObserved: true and its actual current observedAt. A generic active-state check does not establish invocation or advance an outstanding slot. No API trigger or trigger bearer is required. Pending continuations wait for the next scheduled invocation; do not promise an immediate wake-up.`
        : "This Claude event host has no next-run countdown.";
  return `Use the original nohmi connection bound to internal schedule ${schedule.id}. This ID identifies the schedule; it is not a credential. First read get_finance_continuations for this schedule to obtain its current version and state. Follow nextCursor while hasMore is true to read every page. Report actual host state using observe_finance_host_schedule with those expected values and a current observedAt; never invent an observation. ${observation} If pending or accepted answer continuations exist, continue each with maintain_finances operation continue, its continuationId, and automationScheduleId ${schedule.id}. Follow the returned next action and resume with the saved run ID until the case settles or needs a human decision. Do not start a broader run while an answer continuation is outstanding. Otherwise start maintain_finances operation start with automationScheduleId ${schedule.id}, then resume the returned run ID. Read the API-owned Finance playbook when instructed. Never guess answers. Follow the current Finance review policy. When owner-enabled review bypass and the required execution scopes are present, apply prepared changes, including budgets, without individual approval and record agent_self_approval. Otherwise obtain the required owner approval. Keep financial context inside nohmi. Notify me only for decisions, failures, or completion. This prompt supports existing maintenance continuations; it does not verify Chat capability. External scheduling remains the host's responsibility.`;
}
