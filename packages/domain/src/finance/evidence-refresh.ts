import { z } from "zod";
import { financeMonthSchema } from "./budget.js";

export const prepareFinanceEvidenceRefreshInputSchema = z.strictObject({
  sourceRefs: z
    .array(
      z.strictObject({
        accountId: z.uuid(),
        expectedAccountRevision: z.string().regex(/^[1-9][0-9]*$/),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (refs) => new Set(refs.map((ref) => ref.accountId)).size === refs.length,
      "Include each account once.",
    ),
  period: financeMonthSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
});
export type PrepareFinanceEvidenceRefreshInput = z.infer<
  typeof prepareFinanceEvidenceRefreshInputSchema
>;
export const financeEvidenceRefreshSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(["accepted", "running", "completed", "blocked", "failed"]),
  period: financeMonthSchema,
  requestedAt: z.iso.datetime(),
  observedAt: z.iso.datetime(),
  sources: z
    .array(
      z.strictObject({
        accountId: z.uuid(),
        freshness: z.enum(["pending", "current", "blocked"]),
        coverage: z.enum(["complete", "missing"]),
        reason: z.enum([
          "none",
          "sync_pending",
          "source_unavailable",
          "source_changed",
          "coverage_missing",
          "manual_evidence_required",
          "authorization_revoked",
          "refresh_timeout",
        ]),
      }),
    )
    .max(20),
});

export type FinanceEvidenceRefresh = z.infer<typeof financeEvidenceRefreshSchema>;
