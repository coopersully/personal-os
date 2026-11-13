const creditCardPaymentCategory = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
/** Categories that agree with the provider's label: a payment or a transfer, not a purchase. */
const paymentCategories = new Set(["LOAN_PAYMENTS", "Transfers"]);

/**
 * Either leg of a payment to a credit card whose purchases nohmi observes. Those
 * purchases were already spending, so the payment is neither spending nor a refund.
 *
 * `cardLinked` must be true: without a planning-included card account the purchases
 * are unseen and the payment is the only spending signal. A category the person, an
 * agent or a merchant rule decided overrides the provider's label only when it names
 * something other than a payment or transfer; confirming the label keeps the exclusion.
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
  return !decided || paymentCategories.has(row.category ?? "");
}
