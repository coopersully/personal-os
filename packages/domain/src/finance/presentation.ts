import { z } from "zod";
import { isoDateTimeSchema } from "../common.js";

export const financePresentationResourceKinds = [
  "finance_snapshot",
  "finance_budget",
  "finance_review",
  "finance_period_verification",
] as const;

export const financePresentationKindSchema = z.enum(financePresentationResourceKinds);
export type FinancePresentationKind = z.infer<typeof financePresentationKindSchema>;

const financePresentationScalarSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const financePresentationDiagnosticFactSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    value: financePresentationScalarSchema,
  })
  .strict();

const financePresentationDestinationSchema = z
  .object({
    href: z.string().startsWith("/").max(2_000),
    label: z.string().trim().min(1).max(120),
  })
  .strict();

const financePresentationBaseSchema = z.object({
  destination: financePresentationDestinationSchema.nullable(),
  diagnosticFacts: z.array(financePresentationDiagnosticFactSchema).max(50).default([]),
  disclosures: z
    .array(
      z
        .object({
          importance: z.enum(["critical", "important"]),
          message: z.string().trim().min(1).max(2_000),
        })
        .strict(),
    )
    .max(20),
  eyebrow: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1_000),
  title: z.string().trim().min(1).max(240),
});

export const financePresentationSchema = z.discriminatedUnion("kind", [
  financePresentationBaseSchema
    .extend({
      asOf: isoDateTimeSchema,
      kind: z.literal("finance_snapshot"),
      position: z
        .object({
          cash: z.number().finite().nullable(),
          debt: z.number().finite().nullable(),
          investments: z.number().finite().nullable(),
          netWorth: z.number().finite().nullable(),
        })
        .strict(),
      trust: z
        .object({
          gaps: z.array(z.string().trim().min(1).max(500)).max(50),
          state: z.enum(["current", "partial", "stale", "unavailable"]),
          trustworthy: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  financePresentationBaseSchema
    .extend({
      allocations: z
        .array(
          z
            .object({
              amount: z.number().finite().nonnegative(),
              description: z.string().trim().min(1).max(500).nullable(),
              key: z.string().trim().min(1).max(120),
              kind: z.enum(["buffer", "debt", "goal", "savings", "spending"]),
            })
            .strict(),
        )
        .max(500),
      assumptions: z.array(z.string().trim().min(1).max(1_000)).max(100),
      balance: z.number().finite(),
      expectedResources: z.number().finite().nonnegative(),
      kind: z.literal("finance_budget"),
      status: z.enum(["incomplete", "proposed", "active", "retired"]),
      totalAllocated: z.number().finite().nonnegative(),
    })
    .strict(),
  financePresentationBaseSchema
    .extend({
      evidenceCount: z.number().int().nonnegative(),
      impactAmount: z.number().finite().nonnegative().nullable(),
      kind: z.literal("finance_review"),
      prompt: z.string().trim().min(1).max(1_000),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
  financePresentationBaseSchema
    .extend({
      cutoff: isoDateTimeSchema,
      kind: z.literal("finance_period_verification"),
      period: z.object({ end: z.iso.date(), start: z.iso.date() }).strict(),
      recommendations: z
        .array(
          z
            .object({
              disposition: z.enum(["monitor", "needs_input", "ready"]),
              recommendation: z.string().trim().min(1).max(1_000),
            })
            .strict(),
        )
        .max(25),
      status: z.enum(["completed", "completed_with_questions"]),
      work: z
        .object({
          approvals: z.number().int().nonnegative(),
          exceptions: z.number().int().nonnegative(),
          questions: z.number().int().nonnegative(),
          rulesAndActions: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
]);

export type FinancePresentation = z.infer<typeof financePresentationSchema>;
