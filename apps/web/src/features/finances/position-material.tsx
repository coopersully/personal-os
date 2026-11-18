import type { FinanceAccount, FinanceSnapshot, FinanceToolResult } from "@personal-os/domain";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ActionButton as Button } from "@/components/action-button";
import { QueryFeedback } from "@/components/async-state";
import { CircleAlertIcon, EditIcon, MoreHorizontalIcon, ReceiptIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Item, ItemActions, ItemContent } from "@/components/ui/item";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { financeAccountBalance } from "./account-type";
import { financeAccountNeedsAttention } from "./attention";
import { BankAccount } from "./bank-account";
import { FinancialAccountCard } from "./financial-account-card";
import { formatMoney } from "./format.js";

export function refreshFinancePosition(client: QueryClient) {
  return client.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("finance-"),
  });
}

export function financeAmount(value: number | null) {
  return value === null ? "Unavailable" : formatMoney(value);
}

export function financeObservedAt(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function requireFinanceResult<T>(result: FinanceToolResult<T>): FinanceToolResult<T> {
  if (result.outcome === "failed") throw new Error(result.communication.headline);
  return result;
}

export function FinanceSourceState({
  label,
  query,
  loading,
}: {
  label: string;
  loading?: ReactNode;
  query: {
    data?: unknown;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => Promise<unknown>;
  };
}) {
  if (query.isPending)
    return (
      <div aria-label={`Loading ${label}`} role="status" aria-busy="true">
        {loading ?? <Skeleton className="h-12 w-full" />}
        <span className="sr-only">Loading {label}</span>
      </div>
    );
  return <QueryFeedback query={query} title={`${label} unavailable`} />;
}

export function FinancePositionMaterial({
  result,
  wealth = false,
  hideMetrics = false,
}: {
  result: FinanceToolResult<FinanceSnapshot>;
  wealth?: boolean;
  hideMetrics?: boolean;
}) {
  const snapshot = result.data;
  const metrics = wealth
    ? [
        { label: "Net worth", amount: snapshot.netWorth },
        { label: "Cash", amount: snapshot.cash },
        { label: "Investments", amount: snapshot.investments },
        { label: "Debt", amount: snapshot.debt },
      ]
    : [
        { label: "Cash", amount: snapshot.cash },
        {
          label: "Posted spending this month",
          amount: snapshot.budget.spent,
          href: "/finances/transactions",
        },
        { label: "Net worth", amount: snapshot.netWorth },
      ];
  return (
    <Card aria-label={wealth ? "Ownership-qualified wealth" : "Financial position"} role="region">
      <CardHeader>
        <CardTitle>{wealth ? "Ownership-qualified wealth" : "Financial position"}</CardTitle>
        <CardDescription>
          As of {financeObservedAt(snapshot.asOf)} ·{" "}
          {snapshot.ledger.trustworthy ? "Current evidence" : "Partial evidence"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!hideMetrics ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {metrics.map((metric) => (
              <div className="flex flex-col gap-1" key={metric.label}>
                <dt className="text-muted-foreground text-sm">
                  <Link
                    className="underline underline-offset-4"
                    to={
                      "href" in metric
                        ? (metric.href ?? "/finances/accounts")
                        : "/finances/accounts"
                    }
                  >
                    {metric.label}
                  </Link>
                </dt>
                <dd className="text-xl tabular-nums">{financeAmount(metric.amount)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className="text-muted-foreground text-sm">
          Balances reflect planning inclusion and your recorded ownership share. Unavailable amounts
          need more evidence in{" "}
          <Link className="underline underline-offset-4" to="/finances/accounts">
            Accounts
          </Link>
          .
        </p>
        {result.communication.requiredDisclosures.length > 0 ? (
          <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
            {result.communication.requiredDisclosures.map((disclosure) => (
              <li key={disclosure.message}>{disclosure.message}</li>
            ))}
          </ul>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to="/finances/accounts">Review accounts</Link>
        </Button>
        <span className="text-muted-foreground text-xs">
          {snapshot.ledger.reconciledThrough
            ? `Reconciled through ${snapshot.ledger.reconciledThrough}`
            : "Reconciliation date unavailable"}
        </span>
      </CardFooter>
    </Card>
  );
}

export function accountOwnership(account: FinanceAccount) {
  if (account.ownershipType === "unknown" || account.ownershipShare === null)
    return "Ownership needs confirmation";
  return `${account.ownershipType === "joint" ? "Joint" : "Individual"} · ${Number((account.ownershipShare * 100).toFixed(2))}% yours`;
}

export function FinanceAccountRecord({
  account,
  duplicateNames = [],
  card = false,
  onEdit,
  attentionAction,
}: {
  account: FinanceAccount;
  duplicateNames?: string[];
  card?: boolean;
  onEdit?: () => void;
  attentionAction?: ReactNode;
}) {
  const balance = financeAccountBalance(account);
  return (
    <Item
      id={`account-${account.id}`}
      role="listitem"
      variant="secondary"
      className={`finance-account-record${card ? " finance-account-record--card" : ""}`}
    >
      <ItemContent className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {card ? (
            <FinancialAccountCard
              account={account}
              actions={
                <FinanceAccountOptions account={account} {...(onEdit ? { onEdit } : {})} card />
              }
            />
          ) : (
            <BankAccount account={account} />
          )}
          {financeAccountNeedsAttention(account, duplicateNames.length > 0) ? (
            <Badge variant="destructive">
              <CircleAlertIcon />
              Needs attention
            </Badge>
          ) : null}
        </div>
        {account.synchronization.message ? (
          <p className="text-sm">{account.synchronization.message}</p>
        ) : null}
        {account.synchronization.nextRetryAt ? (
          <p className="text-muted-foreground text-xs">
            Retry scheduled {financeObservedAt(account.synchronization.nextRetryAt)}
          </p>
        ) : null}
        {duplicateNames.length ? (
          <p className="text-sm">
            Possible duplicate of {duplicateNames.join(", ")}. Confirm which account belongs in
            planning.
          </p>
        ) : null}
        {attentionAction}
      </ItemContent>
      {!card ? (
        <div className="finance-account-balance">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={
                  account.kind === "debt"
                    ? "font-semibold tabular-nums text-destructive"
                    : "font-semibold tabular-nums"
                }
              >
                {balance}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {account.currencyCode ?? "The source has not provided a currency code."}
            </TooltipContent>
          </Tooltip>
          <span
            className={
              account.kind === "debt" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
            }
          >
            {account.kind === "debt" ? "Amount owed" : "Current balance"}
          </span>
        </div>
      ) : null}
      {!card ? <FinanceAccountOptions account={account} {...(onEdit ? { onEdit } : {})} /> : null}
    </Item>
  );
}

export function FinanceAccountOptions({
  account,
  onEdit,
  card = false,
}: {
  account: FinanceAccount;
  onEdit?: () => void;
  card?: boolean;
}) {
  return (
    <ItemActions>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size={card ? "sm" : "icon-sm"}
            variant="ghost"
            className={card ? "financial-account-card__details" : undefined}
            aria-label={`Account options for ${account.name}`}
          >
            {card ? "Details" : <MoreHorizontalIcon />}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" aria-label={`Details for ${account.name}`}>
          <p className="font-medium">{account.name}</p>
          <p className="text-sm text-muted-foreground">
            {accountOwnership(account)} ·{" "}
            {account.includeInPlanning ? "Included in planning" : "Excluded from planning"}
          </p>
          <p className="text-xs text-muted-foreground">
            {account.provider === "manual" ? "Manually tracked" : "Connected source"} ·{" "}
            {account.lastSyncedAt
              ? `Last synced ${financeObservedAt(account.lastSyncedAt)}`
              : "No recorded sync"}
          </p>
          <div className="flex items-center gap-2">
            {onEdit ? (
              <Button
                aria-label={`Edit ${account.name}`}
                onClick={onEdit}
                size="sm"
                variant="ghost"
              >
                <EditIcon /> Edit account
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link to={`/finances/accounts#account-${account.id}`}>Inspect account</Link>
              </Button>
            )}
            <Button
              asChild
              size="sm"
              variant="ghost"
              aria-label={`Transactions for ${account.name}`}
            >
              <Link to={`/finances/transactions?accountId=${encodeURIComponent(account.id)}`}>
                <ReceiptIcon /> Transactions
              </Link>
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </ItemActions>
  );
}
