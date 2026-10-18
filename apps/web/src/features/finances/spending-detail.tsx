import type {
  FinanceSpendingDashboard,
  FinanceSpendingDrillDown,
  FinanceSpendingGroup,
} from "@personal-os/domain";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "./format";
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
  const bucket = data.groups.find(
    (item) =>
      item.id === group?.id || item.categories.some((category) => category.id === group?.id),
  );
  const selectedScope = group?.drillDown ?? drillDown;
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
          <ResponsiveDialogTitle>{group?.label ?? "Spending detail"}</ResponsiveDialogTitle>
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
          Monthly budget comparison unavailable: budget account and currency scope is not
          established.
        </p>
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
