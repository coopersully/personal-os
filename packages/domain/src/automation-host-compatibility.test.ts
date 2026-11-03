import { describe, expect, it } from "vitest";
import {
  automationHostCombinedReadProjectionSchema,
  describeAutomationHostReadCapabilities,
  selectAutomationHostReadProtocol,
} from "./automation-host-compatibility.js";
import {
  automationHostScheduleCreateInputSchema,
  automationHostScheduleSchema,
} from "./automation-host-continuation.js";

const scheduled = {
  id: "00000000-0000-4000-8000-000000000001",
  tenantAuthorizationConnectionId: "00000000-0000-4000-8000-000000000002",
  label: "Finance",
  effectiveScopes: ["finances:maintain"],
  hostSurface: "claude_code_routine",
  hostAutomationId: "original-opaque-host-identity",
  trigger: {
    type: "scheduled",
    localTimes: ["08:00", "20:00"],
    timeZone: "America/New_York",
  },
  state: "active",
  nextExpectedAt: "2026-11-03T13:00:00.000Z",
  lastObservedAt: null,
  version: 7,
  createdAt: "2026-11-01T13:00:00.000Z",
  updatedAt: "2026-11-02T13:00:00.000Z",
};
function combined() {
  return {
    formatVersion: 2,
    kind: "combined_read_projection",
    schedule: structuredClone(scheduled),
    event: { kind: "accepted_answer", expectedMaximumLatencyMinutes: 5 },
    readiness: {
      originalHostMapping: "unknown",
      scheduledOrigin: "unknown",
      credential: "absent",
      chatProtocol: "unverified",
      consumption: "not_demonstrated",
    },
  };
}

describe("unconsumed automation host reader compatibility", () => {
  it.each([
    undefined,
    "legacy",
    "combined-v2",
  ])("preserves the exact canonical scheduled DTO for protocol %s", (protocol) => {
    const before = JSON.stringify(scheduled);
    const canonical = automationHostScheduleSchema.parse(scheduled);
    expect(selectAutomationHostReadProtocol(protocol, scheduled)).toEqual({
      state: "legacy",
      value: scheduled,
    });
    expect(JSON.stringify(scheduled)).toBe(before);
    const result = selectAutomationHostReadProtocol(protocol, scheduled);
    if (result.state !== "legacy") throw new Error("Expected legacy schedule");
    expect(JSON.stringify(result.value)).toBe(JSON.stringify(canonical));
  });

  it("normalizes the schedule once without throwing from safeParse or merging raw fields", () => {
    const value = combined();
    value.schedule.label = " Finance ";
    value.schedule.hostAutomationId = " original-opaque-host-identity ";
    value.schedule.effectiveScopes = ["finances:maintain", "finances:maintain"];
    const canonical = automationHostScheduleSchema.parse(value.schedule);
    expect(() => automationHostCombinedReadProjectionSchema.safeParse(value)).not.toThrow();
    const parsed = automationHostCombinedReadProjectionSchema.safeParse(value);
    if (!parsed.success) throw new Error("Expected a canonicalizable scheduled host");
    expect(parsed.data.schedule).toEqual(canonical);
    expect(parsed.data.schedule.label).toBe("Finance");
    expect(parsed.data.schedule.hostAutomationId).toBe("original-opaque-host-identity");
    expect(parsed.data.schedule.effectiveScopes).toEqual(["finances:maintain"]);
    expect(selectAutomationHostReadProtocol("combined-v2", value)).toEqual({
      state: "combined_v2",
      value: { ...value, schedule: canonical },
    });
  });

  it.each(["event", "recurring"])("retains legacy %s schedules", (kind) => {
    const value = {
      ...scheduled,
      hostSurface: kind === "recurring" ? "codex_desktop" : "claude_code_routine",
      trigger:
        kind === "event"
          ? { type: "event", expectedMaximumLatencyMinutes: 5 }
          : {
              type: "recurring",
              recurrence: { type: "interval", everyMinutes: 30, timeZone: "UTC" },
            },
      nextExpectedAt: kind === "event" ? null : scheduled.nextExpectedAt,
    };
    expect(selectAutomationHostReadProtocol(undefined, value)).toEqual({ state: "legacy", value });
  });

  it.each([
    undefined,
    "legacy",
  ])("returns no combined DTO to an unaware reader (%s)", (protocol) => {
    const result = selectAutomationHostReadProtocol(protocol, combined());
    expect(result).toEqual({
      state: "upgrade_required",
      reason: "automation_host_protocol_upgrade_required",
    });
    expect(JSON.stringify(result)).not.toContain("original-opaque");
    expect(result).not.toHaveProperty("value");
  });

  it("accepts only explicit V2 support and preserves the opaque scheduled identity and slot", () => {
    const value = combined();
    expect(selectAutomationHostReadProtocol("combined-v2", value)).toEqual({
      state: "combined_v2",
      value,
    });
    expect(value.schedule.hostAutomationId).toBe("original-opaque-host-identity");
    expect(value.schedule.nextExpectedAt).toBe(scheduled.nextExpectedAt);
  });

  it.each([
    "",
    "v2",
    "combined-v2,legacy",
    true,
    2,
    null,
    ["combined-v2"],
  ])("rejects unsupported protocol input %j rather than assuming awareness", (protocol) =>
    expect(() => selectAutomationHostReadProtocol(protocol, scheduled)).toThrow());

  it.each([
    "absent",
    "stored_unverified",
    "unavailable",
  ])("reports credential state %s without making event execution available", (credential) => {
    const value = combined();
    value.readiness.credential = credential;
    expect(describeAutomationHostReadCapabilities(value)).toEqual({
      scheduledCadence: "declared",
      eventExecution: "unavailable",
      reason: "combined_writes_disabled",
    });
  });

  it.each([
    ["originalHostMapping", "verified"],
    ["scheduledOrigin", "verified"],
    ["credential", "provider_verified"],
    ["chatProtocol", "verified"],
    ["consumption", "causally_recorded"],
  ] as const)("does not mint unsupported evidence for %s", (field, state) => {
    const value = combined();
    expect(
      automationHostCombinedReadProjectionSchema.safeParse({
        ...value,
        readiness: { ...value.readiness, [field]: state },
      }).success,
    ).toBe(false);
  });

  it.each([
    "token",
    "body",
    "principal",
    "providerSid",
    "mappingProof",
  ])("rejects secret or invented proof field %s rather than stripping it", (field) => {
    const value = combined();
    expect(
      automationHostCombinedReadProjectionSchema.safeParse({ ...value, [field]: "x" }).success,
    ).toBe(false);
    expect(
      automationHostCombinedReadProjectionSchema.safeParse({
        ...value,
        readiness: { ...value.readiness, [field]: "x" },
      }).success,
    ).toBe(false);
    expect(
      automationHostCombinedReadProjectionSchema.safeParse({
        ...value,
        event: { ...value.event, [field]: "x" },
      }).success,
    ).toBe(false);
    const nested = { ...value, schedule: { ...value.schedule, [field]: "x" } };
    expect(() => automationHostCombinedReadProjectionSchema.safeParse(nested)).not.toThrow();
    expect(automationHostCombinedReadProjectionSchema.safeParse(nested).success).toBe(false);
    expect(() => selectAutomationHostReadProtocol("combined-v2", nested)).toThrow();
  });

  it.each([0, 61, 1.5, Number.NaN])("rejects invalid event latency %s", (latency) => {
    const value = combined();
    expect(
      automationHostCombinedReadProjectionSchema.safeParse({
        ...value,
        event: { ...value.event, expectedMaximumLatencyMinutes: latency },
      }).success,
    ).toBe(false);
  });

  it.each([1, 3, "2", null])("rejects a mismatched format version %j", (version) => {
    expect(() =>
      selectAutomationHostReadProtocol("combined-v2", { ...combined(), formatVersion: version }),
    ).toThrow();
  });

  it("rejects an event-only host inside the combined cadence projection", () => {
    const value = combined();
    expect(
      automationHostCombinedReadProjectionSchema.safeParse({
        ...value,
        schedule: {
          ...scheduled,
          trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
          nextExpectedAt: null,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects malformed legacy schedules instead of returning an upgrade or capability", () => {
    expect(() =>
      selectAutomationHostReadProtocol(undefined, { ...scheduled, id: "foreign-selector" }),
    ).toThrow();
    expect(() =>
      describeAutomationHostReadCapabilities({
        ...combined(),
        schedule: { ...scheduled, nextExpectedAt: null },
      }),
    ).toThrow();
  });

  it("does not widen the existing stored or create writer schemas", () => {
    expect(automationHostScheduleSchema.safeParse(combined()).success).toBe(false);
    expect(
      automationHostScheduleCreateInputSchema.safeParse({
        tenantAuthorizationConnectionId: scheduled.tenantAuthorizationConnectionId,
        label: scheduled.label,
        requestedScopes: scheduled.effectiveScopes,
        hostSurface: scheduled.hostSurface,
        trigger: { type: "combined", scheduled: scheduled.trigger, event: combined().event },
      }).success,
    ).toBe(false);
  });
});
