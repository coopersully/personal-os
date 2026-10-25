import { renderFinanceAutomationPrompt } from "./automation-prompts.js";

describe("issued Finance automation prompts", () => {
  it("keeps each internal schedule identity in current supported maintenance instructions", () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    for (const hostSurface of ["codex_desktop", "claude_code_routine"] as const) {
      const a = renderFinanceAutomationPrompt({ id: first, hostSurface });
      const b = renderFinanceAutomationPrompt({ id: second, hostSurface });
      expect(a).toContain(first);
      expect(a).not.toContain(second);
      expect(b).toContain(second);
      expect(b).not.toContain(first);
      expect(a).toContain("maintain_finances");
      expect(a).toContain("including budgets, without individual approval");
      expect(a).toContain("Otherwise obtain the required owner approval");
      expect(a).toContain("not a credential");
      expect(a).not.toContain("send_finance_message");
    }
  });
});

it("makes scheduled-only continuation latency and server-owned slots explicit", () => {
  const text = renderFinanceAutomationPrompt({
    id: "schedule",
    hostSurface: "claude_code_routine",
    trigger: { type: "scheduled", localTimes: ["08:00", "20:00"], timeZone: "America/New_York" },
  });
  expect(text).toContain("08:00 and 20:00 in America/New_York");
  expect(text).toContain("do not submit nextExpectedAt");
  expect(text).toContain("No API trigger or trigger bearer is required");
  expect(text).toContain("wait for the next scheduled invocation");
});
