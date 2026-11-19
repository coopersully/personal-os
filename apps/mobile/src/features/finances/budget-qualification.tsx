import type {
  FinanceBudgetBaselineReview,
  FinanceBudgetBaselineSnapshot,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { EnumChoice } from "../../components/forms/enum-choice";
import { Action, Actions, ToggleRow } from "../../components/forms/form-rows";
import { PaddedSurfaceRows } from "../../components/forms/section-content";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { monthName, useCurrentSession, writeFailure } from "./budget-write";
import { useFinance, useFinanceRead } from "./data";
import { financeLabel, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

const day = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const sorted = (ids: readonly string[]) => JSON.stringify([...ids].sort());

/** The exact accounts, currency, period and spending allocations a month is measured against. */
function ScopeDetails({
  scope,
  accountName,
}: {
  scope: FinanceBudgetBaselineSnapshot;
  accountName: (id: string) => string;
}) {
  return (
    <>
      <Card rows>
        <FinanceRow title="Budget version" value={`Version ${scope.budgetVersion}`} icon="wallet" />
        <FinanceRow
          title="Period"
          subtitle={scope.period.timezone}
          value={`${scope.period.from} – ${scope.period.through}`}
          icon="calendar"
        />
        <FinanceRow title="Currency" value={scope.currency} icon="finances" />
        <FinanceRow
          title="Original approval"
          subtitle={
            scope.originalApproval.actorType
              ? financeLabel(scope.originalApproval.actorType)
              : "Actor unknown"
          }
          value={
            scope.originalApproval.approvedAt ? day(scope.originalApproval.approvedAt) : "Unknown"
          }
          icon="check"
        />
      </Card>
      <Section title="Accounts">
        <Card rows>
          {scope.accountIds.map((id) => (
            <FinanceRow key={id} title={accountName(id)} icon="finances" />
          ))}
        </Card>
      </Section>
      <Section title="Spending allocations">
        <Card rows>
          {scope.allocations.map((allocation) => (
            <FinanceRow
              key={allocation.key}
              title={allocation.label}
              value={formatMoney(allocation.amountCents / 100, scope.currency)}
              icon="categoryTags"
            />
          ))}
        </Card>
      </Section>
    </>
  );
}

/**
 * Confirms which approved version, accounts and currency a month's spending is compared with.
 * It records a comparison scope; it never approves or rewrites a budget.
 */
export function BudgetScope({ month }: { month: string }) {
  const { api, owner, timezone } = useFinance();
  const client = useQueryClient();
  const current = useCurrentSession();
  const read = useFinanceRead(
    ["budget-qualification", month],
    (api) => api.getFinanceBudgetBaselineQualification(month),
    !!timezone,
  );
  const accounts = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts(), !!timezone);
  const [version, setVersion] = useState<string | null>(null);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [usd, setUsd] = useState(false);
  const [preview, setPreview] = useState<FinanceBudgetBaselineReview | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  // One pair of keys per exact selection: a repeat of the same step is answered once.
  const attempt = useRef<{ selection: string; prepare: string; confirm: string } | null>(null);
  const selection = JSON.stringify({ month, timezone, version, accounts: sorted(accountIds), usd });
  const selectionNow = useRef(selection);
  selectionNow.current = selection;
  const source = JSON.stringify([
    read.data,
    accounts.data?.accounts.map((account) => [account.id, account.currencyCode]),
  ]);
  // A preview describes one selection over one state of the records; either changing voids it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the two signatures are the trigger.
  useEffect(() => {
    setPreview(null);
  }, [selection, source]);
  const candidates = read.data?.state === "unavailable" ? read.data.candidates : [];
  const accountName = (id: string) =>
    accounts.data?.accounts.find((account) => account.id === id)?.name ?? "Unavailable account";
  const ready =
    !!version &&
    accountIds.length > 0 &&
    usd &&
    candidates.some((candidate) => candidate.budgetVersionId === version);
  const keys = () => {
    if (attempt.current?.selection !== selection)
      attempt.current = { selection, prepare: randomUUID(), confirm: randomUUID() };
    return attempt.current;
  };

  async function run(message: string, step: (id: string | number) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    const id = toast.loading(message);
    try {
      await step(id);
    } finally {
      lock.current = false;
      if (current()) setPending(false);
    }
  }

  const prepare = () =>
    run("Preparing scope preview…", async (id) => {
      if (!ready || !version || !timezone) return void toast.dismiss(id);
      const sent = selection;
      try {
        const result = await api.prepareFinanceBudgetBaselineQualification({
          accountIds,
          budgetVersionId: version,
          currency: "USD",
          idempotencyKey: keys().prepare,
          month,
          timezone,
        });
        if (!current()) return void toast.dismiss(id);
        const scope = result.snapshot;
        if (
          scope.budgetVersionId !== version ||
          scope.month !== month ||
          scope.currency !== "USD" ||
          scope.period.timezone !== timezone ||
          sorted(scope.accountIds) !== sorted(accountIds)
        ) {
          attempt.current = null;
          toast.error("The preview did not match your selection. Nothing was confirmed.", { id });
          return;
        }
        if (sent !== selectionNow.current) return void toast.dismiss(id);
        setPreview(result);
        toast.success("Preview ready. Review it before confirming.", { id });
      } catch (error) {
        if (!current()) return void toast.dismiss(id);
        const failure = writeFailure(error);
        if (failure !== "unknown" && failure !== "in_progress") attempt.current = null;
        toast.error(
          failure === "conflict"
            ? "That version or those accounts can’t be previewed for this month. Check your selection."
            : failure === "unknown" || failure === "in_progress"
              ? "Couldn’t confirm the preview was prepared. Try again; it won’t be prepared twice."
              : "Couldn’t prepare the preview. Nothing was confirmed.",
          { id },
        );
      }
    });

  const confirm = () =>
    run("Confirming budget scope…", async (id) => {
      const reviewed = preview;
      if (!reviewed || attempt.current?.selection !== selection) return void toast.dismiss(id);
      try {
        const result = await api.confirmFinanceBudgetBaselineQualification({
          reviewId: reviewed.id,
          expectedFingerprint: reviewed.fingerprint,
          idempotencyKey: attempt.current.confirm,
        });
        if (!current()) return void toast.dismiss(id);
        if (result.state !== "qualified") {
          attempt.current = null;
          setPreview(null);
          void read.refetch();
          toast.error("The scope was not confirmed. Preview it again before confirming.", { id });
          return;
        }
        attempt.current = null;
        setPreview(null);
        await client.invalidateQueries({ queryKey: ["finances", owner] });
        if (!current()) return void toast.dismiss(id);
        toast.success(`Budget scope confirmed for ${monthName(month)}`, { id });
      } catch (error) {
        if (!current()) return void toast.dismiss(id);
        const failure = writeFailure(error);
        if (failure === "unknown" || failure === "in_progress") {
          // The scope may be recorded: show what the server has now, and keep the same key.
          void read.refetch();
          toast.error(
            "Couldn’t confirm the scope was recorded. Confirming again won’t record it twice.",
            { id },
          );
          return;
        }
        attempt.current = null;
        setPreview(null);
        void read.refetch();
        toast.error(
          failure === "conflict"
            ? "The scope changed since this preview. Preview it again before confirming."
            : "Couldn’t confirm this scope. Nothing was recorded.",
          { id },
        );
      }
    });

  if (!timezone)
    return (
      <FinanceScreen title="Budget scope">
        <Copy secondary>Set your account timezone in Settings to confirm a month’s scope.</Copy>
      </FinanceScreen>
    );
  const qualification = read.data?.state === "qualified" ? read.data.qualification : null;
  return (
    <SettingsAccentProvider workspace="finances">
      <FinanceScreen title="Budget scope">
        <Copy secondary>
          {`${monthName(month)} · ${timezone}. This confirms what the month’s spending is compared with. It does not approve or change a budget.`}
        </Copy>
        <ReadState query={read}>
          {qualification ? (
            <>
              <Copy>
                {qualification.qualificationKind === "retrospective"
                  ? `Scope confirmed later, on ${day(qualification.confirmedAt)}. This records a later confirmation of the month’s scope, not an approval made at the time.`
                  : `Scope confirmed ${day(qualification.confirmedAt)}.`}
              </Copy>
              <ScopeDetails scope={qualification} accountName={accountName} />
            </>
          ) : (
            <ReadState query={accounts}>
              {candidates.length ? (
                <>
                  <Card rows>
                    <PaddedSurfaceRows>
                      <EnumChoice
                        label="Budget version"
                        icon="wallet"
                        value={version}
                        valueLabel={version ? undefined : "Choose"}
                        disabled={pending}
                        options={candidates.map((candidate) => ({
                          value: candidate.budgetVersionId,
                          label: `Version ${candidate.budgetVersion} · approved ${day(candidate.approvedAt)}`,
                        }))}
                        onChange={setVersion}
                      />
                      <ToggleRow
                        label="US dollars (USD)"
                        detail="The currency this month is measured in"
                        value={usd}
                        disabled={pending}
                        onChange={setUsd}
                      />
                    </PaddedSurfaceRows>
                  </Card>
                  <Section title="Budget accounts">
                    <Card rows>
                      {accounts.data?.accounts.map((account) => (
                        <ToggleRow
                          key={account.id}
                          label={account.name}
                          detail={account.currencyCode ?? "Currency unspecified"}
                          value={accountIds.includes(account.id)}
                          disabled={pending}
                          onChange={(value) =>
                            setAccountIds((list) =>
                              value
                                ? [...list.filter((id) => id !== account.id), account.id]
                                : list.filter((id) => id !== account.id),
                            )
                          }
                        />
                      ))}
                    </Card>
                  </Section>
                  <Actions inset={false}>
                    <Action label="Preview scope" disabled={!ready || pending} onPress={prepare} />
                  </Actions>
                  {preview && (
                    <Section title="Review exact scope">
                      <ScopeDetails scope={preview.snapshot} accountName={accountName} />
                      <Copy secondary>
                        For a past month this is a later confirmation of its accounts and currency.
                        It does not show that the original budget was approved by a person then.
                      </Copy>
                      <Actions inset={false}>
                        <Action label="Confirm this scope" disabled={pending} onPress={confirm} />
                      </Actions>
                    </Section>
                  )}
                </>
              ) : (
                <Copy secondary>
                  No approved budget version can be confirmed for this month. Approve a plan that
                  covers it first.
                </Copy>
              )}
            </ReadState>
          )}
        </ReadState>
      </FinanceScreen>
    </SettingsAccentProvider>
  );
}
