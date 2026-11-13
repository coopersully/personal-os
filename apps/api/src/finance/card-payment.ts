const creditCardPaymentCategory = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

/**
 * Either leg of a payment to a credit card. The purchases it settles were already
 * spending, so the payment itself is neither spending nor a refund. A category the
 * person, an agent or a merchant rule decided overrides the provider's label.
 */
export function isCreditCardPaymentMovement(row: {
  categorySource?: string | null;
  providerCategoryDetailed?: string | null;
}) {
  return (
    row.providerCategoryDetailed === creditCardPaymentCategory &&
    row.categorySource !== "user" &&
    row.categorySource !== "agent" &&
    row.categorySource !== "rule"
  );
}
