import type { AccessScope } from "@personal-os/domain";
import { Hono } from "hono";
import type { createCalendarService } from "../calendar-service.js";
import { errorResponse } from "../errors.js";
import type { AppEnv } from "../types.js";
import { registerCalendarRoutes } from "./calendar.js";

const id = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const now = "2026-07-28T15:00:00.000Z";
const candidate = {
  allDay: false,
  buffer: { afterMinutes: 15, beforeMinutes: 15 },
  calendarId: id,
  endsAt: "2026-08-01T17:00:00.000Z",
  evidence: {
    kind: "booking" as const,
    source: {
      accountId,
      provider: "google" as const,
      remoteId: "booking-1",
      revision: "v1",
      sourceType: "mail_thread" as const,
    },
    summary: "Confirmed reservation.",
  },
  flexibility: "hard" as const,
  location: null,
  notes: null,
  startsAt: "2026-08-01T16:00:00.000Z",
  timezone: "UTC",
  title: "Reservation",
  visibility: "private" as const,
};
const calendar = {
  accountId,
  color: null,
  id,
  isPrimary: true,
  isSelected: true,
  isWritable: true,
  lastSyncedAt: now,
  name: "Personal",
  provider: "local" as const,
  timezone: "UTC",
};
const proposal = {
  authority: "caller_supplied_unverified" as const,
  candidate,
  destination: calendar,
  possibleDuplicateEventId: null,
  fingerprint: "a".repeat(64),
  policy: {
    canApply: false,
    effectivePolicy: "preview" as const,
    reasons: [],
    requestedPolicy: "preview" as const,
    requiresInteractiveApproval: true,
  },
  providerEffect: "local_write" as const,
  warnings: [],
};

describe("Calendar routes", () => {
  it("keeps commitment intake preview-only and read-scoped", async () => {
    const app = new Hono<AppEnv>();
    let scopes = new Set<AccessScope>(["calendar:read"]);
    const calendarService = {
      createEvent: vi.fn(async () => ({ id })),
      createEventBlock: vi.fn(async () => ({ id })),
      createLocalCalendar: vi.fn(async () => calendar),
      deleteEvent: vi.fn(async () => undefined),
      deleteEventBlock: vi.fn(async () => ({ id })),
      deleteLocalCalendar: vi.fn(async () => undefined),
      getEvent: vi.fn(async () => ({ id })),
      list: vi.fn(async () => [calendar]),
      listEvents: vi.fn(async () => []),
      previewCommitment: vi.fn(async () => proposal),
      restoreEvent: vi.fn(async () => ({ id })),
      setSelected: vi.fn(async () => calendar),
      upsertAttentionItem: vi.fn(async () => ({ id })),
      updateEvent: vi.fn(async () => ({ id })),
      updateEventBlock: vi.fn(async () => ({ id })),
      updateLocalCalendar: vi.fn(async () => calendar),
    };
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes,
        userId: id,
      });
      context.set("requestId", "calendar-route-test");
      await next();
    });
    app.onError(errorResponse);
    registerCalendarRoutes({
      app,
      calendar: calendarService as unknown as ReturnType<typeof createCalendarService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });
    const request = (path: string, init?: RequestInit) =>
      app.request(path, { headers: { "content-type": "application/json" }, ...init });

    const previewResponse = await request("/v1/calendars/commitments/preview", {
      body: JSON.stringify({ candidate }),
      method: "POST",
    });
    expect(previewResponse.status).toBe(200);
    expect(calendarService.previewCommitment).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ candidate, requestedPolicy: "preview" }),
    );

    const deniedWrite = await request("/v1/calendars", {
      body: JSON.stringify({ color: null, name: "Local", timezone: "UTC" }),
      method: "POST",
    });
    expect(deniedWrite.status).toBe(403);

    scopes = new Set<AccessScope>(["calendar:read", "calendar:write"]);
    const writeResponse = await request("/v1/calendars", {
      body: JSON.stringify({ color: null, name: "Local", timezone: "UTC" }),
      method: "POST",
    });
    expect(writeResponse.status).toBe(201);
    expect(calendarService.createLocalCalendar).toHaveBeenCalled();

    const attentionResponse = await request(`/v1/events/${id}/attention`, {
      body: JSON.stringify({
        expiresAt: null,
        importance: "high",
        kind: "upcoming",
        occursAt: now,
        summary: "Starts soon.",
        title: "Upcoming commitment",
      }),
      method: "PUT",
    });
    expect(attentionResponse.status).toBe(200);
    expect(calendarService.upsertAttentionItem).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ kind: "upcoming", title: "Upcoming commitment" }),
      expect.objectContaining({ requestId: "calendar-route-test" }),
    );

    const unblockResponse = await request(`/v1/events/${id}/blocks/${id}`, {
      body: JSON.stringify({
        expectedBlockUpdatedAt: now,
        expectedUpdatedAt: now,
      }),
      method: "DELETE",
    });
    expect(unblockResponse.status).toBe(200);
    expect(calendarService.deleteEventBlock).toHaveBeenCalledWith(
      id,
      id,
      expect.objectContaining({ requestId: "calendar-route-test" }),
      { expectedBlockUpdatedAt: now, expectedUpdatedAt: now },
    );

    const legacyDeleteResponse = await request(`/v1/events/${id}`, { method: "DELETE" });
    expect(legacyDeleteResponse.status).toBe(204);
    expect(calendarService.deleteEvent).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ requestId: "calendar-route-test" }),
      {},
    );

    const invalidOptionalBody = await request(`/v1/events/${id}/restore`, {
      body: "{",
      method: "POST",
    });
    expect(invalidOptionalBody.status).toBe(400);
    expect(calendarService.restoreEvent).not.toHaveBeenCalled();
  });
});
