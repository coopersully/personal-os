import type { FinanceSpendingDashboard, FinanceSpendingGroup } from "@personal-os/domain";
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
  onClose,
  onSelect,
}: {
  data: FinanceSpendingDashboard;
  group: FinanceSpendingGroup | null;
  onClose: () => void;
  onSelect: (group: FinanceSpendingGroup) => void;
}) {
  const bucket = data.groups.find(
    (item) =>
      item.id === group?.id || item.categories.some((category) => category.id === group?.id),
  );
  const ids = new Set(group?.drillDown.contributionIds);
  const contributions = data.snapshot.contributions.filter((item) => ids.has(item.id));
  return (
    <ResponsiveDialog open={!!group} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{group?.label}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {data.snapshot.scope.from} – {data.snapshot.scope.through} · Current category membership
            · USD
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
            ["Gross", group?.grossCents],
            ["Reimbursable portion", group?.reimbursementAdjustmentCents],
            ["Still owed", group?.reimbursementOutstandingCents],
            ["Matched refunds", group?.refundAdjustmentCents],
            ["Net spending", group?.netCents],
            ["Pending included", group?.pendingCents],
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
