import { describe, expect, it } from "vitest";
import {
  projectFinanceNotificationActivity,
  type NotificationActivitySource,
} from "./activity-notification-store.js";
const owner = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
const runId = "55555555-5555-4555-8555-555555555555";
function fixture(): NotificationActivitySource {
  return {
    attempt: {
      id: attemptId,
      userId: owner,
      state: "accepted",
      messageId,
      connectionId: owner,
      submittedAt: new Date("2026-11-01T12:00:01Z"),
      createdAt: new Date("2026-11-01T12:00:00Z"),
      updatedAt: new Date("2026-11-01T12:00:02Z"),
    },
    message: {
      id: messageId,
      userId: owner,
      connectionId: owner,
      direction: "outbound",
      status: "accepted",
      updatedAt: new Date("2026-11-01T12:00:01Z"),
      providerSubmittedAt: new Date("2026-11-01T12:00:01Z"),
      deliveredAt: null,
    },
    items: [
      {
        userId: owner,
        attemptId,
        intentId: foreign,
        work: {
          domain: "finances",
          kind: "repair",
          id: owner,
          revision: runId,
          actionRevision: "r1",
        },
      },
    ],
    ownedRunIds: [runId],
  };
}
describe("owner notification Activity projection", () => {
  it("reports acceptance without delivery, fabricated attribution or financial evidence", () => {
    const result = projectFinanceNotificationActivity(owner, fixture());
    expect(result?.kind).toBe("notification_delivery");
    expect(result?.actor).toBeNull();
    expect(result?.auditEventIds).toEqual([]);
    expect(result?.status).toBe("accepted");
    expect(result?.explanation).toContain("not confirmed");
    expect(result?.occurredAt).toBe("2026-11-01T12:00:00.000Z");
    if (result?.kind !== "notification_delivery") throw new Error("Missing delivery projection");
    expect(result.delivery.observedAt).toBe("2026-11-01T12:00:02.000Z");
    expect(result.delivery.work[0]?.runId).toBe(runId); // revision is the run; semantic work.id is not.
    expect(JSON.stringify(result)).not.toMatch(/providerMessageSid|body|phoneNumber/u);
  });
  it("requires actual owned outbound message and connection, without adopting foreign facts", () => {
    for (const field of ["userId", "connectionId"] as const) {
      const f = fixture();
      if (!f.message) throw new Error("Missing fixture message");
      f.message[field] = foreign;
      const entry = projectFinanceNotificationActivity(owner, f);
      if (entry?.kind !== "notification_delivery") throw new Error("Missing delivery projection");
      expect(entry.delivery.messageId).toBeNull();
      expect(entry.delivery.messageStatus).toBeNull();
      expect(entry.delivery.evidenceState).toBe("partial");
    }
    const f = fixture();
    f.attempt.userId = foreign;
    expect(projectFinanceNotificationActivity(owner, f)).toBeNull();
  });
  it("rejects wrong-owner or wrong-attempt frozen membership instead of adopting it", () => {
    for (const field of ["userId", "attemptId"] as const) {
      const f = fixture();
      const item = f.items[0];
      if (!item) throw new Error("Missing frozen membership fixture");
      item[field] = foreign;
      expect(projectFinanceNotificationActivity(owner, f)).toBeNull();
    }
  });
  it("never links a foreign/missing run or substitutes the semantic work identity", () => {
    const f = fixture();
    f.ownedRunIds = [];
    const entry = projectFinanceNotificationActivity(owner, f);
    if (entry?.kind !== "notification_delivery") throw new Error("Missing delivery projection");
    expect(entry.delivery.work[0]?.runId).toBeNull();
    expect(entry.targets).toEqual([]);
    expect(entry.delivery.evidenceState).toBe("partial");
  });
  it("requires the delivery timestamp as well as status; neither proves reading or work completion", () => {
    const f = fixture();
    if (!f.message) throw new Error("Missing fixture message");
    f.message.status = "delivered";
    expect(projectFinanceNotificationActivity(owner, f)?.status).toBe("accepted");
    f.message.deliveredAt = new Date("2026-11-01T12:00:03Z");
    f.message.updatedAt = new Date("2026-11-01T12:00:04Z");
    const result = projectFinanceNotificationActivity(owner, f);
    expect(result?.status).toBe("delivered");
    if (result?.kind !== "notification_delivery") throw new Error("Missing delivery projection");
    expect(result.delivery.observedAt).toBe("2026-11-01T12:00:04.000Z");
    expect(result?.explanation).toContain("does not prove reading");
  });
  it("keeps missing history explicit and does not silently truncate membership", () => {
    const f = fixture();
    f.message = null;
    f.items = [];
    const entry = projectFinanceNotificationActivity(owner, f);
    if (entry?.kind !== "notification_delivery") throw new Error("Missing delivery projection");
    expect(entry.delivery.evidenceState).toBe("partial");
    const large = fixture();
    large.items = Array.from({ length: 101 }, () => large.items[0]).filter(
      (item): item is NonNullable<typeof item> => Boolean(item),
    );
    expect(projectFinanceNotificationActivity(owner, large)).toBeNull();
  });
});
