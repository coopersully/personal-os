import {
  type FinanceAccount,
  type FinanceRecurringObligation,
  financePlanningEvidenceApplicability,
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
  evidenceContext?: { ownerUserId: string; today: string };
  renderConfirmation?: (item: FinanceRecurringObligation, applicable: boolean) => ReactNode;
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
  evidenceContext,
  renderConfirmation,
}: RecurringCostLadderProps) {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const costs = obligations.filter((item) => item.kind !== "savings");
  const qualifications = costs.map((item) =>
    evidenceContext
      ? financePlanningEvidenceApplicability({
          ...evidenceContext,
          source: {
            kind: "obligation",
            id: item.id,
            ownerUserId: evidenceContext.ownerUserId,
            revision: item.revision ?? 0,
            expectedAmountCents: exactCents(item.expectedAmount),
            cadence: item.cadence,
            accountId: item.accountId,
            currencyCode: item.accountId
              ? (accountById.get(item.accountId)?.currencyCode ?? null)
              : null,
            obligationKind: item.kind,
            status: item.status,
          },
          evidence: item.planningEvidence,
        })
      : { state: "unknown" as const, reason: "Account identity or planning date unavailable" },
  );
  const projection = projectRecurringCosts(
    costs.map((item, index) => {
      const qualification = qualifications[index];
      const evidence =
        qualification?.state === "applicable" && qualification.evidence.kind === "obligation"
          ? qualification.evidence
          : null;
      return {
        id: item.id,
        serviceId: null,
        kind: item.kind,
        status: item.status,
        cadence: item.cadence,
        amountCents: exactCents(item.expectedAmount),
        amountBasis: evidence?.fixedness ?? "unknown",
        currencyCode:
          evidence?.currencyCode ??
          (item.accountId ? (accountById.get(item.accountId)?.currencyCode ?? null) : null),
        confirmation: evidence ? ("confirmed" as const) : ("suspected" as const),
        sourceReferences: evidence ? [item.id, evidence.evidenceId] : [item.id],
        ...(evidence ? { asOf: evidence.asOf } : {}),
      };
    }),
  );
  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  const factors = {
    weekly: 52,
    biweekly: 26,
    semimonthly: 24,
    monthly: 12,
    quarterly: 4,
    yearly: 1,
    irregular: null,
  };
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
        <h2 className="text-lg font-semibold">Recurring costs</h2>
        <p className="text-sm text-muted-foreground">
          See the cost of your bills and subscriptions. Only supported fixed-cost statements qualify
          for equivalents.
        </p>
      </div>
      {costs.length ? (
        <section aria-label="Known recurring cost subset" className="flex flex-col gap-2">
          <h3 className="font-medium">Estimated monthly costs</h3>
          <p className="text-sm text-muted-foreground">
            {projection.coverage.normalizedRecords} of {projection.coverage.totalRecords} records
            included; {projection.coverage.excludedRecords} excluded. These totals cover only
            supported fixed-cost statements.
          </p>
          {projection.totals.map((total) => (
            <dl key={total.currencyCode} className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt>Confirmed {total.currencyCode} monthly subset (rounded)</dt>
                <dd>
                  {total.confirmed
                    ? money(total.confirmed.monthlyCents.numerator / 12, total.currencyCode)
                    : "Unavailable: precision limit"}
                </dd>
              </div>
              <div>
                <dt>Suspected {total.currencyCode} monthly subset (rounded)</dt>
                <dd>
                  {total.suspected
                    ? money(total.suspected.monthlyCents.numerator / 12, total.currencyCode)
                    : "Unavailable: precision limit"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <details>
                  <summary className="cursor-pointer">
                    Annual equivalents ({total.currencyCode})
                  </summary>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <dt>Confirmed {total.currencyCode} annual subset</dt>
                      <dd>
                        {total.confirmed
                          ? money(total.confirmed.annualCents, total.currencyCode)
                          : "Unavailable: precision limit"}
                      </dd>
                    </div>
                    <div>
                      <dt>Suspected {total.currencyCode} annual subset</dt>
                      <dd>
                        {total.suspected
                          ? money(total.suspected.annualCents, total.currencyCode)
                          : "Unavailable: precision limit"}
                      </dd>
                    </div>
                  </dl>
                </details>
              </div>
            </dl>
          ))}
        </section>
      ) : null}
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
            .map((item, index) => ({
              item,
              record: projection.records[index],
              qualification: qualifications[index],
            }))
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
                {rows.map(({ item, record, qualification }) => {
                  const account = item.accountId ? accountById.get(item.accountId) : undefined;
                  const currency = record?.source.currencyCode;
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
                        <dl className="grid gap-3 text-sm sm:grid-cols-2">
                          <div>
                            <dt className="text-muted-foreground">Expected payment</dt>
                            <dd className="tabular-nums">{expected}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Monthly equivalent</dt>
                            <dd>
                              {record?.normalized && currency
                                ? `${money(record.normalized.monthlyCents.numerator / 12, currency)} (rounded)`
                                : "Unavailable"}
                            </dd>
                          </div>
                        </dl>
                        <p className="text-sm text-muted-foreground">
                          {record?.exclusionReasons.map((reason) => reasons[reason]).join(" · ")}
                        </p>
                        {qualification?.state === "unknown" && item.planningEvidence ? (
                          <p className="text-sm text-muted-foreground">
                            Statement unavailable: {qualification.reason.replaceAll("_", " ")}.
                          </p>
                        ) : null}
                        <details className="text-sm">
                          <summary className="cursor-pointer">
                            Calculation and source details
                          </summary>
                          <dl>
                            <div>
                              <dt className="text-muted-foreground">Annual equivalent</dt>
                              <dd>
                                {record?.normalized && currency
                                  ? money(record.normalized.annualCents, currency)
                                  : "Unavailable"}
                              </dd>
                            </div>{" "}
                          </dl>
                          {record?.normalized ? (
                            <p className="text-sm text-muted-foreground">
                              {factors[item.cadence]} payments per year · Monthly equivalent is
                              annual cost ÷ 12. Fixed amount assumed unchanged.
                            </p>
                          ) : null}
                          {qualification?.state === "applicable" ? (
                            <p className="text-sm text-muted-foreground">
                              Your{" "}
                              {qualification.evidence.kind === "obligation"
                                ? qualification.evidence.fixedness
                                : ""}{" "}
                              statement as of {qualification.evidence.asOf}.
                            </p>
                          ) : null}

                          <p className="text-sm text-muted-foreground">
                            {item.nextExpectedDate
                              ? `Next expected: ${item.nextExpectedDate}`
                              : "Next date not established"}
                            {item.lastObservedDate
                              ? ` · Last observed: ${item.lastObservedDate}`
                              : " · No observed date"}
                          </p>
                          <h4 className="font-medium">Source record</h4>
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
                      {renderActions || renderConfirmation ? (
                        <ItemActions>
                          {renderConfirmation?.(item, qualification?.state === "applicable")}
                          {renderActions?.(item)}
                        </ItemActions>
                      ) : null}
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
