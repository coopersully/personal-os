import {
  type FinanceSpendingDashboard,
  type FinanceSpendingDrillDown,
  type FinanceSpendingGroup,
  type FinanceSpendingReferenceFilter,
  financeSpendingReferenceFilterSchema,
  financeSpendingScopeSchema,
} from "@personal-os/domain";
import { Link } from "react-router-dom";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "./format";
import { SpendingMonthlyBudgetContext } from "./spending-budget-qualification";
import { spendingGroupVisual } from "./spending-visual";
/** Only bounded, reproducible selections can open the exact Transactions consumer. */
export function spendingTransactionsDestination(
  data: FinanceSpendingDashboard,
  group: FinanceSpendingGroup | null,
  selection: FinanceSpendingDrillDown | null | undefined,
) {
  if (!selection || !data.referenceRevision) return null;
  const parsed = financeSpendingReferenceFilterSchema.safeParse({
    query: {
      scope: data.snapshot.scope,
      grouping: data.effectiveGrouping,
      includeUncategorized: true,
    },
    referenceRevision: data.referenceRevision,
    groupId: group?.id ?? null,
    from: selection.scope.from,
    through: selection.scope.through,
  });
  if (!parsed.success) return null;
  const normalized = financeSpendingScopeSchema.safeParse({
    ...selection.scope,
    from: data.snapshot.scope.from,
    through: data.snapshot.scope.through,
  });
  if (
    !normalized.success ||
    JSON.stringify(normalized.data) !== JSON.stringify(parsed.data.query.scope)
  )
    return null;
  const canonicalGroup = group
    ? data.groups.flatMap((item) => [item, ...item.categories]).find((item) => item.id === group.id)
    : null;
  if (group && !canonicalGroup) return null;
  const groupIds = canonicalGroup ? new Set(canonicalGroup.drillDown.contributionIds) : null;
  const expected = data.snapshot.contributions.filter(
    (item) =>
      item.date >= parsed.data.from &&
      item.date <= parsed.data.through &&
      (!groupIds || groupIds.has(item.id)),
  );
  const sameIds = (left: string[], right: string[]) =>
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  if (
    !sameIds(
      selection.contributionIds,
      expected.map((item) => item.id),
    ) ||
    !sameIds(selection.transactionIds, [...new Set(expected.map((item) => item.transactionId))])
  )
    return null;
  const filter: FinanceSpendingReferenceFilter = parsed.data;
  const serialized = JSON.stringify(filter);
  if (serialized.length > 16000) return null;
  return `/finances/transactions?${new URLSearchParams({ spending: serialized })}`;
}
export function SpendingDetail({
  data,
  group,
  drillDown,
  onClose,
  onSelect,
}: {
  data: FinanceSpendingDashboard;
  group: FinanceSpendingGroup | null;
  drillDown?: FinanceSpendingDrillDown | null;
  onClose: () => void;
  onSelect: (group: FinanceSpendingGroup) => void;
}) {
  const visual = group ? spendingGroupVisual(group) : null;
  const GroupIcon = visual?.Icon;
  const monthly =
    data.monthlyBudget?.state === "qualified" && group
      ? data.monthlyBudget.groups.find((item) => item.groupId === group.id)
      : null;
  const bucket = data.groups.find(
    (item) =>
      item.id === group?.id || item.categories.some((category) => category.id === group?.id),
  );
  const selectedScope = group?.drillDown ?? drillDown;
  const destination = spendingTransactionsDestination(data, group, selectedScope);
  const ids = new Set(selectedScope?.contributionIds);
  const contributions = data.snapshot.contributions.filter((item) => ids.has(item.id));
  const totals =
    group ??
    contributions.reduce(
      (sum, item) => ({
        grossCents: sum.grossCents + item.grossCents,
        reimbursementAdjustmentCents:
          sum.reimbursementAdjustmentCents + item.reimbursementAdjustmentCents,
        reimbursementOutstandingCents:
          sum.reimbursementOutstandingCents + item.reimbursementOutstandingCents,
        refundAdjustmentCents: sum.refundAdjustmentCents + item.refundAdjustmentCents,
        netCents: sum.netCents + item.netCents,
        pendingCents: sum.pendingCents + (item.pending ? item.netCents : 0),
      }),
      {
        grossCents: 0,
        reimbursementAdjustmentCents: 0,
        reimbursementOutstandingCents: 0,
        refundAdjustmentCents: 0,
        netCents: 0,
        pendingCents: 0,
      },
    );
  return (
    <ResponsiveDialog open={!!selectedScope} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            {GroupIcon ? (
              <GroupIcon aria-hidden="true" className="size-4" style={{ color: visual?.color }} />
            ) : null}
            {group?.label ?? "Spending detail"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {selectedScope?.scope.from} – {selectedScope?.scope.through} · Current category
            membership · USD
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {bucket?.kind === "bucket" ? (
          <nav aria-label="Spending detail">
            <Button variant="ghost" onClick={() => onSelect(bucket)}>
              {bucket.label}
            </Button>
            {group?.id !== bucket.id ? <span> / {group?.label}</span> : null}
            {group?.id === bucket.id ? (
              <ul>
                {bucket.categories.map((category) => (
                  <li key={category.id}>
                    <Button variant="ghost" onClick={() => onSelect(category)}>
                      {category.label} · {formatMoney(category.netCents / 100)}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </nav>
        ) : null}
        <dl className="grid grid-cols-2 gap-2">
          {[
            ["Gross", totals.grossCents],
            ["Reimbursable portion", totals.reimbursementAdjustmentCents],
            ["Still owed", totals.reimbursementOutstandingCents],
            ["Matched refunds", totals.refundAdjustmentCents],
            ["Net spending", totals.netCents],
            ["Pending included", totals.pendingCents],
          ].map(([label, cents]) => (
            <div key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd>{formatMoney(Number(cents ?? 0) / 100)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          Selected-period spending above uses the displayed transaction and account filters. Monthly
          usage below covers the whole qualified month and all confirmed budget accounts.
        </p>
        <SpendingMonthlyBudgetContext budget={data.monthlyBudget} />
        {monthly ? (
          <p>
            Monthly usage: {formatMoney(monthly.usedCents / 100)}
            {monthly.budgetCents !== null && monthly.budgetCents !== undefined
              ? ` of ${formatMoney(monthly.budgetCents / 100)}`
              : " · No budget limit"}
            {monthly.budgetCents !== null &&
            monthly.budgetCents !== undefined &&
            monthly.usedCents > monthly.budgetCents
              ? ` · Over budget ${formatMoney((monthly.usedCents - monthly.budgetCents) / 100)}`
              : ""}
          </p>
        ) : null}
        {destination ? (
          <Button asChild variant="secondary">
            <Link to={destination}>Open matching transactions</Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Matching transactions are unavailable for this selection. Reload Spending to obtain a
            current, exact reference.
          </p>
        )}
        <ul
          className="flex max-h-80 flex-col gap-3 overflow-auto"
          aria-label="Exact spending contributions"
        >
          {contributions.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-2">
              <span>
                {data.transactions.find((transaction) => transaction.id === item.transactionId)
                  ?.merchant || "Transaction"}
                <span className="block text-sm text-muted-foreground">
                  {item.date}
                  {item.pending ? " · Pending" : ""}
                  {item.allocationId ? " · Split allocation" : ""}
                </span>
              </span>
              <span>{formatMoney(item.netCents / 100)}</span>
            </li>
          ))}
        </ul>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
