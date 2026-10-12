import type { FinanceLedgerHealth } from "@personal-os/domain";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function FinanceTransactionChecks({
  health,
  error,
  retry,
}: {
  health?: FinanceLedgerHealth | undefined;
  error: boolean;
  retry: () => void;
}) {
  const [params] = useSearchParams();
  if (error)
    return (
      <p>
        Transaction checks could not load.{" "}
        <Button variant="ghost" onClick={retry}>
          Retry
        </Button>
      </p>
    );
  if (!health) return null;
  const checks = [
    [
      "Unconfirmed transfers",
      health.candidateTransfers,
      "Transfers without a confirmed matching transaction. Inspect the records before treating them as internal transfers.",
    ],
    [
      "Possible duplicates",
      health.possibleDuplicates,
      "Matching records in the same account. Nothing is removed automatically.",
    ],
    [
      "Classification sources missing",
      health.missingProvenance,
      "Older categories have no recorded source. Inspect their category evidence before relying on them.",
    ],
  ] as const;
  const activeChecks = checks.filter(([, count]) => count > 0);
  if (!activeChecks.length) return null;
  return (
    <Collapsible defaultOpen={params.has("checks")} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            Transaction checks
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="grid gap-3 rounded-lg bg-card p-4">
        {activeChecks.map(([label, count, description]) => (
          <div key={label} className="rounded-lg bg-secondary p-3">
            <p className="text-sm font-medium">
              {label} · {count}
            </p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        ))}
        <Button asChild variant="ghost" size="sm">
          <Link to="/finances/accounts">Account connections and balance coverage</Link>
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
