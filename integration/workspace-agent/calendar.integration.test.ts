import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("Calendar MCP execution", () => {
  let fixture: WorkspaceFixture;
  beforeAll(async () => {
    fixture = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await fixture?.close();
  });
  it("creates and selects a local calendar through the real agent API", async () => {
    const { client, api } = await fixture.connectAgent(["calendar:read", "calendar:write"]);
    const response = await client.callTool({
      name: "create_calendar",
      arguments: { name: "Agent calendar", color: "#123456", timezone: "America/New_York" },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const calendars = await api.listCalendars();
    const calendar = calendars.find((item) => item.name === "Agent calendar");
    expect(calendar).toBeDefined();
    const updated = await client.callTool({
      name: "update_calendar",
      arguments: { calendarId: calendar!.id, name: "Renamed calendar" },
    });
    expect(updated.isError).not.toBe(true);
    const status = await client.callTool({ name: "get_calendar_status", arguments: {} });
    expect(status.isError).not.toBe(true);
    const review = await client.callTool({
      name: "get_calendar_review",
      arguments: { scope: { type: "all_outstanding" } },
    });
    expect(review.isError).not.toBe(true);
    const selection = await client.callTool({
      name: "set_calendar_selection",
      arguments: { calendarId: calendar!.id, selected: false },
    });
    expect(selection.isError).not.toBe(true);
    expect((await api.listCalendars()).find((item) => item.id === calendar!.id)?.isSelected).toBe(
      false,
    );
    const removed = await client.callTool({
      name: "delete_calendar",
      arguments: { calendarId: calendar!.id },
    });
    expect(removed.isError).not.toBe(true);
    expect((await api.listCalendars()).some((item) => item.id === calendar!.id)).toBe(false);
  });
  it("does not discover writes in the read-only view and rejects a revoked credential", async () => {
    const agent = await fixture.connectAgent(["calendar:read", "calendar:write"], {
      readOnly: true,
    });
    const names = (await agent.client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain("create_calendar");
    await agent.revoke();
    const response = await agent.client.callTool({ name: "list_calendars", arguments: {} });
    expect(response.isError, JSON.stringify(response)).toBe(true);
  });
  it("preserves complete event fields and local-day meaning across a DST boundary", async () => {
    const { client } = await fixture.connectAgent(["calendar:read", "calendar:write"]);
    async function call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return (result.structuredContent as { result: Record<string, unknown> }).result;
    }
    const calendar = await call("create_calendar", {
      name: "DST fixture",
      timezone: "America/New_York",
    });
    const proposal = await call("preview_calendar_commitment", {
      candidate: {
        calendarId: calendar.id,
        title: "Fixture booking",
        startsAt: "2026-11-02T16:00:00Z",
        endsAt: "2026-11-02T17:00:00Z",
        timezone: "America/New_York",
        allDay: false,
        visibility: "private",
        location: null,
        notes: null,
        flexibility: "hard",
        evidence: {
          kind: "booking",
          source: {
            accountId: calendar.accountId,
            provider: "local",
            remoteId: "fixture-booking",
            revision: "v1",
            sourceType: "mail_thread",
          },
          summary: "Caller supplied booking evidence",
        },
      },
    });
    expect(proposal).toMatchObject({
      authority: "caller_supplied_unverified",
      policy: { canApply: false },
    });
    let event = await call("create_event", {
      calendarId: calendar.id,
      title: "Private DST plan",
      startsAt: "2026-11-01T01:30:00-04:00",
      endsAt: "2026-11-01T01:30:00-05:00",
      timezone: "America/New_York",
      url: "https://example.com/context",
      conferenceUrl: "https://example.com/meeting",
      transparency: "free",
      eventType: "focus",
      reminders: [{ minutes: 15 }],
      visibility: "private",
    });
    expect(event).toMatchObject({
      url: "https://example.com/context",
      conferenceUrl: "https://example.com/meeting",
      transparency: "free",
      reminders: [{ minutes: 15 }],
    });
    const original = event.updatedAt;
    const attention = await call("create_calendar_attention_item", {
      eventId: event.id,
      title: "Upcoming DST plan",
      summary: "Use the persisted event time",
    });
    expect(attention).toMatchObject({ relatedEntityId: event.id });
    fixture.advanceTime(1000);
    event = await call("update_event", {
      id: event.id,
      expectedUpdatedAt: event.updatedAt,
      expectedBlockUpdatedAtById: {},
      url: null,
      conferenceUrl: null,
      title: "Revised DST plan",
    });
    expect(event).toMatchObject({ url: null, conferenceUrl: null, title: "Revised DST plan" });
    expect(
      (
        await client.callTool({
          name: "update_event",
          arguments: {
            id: event.id,
            expectedUpdatedAt: original,
            expectedBlockUpdatedAtById: {},
            title: "Stale",
          },
        })
      ).isError,
    ).toBe(true);
    expect(
      JSON.stringify(
        await call("list_events", {
          from: "2026-11-01T00:00:00-04:00",
          to: "2026-11-02T00:00:00-05:00",
          calendarIds: [calendar.id],
        }),
      ),
    ).toContain("Revised DST plan");
    fixture.advanceTime(1000);
    event = await call("delete_event", {
      id: event.id,
      expectedUpdatedAt: event.updatedAt,
      expectedBlockUpdatedAtById: {},
    });
    fixture.advanceTime(1000);
    event = await call("restore_event", {
      id: event.eventId,
      expectedUpdatedAt: event.updatedAt,
      expectedBlockUpdatedAtById: event.blockUpdatedAtById,
    });
    expect(event).toMatchObject({ title: "Revised DST plan" });
    expect(
      JSON.stringify(
        await call("list_events", {
          from: "2026-11-01T00:00:00-04:00",
          to: "2026-11-02T00:00:00-05:00",
          calendarIds: [calendar.id],
        }),
      ),
    ).toContain("Revised DST plan");
  });
  it("creates private busy blocks, changes privacy, and unlinks with exact revisions", async () => {
    const { client } = await fixture.connectAgent(["calendar:read", "calendar:write"]);
    async function call(name: string, args: Record<string, unknown>) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r)).not.toBe(true);
      return (r.structuredContent as { result: Record<string, unknown> }).result;
    }
    const source = await call("create_calendar", { name: "Source private", timezone: "UTC" });
    const destination = await call("create_calendar", {
      name: "Busy destination",
      timezone: "UTC",
    });
    let event = await call("create_event", {
      calendarId: source.id,
      title: "Private appointment",
      startsAt: "2026-11-02T12:00:00Z",
      endsAt: "2026-11-02T13:00:00Z",
      timezone: "UTC",
      visibility: "private",
    });
    event = await call("block_event", {
      id: event.id,
      calendarId: destination.id,
      expectedUpdatedAt: event.updatedAt,
      mode: "busy",
    });
    const block = (event.blocks as Array<{ eventId: string; updatedAt: string }>)[0];
    expect(block).toBeDefined();
    expect(await call("get_event", { id: block!.eventId })).toMatchObject({ title: "Busy" });
    fixture.advanceTime(1000);
    event = await call("set_event_block_privacy", {
      id: event.id,
      blockId: block!.eventId,
      expectedUpdatedAt: event.updatedAt,
      expectedBlockUpdatedAt: block!.updatedAt,
      mode: "details",
    });
    const updated = (event.blocks as Array<{ eventId: string; updatedAt: string }>)[0];
    expect(await call("get_event", { id: updated!.eventId })).toMatchObject({
      title: "Private appointment",
    });
    fixture.advanceTime(1000);
    event = await call("unblock_event", {
      id: event.id,
      blockId: updated!.eventId,
      expectedUpdatedAt: event.updatedAt,
      expectedBlockUpdatedAt: updated!.updatedAt,
    });
    expect(event.blocks).toEqual([]);
  });
});
