import type {
  FinanceBudgetBaselineReview,
  FinanceSpendingMonthlyBudget,
  User,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { formatMoney } from "./format";

export function SpendingMonthlyBudgetContext({
  budget,
}: {
  budget: FinanceSpendingMonthlyBudget | undefined;
}) {
  if (!budget || budget.state === "unavailable") {
    const reasons: Record<string, string> = {
      multi_month_selection: "the selection spans multiple months",
      qualification_required: "the month's account and currency scope needs human confirmation",
      baseline_missing: "no baseline is available for this month",
      baseline_incomplete: "the baseline is incomplete",
      scope_unavailable: "the budget scope is unavailable",
      unsupported_currency: "the budget currency is unsupported",
      category_identity_unresolved: "some category identities are unresolved",
      recognition_unresolved: "some spending recognition is unresolved",
    };
    return (
      <p className="text-sm text-muted-foreground">
        Monthly budget comparison unavailable:{" "}
        {budget ? reasons[budget.reason] : "budget account and currency scope is not established"}.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      <p>
        Monthly budget used · all budget accounts
        {budget.includesPending ? " · includes pending" : " · posted only"}
      </p>
      <p>
        {budget.month} · {budget.period.from} – {budget.period.through} · {budget.period.timezone} ·{" "}
        {budget.currency} · {budget.basis === "personal_cost" ? "Personal cost" : "Full outflow"}
        {budget.subtractsRefunds ? " · matched refunds subtracted" : " · refunds not subtracted"}
      </p>
      <p>
        {budget.coverage === "complete"
          ? "Complete recorded coverage"
          : budget.coverage === "partial"
            ? "Observed usage · incomplete history"
            : "Observed usage · historical coverage unknown"}
      </p>
      {budget.qualificationKind === "retrospective" ? (
        <p>
          Confirmed later · {budget.confirmedAt}. This records a later confirmation of this month's
          scope; it does not establish original human approval.
        </p>
      ) : (
        <p>Scope confirmed · {budget.confirmedAt}</p>
      )}
    </div>
  );
}

export function SpendingBudgetQualification({
  month,
  timezone,
  sourceRevision,
  ownerId,
}: {
  month: string;
  timezone: string;
  sourceRevision: string;
  ownerId: string;
}) {
  const cache = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const read = useQuery({
    queryKey: ["finance-budget-qualification", ownerId, month, sourceRevision],
    enabled: expanded,
    queryFn: () => api.getFinanceBudgetBaselineQualification(month),
  });
  const accounts = useQuery({
    queryKey: ["finance-budget-qualification-accounts", ownerId],
    enabled: expanded,
    queryFn: () => api.listFinanceAccounts(),
  });
  const [version, setVersion] = useState<string | null>(null);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [usd, setUsd] = useState(false);
  const [preview, setPreview] = useState<FinanceBudgetBaselineReview | null>(null);
  const attempt = useRef<{ signature: string; prepare: string; confirm: string } | null>(null);
  const signature = JSON.stringify({
    month,
    timezone,
    sourceRevision,
    version,
    accountIds: [...accountIds].sort(),
    usd,
    read: read.data,
    readState: read.status,
    accountState: accounts.status,
    accounts: accounts.data?.accounts.map((account) => [
      account.id,
      account.updatedAt,
      account.currencyCode,
      account.ownershipType,
      account.ownershipShare,
    ]),
  });
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  // biome-ignore lint/correctness/useExhaustiveDependencies: source and form signature invalidates the exact human preview.
  useEffect(() => {
    setPreview(null);
    attempt.current = null;
  }, [signature]);
  const currentOwner = () => cache.getQueryData<User>(["me"])?.id === ownerId;
  const prepare = useFeedbackMutation({
    feedback: {
      action: "prepare monthly budget scope",
      pending: "Preparing budget scope preview",
      success: "Budget scope preview ready",
      safeToRetry: false,
    },
    mutationFn: async (input: { signature: string; idempotencyKey: string }) => {
      if (!currentOwner() || !version || !usd || !accountIds.length)
        throw new Error("Selection changed");
      const result = await api.prepareFinanceBudgetBaselineQualification({
        accountIds,
        budgetVersionId: version,
        currency: "USD",
        idempotencyKey: input.idempotencyKey,
        month,
        timezone,
      });
      if (
        result.snapshot.budgetVersionId !== version ||
        result.snapshot.month !== month ||
        result.snapshot.currency !== "USD" ||
        result.snapshot.period.timezone !== timezone ||
        JSON.stringify([...result.snapshot.accountIds].sort()) !==
          JSON.stringify([...accountIds].sort())
      )
        throw new Error("Preview scope changed");
      return result;
    },
    onSuccess: (result, input) => {
      if (currentOwner() && input.signature === currentSignature.current) setPreview(result);
    },
  });
  const confirm = useFeedbackMutation({
    feedback: {
      action: "confirm monthly budget scope",
      pending: "Confirming monthly budget scope",
      success: "Monthly budget scope confirmed",
      safeToRetry: false,
    },
    mutationFn: async (input: {
      reviewId: string;
      expectedFingerprint: string;
      idempotencyKey: string;
    }) => {
      if (
        !currentOwner() ||
        !preview ||
        preview.id !== input.reviewId ||
        preview.fingerprint !== input.expectedFingerprint ||
        attempt.current?.signature !== currentSignature.current
      )
        throw new Error("Preview changed");
      const result = await api.confirmFinanceBudgetBaselineQualification(input);
      if (result.state !== "qualified") throw new Error("Qualification unavailable");
      return result;
    },
    onSuccess: async () => {
      if (!currentOwner()) return;
      setPreview(null);
      await cache.invalidateQueries({
        predicate: (query) =>
          String(query.queryKey[0]).startsWith("finance-spending") ||
          String(query.queryKey[0]).startsWith("finance-budget-qualification"),
      });
    },
  });
  const busy = prepare.isPending || confirm.isPending;
  const candidates = read.data?.state === "unavailable" ? read.data.candidates : [];
  const sourceReady = read.isSuccess && accounts.isSuccess;
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm">Confirm this month's budget scope</summary>
      <div className="flex flex-col gap-4 py-3">
        <p className="text-sm text-muted-foreground">
          Choose the exact budget version, accounts, and currency to review. This confirms a monthly
          comparison scope and does not approve or rewrite a budget.
        </p>
        <QueryFeedback query={read} title="Couldn’t load monthly budget candidates." />
        <QueryFeedback query={accounts} title="Couldn’t load your budget accounts." />
        {read.data?.state === "qualified" ? (
          <p>This month already has a confirmed scope. Refresh Spending to load its comparison.</p>
        ) : null}
        <fieldset disabled={!sourceReady || busy} className="flex flex-col gap-3">
          <legend>Budget version · explicit selection required</legend>
          {candidates.length ? (
            candidates.map((candidate) => (
              <Button
                key={candidate.budgetVersionId}
                variant={version === candidate.budgetVersionId ? "secondary" : "ghost"}
                aria-pressed={version === candidate.budgetVersionId}
                onClick={() => setVersion(candidate.budgetVersionId)}
              >
                Version {candidate.budgetVersion} · recorded approval {candidate.approvedAt} · actor{" "}
                {candidate.originalActorType ?? "unknown"}
              </Button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              {read.isSuccess
                ? "No qualifying budget versions are available for this month."
                : "Loading budget versions"}
            </p>
          )}
        </fieldset>
        <fieldset disabled={!sourceReady || busy} className="flex flex-col gap-2">
          <legend>Budget accounts · choose each account</legend>
          {accounts.data?.accounts.map((account) => (
            <label
              key={account.id}
              htmlFor={`budget-qualification-account-${account.id}`}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={`budget-qualification-account-${account.id}`}
                checked={accountIds.includes(account.id)}
                onCheckedChange={(checked) =>
                  setAccountIds((current) =>
                    checked === true
                      ? [...current, account.id]
                      : current.filter((id) => id !== account.id),
                  )
                }
              />
              {account.name} · {account.currencyCode ?? "Currency unspecified"}
            </label>
          ))}
        </fieldset>
        <fieldset disabled={!sourceReady || busy}>
          <legend>Budget currency · explicit selection required</legend>
          <Button
            variant={usd ? "secondary" : "ghost"}
            aria-pressed={usd}
            onClick={() => setUsd(!usd)}
          >
            USD · US dollars
          </Button>
        </fieldset>
        <p className="text-sm">
          Month {month} · Time zone {timezone}
        </p>
        <Button
          disabled={
            !sourceReady ||
            !version ||
            !accountIds.length ||
            !usd ||
            busy ||
            !candidates.some((candidate) => candidate.budgetVersionId === version)
          }
          onClick={() => {
            if (!attempt.current || attempt.current.signature !== signature)
              attempt.current = {
                signature,
                prepare: crypto.randomUUID(),
                confirm: crypto.randomUUID(),
              };
            prepare.mutate({ signature, idempotencyKey: attempt.current.prepare });
          }}
        >
          Preview exact monthly scope
        </Button>
        {preview ? (
          <section aria-label="Monthly budget scope preview" className="flex flex-col gap-3">
            <h3 className="font-medium">Review exact monthly scope</h3>
            <p>
              {preview.snapshot.period.from} – {preview.snapshot.period.through} ·{" "}
              {preview.snapshot.period.timezone} · {preview.snapshot.currency}
            </p>
            <p>
              Budget version {preview.snapshot.budgetVersion} · {preview.snapshot.month}
            </p>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Source snapshot references
              </summary>
              <p className="break-all text-xs">
                Version {preview.snapshot.budgetVersionId} · Plan {preview.snapshot.planId} ·
                Baseline {preview.snapshot.sourceBaselineId ?? "No prior baseline"}
              </p>
              <ul>
                {preview.snapshot.allocations.map((allocation) => (
                  <li key={allocation.key} className="break-all text-xs">
                    {allocation.label}: {allocation.key} · Category{" "}
                    {allocation.categoryId ?? allocation.legacyCategory ?? "Unspecified"}
                  </li>
                ))}
              </ul>
            </details>
            <ul>
              {preview.snapshot.accountIds.map((id) => (
                <li key={id}>
                  {accounts.data?.accounts.find((account) => account.id === id)?.name ??
                    "Unavailable account"}{" "}
                  · {id}
                </li>
              ))}
            </ul>
            <ul aria-label="Exact budget allocations">
              {preview.snapshot.allocations.map((allocation) => (
                <li key={allocation.key}>
                  {allocation.label} · {formatMoney(allocation.amountCents / 100)} ·{" "}
                  {allocation.amountCents} cents
                </li>
              ))}
            </ul>
            <p>
              Original recorded approval:{" "}
              {preview.snapshot.originalApproval.approvedAt ?? "Unknown"} · actor{" "}
              {preview.snapshot.originalApproval.actorType ?? "unknown"}
              {preview.snapshot.originalApproval.actorId
                ? ` · ${preview.snapshot.originalApproval.actorId}`
                : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              For a historical month, this is a later confirmation of its account and currency
              scope. It does not establish that a human approved the original budget at that time.
            </p>
            <Button
              disabled={busy || !sourceReady || attempt.current?.signature !== signature}
              onClick={() => {
                if (attempt.current)
                  confirm.mutate({
                    reviewId: preview.id,
                    expectedFingerprint: preview.fingerprint,
                    idempotencyKey: attempt.current.confirm,
                  });
              }}
            >
              Confirm this exact monthly scope
            </Button>
          </section>
        ) : null}
      </div>
    </details>
  );
}
