export type CashflowCadence =
  | "biweekly"
  | "irregular"
  | "monthly"
  | "quarterly"
  | "weekly"
  | "yearly";

type DatedRecord = { effectiveDate: string };

/** Returns the most recent record that was in effect on the requested calendar date. */
export function selectEffectiveRecord<T extends DatedRecord>(records: readonly T[], asOf: string) {
  return records
    .filter((record) => record.effectiveDate <= asOf)
    .toSorted((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))[0];
}

/** Infers a cadence only from at least three distinct dates with a bounded interval spread. */
export function cadenceFromDates(dates: readonly string[]) {
  const sorted = [...new Set(dates)].toSorted();
  if (sorted.length < 3) return null;
  const intervals = sorted.slice(1).map((date, index) => {
    const prior = sorted[index];
    return Math.round(
      (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${prior}T12:00:00Z`)) / 86_400_000,
    );
  });
  const average = intervals.reduce((total, value) => total + value, 0) / intervals.length;
  const spread = Math.max(...intervals) - Math.min(...intervals);
  const cadence: CashflowCadence =
    average >= 6 && average <= 9
      ? "weekly"
      : average >= 12 && average <= 17
        ? "biweekly"
        : average >= 26 && average <= 33
          ? "monthly"
          : average >= 85 && average <= 100
            ? "quarterly"
            : average >= 350 && average <= 380
              ? "yearly"
              : "irregular";
  return {
    average,
    cadence,
    regular: cadence !== "irregular" && spread <= Math.max(3, average * 0.18),
  } as const;
}

type ForecastEvent = {
  amount: number;
  date: string | null;
  kind: "income" | "obligation";
};

/**
 * Simulates dated income and obligations through the horizon. Same-day obligations
 * are applied before income so the result remains a conservative planning signal.
 */
export function forecastCashflow({
  asOf,
  cash,
  horizon,
  income,
  obligations,
}: {
  asOf: string;
  cash: number;
  horizon: string | null;
  income: readonly ForecastEvent[];
  obligations: readonly ForecastEvent[];
}) {
  const today = asOf.slice(0, 10);
  const events = [...income, ...obligations]
    .filter(
      (event) =>
        event.date !== null && event.date >= today && (horizon === null || event.date <= horizon),
    )
    .toSorted((left, right) => {
      const dateOrder = (left.date ?? "").localeCompare(right.date ?? "");
      if (dateOrder !== 0) return dateOrder;
      // On the same date, reserve outgoing money before assuming an incoming deposit clears.
      return left.kind === right.kind ? 0 : left.kind === "obligation" ? -1 : 1;
    });
  let runningBalance = cash;
  let lowestBalance = cash;
  let lowestDate = horizon ? today : null;
  for (const event of events) {
    runningBalance += event.kind === "income" ? event.amount : -event.amount;
    if (runningBalance < lowestBalance) {
      lowestBalance = runningBalance;
      lowestDate = event.date;
    }
  }
  return {
    lowestBalance,
    lowestDate,
    projectedBalance: horizon ? runningBalance : null,
    upcomingIncome: events
      .filter((event) => event.kind === "income")
      .reduce((total, event) => total + event.amount, 0),
    upcomingObligations: events
      .filter((event) => event.kind === "obligation")
      .reduce((total, event) => total + event.amount, 0),
  };
}

type CashflowAlert = {
  id: string;
  incomeStreamId: string | null;
  recurringObligationId: string | null;
  type: string;
};
type ExpectedCashflow = { id: string; nextExpectedDate: string | null; status: string };

/** Finds open missing-activity alerts whose underlying active schedule is no longer overdue. */
export function obsoleteMissingAlertIds({
  alerts,
  incomeStreams,
  obligations,
  today,
}: {
  alerts: readonly CashflowAlert[];
  incomeStreams: readonly ExpectedCashflow[];
  obligations: readonly ExpectedCashflow[];
  today: string;
}) {
  const streamById = new Map(incomeStreams.map((stream) => [stream.id, stream]));
  const obligationById = new Map(obligations.map((obligation) => [obligation.id, obligation]));
  const isOverdue = (item: ExpectedCashflow | undefined) =>
    item?.status === "active" && item.nextExpectedDate !== null && item.nextExpectedDate < today;
  return alerts.flatMap((alert) => {
    const related =
      alert.type === "income_missing"
        ? streamById.get(alert.incomeStreamId ?? "")
        : alert.type === "recurring_missing"
          ? obligationById.get(alert.recurringObligationId ?? "")
          : undefined;
    return isOverdue(related) ? [] : [alert.id];
  });
}
