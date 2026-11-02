import type { PlaidTransactionSnapshot } from "@personal-os/connectors";
import { idSchema, isoDateTimeSchema } from "@personal-os/domain";
import { z } from "zod";
import type { Principal } from "../types.js";
import type { FinanceTransaction } from "./context.js";

/** Bounds only. Parsing source data never admits a read or a financial projection. */
export const historicalReadLimits = {
  targets: 100,
  pages: 20,
  pageSize: 500,
  serializedBytes: 1_048_576,
} as const;

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const providerIdentity = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => value.trim().length > 0);
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/u)
  .nullable();
const direction = z.enum(["expense", "income"]).nullable();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });
const requestId = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,200}$/u)
  .nullable();
const localAccountIds = z
  .array(idSchema)
  .min(1)
  .max(historicalReadLimits.targets)
  .refine((values) => new Set(values).size === values.length, "Account IDs must be unique.");

function checkSize(value: unknown, context: z.RefinementCtx) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > historicalReadLimits.serializedBytes)
    context.addIssue({
      code: "custom",
      message: "Historical source evidence exceeds its byte bound.",
    });
}
function checkRange(value: { startDate: string; endDate: string }, context: z.RefinementCtx) {
  if (value.startDate > value.endDate)
    context.addIssue({ code: "custom", message: "The historical date range is reversed." });
}

export const historicalReadHeldReasonSchema = z.enum([
  "not_returned_in_page",
  "missing_or_invalid_currency",
  "provider_identity_mismatch",
  "ambiguous_identity",
  "pending_identity_changed",
  "amount_mismatch",
  "date_mismatch",
  "native_revision_mismatch",
  "non_null_conflict",
  "history_out_of_range",
  "coverage_not_established",
]);
export type HistoricalReadHeldReason = z.infer<typeof historicalReadHeldReasonSchema>;
export const historicalReadFailureCodeSchema = z.enum([
  "unsupported",
  "unauthorized",
  "source_stale",
  "attempt_expired",
  "provider_rejected",
  "transport_failed",
  "invalid_response",
  "coverage_inconsistent",
  "bound_exceeded",
]);
export type HistoricalReadFailureCode = z.infer<typeof historicalReadFailureCodeSchema>;

export const historicalReadPageRequestSchema = z
  .object({
    groupIndex: z
      .number()
      .int()
      .min(0)
      .max(historicalReadLimits.targets - 1),
    count: z.number().int().min(1).max(historicalReadLimits.pageSize),
    offset: safeInteger,
  })
  .strict();
export type HistoricalReadPageRequest = z.infer<typeof historicalReadPageRequestSchema>;

/** Credential-private connector input; never a public HTTP/MCP request schema. */
export const historicalProviderRequestSchema = z
  .object({
    accessToken: z.string().min(1).max(8_000),
    accountIds: z
      .array(providerIdentity)
      .min(1)
      .max(historicalReadLimits.targets)
      .refine((values) => new Set(values).size === values.length),
    startDate: date,
    endDate: date,
    count: z.number().int().min(1).max(historicalReadLimits.pageSize),
    offset: safeInteger,
  })
  .strict()
  .superRefine(checkRange);
export type HistoricalProviderRequest = z.infer<typeof historicalProviderRequestSchema>;

const providerTransactionSchema = z
  .object({
    accountId: providerIdentity,
    amount: z.number().finite(),
    currencyCode: currency,
    date,
    merchantName: z.string().max(8_000).nullable(),
    name: z.string().max(8_000),
    pending: z.boolean(),
    pendingTransactionId: providerIdentity.nullable(),
    personalFinanceCategory: z
      .object({
        confidenceLevel: z.enum(["HIGH", "LOW", "MEDIUM", "UNKNOWN", "VERY_HIGH"]).nullable(),
        detailed: z.string().max(2_000).nullable(),
        primary: z.string().max(2_000),
      })
      .strict()
      .nullable(),
    transactionId: providerIdentity,
  })
  .strict();
export const historicalProviderPageSchema = z
  .object({
    itemId: providerIdentity,
    transactions: z.array(providerTransactionSchema).max(historicalReadLimits.pageSize),
    totalTransactions: safeInteger,
    requestId,
    hasMore: z.boolean(),
  })
  .strict()
  .superRefine((page, context) => {
    if (
      new Set(page.transactions.map((row) => row.transactionId)).size !== page.transactions.length
    )
      context.addIssue({
        code: "custom",
        message: "Provider transaction identities must be unique.",
      });
    if (page.transactions.length > page.totalTransactions)
      context.addIssue({ code: "custom", message: "The provider total is inconsistent." });
    checkSize(page, context);
  });
export type HistoricalProviderPage = z.infer<typeof historicalProviderPageSchema>;

/** Cross-validates one page against its exact credential-private request; performs no I/O. */
export const historicalProviderExchangeSchema = z
  .object({
    request: historicalProviderRequestSchema,
    response: historicalProviderPageSchema,
  })
  .strict()
  .superRefine(({ request, response }, context) => {
    const end = request.offset + response.transactions.length;
    if (
      !Number.isSafeInteger(end) ||
      request.offset > response.totalTransactions ||
      end > response.totalTransactions ||
      response.transactions.length > request.count ||
      response.hasMore !== end < response.totalTransactions ||
      (response.hasMore && response.transactions.length === 0)
    )
      context.addIssue({ code: "custom", message: "The historical page bounds are inconsistent." });
    for (const row of response.transactions) {
      if (
        !request.accountIds.includes(row.accountId) ||
        row.date < request.startDate ||
        row.date > request.endDate
      )
        context.addIssue({
          code: "custom",
          message: "A provider row is outside the requested source.",
        });
    }
  });

const expectedField = z.enum(["currencyCode", "providerDirection"]);
const manifestTarget = z
  .object({
    transactionId: idSchema,
    localAccountId: idSchema,
    providerAccountId: providerIdentity,
    providerTransactionId: providerIdentity,
    nativeFingerprint: fingerprint,
    date,
    absoluteAmountCents: safeInteger,
    currencyCode: currency,
    providerDirection: direction,
    missingFields: z
      .array(expectedField)
      .min(1)
      .max(2)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict()
  .superRefine((target, context) => {
    if (target.missingFields.some((field) => target[field] !== null))
      context.addIssue({
        code: "custom",
        message: "A recovery target field must actually be missing.",
      });
  });
const manifestAccount = z
  .object({
    localAccountId: idSchema,
    providerAccountId: providerIdentity,
    nativeFingerprint: fingerprint,
  })
  .strict();
const manifestGroup = z
  .object({ localAccountIds, startDate: date, endDate: date })
  .strict()
  .superRefine(checkRange);

/** A source snapshot schema, not a capability parser or persisted authority validator. */
export const historicalReadManifestSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: idSchema,
    actorType: z.enum(["user", "agent"]),
    actorId: idSchema,
    authorizationConnectionId: idSchema.nullable(),
    localItemId: idSchema,
    itemFingerprint: fingerprint,
    accounts: z.array(manifestAccount).min(1).max(historicalReadLimits.targets),
    targets: z.array(manifestTarget).min(1).max(historicalReadLimits.targets),
    groups: z.array(manifestGroup).min(1).max(historicalReadLimits.targets),
    incrementalClaim: z
      .object({
        id: idSchema,
        owner: z.string().min(1).max(2_000),
        generation: idSchema,
        expiresAt: isoDateTimeSchema,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      (manifest.actorType === "user" &&
        (manifest.actorId !== manifest.ownerId || manifest.authorizationConnectionId !== null)) ||
      (manifest.actorType === "agent" && manifest.authorizationConnectionId === null)
    )
      context.addIssue({ code: "custom", message: "The origin snapshot is inconsistent." });
    const accounts = new Map(
      manifest.accounts.map((row) => [row.localAccountId, row.providerAccountId]),
    );
    if (
      accounts.size !== manifest.accounts.length ||
      new Set(manifest.accounts.map((row) => row.providerAccountId)).size !==
        manifest.accounts.length ||
      new Set(manifest.targets.map((row) => row.transactionId)).size !== manifest.targets.length ||
      new Set(manifest.targets.map((row) => row.providerTransactionId)).size !==
        manifest.targets.length
    )
      context.addIssue({ code: "custom", message: "Historical source identities must be unique." });
    for (const target of manifest.targets) {
      const groups = manifest.groups.filter(
        (group) =>
          group.localAccountIds.includes(target.localAccountId) &&
          target.date >= group.startDate &&
          target.date <= group.endDate,
      );
      if (accounts.get(target.localAccountId) !== target.providerAccountId || groups.length !== 1)
        context.addIssue({
          code: "custom",
          message: "Each target needs its exact account and one bounded group.",
        });
    }
    if (manifest.groups.some((group) => group.localAccountIds.some((id) => !accounts.has(id))))
      context.addIssue({
        code: "custom",
        message: "A historical group contains an unbound account.",
      });
    if (
      manifest.accounts.some(
        (account) =>
          !manifest.targets.some((target) => target.localAccountId === account.localAccountId),
      ) ||
      manifest.groups.some(
        (group) =>
          !manifest.targets.some(
            (target) =>
              group.localAccountIds.includes(target.localAccountId) &&
              target.date >= group.startDate &&
              target.date <= group.endDate,
          ),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Historical groups and accounts cannot widen the exact target set.",
      });
    checkSize(manifest, context);
  });
export type HistoricalReadManifestSnapshot = z.infer<typeof historicalReadManifestSnapshotSchema>;

const signedAmount = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/u)
  .max(100)
  .refine((value) => Number.isFinite(Number(value)) && Number(value).toString() === value);
export const historicalReadObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    acquisitionId: idSchema,
    attemptId: idSchema,
    attemptGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    manifestHash: fingerprint,
    sourceFingerprint: fingerprint,
    observedAt: isoDateTimeSchema,
    page: z
      .object({
        groupIndex: z
          .number()
          .int()
          .min(0)
          .max(historicalReadLimits.targets - 1),
        count: z.number().int().min(1).max(historicalReadLimits.pageSize),
        offset: safeInteger,
        startDate: date,
        endDate: date,
        requestedLocalAccountIds: localAccountIds,
        returnedCount: z.number().int().nonnegative().max(historicalReadLimits.pageSize),
        totalTransactions: safeInteger,
        hasMore: z.boolean(),
        requestId,
        contentHash: fingerprint,
      })
      .strict(),
    targets: z
      .array(
        z
          .object({
            transactionId: idSchema,
            localAccountId: idSchema,
            providerTransactionId: providerIdentity,
            signedAmount,
            absoluteAmountCents: safeInteger,
            currencyCode: currency,
            date,
            pending: z.boolean(),
          })
          .strict(),
      )
      .max(historicalReadLimits.targets),
    held: z
      .array(z.object({ transactionId: idSchema, reason: historicalReadHeldReasonSchema }).strict())
      .max(historicalReadLimits.targets),
  })
  .strict()
  .superRefine((observation, context) => {
    const { page } = observation;
    checkRange(page, context);
    const end = page.offset + page.returnedCount;
    if (
      !Number.isSafeInteger(end) ||
      page.offset > page.totalTransactions ||
      end > page.totalTransactions ||
      page.returnedCount > page.count ||
      page.hasMore !== end < page.totalTransactions ||
      (page.hasMore && page.returnedCount === 0) ||
      observation.targets.length > page.returnedCount
    )
      context.addIssue({ code: "custom", message: "The observed page bounds are inconsistent." });
    if (
      new Set(observation.targets.map((row) => row.transactionId)).size !==
        observation.targets.length ||
      new Set(observation.targets.map((row) => row.providerTransactionId)).size !==
        observation.targets.length ||
      new Set(observation.held.map((row) => row.transactionId)).size !== observation.held.length ||
      new Set([...observation.targets, ...observation.held].map((row) => row.transactionId)).size >
        historicalReadLimits.targets
    )
      context.addIssue({ code: "custom", message: "The observed target set is inconsistent." });
    for (const target of observation.targets) {
      if (
        !page.requestedLocalAccountIds.includes(target.localAccountId) ||
        target.date < page.startDate ||
        target.date > page.endDate ||
        Math.round(Math.abs(Number(target.signedAmount)) * 100) !== target.absoluteAmountCents
      )
        context.addIssue({
          code: "custom",
          message: "A target does not match the observed source.",
        });
      if (
        target.currencyCode === null &&
        !observation.held.some(
          (row) =>
            row.transactionId === target.transactionId &&
            row.reason === "missing_or_invalid_currency",
        )
      )
        context.addIssue({
          code: "custom",
          message: "Missing currency must remain explicitly held.",
        });
    }
    checkSize(observation, context);
  });
export type HistoricalReadObservation = z.infer<typeof historicalReadObservationSchema>;

// Type-only boundary. The future owner must verify runtime object identity and persisted admission.
// No exported schema or function can construct this capability or authorize an operation.
declare const historicalReadCapabilityIdentity: unique symbol;
export interface HistoricalReadCapability {
  readonly [historicalReadCapabilityIdentity]: never;
}
export type ValidatedHistoricalReadScope = {
  originatingPrincipal: Principal;
  acquisitionId: string;
  attemptId: string;
  attemptGeneration: number;
  leaseNonce: string;
  deadline: string;
  manifestHash: string;
  manifest: HistoricalReadManifestSnapshot;
  expectedPagePrefixHash: string;
};
export interface HistoricalReadAdmissionPort {
  revalidate(
    tx: FinanceTransaction,
    capability: HistoricalReadCapability,
    request: HistoricalReadPageRequest,
  ): Promise<ValidatedHistoricalReadScope>;
}
/** Structurally matches the optional connector member once its owner implements it. */
export interface HistoricalTransactionsReader {
  getTransactionsHistory?: (input: HistoricalProviderRequest) => Promise<{
    itemId: string;
    transactions: PlaidTransactionSnapshot[];
    totalTransactions: number;
    requestId: string | null;
    hasMore: boolean;
  }>;
}
export type HistoricalReadInput = {
  capability: HistoricalReadCapability;
  page: HistoricalReadPageRequest;
  connector: HistoricalTransactionsReader;
  admission: HistoricalReadAdmissionPort;
};

/** Exact data membership only; the future service still proves hashes, authority and live revisions. */
export const historicalReadObservationBindingSchema = z
  .object({
    manifest: historicalReadManifestSnapshotSchema,
    request: historicalReadPageRequestSchema,
    observation: historicalReadObservationSchema,
  })
  .strict()
  .superRefine(({ manifest, request, observation }, context) => {
    const group = manifest.groups[request.groupIndex];
    const page = observation.page;
    const targets = new Map(manifest.targets.map((target) => [target.transactionId, target]));
    const sameAccounts =
      group &&
      group.localAccountIds.length === page.requestedLocalAccountIds.length &&
      group.localAccountIds.every((id) => page.requestedLocalAccountIds.includes(id));
    if (
      !group ||
      !sameAccounts ||
      page.groupIndex !== request.groupIndex ||
      page.count !== request.count ||
      page.offset !== request.offset ||
      page.startDate !== group.startDate ||
      page.endDate !== group.endDate
    )
      context.addIssue({
        code: "custom",
        message: "The observation is not bound to its exact request group.",
      });
    // Per-page membership completeness is not proof of historical coverage or runtime authority.
    const selectedTargets = group
      ? manifest.targets.filter(
          (target) =>
            group.localAccountIds.includes(target.localAccountId) &&
            target.date >= group.startDate &&
            target.date <= group.endDate,
        )
      : [];
    const accountedFor = new Set(
      [...observation.targets, ...observation.held].map((row) => row.transactionId),
    );
    if (selectedTargets.some((target) => !accountedFor.has(target.transactionId)))
      context.addIssue({
        code: "custom",
        message: "Every requested group target must be observed or explicitly held.",
      });
    const held = (id: string, reason: HistoricalReadHeldReason) =>
      observation.held.some((row) => row.transactionId === id && row.reason === reason);
    for (const row of observation.targets) {
      const target = targets.get(row.transactionId);
      if (
        !target ||
        target.localAccountId !== row.localAccountId ||
        target.providerTransactionId !== row.providerTransactionId
      )
        context.addIssue({
          code: "custom",
          message: "The observation contains an unbound target identity.",
        });
      if (
        target &&
        ((target.absoluteAmountCents !== row.absoluteAmountCents &&
          !held(row.transactionId, "amount_mismatch")) ||
          (target.date !== row.date && !held(row.transactionId, "date_mismatch")) ||
          (target.currencyCode !== null &&
            target.currencyCode !== row.currencyCode &&
            !held(row.transactionId, "non_null_conflict")) ||
          (target.providerDirection !== null &&
            target.providerDirection !== (Number(row.signedAmount) < 0 ? "income" : "expense") &&
            !held(row.transactionId, "non_null_conflict")))
      )
        context.addIssue({
          code: "custom",
          message: "A source conflict must remain explicitly held.",
        });
    }
    if (observation.held.some((row) => !targets.has(row.transactionId)))
      context.addIssue({ code: "custom", message: "The held set contains an unbound target." });
    checkSize({ manifest, request, observation }, context);
  });
