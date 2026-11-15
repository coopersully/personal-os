import type { FinanceCategory, FinanceTransaction } from "@personal-os/domain";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { categoryLabel } from "./category-presentation";
import { useFinance } from "./data";
import { confirmedRejection, describeTally, tallyCategorizations } from "./mutations";

/** The server accepts at most this many decisions in one categorization. */
export const selectionLimit = 100;

const count = (total: number) => `${total} ${total === 1 ? "transaction" : "transactions"}`;

/**
 * Applies one category to the displayed records, each guarded by the revision that was on
 * screen. Every submission ends in `onSettled`, because even a lost response may have changed
 * records: the caller reloads before anything can be selected again.
 */
export function useBulkCategorize(onSettled: () => void) {
  const { api, owner } = useFinance();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);

  async function apply(category: FinanceCategory, records: readonly FinanceTransaction[]) {
    if (!owner || busy.current || !records.length || records.length > selectionLimit) return;
    busy.current = true;
    setPending(true);
    const id = toast.loading(`Categorizing ${count(records.length)}…`);
    const name = categoryLabel(category.name);
    try {
      const response = await api.applyFinanceCategorizations({
        decisions: records.map((item) => ({
          transactionId: item.id,
          expectedTransactionUpdatedAt: item.updatedAt,
          categoryId: category.id,
          confidence: 1,
          learnMerchant: "never" as const,
          rationale: "Categorized by the user in Transactions.",
        })),
      });
      if (active.current !== owner) return void toast.dismiss(id);
      if (!Array.isArray(response) && response.status !== "applied") {
        toast.info(
          response.status === "needs_input"
            ? "More input is needed. No categories were changed."
            : "Submitted for review. No categories were changed.",
          { id },
        );
        return;
      }
      const tally = tallyCategorizations(
        records.map((item) => item.id),
        Array.isArray(response) ? response : response.result,
      );
      if (tally.applied === records.length)
        toast.success(`${count(tally.applied)} categorized as ${name}`, { id });
      else {
        const message = `${tally.applied} of ${records.length} categorized as ${name}: ${describeTally(tally)}.`;
        // Sent to review is an outcome, not a fault; anything else needs a second look.
        if (tally.changed || tally.failed || tally.unconfirmed) toast.error(message, { id });
        else toast.info(message, { id });
      }
    } catch (error) {
      if (active.current !== owner) return void toast.dismiss(id);
      toast.error(
        confirmedRejection(error)
          ? "Couldn’t categorize these transactions. Nothing was changed."
          : "Couldn’t confirm the categories were saved. Check the reloaded transactions before trying again.",
        { id },
      );
    } finally {
      busy.current = false;
      if (active.current === owner) {
        setPending(false);
        onSettled();
      }
    }
  }
  return { pending, apply };
}
