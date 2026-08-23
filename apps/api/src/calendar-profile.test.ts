import { invalidateCalendarProfileSources } from "./calendar-profile.js";

type CalendarProfileTransaction = Parameters<typeof invalidateCalendarProfileSources>[0];

function transactionFor(profile: Record<string, unknown>, updated: Record<string, unknown> | null) {
  const limit = vi.fn().mockResolvedValue([profile]);
  const returning = vi.fn().mockResolvedValue(updated ? [updated] : []);
  const transaction = {
    insert: vi.fn(() => ({ values: vi.fn() })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(() => ({ limit })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning })),
      })),
    })),
  };
  return { limit, transaction: transaction as unknown as CalendarProfileTransaction };
}

describe("Calendar profile source invalidation", () => {
  const context = {
    principal: { actorId: "user-1", actorType: "user" as const, userId: "user-1" },
    requestId: "request-1",
  };

  it("does not inspect a profile when no unavailable sources are supplied", async () => {
    const { limit, transaction } = transactionFor({}, null);

    await invalidateCalendarProfileSources(transaction, {
      context,
      now: new Date("2026-08-23T12:00:00.000Z"),
      userId: "user-1",
    });

    expect(limit).not.toHaveBeenCalled();
  });

  it("preserves a legacy default reference and reports a concurrent invalidation", async () => {
    const profile = {
      domain: "calendar",
      id: "profile-1",
      preferences: { defaultCalendarId: "calendar-1", unexpected: true },
      sourceContexts: [{ sourceId: "calendar-1" }],
      status: "active",
      userId: "user-1",
      version: 2,
    };
    const { transaction } = transactionFor(profile, null);

    await expect(
      invalidateCalendarProfileSources(transaction, {
        context,
        now: new Date("2026-08-23T12:00:00.000Z"),
        unavailableCalendarIds: ["calendar-1"],
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
