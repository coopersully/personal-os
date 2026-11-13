import { ApiClientError } from "@personal-os/api-client";
import type { FinanceAccount } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { toast } from "sonner-native";
import { useFinance, useFinanceRead } from "./data";
import { InstitutionLogo } from "./institution-logo";
import { confirmedRejection } from "./mutations";
import { financeLabel } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

const observed = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "never");

function Identity({ account, count }: { account: FinanceAccount; count: number }) {
  return (
    <Card rows>
      <FinanceRow
        title={account.name}
        subtitle={[
          account.institution,
          account.accountMask ? `••${account.accountMask}` : "Account number unavailable",
        ].join(" · ")}
        leading={<InstitutionLogo account={account} />}
      />
      <FinanceRow centered title="Added" value={observed(account.createdAt)} icon="calendar" />
      <FinanceRow
        centered
        title="Last synced"
        value={`${observed(account.lastSyncedAt)} · ${financeLabel(account.synchronization.state)}`}
        valueTone={account.synchronization.state === "current" ? undefined : "attention"}
        icon="clock"
      />
      <FinanceRow centered title="Recorded transactions" value={String(count)} icon="receipt" />
    </Card>
  );
}

function Resolution({
  account,
  candidates,
}: {
  account: FinanceAccount;
  candidates: FinanceAccount[];
}) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  // The account kept must still be receiving current data from its institution.
  const eligible = candidates.filter(
    (candidate) =>
      candidate.provider === "plaid" &&
      candidate.status === "connected" &&
      candidate.synchronization.state === "current",
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const keepId = eligible.some((candidate) => candidate.id === chosen)
    ? chosen
    : eligible.length === 1
      ? eligible[0].id
      : null;
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const attempt = useRef<{ revision: string; key: string } | null>(null);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);
  const comparison = useFinanceRead(
    ["account-duplicate", account.id, keepId],
    (api) => api.getFinanceAccountDuplicatePreview(account.id, keepId ?? ""),
    !!keepId,
  );
  const result = comparison.data;
  const preview = result?.outcome === "completed" ? result.data : null;

  async function resolve() {
    if (!owner || !preview || busy.current) return;
    busy.current = true;
    setPending(true);
    if (attempt.current?.revision !== preview.revision)
      attempt.current = { revision: preview.revision, key: randomUUID() };
    const id = toast.loading("Stopping duplicate tracking…");
    try {
      const outcome = await api.resolveFinanceAccountDuplicate(account.id, {
        keepAccountId: preview.keptAccount.id,
        revision: preview.revision,
        idempotencyKey: attempt.current.key,
      });
      if (active.current !== owner) return void toast.dismiss(id);
      attempt.current = null;
      if (outcome.outcome !== "completed") {
        if (outcome.outcome === "failed") toast.error(outcome.communication.headline, { id });
        else toast.info(outcome.communication.headline, { id });
        void client.invalidateQueries({ queryKey: ["finances", owner] });
        return;
      }
      await client.invalidateQueries({ queryKey: ["finances", owner] });
      if (active.current !== owner) return void toast.dismiss(id);
      toast.success("Duplicate tracking stopped. Transaction history preserved.", { id });
      router.back();
    } catch (error) {
      if (active.current !== owner) return void toast.dismiss(id);
      const rejected = confirmedRejection(error);
      if (rejected) attempt.current = null;
      toast.error(
        error instanceof ApiClientError && error.status === 409
          ? "These accounts changed, so nothing was stopped. Review the refreshed comparison."
          : rejected
            ? "Couldn’t stop tracking this duplicate. Nothing was stopped."
            : "Couldn’t confirm tracking stopped. Check both accounts before retrying.",
        { id },
      );
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
    }
  }

  if (!eligible.length)
    return (
      <Copy secondary>
        A connected account with current synchronization is required. Reconnect or sync the account
        you want to keep first.
      </Copy>
    );
  return (
    <>
      <Section title="Account to keep tracking">
        <Card rows>
          {eligible.map((candidate) => (
            <FinanceRow
              key={candidate.id}
              title={candidate.name}
              subtitle={[
                candidate.institution,
                candidate.accountMask ? `••${candidate.accountMask}` : null,
                `Added ${observed(candidate.createdAt)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              value={candidate.id === keepId ? "Keeping" : undefined}
              accessibilityHint={
                candidate.id === keepId
                  ? "Selected as the account to keep tracking."
                  : "Selects this as the account to keep tracking."
              }
              leading={<InstitutionLogo account={candidate} />}
              onPress={pending ? undefined : () => setChosen(candidate.id)}
            />
          ))}
        </Card>
      </Section>
      {keepId ? (
        <ReadState query={comparison}>
          {preview ? (
            <>
              <Section title="Keep tracking">
                <Identity account={preview.keptAccount} count={preview.keptTransactionCount} />
              </Section>
              <Section title="Stop tracking">
                <Identity
                  account={preview.redundantAccount}
                  count={preview.redundantTransactionCount}
                />
              </Section>
              <Card rows>
                <FinanceRow
                  centered
                  title="In both accounts"
                  value={String(preview.overlappingTransactionCount)}
                  icon="categoryLayers"
                />
                <FinanceRow
                  centered
                  title={`Only in ${preview.redundantAccount.name}`}
                  value={String(preview.uniqueRedundantTransactionCount)}
                  valueTone={preview.uniqueRedundantTransactionCount ? "attention" : undefined}
                  accessibilityHint={
                    preview.uniqueRedundantTransactionCount
                      ? "These transactions leave planning when tracking stops."
                      : undefined
                  }
                  icon="receipt"
                />
              </Card>
              <Copy>
                {preview.match === "provider_identity"
                  ? "These accounts have matching provider details. Confirm they represent the same account."
                  : "These accounts may be duplicates. Confirm they represent the same account."}
              </Copy>
              <Copy secondary>
                Stopping tracking excludes {preview.redundantAccount.name} from planning and stops
                its updates. Its transaction history stays on that account and is not merged into
                the kept account, which can change past spending totals. This does not revoke
                provider access; other accounts on the shared connection stay connected.
              </Copy>
              <Card rows>
                <FinanceRow
                  title="Stop tracking duplicate"
                  subtitle={preview.redundantAccount.name}
                  icon="disconnected"
                  onPress={
                    pending
                      ? undefined
                      : () =>
                          Alert.alert(
                            `Stop tracking ${preview.redundantAccount.name}?`,
                            `${preview.keptAccount.name} stays tracked. ${
                              preview.uniqueRedundantTransactionCount === 1
                                ? "1 transaction"
                                : `${preview.uniqueRedundantTransactionCount} transactions`
                            } found only in ${preview.redundantAccount.name} ${
                              preview.uniqueRedundantTransactionCount === 1 ? "leaves" : "leave"
                            } planning.`,
                            [
                              { text: "Keep both", style: "cancel" },
                              {
                                text: "Stop tracking",
                                style: "destructive",
                                onPress: () => void resolve(),
                              },
                            ],
                          )
                  }
                />
              </Card>
            </>
          ) : (
            <Copy secondary>
              {result?.communication.headline ?? "This comparison is unavailable."}
            </Copy>
          )}
        </ReadState>
      ) : (
        <Copy secondary>Choose the account to keep before reviewing the comparison.</Copy>
      )}
    </>
  );
}

/** Compares possible duplicates in place and stops tracking the redundant account. */
export function FinanceAccountDuplicate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const account = query.data?.accounts.find((item) => item.id === id);
  const related = new Set(
    query.data?.accountSemantics?.possibleDuplicateGroups
      ?.filter((group) => group.accountIds.includes(id))
      .flatMap((group) => group.accountIds),
  );
  const candidates =
    query.data?.accounts.filter((item) => item.id !== id && related.has(item.id)) ?? [];
  return (
    <FinanceScreen title="Review duplicate">
      <Stack.Screen options={{ title: "duplicate account" }} />
      <ReadState query={query}>
        {!account ? (
          <Copy secondary>This account is unavailable.</Copy>
        ) : !candidates.length ? (
          <Copy secondary>{account.name} no longer has a possible duplicate.</Copy>
        ) : (
          <>
            <Copy secondary>
              Choose the account to keep, then review the comparison before nohmi stops tracking{" "}
              {account.name}.
            </Copy>
            <Resolution key={account.id} account={account} candidates={candidates} />
          </>
        )}
      </ReadState>
    </FinanceScreen>
  );
}
