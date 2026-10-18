import {
  type FinanceAccount,
  type FinanceRecurringObligation,
  projectRecurringCosts,
  type RecurringCostExclusion,
} from "@personal-os/domain";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";

interface RecurringCostLadderProps {
  obligations: FinanceRecurringObligation[];
  renderActions?: (item: FinanceRecurringObligation) => ReactNode;
  accounts: Pick<FinanceAccount, "id" | "name" | "currencyCode">[];
}

const cadenceLabels = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  irregular: "Irregular",
};
const reasons: Record<RecurringCostExclusion, string> = {
  savings: "Savings contribution",
  paused: "Paused",
  cancelled: "Cancelled",
  missing_amount: "Amount unknown",
  invalid_amount: "Amount is not exact supported cents",
  variable_amount: "Amount varies",
  unknown_amount_basis: "Fixed or variable amount not established",
  irregular_cadence: "Irregular schedule",
  unknown_cadence: "Schedule unknown",
  missing_currency: "Account currency unavailable",
  invalid_currency: "Currency not recognized",
  unsupported_currency: "Currency minor units unsupported",
  annual_amount_overflow: "Amount exceeds supported precision",
};

// Verify decimal cents first; rounding only removes binary representation noise after validation.
function exactCents(value: number) {
  return Number.isFinite(value) && Number(value.toFixed(2)) === value
    ? Math.round(value * 100)
    : Number.NaN;
}

export function RecurringCostLadder({
  obligations,
  accounts,
  renderActions,
}: RecurringCostLadderProps) {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const costs = obligations.filter((item) => item.kind !== "savings");
  const projection = projectRecurringCosts(
    costs.map((item) => ({
      id: item.id,
      serviceId: null,
      kind: item.kind,
      status: item.status,
      cadence: item.cadence,
      amountCents: exactCents(item.expectedAmount),
      amountBasis: "unknown" as const,
      currencyCode: item.accountId ? (accountById.get(item.accountId)?.currencyCode ?? null) : null,
      confirmation:
        item.source === "user" && item.status === "active"
          ? ("confirmed" as const)
          : ("suspected" as const),
      sourceReferences: [item.id],
      ...(item.lastObservedDate ? { asOf: item.lastObservedDate } : {}),
    })),
  );
  const groups = ["Active", "Inferred", "Needs review", "Inactive"] as const;
  const groupFor = (item: FinanceRecurringObligation) =>
    item.status === "paused" || item.status === "cancelled"
      ? "Inactive"
      : item.status === "needs_review"
        ? "Needs review"
        : item.source === "inferred"
          ? "Inferred"
          : "Active";
  return (
    <section aria-label="Recurring cost ladder" className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Recurring cost ladder</h2>
        <p className="text-sm text-muted-foreground">
          Compare expected payments and the evidence behind each record.
        </p>
      </div>
      {costs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No bills or subscriptions to compare</EmptyTitle>
            <EmptyDescription>
              Savings contributions are excluded from recurring costs.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        groups.map((group) => {
          const rows = costs
            .map((item, index) => ({ item, record: projection.records[index] }))
            .filter(({ item }) => groupFor(item) === group);
          return rows.length ? (
            <section
              key={group}
              aria-label={`${group} recurring costs`}
              className="flex min-w-0 flex-col gap-2"
            >
              <h3 className="font-medium">
                {group} · {rows.length}
              </h3>
              <ItemGroup>
                {rows.map(({ item, record }) => {
                  const account = item.accountId ? accountById.get(item.accountId) : undefined;
                  const currency = account?.currencyCode;
                  const supportedCurrency =
                    currency && Intl.supportedValuesOf("currency").includes(currency);
                  const expected = supportedCurrency
                    ? new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency,
                        maximumFractionDigits: 20,
                      }).format(item.expectedAmount)
                    : `${item.expectedAmount} · currency unavailable`;
                  return (
                    <Item key={item.id} role="listitem" aria-label={item.displayName}>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="flex-wrap">
                          {item.displayName}
                          <Badge variant="secondary">{item.status.replace("_", " ")}</Badge>
                        </ItemTitle>
                        <ItemDescription>
                          {item.source === "user" ? "User supplied" : "Inferred pattern"} ·{" "}
                          {cadenceLabels[item.cadence]} · {account?.name ?? "Account unavailable"}
                        </ItemDescription>
                        <dl className="grid gap-3 text-sm sm:grid-cols-3">
                          <div>
                            <dt className="text-muted-foreground">Expected payment</dt>
                            <dd className="tabular-nums">{expected}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Monthly equivalent</dt>
                            <dd>Unavailable</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Annual equivalent</dt>
                            <dd>Unavailable</dd>
                          </div>
                        </dl>
                        <p className="text-sm text-muted-foreground">
                          {record?.exclusionReasons.map((reason) => reasons[reason]).join(" · ")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {item.nextExpectedDate
                            ? `Next expected: ${item.nextExpectedDate}`
                            : "Next date not established"}
                          {item.lastObservedDate
                            ? ` · Last observed: ${item.lastObservedDate}`
                            : " · No observed date"}
                        </p>
                        <details className="text-sm">
                          <summary>Source record</summary>
                          <p className="break-all">Record: {item.id}</p>
                          <p>Merchant: {item.merchant || "Not recorded"}</p>
                          <p>Service identity unavailable; price comparison unavailable.</p>
                        </details>
                        {item.accountId ? (
                          <Link
                            className="text-sm underline"
                            to={`/finances/transactions?accountId=${encodeURIComponent(item.accountId)}`}
                          >
                            View source account activity for {item.displayName}
                          </Link>
                        ) : null}
                      </ItemContent>
                      {renderActions ? <ItemActions>{renderActions(item)}</ItemActions> : null}
                    </Item>
                  );
                })}
              </ItemGroup>
            </section>
          ) : null;
        })
      )}
      {obligations.some((item) => item.kind === "savings") ? (
        <p className="text-sm text-muted-foreground">Savings contributions excluded.</p>
      ) : null}
    </section>
  );
}
