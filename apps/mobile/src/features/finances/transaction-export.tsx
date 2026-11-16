import type { FinanceTransaction } from "@personal-os/domain";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { Action } from "../../components/forms/form-rows";
import { useFinance } from "./data";
import { canShareFiles, shareCsv } from "./finance-files";
import { localToday } from "./mutations";
import { collectTransactions, exportLimit, transactionsCsv } from "./transaction-csv";

/**
 * Exports the transaction view that is on screen: every page of it, not only the rows loaded
 * so far. The CSV goes to the system share sheet and nowhere else.
 */
export function ExportTransactions({
  page,
  view,
  disabled,
}: {
  /**
   * Identifies the view on screen. An export shares the view it was started for only while
   * that view is still the one shown; after a filter, search or account change it stops.
   */
  view: string;
  /** Reads one page of the current view, exactly as the list does. */
  page: (
    cursor: string | undefined,
  ) => Promise<{ items: FinanceTransaction[]; nextCursor?: string | null }>;
  disabled: boolean;
}) {
  const { owner, timezone } = useFinance();
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const active = useRef(true);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const currentView = useRef(view);
  currentView.current = view;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (!canShareFiles()) return null;

  async function run() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    const id = toast.loading("Preparing export…");
    const started = view;
    const current = () => active.current && currentOwner.current === owner;
    try {
      const { rows, truncated } = await collectTransactions(page);
      // An account change mid-read must not share the previous account's transactions.
      if (!current()) return void toast.dismiss(id);
      if (currentView.current !== started)
        return void toast.info("The view changed, so nothing was exported. Export again.", { id });
      if (rows.length === 0)
        return void toast.info("No transactions to export in this view.", { id });
      const day = timezone ? localToday(timezone) : new Date().toISOString().slice(0, 10);
      const outcome = await shareCsv(`nohmi-transactions-${day}.csv`, transactionsCsv(rows));
      const count = `${rows.length} ${rows.length === 1 ? "transaction" : "transactions"}`;
      if (outcome === "dismissed") toast.info("Export cancelled. Nothing was saved.", { id });
      else
        toast.success(
          truncated
            ? `Exported the first ${exportLimit.toLocaleString("en-US")} transactions of this view. Narrow the view to export the rest.`
            : `Exported ${count}`,
          { id },
        );
    } catch {
      toast.error("Couldn’t export these transactions. Nothing was saved.", { id });
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <Action
      label="Export"
      accessibilityLabel="Export transactions as CSV"
      disabled={disabled || pending}
      onPress={() => void run()}
    />
  );
}
