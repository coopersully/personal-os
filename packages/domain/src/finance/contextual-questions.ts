import { z } from "zod";
import { idSchema } from "../common.js";
import {
  financeHumanWorkRefSchema,
  financeWorkflowUnavailableSchema,
} from "./workflow-contracts.js";

const counter = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((value) => value.length < 19 || value <= "9223372036854775807");
export const createFinanceContextualQuestionInputSchema = z
  .object({ operationId: idSchema })
  .strict();
export type CreateFinanceContextualQuestionInput = z.infer<
  typeof createFinanceContextualQuestionInputSchema
>;
export const financeContextualQuestionSchema = z
  .object({
    id: idSchema,
    reviewCaseId: idSchema,
    transactionId: idSchema,
    prompt: z.string().trim().min(1).max(1000),
    disclosure: z.literal("minimal"),
    status: z.enum(["open", "answered", "stale"]),
    work: financeHumanWorkRefSchema.extend({
      kind: z.literal("question"),
      revision: counter,
      actionRevision: counter,
    }),
    transaction: z
      .object({
        merchant: z.string().min(1).max(1000),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amountCents: z.number().int().safe(),
        currencyCode: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable(),
      })
      .strict(),
  })
  .strict()
  .refine((value) => value.id === value.work.id, {
    message: "The canonical work must identify this question.",
  });
export type FinanceContextualQuestion = z.infer<typeof financeContextualQuestionSchema>;
export const financeContextualQuestionResultSchema = z.union([
  z.object({ state: z.literal("available"), question: financeContextualQuestionSchema }).strict(),
  financeWorkflowUnavailableSchema,
]);
export type FinanceContextualQuestionResult = z.infer<typeof financeContextualQuestionResultSchema>;
