import { createAccessTokenInputSchema } from "./auth.js";
import {
  normalizeTextingPhoneNumber,
  parseTextReply,
  sendTextMessageInputSchema,
  textConversationQuerySchema,
} from "./texting.js";

describe("texting contracts", () => {
  it("normalizes US and Canadian NANP numbers", () => {
    expect(normalizeTextingPhoneNumber({ country: "US", phoneNumber: "(212) 555-0123" })).toEqual({
      country: "US",
      e164: "+12125550123",
      lastFour: "0123",
    });
    expect(normalizeTextingPhoneNumber({ country: "CA", phoneNumber: "+1 416 555 0123" })).toEqual({
      country: "CA",
      e164: "+14165550123",
      lastFour: "0123",
    });
    expect(() =>
      normalizeTextingPhoneNumber({ country: "US", phoneNumber: "+44 20 7183 8750" }),
    ).toThrow("US or Canadian");
  });

  it("requires read scope with texting write scope", () => {
    expect(() =>
      createAccessTokenInputSchema.parse({ name: "SMS agent", scopes: ["texting:write"] }),
    ).toThrow("texting:read");
  });

  it("bounds conversation and send inputs", () => {
    expect(textConversationQuerySchema.parse({})).toEqual({ limit: 100 });
    expect(() =>
      textConversationQuerySchema.parse({ afterCursor: "a", beforeCursor: "b" }),
    ).toThrow();
    expect(
      sendTextMessageInputSchema.parse({ body: "Done.", conversationReceipt: "receipt" }),
    ).toMatchObject({ body: "Done.", contentKind: "concise" });
    expect(() =>
      sendTextMessageInputSchema.parse({
        body: "Done.",
        conversationReceipt: "receipt",
        seriesTotal: 4,
      }),
    ).toThrow();
  });

  it("parses exact free-text answers without changing internal whitespace or punctuation", () => {
    const free = {
      id: "a",
      itemNumber: 1,
      answerMode: "free_text" as const,
      answerVocabulary: null,
    };
    expect(parseTextReply("  Dinner with Sam; reimbursable,\n50%  ", [free])).toEqual({
      state: "matched",
      choices: [{ bindingId: "a", answer: "Dinner with Sam; reimbursable,\n50%" }],
    });
    expect(
      parseTextReply("1: Dinner, team\n---\n2: Taxi; client", [
        free,
        { ...free, id: "b", itemNumber: 2 },
      ]),
    ).toEqual({
      state: "matched",
      choices: [
        { bindingId: "a", answer: "Dinner, team" },
        { bindingId: "b", answer: "Taxi; client" },
      ],
    });
    expect(
      parseTextReply("1: Dinner\n---\n1: Taxi", [free, { ...free, id: "b", itemNumber: 2 }]),
    ).toEqual({
      state: "unavailable",
      reason: "ambiguous",
    });
    expect(parseTextReply("Dinner", [free, { ...free, id: "b", itemNumber: 2 }])).toEqual({
      state: "unavailable",
      reason: "ambiguous",
    });
    expect(
      parseTextReply("1: Dinner\n---\nother text", [free, { ...free, id: "b", itemNumber: 2 }]),
    ).toEqual({
      state: "unavailable",
      reason: "ambiguous",
    });
    expect(
      parseTextReply("1: Dinner; 2: Taxi", [free, { ...free, id: "b", itemNumber: 2 }]),
    ).toEqual({
      state: "unavailable",
      reason: "ambiguous",
    });
    expect(parseTextReply("  ", [free])).toEqual({ state: "unavailable", reason: "unsupported" });
    expect(parseTextReply("x".repeat(10_001), [free])).toEqual({
      state: "unavailable",
      reason: "unsupported",
    });
  });

  it("requires explicit distinct numbers and vocabulary for multiple choices", () => {
    const choices = [
      { id: "a", itemNumber: 1, answerMode: "choices" as const, answerVocabulary: ["yes", "no"] },
      { id: "b", itemNumber: 2, answerMode: "choices" as const, answerVocabulary: ["yes", "no"] },
    ];
    expect(parseTextReply("1 yes, 2 no", choices)).toEqual({
      state: "matched",
      choices: [
        { bindingId: "a", answer: "yes" },
        { bindingId: "b", answer: "no" },
      ],
    });
    expect(parseTextReply(" 1: yes  ;  2 no ", choices)).toEqual({
      state: "matched",
      choices: [
        { bindingId: "a", answer: "yes" },
        { bindingId: "b", answer: "no" },
      ],
    });
    expect(parseTextReply("yes", choices)).toEqual({ state: "unavailable", reason: "ambiguous" });
    expect(parseTextReply("1 yes, 1 no", choices)).toEqual({
      state: "unavailable",
      reason: "ambiguous",
    });
    expect(parseTextReply("3 yes", choices)).toEqual({ state: "unavailable", reason: "ambiguous" });
    const remaining = choices[1];
    if (!remaining) throw new Error("Missing second choice fixture");
    expect(parseTextReply("2: yes", [remaining])).toEqual({
      state: "matched",
      choices: [{ bindingId: "b", answer: "yes" }],
    });
    expect(parseTextReply("1: yes", [remaining])).toEqual({
      state: "unavailable",
      reason: "ambiguous",
    });
  });

  it("rejects an overlong choice reply without stalling on separator-free whitespace", () => {
    const choices = [
      { id: "a", itemNumber: 1, answerMode: "choices" as const, answerVocabulary: ["yes"] },
      { id: "b", itemNumber: 2, answerMode: "choices" as const, answerVocabulary: ["no"] },
    ];
    expect(parseTextReply(`1 yes${" ".repeat(50_000)}x`, choices)).toEqual({
      state: "unavailable",
      reason: "unsupported",
    });
  }, 2_000);
});
