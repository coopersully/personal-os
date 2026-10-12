import type { FinanceAccount, FinanceSnapshot, FinanceToolResult } from "@personal-os/domain";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ActionButton as Button } from "@/components/action-button";
import {
  BankIcon,
  CircleAlertIcon,
  EditIcon,
  ReceiptIcon,
  TargetIcon,
  WalletIcon,
} from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { financeAccountNeedsAttention } from "./attention";
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
}: {
  label: string;
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
      <div aria-label={`Loading ${label}`} role="status">
        <Skeleton className="h-12 w-full" />
        <span className="sr-only">Loading {label}</span>
      </div>
    );
  if (!query.isError) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>{label} unavailable</AlertTitle>
      <AlertDescription>
        <p>
          {query.data !== undefined
            ? "Showing the last available update. Refresh before relying on this information."
            : "Couldn’t load this information. Try again."}
        </p>
        <Button onClick={() => void query.refetch()} size="sm" variant="outline">
          Retry {label.toLowerCase()}
        </Button>
      </AlertDescription>
    </Alert>
  );
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
  onEdit,
  attentionAction,
}: {
  account: FinanceAccount;
  duplicateNames?: string[];
  onEdit?: () => void;
  attentionAction?: ReactNode;
}) {
  const balance =
    account.balance === null
      ? "Balance unavailable"
      : account.currencyCode
        ? new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: account.currencyCode,
          }).format(account.balance)
        : account.balance.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
  return (
    <Item
      id={`account-${account.id}`}
      role="listitem"
      variant="secondary"
      className="finance-account-record"
    >
      <ItemContent className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {account.kind === "debt" ? (
            <WalletIcon aria-hidden="true" />
          ) : account.kind === "investment" ? (
            <TargetIcon aria-hidden="true" />
          ) : (
            <BankIcon aria-hidden="true" />
          )}
          <ItemTitle>{account.name}</ItemTitle>
          {financeAccountNeedsAttention(account, duplicateNames.length > 0) ? (
            <Badge variant="destructive">
              <CircleAlertIcon />
              Needs attention
            </Badge>
          ) : null}
          <Badge
            variant={
              account.status === "needs_reauth" || account.synchronization.state === "blocked"
                ? "destructive"
                : "secondary"
            }
          >
            {account.provider === "manual"
              ? "Manually tracked"
              : account.status === "needs_reauth"
                ? "Reconnect required"
                : account.synchronization.state === "current"
                  ? "Current"
                  : account.synchronization.state === "stale"
                    ? "Stale"
                    : account.synchronization.state === "retrying"
                      ? "Retrying"
                      : "Blocked"}
          </Badge>
        </div>
        <ItemDescription>{account.institution}</ItemDescription>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">
            {account.kind === "investment"
              ? "Investments"
              : account.kind === "cash"
                ? "Cash"
                : account.kind === "debt"
                  ? "Debt"
                  : "Other assets"}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xl font-semibold tabular-nums">{balance}</span>
            </TooltipTrigger>
            <TooltipContent>
              {account.currencyCode ?? "The source has not provided a currency code."}
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-muted-foreground text-sm">
          {accountOwnership(account)} ·{" "}
          {account.includeInPlanning ? "Included in planning" : "Excluded from planning"}
        </p>
        <p className="text-muted-foreground text-xs">
          {account.provider === "manual" ? "Manually tracked" : "Connected source"} ·{" "}
          {account.lastSyncedAt
            ? `Last synced ${financeObservedAt(account.lastSyncedAt)}`
            : "No recorded sync"}
        </p>
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
      <ItemActions className="flex-wrap">
        {onEdit ? (
          <Button aria-label={`Edit ${account.name}`} onClick={onEdit} size="icon" variant="ghost">
            <EditIcon />
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline">
            <Link to={`/finances/accounts#account-${account.id}`}>Inspect account</Link>
          </Button>
        )}
        <Button asChild size="icon" variant="ghost" aria-label={`Transactions for ${account.name}`}>
          <Link to={`/finances/transactions?accountId=${encodeURIComponent(account.id)}`}>
            <ReceiptIcon />
          </Link>
        </Button>
      </ItemActions>
    </Item>
  );
}
