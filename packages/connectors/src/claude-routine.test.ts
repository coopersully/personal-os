import { fireClaudeRoutine } from "./claude-routine.js";

describe("Claude routine handoff", () => {
  const input = { routineId: "trig_12345678901", token: "secret", runId: crypto.randomUUID() };
  it("uses the fixed subscription endpoint and sends only a durable run identifier", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_12345678901" }),
    );
    expect(await fireClaudeRoutine(fetch, input)).toEqual({
      state: "started",
      hostSessionId: "session_12345678901",
      reason: null,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.anthropic.com/v1/claude_code/routines/trig_12345678901/fire",
    );
  });
  it("never retries uncertain transport or malformed success", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("lost");
    });
    expect((await fireClaudeRoutine(fetch, input)).state).toBe("uncertain");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await fireClaudeRoutine(async () => Response.json({}), input)).state).toBe("uncertain");
  });
  it("distinguishes definite rejection from unknown server failure", async () => {
    expect(
      (await fireClaudeRoutine(async () => new Response("", { status: 429 }), input)).reason,
    ).toBe("rate_limited");
    expect(
      (await fireClaudeRoutine(async () => new Response("", { status: 503 }), input)).state,
    ).toBe("uncertain");
  });
});
