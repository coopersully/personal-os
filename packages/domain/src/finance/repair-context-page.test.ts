import { describe, expect, it } from "vitest";
import {
  financeConversationBatchPageSchema,
  type FinanceConversationMessage,
} from "./conversation.js";
import {
  type FinanceRepairContextHeldEntry,
  type FinanceRepairContextPageV2,
  financeRepairContextHeldEntrySchema,
  financeRepairContextPageV2Schema,
} from "./repair-context-page.js";

function id(value: number) {
  return `a1820000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function message(value = 1, sequence = String(value)): FinanceConversationMessage {
  return {
    id: id(value),
    sequence,
    authorKind: "user",
    text: "Owner context retained in Chat.",
    caseId: null,
    recordRefs: [],
    runId: null,
    sourceMessageIds: [],
    createdAt: "2026-11-02T09:00:00.000Z",
  };
}

function held(value = 2, sequence = String(value)): FinanceRepairContextHeldEntry {
  return {
    kind: "repair_context_held",
    messageId: id(value),
    sequence,
    routeId: id(value + 1_000),
    state: "held",
    reason: "consent_changed",
  };
}

function page(): FinanceRepairContextPageV2 {
  return {
    pageVersion: 2,
    batch: {
      runId: id(500),
      automationScheduleId: id(501),
      authorizationConnectionId: id(502),
      cutoffSequence: "100",
      capturedAt: "2026-11-02T09:01:00.000Z",
    },
    messages: [message()],
    heldEntries: [held()],
    nextCursor: null,
  };
}

describe("repair context V2 page shape (no runtime disclosure or cursor authority)", () => {
  it("keeps withheld identities separate from canonical body messages", () => {
    const parsed = financeRepairContextPageV2Schema.parse(page());
    expect(parsed.messages).toEqual([message()]);
    expect(parsed.heldEntries).toEqual([held()]);
    expect(parsed.heldEntries[0]).not.toHaveProperty("text");
    expect(parsed.heldEntries[0]).not.toHaveProperty("consumed");
  });

  it.each([
    { text: "Do not disclose" },
    { body: "Do not disclose" },
    { providerMessageSid: "provider-private" },
    { phoneNumber: "+15555550182" },
    { token: "private" },
    { principal: { actorType: "user" } },
    { consumed: true },
  ])("rejects private or unsupported held-entry fields instead of stripping them: %j", (extra) => {
    expect(financeRepairContextHeldEntrySchema.safeParse({ ...held(), ...extra }).success).toBe(
      false,
    );
  });

  it.each([
    { reason: "assume_authorized" },
    { state: "consumed" },
    { kind: "accepted_answer" },
    { messageId: "not-a-uuid" },
    { routeId: "not-a-uuid" },
  ])("rejects invalid held identity or disposition: %j", (change) => {
    expect(financeRepairContextHeldEntrySchema.safeParse({ ...held(), ...change }).success).toBe(
      false,
    );
  });

  it("requires explicit V2 and preserves the separately strict V1 shape", () => {
    const v2 = page();
    const v1 = { batch: v2.batch, messages: v2.messages, nextCursor: v2.nextCursor };
    expect(financeConversationBatchPageSchema.safeParse(v1).success).toBe(true);
    expect(financeRepairContextPageV2Schema.safeParse(v1).success).toBe(false);
    expect(financeConversationBatchPageSchema.safeParse(v2).success).toBe(false);
    expect(financeRepairContextPageV2Schema.safeParse({ ...v2, pageVersion: 1 }).success).toBe(
      false,
    );
    expect(financeRepairContextPageV2Schema.safeParse({ ...v2, admitted: true }).success).toBe(
      false,
    );
  });

  it("enforces the total processed ceiling across both arrays", () => {
    const source = {
      ...page(),
      messages: Array.from({ length: 50 }, (_, index) => message(index + 1)),
      heldEntries: Array.from({ length: 50 }, (_, index) => held(index + 51)),
    };
    expect(financeRepairContextPageV2Schema.safeParse(source).success).toBe(true);
    const over = {
      ...source,
      batch: { ...source.batch, cutoffSequence: "101" },
      heldEntries: [...source.heldEntries, held(101)],
    };
    const parsed = financeRepairContextPageV2Schema.safeParse(over);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.some((issue) => issue.message.includes("total processed"))).toBe(
        true,
      );
  });

  it("rejects an individually oversized membership array", () => {
    expect(
      financeRepairContextPageV2Schema.safeParse({
        ...page(),
        batch: { ...page().batch, cutoffSequence: "101" },
        messages: [],
        heldEntries: Array.from({ length: 101 }, (_, index) => held(index + 1)),
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate IDs and sequences within either array and across arrays", () => {
    for (const change of [
      { messages: [message(1), message(1, "2")], heldEntries: [] },
      { messages: [message(1), message(2, "1")], heldEntries: [] },
      { messages: [], heldEntries: [held(1), held(1, "2")] },
      { messages: [], heldEntries: [held(1), held(2, "1")] },
      { messages: [message(1)], heldEntries: [held(1, "2")] },
      { messages: [message(1)], heldEntries: [held(2, "1")] },
    ])
      expect(financeRepairContextPageV2Schema.safeParse({ ...page(), ...change }).success).toBe(
        false,
      );
  });

  it("accepts sparse interleaved memberships with independent native ordering", () => {
    const source = {
      ...page(),
      messages: [message(1, "3"), message(2, "10")],
      heldEntries: [held(3, "1"), held(4, "8")],
    };
    expect(financeRepairContextPageV2Schema.parse(source)).toEqual(source);
  });

  it("orders distinct bigint sequences beyond JavaScript safe integer precision", () => {
    const source = {
      ...page(),
      batch: { ...page().batch, cutoffSequence: "9223372036854775807" },
      messages: [message(1, "9007199254740992"), message(2, "9007199254740993")],
      heldEntries: [held(3, "9223372036854775807")],
    };
    expect(financeRepairContextPageV2Schema.safeParse(source).success).toBe(true);
    expect(
      financeRepairContextPageV2Schema.safeParse({
        ...source,
        messages: [...source.messages].reverse(),
      }).success,
    ).toBe(false);
  });

  it("rejects zero, reversed and beyond-cutoff processed memberships", () => {
    for (const change of [
      { messages: [message(1, "0")], heldEntries: [] },
      { messages: [message(1, "101")], heldEntries: [] },
      { messages: [], heldEntries: [held(1, "101")] },
      { messages: [message(2), message(1)], heldEntries: [] },
      { messages: [], heldEntries: [held(2), held(1)] },
    ])
      expect(financeRepairContextPageV2Schema.safeParse({ ...page(), ...change }).success).toBe(
        false,
      );
  });

  it.each([
    "bad",
    "-1",
    "1.5",
    "01",
    "9223372036854775808",
  ])("rejects malformed or overflow sequences without throwing: %s", (sequence) => {
    for (const source of [
      { ...page(), messages: [message(1, sequence)] },
      { ...page(), heldEntries: [held(2, sequence)] },
      { ...page(), batch: { ...page().batch, cutoffSequence: sequence } },
    ]) {
      expect(() => financeRepairContextPageV2Schema.safeParse(source)).not.toThrow();
      expect(financeRepairContextPageV2Schema.safeParse(source).success).toBe(false);
    }
  });

  it("accepts empty and all-held pages without claiming delivery or consumption", () => {
    for (const nextCursor of [null, "opaque-next-page"])
      for (const heldEntries of [[], [held()]]) {
        const parsed = financeRepairContextPageV2Schema.parse({
          ...page(),
          messages: [],
          heldEntries,
          nextCursor,
        });
        expect(parsed.messages).toEqual([]);
        expect(parsed.nextCursor).toBe(nextCursor);
        expect(parsed).not.toHaveProperty("consumed");
      }
    expect(
      financeRepairContextPageV2Schema.safeParse({
        ...page(),
        batch: { ...page().batch, cutoffSequence: "0" },
        messages: [],
        heldEntries: [],
      }).success,
    ).toBe(true);
  });

  it.each(["", "a".repeat(2001)])("rejects invalid opaque cursor length", (nextCursor) => {
    expect(financeRepairContextPageV2Schema.safeParse({ ...page(), nextCursor }).success).toBe(
      false,
    );
  });

  it("uses the canonical message schema rather than allowing a held placeholder as a body", () => {
    expect(
      financeRepairContextPageV2Schema.safeParse({
        ...page(),
        messages: [held()],
        heldEntries: [],
      }).success,
    ).toBe(false);
    expect(
      financeRepairContextPageV2Schema.safeParse({
        ...page(),
        messages: [{ ...message(), providerMessageSid: "private" }],
      }).success,
    ).toBe(false);
  });

  it("accepts only cursor shape and does not pretend to authenticate cursor contents", () => {
    const parsed = financeRepairContextPageV2Schema.parse({
      ...page(),
      nextCursor: "not-a-signed-cursor",
    });
    expect(parsed.nextCursor).toBe("not-a-signed-cursor");
    expect(parsed).not.toHaveProperty("authorized");
  });
});
