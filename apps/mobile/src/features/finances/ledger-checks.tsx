import { ApiClientError } from "@personal-os/api-client";
import type { FinanceAlert } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useFinance, useFinanceRead } from "./data";
import { appliedRecord, confirmedRejection } from "./mutations";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

/** The ledger's consistency checks and the alerts they raised. */
export function LedgerChecks() {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const health = useFinanceRead(["ledger-health"], (api) => api.getFinanceLedgerHealth());
  const alerts = useFinanceRead(["alerts"], (api) => api.listFinanceAlerts());
  const [running, setRunning] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const busy = useRef(false);
  const active = useRef(true);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = () => active.current && currentOwner.current === owner;

  async function run() {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    const id = toast.loading("Running ledger checks…");
    try {
      const results = await Promise.all([health.refetch(), alerts.refetch()]);
      if (!current()) return void toast.dismiss(id);
      if (results.some((result) => result.isError))
        toast.error("Couldn’t run the ledger checks. The figures shown may be out of date.", {
          id,
        });
      else toast.success("Ledger checks updated", { id });
    } finally {
      busy.current = false;
      if (active.current) setRunning(false);
    }
  }

  async function decide(alert: FinanceAlert, action: "dismiss" | "resolve") {
    if (!owner || busy.current) return;
    busy.current = true;
    setDeciding(alert.id);
    const id = toast.loading("Updating alert…");
    try {
      const outcome = await api.resolveFinanceAlert(alert.id, { action, rationale: null });
      const saved = appliedRecord<FinanceAlert>(outcome);
      if (!current()) return void toast.dismiss(id);
      if (saved?.status === (action === "dismiss" ? "dismissed" : "resolved"))
        toast.success(action === "dismiss" ? "Alert dismissed" : "Alert resolved", { id });
      else if (!saved && outcome.status === "needs_input")
        toast.info("Not applied. nohmi needs an answer from you before this change can go ahead.", {
          id,
        });
      else toast.info("Not applied. This change is waiting for review.", { id });
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      toast.error(
        error instanceof ApiClientError && error.status === 404
          ? "This alert is no longer available. Nothing was changed."
          : confirmedRejection(error)
            ? "Couldn’t update this alert. Nothing was changed."
            : "Couldn’t confirm the change. Check your alerts before trying again.",
        { id },
      );
    } finally {
      // Applied, rejected or unknown, the list is read again rather than assumed.
      void client.invalidateQueries({ queryKey: ["finances", owner, "alerts"] });
      busy.current = false;
      if (active.current) setDeciding(null);
    }
  }

  const checks = health.data;
  const locked = running || deciding !== null;
  const flag = (value: number) => (value > 0 ? ("attention" as const) : undefined);
  return (
    <FinanceScreen title="Ledger checks">
      <Stack.Screen options={{ title: "ledger checks" }} />
      <SettingsAccentProvider workspace="finances">
        <ReadState query={health}>
          {checks ? (
            <>
              <Card rows>
                <FinanceRow
                  title="Unconfirmed transfers"
                  subtitle="Movements that look like transfers but are not confirmed."
                  value={String(checks.candidateTransfers)}
                  valueTone={flag(checks.candidateTransfers)}
                  icon="refresh"
                />
                <FinanceRow
                  title="Possible duplicates"
                  subtitle="Transactions that may be recorded twice."
                  value={String(checks.possibleDuplicates)}
                  valueTone={flag(checks.possibleDuplicates)}
                  icon="categoryLayers"
                />
                <FinanceRow
                  title="Classification sources missing"
                  subtitle="Categories with no record of where they came from."
                  value={String(checks.missingProvenance)}
                  valueTone={flag(checks.missingProvenance)}
                  icon="info"
                />
                <FinanceRow
                  centered
                  title="Pending transactions"
                  value={String(checks.pendingTransactions)}
                  icon="clock"
                />
                <FinanceRow
                  centered
                  title="Accounts needing an update"
                  value={String(checks.staleAccounts)}
                  valueTone={flag(checks.staleAccounts)}
                  icon="finances"
                />
                <FinanceRow
                  centered
                  title="Balance-only accounts"
                  value={String(checks.balanceOnlyAccounts)}
                  icon="finances"
                />
                <FinanceRow
                  centered
                  title="Unresolved reviews"
                  value={String(checks.unresolvedReviews)}
                  icon="history"
                  onPress={() =>
                    router.push({ pathname: "/finance-reviews", params: { view: "backlog" } })
                  }
                />
              </Card>
              <Copy secondary>{`Checked ${new Date(checks.asOf).toLocaleString()}.`}</Copy>
            </>
          ) : (
            <Copy secondary>Ledger checks are unavailable.</Copy>
          )}
        </ReadState>
        <Actions inset={false}>
          <Action label="Run checks again" disabled={locked} onPress={() => void run()} />
        </Actions>
        <Section title="Alerts">
          <ReadState query={alerts}>
            <View style={{ gap: 12 }}>
              {alerts.data?.length ? (
                alerts.data.map((alert) => (
                  <Card key={alert.id}>
                    <Copy>{alert.title}</Copy>
                    <Copy secondary>{alert.body}</Copy>
                    <Actions inset={false}>
                      <Action
                        label="Mark resolved"
                        accessibilityLabel={`Mark ${alert.title} resolved`}
                        disabled={locked}
                        onPress={() => void decide(alert, "resolve")}
                      />
                      <Action
                        label="Dismiss"
                        accessibilityLabel={`Dismiss ${alert.title}`}
                        destructive
                        disabled={locked}
                        onPress={() => void decide(alert, "dismiss")}
                      />
                    </Actions>
                  </Card>
                ))
              ) : (
                <Copy secondary>No open financial alerts.</Copy>
              )}
            </View>
          </ReadState>
        </Section>
      </SettingsAccentProvider>
    </FinanceScreen>
  );
}
