import { describe, expect, it } from "vitest";
import { calendarEventSchema, createEventInputSchema, updateEventInputSchema } from "./calendar.js";

const calendarId = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";
const startsAt = "2026-08-23T14:00:00.000Z";
const endsAt = "2026-08-23T15:00:00.000Z";

const createInput = {
  calendarId,
  endsAt,
  startsAt,
  timezone: "UTC",
  title: "Planning",
};

const providerEvent = {
  ...createInput,
  createdAt: startsAt,
  id: eventId,
  provider: "google" as const,
  recurrence: [],
  remoteEventId: "remote-event-1",
  status: "confirmed" as const,
  updatedAt: startsAt,
};

describe("Calendar event URL contracts", () => {
  it.each([
    "http://example.com/event",
    "https://example.com/event",
  ])("accepts an HTTP(S) event URL: %s", (url) => {
    expect(createEventInputSchema.safeParse({ ...createInput, conferenceUrl: url }).success).toBe(
      true,
    );
    expect(createEventInputSchema.safeParse({ ...createInput, url }).success).toBe(true);
    expect(updateEventInputSchema.safeParse({ url }).success).toBe(true);
    expect(calendarEventSchema.safeParse({ ...providerEvent, conferenceUrl: url }).success).toBe(
      true,
    );
    expect(calendarEventSchema.safeParse({ ...providerEvent, url }).success).toBe(true);
  });

  it.each([
    ["data URL", "data:text/html,<script>alert(1)</script>"],
    ["JavaScript URL", "javascript:alert(1)"],
    ["external-handler URL", "mailto:person@example.com"],
  ])("rejects a %s in API event input", (_kind, url) => {
    expect(createEventInputSchema.safeParse({ ...createInput, conferenceUrl: url }).success).toBe(
      false,
    );
    expect(createEventInputSchema.safeParse({ ...createInput, url }).success).toBe(false);
    expect(updateEventInputSchema.safeParse({ url }).success).toBe(false);
  });

  it.each([
    ["data URL", "data:text/html,<script>alert(1)</script>"],
    ["JavaScript URL", "javascript:alert(1)"],
    ["external-handler URL", "mailto:person@example.com"],
  ])("rejects a provider-derived %s", (_kind, url) => {
    expect(calendarEventSchema.safeParse({ ...providerEvent, conferenceUrl: url }).success).toBe(
      false,
    );
    expect(calendarEventSchema.safeParse({ ...providerEvent, url }).success).toBe(false);
  });
});
