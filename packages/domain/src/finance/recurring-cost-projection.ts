/** Explicit evidence supplied by an adapter; cents require a currency with two minor-unit digits. */
export interface RecurringCostEvidence {
  id: string;
  serviceId: string | null;
  kind: "bill" | "subscription" | "savings";
  status: "active" | "needs_review" | "paused" | "cancelled";
  cadence:
    | "weekly"
    | "biweekly"
    | "semimonthly"
    | "monthly"
    | "quarterly"
    | "yearly"
    | "irregular"
    | "unknown";
  amountCents: number | null;
  amountBasis: "fixed" | "variable" | "unknown";
  currencyCode: string | null;
  confirmation: "confirmed" | "suspected";
  sourceReferences?: readonly string[];
  asOf?: string;
}

export type RecurringCostExclusion =
  | "savings"
  | "paused"
  | "cancelled"
  | "missing_amount"
  | "invalid_amount"
  | "variable_amount"
  | "unknown_amount_basis"
  | "irregular_cadence"
  | "unknown_cadence"
  | "missing_currency"
  | "invalid_currency"
  | "unsupported_currency"
  | "annual_amount_overflow";

export interface RecurringCostAmount {
  annualCents: number;
  /** Exact cents: divide only at the presentation boundary. */
  monthlyCents: { numerator: number; denominator: 12 };
}

export interface RecurringCostRecord {
  source: RecurringCostEvidence;
  confirmation: "confirmed" | "suspected";
  normalized: RecurringCostAmount | null;
  exclusionReasons: RecurringCostExclusion[];
  priceComparison: {
    available: false;
    reason: "missing_service_identity" | "no_price_history";
  };
}

const annualFactors = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
} as const;

function amount(annualCents: number): RecurringCostAmount {
  return { annualCents, monthlyCents: { numerator: annualCents, denominator: 12 } };
}

/** No deduplication by service or merchant: each source record remains independent. */
export function projectRecurringCosts(evidence: readonly RecurringCostEvidence[]) {
  const records: RecurringCostRecord[] = evidence.map<RecurringCostRecord>((source) => {
    const exclusionReasons: RecurringCostExclusion[] = [];
    if (source.kind === "savings") exclusionReasons.push("savings");
    if (source.status === "paused" || source.status === "cancelled")
      exclusionReasons.push(source.status);
    if (source.amountCents === null) exclusionReasons.push("missing_amount");
    else if (!Number.isSafeInteger(source.amountCents) || source.amountCents < 0)
      exclusionReasons.push("invalid_amount");
    if (source.amountBasis === "variable") exclusionReasons.push("variable_amount");
    if (source.amountBasis === "unknown") exclusionReasons.push("unknown_amount_basis");
    if (source.cadence === "irregular") exclusionReasons.push("irregular_cadence");
    if (source.cadence === "unknown") exclusionReasons.push("unknown_cadence");
    if (source.currencyCode === null) exclusionReasons.push("missing_currency");
    else if (
      !/^[A-Z]{3}$/.test(source.currencyCode) ||
      !Intl.supportedValuesOf("currency").includes(source.currencyCode)
    )
      exclusionReasons.push("invalid_currency");
    else if (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: source.currencyCode,
      }).resolvedOptions().maximumFractionDigits !== 2
    )
      exclusionReasons.push("unsupported_currency");
    let normalized: RecurringCostAmount | null = null;
    if (
      exclusionReasons.length === 0 &&
      source.amountCents !== null &&
      source.cadence in annualFactors
    ) {
      const factor = annualFactors[source.cadence as keyof typeof annualFactors];
      const annualCents = source.amountCents * factor;
      if (!Number.isSafeInteger(annualCents)) exclusionReasons.push("annual_amount_overflow");
      else normalized = amount(annualCents);
    }
    return {
      source: {
        ...source,
        ...(source.sourceReferences === undefined
          ? {}
          : { sourceReferences: [...source.sourceReferences] }),
      },
      confirmation: source.status === "needs_review" ? "suspected" : source.confirmation,
      normalized,
      exclusionReasons,
      priceComparison: {
        available: false,
        reason: source.serviceId?.trim() ? "no_price_history" : "missing_service_identity",
      },
    };
  });
  const groups = new Map<string, { confirmed: bigint; suspected: bigint }>();
  for (const record of records) {
    if (record.normalized === null || record.source.currencyCode === null) continue;
    const currency = record.source.currencyCode;
    const group = groups.get(currency) ?? { confirmed: 0n, suspected: 0n };
    group[record.confirmation] += BigInt(record.normalized.annualCents);
    groups.set(currency, group);
  }
  const boundedTotal = (total: bigint) =>
    total <= BigInt(Number.MAX_SAFE_INTEGER) ? amount(Number(total)) : null;
  return {
    records,
    totals: [...groups].map(([currencyCode, group]) => ({
      currencyCode,
      confirmed: boundedTotal(group.confirmed),
      suspected: boundedTotal(group.suspected),
      overflow: {
        confirmed: group.confirmed > BigInt(Number.MAX_SAFE_INTEGER),
        suspected: group.suspected > BigInt(Number.MAX_SAFE_INTEGER),
      },
    })),
    coverage: {
      totalRecords: records.length,
      normalizedRecords: records.filter((record) => record.normalized !== null).length,
      excludedRecords: records.filter((record) => record.normalized === null).length,
    },
  };
}
