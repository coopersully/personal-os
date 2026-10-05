import { PlusIcon } from "@/components/icons";
import { Button as ShadcnButton } from "@/components/ui/button";

export function FinanceAddTransactionButton({ onSelect }: { onSelect?: () => void }) {
  return (
    <ShadcnButton
      aria-label="Add transaction"
      onClick={() => {
        onSelect?.();
        window.location.hash = "finance-add-transaction";
      }}
      size="sm"
    >
      <PlusIcon aria-hidden="true" data-icon="inline-start" /> <span>Add transaction</span>
    </ShadcnButton>
  );
}
