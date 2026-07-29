import { calendarProviderReconciliationLog } from "./calendar-provider-log.js";

describe("Calendar provider reconciliation logging", () => {
  it("keeps only allowlisted state and excludes provider payloads and identities", () => {
    const metadata = calendarProviderReconciliationLog({
      actorId: "secret-actor",
      actorType: "agent",
      code: "service_unavailable",
      details: {
        completedEffects: [
          {
            calendarId: "secret-calendar",
            remoteEventId: "secret-remote-event",
          },
        ],
        providerPayload: "secret-provider-payload",
      },
      message: "secret-provider-message",
      operation: "update_event",
      requestId: "request-1",
      status: 503,
      userId: "secret-user",
    });

    expect(metadata).toEqual({
      actorType: "agent",
      code: "service_unavailable",
      operation: "update_event",
    });
    expect(JSON.stringify(metadata)).not.toContain("secret");
  });
});
