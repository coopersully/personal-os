import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AutomationHostSchedule,
  type AutomationHostScheduleCreateInput,
  automationHostScheduleCreateInputSchema,
  automationHostScheduleSchema,
  automationHostScheduleUpdateInputSchema,
  automationHostSurfaceSchema,
  observeAutomationHostScheduleHealth,
} from "./automation-host-continuation.js";

type TriggerForHost<Schedule, Host> = Schedule extends {
  hostSurface: Host;
  trigger: infer Trigger;
}
  ? Trigger
  : never;

const scheduleId = "00000000-0000-4000-8000-000000000001";
const connectionId = "00000000-0000-4000-8000-000000000002";

describe("automation host schedule contract", () => {
  it("accepts only the two H0-selected host surfaces", () => {
    expect(automationHostSurfaceSchema.options).toEqual(["codex_desktop", "claude_code_routine"]);
    expect(automationHostSurfaceSchema.safeParse("claude_cowork").success).toBe(false);
    expect(automationHostSurfaceSchema.safeParse("codex_sdk").success).toBe(false);
  });

  it("preserves host and trigger correlation in exported types", () => {
    expectTypeOf<
      TriggerForHost<AutomationHostScheduleCreateInput, "codex_desktop">
    >().toEqualTypeOf<{ type: "recurring"; expectedIntervalMinutes: number }>();
    expectTypeOf<TriggerForHost<AutomationHostSchedule, "claude_code_routine">>().toEqualTypeOf<{
      type: "event";
      expectedMaximumLatencyMinutes: number;
    }>();
  });

  it("binds a declaration to one connection and requires Finance maintenance authority", () => {
    expect(
      automationHostScheduleCreateInputSchema.parse({
        connectionId,
        hostSurface: "codex_desktop",
        label: "Finance follow-up",
        scopes: ["finances:read", "finances:maintain", "finances:read"],
        trigger: { type: "recurring", expectedIntervalMinutes: 2 },
      }),
    ).toEqual({
      connectionId,
      hostAutomationId: null,
      hostSurface: "codex_desktop",
      label: "Finance follow-up",
      scopes: ["finances:read", "finances:maintain"],
      trigger: { type: "recurring", expectedIntervalMinutes: 2 },
    });

    expect(
      automationHostScheduleCreateInputSchema.safeParse({
        connectionId,
        hostSurface: "codex_desktop",
        label: "Read-only poll",
        scopes: ["finances:read"],
        trigger: { type: "recurring", expectedIntervalMinutes: 2 },
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleCreateInputSchema.safeParse({
        connectionId,
        hostSurface: "claude_code_routine",
        label: "Invalid scheduled routine",
        scopes: ["finances:maintain"],
        trigger: { type: "recurring", expectedIntervalMinutes: 60 },
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleCreateInputSchema.safeParse({
        connectionId,
        hostSurface: "claude_code_routine",
        hostAutomationId: "routine-1",
        label: "Finance continuation",
        scopes: ["finances:maintain"],
        trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
        callbackUrl: "https://example.com/fire",
      }).success,
    ).toBe(false);
  });

  it("keeps local identity, connection, host and trigger out of schedule updates", () => {
    expect(
      automationHostScheduleUpdateInputSchema.parse({
        expectedVersion: 3,
        label: "Paused Finance follow-up",
        state: "paused",
      }),
    ).toEqual({ expectedVersion: 3, label: "Paused Finance follow-up", state: "paused" });
    expect(
      automationHostScheduleUpdateInputSchema.safeParse({
        expectedVersion: 3,
        id: scheduleId,
        state: "paused",
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleUpdateInputSchema.safeParse({
        expectedVersion: 3,
        scopes: ["finances:read"],
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleUpdateInputSchema.safeParse({
        connectionId,
        expectedVersion: 3,
        state: "paused",
      }).success,
    ).toBe(false);
  });

  it("reports observational health without starting or changing a host schedule", () => {
    const active = automationHostScheduleSchema.parse({
      id: scheduleId,
      connectionId,
      hostSurface: "codex_desktop",
      hostAutomationId: null,
      label: "Finance follow-up",
      scopes: ["finances:maintain"],
      trigger: { type: "recurring", expectedIntervalMinutes: 2 },
      state: "active",
      lastObservedAt: "2026-09-15T12:00:00.000Z",
      version: 1,
      createdAt: "2026-09-15T11:00:00.000Z",
      updatedAt: "2026-09-15T12:00:00.000Z",
    });
    expect(
      observeAutomationHostScheduleHealth(active, new Date("2026-09-15T12:01:59.000Z")),
    ).toEqual({
      state: "expected",
      lastObservedAt: "2026-09-15T12:00:00.000Z",
      nextExpectedAt: "2026-09-15T12:02:00.000Z",
      observedAt: "2026-09-15T12:01:59.000Z",
      repairOwner: null,
    });
    expect(
      observeAutomationHostScheduleHealth(active, new Date("2026-09-15T12:02:01.000Z")),
    ).toEqual({
      state: "overdue",
      lastObservedAt: "2026-09-15T12:00:00.000Z",
      nextExpectedAt: "2026-09-15T12:02:00.000Z",
      observedAt: "2026-09-15T12:02:01.000Z",
      repairOwner: "host",
    });

    expect(
      observeAutomationHostScheduleHealth(
        { ...active, lastObservedAt: null },
        new Date("2026-09-15T12:02:01.000Z"),
      ).state,
    ).toBe("unknown");
    expect(
      observeAutomationHostScheduleHealth(
        { ...active, state: "paused" },
        new Date("2026-09-15T12:02:01.000Z"),
      ).state,
    ).toBe("paused");
  });

  it("treats event-triggered health as observed rather than inventing a cadence", () => {
    const event = automationHostScheduleSchema.parse({
      id: scheduleId,
      connectionId,
      hostSurface: "claude_code_routine",
      hostAutomationId: "routine-1",
      label: "Finance continuation",
      scopes: ["finances:maintain"],
      trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
      state: "active",
      lastObservedAt: "2026-09-15T12:00:00.000Z",
      version: 1,
      createdAt: "2026-09-15T11:00:00.000Z",
      updatedAt: "2026-09-15T12:00:00.000Z",
    });
    expect(
      observeAutomationHostScheduleHealth(event, new Date("2026-09-16T12:00:00.000Z")),
    ).toEqual({
      state: "observed",
      lastObservedAt: "2026-09-15T12:00:00.000Z",
      nextExpectedAt: null,
      observedAt: "2026-09-16T12:00:00.000Z",
      repairOwner: null,
    });
  });
});
