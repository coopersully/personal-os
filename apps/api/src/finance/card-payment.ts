const creditCardPaymentCategory = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
/** Categories that agree with the provider's label: a payment or a transfer, not a purchase. */
const paymentCategories = new Set(["LOAN_PAYMENTS", "Transfers"]);

/**
 * Either leg of a payment to a credit card whose purchases nohmi observes. Those
 * purchases were already spending, so the payment is neither spending nor a refund.
 *
 * `settled` must be true: the caller has established, with `settledCardPaymentIds`,
 * that this row pays a card whose purchases are observed. Otherwise the payment is the
 * only spending signal and still counts. A category the person, an agent or a merchant
 * rule decided overrides the provider's label only when it names something other than a
 * payment or transfer; confirming the label, or clearing the category, keeps the
 * exclusion.
 */
export function isCreditCardPaymentMovement(
  row: {
    category?: string | null;
    categorySource?: string | null;
    providerCategoryDetailed?: string | null;
  },
  settled: boolean,
) {
  if (!settled || row.providerCategoryDetailed !== creditCardPaymentCategory) return false;
  const decided =
    row.categorySource === "user" ||
    row.categorySource === "agent" ||
    row.categorySource === "rule";
  return !decided || row.category == null || paymentCategories.has(row.category);
}

/**
 * True for a planning-included credit card the provider is currently syncing, so its
 * purchases are observed. A manual liability, a loan, or a card awaiting
 * re-authentication does not qualify: its purchases may be unseen.
 */
export function observesCardPurchases(account: {
  includeInPlanning: boolean;
  kind: string;
  providerType?: string | null;
  status?: string | null;
}) {
  return (
    account.kind === "debt" &&
    account.includeInPlanning &&
    account.providerType === "credit" &&
    account.status === "connected"
  );
}

type CardPaymentRow = {
  accountId: string;
  amount: number;
  category?: string | null;
  categorySource?: string | null;
  direction: string;
  id: string;
  providerCategoryDetailed?: string | null;
  transactionDate: string;
};

const day = (value: string) => Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / 86_400_000;

/**
 * Ids of card-payment rows that settle purchases nohmi observes, per card rather than
 * per person. The card-side leg on an observed card always qualifies. The funding-side
 * leg does not name the card it paid, so it qualifies only when an observed card
 * received the same amount within `windowDays`; each receipt settles one payment. A
 * payment to an unlinked card finds no receipt and stays in spending.
 */
export function settledCardPaymentIds(
  rows: readonly CardPaymentRow[],
  cardAccountIds: ReadonlySet<string>,
  windowDays = 5,
) {
  const settled = new Set<string>();
  if (cardAccountIds.size === 0) return settled;
  const receipts: CardPaymentRow[] = [];
  const funding: CardPaymentRow[] = [];
  for (const row of rows) {
    const labelled = isCreditCardPaymentMovement(row, true);
    if (cardAccountIds.has(row.accountId)) {
      if (row.direction === "expense") continue;
      if (labelled) settled.add(row.id);
      if (labelled || paymentCategories.has(row.category ?? "")) receipts.push(row);
    } else if (labelled && row.direction !== "income") funding.push(row);
  }
  funding.sort(
    (a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.id.localeCompare(b.id),
  );
  for (const payment of funding) {
    let best = -1;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const [index, receipt] of receipts.entries()) {
      const gap = Math.abs(day(receipt.transactionDate) - day(payment.transactionDate));
      if (receipt.amount === payment.amount && gap <= windowDays && gap < bestGap) {
        best = index;
        bestGap = gap;
      }
    }
    if (best < 0) continue;
    receipts.splice(best, 1);
    settled.add(payment.id);
  }
  return settled;
}
