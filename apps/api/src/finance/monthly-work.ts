import { type Database, financeBudgetStartPolicies } from "@personal-os/database";
import { financeMonthlyWorkSchema } from "@personal-os/domain";
import { desc, eq } from "drizzle-orm";
import { readFinanceAttentionSnapshot } from "./attention-read.js";
import { readBudgetPlanContext } from "./budget-plan-projection.js";

/** A fresh monthly assessment never rewrites a historical run or its approval scope. */
export async function readFinanceMonthlyWork(db: Database, userId: string, at: Date) {
  return db.transaction(
    async (tx) => {
      const policy = await tx.query.financeBudgetStartPolicies.findFirst({
        where: eq(financeBudgetStartPolicies.userId, userId),
        orderBy: desc(financeBudgetStartPolicies.revision),
      });
      if (!policy?.firstMonth) return null;
      const attention = await readFinanceAttentionSnapshot(db, userId, at, tx);
      const budget = await readBudgetPlanContext(tx, userId, at);
      const monthStart = new Date(`${budget.month}-01T00:00:00Z`);
      const lastDay = new Date(
        Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
      ).getUTCDate();
      return financeMonthlyWorkSchema.parse({
        period: budget.month,
        enabled: policy.firstMonth <= budget.month,
        scope: { type: "window", start: `${budget.month}-01`, end: `${budget.month}-${lastDay}` },
        carryover: "none",
        attention,
        budget,
        guidance: [
          "Continue independently qualified current-month work even when an older aggregate run is blocked. Its scope and approvals do not change.",
          "Use the current month window for discovery, plus every unresolved active-period item and exact dependency in attention. A date window alone is not the active inbox.",
          "If this month has no approved budget, reuse its existing proposal or prepare one through the existing budget tools. If inputsCurrent is false, preserve the old approval but revise the proposal using current material inputs; an approval alone is not budget readiness. Use the previous approved allocations only as a template, with current income, bills and source evidence; ask one precise question for a material unknown.",
          "Carryover is none: do not add prior unspent allocations or unreceived income to spendable cash. Opening balances, expected resources and allocations are distinct.",
          "Read get_finance_budget for the target month before constructing a proposal, and pass its planningInputs fingerprint as expectedInputFingerprint on create/revise. Present the exact saved budget version in Finance Chat for owner approval. Recheck revisions and approved rules before applying any separate financial decision.",
          "After every committed batch reread attention. Keep historical unresolved counts, current human decisions, processing and technical blockers separate; incomplete assessment is never zero work.",
        ],
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
