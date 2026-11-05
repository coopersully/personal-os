import { textingAgentNoticeBody } from "./texting-agent-notices.js";

const now = new Date("2026-11-05T16:00:00Z");
const run = (state: string, reason: string | null = null, age = 0) => ({
  state,
  reason,
  updatedAt: new Date(now.getTime() - age),
});

describe("SMS handoff notice policy", () => {
  it("distinguishes definite rejection, rate limit and uncertain acceptance", () => {
    expect(textingAgentNoticeBody(run("blocked", "host_rejected"), now)).toContain(
      "couldn't start",
    );
    expect(textingAgentNoticeBody(run("blocked", "rate_limited"), now)).toContain("usage limit");
    expect(textingAgentNoticeBody(run("uncertain", "host_uncertain"), now)).toContain(
      "couldn't confirm",
    );
  });
  it("waits five minutes before a delayed response notice and never claims work failed", () => {
    expect(textingAgentNoticeBody(run("running", null, 299_999), now)).toBeNull();
    expect(textingAgentNoticeBody(run("running", null, 300_000), now)).toContain("hasn't finished");
    expect(textingAgentNoticeBody(run("submitting", null, 300_000), now)).toContain(
      "couldn't confirm",
    );
  });
  it("does not announce completed, closed, retried or intentionally deferred runs", () => {
    for (const value of [
      run("completed"),
      run("blocked", "human_closed"),
      run("blocked", "retry_requested"),
      run("blocked", "shutdown_deferred"),
      run("blocked", "authority_changed"),
    ])
      expect(textingAgentNoticeBody(value, now)).toBeNull();
  });
});
