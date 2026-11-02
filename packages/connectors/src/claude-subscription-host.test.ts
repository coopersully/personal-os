import { afterEach, describe, expect, it, vi } from "vitest";
import { createClaudeSubscriptionHostAdapter } from "./claude-subscription-host.js";
import type { SubscriptionHostFireInput } from "./subscription-host.js";

const input: SubscriptionHostFireInput = {
  routineId: "trig_abcdefghijkl",
  credential: "sk-ant-oat01-fixtureToken012345",
  wake: {
    kind: "accepted_answer",
    scheduleId: "11111111-1111-4111-8111-111111111111",
    continuationId: "22222222-2222-4222-8222-222222222222",
  },
};
const sessionId = "session_abcdefghijkl";
const acceptedBody = JSON.stringify({ type: "routine_fire", claude_code_session_id: sessionId });
function fixture(response: Response = new Response(acceptedBody)) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  return { fetch, adapter: createClaudeSubscriptionHostAdapter({ fetch }) };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Claude accepted-answer subscription transport", () => {
  it("returns the actual accepted session from a valid routine-fire response", async () => {
    const f = fixture();
    expect(await f.adapter.invoke(input)).toEqual({ state: "accepted", sessionId, status: 200 });
  });
  it("uses exactly one fixed provider POST and the existing minimal answer-ready payload", async () => {
    const f = fixture();
    await f.adapter.invoke(input);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch).toHaveBeenCalledWith(
      `https://api.anthropic.com/v1/claude_code/routines/${input.routineId}/fire`,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${input.credential}`,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        signal: expect.any(AbortSignal),
        body: JSON.stringify({
          text: JSON.stringify({
            type: "nohmi_finance_answer_ready",
            scheduleId: input.wake.scheduleId,
            continuationId: input.wake.continuationId,
          }),
        }),
      }),
    );
  });
  it.each([
    400, 401, 403, 404, 429,
  ])("retains definite rejection status %i without retry", async (status) => {
    const f = fixture(new Response("PRIVATE PROVIDER BODY", { status }));
    expect(await f.adapter.invoke(input)).toEqual({ state: "rejected", status });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([301, 408, 500, 503])("keeps unsupported status %i uncertain", async (status) => {
    const f = fixture(new Response("PRIVATE PROVIDER BODY", { status }));
    expect(await f.adapter.invoke(input)).toEqual({
      state: "uncertain",
      reason: "provider_response",
      status,
    });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["120", 120],
    ["999999", 86400],
    ["-1", undefined],
    ["not-a-date", undefined],
  ] as const)("keeps Retry-After %s a bounded optional hint", async (header, expected) => {
    const f = fixture(new Response(null, { status: 429, headers: { "Retry-After": header } }));
    expect(await f.adapter.invoke(input)).toEqual({
      state: "rejected",
      status: 429,
      ...(expected === undefined ? {} : { retryAfterSeconds: expected }),
    });
  });
  it("reads an HTTP-date retry hint against the current clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    const f = fixture(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "Mon, 02 Nov 2026 12:02:00 GMT" },
      }),
    );
    expect(await f.adapter.invoke(input)).toEqual({
      state: "rejected",
      status: 429,
      retryAfterSeconds: 120,
    });
  });
  it.each([
    "not JSON",
    JSON.stringify({ type: "other", claude_code_session_id: sessionId }),
    JSON.stringify({ type: "routine_fire" }),
    JSON.stringify({ type: "routine_fire", claude_code_session_id: "wrong_identifier" }),
  ])("rejects malformed success without a false acknowledgement", async (body) => {
    const f = fixture(new Response(body));
    expect(await f.adapter.invoke(input)).toEqual({
      state: "uncertain",
      reason: "invalid_response",
      status: 200,
    });
  });
  it("keeps missing success body uncertain", async () => {
    const f = fixture(new Response(null));
    expect(await f.adapter.invoke(input)).toMatchObject({
      state: "uncertain",
      reason: "invalid_response",
    });
  });
  it.each([16384, 16385])("bounds streamed success at %i bytes", async (bytes) => {
    const f = fixture(new Response(acceptedBody + " ".repeat(bytes - acceptedBody.length)));
    const result = await f.adapter.invoke(input);
    expect(result.state).toBe(bytes === 16384 ? "accepted" : "uncertain");
  });
  it.each([
    { ...input, routineId: "../messages" },
    { ...input, credential: "sk-ant-oat01-short" },
    { ...input, credential: `sk-ant-oat01-${"a".repeat(501)}` },
    { ...input, credential: "sk-ant-oat01-validToken123\r\nInjected: value" },
    { ...input, credential: "other-credential123456" },
    { ...input, wake: { ...input.wake, scheduleId: "not-a-uuid" } },
    { ...input, wake: { ...input.wake, continuationId: "not-a-uuid" } },
  ])("fails invalid local input before fetch with a fixed private-safe error", async (value) => {
    const f = fixture();
    await expect(f.adapter.invoke(value)).rejects.toThrow("Invalid subscription host request.");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("never treats a general conversation as an accepted answer", async () => {
    const f = fixture();
    await expect(
      // @ts-expect-error Only a real accepted-answer reference is a supported transport input.
      f.adapter.invoke({ ...input, wake: { ...input.wake, kind: "user_conversation" } }),
    ).rejects.toThrow("Invalid subscription host request.");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("redacts thrown provider errors and does not log private payloads", async () => {
    const f = fixture();
    f.fetch.mockRejectedValue(new Error(input.credential + " PRIVATE PROVIDER BODY"));
    const warn = vi.spyOn(console, "warn"),
      error = vi.spyOn(console, "error");
    expect(await f.adapter.invoke(input)).toEqual({ state: "uncertain", reason: "transport" });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it("honors caller abort during an unending response body", async () => {
    const f = fixture(new Response(new ReadableStream<Uint8Array>()));
    const controller = new AbortController();
    const result = f.adapter.invoke(input, controller.signal);
    controller.abort();
    expect(await result).toMatchObject({ state: "uncertain" });
  });
  it("bounds a provider request that ignores its abort signal", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}));
    const result = createClaudeSubscriptionHostAdapter({ fetch }).invoke(input);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await result).toEqual({ state: "uncertain", reason: "transport" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("uses one deadline for body reads and never awaits an unending cancellation", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16385));
      },
      cancel() {
        return new Promise(() => {});
      },
    });
    const f = fixture(new Response(stream));
    const result = f.adapter.invoke(input);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await result).toMatchObject({ state: "uncertain", reason: "invalid_response" });
  });
  it("does not lose a parsed acknowledgement to cleanup-only cancellation failure", async () => {
    vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel").mockRejectedValue(
      new Error("PRIVATE CLEANUP"),
    );
    const f = fixture();
    expect(await f.adapter.invoke(input)).toEqual({ state: "accepted", sessionId, status: 200 });
  });
});
