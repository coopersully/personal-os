import { describe, expect, expectTypeOf, it } from "vitest";
import {
  getNotificationReceiptPeriod,
  type NotificationProducerRef,
} from "./notification-production.js";

describe("notification producer correlation", () => {
  it("keeps outstanding human work distinct from settled action receipts", () => {
    expectTypeOf<
      Extract<NotificationProducerRef, { kind: "human_work" }>["work"]["kind"]
    >().toEqualTypeOf<"question" | "approval" | "repair">();
    expectTypeOf<
      Extract<NotificationProducerRef, { kind: "action_receipt" }>["receipt"]["status"]
    >().toEqualTypeOf<"applied" | "no_changes">();
  });
});

describe("owner-local receipt period identities", () => {
  it.each([
    ["2026-11-01T03:59:59.999Z", "America/New_York", "2026-10-01", "2026-11-01"],
    ["2026-11-01T04:00:00.000Z", "America/New_York", "2026-11-01", "2026-12-01"],
    ["2024-02-29T12:00:00.000Z", "UTC", "2024-02-01", "2024-03-01"],
    ["2026-12-31T12:00:00.000Z", "UTC", "2026-12-01", "2027-01-01"],
    ["2026-10-31T10:00:00.000Z", "Pacific/Kiritimati", "2026-11-01", "2026-12-01"],
  ] as const)("uses calendar month at %s in %s", (instant, timeZone, start, end) => {
    const period = getNotificationReceiptPeriod({
      cadence: "monthly",
      timeZone,
      asOf: new Date(instant),
    });
    expect(period).toMatchObject({
      cadence: "monthly",
      timeZone,
      startLocalDate: start,
      endLocalDateExclusive: end,
    });
    expect(period.key).not.toBe("");
  });

  it.each([
    ["2026-03-14T16:00:00Z", "2026-03-01", "2026-03-01", "2026-03-15"],
    ["2026-03-15T04:00:00Z", "2026-03-01", "2026-03-15", "2026-03-29"],
    ["2026-03-01T12:00:00Z", "2026-03-15", "2026-03-01", "2026-03-15"],
    ["2026-02-28T12:00:00Z", "2026-03-15", "2026-02-15", "2026-03-01"],
    ["2026-11-01T05:30:00Z", "2026-10-25", "2026-10-25", "2026-11-08"],
  ] as const)("anchors fourteen local days at %s from %s", (instant, anchorLocalDate, start, end) => {
    expect(
      getNotificationReceiptPeriod({
        cadence: "fortnightly",
        timeZone: "America/New_York",
        asOf: new Date(instant),
        anchorLocalDate,
      }),
    ).toMatchObject({ startLocalDate: start, endLocalDateExclusive: end });
  });

  it("keeps both repeated DST hours in one anchored period without mutating the clock", () => {
    const first = new Date("2026-11-01T05:30:00Z");
    const before = first.getTime();
    const period = (asOf: Date) =>
      getNotificationReceiptPeriod({
        cadence: "fortnightly",
        timeZone: "America/New_York",
        asOf,
        anchorLocalDate: "2026-10-25",
      });
    expect(period(first).key).toBe(period(new Date("2026-11-01T06:30:00Z")).key);
    expect(first.getTime()).toBe(before);
  });

  it("keeps cadence, local period and timezone identities distinct", () => {
    const base = { asOf: new Date("2026-11-01T01:00:00Z"), timeZone: "UTC" };
    const month = getNotificationReceiptPeriod({ ...base, cadence: "monthly" });
    const next = getNotificationReceiptPeriod({
      ...base,
      cadence: "monthly",
      asOf: new Date("2026-12-01T01:00:00Z"),
    });
    const otherZone = getNotificationReceiptPeriod({
      ...base,
      cadence: "monthly",
      timeZone: "America/New_York",
    });
    const fortnight = getNotificationReceiptPeriod({
      ...base,
      cadence: "fortnightly",
      anchorLocalDate: "2026-11-01",
    });
    expect(new Set([month.key, next.key, otherZone.key, fortnight.key]).size).toBe(4);
  });

  it.each(["2026-02-30", "2026-2-01", "not-a-date"])("rejects invalid anchor %s", (anchor) => {
    expect(() =>
      getNotificationReceiptPeriod({
        cadence: "fortnightly",
        timeZone: "UTC",
        asOf: new Date("2026-03-01T00:00:00Z"),
        anchorLocalDate: anchor,
      }),
    ).toThrow();
  });
  it("rejects an invalid clock or IANA timezone rather than falling back", () => {
    expect(() =>
      getNotificationReceiptPeriod({ cadence: "monthly", timeZone: "UTC", asOf: new Date(NaN) }),
    ).toThrow();
    expect(() =>
      getNotificationReceiptPeriod({
        cadence: "monthly",
        timeZone: "Invalid/Zone",
        asOf: new Date("2026-03-01T00:00:00Z"),
      }),
    ).toThrow();
  });
});
