import { describe, expect, it } from "vitest";
import {
  financeActivityEvidencePageSchema,
  financeActivityEvidenceQuerySchema,
  financeActivityEvidenceStateSchema,
  financeActivityPageSchema,
  financeActivityQuerySchema,
} from "./activity.js";

describe("Finance Activity read contract", () => {
  it("bounds pages and rejects authority, owner and malformed filters", () => {
    expect(financeActivityQuerySchema.parse({})).toEqual({ limit: 50 });
    for (const query of [
      { limit: 101 },
      { userId: "foreign" },
      { actor: "host" },
      { type: "message_reply" },
      { cursor: "x".repeat(3001) },
      { from: "2026-10-19T00:00:00Z", through: "2026-10-18T00:00:00Z" },
    ]) {
      expect(financeActivityQuerySchema.safeParse(query).success).toBe(false);
    }
  });
  it("bounds exact evidence and rejects hidden overflow/completeness or authority overrides", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const change = {
      id,
      recordRef: { kind: "finance_budget_plan", id },
      sourceRecordRef: { kind: "finance_budget_plan", id },
      before: null,
      after: { amount: "12.00" },
      auditEventIds: [id],
    };
    const page = {
      entryId: id,
      changes: [change],
      auditEventIds: [id],
      recordRefs: [change.recordRef],
      offset: 100,
      totalChanges: 101,
      nextCursor: null,
    };
    expect(financeActivityEvidencePageSchema.parse(page)).toEqual(page);
    expect(
      financeActivityEvidencePageSchema.safeParse({ ...page, nextCursor: "misleading" }).success,
    ).toBe(false);
    expect(
      financeActivityEvidencePageSchema.safeParse({
        ...page,
        changes: Array.from({ length: 101 }, () => change),
      }).success,
    ).toBe(false);
    expect(financeActivityEvidenceQuerySchema.safeParse({ owner: id }).success).toBe(false);
    expect(
      financeActivityEvidenceStateSchema.safeParse({
        totalChanges: 101,
        loadedChanges: 100,
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      financeActivityEvidenceStateSchema.safeParse({
        totalChanges: 100,
        loadedChanges: 100,
        nextCursor: "false-continuation",
      }).success,
    ).toBe(false);
  });
  it("honestly exposes unavailable financial effects and partial historical coverage", () => {
    const page = {
      entries: [],
      nextCursor: null,
      capabilities: {
        financialActions: { state: "unavailable", reason: "mutation_evidence_not_integrated" },
        humanDecisions: { state: "available" },
      },
      coverage: {
        state: "partial",
        reasons: [
          "financial_mutation_evidence_not_integrated",
          "historical_decisions_without_causal_message_not_projected",
        ],
      },
    };
    expect(financeActivityPageSchema.parse(page)).toEqual(page);
    expect(
      financeActivityPageSchema.safeParse({ ...page, coverage: { state: "complete", reasons: [] } })
        .success,
    ).toBe(false);
  });
});

describe("Finance notification delivery Activity contract", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const at = "2026-11-01T12:00:00.000Z";
  const entry = {
    id,
    occurredAt: at,
    kind: "notification_delivery",
    status: "accepted",
    actor: null,
    action: "Finance notification",
    explanation: "Provider accepted; delivery is unconfirmed.",
    caseId: null,
    runId: null,
    actionId: null,
    sourceOperationId: null,
    auditEventIds: [],
    sourceMessages: [],
    recordRefs: [],
    changes: [],
    targets: [],
    delivery: {
      attemptId: id,
      attemptState: "accepted",
      observedAt: at,
      messageId: id,
      messageStatus: "accepted",
      submittedAt: at,
      deliveredAt: null,
      evidenceState: "complete",
      work: [],
    },
  };
  it("admits transport facts without inventing an actor or financial audit", async () => {
    const { financeActivityEntrySchema } = await import("./activity.js");
    expect(financeActivityEntrySchema.parse(entry)).toEqual(entry);
    expect(financeActivityQuerySchema.parse({ type: "notification_delivery" }).type).toBe(
      "notification_delivery",
    );
    for (const extra of [
      { actor: { type: "system", id: null } },
      { auditEventIds: [id] },
      { delivery: { ...entry.delivery, providerMessageSid: "private" } },
      { delivery: { ...entry.delivery, body: "private" } },
    ])
      expect(financeActivityEntrySchema.safeParse({ ...entry, ...extra }).success).toBe(false);
  });
  it("preserves required financial attribution and audit evidence", async () => {
    const { financeActivityEntrySchema } = await import("./activity.js");
    expect(
      financeActivityEntrySchema.safeParse({ ...entry, kind: "financial_action" }).success,
    ).toBe(false);
  });
});

describe("Activity response-shape awareness", () => {
  it("strictly parses optional boolean query values without changing legacy defaults", async () => {
    const { isFinanceActivityNotificationAware } = await import("./activity.js");
    expect(financeActivityQuerySchema.parse({})).toEqual({ limit: 50 });
    for (const value of [false, "false"]) {
      const query = financeActivityQuerySchema.parse({ includeNotificationDeliveries: value });
      expect(query.includeNotificationDeliveries).toBe(false);
      expect(isFinanceActivityNotificationAware(query)).toBe(false);
    }
    for (const value of [true, "true"]) {
      const query = financeActivityQuerySchema.parse({ includeNotificationDeliveries: value });
      expect(isFinanceActivityNotificationAware(query)).toBe(true);
    }
    for (const value of ["FALSE", "0", "yes", "", 0, 1, null, {}])
      expect(
        financeActivityQuerySchema.safeParse({ includeNotificationDeliveries: value }).success,
      ).toBe(false);
    expect(
      isFinanceActivityNotificationAware({
        type: "notification_delivery",
        includeNotificationDeliveries: false,
      }),
    ).toBe(true);
  });
});
