import type { FinanceTransaction } from "@personal-os/domain";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { formatCalendarDate } from "@/lib/date-format";

/** A transaction's identity and amount, without inferring an unknown currency. */
export function TransactionSummary({
  transaction,
}: {
  transaction: Pick<
    FinanceTransaction,
    "merchant" | "date" | "amount" | "currencyCode" | "direction" | "pending"
  >;
}) {
  const amount = new Intl.NumberFormat(
    undefined,
    transaction.currencyCode
      ? { style: "currency", currency: transaction.currencyCode }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  ).format(transaction.amount);
  return (
    <Item variant="muted" className="items-start">
      <ItemContent>
        <ItemTitle className="break-words">{transaction.merchant}</ItemTitle>
        <ItemDescription>
          {formatCalendarDate(transaction.date)} ·{" "}
          {transaction.direction === "income"
            ? "Money in"
            : transaction.direction === "transfer"
              ? "Transfer"
              : "Money out"}
          {transaction.pending ? " · Pending" : transaction.pending === false ? " · Posted" : ""}
        </ItemDescription>
      </ItemContent>
      <div className="text-end">
        <p className="text-lg font-semibold tabular-nums">{amount}</p>
        {!transaction.currencyCode ? (
          <p className="text-xs text-muted-foreground">Currency not recorded</p>
        ) : null}
      </div>
    </Item>
  );
}
