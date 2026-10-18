import { describe, expect, it } from "vitest";
import { financeActivityPageSchema, financeActivityQuerySchema } from "./activity.js";

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
