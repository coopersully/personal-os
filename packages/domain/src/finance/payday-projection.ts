/** A calculation input, never proof that an adapter has established provider evidence. */
export type PaydayClassification =
  | "external_income"
  | "external_expense"
  | "internal_transfer"
  | "card_payment"
  | "unknown";

type MovementIdentity = {
  id: string;
  version: string;
  localDate: string | null;
  amountMinorUnits: number | null;
  currencyCode: string;
  accountId: string;
  direction: "incoming" | "outgoing";
  classification: PaydayClassification;
};
export interface PaydayOccurrence extends MovementIdentity {
  incomeStreamId: string | null;
  pairedOccurrenceId: string | null;
  remainingExpectedMinorUnits: number | null;
  matches: readonly { actualMovementId: string; replacedExpectedMinorUnits: number }[];
}
export interface PaydayActualMovement extends MovementIdentity {
  pairedMovementId: string | null;
  postingStatus: "posted" | "pending";
  /** Explicit relative to this account's chosen balance basis, independent of posting status. */
  balanceReflection: "included" | "not_included" | "unknown";
}
export interface PaydayBalance {
  accountId: string;
  accountKind: "cash" | "other" | "unknown";
  basis: "current" | "available" | "unknown";
  amountMinorUnits: number | null;
  currencyCode: string;
  asOfInstant: string;
  validUntilInstant: string;
  sourceRevision: string;
  included: boolean;
  ownershipFraction: number;
}
export interface PaydayProjectionInput {
  periodStartLocalDate: string;
  asOfLocalDate: string;
  asOfInstant: string;
  selectedIncomeStreamId: string | null;
  nextPayday: {
    occurrenceId: string;
    localDate: string | null;
    dateBasis: "authoritative" | "variable" | "unknown";
  };
  balances: readonly PaydayBalance[];
  occurrences: readonly PaydayOccurrence[];
  actualMovements: readonly PaydayActualMovement[];
  protectedFloor?: {
    amountMinorUnits: number | null;
    currencyCode: string;
    accountIds: readonly string[];
    confirmed: boolean;
    asOfLocalDate: string;
    sourceRevision: string;
  };
}
export type PaydayUnavailableReason =
  | "invalid_period"
  | "income_selection_required"
  | "next_payday_unavailable"
  | "invalid_money"
  | "invalid_date"
  | "unsupported_currency"
  | "mixed_currency"
  | "invalid_balance_basis"
  | "stale_balance"
  | "invalid_scope"
  | "missing_revision"
  | "duplicate_identity"
  | "unknown_reflection"
  | "invalid_match"
  | "unknown_residual"
  | "unclassified_movement"
  | "unpaired_transfer"
  | "invalid_floor"
  | "overflow"
  | "exceeds_bounds"
  | "past_unreflected_movement"
  | "overdue_expected";
export interface PaydayEvent {
  kind: "expected" | "posted" | "pending";
  id: string;
  version: string;
  signedAmountMinorUnits: number;
}
export interface PaydayProjectionDay {
  localDate: string;
  estimatedEndOfDayBalanceMinorUnits: number;
  expectedIncomingMinorUnits: number;
  expectedOutgoingMinorUnits: number;
  unreflectedActualNetMinorUnits: number;
  events: PaydayEvent[];
}
export type PaydayProjection =
  | {
      status: "unavailable";
      reasons: { code: PaydayUnavailableReason; evidenceId: string | null }[];
    }
  | {
      status: "estimated";
      currencyCode: string;
      periodStartLocalDate: string;
      asOfLocalDate: string;
      asOfInstant: string;
      endLocalDate: string;
      selectedIncomeStreamId: string;
      nextPaydayOccurrenceId: string;
      expectedEndPaydayIncomeMinorUnits: number;
      openingBalanceMinorUnits: number;
      endingBalanceMinorUnits: number;
      lowestEndOfDayBalance: {
        amountMinorUnits: number;
        localDate: string;
        basis: "opening" | "end_of_day";
      };
      days: PaydayProjectionDay[];
      protectedFloor:
        | { status: "unknown" }
        | {
            status: "confirmed";
            amountMinorUnits: number;
            lowestEndOfDayMarginMinorUnits: number;
            belowFloorAtEndOfDay: boolean;
            sourceRevision: string;
          };
      assumptions: readonly string[];
      evidence: {
        balances: {
          accountId: string;
          basis: PaydayBalance["basis"];
          sourceRevision: string;
          asOfInstant: string;
          validUntilInstant: string;
        }[];
        occurrences: { id: string; version: string }[];
        actualMovements: {
          id: string;
          version: string;
          postingStatus: PaydayActualMovement["postingStatus"];
          balanceReflection: PaydayActualMovement["balanceReflection"];
        }[];
      };
    };

const MONEY_LIMIT = 10_000_000_000;
const RECORD_LIMIT = 1000;
function text(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
function money(value: number | null, signed = false): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MONEY_LIMIT &&
    (signed || value >= 0)
  );
}
function date(value: string | null): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function instant(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !date(value.slice(0, 10)))
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function currency(value: string): boolean {
  return (
    /^[A-Z]{3}$/.test(value) &&
    Intl.supportedValuesOf("currency").includes(value) &&
    new Intl.NumberFormat("en", { style: "currency", currency: value }).resolvedOptions()
      .maximumFractionDigits === 2
  );
}
function paired(classification: PaydayClassification): boolean {
  return classification === "internal_transfer" || classification === "card_payment";
}
function signed(record: MovementIdentity, amount: number): number {
  return record.direction === "incoming" ? amount : -amount;
}

/** Bounded, end-of-day estimates only. Never returns affordability or safe-to-spend authority. */
export function projectPaydayCycle(input: PaydayProjectionInput): PaydayProjection {
  const reasons: { code: PaydayUnavailableReason; evidenceId: string | null }[] = [];
  const reject = (code: PaydayUnavailableReason, evidenceId: string | null = null) => {
    if (!reasons.some((reason) => reason.code === code && reason.evidenceId === evidenceId))
      reasons.push({ code, evidenceId });
  };
  if (
    [
      input.balances.length,
      input.occurrences.length,
      input.actualMovements.length,
      input.occurrences.reduce((sum, row) => sum + row.matches.length, 0),
      input.protectedFloor?.accountIds.length ?? 0,
    ].some((size) => size > RECORD_LIMIT)
  )
    return { status: "unavailable", reasons: [{ code: "exceeds_bounds", evidenceId: null }] };
  const end = input.nextPayday.localDate;
  const validPeriod =
    date(input.periodStartLocalDate) &&
    date(input.asOfLocalDate) &&
    date(end) &&
    input.periodStartLocalDate <= input.asOfLocalDate &&
    input.asOfLocalDate <= end &&
    (Date.parse(end) - Date.parse(input.periodStartLocalDate)) / 86_400_000 <= 366;
  if (!validPeriod) reject("invalid_period");
  const at = instant(input.asOfInstant);
  if (at === null) reject("invalid_date");
  if (!text(input.selectedIncomeStreamId)) reject("income_selection_required");
  const currencyCode = input.balances[0]?.currencyCode ?? "";
  const scope = new Set<string>();
  if (!input.balances.length) reject("invalid_balance_basis");
  for (const balance of input.balances) {
    if (!text(balance.accountId) || scope.has(balance.accountId))
      reject("duplicate_identity", balance.accountId);
    scope.add(balance.accountId);
    if (
      balance.accountKind !== "cash" ||
      balance.included !== true ||
      balance.ownershipFraction !== 1
    )
      reject("invalid_scope", balance.accountId);
    if (balance.basis !== "current" && balance.basis !== "available")
      reject("invalid_balance_basis", balance.accountId);
    if (!money(balance.amountMinorUnits, true)) reject("invalid_money", balance.accountId);
    if (!text(balance.sourceRevision)) reject("missing_revision", balance.accountId);
    if (!currency(balance.currencyCode)) reject("unsupported_currency", balance.accountId);
    if (balance.currencyCode !== currencyCode) reject("mixed_currency", balance.accountId);
    const observed = instant(balance.asOfInstant);
    const until = instant(balance.validUntilInstant);
    if (observed === null || until === null) reject("invalid_date", balance.accountId);
    else if (at === null || observed > until || at < observed || at > until)
      reject("stale_balance", balance.accountId);
  }
  const occurrenceById = new Map<string, PaydayOccurrence>();
  const actualById = new Map<string, PaydayActualMovement>();
  const validateRecord = (record: MovementIdentity, historicalIncluded = false) => {
    if (!text(record.id) || !text(record.version)) reject("missing_revision", record.id);
    if (!date(record.localDate)) reject("invalid_date", record.id);
    else if (
      validPeriod &&
      ((record.localDate < input.periodStartLocalDate && !historicalIncluded) || record.localDate > (end ?? ""))
    )
      reject("invalid_period", record.id);
    if (!money(record.amountMinorUnits)) reject("invalid_money", record.id);
    if (!currency(record.currencyCode)) reject("unsupported_currency", record.id);
    if (record.currencyCode !== currencyCode) reject("mixed_currency", record.id);
    if (record.classification === "unknown") reject("unclassified_movement", record.id);
    if (
      (record.classification === "external_income" && record.direction !== "incoming") ||
      (record.classification === "external_expense" && record.direction !== "outgoing")
    )
      reject("unclassified_movement", record.id);
    if (!text(record.accountId)) reject("invalid_scope", record.id);
  };
  for (const occurrence of input.occurrences) {
    if (occurrenceById.has(occurrence.id)) reject("duplicate_identity", occurrence.id);
    occurrenceById.set(occurrence.id, occurrence);
    validateRecord(occurrence);
    if (occurrence.matches.length > RECORD_LIMIT) reject("exceeds_bounds", occurrence.id);
  }
  for (const movement of input.actualMovements) {
    if (actualById.has(movement.id)) reject("duplicate_identity", movement.id);
    actualById.set(movement.id, movement);
    validateRecord(movement, movement.balanceReflection === "included");
    if (
      scope.has(movement.accountId) &&
      movement.balanceReflection !== "included" &&
      movement.balanceReflection !== "not_included"
    )
      reject("unknown_reflection", movement.id);
    if (movement.postingStatus !== "pending" && movement.postingStatus !== "posted")
      reject("unclassified_movement", movement.id);
    if (
      scope.has(movement.accountId) &&
      movement.balanceReflection === "not_included" &&
      date(movement.localDate) &&
      movement.localDate < input.asOfLocalDate
    )
      reject("past_unreflected_movement", movement.id);
  }
  const validatePair = <T extends MovementIdentity>(
    record: T,
    pairId: string | null,
    records: Map<string, T>,
    reciprocal: (other: T) => string | null,
  ) => {
    if (!paired(record.classification)) {
      if (pairId !== null) reject("unpaired_transfer", record.id);
      if (!scope.has(record.accountId)) reject("invalid_scope", record.id);
      return;
    }
    const other = pairId === null ? undefined : records.get(pairId);
    if (
      !other ||
      other.id === record.id ||
      reciprocal(other) !== record.id ||
      other.classification !== record.classification ||
      other.accountId === record.accountId ||
      other.direction === record.direction ||
      other.amountMinorUnits !== record.amountMinorUnits ||
      other.currencyCode !== record.currencyCode ||
      (!scope.has(record.accountId) && !scope.has(other.accountId))
    )
      reject("unpaired_transfer", record.id);
  };
  for (const occurrence of input.occurrences)
    validatePair(
      occurrence,
      occurrence.pairedOccurrenceId,
      occurrenceById,
      (other) => other.pairedOccurrenceId,
    );
  for (const movement of input.actualMovements)
    validatePair(
      movement,
      movement.pairedMovementId,
      actualById,
      (other) => other.pairedMovementId,
    );
  // One canonical actual may replace several occurrences, but its cash capacity is shared.
  const replacedByActual = new Map<string, bigint>();
  for (const occurrence of input.occurrences) {
    if (!money(occurrence.remainingExpectedMinorUnits)) reject("unknown_residual", occurrence.id);
    let replaced = 0n;
    const usedInOccurrence = new Set<string>();
    for (const match of occurrence.matches.slice(0, RECORD_LIMIT)) {
      const actual = actualById.get(match.actualMovementId);
      if (usedInOccurrence.has(match.actualMovementId))
        reject("duplicate_identity", match.actualMovementId);
      usedInOccurrence.add(match.actualMovementId);
      if (
        !money(match.replacedExpectedMinorUnits) ||
        !actual ||
        actual.accountId !== occurrence.accountId ||
        actual.direction !== occurrence.direction ||
        actual.currencyCode !== occurrence.currencyCode ||
        actual.classification !== occurrence.classification ||
        (actual.amountMinorUnits !== null &&
          match.replacedExpectedMinorUnits > actual.amountMinorUnits)
      )
        reject("invalid_match", occurrence.id);
      if (money(match.replacedExpectedMinorUnits)) {
        const amount = BigInt(match.replacedExpectedMinorUnits);
        replaced += amount;
        const aggregate = (replacedByActual.get(match.actualMovementId) ?? 0n) + amount;
        replacedByActual.set(match.actualMovementId, aggregate);
        if (actual && money(actual.amountMinorUnits) && aggregate > BigInt(actual.amountMinorUnits))
          reject("invalid_match", match.actualMovementId);
      }
    }
    if (
      money(occurrence.amountMinorUnits) &&
      money(occurrence.remainingExpectedMinorUnits) &&
      BigInt(occurrence.amountMinorUnits) !==
        BigInt(occurrence.remainingExpectedMinorUnits) + replaced
    )
      reject("invalid_match", occurrence.id);
    if (
      scope.has(occurrence.accountId) &&
      (occurrence.remainingExpectedMinorUnits ?? 0) > 0 &&
      date(occurrence.localDate) &&
      occurrence.localDate < input.asOfLocalDate
    )
      reject("overdue_expected", occurrence.id);
  }
  const payday = occurrenceById.get(input.nextPayday.occurrenceId);
  if (
    input.nextPayday.dateBasis !== "authoritative" ||
    !payday ||
    payday.incomeStreamId !== input.selectedIncomeStreamId ||
    payday.classification !== "external_income" ||
    payday.direction !== "incoming" ||
    payday.localDate !== end ||
    !scope.has(payday.accountId)
  )
    reject("next_payday_unavailable", input.nextPayday.occurrenceId);
  const floor = input.protectedFloor;
  if (
    floor &&
    (floor.confirmed !== true ||
      !money(floor.amountMinorUnits) ||
      floor.currencyCode !== currencyCode ||
      !date(floor.asOfLocalDate) ||
      floor.asOfLocalDate > input.asOfLocalDate ||
      !text(floor.sourceRevision) ||
      floor.accountIds.length !== scope.size ||
      new Set(floor.accountIds).size !== scope.size ||
      floor.accountIds.some((accountId) => !scope.has(accountId)))
  )
    reject("invalid_floor");
  if (reasons.length) return { status: "unavailable", reasons };

  const byDay = new Map<string, PaydayEvent[]>();
  const append = (localDate: string, event: PaydayEvent) => {
    const events = byDay.get(localDate) ?? [];
    events.push(event);
    byDay.set(localDate, events);
  };
  for (const occurrence of input.occurrences) {
    if (scope.has(occurrence.accountId) && (occurrence.remainingExpectedMinorUnits ?? 0) > 0)
      append(occurrence.localDate as string, {
        kind: "expected",
        id: occurrence.id,
        version: occurrence.version,
        signedAmountMinorUnits: signed(
          occurrence,
          occurrence.remainingExpectedMinorUnits as number,
        ),
      });
  }
  for (const movement of input.actualMovements) {
    if (scope.has(movement.accountId) && movement.balanceReflection === "not_included")
      append(movement.localDate as string, {
        kind: movement.postingStatus,
        id: movement.id,
        version: movement.version,
        signedAmountMinorUnits: signed(movement, movement.amountMinorUnits as number),
      });
  }
  let balance = input.balances.reduce(
    (sum, row) => sum + BigInt(row.amountMinorUnits as number),
    0n,
  );
  const opening = balance;
  let lowest = {
    amountMinorUnits: Number(balance),
    localDate: input.asOfLocalDate,
    basis: "opening" as "opening" | "end_of_day",
  };
  const days: PaydayProjectionDay[] = [];
  const safe = (value: bigint) =>
    value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER);
  if (!safe(balance))
    return { status: "unavailable", reasons: [{ code: "overflow", evidenceId: null }] };
  for (const localDate of [...byDay.keys()].sort()) {
    const events = (byDay.get(localDate) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    const incoming = events
      .filter((event) => event.kind === "expected" && event.signedAmountMinorUnits >= 0)
      .reduce((sum, event) => sum + BigInt(event.signedAmountMinorUnits), 0n);
    const outgoing = events
      .filter((event) => event.kind === "expected" && event.signedAmountMinorUnits < 0)
      .reduce((sum, event) => sum - BigInt(event.signedAmountMinorUnits), 0n);
    const actual = events
      .filter((event) => event.kind !== "expected")
      .reduce((sum, event) => sum + BigInt(event.signedAmountMinorUnits), 0n);
    balance += incoming - outgoing + actual;
    if (![balance, incoming, outgoing, actual].every(safe))
      return { status: "unavailable", reasons: [{ code: "overflow", evidenceId: localDate }] };
    days.push({
      localDate,
      estimatedEndOfDayBalanceMinorUnits: Number(balance),
      expectedIncomingMinorUnits: Number(incoming),
      expectedOutgoingMinorUnits: Number(outgoing),
      unreflectedActualNetMinorUnits: Number(actual),
      events,
    });
    if (balance < BigInt(lowest.amountMinorUnits))
      lowest = { amountMinorUnits: Number(balance), localDate, basis: "end_of_day" };
  }
  const floorMargin = floor
    ? BigInt(lowest.amountMinorUnits) - BigInt(floor.amountMinorUnits as number)
    : null;
  if (floorMargin !== null && !safe(floorMargin))
    return { status: "unavailable", reasons: [{ code: "overflow", evidenceId: null }] };
  return {
    status: "estimated",
    currencyCode,
    periodStartLocalDate: input.periodStartLocalDate,
    asOfLocalDate: input.asOfLocalDate,
    asOfInstant: input.asOfInstant,
    endLocalDate: end as string,
    selectedIncomeStreamId: input.selectedIncomeStreamId as string,
    nextPaydayOccurrenceId: input.nextPayday.occurrenceId,
    expectedEndPaydayIncomeMinorUnits: payday?.remainingExpectedMinorUnits ?? 0,
    openingBalanceMinorUnits: Number(opening),
    endingBalanceMinorUnits: Number(balance),
    lowestEndOfDayBalance: lowest,
    days,
    protectedFloor:
      floor && floorMargin !== null
        ? {
            status: "confirmed",
            amountMinorUnits: floor.amountMinorUnits as number,
            lowestEndOfDayMarginMinorUnits: Number(floorMargin),
            belowFloorAtEndOfDay: floorMargin < 0n,
            sourceRevision: floor.sourceRevision,
          }
        : { status: "unknown" },
    assumptions: [
      "Expected movements, including the selected end-payday income, are estimates rather than actual receipts.",
      "Balances aggregate supplied scoped cash-account evidence; current and available bases are never inferred.",
      "Daily points are end-of-day aggregates. Same-day incoming/outgoing order and intraday lows are unknown.",
      "A protected-floor comparison is not affordability or safe-to-spend authority.",
    ],
    evidence: {
      balances: input.balances.map(
        ({ accountId, basis, sourceRevision, asOfInstant, validUntilInstant }) => ({
          accountId,
          basis,
          sourceRevision,
          asOfInstant,
          validUntilInstant,
        }),
      ),
      occurrences: input.occurrences.map(({ id, version }) => ({ id, version })),
      actualMovements: input.actualMovements.map(
        ({ id, version, postingStatus, balanceReflection }) => ({
          id,
          version,
          postingStatus,
          balanceReflection,
        }),
      ),
    },
  };
}
