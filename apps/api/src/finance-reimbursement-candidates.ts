export type ReimbursementCreditCandidate = {
  matchedAmount: number;
  remainingAmount: number;
  transactionId: string;
};

/** One conservative selector for list, status, and maintenance. */
export function selectPlausibleReimbursementCredits(input: {
  credits: Array<{
    amount: number;
    category: string | null;
    date: string;
    id: string;
    merchant: string;
    pending: boolean;
  }>;
  matches: Array<{ amount: number; creditTransactionId: string }>;
  reimbursements: Array<{
    createdAt: Date;
    dueDate: string | null;
    expectedAmount: number;
    payer: string | null;
    receivedAmount: number;
    status: string;
  }>;
}): ReimbursementCreditCandidate[] {
  const matched = new Map<string, number>();
  for (const match of input.matches)
    matched.set(
      match.creditTransactionId,
      (matched.get(match.creditTransactionId) ?? 0) + match.amount,
    );
  const open = input.reimbursements.filter(
    (item) =>
      item.status !== "cancelled" &&
      item.status !== "received" &&
      item.expectedAmount > item.receivedAmount,
  );
  return input.credits.flatMap((credit) => {
    const matchedAmount = matched.get(credit.id) ?? 0;
    const remainingAmount = credit.amount - matchedAmount;
    if (
      remainingAmount <= 0 ||
      credit.pending ||
      credit.category === "TRANSFER_IN" ||
      credit.category === "TRANSFER_OUT" ||
      credit.category === "INCOME" ||
      /\b(?:salary|payroll|paycheck|refund|chargeback)\b/i.test(credit.merchant) ||
      !/\b(?:venmo|paypal|zelle|cash ?app|reimburs|repay|split)\b/i.test(credit.merchant)
    )
      return [];
    const plausible = open.some((item) => {
      const anchor = item.dueDate ?? item.createdAt.toISOString().slice(0, 10);
      const distance = Math.abs(
        new Date(`${credit.date}T00:00:00Z`).getTime() - new Date(`${anchor}T00:00:00Z`).getTime(),
      );
      const payer = item.payer?.toLocaleLowerCase();
      return (
        distance <= 45 * 86_400_000 &&
        (Boolean(payer && credit.merchant.toLocaleLowerCase().includes(payer)) ||
          remainingAmount <= item.expectedAmount - item.receivedAmount)
      );
    });
    return plausible ? [{ matchedAmount, remainingAmount, transactionId: credit.id }] : [];
  });
}
