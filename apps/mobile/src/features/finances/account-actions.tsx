import type { FinanceAccount } from "@personal-os/domain";
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
import { confirmedRejection, trackingStopped } from "./mutations";

/** Top-right account actions: edit, provider sync, duplicate review and stop tracking. */
export function AccountActions({
  account,
  duplicate,
}: {
  account: FinanceAccount;
  duplicate: boolean;
}) {
  const t = useTheme();
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const disconnectKey = useRef<string | null>(null);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);
  const tracked = account.provider === "plaid" && !trackingStopped(account);

  async function run(loading: string, action: (id: string | number) => Promise<void>) {
    if (!owner || busy.current) return;
    busy.current = true;
    setPending(true);
    const id = toast.loading(loading);
    try {
      await action(id);
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
      // Freshness, status and balances are re-read whatever the provider said.
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    }
  }
  const sync = () =>
    run("Syncing account…", async (id) => {
      try {
        const changed = await api.syncFinanceAccount(account.id);
        if (active.current !== owner) return void toast.dismiss(id);
        toast.success(
          changed
            ? `Account synced. ${changed} ${changed === 1 ? "record" : "records"} updated.`
            : "Account synced. Nothing new from the institution.",
          { id },
        );
      } catch (error) {
        if (active.current !== owner) return void toast.dismiss(id);
        toast.error(
          confirmedRejection(error)
            ? "This account couldn’t sync. Check its status before retrying."
            : "Couldn’t confirm the sync. It may still finish; check Updated before retrying.",
          { id },
        );
      }
    });
  const disconnect = () =>
    run("Stopping account tracking…", async (id) => {
      disconnectKey.current ??= randomUUID();
      try {
        const result = await api.disconnectFinanceAccount(account.id, {
          idempotencyKey: disconnectKey.current,
        });
        if (active.current !== owner) return void toast.dismiss(id);
        disconnectKey.current = null;
        if (result.outcome === "completed")
          toast.success("Account tracking stopped. History preserved.", { id });
        else if (result.outcome === "failed") toast.error(result.communication.headline, { id });
        else toast.info(result.communication.headline, { id });
      } catch (error) {
        if (active.current !== owner) return void toast.dismiss(id);
        if (confirmedRejection(error)) disconnectKey.current = null;
        toast.error(
          confirmedRejection(error)
            ? "Couldn’t stop tracking this account. It is still tracked."
            : "Couldn’t confirm tracking stopped. Check the account’s status before retrying.",
          { id },
        );
      }
    });
  const actions: RowAction[] = [
    {
      id: "edit",
      label: "Edit account",
      icon: "edit",
      disabled: pending,
      onPress: () => router.push({ pathname: "/finance-account-edit", params: { id: account.id } }),
    },
  ];
  if (tracked && account.status === "connected")
    actions.push({
      id: "sync",
      label: "Sync account",
      icon: "refresh",
      disabled: pending,
      onPress: () => void sync(),
    });
  if (duplicate)
    actions.push({
      id: "duplicate",
      label: "Review duplicate",
      icon: "categoryLayers",
      disabled: pending,
      onPress: () =>
        router.push({ pathname: "/finance-account-duplicate", params: { id: account.id } }),
    });
  if (tracked)
    actions.push({
      id: "disconnect",
      label: "Stop tracking account",
      icon: "disconnected",
      destructive: true,
      disabled: pending,
      onPress: () =>
        Alert.alert(
          `Stop tracking ${account.name}?`,
          "nohmi will stop using this account and keep its ledger history. Other accounts at this institution stay connected, and this does not revoke access at your institution. Reconnecting later requires your consent.",
          [
            { text: "Keep connected", style: "cancel" },
            { text: "Stop tracking", style: "destructive", onPress: () => void disconnect() },
          ],
        ),
    });
  return <Stack.Screen options={editorActionsOptions("Account actions", actions, t)} />;
}
