import { describe, expect, it, vi } from "vitest";
import { createFinanceConversationApi } from "./finance-conversation.js";
import type { FinanceRequest } from "./finances.js";

describe("Finance conversation client leaf", () => {
  it("keeps agent card transport separate from human messages and original-host turns", async () => {
    const request = vi.fn().mockResolvedValue({ message: { authorKind: "agent" } });
    const api = createFinanceConversationApi(request);
    await api.getFinanceAgentChat({ before: "9007199254740993", limit: 10 });
    const input = {
      text: "Review the proposal.",
      idempotencyKey: "card",
      recordRefs: [{ kind: "budget_start_preview" as const, id: "preview" }],
    };
    expect(await api.publishFinanceAgentCard(input)).toEqual({ authorKind: "agent" });
    expect(request.mock.calls).toEqual([
      ["/v1/finances/conversation/agent/messages?before=9007199254740993&limit=10"],
      ["/v1/finances/conversation/agent/cards", { method: "POST", body: JSON.stringify(input) }],
    ]);
  });
  it("requests recent history and older pages without lossy cursor conversion", async () => {
    const request = vi.fn().mockResolvedValue({ messages: [], nextCursor: null });
    const api = createFinanceConversationApi(request);
    await api.getFinanceConversationHistory({ latest: true, limit: 50 });
    await api.getFinanceConversationHistory({ before: "9007199254740993", limit: 50 });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/v1/finances/conversation/messages?latest=true&limit=50",
      "/v1/finances/conversation/messages?before=9007199254740993&limit=50",
    ]);
  });
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

it("fetches exact human message context using the shared transport and encoded message ID", async () => {
  const request = vi.fn(async () => ({ targetMessageId: "id", messages: [] }));
  const api = createFinanceConversationApi(request as unknown as FinanceRequest);
  await api.getFinanceConversationMessageContext("message/id");
  expect(request).toHaveBeenCalledWith("/v1/finances/conversation/messages/message%2Fid/context");
});

it("uses the independent turn transport without coercing fixed decimal cutoffs", async () => {
  const request = vi.fn(async (path: string) =>
    path.endsWith("/replies")
      ? { message: { id: "reply" } }
      : { turn: { cutoffSequence: "9007199254740993" }, messages: [] },
  );
  const api = createFinanceConversationApi(request as unknown as FinanceRequest);
  expect(await api.beginFinanceConversationTurn("schedule/id")).toMatchObject({
    turn: { cutoffSequence: "9007199254740993" },
  });
  await api.acknowledgeFinanceConversationTurn("turn/id", { messageIds: ["source"] });
  const input = {
    text: "reply",
    idempotencyKey: "retry",
    sourceMessageIds: ["source"],
    caseId: null,
  };
  expect(await api.replyToFinanceConversationTurn("turn/id", input)).toEqual({ id: "reply" });
  expect(request.mock.calls.map((call) => call[0])).toEqual([
    "/v1/finances/conversation/hosts/schedule%2Fid/turns",
    "/v1/finances/conversation/turns/turn%2Fid/acknowledgments",
    "/v1/finances/conversation/turns/turn%2Fid/replies",
  ]);
});
