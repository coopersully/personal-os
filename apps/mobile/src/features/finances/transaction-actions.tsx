import { ApiClientError } from "@personal-os/api-client";
import type { FinanceTransaction } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { toast } from "sonner-native";
import { editorActionsOptions } from "../../components/editor-header";
import type { RowAction } from "../../components/row-action-button";
import { useTheme } from "../../theme";
import { useFinance } from "./data";
import { confirmedRejection } from "./mutations";

/**
 * Top-right transaction actions. Remove is offered only where the server allows it: on a
 * transaction whose account is known to be manual. Imported records keep their evidence.
 */
export function TransactionActions({
  item,
  manualAccount,
}: {
  item: FinanceTransaction;
  manualAccount: boolean;
}) {
  const t = useTheme();
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const removeKey = useRef<string | null>(null);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);

  async function remove() {
    if (!owner || busy.current) return;
    busy.current = true;
    setPending(true);
    const id = toast.loading("Removing transaction…");
    // An unconfirmed removal keeps its key, so trying again cannot act twice.
    removeKey.current ??= randomUUID();
    const leave = async () => {
      router.back();
      // Everything derived from the ledger is re-read except the removed record itself, which
      // this screen still shows until it closes and would only fail to load.
      await client.invalidateQueries({
        queryKey: ["finances", owner],
        predicate: (entry) =>
          !(entry.queryKey[2] === "transaction" && entry.queryKey[3] === item.id),
      });
    };
    try {
      const result = await api.removeFinanceTransaction(item.id, {
        idempotencyKey: removeKey.current,
      });
      if (active.current !== owner) return void toast.dismiss(id);
      removeKey.current = null;
      if (result.outcome === "completed") {
        toast.success("Transaction removed", { id });
        await leave();
        return;
      }
      if (result.outcome === "failed") toast.error(result.communication.headline, { id });
      else toast.info(result.communication.headline, { id });
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    } catch (error) {
      if (active.current !== owner) return void toast.dismiss(id);
      if (confirmedRejection(error)) removeKey.current = null;
      if (error instanceof ApiClientError && error.status === 404) {
        toast.info("This transaction was already removed.", { id });
        await leave();
        return;
      }
      toast.error(
        confirmedRejection(error)
          ? "Couldn’t remove this transaction. It is still recorded."
          : "Couldn’t confirm the removal. Check Transactions before trying again.",
        { id },
      );
      // Rejected or unknown, the cached record may be stale.
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
    }
  }

  const actions: RowAction[] = [
    {
      id: "edit",
      label: "Edit transaction",
      icon: "edit",
      disabled: pending,
      onPress: () =>
        router.push({ pathname: "/finance-transaction-edit", params: { id: item.id } }),
    },
  ];
  if (manualAccount)
    actions.push({
      id: "remove",
      label: "Remove transaction",
      icon: "trash",
      destructive: true,
      disabled: pending,
      onPress: () =>
        Alert.alert(
          `Remove ${item.merchant}?`,
          "This deletes the transaction from your records. It cannot be undone.",
          [
            { text: "Keep transaction", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => void remove() },
          ],
        ),
    });
  return <Stack.Screen options={editorActionsOptions("Transaction actions", actions, t)} />;
}
