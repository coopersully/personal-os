import {
  type FinanceAccount,
  type FinanceRecurringObligation,
  idSchema,
  localDateAt,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "../../api.js";
import { RecurringCostConfirmation } from "./recurring-cost-confirmation.js";
import { RecurringCostLadder } from "./recurring-cost-ladder.js";

export function RecurringCostSection({
  obligations,
  accounts,
  renderActions,
}: {
  obligations: FinanceRecurringObligation[];
  accounts: Pick<FinanceAccount, "id" | "name" | "currencyCode">[];
  renderActions?: (item: FinanceRecurringObligation) => ReactNode;
}) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.getMe() });
  const [selection, setSelection] = useState<{
    item: FinanceRecurringObligation;
    open: boolean;
  } | null>(null);
  let context: { ownerUserId: string; today: string } | undefined;
  if (me.data?.planningTimezone && idSchema.safeParse(me.data.id).success) {
    try {
      const date = localDateAt(new Date(), me.data.planningTimezone);
      context = {
        ownerUserId: me.data.id,
        today: `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
      };
    } catch {
      /* Invalid timezone must not become an assumed planning date. */
    }
  }
  const selected = selection?.item ?? null;
  const account = selected ? accounts.find((item) => item.id === selected.accountId) : undefined;
  return (
    <>
      {!context ? (
        <p role="status">
          {me.isError || me.isSuccess
            ? "Account identity or planning timezone unavailable. Refresh before confirming costs."
            : "Loading account identity and planning date."}
        </p>
      ) : null}
      <RecurringCostLadder
        obligations={obligations}
        accounts={accounts}
        {...(renderActions ? { renderActions } : {})}
        {...(context ? { evidenceContext: context } : {})}
        renderConfirmation={(item, applicable) =>
          context &&
          item.revision &&
          (item.status === "active" || item.status === "needs_review") ? (
            <Button size="sm" variant="ghost" onClick={() => setSelection({ item, open: true })}>
              {applicable
                ? `Edit statement for ${item.displayName}`
                : `Confirm cost for ${item.displayName}`}
            </Button>
          ) : null
        }
      />
      {selection && selected && context ? (
        <RecurringCostConfirmation
          key={`${selected.id}:${selected.revision}`}
          item={selected}
          {...(account ? { account } : {})}
          today={context.today}
          open={selection.open}
          onClose={() => setSelection((current) => (current ? { ...current, open: false } : null))}
        />
      ) : null}
    </>
  );
}
