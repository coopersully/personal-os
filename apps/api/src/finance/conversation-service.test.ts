import type { FinanceConversationBatch } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import {
  advanceConversationProof,
  type ConversationProof,
  captureFinanceConversationBatch,
  conversationNonceDigest,
  decodeConversationBatchCursor,
  encodeConversationBatchCursor,
  requireConversationCausality,
  requireDeliveredConversationAcknowledgment,
} from "./conversation-service.js";

const now = new Date("2026-10-18T20:00:00Z");
const binding = {
  userId: "owner",
  automationScheduleId: "schedule",
  authorizationConnectionId: "connection",
  protocolVersion: "1",
};
const proof: ConversationProof = {
  ...binding,
  challengeId: "challenge",
  nonceDigest: conversationNonceDigest("nonce"),
  expiresAt: new Date(now.getTime() + 60000),
  fetchedAt: null,
  acknowledgedAt: null,
  respondedAt: null,
  verifiedAt: null,
  response: null,
};

describe("Finance conversation server protocol", () => {
  it("requires fetch, exact acknowledgment and persisted response under the original live binding", () => {
    const apply = (
      value: ConversationProof,
      operation: Parameters<typeof advanceConversationProof>[0]["operation"],
    ) => advanceConversationProof({ proof: value, binding, liveGrant: true, now, operation });
    expect(() =>
      apply(proof, { kind: "acknowledge", challengeId: "challenge", nonce: "nonce" }),
    ).toThrow("Fetch");
    const fetched = apply(proof, { kind: "fetch" });
    expect(fetched.verifiedAt).toBeNull();
    expect(() =>
      apply(fetched, { kind: "acknowledge", challengeId: "challenge", nonce: "wrong" }),
    ).toThrow("exact");
    expect(() =>
      apply(fetched, { kind: "respond", challengeId: "challenge", response: "hello" }),
    ).toThrow("Acknowledge");
    const acknowledged = apply(fetched, {
      kind: "acknowledge",
      challengeId: "challenge",
      nonce: "nonce",
    });
    expect(acknowledged.verifiedAt).toBeNull();
    const responded = apply(acknowledged, {
      kind: "respond",
      challengeId: "challenge",
      response: "hello",
    });
    expect(responded.response).toBe("hello");
    expect(responded.verifiedAt).toEqual(now);
    expect(
      apply(responded, { kind: "respond", challengeId: "challenge", response: "hello" }),
    ).toEqual(responded);
    expect(() =>
      apply(responded, { kind: "respond", challengeId: "challenge", response: "changed" }),
    ).toThrow("immutable");
    for (const altered of [
      { ...binding, userId: "foreign" },
      { ...binding, authorizationConnectionId: "replacement" },
      { ...binding, automationScheduleId: "other" },
      { ...binding, protocolVersion: "2" },
    ]) {
      expect(() =>
        advanceConversationProof({
          proof: responded,
          binding: altered,
          liveGrant: true,
          now,
          operation: { kind: "fetch" },
        }),
      ).toThrow("original");
    }
    expect(() =>
      advanceConversationProof({
        proof: responded,
        binding,
        liveGrant: false,
        now,
        operation: { kind: "fetch" },
      }),
    ).toThrow("original");
    expect(() =>
      advanceConversationProof({
        proof,
        binding,
        liveGrant: true,
        now: proof.expiresAt,
        operation: { kind: "fetch" },
      }),
    ).toThrow("expired");
  });
  it("retains an empty batch across retries, coalesced starts and later arrivals", async () => {
    let saved: FinanceConversationBatch | null = null;
    let sequence = "0";
    let inserts = 0;
    const store = {
      findBatch: async () => saved,
      currentSequence: async () => sequence,
      insertBatch: async (_tx: null, _userId: string, batch: FinanceConversationBatch) => {
        saved = batch;
        inserts++;
      },
    };
    const input = { tx: null, store, ...binding, runId: "run", now };
    const first = await captureFinanceConversationBatch(input);
    sequence = "9007199254740993";
    expect(await captureFinanceConversationBatch(input)).toEqual(first);
    expect(
      await captureFinanceConversationBatch({ ...input, now: new Date(now.getTime() + 1000) }),
    ).toEqual(first);
    expect(inserts).toBe(1);
    expect(first.cutoffSequence).toBe("0");
    await expect(
      captureFinanceConversationBatch({ ...input, authorizationConnectionId: "replacement" }),
    ).rejects.toThrow("original");
  });
  it("rejects guessed, duplicated or undelivered acknowledgments", () => {
    expect(() => requireDeliveredConversationAcknowledgment(["one"], ["one"])).not.toThrow();
    for (const ids of [["two"], ["one", "one"]])
      expect(() => requireDeliveredConversationAcknowledgment(["one"], ids)).toThrow("exact");
  });
  it("never permits an earlier action to cite a later or foreign source", () => {
    const batch: FinanceConversationBatch = {
      runId: "run",
      automationScheduleId: "schedule",
      authorizationConnectionId: "connection",
      cutoffSequence: "9007199254740993",
      capturedAt: now.toISOString(),
    };
    const message = {
      id: "one",
      sequence: "9007199254740994",
      authorKind: "user" as const,
      text: "later",
      caseId: null,
      recordRefs: [],
      runId: null,
      sourceMessageIds: [],
      createdAt: now.toISOString(),
    };
    expect(() => requireConversationCausality(batch, [message], ["one"])).toThrow("fixed");
    expect(() => requireConversationCausality(batch, [], ["foreign"])).toThrow("fixed");
  });
  it("binds signed cursors to exact owner, run and cutoff and permits deterministic page retry", () => {
    const batch: FinanceConversationBatch = {
      runId: "run",
      automationScheduleId: "schedule",
      authorizationConnectionId: "connection",
      cutoffSequence: "12",
      capturedAt: now.toISOString(),
    };
    const cursor = encodeConversationBatchCursor("owner", batch, "5", "private-key");
    expect(decodeConversationBatchCursor(cursor, "owner", batch, "private-key")).toBe(5n);
    expect(decodeConversationBatchCursor(cursor, "owner", batch, "private-key")).toBe(5n);
    for (const invalid of [
      "5",
      cursor.split(".")[0] ?? "",
      `${cursor}changed`,
      encodeConversationBatchCursor("owner", batch, "13", "private-key"),
    ]) {
      expect(() => decodeConversationBatchCursor(invalid, "owner", batch, "private-key")).toThrow(
        "signed",
      );
    }
    expect(() => decodeConversationBatchCursor(cursor, "foreign", batch, "private-key")).toThrow(
      "signed",
    );
    expect(() =>
      decodeConversationBatchCursor(cursor, "owner", { ...batch, runId: "another" }, "private-key"),
    ).toThrow("signed");
    expect(() =>
      decodeConversationBatchCursor(
        cursor,
        "owner",
        { ...batch, cutoffSequence: "13" },
        "private-key",
      ),
    ).toThrow("signed");
    expect(() => decodeConversationBatchCursor(cursor, "owner", batch, "another-key")).toThrow(
      "signed",
    );
  });
});
