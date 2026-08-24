import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { financeMutationMetaSchema, financeProvenanceSchema } from "./common.js";

export const financeEconomicEventKindSchema = z.enum([
  "purchase",
  "income",
  "transfer",
  "reimbursement",
  "refund",
  "reversal",
  "duplicate",
  "split",
  "other",
]);

export const financeEconomicEventSchema = z.object({
  createdAt: isoDateTimeSchema,
  id: idSchema,
  kind: financeEconomicEventKindSchema,
  stableKey: z.string().trim().min(1).max(500),
  updatedAt: isoDateTimeSchema,
  userId: idSchema,
});
export type FinanceEconomicEvent = z.infer<typeof financeEconomicEventSchema>;

export const financeTransactionRelationshipSchema = z.object({
  createdAt: isoDateTimeSchema,
  eventId: idSchema,
  id: idSchema,
  provenance: financeProvenanceSchema,
  rationale: z.string().trim().min(1).max(1_000),
  relationship: z.enum(["transfer", "reimbursement", "refund", "reversal", "duplicate", "split"]),
  transactionIds: z.array(idSchema).min(2).max(100),
});
export type FinanceTransactionRelationship = z.infer<typeof financeTransactionRelationshipSchema>;

export const financeTransactionRevisionSchema = z.object({
  changes: z.record(z.string(), z.unknown()),
  createdAt: isoDateTimeSchema,
  id: idSchema,
  provenance: financeProvenanceSchema,
  transactionId: idSchema,
  version: z.number().int().positive(),
});
export type FinanceTransactionRevision = z.infer<typeof financeTransactionRevisionSchema>;

export const financeClassificationSchema = z.object({
  categoryId: idSchema,
  confidence: z.number().min(0).max(1),
  meaning: z.string().trim().min(1).max(500),
  provenance: financeProvenanceSchema,
  rationale: z.string().trim().min(1).max(1_000),
  transactionId: idSchema,
});
export type FinanceClassification = z.infer<typeof financeClassificationSchema>;

export const classifyFinanceTransactionsInputSchema = z
  .object({
    classifications: z
      .array(
        z.object({
          categoryId: idSchema,
          confidence: z.number().min(0).max(1),
          meaning: z.string().trim().min(1).max(500),
          rationale: z.string().trim().min(1).max(1_000),
          transactionId: idSchema,
        }),
      )
      .min(1)
      .max(100),
  })
  .and(financeMutationMetaSchema);
export type ClassifyFinanceTransactionsInput = z.infer<
  typeof classifyFinanceTransactionsInputSchema
>;

export const linkFinanceTransactionsInputSchema = z
  .object({
    rationale: z.string().trim().min(1).max(1_000),
    relationship: z.enum(["transfer", "reimbursement", "refund", "reversal", "duplicate"]),
    transactionIds: z.array(idSchema).min(2).max(100),
  })
  .and(financeMutationMetaSchema);
export type LinkFinanceTransactionsInput = z.infer<typeof linkFinanceTransactionsInputSchema>;

export const splitFinanceTransactionInputSchema = z
  .object({
    parts: z
      .array(
        z.object({
          amount: z.number().finite().positive(),
          categoryId: idSchema,
          meaning: z.string().trim().min(1).max(500),
          notes: z.string().trim().max(4_000).nullable(),
        }),
      )
      .min(2)
      .max(100),
    transactionId: idSchema,
  })
  .and(financeMutationMetaSchema.required({ expectedVersion: true }));
export type SplitFinanceTransactionInput = z.infer<typeof splitFinanceTransactionInputSchema>;

export const startFinanceAccountConnectionInputSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  provider: z.literal("plaid"),
});
export type StartFinanceAccountConnectionInput = z.infer<
  typeof startFinanceAccountConnectionInputSchema
>;

export const updateFinanceAccountInputSchema = z
  .object({
    balance: z.number().finite().nullable().optional(),
    institution: z.string().trim().min(1).max(160).optional(),
    kind: z.enum(["cash", "investment", "debt", "other"]).optional(),
    name: z.string().trim().min(1).max(160).optional(),
  })
  .and(financeMutationMetaSchema);
export type UpdateFinanceAccountInput = z.infer<typeof updateFinanceAccountInputSchema>;

export const disconnectFinanceAccountInputSchema = financeMutationMetaSchema.pick({
  idempotencyKey: true,
});
export type DisconnectFinanceAccountInput = z.infer<typeof disconnectFinanceAccountInputSchema>;

export const removeFinanceTransactionInputSchema = financeMutationMetaSchema.pick({
  idempotencyKey: true,
});
export type RemoveFinanceTransactionInput = z.infer<typeof removeFinanceTransactionInputSchema>;

export const financeRuleSchema = z.object({
  category: z.string().trim().min(1).max(80),
  createdAt: isoDateTimeSchema,
  id: idSchema,
  merchant: z.string().trim().min(1).max(240),
  updatedAt: isoDateTimeSchema,
});
export type FinanceRule = z.infer<typeof financeRuleSchema>;

const financeRuleMutationKeySchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
});
export const manageFinanceRuleInputSchema = z.union([
  financeRuleMutationKeySchema.extend({
    category: z.string().trim().min(1).max(80),
    merchant: z.string().trim().min(1).max(240),
    operation: z.literal("create"),
  }),
  financeRuleMutationKeySchema
    .extend({
      category: z.string().trim().min(1).max(80).optional(),
      merchant: z.string().trim().min(1).max(240).optional(),
      operation: z.literal("update"),
      ruleId: idSchema,
    })
    .refine((input) => input.category !== undefined || input.merchant !== undefined, {
      message: "Provide a category or merchant to update.",
    }),
  financeRuleMutationKeySchema.extend({
    operation: z.literal("remove"),
    ruleId: idSchema,
  }),
]);
export type ManageFinanceRuleInput = z.infer<typeof manageFinanceRuleInputSchema>;

export const manageFinanceRecurringItemInputSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  itemId: idSchema,
  itemType: z.enum(["income", "obligation"]),
  operation: z.enum(["pause", "resume", "cancel"]),
});
export type ManageFinanceRecurringItemInput = z.infer<typeof manageFinanceRecurringItemInputSchema>;

export const financeAccountConnectionSchema = z.object({
  accountIds: z.array(idSchema),
  externalHandoff: z
    .object({
      artifact: z.string().trim().min(1).max(4_000),
      expiresAt: isoDateTimeSchema.nullable(),
      provider: z.string().min(1).max(120),
    })
    .nullable(),
  id: idSchema,
  lastError: z
    .object({
      code: z.string().min(1).max(120),
      message: z.string().min(1).max(2_000),
      retryable: z.boolean(),
    })
    .nullable(),
  provider: z.string().min(1).max(120),
  status: z.enum(["pending", "connected", "needs_reauth", "failed", "disconnected"]),
  updatedAt: isoDateTimeSchema,
});
export type FinanceAccountConnection = z.infer<typeof financeAccountConnectionSchema>;
