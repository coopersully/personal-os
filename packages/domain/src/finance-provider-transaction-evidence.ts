import { z } from "zod";

/** Exact native IDs only; provider identities and initialization choices are server-private. */
export const financeProviderTransactionEvidenceInputSchema = z.strictObject({
  transactionIds: z
    .array(z.uuid())
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type FinanceProviderTransactionEvidenceInput = z.infer<
  typeof financeProviderTransactionEvidenceInputSchema
>;
export const financeProviderTransactionEvidenceSchema = z.strictObject({
  observedAt: z.iso.datetime(),
  snapshotConsistency: z.literal("not_atomic"),
  coverage: z.enum(["complete", "partial", "conflict", "unavailable"]),
  reason: z.enum([
    "exhausted",
    "page_limit",
    "changed_total",
    "inconsistent_page",
    "duplicate_identity",
    "identity_mismatch",
    "not_initialized",
    "byte_limit",
    "aborted",
    "deadline",
    "provider_error",
    "invalid_response",
    "source_changed",
    "unsupported_source",
  ]),
  providerUpdatedAt: z.iso.datetime().nullable(),
  entries: z
    .array(
      z.strictObject({
        transactionId: z.uuid(),
        accountId: z.uuid(),
        transactionRevision: z.string().regex(/^[1-9][0-9]*$/),
        accountRevision: z.string().regex(/^[1-9][0-9]*$/),
        status: z.enum(["found", "missing", "unobserved", "conflict", "invalid_currency"]),
        sourceAmount: z.number().finite().nullable(),
        normalizedAmount: z.number().finite().nullable(),
        economicDirection: z.enum(["inflow", "outflow", "unknown"]).nullable(),
        currencyCode: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable(),
        date: z.iso.date().nullable(),
      }),
    )
    .max(20),
});
export type FinanceProviderTransactionEvidence = z.infer<
  typeof financeProviderTransactionEvidenceSchema
>;
