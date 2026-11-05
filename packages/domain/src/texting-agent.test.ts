import { textingAgentCheckpointSchema, textingAgentSettingsInputSchema } from "./texting-agent.js";

describe("Texting agent contracts", () => {
  it("requires explicit subscription-only confirmation to enable", () => {
    const scheduleId = crypto.randomUUID();
    expect(
      textingAgentSettingsInputSchema.safeParse({ scheduleId, subscriptionOnlyConfirmed: false })
        .success,
    ).toBe(false);
    expect(
      textingAgentSettingsInputSchema.parse({ scheduleId, subscriptionOnlyConfirmed: true })
        .scheduleId,
    ).toBe(scheduleId);
    expect(textingAgentSettingsInputSchema.parse({ scheduleId: null }).scheduleId).toBeNull();
  });
  it("bounds work and preserves uncertain outcomes", () => {
    const input = {
      invocationId: crypto.randomUUID(),
      work: [
        {
          domain: "mail",
          key: "reply",
          state: "uncertain",
          note: "Inspect sent mail before retrying.",
          references: [],
        },
      ],
    };
    expect(textingAgentCheckpointSchema.parse(input).work[0]?.state).toBe("uncertain");
    expect(
      textingAgentCheckpointSchema.safeParse({ ...input, work: Array(21).fill(input.work[0]) })
        .success,
    ).toBe(false);
    expect(
      textingAgentCheckpointSchema.safeParse({ ...input, authorization: "full" }).success,
    ).toBe(false);
  });
});
