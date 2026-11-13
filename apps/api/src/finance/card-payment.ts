const creditCardPaymentCategory = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
/** Categories that agree with the provider's label: a payment or a transfer, not a purchase. */
const paymentCategories = new Set(["LOAN_PAYMENTS", "Transfers"]);

/**
 * Either leg of a payment to a credit card whose purchases nohmi observes. Those
 * purchases were already spending, so the payment is neither spending nor a refund.
 *
 * `cardLinked` must be true: without a card whose purchases are observed (see
 * `observesCardPurchases`) the payment is the only spending signal. A category the
 * person, an agent or a merchant rule decided overrides the provider's label only when
 * it names something other than a payment or transfer; confirming the label, or
 * clearing the category, keeps the exclusion.
 *
 * Known limit: the funding-side leg does not identify which card it paid. A person with
 * one connected card and another unlinked card has payments to the unlinked card
 * excluded too.
 */
export function isCreditCardPaymentMovement(
  row: {
    category?: string | null;
    categorySource?: string | null;
    providerCategoryDetailed?: string | null;
  },
  cardLinked: boolean,
) {
  if (!cardLinked || row.providerCategoryDetailed !== creditCardPaymentCategory) return false;
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
