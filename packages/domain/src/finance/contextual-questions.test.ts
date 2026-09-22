import { randomUUID } from "node:crypto";
import {
  createFinanceContextualQuestionInputSchema,
  financeContextualQuestionSchema,
} from "./contextual-questions.js";

describe("contextual question boundaries", () => {
  it("does not accept client ownership, subtype, prompt or revision when creating work", () => {
    const operationId = randomUUID();
    expect(createFinanceContextualQuestionInputSchema.parse({ operationId })).toEqual({
      operationId,
    });
    for (const field of ["userId", "subtype", "prompt", "workRevision"])
      expect(
        createFinanceContextualQuestionInputSchema.safeParse({ operationId, [field]: "untrusted" })
          .success,
      ).toBe(false);
  });
  it("keeps exact bigint references as opaque strings and contextual completion separate", () => {
    const value = {
      id: randomUUID(),
      reviewCaseId: randomUUID(),
      transactionId: randomUUID(),
      prompt: "What was this transaction for?",
      status: "answered",
      work: {
        id: randomUUID(),
        domain: "finances",
        kind: "question",
        revision: "9223372036854775807",
        actionRevision: "1",
      },
      transaction: { merchant: "Lunch", date: "2026-09-21", amountCents: 1200, currencyCode: null },
      disclosure: "minimal",
    };
    value.work.id = value.id;
    expect(financeContextualQuestionSchema.parse(value)).toEqual(value);
    for (const revision of ["0", "-1", "01", "9223372036854775808", "2026-09-21", "sha256:abc"])
      expect(
        financeContextualQuestionSchema.safeParse({ ...value, work: { ...value.work, revision } })
          .success,
      ).toBe(false);
    expect(
      financeContextualQuestionSchema.safeParse({ ...value, status: "financially_resolved" })
        .success,
    ).toBe(false);
    expect(
      financeContextualQuestionSchema.safeParse({
        ...value,
        work: { ...value.work, id: randomUUID() },
      }).success,
    ).toBe(false);
  });
});
