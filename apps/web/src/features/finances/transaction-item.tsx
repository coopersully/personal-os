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
  presentation = false,
  amount,
  direction,
  description,
  category,
  status,
  actions,
  actionsPlacement = "end",
  children,
}: {
  title: string;
  presentation?: boolean;
  amount: number;
  direction: "income" | "expense" | "transfer";
  description: ReactNode;
  category?: string;
  status?: "pending" | "expected" | undefined;
  actions?: ReactNode;
  actionsPlacement?: "start" | "end";
  children?: ReactNode;
}) {
  return (
    <Item
      variant={status === "expected" ? "muted" : "outline"}
      role={presentation ? "presentation" : "listitem"}
      className="min-w-0 items-start"
    >
      <ItemMedia variant="icon">
        {status === "expected" ? <ClockIcon /> : <MerchantIcon />}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <ItemTitle className="min-w-0 max-w-full break-words">{title}</ItemTitle>
            <ItemDescription className="text-xs">{description}</ItemDescription>
            {actions && actionsPlacement === "start" ? (
              <ItemActions className="mt-1 self-start">{actions}</ItemActions>
            ) : null}
          </div>
          <div className="flex min-w-0 max-w-48 flex-col items-end gap-1 text-right">
            {actions && actionsPlacement === "end" ? <ItemActions>{actions}</ItemActions> : null}
            <p
              className={`break-words text-2xl font-semibold tabular-nums ${direction === "income" ? "text-success" : direction === "expense" ? "text-destructive" : "text-muted-foreground"}`}
            >
              {direction === "income" ? "+" : direction === "expense" ? "−" : "↔ "}
              {formatMoney(amount)}
            </p>
            {status ? (
              <Badge variant="secondary">
                <ClockIcon aria-hidden="true" />
                {status === "expected" ? "Expected" : "Pending"}
              </Badge>
            ) : null}
            {category ? (
              <Badge variant="secondary" className="h-auto max-w-full whitespace-normal text-right">
                {category}
              </Badge>
            ) : null}
          </div>
        </div>
        {children}
      </ItemContent>
    </Item>
  );
}
