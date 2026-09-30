import { describe, expect, it } from "vitest";
import {
  composeNotification,
  defaultNotificationPreferences,
  notificationEligibility,
  notificationPreferencesSchema,
  notificationWorkSchema,
  validateNotificationResolution,
} from "./notification-policy.js";

const work = {
  work: {
    id: "11111111-1111-4111-8111-111111111111",
    domain: "finances" as const,
    kind: "question" as const,
    revision: "evidence-1",
    actionRevision: "action-1",
  },
  active: true,
  expiresAt: null,
  disclosure: "context" as const,
  context: "Dinner",
  occurredAt: "2026-03-07T23:00:00.000Z",
  destination: "/settings?section=reviews" as const,
};
const now = new Date("2026-03-08T12:00:00.000Z");
const preferences = defaultNotificationPreferences;

describe("notification policy", () => {
  it("validates references, bounded settings, and first-party destinations", () => {
    expect(notificationWorkSchema.parse(work)).toEqual(work);
    expect(
      notificationWorkSchema.safeParse({ ...work, destination: "https://evil.test" }).success,
    ).toBe(false);
    expect(
      notificationPreferencesSchema.safeParse({ ...preferences, quietStartMinute: 1440 }).success,
    ).toBe(false);
    expect(
      notificationPreferencesSchema.safeParse({ ...preferences, quietEndMinute: 1320 }).success,
    ).toBe(false);
    expect(
      notificationPreferencesSchema.safeParse({ ...preferences, authority: true }).success,
    ).toBe(false);
  });
  it("uses local wall time across skipped and repeated DST hours", () => {
    const evaluate = (instant: string) =>
      notificationEligibility({
        work,
        preferences,
        timeZone: "America/New_York",
        now: new Date(instant),
        attempts: [],
      });
    expect(evaluate("2026-03-08T11:59:00Z")).toBe("quiet_hours");
    expect(evaluate("2026-03-08T12:00:00Z")).toBe("eligible");
    expect(evaluate("2026-11-01T05:30:00Z")).toBe("quiet_hours");
    expect(evaluate("2026-11-01T06:30:00Z")).toBe("quiet_hours");
    expect(evaluate("2026-11-01T13:00:00Z")).toBe("eligible");
  });
  it("fails closed for missing timezone, resolved or expired work, and disabled delivery", () => {
    const input = { work, preferences, timeZone: "UTC", now, attempts: [] };
    expect(notificationEligibility({ ...input, timeZone: "invalid" })).toBe("timezone_unavailable");
    expect(notificationEligibility({ ...input, work: { ...work, active: false } })).toBe(
      "resolved",
    );
    expect(
      notificationEligibility({ ...input, work: { ...work, expiresAt: now.toISOString() } }),
    ).toBe("expired");
    expect(
      notificationEligibility({ ...input, preferences: { ...preferences, enabled: false } }),
    ).toBe("disabled");
  });
  it("separates semantic action history from wording/evidence refresh and uncertain attempts", () => {
    const input = {
      work,
      preferences,
      timeZone: "UTC",
      now,
      attempts: [{ actionRevision: "action-1", state: "accepted" as const, submittedAt: now }],
    };
    expect(notificationEligibility(input)).toBe("reminder_wait");
    expect(
      notificationEligibility({
        ...input,
        work: { ...work, work: { ...work.work, revision: "new-wording" } },
      }),
    ).toBe("reminder_wait");
    expect(
      notificationEligibility({
        ...input,
        work: { ...work, work: { ...work.work, actionRevision: "action-2" } },
      }),
    ).toBe("eligible");
    expect(notificationEligibility({ ...input, now: new Date(now.getTime() + 7 * 86400000) })).toBe(
      "eligible",
    );
    expect(
      notificationEligibility({ ...input, preferences: { ...preferences, reminderDays: null } }),
    ).toBe("reminder_never");
    expect(
      notificationEligibility({
        ...input,
        attempts: [{ actionRevision: "action-1", submittedAt: now, state: "uncertain" }],
      }),
    ).toBe("delivery_uncertain");
    expect(
      notificationEligibility({
        ...input,
        attempts: [{ actionRevision: "action-1", submittedAt: now, state: "submitting" }],
      }),
    ).toBe("delivery_uncertain");
  });
  it("renders current dates, caps context, and lets preferences only narrow disclosure", () => {
    const input = {
      works: [work],
      now,
      timeZone: "America/New_York",
      detail: "context" as const,
      origin: "https://nohmi.test",
    };
    expect(composeNotification(input)).toContain("Dinner (yesterday)");
    expect(composeNotification({ ...input, now: new Date("2026-03-09T12:00:00Z") })).not.toContain(
      "yesterday",
    );
    expect(composeNotification({ ...input, detail: "minimal" })).not.toContain("Dinner");
    expect(
      composeNotification({ ...input, works: [{ ...work, disclosure: "minimal" }] }),
    ).not.toContain("Dinner");
    expect(
      composeNotification({ ...input, works: [{ ...work, context: "Account 123456789" }] }),
    ).not.toContain("123456789");
    expect(
      composeNotification({
        ...input,
        works: Array.from({ length: 4 }, (_, i) => ({ ...work, context: `Item ${i}` })),
      }),
    ).toContain("1 more");
    expect(
      composeNotification({
        ...input,
        works: Array.from({ length: 4 }, (_, i) => ({ ...work, context: `Item ${i}` })),
      }),
    ).not.toContain("Item 3");
    expect(composeNotification(input)).toContain("https://nohmi.test/settings?section=reviews");
    expect(composeNotification(input)).not.toContain("Reply");
  });
});

describe("notification resolver contract", () => {
  it("accepts only a contextual destination bound to the exact question", () => {
    const destination = `/finances/review?contextualQuestion=${encodeURIComponent(work.work.id)}`;
    const value = { ...work, destination };
    expect(validateNotificationResolution(work.work, { state: "current", value })).toEqual({
      state: "current",
      value,
    });
    for (const destination of [
      "/finances/review?contextualQuestion=22222222-2222-4222-8222-222222222222",
      "/finances/review?contextualQuestion=not-a-uuid",
      `${value.destination}&redirect=https://evil.test`,
      `https://evil.test${value.destination}`,
    ]) {
      expect(
        validateNotificationResolution(work.work, {
          state: "current",
          value: { ...value, destination },
        }),
      ).toEqual({ state: "unavailable" });
    }
    const otherKind = { ...work.work, kind: "repair" as const };
    expect(
      validateNotificationResolution(otherKind, {
        state: "current",
        value: { ...value, work: otherKind },
      }),
    ).toEqual({ state: "unavailable" });
  });
  it("rejects malformed, foreign, mismatched and inactive work without exposing context", () => {
    expect(validateNotificationResolution(work.work, { state: "current", value: work })).toEqual({
      state: "current",
      value: work,
    });
    expect(
      validateNotificationResolution(work.work, {
        state: "current",
        value: { ...work, active: false },
      }),
    ).toEqual({ state: "resolved" });
    for (const key of ["id", "kind", "revision", "actionRevision"] as const) {
      const replacement =
        key === "id" ? "22222222-2222-4222-8222-222222222222" : key === "kind" ? "repair" : "other";
      expect(
        validateNotificationResolution(work.work, {
          state: "current",
          value: { ...work, work: { ...work.work, [key]: replacement } },
        }),
      ).toEqual({ state: "stale" });
    }
    for (const value of [
      { ...work, secret: "canary" },
      { ...work, occurredAt: "2026-03-07" },
      { ...work, work: { ...work.work, domain: "mail" } },
    ]) {
      expect(validateNotificationResolution(work.work, { state: "current", value })).toEqual({
        state: "unavailable",
      });
    }
    for (const state of ["unavailable", "stale", "resolved"] as const) {
      expect(validateNotificationResolution(work.work, { state })).toEqual({ state });
      expect(validateNotificationResolution(work.work, { state, context: "canary" })).toEqual({
        state: "unavailable",
      });
    }
  });
});

it("supports daytime quiet windows, any-time mode, elapsed reminders, and local date rendering", () => {
  const input = {
    work,
    preferences: { ...preferences, quietStartMinute: 600, quietEndMinute: 660 },
    timeZone: "UTC",
    now: new Date("2026-03-08T10:30:00Z"),
    attempts: [],
  };
  expect(notificationEligibility(input)).toBe("quiet_hours");
  expect(
    notificationEligibility({
      ...input,
      preferences: { ...input.preferences, quietMode: "any_time" },
    }),
  ).toBe("eligible");
  expect(notificationEligibility({ ...input, now: new Date("2026-03-08T11:00:00Z") })).toBe(
    "eligible",
  );
  const rendering = {
    works: [work],
    now: new Date("2026-03-07T12:00:00Z"),
    timeZone: "UTC",
    detail: "context" as const,
    origin: "https://nohmi.test",
  };
  expect(composeNotification(rendering)).toContain("today");
  expect(composeNotification({ ...rendering, now: new Date("2026-03-06T12:00:00Z") })).toContain(
    "tomorrow",
  );
  expect(
    composeNotification({ ...rendering, works: [{ ...work, occurredAt: null }] }),
  ).not.toContain("today");
  expect(composeNotification({ ...rendering, works: [{ ...work, context: null }] })).toContain(
    "Finance item",
  );
  expect(
    composeNotification({
      ...rendering,
      works: [{ ...work, context: "Account 4111 1111 1111 1111" }],
    }),
  ).not.toContain("4111");
  expect(
    notificationEligibility({
      ...input,
      preferences,
      now,
      attempts: [
        { actionRevision: "a0", state: "accepted", submittedAt: new Date(now.getTime() - 1000) },
        {
          actionRevision: "action-1",
          state: "accepted",
          submittedAt: new Date(now.getTime() - 8 * 86400000),
        },
        {
          actionRevision: "action-1",
          state: "failed",
          submittedAt: new Date(now.getTime() - 9 * 86400000),
        },
      ],
    }),
  ).toBe("eligible");
});
