import type {
  FinanceAccountKind,
  FinanceDataConfidence,
  FinanceHealth,
  FinanceHealthDimensionKey,
  FinanceProvider,
  TransactionDirection,
} from "@personal-os/domain";

export const defaultFinanceHealthPolicy = {
  budgetOffTrackForecastRatio: 1.15,
  budgetWatchForecastRatio: 1.05,
  emergencyReserveTargetMonths: 3,
  staleAfterHours: 24,
} as const;

export type FinanceHealthInput = {
  accounts: Array<{
    balance: number | null;
    kind: FinanceAccountKind;
    lastSuccessAt: string | null;
    provider: FinanceProvider;
    synchronizationState: "blocked" | "current" | "retrying" | "stale";
  }>;
  activeGoalCount: number;
  approvedBudget: number | null;
  forecastSpending: number | null;
  investmentAllocationKnown: boolean;
  monthlyIncome: number | null;
  postedTransactions: Array<{
    amount: number;
    direction: TransactionDirection;
    pending: boolean;
  }>;
  profile?: {
    budgetOffTrackForecastRatio?: number;
    budgetWatchForecastRatio?: number;
    emergencyReserveTargetMonths?: number;
  } | null;
  totalDebt: number | null;
  unknownDebtAprCount: number;
};

function dimension(
  rating: FinanceHealth["dimensions"][FinanceHealthDimensionKey]["rating"],
  evidence: FinanceHealth["dimensions"][FinanceHealthDimensionKey]["evidence"],
  missingInputs: string[],
  nextAction: string | null,
): FinanceHealth["dimensions"][FinanceHealthDimensionKey] {
  return { evidence, missingInputs, nextAction, rating, trend: "unknown" };
}

export function assessFinanceHealth(input: FinanceHealthInput, now: Date): FinanceHealth {
  const plaidAccounts = input.accounts.filter((account) => account.provider === "plaid");
  const usableAccounts = input.accounts.filter(
    (account) => account.synchronizationState !== "blocked" && account.balance !== null,
  );
  const allPlaidBlocked =
    plaidAccounts.length > 0 &&
    plaidAccounts.every((account) => account.synchronizationState === "blocked");
  const staleCutoff = now.getTime() - defaultFinanceHealthPolicy.staleAfterHours * 60 * 60 * 1_000;
  const staleAccounts = input.accounts.filter(
    (account) =>
      account.synchronizationState !== "current" ||
      (account.provider === "plaid" &&
        (account.lastSuccessAt === null ||
          new Date(account.lastSuccessAt).getTime() < staleCutoff)),
  );
  let confidence: FinanceDataConfidence = "reliable";
  if (input.accounts.length === 0 || usableAccounts.length === 0 || allPlaidBlocked) {
    confidence = "insufficient";
  } else if (staleAccounts.length > 0 || usableAccounts.length < input.accounts.length) {
    confidence = "provisional";
  }

  const confidenceEvidence = [
    `${input.accounts.length} account(s) tracked`,
    `${usableAccounts.length} account(s) have usable balances`,
    `${staleAccounts.length} account(s) are not current`,
  ];
  const missingInputs: string[] = [];
  if (input.accounts.length === 0) missingInputs.push("accounts");
  if (confidence === "insufficient") missingInputs.push("current_account_evidence");
  if (input.approvedBudget === null) missingInputs.push("approved_budget");
  if (input.monthlyIncome === null) missingInputs.push("monthly_income");

  const postedSpending = input.postedTransactions
    .filter((transaction) => !transaction.pending && transaction.direction === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const forecast = input.forecastSpending;
  const watchRatio =
    input.profile?.budgetWatchForecastRatio ?? defaultFinanceHealthPolicy.budgetWatchForecastRatio;
  const offTrackRatio =
    input.profile?.budgetOffTrackForecastRatio ??
    defaultFinanceHealthPolicy.budgetOffTrackForecastRatio;
  const assessmentSpending = forecast ?? postedSpending;
  const ratio =
    input.approvedBudget !== null && input.approvedBudget > 0
      ? assessmentSpending / input.approvedBudget
      : null;
  const monthRating =
    confidence === "insufficient" || input.approvedBudget === null || ratio === null
      ? "unknown"
      : ratio >= offTrackRatio
        ? "off_track"
        : ratio >= watchRatio
          ? "watch"
          : "on_track";

  const cash = usableAccounts
    .filter((account) => account.kind === "cash")
    .reduce((sum, account) => sum + (account.balance ?? 0), 0);
  const reserveTarget =
    input.profile?.emergencyReserveTargetMonths ??
    defaultFinanceHealthPolicy.emergencyReserveTargetMonths;
  const reserveMonths =
    input.monthlyIncome !== null && input.monthlyIncome > 0 ? cash / input.monthlyIncome : null;
  const debtAprMissing = input.unknownDebtAprCount > 0;
  const dimensions: FinanceHealth["dimensions"] = {
    borrow: dimension(
      debtAprMissing ? "unknown" : (input.totalDebt ?? 0) > 0 ? "watch" : "healthy",
      [{ label: "Total debt", source: "accounts", value: input.totalDebt }],
      debtAprMissing ? ["debt_apr"] : [],
      debtAprMissing ? "Add APR evidence before assessing borrowing health." : null,
    ),
    goals: dimension(
      input.activeGoalCount > 0 ? "healthy" : "unknown",
      [{ label: "Active goals", source: "goals", value: input.activeGoalCount }],
      input.activeGoalCount > 0 ? [] : ["active_goals"],
      input.activeGoalCount > 0 ? null : "Add an active financial goal.",
    ),
    invest: dimension(
      input.investmentAllocationKnown ? "healthy" : "unknown",
      [
        {
          label: "Allocation visible",
          source: "accounts",
          value: input.investmentAllocationKnown ? "yes" : "unknown",
        },
      ],
      input.investmentAllocationKnown ? [] : ["investment_allocation"],
      input.investmentAllocationKnown
        ? null
        : "Provide allocation evidence before assessing investments.",
    ),
    plan: dimension(
      input.approvedBudget === null
        ? "unknown"
        : monthRating === "off_track"
          ? "needs_attention"
          : monthRating === "watch"
            ? "watch"
            : "healthy",
      [{ label: "Approved budget", source: "budget", value: input.approvedBudget }],
      input.approvedBudget === null ? ["approved_budget"] : [],
      input.approvedBudget === null ? "Approve a monthly budget." : null,
    ),
    save: dimension(
      reserveMonths === null ? "unknown" : reserveMonths >= reserveTarget ? "healthy" : "watch",
      [{ label: "Emergency reserve months", source: "accounts_and_income", value: reserveMonths }],
      reserveMonths === null ? ["monthly_income_or_cash_balance"] : [],
      reserveMonths !== null && reserveMonths < reserveTarget
        ? `Build liquid reserves toward ${reserveTarget} months.`
        : null,
    ),
    spend: dimension(
      monthRating === "unknown"
        ? "unknown"
        : monthRating === "off_track"
          ? "needs_attention"
          : monthRating === "watch"
            ? "watch"
            : "healthy",
      [{ label: "Forecast-to-budget ratio", source: "budget_and_ledger", value: ratio }],
      monthRating === "unknown" ? ["reliable_budget_and_ledger"] : [],
      monthRating === "off_track" ? "Review forecast spending against the approved budget." : null,
    ),
  };

  return {
    confidence,
    confidenceEvidence,
    dimensions,
    missingInputs: [...new Set(missingInputs)],
    month: {
      approvedBudget: input.approvedBudget,
      forecastSpending: confidence === "insufficient" ? null : forecast,
      postedSpending: confidence === "insufficient" ? null : postedSpending,
      rating: monthRating,
    },
  };
}
