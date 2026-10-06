import type { ReactNode } from "react";
import { ClockIcon, MerchantIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { formatMoney } from "./format";

export function FinanceTransactionItem({
  title,
  amount,
  direction,
  description,
  status,
  actions,
  children,
}: {
  title: string;
  amount: number;
  direction: "income" | "expense" | "transfer";
  description: ReactNode;
  status?: "pending" | "expected" | undefined;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Item
      variant={status === "expected" ? "muted" : "secondary"}
      role="listitem"
      className="min-w-0 items-start"
    >
      <ItemMedia variant="icon">
        {status === "expected" ? <ClockIcon /> : <MerchantIcon />}
      </ItemMedia>
      <ItemContent>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <ItemTitle className="min-w-0 break-words">{title}</ItemTitle>
          {actions ? <ItemActions className="ml-auto self-start">{actions}</ItemActions> : null}
        </div>
        <ItemDescription>{description}</ItemDescription>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-semibold tabular-nums">
            {direction === "income" ? "+" : direction === "expense" ? "−" : "↔ "}
            {formatMoney(amount)}
          </p>
          {status ? (
            <Badge variant="secondary">{status === "expected" ? "Expected" : "Pending"}</Badge>
          ) : null}
        </div>
        {children}
      </ItemContent>
    </Item>
  );
}
