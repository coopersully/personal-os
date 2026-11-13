import type { FinancePlaybookEvidence, FinancePlaybookResponse } from "@personal-os/domain";
import { assessFinancePlaybook, PERSONAL_OS_FINANCE_PLAYBOOK } from "@personal-os/domain";
import type { createFinanceService } from "./finance-service.js";

type Finances = ReturnType<typeof createFinanceService>;

/**
 * Corroborating facts for the rubric. Each read is independent: a failed or absent
 * read leaves its checks unassessed and never blocks the profile-based assessment.
 */
async function readEvidence(finances: Finances, userId: string): Promise<FinancePlaybookEvidence> {
  const [budget, income] = await Promise.allSettled([
    (async () => finances.getFinanceBudgetStatus(userId))(),
    (async () => finances.getProfile(userId))(),
  ]);
  const evidence: FinancePlaybookEvidence = {};
  const planContext = budget.status === "fulfilled" ? budget.value.planContext : undefined;
  if (planContext) {
    evidence.currentMonthPlanApproved = planContext.current !== null;
    const plan = planContext.current ?? planContext.upcoming ?? planContext.previous;
    evidence.plannedMonthlySpending = plan?.spendingTotal ?? null;
  }
  if (income.status === "fulfilled" && income.value) {
    evidence.grossAnnualIncome = income.value.grossAnnualIncome ?? null;
    evidence.monthlyHousingCost = income.value.monthlyHousingCost ?? null;
  }
  return evidence;
}

export function createFinancePlaybookService({
  finances,
  now,
}: {
  finances: Finances;
  now: () => Date;
}) {
  return {
    async get(userId: string): Promise<FinancePlaybookResponse> {
      const profile = await finances.getFinancialProfile(userId);
      return {
        assessment: assessFinancePlaybook({
          evidence: await readEvidence(finances, userId),
          now: now().toISOString(),
          profile: profile.data
            ? {
                ...profile.data,
                reserveTargetMonths: profile.data.preferences.emergencyReserveMonths,
              }
            : null,
        }),
        playbook: PERSONAL_OS_FINANCE_PLAYBOOK,
      };
    },
  };
}
