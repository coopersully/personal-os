import type { FinanceAccount } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { useFinance } from "./data";
import { confirmedRejection, trackingStopped } from "./mutations";
import { canLinkBank, type LinkedBank, openBankLink } from "./plaid-link";
import { FinanceRow } from "./ui";

/** The server's own reason for a refusal, when it gave one. */
function reason(error: { message?: string }) {
  const text = error.message?.trim();
  return text ? ` ${text}` : "";
}

/**
 * Connects a bank, or signs in again for one account, through Plaid's native Link. One Sonner
 * toast follows the attempt from opening to the outcome the server confirmed.
 */
export function useBankLink() {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  /** A reconnect whose outcome is unknown keeps its key, so a retry cannot verify twice. */
  const reconnectKey = useRef<{ accountId: string; key: string } | null>(null);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);

  async function exchange(id: string | number, bank: LinkedBank) {
    try {
      // A public token is exchanged once. An unconfirmed exchange is never sent again.
      const accounts = await api.exchangePlaidToken({
        publicToken: bank.publicToken,
        institution: bank.institution?.name.slice(0, 160) ?? null,
        metadata: {
          institutionId: bank.institution?.id ?? null,
          accounts: bank.accounts.slice(0, 100),
        },
      });
      if (active.current !== owner) return void toast.dismiss(id);
      toast.success(
        accounts.length
          ? `Connected ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}.`
          : "Bank connected. It shared no accounts.",
        { id },
      );
    } catch (error) {
      if (active.current !== owner) return void toast.dismiss(id);
      toast.error(
        confirmedRejection(error)
          ? `Nothing was connected.${reason(error)}`
          : "Couldn’t confirm the connection. Check Accounts before connecting again.",
        { id },
      );
    }
  }

  async function verify(id: string | number, account: FinanceAccount) {
    if (reconnectKey.current?.accountId !== account.id)
      reconnectKey.current = { accountId: account.id, key: randomUUID() };
    try {
      await api.completePlaidReconnect(account.id, reconnectKey.current.key);
      reconnectKey.current = null;
      if (active.current !== owner) return void toast.dismiss(id);
      toast.success("Bank sign-in verified. A sync is scheduled.", { id });
    } catch (error) {
      if (confirmedRejection(error)) reconnectKey.current = null;
      if (active.current !== owner) return void toast.dismiss(id);
      toast.error(
        confirmedRejection(error)
          ? `Couldn’t verify this bank sign-in.${reason(error)}`
          : "Couldn’t confirm the bank sign-in was verified. Check the account’s status before trying again.",
        { id },
      );
    }
  }

  /** Without an account this connects a new bank; with one it signs in again for that account. */
  async function start(account?: FinanceAccount) {
    if (!owner || busy.current) return;
    busy.current = true;
    setPending(true);
    const unchanged = account ? "Nothing changed." : "Nothing was connected.";
    const id = toast.loading("Opening bank sign-in…");
    try {
      let token: string;
      try {
        const status = await api.getPlaidStatus();
        if (active.current !== owner) return void toast.dismiss(id);
        if (!status.available)
          return void toast.error(`Bank connections aren’t set up on this server. ${unchanged}`, {
            id,
          });
        token = await api.getPlaidLinkToken(account?.id);
      } catch (error) {
        if (active.current !== owner) return void toast.dismiss(id);
        return void toast.error(
          confirmedRejection(error)
            ? `Couldn’t start bank sign-in.${reason(error)}`
            : `Couldn’t start bank sign-in. ${unchanged}`,
          { id },
        );
      }
      if (active.current !== owner) return void toast.dismiss(id);
      let outcome: Awaited<ReturnType<typeof openBankLink>>;
      try {
        outcome = await openBankLink(token);
      } catch {
        if (active.current !== owner) return void toast.dismiss(id);
        return void toast.error(`Bank sign-in couldn’t open on this iPhone. ${unchanged}`, { id });
      }
      if (active.current !== owner) return void toast.dismiss(id);
      if (outcome.kind === "cancelled")
        return void toast.info(`Bank sign-in cancelled. ${unchanged}`, { id });
      if (outcome.kind === "failed")
        return void toast.error(`Bank sign-in didn’t finish. ${unchanged}`, { id });
      toast.loading(account ? "Verifying bank sign-in…" : "Connecting accounts…", { id });
      if (account) await verify(id, account);
      else await exchange(id, outcome.bank);
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
      // Accounts, status and freshness are re-read whatever the outcome was.
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    }
  }
  return { pending, start };
}

/** Accounts tab entry: connect a bank or card through Plaid without leaving the app. */
export function ConnectBank() {
  const link = useBankLink();
  if (!canLinkBank()) return null;
  return (
    <Actions inset={false}>
      <Action
        label="Connect a bank"
        accessibilityLabel="Connect a bank or card with Plaid"
        disabled={link.pending}
        onPress={() => void link.start()}
      />
    </Actions>
  );
}

/** Whether this account's bank sign-in has lapsed and can be renewed here. */
export function needsBankSignIn(account: FinanceAccount) {
  return (
    account.provider === "plaid" && account.status === "needs_reauth" && !trackingStopped(account)
  );
}

/** Account page row: sign in again with the bank for an account that needs it. */
export function ReconnectBank({ account }: { account: FinanceAccount }) {
  const link = useBankLink();
  if (!canLinkBank() || !needsBankSignIn(account)) return null;
  return (
    <FinanceRow
      centered
      title="Reconnect account"
      subtitle={`Sign in with ${account.institution} again to resume updates.`}
      icon="refresh"
      onPress={() => void link.start(account)}
    />
  );
}
