import { ApiClientError } from "@personal-os/api-client";
import {
  cashflowScheduleRange,
  type FinanceRecurringOccurrence,
  type FinanceRecurringSchedule,
  financeRecurringOccurrencesQuerySchema,
  formatDateOnly,
  localDateAt,
  localDateToIso,
  projectFinanceCashflowSchedule,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ContentSkeleton } from "@/components/content-skeleton";
import { Button } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { BalanceBasisForm } from "./balance-basis-form.js";
import { FinanceCashflowAgenda } from "./cashflow-agenda.js";
import { FinanceCashflowCalendar } from "./cashflow-calendar.js";
import {
  CashflowOccurrenceItem,
  CashflowPlanningControls,
  type CashflowPlanningRow as Row,
} from "./cashflow-planning-views.js";
import { FinanceDisclosure } from "./disclosure";
import { OccurrenceMatchDialog } from "./occurrence-match-dialog.js";
import { PaydayView } from "./payday-view.js";
import {
  RecurringScheduleForm,
  type RecurringScheduleFormProps,
} from "./recurring-schedule-form.js";

function denied(error: unknown) {
  return error instanceof ApiClientError && [401, 403].includes(error.status);
}
function PlanningAccessUnavailable() {
  return (
    <section aria-label="Upcoming money">
      <p>Cash flow planning access unavailable. Reload after access is restored.</p>
    </section>
  );
}
/** Changing authenticated owner remounts every private snapshot and opening statement together. */
export function FinanceCashflowPlanning({ accessDenied = false }: { accessDenied?: boolean }) {
  const me = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  if (accessDenied || denied(me.error)) return <PlanningAccessUnavailable />;
  if (!me.data)
    return me.error ? (
      <InlineError error={me.error} retry={() => void me.refetch()} />
    ) : (
      <Skeleton className="h-32 w-full" />
    );
  if (!me.data.planningTimezone) return <p>Planning timezone unavailable.</p>;
  return (
    <>
      {me.error ? <InlineError error={me.error} retry={() => void me.refetch()} stale /> : null}
      <OwnerCashflowPlanning key={me.data.id} user={me.data} />
    </>
  );
}
/** Canonical reads own revisions and eligibility; opening statements retain their exact snapshots. */
function OwnerCashflowPlanning({ user }: { user: Awaited<ReturnType<typeof api.getMe>> }) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [asOf] = useState(() => new Date());
  const timezone = user.planningTimezone;
  const ownerId = user.id;
  const defaults = timezone ? cashflowScheduleRange(asOf.toISOString(), timezone) : null;
  const accountParam = params.get("cashflowAccounts");
  const accountIds =
    accountParam === null ? undefined : accountParam === "none" ? [] : accountParam.split(",");
  const parsed = financeRecurringOccurrencesQuerySchema.safeParse({
    from: params.get("cashflowFrom") ?? defaults?.from,
    to: params.get("cashflowTo") ?? defaults?.to,
    accountIds,
  });
  const query = parsed.success ? parsed.data : null;
  const enabled = Boolean(query && timezone && ownerId);
  const sources = useQuery({
    queryKey: ["finance-cashflow-sources", ownerId, query],
    queryFn: () => {
      if (!query) throw new Error("Choose a valid date range.");
      return api.listFinanceCashflowSources(query);
    },
    enabled,
  });
  const schedules = useQuery({
    queryKey: ["finance-recurring-schedules", ownerId],
    queryFn: api.listFinanceRecurringSchedules,
    enabled,
  });
  const bases = useQuery({
    queryKey: ["finance-balance-bases", ownerId, accountIds],
    queryFn: () => api.listFinanceBalanceBases(accountIds),
    enabled,
  });
  const accounts = useQuery({
    queryKey: ["finance-accounts", ownerId],
    queryFn: () => api.listFinanceAccounts({ includeExcluded: true }),
    enabled: Boolean(ownerId),
  });
  const selectedIncome = params.get("paydayIncome");
  const projection = useQuery({
    queryKey: ["finance-cashflow-projection", ownerId, query, selectedIncome],
    queryFn: () => {
      if (!query) throw new Error("Choose a valid date range.");
      return api.getFinanceCashflowProjection({ ...query, selectedIncomeStreamId: selectedIncome });
    },
    enabled,
  });
  const [scheduleForm, setScheduleForm] = useState<Omit<
    RecurringScheduleFormProps,
    "onClose" | "onSaved"
  > | null>(null);
  const [balanceAccountId, setBalanceAccountId] = useState<string | null>(null);
  const [agendaPage, setAgendaPage] = useState(0);
  const [sourceLimit, setSourceLimit] = useState(20);
  const [historyLimit, setHistoryLimit] = useState(50);
  const [match, setMatch] = useState<FinanceRecurringOccurrence | null>(null);
  const [denialObserved, setDenialObserved] = useState(false);
  const review = useQuery({
    queryKey: ["finance-balance-basis-sources", ownerId, balanceAccountId],
    queryFn: () =>
      api.listFinanceBalanceBasisSources({
        accountIds: balanceAccountId ? [balanceAccountId] : [],
      }),
    enabled: enabled && balanceAccountId !== null,
  });
  const accessDenied =
    denialObserved ||
    [
      sources.error,
      schedules.error,
      bases.error,
      projection.error,
      review.error,
      accounts.error,
    ].some(denied);
  useEffect(() => {
    if (accessDenied) {
      // Dismissing a review changes its query key, but cannot restore revoked access.
      // Only this authenticated owner's remount may discard an observed denial.
      setDenialObserved(true);
      setScheduleForm(null);
      setBalanceAccountId(null);
      setMatch(null);
    }
  }, [accessDenied]);
  const setParam = (key: string, value: string | null) => {
    setAgendaPage(0);
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next);
  };
  const refresh = async () => {
    await client.invalidateQueries({
      predicate: (q) => String(q.queryKey[0]).startsWith("finance-"),
    });
  };
  if (accessDenied) return <PlanningAccessUnavailable />;
  const today = localDateToIso(localDateAt(asOf, timezone));
  const current =
    projection.data?.schedule.occurrences.filter((item) => item.inCurrentSchedule) ?? [];
  const confirmedSources = new Set([
    ...current.map((item) => `${item.source.kind}:${item.source.id}`),
    ...(schedules.data ?? [])
      .filter((version) => {
        const records =
          version.source.kind === "income" ? sources.data?.income : sources.data?.obligations;
        return (
          records?.some(
            (record) =>
              record.id === version.source.id && record.revision === version.sourceRevision,
          ) &&
          query &&
          version.effectiveFrom <= query.to
        );
      })
      .map((version) => `${version.source.kind}:${version.source.id}`),
  ]);
  const snapshot = sources.data;
  const fallback =
    query && snapshot
      ? projectFinanceCashflowSchedule({
          ...query,
          timezone,
          asOf: asOf.toISOString(),
          income: snapshot.income,
          obligations: snapshot.obligations,
          accounts: snapshot.accounts,
        })
      : null;
  const occurrenceRow = (occurrence: FinanceRecurringOccurrence): Row => {
    const version = schedules.data?.find((item) => item.id === occurrence.scheduleVersionId);
    const record = (
      occurrence.source.kind === "income" ? snapshot?.income : snapshot?.obligations
    )?.find((item) => item.id === occurrence.source.id);
    return {
      key: occurrence.key,
      date: occurrence.localDate,
      source: occurrence.source,
      displayName: occurrence.displayName,
      currency: occurrence.currencyCode,
      amountCents: occurrence.expectedAmountCents,
      occurrence,
      cadence: version?.cadence ?? null,
      scheduleTimezone: version?.timezone ?? null,
      recordedAt: version?.recordedAt ?? null,
      lastObservedDate: record?.lastObservedDate ?? null,
    };
  };
  const rows: Row[] = [
    ...current.map(occurrenceRow),
    ...(fallback
      ? [...fallback.dated, ...fallback.undated]
          .filter((item) => !confirmedSources.has(`${item.source.kind}:${item.source.id}`))
          .map((item) => ({
            key: item.key,
            date: item.date,
            source: item.source,
            displayName: item.displayName,
            currency: item.currencyCode,
            amountCents: Math.round(item.expectedAmount * 100),
            occurrence: null,
            cadence: item.cadence,
            scheduleTimezone: null,
            recordedAt: null,
            lastObservedDate: item.lastObservedDate,
          }))
      : []),
  ].sort(
    (a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.key.localeCompare(b.key),
  );
  const openSchedule = (source: Row["source"]) => {
    if (!snapshot || !schedules.data) return;
    const record = (source.kind === "income" ? snapshot.income : snapshot.obligations).find(
      (item) => item.id === source.id,
    );
    if (!record) return;
    const versions = schedules.data.filter(
      (item) => item.source.kind === source.kind && item.source.id === source.id,
    );
    const superseded = new Set(versions.map((item) => item.supersedesId));
    const latest: FinanceRecurringSchedule | null =
      versions.find((item) => !superseded.has(item.id)) ?? null;
    setScheduleForm({
      source,
      sourceName: record.displayName,
      expectedSourceRevision: record.revision,
      supersedes: latest,
      accounts: snapshot.accounts,
    });
  };
  const presentation = params.get("timeline") ?? "agenda";
  const pageRows = presentation === "calendar" ? rows.filter((row) => row.date === null) : rows;
  const visiblePage = Math.min(agendaPage, Math.max(0, Math.ceil(pageRows.length / 50) - 1));
  const visibleRows = pageRows.slice(visiblePage * 50, (visiblePage + 1) * 50);
  const scheduleSources = snapshot
    ? [
        ...snapshot.income.map((item) => ({ item, kind: "income" as const })),
        ...snapshot.obligations.map((item) => ({ item, kind: "obligation" as const })),
      ].filter(({ item }) => ["active", "needs_review"].includes(item.status))
    : [];
  const renderRow = (row: Row) => (
    <CashflowOccurrenceItem
      key={row.key}
      row={row}
      canSchedule={Boolean(snapshot && schedules.data)}
      canInspect={Boolean(snapshot)}
      onSchedule={openSchedule}
      onMatch={setMatch}
    />
  );
  const balanceAccount = review.data?.accounts.find((account) => account.id === balanceAccountId);
  const historical =
    projection.data?.schedule.occurrences.filter((item) => !item.inCurrentSchedule) ?? [];
  return (
    <section aria-label="Upcoming money" className="flex min-w-0 flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Upcoming money</h2>
        <p className="text-sm text-muted-foreground">
          Expected income and payments, with matched receipts kept separate. Unconfirmed records
          show only their next source date.
        </p>
        <FinanceDisclosure title="Date scope">
          <p>
            Occurrence dates use each schedule’s recorded timezone; today uses {timezone}. Neither
            view proves fresh bank data.
          </p>
        </FinanceDisclosure>
      </div>
      {snapshot?.coverage.truncated ? (
        <p role="status" className="text-sm text-muted-foreground">
          This source read reached its limit. The agenda, calendar and counts show a partial set;
          narrow the date range or account selection, then refresh to review omitted sources.
        </p>
      ) : null}
      <CashflowPlanningControls
        from={params.get("cashflowFrom") ?? defaults?.from ?? ""}
        to={params.get("cashflowTo") ?? defaults?.to ?? ""}
        presentation={presentation}
        accountIds={accountIds}
        accounts={accounts.data?.accounts ?? []}
        onParamChange={setParam}
        onReset={() => {
          const next = new URLSearchParams(params);
          for (const key of ["cashflowFrom", "cashflowTo", "cashflowAccounts", "timeline"])
            next.delete(key);
          setAgendaPage(0);
          setParams(next);
        }}
      />
      {!query || !["agenda", "calendar"].includes(presentation) ? (
        <p>Choose a valid date range of at most 366 dates and an agenda or calendar view.</p>
      ) : (
        <>
          {sources.isError ? (
            <InlineError
              error={sources.error}
              retry={() => void sources.refetch()}
              stale={Boolean(snapshot)}
            />
          ) : null}
          {schedules.isError ? (
            <InlineError
              error={schedules.error}
              retry={() => void schedules.refetch()}
              stale={Boolean(schedules.data)}
            />
          ) : null}
          {bases.isError ? (
            <InlineError
              error={bases.error}
              retry={() => void bases.refetch()}
              stale={Boolean(bases.data)}
            />
          ) : null}
          {accounts.isError ? (
            <InlineError
              error={accounts.error}
              retry={() => void accounts.refetch()}
              stale={Boolean(accounts.data)}
            />
          ) : null}
          {projection.isError ? (
            <InlineError
              error={projection.error}
              retry={() => void projection.refetch()}
              stale={Boolean(projection.data)}
            />
          ) : null}
          {sources.isPending || projection.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : presentation === "calendar" ? (
            <FinanceCashflowCalendar
              schedule={{
                from: query.from,
                to: query.to,
                today,
                dated: rows.filter((row) => row.date !== null),
              }}
              renderItem={renderRow}
              itemLabel="scheduled occurrence"
              pageSize={50}
            />
          ) : (
            <FinanceCashflowAgenda
              schedule={{ dated: visibleRows.filter((row) => row.date !== null) }}
              renderItem={renderRow}
            />
          )}
          {visibleRows.some((row) => row.date === null) ? (
            <section aria-label="Undated items">
              <h3 className="text-sm font-medium">Date not established</h3>
              <ItemGroup>{visibleRows.filter((row) => row.date === null).map(renderRow)}</ItemGroup>
            </section>
          ) : null}
          {pageRows.length > 50 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={visiblePage === 0}
                onClick={() => setAgendaPage(visiblePage - 1)}
              >
                Previous items
              </Button>
              <span className="text-sm">
                Page {visiblePage + 1} of {Math.ceil(pageRows.length / 50)} · {pageRows.length}{" "}
                items
              </span>
              <Button
                variant="outline"
                disabled={(visiblePage + 1) * 50 >= pageRows.length}
                onClick={() => setAgendaPage(visiblePage + 1)}
              >
                Next items
              </Button>
            </div>
          ) : null}
          {historical.length ? (
            <section aria-label="Retained occurrence history">
              <h3 className="text-sm font-medium">Earlier schedule history</h3>
              <ItemGroup>
                {historical.slice(0, historyLimit).map((occurrence) =>
                  renderRow({
                    ...occurrenceRow(occurrence),
                    displayName: `${occurrence.displayName} · ${formatDateOnly(occurrence.localDate, { dateStyle: "medium" })}`,
                    currency: occurrence.currencyCode,
                    amountCents: occurrence.expectedAmountCents,
                    occurrence,
                  }),
                )}
              </ItemGroup>
              {historical.length > historyLimit ? (
                <Button variant="outline" onClick={() => setHistoryLimit((value) => value + 50)}>
                  Show more occurrence history
                </Button>
              ) : null}
            </section>
          ) : null}
          <PaydayView
            view={projection.data ?? null}
            incomeStreams={snapshot?.income ?? []}
            selectedIncomeStreamId={selectedIncome}
            onIncomeStreamChange={(id) => setParam("paydayIncome", id)}
            onConfirmSchedule={() => document.getElementById("planning-sources")?.focus()}
            onReviewActuals={() => document.getElementById("planning-actuals")?.focus()}
            onConfirmBalance={() => document.getElementById("planning-balances")?.focus()}
            onRefresh={() => void refresh()}
          />
          <section id="planning-sources" tabIndex={-1} aria-label="Recurring schedule sources">
            <h3 className="text-sm font-medium">Confirm or revise a source schedule</h3>
            <div className="flex flex-col gap-1">
              {snapshot
                ? scheduleSources.slice(0, sourceLimit).map(({ item, kind }) => (
                    <Button
                      key={`${kind}:${item.id}`}
                      variant="ghost"
                      className="min-h-11 justify-between"
                      disabled={!schedules.data}
                      onClick={() => openSchedule({ kind, id: item.id })}
                    >
                      {item.displayName}
                    </Button>
                  ))
                : null}
            </div>
            {scheduleSources.length > sourceLimit ? (
              <Button variant="outline" onClick={() => setSourceLimit((value) => value + 20)}>
                Show more schedule sources
              </Button>
            ) : null}
          </section>
          <section id="planning-actuals" tabIndex={-1} aria-label="Actual money movements">
            <h3 className="text-sm font-medium">Review actual money movements</h3>
            <p className="text-sm text-muted-foreground">
              Review posted transactions and use an occurrence’s receipts to match or reverse a
              payment.
            </p>
            <Button asChild variant="outline">
              <Link to="/finances/transactions">Review transactions</Link>
            </Button>
          </section>
          <section id="planning-balances" tabIndex={-1} aria-label="Balance statements">
            <h3 className="text-sm font-medium">
              Review balance statements and movement inclusion
            </h3>
            <p className="text-sm text-muted-foreground">
              Confirm a balance and which movements it includes. This is your statement, not a fresh
              bank check.
            </p>
            <div className="flex flex-wrap gap-2">
              {snapshot?.accounts
                .filter((account) => account.kind === "cash")
                .map((account) => (
                  <Button
                    key={account.id}
                    variant="outline"
                    disabled={!bases.data}
                    onClick={() => setBalanceAccountId(account.id)}
                  >
                    Review balance for {account.name}
                  </Button>
                ))}
            </div>
          </section>
        </>
      )}
      {scheduleForm ? (
        <RecurringScheduleForm
          {...scheduleForm}
          onClose={() => setScheduleForm(null)}
          onSaved={refresh}
        />
      ) : null}
      {balanceAccountId && review.isPending ? (
        <ContentSkeleton label="Loading current balance-review facts…" rows={3} />
      ) : null}
      {balanceAccountId && review.isError ? (
        <InlineError error={review.error} retry={() => void review.refetch()} />
      ) : null}
      {balanceAccount && review.data && bases.data ? (
        <BalanceBasisForm
          key={balanceAccountId}
          account={balanceAccount}
          previousBasis={bases.data?.find((basis) => basis.accountId === balanceAccountId) ?? null}
          transactions={review.data.transactions.filter(
            (transaction) => transaction.accountId === balanceAccountId,
          )}
          coverage={review.data.coverage}
          onClose={() => setBalanceAccountId(null)}
          onSaved={refresh}
        />
      ) : null}
      {match && snapshot ? (
        <OccurrenceMatchDialog
          occurrence={match}
          candidates={snapshot.transactions}
          matchEvents={projection.data?.schedule.matchEvents ?? []}
          onClose={() => setMatch(null)}
          onSaved={refresh}
        />
      ) : null}
    </section>
  );
}
