import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";

export const financeSnapshotSchema = z.object({
  accounts: z.object({
    current: z.number().int().nonnegative(),
    needingAttention: z.number().int().nonnegative(),
  }),
  asOf: isoDateTimeSchema,
  budget: z.object({
    activeVersionId: idSchema.nullable(),
    allocated: z.number().finite().nonnegative().nullable(),
    remaining: z.number().finite().nullable(),
    spent: z.number().finite().nonnegative().nullable(),
  }),
  cash: z.number().finite().nullable(),
  debt: z.number().finite().nullable(),
  inbox: z.object({
    awaitingInput: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
  }),
  investments: z.number().finite().nullable(),
  ledger: z.object({
    reconciledThrough: z.iso.date().nullable(),
    trustworthy: z.boolean(),
  }),
  netWorth: z.number().finite().nullable(),
});
export type FinanceSnapshot = z.infer<typeof financeSnapshotSchema>;

export const financeMaintenanceHistoryQuerySchema = z.object({
  cursor: z.string().min(1).max(600).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["agent_reasoning", "agent_audit", "settled", "failed"]).optional(),
});
export type FinanceMaintenanceHistoryQuery = z.infer<typeof financeMaintenanceHistoryQuerySchema>;
