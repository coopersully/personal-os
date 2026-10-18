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
      expect(a).toContain("Never self-approve");
      expect(a).toContain("not a credential");
      expect(a).not.toContain("send_finance_message");
    }
  });
});
