import {
  agentAccountLinkSchema,
  agentAccountRegistrationSchema,
  agentAccountUpdateSchema,
  generatedAgentName,
} from "./agent-account.js";

it("generates a stable name without using email or mutable metadata", () => {
  const id = "f1000000-0000-4000-8000-000000000001";
  expect(generatedAgentName(id)).toBe(generatedAgentName(id));
  expect(generatedAgentName(id)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ 0001$/);
  expect(generatedAgentName(id.replace(/1$/, "2"))).not.toBe(generatedAgentName(id));
});
it("accepts only declared platform metadata in agent registration", () => {
  expect(agentAccountRegistrationSchema.parse({})).toEqual({});
  expect(agentAccountRegistrationSchema.parse({ platform: "claude" })).toEqual({
    platform: "claude",
  });
  for (const input of [
    { agentAccountId: "other" },
    { providerAccountId: "claimed" },
    { email: "private@example.test" },
    { platform: "invented" },
  ])
    expect(agentAccountRegistrationSchema.safeParse(input).success).toBe(false);
});
it("bounds editable metadata and explicit identity linking", () => {
  expect(agentAccountUpdateSchema.parse({ displayName: "  Finch  ", accountLabel: null })).toEqual({
    displayName: "Finch",
    accountLabel: null,
  });
  for (const input of [
    { displayName: " " },
    { displayName: "x".repeat(81) },
    { identitySource: "verified" },
    { userId: "another" },
  ])
    expect(agentAccountUpdateSchema.safeParse(input).success).toBe(false);
  expect(agentAccountLinkSchema.parse({ agentAccountId: null })).toEqual({ agentAccountId: null });
  expect(agentAccountLinkSchema.safeParse({ agentAccountId: "not-an-id" }).success).toBe(false);
});
