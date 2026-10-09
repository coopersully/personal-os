import type { FinanceAccount, FinanceTransaction } from "@personal-os/domain";
import type { ReactNode } from "react";
import { ActionButton as ShadcnButton } from "@/components/action-button";
import { Checkbox as ShadcnCheckbox } from "@/components/ui/checkbox";
import {
  Dialog as ShadcnDialog,
  DialogContent as ShadcnDialogContent,
  DialogDescription as ShadcnDialogDescription,
  DialogHeader as ShadcnDialogHeader,
  DialogTitle as ShadcnDialogTitle,
} from "@/components/ui/dialog";
import {
  Field as ShadcnField,
  FieldGroup as ShadcnFieldGroup,
  FieldLabel as ShadcnFieldLabel,
} from "@/components/ui/field";
import { formatMoney } from "./format";

export function AccountScopeDialog({
  disabled,
  feedback,
  onReset,
  accounts,
  onChange,
  onOpenChange,
  scope,
  selectedIds,
  transactions,
  viewOnly = false,
}: {
  disabled: boolean;
  feedback: ReactNode;
  onReset: (scope: "spend" | "cash" | "investments") => void;
  accounts: FinanceAccount[];
  onChange: (scope: "spend" | "cash" | "investments", id: string, checked: boolean) => void;
  onOpenChange: (open: boolean) => void;
  scope: "spend" | "cash" | "investments" | null;
  selectedIds: string[];
  transactions?: FinanceTransaction[];
  viewOnly?: boolean;
}) {
  if (!scope) return null;
  const eligible = accounts.filter(
    (account) => scope === "spend" || account.kind === (scope === "cash" ? "cash" : "investment"),
  );
  const title = viewOnly
    ? `${scope === "spend" ? "Spending" : scope === "cash" ? "Cash" : "Investment"} account view selections`
    : scope === "spend"
      ? "Accounts included in spending"
      : `Accounts included in ${scope ?? ""}`;
  const month = new Date().toISOString().slice(0, 7);
  return (
    <ShadcnDialog onOpenChange={onOpenChange} open={scope !== null}>
      <ShadcnDialogContent>
        <ShadcnDialogHeader>
          <ShadcnDialogTitle>{title}</ShadcnDialogTitle>
          <ShadcnDialogDescription>
            {viewOnly
              ? "These saved display selections do not change the financial position totals shown here, planning inclusion, or account meanings. "
              : "Selections are saved to your Finance workspace across devices. "}
            Use all eligible accounts includes newly added accounts; unchecking every account
            selects none.
          </ShadcnDialogDescription>
        </ShadcnDialogHeader>
        {feedback}
        <ShadcnButton
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => onReset(scope)}
        >
          Use all eligible accounts
        </ShadcnButton>
        <ShadcnFieldGroup>
          {eligible.map((account) => {
            const value =
              scope === "spend"
                ? (transactions ?? [])
                    .filter(
                      (item) =>
                        item.accountId === account.id &&
                        item.direction === "expense" &&
                        item.date.startsWith(month),
                    )
                    .reduce((sum, item) => sum + item.amount, 0)
                : (account.balance ?? 0);
            return (
              <ShadcnField key={account.id} orientation="horizontal">
                <ShadcnCheckbox
                  disabled={disabled}
                  checked={selectedIds.includes(account.id)}
                  id={`scope-${scope}-${account.id}`}
                  onCheckedChange={(checked) => onChange(scope, account.id, checked === true)}
                />
                <ShadcnFieldLabel htmlFor={`scope-${scope}-${account.id}`}>
                  {account.name}
                  {viewOnly ? null : ` · ${formatMoney(value)}`}
                </ShadcnFieldLabel>
              </ShadcnField>
            );
          })}
        </ShadcnFieldGroup>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
}
