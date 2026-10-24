import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AutomationHostSchedule,
  type AutomationHostScheduleCreateInput,
  automationHostPromptIssueInputSchema,
  automationHostPromptIssueSchema,
  automationHostPromptPageInputSchema,
  automationHostScheduleBindInputSchema,
  automationHostScheduleCancelInputSchema,
  automationHostScheduleCreateInputSchema,
  automationHostScheduleObservationInputSchema,
  automationHostScheduleRevokeInputSchema,
  automationHostScheduleSchema,
  automationHostScheduleUpdateInputSchema,
  automationHostSurfaceSchema,
  nextScheduledAutomationHostSlot,
  observeAutomationHostScheduleHealth,
  scheduledAutomationHostTriggerSchema,
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
    expectTypeOf<TriggerForHost<AutomationHostSchedule, "claude_code_routine">>().toEqualTypeOf<
      | {
          type: "event";
          expectedMaximumLatencyMinutes: number;
        }
      | { type: "scheduled"; localTimes: string[]; timeZone: string }
    >();
    expectTypeOf<
      Extract<
        AutomationHostSchedule,
        { hostSurface: "claude_code_routine"; state: "active" }
      >["hostAutomationId"]
    >().toEqualTypeOf<string>();
    expectTypeOf<
      Extract<AutomationHostSchedule, { state: "setup_pending" }>["hostAutomationId"]
    >().toEqualTypeOf<null>();
    expectTypeOf<
      Extract<AutomationHostSchedule, { state: "cancelled" }>["hostAutomationId"]
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

  it("rejects control-only labels in create and update while preserving visible Unicode", () => {
    for (const label of ["\u0000", "\u0007", "\u0000\u200B\u0007"]) {
      expect(
        automationHostScheduleCreateInputSchema.safeParse({
          tenantAuthorizationConnectionId,
          hostSurface: "codex_desktop",
          label,
          requestedScopes: ["finances:maintain"],
          trigger: recurringTrigger,
        }).success,
      ).toBe(false);
      expect(
        automationHostScheduleUpdateInputSchema.safeParse({ expectedVersion: 2, label }).success,
      ).toBe(false);
    }
    expect(
      automationHostScheduleUpdateInputSchema.parse({
        expectedVersion: 2,
        label: "財務 café 👩‍💻",
      }),
    ).toMatchObject({ label: "財務 café 👩‍💻" });
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
      }),
    ).toEqual({ expectedVersion: 3, label: "Paused Finance follow-up" });
    for (const forbiddenChange of [
      { id: scheduleId },
      { tenantAuthorizationConnectionId },
      { requestedScopes: ["finances:maintain"] },
      { effectiveScopes: ["finances:maintain"] },
      { hostAutomationId: "replacement-routine" },
      { state: "active" },
      { state: "paused" },
      { state: "revoked" },
    ]) {
      expect(
        automationHostScheduleUpdateInputSchema.safeParse({
          expectedVersion: 3,
          label: "Finance follow-up",
          ...forbiddenChange,
        }).success,
      ).toBe(false);
    }
  });

  it("keeps revocation terminal and host state changes evidence-owned", () => {
    expect(
      automationHostScheduleRevokeInputSchema.parse({
        expectedVersion: 3,
        expectedState: "paused",
      }),
    ).toEqual({ expectedVersion: 3, expectedState: "paused" });
    expect(
      automationHostScheduleRevokeInputSchema.safeParse({
        expectedVersion: 4,
        expectedState: "revoked",
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleObservationInputSchema.safeParse({
        expectedVersion: 4,
        expectedState: "revoked",
        hostSurface: "claude_code_routine",
        observedState: "active",
        observedAt: "2026-09-15T12:10:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("cancels abandoned setup without inventing a bound host identity", () => {
    expect(
      automationHostScheduleCancelInputSchema.parse({
        expectedVersion: 2,
        expectedState: "setup_pending",
      }),
    ).toEqual({ expectedVersion: 2, expectedState: "setup_pending" });
    expect(
      automationHostScheduleCancelInputSchema.safeParse({
        expectedVersion: 0,
        expectedState: "setup_pending",
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleCancelInputSchema.safeParse({
        expectedVersion: 2,
        expectedState: "active",
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleCancelInputSchema.safeParse({
        expectedVersion: 2,
        expectedState: "cancelled",
      }).success,
    ).toBe(false);

    const cancelled = automationHostScheduleSchema.parse({
      id: scheduleId,
      tenantAuthorizationConnectionId,
      hostSurface: "claude_code_routine",
      hostAutomationId: null,
      label: "Abandoned Finance continuation",
      effectiveScopes: ["finances:maintain"],
      trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
      state: "cancelled",
      lastObservedAt: null,
      nextExpectedAt: null,
      version: 3,
      createdAt: "2026-09-15T11:00:00.000Z",
      updatedAt: "2026-09-15T11:05:00.000Z",
    });
    expect(cancelled).toMatchObject({
      state: "cancelled",
      hostAutomationId: null,
      tenantAuthorizationConnectionId,
    });
    expect(
      automationHostScheduleBindInputSchema.safeParse({
        expectedVersion: 3,
        expectedState: "cancelled",
        hostSurface: "claude_code_routine",
        hostAutomationId: "routine-after-cancellation",
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleObservationInputSchema.safeParse({
        expectedVersion: 3,
        expectedState: "cancelled",
        hostSurface: "claude_code_routine",
        observedState: "active",
        observedAt: "2026-09-15T11:06:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      observeAutomationHostScheduleHealth(cancelled, new Date("2026-09-15T11:06:00.000Z")),
    ).toMatchObject({ state: "cancelled", repairOwner: null });
  });

  it("requires a fresh recurring host slot when observation resumes a paused schedule", () => {
    expect(
      automationHostScheduleObservationInputSchema.parse({
        expectedVersion: 3,
        expectedState: "paused",
        hostSurface: "codex_desktop",
        observedState: "active",
        observedAt: "2026-09-15T12:10:00.000Z",
        nextExpectedAt: "2026-09-15T12:12:00.000Z",
      }),
    ).toMatchObject({
      expectedState: "paused",
      observedState: "active",
      nextExpectedAt: "2026-09-15T12:12:00.000Z",
    });
    expect(
      automationHostScheduleObservationInputSchema.safeParse({
        expectedVersion: 3,
        expectedState: "paused",
        hostSurface: "codex_desktop",
        observedState: "active",
        observedAt: "2026-09-15T12:10:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleObservationInputSchema.safeParse({
        expectedVersion: 3,
        expectedState: "paused",
        hostSurface: "codex_desktop",
        observedState: "active",
        observedAt: "2026-09-15T12:10:00.000Z",
        nextExpectedAt: "2026-09-15T12:10:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      automationHostScheduleSchema.safeParse({
        id: scheduleId,
        tenantAuthorizationConnectionId,
        hostSurface: "codex_desktop",
        hostAutomationId: "automation-1",
        label: "Finance follow-up",
        effectiveScopes: ["finances:maintain"],
        trigger: recurringTrigger,
        state: "paused",
        lastObservedAt: "2026-09-15T12:00:00.000Z",
        nextExpectedAt: "2026-09-15T12:02:00.000Z",
        version: 3,
        createdAt: "2026-09-15T11:00:00.000Z",
        updatedAt: "2026-09-15T12:10:00.000Z",
      }).success,
    ).toBe(false);
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
      expectationBasis: "host_reported",
      graceMilliseconds: 300000,
      overdueAt: "2026-09-15T12:07:00.000Z",
      lastObservedAt: "2026-09-15T11:59:30.000Z",
      nextExpectedAt: "2026-09-15T12:02:00.000Z",
      observedAt: "2026-09-15T12:01:59.000Z",
      repairOwner: null,
    });
    expect(
      observeAutomationHostScheduleHealth(
        { ...active, lastObservedAt: null },
        new Date("2026-09-15T12:07:01.000Z"),
      ),
    ).toEqual({
      state: "overdue",
      expectationBasis: "host_reported",
      graceMilliseconds: 300000,
      overdueAt: "2026-09-15T12:07:00.000Z",
      lastObservedAt: null,
      nextExpectedAt: "2026-09-15T12:02:00.000Z",
      observedAt: "2026-09-15T12:07:01.000Z",
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
      graceMilliseconds: null,
      overdueAt: null,
      lastObservedAt: "2026-09-15T12:00:00.000Z",
      nextExpectedAt: null,
      observedAt: "2026-09-16T12:00:00.000Z",
      repairOwner: null,
    });
  });

  it("treats revocation as terminal without assigning host repair", () => {
    const revoked = automationHostScheduleSchema.parse({
      id: scheduleId,
      tenantAuthorizationConnectionId,
      hostSurface: "claude_code_routine",
      hostAutomationId: "routine-1",
      label: "Finance continuation",
      effectiveScopes: ["finances:maintain"],
      trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
      state: "revoked",
      lastObservedAt: "2026-09-15T12:00:00.000Z",
      nextExpectedAt: null,
      version: 4,
      createdAt: "2026-09-15T11:00:00.000Z",
      updatedAt: "2026-09-15T12:10:00.000Z",
    });
    expect(
      observeAutomationHostScheduleHealth(revoked, new Date("2026-09-15T12:11:00.000Z")),
    ).toMatchObject({ state: "revoked", repairOwner: null });
  });
});

describe("Finance automation grace", () => {
  const schedule = (everyMinutes: number) =>
    automationHostScheduleSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      tenantAuthorizationConnectionId: "22222222-2222-4222-8222-222222222222",
      label: "Finance",
      effectiveScopes: ["finances:maintain"],
      hostSurface: "codex_desktop",
      hostAutomationId: "job",
      trigger: {
        type: "recurring",
        recurrence: { type: "interval", everyMinutes, timeZone: "America/New_York" },
      },
      state: "active",
      nextExpectedAt: "2026-10-18T13:00:00.000Z",
      lastObservedAt: null,
      version: 1,
      createdAt: "2026-10-18T12:00:00.000Z",
      updatedAt: "2026-10-18T12:00:00.000Z",
    });
  it.each([
    [1, 300000],
    [51, 306000],
    [1440, 3600000],
    [10080, 3600000],
  ])("uses the approved floor/fraction/cap for %i minutes", (interval, grace) => {
    const deadline = Date.parse("2026-10-18T13:00:00.000Z") + grace;
    for (const delta of [-1, 0, 1]) {
      expect(
        observeAutomationHostScheduleHealth(schedule(interval), new Date(deadline + delta)),
      ).toMatchObject({
        state: delta > 0 ? "overdue" : "expected",
        graceMilliseconds: grace,
        overdueAt: new Date(deadline).toISOString(),
      });
    }
  });
});

it("validates exact immutable prompt identities and bounded history inputs", () => {
  const issue = {
    scheduleId,
    templateVersion: 1,
    scheduleVersionAtIssue: 2,
    text: "Exact stored instructions",
    issuedAt: "2026-10-18T15:00:00.000Z",
  };
  expect(automationHostPromptIssueSchema.parse(issue)).toEqual(issue);
  for (const invalid of [
    { templateVersion: 0 },
    { scheduleId: "other" },
    { text: "" },
    { scheduleVersionAtIssue: 0 },
  ])
    expect(automationHostPromptIssueSchema.safeParse({ ...issue, ...invalid }).success).toBe(false);
  expect(
    automationHostPromptIssueInputSchema.safeParse({ expectedScheduleVersion: 0 }).success,
  ).toBe(false);
  expect(
    automationHostPromptIssueInputSchema.safeParse({
      expectedScheduleVersion: 1,
      text: "client override",
    }).success,
  ).toBe(false);
  expect(automationHostPromptPageInputSchema.parse({})).toEqual({ limit: 20 });
  expect(automationHostPromptPageInputSchema.parse({ beforeVersion: "3", limit: "100" })).toEqual({
    beforeVersion: 3,
    limit: 100,
  });
  for (const invalid of [
    { limit: 101 },
    { limit: 0 },
    { beforeVersion: 0 },
    { beforeVersion: 1.5 },
  ])
    expect(automationHostPromptPageInputSchema.safeParse(invalid).success).toBe(false);
});

describe("Claude daily wall-clock slots", () => {
  const trigger = {
    type: "scheduled" as const,
    localTimes: ["08:00", "20:00"],
    timeZone: "America/New_York",
  };
  it.each([
    ["2026-03-07T13:00:00Z", "2026-03-08T01:00:00.000Z"],
    ["2026-03-08T01:00:00Z", "2026-03-08T12:00:00.000Z"],
    ["2026-10-31T12:00:00Z", "2026-11-01T00:00:00.000Z"],
    ["2026-11-01T00:00:00Z", "2026-11-01T13:00:00.000Z"],
    ["2026-11-02T15:00:00Z", "2026-11-03T01:00:00.000Z"],
  ])("derives the next local slot after %s", (after, expected) => {
    expect(nextScheduledAutomationHostSlot(trigger, new Date(after))).toBe(expected);
  });
  it("skips nonexistent spring times and uses a repeated autumn time only once", () => {
    expect(
      nextScheduledAutomationHostSlot(
        { ...trigger, localTimes: ["02:30"] },
        new Date("2026-03-08T06:00:00Z"),
      ),
    ).toBe("2026-03-09T06:30:00.000Z");
    expect(
      nextScheduledAutomationHostSlot(
        { ...trigger, localTimes: ["01:30"] },
        new Date("2026-11-01T04:00:00Z"),
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
    expect(
      nextScheduledAutomationHostSlot(
        { ...trigger, localTimes: ["01:30"] },
        new Date("2026-11-01T05:30:00Z"),
      ),
    ).toBe("2026-11-02T06:30:00.000Z");
  });
  it("rejects an invalid observation clock before projecting a slot", () => {
    expect(() => nextScheduledAutomationHostSlot(trigger, new Date(Number.NaN))).toThrow(
      "Invalid schedule observation time.",
    );
  });
  it("validates bounded distinct wall times and IANA timezone", () => {
    expect(
      scheduledAutomationHostTriggerSchema.parse({ ...trigger, localTimes: ["20:00", "08:00"] })
        .localTimes,
    ).toEqual(trigger.localTimes);
    for (const localTimes of [
      [],
      ["24:00"],
      ["8:00"],
      ["08:00", "08:00"],
      ["08:60"],
      Array(9).fill("08:00"),
    ]) {
      expect(
        scheduledAutomationHostTriggerSchema.safeParse({ ...trigger, localTimes }).success,
      ).toBe(false);
    }
    expect(
      scheduledAutomationHostTriggerSchema.safeParse({ ...trigger, timeZone: "Mars/Olympus" })
        .success,
    ).toBe(false);
  });
});
