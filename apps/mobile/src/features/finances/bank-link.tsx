import type { FinanceAccount } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { useAuth } from "../auth/context";
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
 * A reconnect whose outcome is unknown keeps its key, so a retry cannot verify twice. Keys live
 * outside the screen, per person and account, because the screen may be left mid-attempt.
 */
const reconnectKeys = new Map<string, string>();

/**
 * Connects a bank, or signs in again for one account, through Plaid's native Link. One Sonner
 * toast follows the attempt from opening to the outcome the server confirmed, whether or not the
 * screen that started it is still open.
 */
export function useBankLink() {
  const { session } = useAuth();
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /** The session the attempt began in; a result for someone who has since signed out is dropped. */
  const began = useRef(session.epoch());
  const stale = () => session.epoch() !== began.current;

  async function exchange(id: string | number, bank: LinkedBank) {
    try {
      // A public token is exchanged once. An unconfirmed exchange is never sent again.
      const accounts = await api.exchangePlaidToken({
        publicToken: bank.publicToken,
        institution: bank.institution,
        metadata: { institutionId: bank.institutionId, accounts: bank.accounts },
      });
      if (stale()) return void toast.dismiss(id);
      toast.success(
        accounts.length
          ? `Connected ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}.`
          : "Bank connected. It shared no accounts.",
        { id },
      );
    } catch (error) {
      if (stale()) return void toast.dismiss(id);
      toast.error(
        confirmedRejection(error)
          ? `Nothing was connected.${reason(error)}`
          : "Couldn’t confirm the connection. Check Accounts before connecting again.",
        { id },
      );
    }
  }

  async function verify(id: string | number, account: FinanceAccount) {
    const slot = `${owner}:${account.id}`;
    const key = reconnectKeys.get(slot) ?? randomUUID();
    reconnectKeys.set(slot, key);
    try {
      await api.completePlaidReconnect(account.id, key);
      reconnectKeys.delete(slot);
      if (stale()) return void toast.dismiss(id);
      toast.success("Bank sign-in verified. A sync is scheduled.", { id });
    } catch (error) {
      if (confirmedRejection(error)) reconnectKeys.delete(slot);
      if (stale()) return void toast.dismiss(id);
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
    began.current = session.epoch();
    setPending(true);
    const unchanged = account ? "Nothing changed." : "Nothing was connected.";
    const id = toast.loading("Opening bank sign-in…");
    try {
      let token: string;
      try {
        const status = await api.getPlaidStatus();
        if (stale()) return void toast.dismiss(id);
        if (!status.available)
          return void toast.error(`Bank connections aren’t set up on this server. ${unchanged}`, {
            id,
          });
        token = await api.getPlaidLinkToken(account?.id, "ios");
      } catch (error) {
        if (stale()) return void toast.dismiss(id);
        return void toast.error(
          confirmedRejection(error)
            ? `Couldn’t start bank sign-in.${reason(error)}`
            : `Couldn’t start bank sign-in. ${unchanged}`,
          { id },
        );
      }
      if (stale()) return void toast.dismiss(id);
      let outcome: Awaited<ReturnType<typeof openBankLink>>;
      try {
        outcome = await openBankLink(token);
      } catch {
        if (stale()) return void toast.dismiss(id);
        return void toast.error(`Bank sign-in couldn’t open on this iPhone. ${unchanged}`, { id });
      }
      if (stale()) return void toast.dismiss(id);
      if (outcome.kind === "cancelled")
        return void toast.info(`Bank sign-in cancelled. ${unchanged}`, { id });
      if (outcome.kind === "failed")
        return void toast.error(`Bank sign-in didn’t finish. ${unchanged}`, { id });
      toast.loading(account ? "Verifying bank sign-in…" : "Connecting accounts…", { id });
      if (account) await verify(id, account);
      else await exchange(id, outcome.bank);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
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
