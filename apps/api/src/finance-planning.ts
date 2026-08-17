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
    default:
      return null;
  }
}

export function reliableMonthlyCapacity(input: {
  expectedNetPay: number | null | undefined;
  grossAnnualIncome: number | null | undefined;
  observedMonthlyIncome: number | null;
  recurring: Array<{ amount: number; cadence: string }>;
}) {
  const income =
    input.observedMonthlyIncome ??
    input.expectedNetPay ??
    (input.grossAnnualIncome == null ? null : input.grossAnnualIncome / 12);
  const obligations = input.recurring.reduce(
    (sum, item) => sum + (monthlyAmount(item.amount, item.cadence) ?? 0),
    0,
  );
  return income === null ? null : income - obligations;
}
