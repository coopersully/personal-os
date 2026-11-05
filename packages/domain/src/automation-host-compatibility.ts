import { z } from "zod";
import {
  type AutomationHostSchedule,
  automationHostScheduleSchema,
  type scheduledAutomationHostTriggerSchema,
} from "./automation-host-continuation.js";

type ScheduledClaudeReadSchedule = AutomationHostSchedule & {
  hostSurface: "claude_code_routine";
  hostAutomationId: string;
  trigger: z.infer<typeof scheduledAutomationHostTriggerSchema>;
};

function isScheduledClaudeSchedule(
  schedule: AutomationHostSchedule,
): schedule is ScheduledClaudeReadSchedule {
  return (
    schedule.hostSurface === "claude_code_routine" &&
    schedule.trigger.type === "scheduled" &&
    schedule.hostAutomationId !== null
  );
}

/** Read projection only. It is neither a persisted trigger nor a create/upgrade input.
 * The existing schedule retains its original opaque host identity and declared cadence.
 * No mapping or scheduled-origin proof producer is admitted by this contract. */
export const automationHostCombinedReadProjectionSchema = z
  .object({
    formatVersion: z.literal(2),
    kind: z.literal("combined_read_projection"),
    schedule: automationHostScheduleSchema.transform((schedule, context) => {
      if (!isScheduledClaudeSchedule(schedule)) {
        context.addIssue({ code: "custom", message: "Use an existing scheduled Claude host." });
        return z.NEVER;
      }
      return schedule;
    }),
    event: z
      .object({
        kind: z.literal("accepted_answer"),
        expectedMaximumLatencyMinutes: z.int().min(1).max(60),
      })
      .strict(),
    readiness: z
      .object({
        originalHostMapping: z.literal("unknown"),
        scheduledOrigin: z.literal("unknown"),
        credential: z.enum(["absent", "stored_unverified", "unavailable"]),
        chatProtocol: z.enum(["unverified", "expired", "protocol_upgrade_required"]),
        consumption: z.literal("not_demonstrated"),
      })
      .strict(),
  })
  .strict();
export type AutomationHostCombinedReadProjection = z.infer<
  typeof automationHostCombinedReadProjectionSchema
>;

const readProtocolSchema = z.enum(["legacy", "combined-v2"]).default("legacy");
export type AutomationHostReadSelection =
  | { state: "legacy"; value: AutomationHostSchedule }
  | { state: "combined_v2"; value: AutomationHostCombinedReadProjection }
  | { state: "upgrade_required"; reason: "automation_host_protocol_upgrade_required" };

/** Pure selector for a future API adapter, not an installed header/route negotiation.
 * An unaware reader receives no combined payload. Row expectedVersion, prompt version and
 * Chat protocol proof cannot substitute for explicit reader support. */
export function selectAutomationHostReadProtocol(
  supported: unknown,
  raw: unknown,
): AutomationHostReadSelection {
  const protocol = readProtocolSchema.parse(supported);
  const value = z
    .union([automationHostScheduleSchema, automationHostCombinedReadProjectionSchema])
    .parse(raw);
  if (!("formatVersion" in value)) return { state: "legacy", value };
  if (protocol !== "combined-v2")
    return { state: "upgrade_required", reason: "automation_host_protocol_upgrade_required" };
  return { state: "combined_v2", value };
}

/** Declared shape is not verified runtime capability. No reader input can open the writer
 * gate, advance a slot, select a mapped provider target or authorize an external effect. */
export function describeAutomationHostReadCapabilities(raw: unknown): {
  scheduledCadence: "declared";
  eventExecution: "unavailable";
  reason: "combined_writes_disabled";
} {
  automationHostCombinedReadProjectionSchema.parse(raw);
  return {
    scheduledCadence: "declared",
    eventExecution: "unavailable",
    reason: "combined_writes_disabled",
  };
}
