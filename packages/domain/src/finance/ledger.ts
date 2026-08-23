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
    classifications: z.array(
      z.object({
        categoryId: idSchema,
        confidence: z.number().min(0).max(1),
        meaning: z.string().trim().min(1).max(500),
        rationale: z.string().trim().min(1).max(1_000),
        transactionId: idSchema,
      }),
    ),
  })
  .and(financeMutationMetaSchema);

export const linkFinanceTransactionsInputSchema = z
  .object({
    rationale: z.string().trim().min(1).max(1_000),
    relationship: z.enum(["transfer", "reimbursement", "refund", "reversal", "duplicate"]),
    transactionIds: z.array(idSchema).min(2).max(100),
  })
  .and(financeMutationMetaSchema);

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

export const financeAccountConnectionSchema = z.object({
  accountIds: z.array(idSchema),
  externalHandoff: z
    .object({
      expiresAt: isoDateTimeSchema.nullable(),
      provider: z.string().min(1).max(120),
      url: z.url(),
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
