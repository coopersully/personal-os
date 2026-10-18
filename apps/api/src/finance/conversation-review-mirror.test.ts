import type { FinanceTransaction } from "./context.js";
import { mirrorAcceptedMaintenanceReviewAnswer } from "./conversation-review-mirror.js";

it("never turns agent settlement or a mismatched owner into a human answer", async () => {
  const input = {
    userId: "owner",
    actorId: "agent",
    actorType: "agent" as const,
    caseId: "case",
    transactionId: "transaction",
    requestId: "request",
    operationId: "operation",
    text: "Automated settlement is not an answer",
    recordedAt: new Date(),
  };
  expect(await mirrorAcceptedMaintenanceReviewAnswer({} as FinanceTransaction, input)).toBeNull();
  expect(
    await mirrorAcceptedMaintenanceReviewAnswer({} as FinanceTransaction, {
      ...input,
      actorType: "user",
      actorId: "other-owner",
    }),
  ).toBeNull();
});
