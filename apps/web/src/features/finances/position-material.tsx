import type { FinanceAccount, FinanceSnapshot, FinanceToolResult } from "@personal-os/domain";
import type { QueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { errorMessage } from "../../api.js";
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
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => Promise<unknown> };
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
        <p>{errorMessage(query.error)}</p>
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
}: {
  result: FinanceToolResult<FinanceSnapshot>;
  wealth?: boolean;
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
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div className="flex flex-col gap-1" key={metric.label}>
              <dt className="text-muted-foreground text-sm">
                <Link
                  className="underline underline-offset-4"
                  to={
                    "href" in metric ? (metric.href ?? "/finances/accounts") : "/finances/accounts"
                  }
                >
                  {metric.label}
                </Link>
              </dt>
              <dd className="text-xl tabular-nums">{financeAmount(metric.amount)}</dd>
            </div>
          ))}
        </dl>
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
          <Link to="/finances/health">Inspect evidence</Link>
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
}: {
  account: FinanceAccount;
  duplicateNames?: string[];
  onEdit?: () => void;
}) {
  const balance =
    account.balance === null
      ? "Balance unavailable"
      : account.currencyCode
        ? new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: account.currencyCode,
          }).format(account.balance)
        : `${account.balance.toLocaleString()} · currency unavailable`;
  return (
    <Item id={`account-${account.id}`} role="listitem">
      <ItemContent className="min-w-0">
        <ItemTitle>{account.name}</ItemTitle>
        <ItemDescription>
          {account.institution} ·{" "}
          {account.kind === "investment"
            ? "Investments"
            : account.kind === "cash"
              ? "Cash"
              : account.kind === "debt"
                ? "Debt"
                : "Other assets"}{" "}
          · {balance}
        </ItemDescription>
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
      </ItemContent>
      <ItemActions className="flex-wrap">
        <Badge
          variant={
            account.status === "needs_reauth" || account.synchronization.state === "blocked"
              ? "destructive"
              : "secondary"
          }
        >
          {account.status === "needs_reauth"
            ? "Reconnect required"
            : account.synchronization.state === "current"
              ? "Current"
              : account.synchronization.state === "stale"
                ? "Stale"
                : account.synchronization.state === "retrying"
                  ? "Retrying"
                  : "Blocked"}
        </Badge>
        {onEdit ? (
          <Button aria-label={`Edit ${account.name}`} onClick={onEdit} size="sm" variant="outline">
            Edit
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline">
            <Link to={`/finances/accounts#account-${account.id}`}>Inspect account</Link>
          </Button>
        )}
        <Button asChild size="sm" variant="ghost">
          <Link to={`/finances/transactions?accountId=${encodeURIComponent(account.id)}`}>
            Transactions
          </Link>
        </Button>
      </ItemActions>
    </Item>
  );
}
