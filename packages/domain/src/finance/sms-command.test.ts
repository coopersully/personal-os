import { financeSmsAnswerCommandSchema } from "./workflow-contracts.js";

const command = {
  operationId: "00000000-0000-4000-8000-000000000001",
  inboundMessageId: "00000000-0000-4000-8000-000000000002",
  replyBindingId: "00000000-0000-4000-8000-000000000003",
  work: {
    id: "00000000-0000-4000-8000-000000000004",
    domain: "finances",
    kind: "question",
    revision: "1",
    actionRevision: "1",
  },
  text: "Lunch with a friend",
};

describe("internal Finance SMS command", () => {
  it("preserves both local provenance identities and canonicalizes the answer", () => {
    expect(
      financeSmsAnswerCommandSchema.parse({ ...command, text: "  Lunch with a friend  " }),
    ).toEqual(command);
  });
  it.each([
    "inboundMessageId",
    "replyBindingId",
    "operationId",
  ] as const)("rejects a provider identifier in %s", (key) => {
    expect(
      financeSmsAnswerCommandSchema.safeParse({ ...command, [key]: "SM-provider-id" }).success,
    ).toBe(false);
  });
  it("rejects serialized authority and blank or oversized answers", () => {
    for (const extra of [
      { verified: true },
      { source: { kind: "sms" } },
      { text: "  " },
      { text: "x".repeat(10_001) },
    ]) {
      expect(financeSmsAnswerCommandSchema.safeParse({ ...command, ...extra }).success).toBe(false);
    }
  });
});
