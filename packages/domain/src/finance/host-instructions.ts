import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";

export const financeHostInstructionReceiptSchema = z
  .object({
    receiptId: idSchema,
    scheduleId: idSchema,
    authorizationConnectionId: idSchema,
    actorId: idSchema,
    operationId: idSchema,
    scheduleVersion: z.int().positive(),
    instructionVersion: z.int().positive(),
    text: z.string().min(1).max(20000),
    servedAt: isoDateTimeSchema,
    acknowledgedAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type FinanceHostInstructionReceipt = z.infer<typeof financeHostInstructionReceiptSchema>;
export type FinanceHostInstructionDelivery = FinanceHostInstructionReceipt & {
  pendingChallengeId: string | null;
};
export type FinanceHostInstructionSummary = {
  currentVersion: number;
  latestServed: Pick<
    FinanceHostInstructionReceipt,
    "receiptId" | "instructionVersion" | "scheduleVersion" | "servedAt" | "acknowledgedAt"
  > | null;
  latestAcknowledged: Pick<
    FinanceHostInstructionReceipt,
    "receiptId" | "instructionVersion" | "scheduleVersion" | "servedAt" | "acknowledgedAt"
  > | null;
  acknowledgementMeaning: "host_reported_adoption_not_proof_of_obedience";
};
