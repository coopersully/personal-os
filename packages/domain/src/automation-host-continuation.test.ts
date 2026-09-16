import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AutomationHostSchedule,
  type AutomationHostScheduleCreateInput,
  automationHostScheduleBindInputSchema,
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
const tenantAuthorizationConnectionId = "00000000-0000-4000-8000-000000000002";

const recurringTrigger = {
  type: "recurring" as const,
  recurrence: {
    type: "interval" as const,
    everyMinutes: 2,
    timeZone: "America/New_York",
  },
};

describe("automation host schedule contract", () => {
  it("accepts only the two H0-selected host surfaces", () => {
    expect(automationHostSurfaceSchema.options).toEqual(["codex_desktop", "claude_code_routine"]);
    expect(automationHostSurfaceSchema.safeParse("claude_cowork").success).toBe(false);
    expect(automationHostSurfaceSchema.safeParse("codex_sdk").success).toBe(false);
  });

  it("preserves host, trigger and bound identity correlation in exported types", () => {
    expectTypeOf<
      TriggerForHost<AutomationHostScheduleCreateInput, "codex_desktop">
    >().toEqualTypeOf<{
      type: "recurring";
      recurrence: { type: "interval"; everyMinutes: number; timeZone: string };
    }>();
    expectTypeOf<TriggerForHost<AutomationHostSchedule, "claude_code_routine">>().toEqualTypeOf<{
      type: "event";
      expectedMaximumLatencyMinutes: number;
    }>();
    expectTypeOf<
      Extract<
        AutomationHostSchedule,
        { hostSurface: "claude_code_routine"; state: "active" }
      >["hostAutomationId"]
    >().toEqualTypeOf<string>();
    expectTypeOf<
      Extract<AutomationHostSchedule, { state: "setup_pending" }>["hostAutomationId"]
    >().toEqualTypeOf<null>();
  });

  it("treats requested scopes as a non-authoritative create request", () => {
    expect(
      automationHostScheduleCreateInputSchema.parse({
        tenantAuthorizationConnectionId,
        hostSurface: "codex_desktop",
        label: "Finance follow-up",
        requestedScopes: ["finances:read", "finances:maintain", "finances:read"],
        trigger: recurringTrigger,
      }),
    ).toEqual({
      tenantAuthorizationConnectionId,
      hostSurface: "codex_desktop",
      label: "Finance follow-up",
      requestedScopes: ["finances:read", "finances:maintain"],
      trigger: recurringTrigger,
    });
    expect(
      automationHostScheduleCreateInputSchema.safeParse({
        tenantAuthorizationConnectionId,
        hostSurface: "codex_desktop",
        label: "Read-only poll",
        requestedScopes: ["finances:read"],
        trigger: recurringTrigger,
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleCreateInputSchema.safeParse({
        tenantAuthorizationConnectionId,
        hostSurface: "claude_code_routine",
        label: "Invalid scheduled routine",
        requestedScopes: ["finances:maintain"],
        trigger: recurringTrigger,
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleCreateInputSchema.safeParse({
        tenantAuthorizationConnectionId,
        hostSurface: "claude_code_routine",
        label: "Finance continuation",
        requestedScopes: ["finances:maintain"],
        trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
        effectiveScopes: ["finances:maintain"],
      }).success,
    ).toBe(false);
  });

  it("rejects labels made only from default-ignorable code points", () => {
    expect(
      automationHostScheduleCreateInputSchema.safeParse({
        tenantAuthorizationConnectionId,
        hostSurface: "codex_desktop",
        label: "\u200B\u200C\u2060",
        requestedScopes: ["finances:maintain"],
        trigger: recurringTrigger,
      }).success,
    ).toBe(false);
  });

  it("stores only server-resolved effective authority on a durable tenant connection", () => {
    expect(
      automationHostScheduleSchema.parse({
        id: scheduleId,
        tenantAuthorizationConnectionId,
        hostSurface: "claude_code_routine",
        hostAutomationId: null,
        label: "Finance continuation",
        effectiveScopes: ["finances:read", "finances:maintain", "finances:read"],
        trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
        state: "setup_pending",
        lastObservedAt: null,
        nextExpectedAt: null,
        version: 1,
        createdAt: "2026-09-15T11:00:00.000Z",
        updatedAt: "2026-09-15T11:00:00.000Z",
      }),
    ).toMatchObject({
      tenantAuthorizationConnectionId,
      effectiveScopes: ["finances:read", "finances:maintain"],
      hostAutomationId: null,
      state: "setup_pending",
    });
    expect(
      automationHostScheduleSchema.safeParse({
        id: scheduleId,
        tenantAuthorizationConnectionId,
        hostSurface: "claude_code_routine",
        hostAutomationId: null,
        label: "Finance continuation",
        effectiveScopes: ["finances:maintain"],
        trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
        state: "active",
        lastObservedAt: null,
        nextExpectedAt: null,
        version: 1,
        createdAt: "2026-09-15T11:00:00.000Z",
        updatedAt: "2026-09-15T11:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleSchema.safeParse({
        id: scheduleId,
        tenantAuthorizationConnectionId,
        hostSurface: "claude_code_routine",
        hostAutomationId: null,
        label: "Finance continuation",
        effectiveScopes: ["finances:read"],
        trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
        state: "setup_pending",
        lastObservedAt: null,
        nextExpectedAt: null,
        version: 1,
        createdAt: "2026-09-15T11:00:00.000Z",
        updatedAt: "2026-09-15T11:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("defines a version-guarded one-time setup binding", () => {
    expect(
      automationHostScheduleBindInputSchema.parse({
        expectedVersion: 1,
        expectedState: "setup_pending",
        hostSurface: "claude_code_routine",
        hostAutomationId: "routine-1",
      }),
    ).toEqual({
      expectedVersion: 1,
      expectedState: "setup_pending",
      hostSurface: "claude_code_routine",
      hostAutomationId: "routine-1",
    });
    expect(
      automationHostScheduleBindInputSchema.parse({
        expectedVersion: 1,
        expectedState: "setup_pending",
        hostSurface: "codex_desktop",
        hostAutomationId: "automation-1",
        nextExpectedAt: "2026-09-15T12:02:00.000Z",
      }),
    ).toMatchObject({ nextExpectedAt: "2026-09-15T12:02:00.000Z" });
    expect(
      automationHostScheduleBindInputSchema.safeParse({
        expectedVersion: 1,
        expectedState: "active",
        hostSurface: "claude_code_routine",
        hostAutomationId: "replacement-routine",
      }).success,
    ).toBe(false);
  });

  it("keeps identity and authority out of generic schedule updates", () => {
    expect(
      automationHostScheduleUpdateInputSchema.parse({
        expectedVersion: 3,
        label: "Paused Finance follow-up",
        state: "paused",
      }),
    ).toEqual({ expectedVersion: 3, label: "Paused Finance follow-up", state: "paused" });
    for (const forbiddenChange of [
      { id: scheduleId },
      { tenantAuthorizationConnectionId },
      { requestedScopes: ["finances:maintain"] },
      { effectiveScopes: ["finances:maintain"] },
      { hostAutomationId: "replacement-routine" },
    ]) {
      expect(
        automationHostScheduleUpdateInputSchema.safeParse({
          expectedVersion: 3,
          state: "paused",
          ...forbiddenChange,
        }).success,
      ).toBe(false);
    }
  });

  it("evaluates recurring health from the persisted host slot", () => {
    const active = automationHostScheduleSchema.parse({
      id: scheduleId,
      tenantAuthorizationConnectionId,
      hostSurface: "codex_desktop",
      hostAutomationId: "automation-1",
      label: "Finance follow-up",
      effectiveScopes: ["finances:maintain"],
      trigger: recurringTrigger,
      state: "active",
      lastObservedAt: "2026-09-15T11:59:30.000Z",
      nextExpectedAt: "2026-09-15T12:02:00.000Z",
      version: 1,
      createdAt: "2026-09-15T11:00:00.000Z",
      updatedAt: "2026-09-15T12:00:00.000Z",
    });
    expect(
      observeAutomationHostScheduleHealth(active, new Date("2026-09-15T12:01:59.000Z")),
    ).toEqual({
      state: "expected",
      lastObservedAt: "2026-09-15T11:59:30.000Z",
      nextExpectedAt: "2026-09-15T12:02:00.000Z",
      observedAt: "2026-09-15T12:01:59.000Z",
      repairOwner: null,
    });
    expect(
      observeAutomationHostScheduleHealth(
        { ...active, lastObservedAt: null },
        new Date("2026-09-15T12:02:01.000Z"),
      ),
    ).toEqual({
      state: "overdue",
      lastObservedAt: null,
      nextExpectedAt: "2026-09-15T12:02:00.000Z",
      observedAt: "2026-09-15T12:02:01.000Z",
      repairOwner: "host",
    });
  });

  it("treats event-triggered health as observed rather than inventing a cadence", () => {
    const event = automationHostScheduleSchema.parse({
      id: scheduleId,
      tenantAuthorizationConnectionId,
      hostSurface: "claude_code_routine",
      hostAutomationId: "routine-1",
      label: "Finance continuation",
      effectiveScopes: ["finances:maintain"],
      trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
      state: "active",
      lastObservedAt: "2026-09-15T12:00:00.000Z",
      nextExpectedAt: null,
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
