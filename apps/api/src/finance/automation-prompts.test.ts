import { financeMaintenanceInputSchema } from "@personal-os/domain";
import {
  renderFinanceAutomationPrompt,
  renderFinanceHostInstructions,
} from "./automation-prompts.js";

describe("issued Finance automation prompts", () => {
  it("keeps each internal schedule identity in current supported maintenance instructions", () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    for (const hostSurface of ["codex_desktop", "claude_code_routine"] as const) {
      const a = renderFinanceHostInstructions({ id: first, hostSurface });
      const b = renderFinanceHostInstructions({ id: second, hostSurface });
      expect(a).toContain(first);
      expect(a).not.toContain(second);
      expect(b).toContain(second);
      expect(b).not.toContain(first);
      expect(a).toContain("maintain_finances");
      expect(a).toContain(
        "A budget proposal always requires the person to approve the exact displayed version",
      );
      expect(a).toContain("obtain the required owner approval");
      expect(a).toContain("not a credential");
      expect(a).not.toContain("send_finance_message");
    }
  });
});

it.each([
  "codex_desktop",
  "claude_code_routine",
] as const)("issues schema-valid maintenance commands and follows blocked recovery for %s", (hostSurface) => {
  const scheduleId = "11111111-1111-4111-8111-111111111111";
  const runId = "22222222-2222-4222-8222-222222222222";
  const continuationId = "33333333-3333-4333-8333-333333333333";
  const text = renderFinanceHostInstructions({ id: scheduleId, hostSurface });
  const commands = [...text.matchAll(/maintain_finances (\{[^}]+\})/g)].map((match) =>
    financeMaintenanceInputSchema.parse(
      JSON.parse(
        (match[1] ?? "")
          .replace("<returned run ID>", runId)
          .replace("<continuation ID>", continuationId),
      ),
    ),
  );
  expect(commands).toEqual([
    { operation: "continue", continuationId, automationScheduleId: scheduleId },
    { operation: "start", automationScheduleId: scheduleId, scope: { type: "all_outstanding" } },
    { operation: "resume", runId },
  ]);
  expect(text).toContain("If nextAction names get_finance_status, read its exact scope instead");
  expect(text).toContain("Do not repeatedly resume unchanged blocked work");
  expect(text).toContain("Never invent or rebind original-host authority");
  expect(text).not.toContain("then resume the returned run ID");
  expect(financeMaintenanceInputSchema.safeParse({ operation: "start", runId }).success).toBe(
    false,
  );
});

it("makes scheduled-only continuation latency and server-owned slots explicit", () => {
  const text = renderFinanceHostInstructions({
    id: "schedule",
    hostSurface: "claude_code_routine",
    trigger: { type: "scheduled", localTimes: ["08:00", "20:00"], timeZone: "America/New_York" },
  });
  expect(text).toContain("08:00 and 20:00 in America/New_York");
  expect(text).toContain("do not submit nextExpectedAt");
  expect(text).toContain("No API trigger or trigger bearer is required");
  expect(text).toContain("wait for the next scheduled invocation");
});

it("issues a stable fail-closed bootstrap that fetches current API-owned instructions every invocation", () => {
  const text = renderFinanceAutomationPrompt({ id: "schedule" });
  expect(text).toContain("load_finance_host_instructions");
  expect(text).toContain("acknowledge_finance_host_instructions");
  expect(text).toContain("do not use cached workflow instructions");
  expect(text).not.toContain("maintain_finances");
});

it("keeps maintained-month triage separate from historical counts and uses exact approval cards", () => {
  const text = renderFinanceHostInstructions({
    id: "11111111-1111-4111-8111-111111111111",
    hostSurface: "codex_desktop",
  });
  for (const required of [
    "get_finance_attention",
    "opening position",
    "historical",
    "budget_start_preview",
    "publish_finance_chat_card",
    "not owner approval",
    "one coherent question",
  ])
    expect(text).toContain(required);
});
