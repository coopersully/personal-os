export function monthlyAmount(amount: number, cadence: string): number | null {
  switch (cadence) {
    case "weekly":
      return (amount * 52) / 12;
    case "biweekly":
      return (amount * 26) / 12;
    case "semimonthly":
      return amount * 2;
    case "monthly":
      return amount;
    case "quarterly":
      return amount / 3;
    case "yearly":
      return amount / 12;
    // An irregular obligation has no dependable cadence. Reserve its full stated amount for each
    // planning month instead of silently treating it as no obligation.
    case "irregular":
      return amount;
    default:
      return null;
  }
}

function monthlyExpectedNetPay(
  amount: number | null | undefined,
  frequency: string | null | undefined,
) {
  if (amount == null) return null;
  switch (frequency) {
    case "weekly":
      return (amount * 52) / 12;
    case "biweekly":
      return (amount * 26) / 12;
    case "semimonthly":
      return amount * 2;
    case "monthly":
      return amount;
    case "annual":
    case "yearly":
      return amount / 12;
    case "irregular":
      return null;
    default:
      // Older profiles did not always record a cadence; retain the existing monthly interpretation.
      return amount;
  }
}

export function reliableMonthlyCapacity(input: {
  expectedNetPay: number | null | undefined;
  expectedNetPayFrequency?: string | null;
  grossAnnualIncome: number | null | undefined;
  observedMonthlyIncome: number | null;
  observedIncomeWindow?: { complete: boolean; days: number } | null;
  recurring: Array<{ amount: number; cadence: string }>;
}) {
  const observedMonthlyIncome = input.observedIncomeWindow?.complete
    ? input.observedMonthlyIncome
    : null;
  const income =
    observedMonthlyIncome ??
    monthlyExpectedNetPay(input.expectedNetPay, input.expectedNetPayFrequency) ??
    (input.grossAnnualIncome == null ? null : input.grossAnnualIncome / 12);
  const obligations = input.recurring.reduce(
    (sum, item) => sum + (monthlyAmount(item.amount, item.cadence) ?? 0),
    0,
  );
  return income === null ? null : income - obligations;
}
