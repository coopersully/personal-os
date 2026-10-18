import { describe, expect, it, vi } from "vitest";
import { createFinanceConversationApi } from "./finance-conversation.js";
import type { FinanceRequest } from "./finances.js";

describe("Finance conversation client leaf", () => {
  it("preserves lossless cursors, source IDs and challenge exchange without self-reported proof", async () => {
    const request = vi.fn(async (path: string) =>
      path.endsWith("/messages")
        ? { message: { id: "message" } }
        : path.endsWith("/replies")
          ? { message: { id: "reply" } }
          : path.endsWith("/challenges")
            ? { challenge: { challengeId: "challenge" } }
            : path.endsWith("/readiness")
              ? { readiness: { canSend: false } }
              : {},
    ) as unknown as FinanceRequest;
    const api = createFinanceConversationApi(request);
    await api.getFinanceConversationReadiness();
    await api.getFinanceConversationHistory({ after: "9007199254740993", limit: 1 });
    await api.getFinanceConversationBatch("run/id", { cursor: "signed+cursor/==", limit: 2 });
    await api.sendFinanceConversationMessage({
      text: "hello",
      idempotencyKey: "send",
      caseId: null,
      recordRefs: [],
    });
    await api.acknowledgeFinanceConversationBatch("run/id", { messageIds: ["message"] });
    await api.replyToFinanceConversationBatch("run/id", {
      text: "reply",
      idempotencyKey: "reply",
      sourceMessageIds: ["message"],
      caseId: null,
    });
    await api.issueFinanceConversationChallenge("schedule/id");
    await api.exchangeFinanceConversationChallenge("challenge/id", { kind: "fetch" });
    await api.markFinanceConversationRendered("9007199254740993");
    const calls = vi.mocked(request).mock.calls;
    expect(calls[1]?.[0]).toBe("/v1/finances/conversation/messages?after=9007199254740993&limit=1");
    expect(calls[2]?.[0]).toBe(
      "/v1/finances/conversation/batches/run%2Fid?cursor=signed%2Bcursor%2F%3D%3D&limit=2",
    );
    expect(calls[4]).toEqual([
      "/v1/finances/conversation/batches/run%2Fid/acknowledgments",
      { method: "POST", body: JSON.stringify({ messageIds: ["message"] }) },
    ]);
    expect(calls[7]).toEqual([
      "/v1/finances/conversation/challenges/challenge%2Fid/exchange",
      { method: "POST", body: JSON.stringify({ kind: "fetch" }) },
    ]);
    expect(calls[8]).toEqual([
      "/v1/finances/conversation/rendered",
      { method: "POST", body: JSON.stringify({ throughSequence: "9007199254740993" }) },
    ]);
  });
});

it("encodes the exact host for its own readiness projection", async () => {
  const request = vi.fn(async () => ({
    readiness: { canSend: false, reason: "challenge_required" },
  }));
  const api = createFinanceConversationApi(request as FinanceRequest);
  expect(await api.getFinanceConversationHostReadiness("host/id")).toEqual({
    canSend: false,
    reason: "challenge_required",
  });
  expect(request).toHaveBeenCalledWith("/v1/finances/conversation/hosts/host%2Fid/readiness");
});
