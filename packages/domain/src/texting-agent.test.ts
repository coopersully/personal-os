import {
  textingAgentCheckpointSchema,
  textingAgentReplySchema,
  textingAgentSettingsInputSchema,
} from "./texting-agent.js";

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
  it("requires workspace tags and reply references and bounds topic reply identity", () => {
    const input = {
      invocationId: crypto.randomUUID(),
      body: "Task updated",
      workspaces: ["tasks"],
      replyToMessageIds: [crypto.randomUUID()],
      replyKey: "tasks",
      final: false,
    };
    expect(textingAgentReplySchema.parse(input).final).toBe(false);
    expect(textingAgentReplySchema.safeParse({ ...input, workspaces: ["knowledge"] }).success).toBe(
      false,
    );
    expect(textingAgentReplySchema.safeParse({ ...input, replyToMessageIds: [] }).success).toBe(
      false,
    );
    expect(textingAgentReplySchema.safeParse({ ...input, workspaces: undefined }).success).toBe(
      false,
    );
    expect(textingAgentReplySchema.safeParse({ ...input, replyKey: "x".repeat(81) }).success).toBe(
      false,
    );
  });
});
