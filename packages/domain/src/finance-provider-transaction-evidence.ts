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

// Separate from the advisory reader: clients select native revisions, never source values or evidence.
const providerAdmissionRevision = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/u)
  .refine((value) => value.length < 19 || value <= "9223372036854775807");
export const financeProviderSourceAdmissionInputSchema = z.strictObject({
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[!-~]+$/u),
  targets: z
    .array(
      z.strictObject({
        transactionId: z.uuid(),
        expectedTransactionRevision: providerAdmissionRevision,
        expectedAccountRevision: providerAdmissionRevision,
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (targets) => new Set(targets.map((target) => target.transactionId)).size === targets.length,
    ),
});
export type FinanceProviderSourceAdmissionInput = z.infer<
  typeof financeProviderSourceAdmissionInputSchema
>;

/** Honest suboperation of the existing transaction action; source values never enter the request. */
export const financeProviderSourceActionInputSchema =
  financeProviderSourceAdmissionInputSchema.extend({ operation: z.literal("admit_source_facts") });
export const financeProviderSourceAdmissionResultSchema = z.strictObject({
  sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  observedAt: z.iso.datetime(),
  providerUpdatedAt: z.iso.datetime().nullable(),
  snapshotConsistency: z.literal("not_atomic"),
  entries: z
    .array(
      z.strictObject({
        transactionId: z.uuid(),
        accountId: z.uuid(),
        changed: z.boolean(),
        source: z.strictObject({
          amount: z
            .number()
            .finite()
            .refine((value) => value !== 0),
          currencyCode: z.string().regex(/^[A-Z]{3}$/u),
          date: z.iso.date(),
        }),
        before: z.strictObject({
          currencyCode: z.string().nullable(),
          providerDirection: z.enum(["income", "expense"]).nullable(),
          transactionRevision: providerAdmissionRevision,
        }),
        after: z.strictObject({
          currencyCode: z.string().regex(/^[A-Z]{3}$/u),
          providerDirection: z.enum(["income", "expense"]),
          transactionRevision: providerAdmissionRevision,
        }),
      }),
    )
    .min(1)
    .max(20),
});
export type FinanceProviderSourceAdmissionResult = z.infer<
  typeof financeProviderSourceAdmissionResultSchema
>;
