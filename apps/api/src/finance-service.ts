import { createHash, randomUUID } from "node:crypto";
import type { PlaidConnector, PlaidTransactionSnapshot } from "@personal-os/connectors";
import {
  attentionItems,
  auditEvents,
  type Database,
  domainProfileApprovals,
  domainProfiles,
  financeAccounts,
  financeAlerts,
  financeBudgets,
  financeCategories,
  financeCategoryRules,
  financeClassificationDecisions,
  financeIncomeStreams,
  financeMerchantAliases,
  financeMerchants,
  financeProfiles,
  financeProviderItems,
  financeRecurringObligations,
  financeReviewCases,
  financeSetupBackfillState,
  financeTransactions,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type {
  ApplyFinanceCategorizationsInput,
  AttentionItem,
  CreateFinanceAccountInput,
  CreateFinanceBudgetInput,
  CreateFinanceTransactionInput,
  ExchangePlaidTokenInput,
  FinanceAccount,
  FinanceAlert,
  FinanceBudget,
  FinanceBudgetPace,
  FinanceBudgetPacePeriod,
  FinanceCategorizationApplyResult,
  FinanceCategorizationProposal,
  FinanceCategorizationProposalPage,
  FinanceCategory,
  FinanceCsvImportInput,
  FinanceExport,
  FinanceForecast,
  FinanceGuidedSetupContext,
  FinanceIncomeStream,
  FinanceLedgerHealth,
  FinanceMerchant,
  FinanceOverview,
  FinanceProfile,
  FinanceRecurringObligation,
  FinanceReviewCase,
  FinanceReviewDecisionInput,
  FinanceTransaction,
  FinanceTransactionQuery,
  FinanceWealthSummary,
  MaintenanceScope,
  MaterialSourceReference,
  MergeFinanceMerchantsInput,
  ResolveFinanceAlertInput,
  UpdateFinanceIncomeStreamInput,
  UpdateFinanceMerchantInput,
  UpdateFinanceProfileInput,
  UpdateFinanceRecurringObligationInput,
  UpdateFinanceTransactionInput,
  UpsertFinanceAttentionItemInput,
} from "@personal-os/domain";
import { financeDomainProfileSchema, idSchema, localDateAt } from "@personal-os/domain";
import { and, asc, desc, eq, gt, gte, inArray, isNull, like, lt, lte, or, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import {
  cadenceFromDates,
  forecastCashflow,
  obsoleteMissingAlertIds,
  selectEffectiveRecord,
} from "./finance-cashflow.js";
import { parseFinanceCsv } from "./finance-csv.js";
import { createFinanceProviderItemService } from "./finance-provider-item-service.js";
import {
  createFinanceProviderItemSyncService,
  type FinanceSyncBatchResult,
} from "./finance-provider-item-sync-service.js";
import { auditAttentionItemMetadata, serializeAttentionItem } from "./serialization.js";
import type { Principal, RequestLog } from "./types.js";

type MaintenanceMutationAttribution = {
  idempotencyKey: string;
  policy: "approved_rule";
  rulebookVersion: string;
  runId: string;
};
type MutationContext = {
  maintenance?: MaintenanceMutationAttribution;
  maintenanceClaim?: { claimId: string; runId: string };
  principal: Principal;
  requestId: string;
};
type Options = {
  db: Database;
  encryptionKey?: string;
  log?: (entry: RequestLog) => void;
  now: () => Date;
  onProposalSnapshotRead?: () => Promise<void>;
  plaid?: PlaidConnector;
  providerItems?: ReturnType<typeof createFinanceProviderItemService>;
};
type FinanceProfileSourceExecutor = Pick<Database, "select">;
type FinanceReadExecutor = Pick<Database, "select">;
type FinanceReviewExecutor = Pick<Database, "insert" | "select" | "update">;
type FinanceWriteExecutor = Pick<Database, "insert" | "select" | "update">;
type PlaidCategoryConfidence = NonNullable<
  PlaidTransactionSnapshot["personalFinanceCategory"]
>["confidenceLevel"];
type FinanceSyncProgress = () => Promise<void>;

export type { FinanceSyncBatchResult } from "./finance-provider-item-sync-service.js";

export type FinanceSyncHealthInitializationResult = {
  complete: boolean;
  initialized: number;
  manual: number;
  plaidCurrent: number;
  plaidDue: number;
};

const financeMaintenanceClaimMs = 2 * 60_000;
const financeSyncBatchLimit = 25;

const categoryRules: Array<[RegExp, string]> = [
  [/uber|lyft|mta|transit|amtrak|airlines/i, "Transportation"],
  [/whole foods|trader joe|grocery|market/i, "Groceries"],
  [/restaurant|cafe|coffee|doordash|ubereats/i, "Dining"],
  [/netflix|spotify|subscription|adobe/i, "Subscriptions"],
  [/rent|landlord|mortgage/i, "Housing"],
  [/pharmacy|doctor|therapy|health/i, "Health"],
];

const defaultCategories = [
  ["Auto & Transport", "transport"],
  ["Bills & Utilities", "bills"],
  ["Cash & ATM", "cash"],
  ["Dining", "dining"],
  ["Education", "education"],
  ["Entertainment", "entertainment"],
  ["Fees", "fees"],
  ["Gifts & Donations", "gifts"],
  ["Groceries", "groceries"],
  ["Health", "health"],
  ["Housing", "housing"],
  ["Income", "income"],
  ["Insurance", "insurance"],
  ["Investments", "investments"],
  ["Personal Care", "personal-care"],
  ["Shopping", "shopping"],
  ["Subscriptions", "subscriptions"],
  ["Taxes", "taxes"],
  ["Transfers", "transfers"],
  ["Travel", "travel"],
] as const;

const initialAgentThreshold = 0.985;
const rentCategory = "RENT_AND_UTILITIES";
const transferCategory = "Transfers";

type DecisionSource = "agent" | "provider" | "rule" | "user";
type TransactionCursor = {
  direction: "asc" | "desc";
  id: string;
  sortBy: FinanceTransactionQuery["sortBy"];
  value: number | string;
};
type TransactionListQuery = Omit<FinanceTransactionQuery, "sortBy" | "sortDirection"> &
  Partial<Pick<FinanceTransactionQuery, "sortBy" | "sortDirection">>;

function categoryGroup(name: string) {
  if (["Income", "Transfers", "Investments"].includes(name)) return "Financial";
  if (["Housing", "Bills & Utilities", "Insurance", "Taxes"].includes(name)) return "Essential";
  return "Spending";
}

function categorySlug(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function defaultCategoryId(userId: string, slug: string) {
  const hex = createHash("sha256").update(`finance-category:${userId}:${slug}`).digest("hex");
  // UUIDv8 identifies this as a custom SHA-256 layout rather than implying
  // the namespace/SHA-1 algorithm required by UUIDv5.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function approvedProfileFrom(
  approval: typeof domainProfileApprovals.$inferSelect | null | undefined,
): FinanceGuidedSetupContext["guidance"]["approvedProfile"] {
  if (approval?.domain !== "finances" || approval.approvedByUserId !== approval.userId) {
    return null;
  }
  const parsed = financeDomainProfileSchema.safeParse(approval.profile);
  return parsed.success &&
    parsed.data.id === approval.profileId &&
    parsed.data.version === approval.profileVersion &&
    parsed.data.status === "active"
    ? parsed.data
    : null;
}

function titleCaseMerchant(value: string) {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\b(Usa|Llc|Inc|Ny|Ca)\b/g, (word) => word.toUpperCase());
}

function normalizedMerchant(merchant: string) {
  return merchant
    .toLowerCase()
    .replace(/[*#]\d+\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" }).format(cents / 100);
}
function nextMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, monthNumber ?? 0, 1)).toISOString().slice(0, 7);
}

function dateAfter(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Math.round(days));
  return value.toISOString().slice(0, 10);
}

function daysInCalendarMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, monthNumber ?? 0, 0)).getUTCDate();
}

function budgetPaceDates(period: FinanceBudgetPacePeriod, today: string) {
  const month = today.slice(0, 7);
  const start =
    period === "week"
      ? dateAfter(today, -new Date(`${today}T12:00:00Z`).getUTCDay())
      : period === "month"
        ? `${month}-01`
        : `${today.slice(0, 4)}-01-01`;
  const end =
    period === "week"
      ? dateAfter(start, 6)
      : period === "month"
        ? `${month}-${String(daysInCalendarMonth(month)).padStart(2, "0")}`
        : `${today.slice(0, 4)}-12-31`;
  const dates: string[] = [];
  for (let date = start; date <= end; date = dateAfter(date, 1)) dates.push(date);
  return dates;
}

function decodeTransactionCursor(cursor: string): TransactionCursor {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as TransactionCursor;
    if (
      !value ||
      !["amount", "date", "merchant"].includes(value.sortBy) ||
      !["asc", "desc"].includes(value.direction) ||
      typeof value.id !== "string" ||
      (typeof value.value !== "number" && typeof value.value !== "string")
    ) {
      throw new Error("Invalid cursor");
    }
    return value;
  } catch {
    throw new AppError("invalid_request", "The transaction cursor is invalid.");
  }
}

function encodeTransactionCursor(
  row: typeof financeTransactions.$inferSelect,
  sortBy: FinanceTransactionQuery["sortBy"],
  direction: FinanceTransactionQuery["sortDirection"],
) {
  const value =
    sortBy === "amount" ? row.amount : sortBy === "merchant" ? row.merchant : row.transactionDate;
  return Buffer.from(
    JSON.stringify({ direction, id: row.id, sortBy, value } satisfies TransactionCursor),
  ).toString("base64url");
}
function categorization(merchant: string, learnedCategory?: string) {
  if (isRentMerchant(merchant)) {
    return { category: rentCategory, confidence: 10_000, needsReview: false };
  }
  if (learnedCategory) return { category: learnedCategory, confidence: 10_000, needsReview: false };
  const match = categoryRules.find(([rule]) => rule.test(merchant));
  return match
    ? { category: match[1], confidence: 9_000, needsReview: false }
    : { category: null, confidence: null, needsReview: true };
}

function isRentMerchant(merchant: string) {
  return /\blee\s+t(?:a|e)(?:ch|ck)man\b/i.test(merchant);
}

function isSoFiVaultTransfer(merchant: string) {
  return /\b(?:to|from|2x)\b.*\bvault\b/i.test(merchant);
}

function isProviderTransfer(category: string | null) {
  return category === "TRANSFER_IN" || category === "TRANSFER_OUT";
}

function isCardPayment(merchant: string) {
  return /(?:\be-?payment\b|\bautopay\b|\bmobile payment\b|\bthank you\b|\bcard payment\b)/i.test(
    merchant,
  );
}
function providerConfidence(value: PlaidCategoryConfidence) {
  return {
    HIGH: 0.9,
    LOW: 0.5,
    MEDIUM: 0.75,
    UNKNOWN: null,
    VERY_HIGH: 0.985,
  }[value ?? "UNKNOWN"];
}
function providerNeedsReview(value: PlaidCategoryConfidence) {
  return value === "LOW" || value === "MEDIUM" || value === "UNKNOWN" || value === undefined;
}
function isRefundOrReversal(row: typeof financeTransactions.$inferSelect) {
  return (
    row.direction === "income" &&
    row.category !== "INCOME" &&
    row.category !== "OTHER" &&
    row.category !== transferCategory
  );
}
function budgetImpact(row: typeof financeTransactions.$inferSelect, includePending = false) {
  if (row.pending && !includePending) return 0;
  if (row.direction === "expense") return row.amount;
  return isRefundOrReversal(row) ? -row.amount : 0;
}
export function financeCsvImportErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The CSV could not be imported.";
}
function categorizationApplyError(
  error: unknown,
  requestId: string,
): FinanceCategorizationApplyResult["error"] {
  return error instanceof AppError
    ? { code: error.code, message: error.message, requestId }
    : {
        code: "internal_error",
        message: "The categorization could not be applied.",
        requestId,
      };
}
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await mapper(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
function currency(cents: number | null) {
  return cents === null ? null : cents / 100;
}
function account(
  row: typeof financeAccounts.$inferSelect,
  item?: typeof financeProviderItems.$inferSelect,
): FinanceAccount {
  const synchronization = item ?? row;
  return {
    balance: currency(row.balance),
    createdAt: row.createdAt.toISOString(),
    currencyCode: row.currencyCode,
    id: row.id,
    institution: row.institution,
    kind: row.kind,
    lastSyncedAt: synchronization.lastSyncedAt?.toISOString() ?? null,
    name: row.name,
    provider: row.provider,
    status: item ? (item.syncRecovery === "reconnect" ? "needs_reauth" : "connected") : row.status,
    synchronization: {
      failureCode: synchronization.syncErrorCode,
      failureCount: synchronization.syncFailureCount,
      lastAttemptAt: synchronization.lastSyncAttemptAt?.toISOString() ?? null,
      lastSuccessAt: synchronization.lastSyncedAt?.toISOString() ?? null,
      message: synchronization.syncError,
      nextRetryAt:
        synchronization.syncFailureCount > 0
          ? (synchronization.nextSyncAt?.toISOString() ?? null)
          : null,
      recovery: synchronization.syncRecovery,
      state: synchronization.syncState,
    },
    updatedAt: row.updatedAt.toISOString(),
  };
}
function guidedDomainProfile(
  row: typeof domainProfiles.$inferSelect,
  status: "active" | "draft" = row.status,
): NonNullable<FinanceGuidedSetupContext["guidance"]["draftProposal"]> {
  return {
    categories: row.categories,
    createdAt: row.createdAt.toISOString(),
    domain: "finances",
    id: row.id,
    instructions: row.instructions,
    objective: row.objective,
    preferences: row.preferences,
    sourceContexts: row.sourceContexts,
    status,
    summary: row.summary,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}
function transaction(
  row: typeof financeTransactions.$inferSelect,
  displayMerchant = row.merchant,
): FinanceTransaction {
  return {
    accountId: row.accountId,
    amount: row.amount / 100,
    category: row.category,
    categoryConfidence: row.categoryConfidence === null ? null : row.categoryConfidence / 10_000,
    categoryId: row.categoryId,
    categoryRationale: row.categoryRationale,
    categorySource: row.categorySource,
    createdAt: row.createdAt.toISOString(),
    currencyCode: row.currencyCode,
    date: row.transactionDate,
    direction: row.direction,
    id: row.id,
    merchant: displayMerchant,
    merchantId: row.merchantId,
    needsReview: row.needsReview,
    notes: row.notes,
    pending: row.pending,
    providerCategory: row.providerCategory,
    providerCategoryConfidence: row.providerCategoryConfidence as
      | "HIGH"
      | "LOW"
      | "MEDIUM"
      | "UNKNOWN"
      | "VERY_HIGH"
      | null,
    providerDirection: row.providerDirection,
    rawMerchant: row.merchant,
    reconciliationStatus: row.reconciliationStatus,
    updatedAt: row.updatedAt.toISOString(),
  };
}
function budget(row: typeof financeBudgets.$inferSelect): FinanceBudget {
  return {
    category: row.category,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    limit: row.limit / 100,
    month: row.month,
    updatedAt: row.updatedAt.toISOString(),
  };
}
function merchant(
  row: typeof financeMerchants.$inferSelect,
  aliases: string[] = [],
): FinanceMerchant {
  return {
    aliases,
    displayName: row.displayName,
    id: row.id,
    isUserConfirmed: row.isUserConfirmed,
  };
}
function accountAuditSnapshot(value: FinanceAccount) {
  return {
    id: value.id,
    kind: value.kind,
    provider: value.provider,
    status: value.status,
    updatedAt: value.updatedAt,
  };
}
function transactionAuditSnapshot(value: FinanceTransaction) {
  return {
    categoryConfidence: value.categoryConfidence,
    categoryId: value.categoryId,
    categorySource: value.categorySource,
    direction: value.direction,
    id: value.id,
    needsReview: value.needsReview,
    pending: value.pending,
    reconciliationStatus: value.reconciliationStatus,
    updatedAt: value.updatedAt,
  };
}
function reviewAuditSnapshot(value: typeof financeReviewCases.$inferSelect) {
  return {
    id: value.id,
    rationale: value.rationale,
    reason: value.reason,
    status: value.status,
    suggestedCategoryId: value.suggestedCategoryId,
    transactionId: value.transactionId,
    updatedAt: value.updatedAt.toISOString(),
  };
}
function maintenanceAuditAttribution(
  context: Pick<MutationContext, "maintenance">,
  source: MaterialSourceReference,
) {
  return context.maintenance ? { maintenance: context.maintenance, source } : {};
}
function merchantAuditSnapshot(value: FinanceMerchant) {
  return {
    id: value.id,
    isUserConfirmed: value.isUserConfirmed,
  };
}

export function createFinanceService({
  db,
  encryptionKey,
  log,
  now,
  onProposalSnapshotRead,
  plaid,
  providerItems: configuredProviderItems,
}: Options) {
  const providerItems =
    configuredProviderItems ??
    createFinanceProviderItemService({
      db,
      ...(encryptionKey ? { encryptionKey } : {}),
      now,
    });
  async function assertMaintenanceClaim(
    executor: FinanceWriteExecutor,
    context?: MutationContext,
  ): Promise<void> {
    if (!context?.maintenanceClaim) return;
    const [current] = await executor
      .update(workspaceMaintenanceRuns)
      .set({
        leaseExpiresAt: sql`NOW() + ${financeMaintenanceClaimMs} * INTERVAL '1 millisecond'`,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(workspaceMaintenanceRuns.id, context.maintenanceClaim.runId),
          eq(workspaceMaintenanceRuns.userId, context.principal.userId),
          eq(workspaceMaintenanceRuns.domain, "finances"),
          eq(workspaceMaintenanceRuns.status, "running"),
          eq(workspaceMaintenanceRuns.leaseClaimId, context.maintenanceClaim.claimId),
          sql`${workspaceMaintenanceRuns.leaseExpiresAt} > NOW()`,
        ),
      )
      .returning({ id: workspaceMaintenanceRuns.id });
    if (!current) {
      throw new AppError("conflict", "The Finance maintenance claim is no longer current.");
    }
  }

  async function serializeAccounts(rows: Array<typeof financeAccounts.$inferSelect>) {
    const itemIds = rows.flatMap((row) =>
      row.providerItemRecordId ? [row.providerItemRecordId] : [],
    );
    const items =
      itemIds.length === 0
        ? []
        : await db
            .select()
            .from(financeProviderItems)
            .where(inArray(financeProviderItems.id, itemIds));
    const itemById = new Map(items.map((item) => [item.id, item]));
    return rows.map((row) =>
      account(row, row.providerItemRecordId ? itemById.get(row.providerItemRecordId) : undefined),
    );
  }

  async function seedCategories(
    userId: string,
    executor: Pick<Database, "insert" | "select"> = db,
  ) {
    const inserted = await executor
      .insert(financeCategories)
      .values(
        defaultCategories.map(([name, slug]) => ({
          group: categoryGroup(name),
          id: defaultCategoryId(userId, slug),
          isSystem: true,
          name,
          slug,
          userId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: financeCategories.id });
    const categories = await executor
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.userId, userId))
      .orderBy(financeCategories.group, financeCategories.name);
    return { categories, inserted: inserted.length };
  }
  async function ensureCategories(
    userId: string,
    executor: Pick<Database, "insert" | "select"> = db,
  ) {
    return (await seedCategories(userId, executor)).categories;
  }
  async function existingCategories(userId: string) {
    return db
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.userId, userId))
      .orderBy(financeCategories.group, financeCategories.name);
  }

  function categoryValue(row: typeof financeCategories.$inferSelect): FinanceCategory {
    return {
      color: row.color,
      group: row.group,
      id: row.id,
      isSystem: row.isSystem,
      name: row.name,
      slug: row.slug,
    };
  }

  async function categoryForId(userId: string, categoryId: string, context?: MutationContext) {
    let [row] = await db
      .select()
      .from(financeCategories)
      .where(and(eq(financeCategories.id, categoryId), eq(financeCategories.userId, userId)))
      .limit(1);
    if (
      !row &&
      !context?.maintenanceClaim &&
      defaultCategories.some(([, slug]) => defaultCategoryId(userId, slug) === categoryId)
    ) {
      await ensureCategories(userId);
      [row] = await db
        .select()
        .from(financeCategories)
        .where(and(eq(financeCategories.id, categoryId), eq(financeCategories.userId, userId)))
        .limit(1);
    }
    if (!row) throw new AppError("not_found", "The finance category was not found.");
    return row;
  }

  async function categoryForName(
    userId: string,
    name: string,
    executor: FinanceWriteExecutor = db,
  ) {
    const categories = await ensureCategories(userId, executor);
    const existing = categories.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const slug = categorySlug(name);
    const [created] = await executor
      .insert(financeCategories)
      .values({ group: "Custom", isSystem: false, name, slug, userId })
      .onConflictDoUpdate({
        set: { name, updatedAt: now() },
        target: [financeCategories.userId, financeCategories.slug],
      })
      .returning();
    return requireDatabaseRecord(created, "The finance category could not be saved.");
  }

  async function categoryForProposalName(
    userId: string,
    name: string,
  ): Promise<FinanceCategory | null> {
    const existing = (await existingCategories(userId)).find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return categoryValue(existing);
    const defaultCategory = defaultCategories.find(
      ([defaultName]) => defaultName.toLowerCase() === name.toLowerCase(),
    );
    if (!defaultCategory) return null;
    const [defaultName, slug] = defaultCategory;
    return {
      color: null,
      group: categoryGroup(defaultName),
      id: defaultCategoryId(userId, slug),
      isSystem: true,
      name: defaultName,
      slug,
    };
  }

  async function merchantFor(
    userId: string,
    rawMerchant: string,
    source: "agent" | "provider" | "user",
    executor: FinanceWriteExecutor = db,
  ) {
    const normalizedName = normalizedMerchant(rawMerchant);
    const [alias] = await executor
      .select({ merchant: financeMerchants })
      .from(financeMerchantAliases)
      .innerJoin(financeMerchants, eq(financeMerchantAliases.merchantId, financeMerchants.id))
      .where(
        and(
          eq(financeMerchantAliases.userId, userId),
          eq(financeMerchantAliases.normalizedName, normalizedName),
        ),
      )
      .limit(1);
    if (alias) return alias.merchant;
    const [merchant] = await executor
      .insert(financeMerchants)
      .values({
        displayName: titleCaseMerchant(normalizedName || rawMerchant),
        normalizedName,
        userId,
      })
      .onConflictDoUpdate({
        set: { updatedAt: now() },
        target: [financeMerchants.userId, financeMerchants.normalizedName],
      })
      .returning();
    const resolved = requireDatabaseRecord(merchant, "The merchant could not be saved.");
    await executor
      .insert(financeMerchantAliases)
      .values({
        confidence: 10_000,
        merchantId: resolved.id,
        normalizedName,
        rawName: rawMerchant,
        source,
        userId,
      })
      .onConflictDoNothing({
        target: [financeMerchantAliases.userId, financeMerchantAliases.normalizedName],
      });
    return resolved;
  }

  async function merchantConfidenceThreshold(
    userId: string,
    merchantId: string | null,
    categoryId: string,
  ) {
    if (!merchantId) return initialAgentThreshold;
    const decisions = await db
      .select({
        categoryId: financeClassificationDecisions.categoryId,
        outcome: financeClassificationDecisions.outcome,
      })
      .from(financeClassificationDecisions)
      .where(
        and(
          eq(financeClassificationDecisions.userId, userId),
          eq(financeClassificationDecisions.merchantId, merchantId),
        ),
      );
    const confirmations = decisions.filter(
      (item) => item.outcome === "confirmed" && item.categoryId === categoryId,
    ).length;
    const corrections = decisions.filter((item) => item.outcome === "corrected").length;
    return Math.max(0.9, initialAgentThreshold - confirmations * 0.0125 + corrections * 0.02);
  }

  async function learnedCategory(userId: string, merchant: string) {
    const [rule] = await db
      .select({ category: financeCategoryRules.category })
      .from(financeCategoryRules)
      .where(
        and(
          eq(financeCategoryRules.userId, userId),
          eq(financeCategoryRules.merchantNormalized, normalizedMerchant(merchant)),
        ),
      )
      .limit(1);
    return rule?.category;
  }
  async function merchantCategoryEvidence(userId: string, merchantId: string | null) {
    if (!merchantId) return null;
    const decisions = await db
      .select({
        categoryId: financeClassificationDecisions.categoryId,
        categoryName: financeClassificationDecisions.categoryName,
        outcome: financeClassificationDecisions.outcome,
      })
      .from(financeClassificationDecisions)
      .where(
        and(
          eq(financeClassificationDecisions.userId, userId),
          eq(financeClassificationDecisions.merchantId, merchantId),
          eq(financeClassificationDecisions.outcome, "confirmed"),
        ),
      );
    const counts = new Map<string, { category: string; confirmations: number }>();
    for (const decision of decisions) {
      if (!decision.categoryId) continue;
      const current = counts.get(decision.categoryId) ?? {
        category: decision.categoryName,
        confirmations: 0,
      };
      current.confirmations += 1;
      counts.set(decision.categoryId, current);
    }
    const ranked = [...counts.values()].sort((a, b) => b.confirmations - a.confirmations);
    const strongest = ranked[0];
    if (!strongest) return null;
    if (ranked[1]?.confirmations === strongest.confirmations) return null;
    return {
      category: strongest.category,
      // Two independent confirmations are enough to pass the adjusted threshold;
      // a single one remains a reviewable suggestion.
      confidence:
        Math.round(Math.min(0.99, 0.935 + strongest.confirmations * 0.015) * 10_000) / 10_000,
      confirmations: strongest.confirmations,
    };
  }
  async function automaticCategorization(userId: string, merchant: string) {
    return categorization(merchant, await learnedCategory(userId, merchant));
  }
  async function categorizationProposal(
    userId: string,
    item: FinanceTransaction,
    source?: MaterialSourceReference,
  ): Promise<FinanceCategorizationProposal> {
    const rawMerchant = item.rawMerchant ?? item.merchant;
    const learned = await learnedCategory(userId, rawMerchant);
    const automatic = categorization(rawMerchant, learned);
    const evidence = automatic.category
      ? null
      : await merchantCategoryEvidence(userId, item.merchantId ?? null);
    const categoryName = automatic.category ?? evidence?.category ?? null;
    const suggestedCategory = categoryName
      ? await categoryForProposalName(userId, categoryName)
      : null;
    const threshold = suggestedCategory
      ? await merchantConfidenceThreshold(userId, item.merchantId ?? null, suggestedCategory.id)
      : initialAgentThreshold;
    const confidence =
      automatic.confidence === null ? (evidence?.confidence ?? 0) : automatic.confidence / 10_000;
    return {
      confidence,
      meetsPolicyThreshold: suggestedCategory !== null && confidence >= threshold,
      policy: "preview",
      rationale: automatic.category
        ? learned
          ? `Matched ${item.merchant} using a confirmed merchant rule.`
          : `Matched ${item.merchant} using a deterministic Finance classification.`
        : evidence
          ? `Matched ${item.merchant} to ${evidence.confirmations} user confirmation${evidence.confirmations === 1 ? "" : "s"}.`
          : "No durable merchant or category evidence is available yet.",
      source:
        source ?? (await financeTransactionSource(userId, await ownedTransaction(userId, item.id))),
      suggestionBasis: learned ? "merchant_rule" : evidence ? "transaction_evidence" : null,
      suggestedCategory,
      threshold,
      transaction: item,
    };
  }
  async function reconcileBudgetTransfers(
    userId: string,
    scope: MaintenanceScope = { type: "all_outstanding" },
    context?: MutationContext,
    onProgress?: FinanceSyncProgress,
  ) {
    await onProgress?.();
    await assertMaintenanceScopeOwned(userId, scope);
    return db.transaction(async (tx) => {
      await assertMaintenanceClaim(tx, context);
      // Account locks serialize reconciliation runs for one user. Transaction
      // locks then ensure decisions are evaluated from current rows and cannot
      // be overwritten between matching and persistence.
      const lockedAccounts = await tx
        .select()
        .from(financeAccounts)
        .where(eq(financeAccounts.userId, userId))
        .orderBy(financeAccounts.id)
        .for("update");
      const transfers = await categoryForName(userId, transferCategory, tx);
      const rent = await categoryForName(userId, rentCategory, tx);
      const accountById = new Map(lockedAccounts.map((account) => [account.id, account]));
      const sourceFor = (item: typeof financeTransactions.$inferSelect) => {
        const sourceAccount = accountById.get(item.accountId);
        if (!sourceAccount) throw new AppError("not_found", "The financial account was not found.");
        return financeTransactionSourceValue(sourceAccount, item);
      };
      const hasExplicitDecision = (item: typeof financeTransactions.$inferSelect) =>
        item.categoryDecidedAt !== null &&
        (item.categorySource === "user" || item.categorySource === "agent");
      const targetReviewTransactionId =
        scope.type === "target" && scope.entityType === "finance_review_case"
          ? ((
              await tx
                .select({ transactionId: financeReviewCases.transactionId })
                .from(financeReviewCases)
                .where(
                  and(eq(financeReviewCases.id, scope.id), eq(financeReviewCases.userId, userId)),
                )
                .limit(1)
            )[0]?.transactionId ?? null)
          : null;
      const inScope = (item: typeof financeTransactions.$inferSelect) => {
        if (scope.type === "window") {
          return item.transactionDate >= scope.start && item.transactionDate <= scope.end;
        }
        if (scope.type !== "target") return true;
        if (scope.entityType === "finance_transaction") return item.id === scope.id;
        if (scope.entityType === "finance_account") return item.accountId === scope.id;
        if (scope.entityType === "finance_review_case") {
          return item.id === targetReviewTransactionId;
        }
        return false;
      };
      const movementDirection = (item: typeof financeTransactions.$inferSelect) =>
        item.direction === "transfer" ? item.providerDirection : item.direction;
      const isMovementCandidate = (item: typeof financeTransactions.$inferSelect) =>
        item.reconciliationStatus !== "matched" &&
        item.reconciliationStatus !== "confirmed" &&
        (item.direction === "transfer" ||
          isProviderTransfer(item.providerCategory) ||
          isProviderTransfer(item.providerCategoryDetailed) ||
          isCardPayment(item.merchant) ||
          isSoFiVaultTransfer(item.merchant));
      // Provider syncs take the same account locks, so merchant/direction fields
      // are stable while this reconciliation runs. Discover possible rule or
      // pairing rows without locking the full ledger, then lock only that
      // semantic subset before making decisions.
      const candidateRows = await tx
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.userId, userId))
        .orderBy(financeTransactions.id);
      const candidateIds = candidateRows
        .filter(inScope)
        .filter((item) => !hasExplicitDecision(item))
        .filter((item) => isMovementCandidate(item) || isRentMerchant(item.merchant))
        .map((item) => item.id);
      const transactions: Array<typeof financeTransactions.$inferSelect> = [];
      for (let offset = 0; offset < candidateIds.length; offset += 1_000) {
        const locked = await tx
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              inArray(financeTransactions.id, candidateIds.slice(offset, offset + 1_000)),
            ),
          )
          .orderBy(financeTransactions.id)
          .for("update");
        transactions.push(...locked);
      }
      const rentTransactions = transactions
        .filter((item) => isRentMerchant(item.merchant))
        .filter((item) => !hasExplicitDecision(item))
        .filter(
          (item) =>
            item.categoryId !== rent.id ||
            item.category !== rentCategory ||
            item.categoryConfidence !== 10_000 ||
            item.categorySource !== "rule" ||
            item.direction !== "expense" ||
            item.needsReview,
        );
      const movementCandidates = transactions.filter(
        (item) =>
          !item.pending &&
          !isRentMerchant(item.merchant) &&
          !hasExplicitDecision(item) &&
          isMovementCandidate(item),
      );
      const pairedIds = new Set<string>();
      const compatibleCounterparts = (item: typeof financeTransactions.$inferSelect) =>
        movementCandidates.filter(
          (candidate) =>
            candidate.id !== item.id &&
            candidate.accountId !== item.accountId &&
            movementDirection(candidate) !== null &&
            movementDirection(item) !== null &&
            movementDirection(candidate) !== movementDirection(item) &&
            candidate.amount === item.amount &&
            item.currencyCode !== null &&
            candidate.currencyCode === item.currencyCode &&
            Math.abs(
              Date.parse(`${candidate.transactionDate}T12:00:00Z`) -
                Date.parse(`${item.transactionDate}T12:00:00Z`),
            ) <=
              3 * 24 * 60 * 60 * 1000,
        );
      for (const debit of movementCandidates) {
        if (movementDirection(debit) !== "expense" || pairedIds.has(debit.id)) continue;
        const matches = compatibleCounterparts(debit);
        const credit = matches.length === 1 ? matches[0] : undefined;
        if (!credit || compatibleCounterparts(credit).length !== 1 || pairedIds.has(credit.id)) {
          continue;
        }
        pairedIds.add(debit.id);
        pairedIds.add(credit.id);
        const transferGroupId = randomUUID();
        await tx
          .update(financeTransactions)
          .set({
            category: transferCategory,
            categoryConfidence: 10_000,
            categoryId: transfers.id,
            categoryRationale: "Matched as movement between accounts, not new spending.",
            categorySource: "rule",
            direction: "transfer",
            needsReview: false,
            reconciliationStatus: "matched",
            transferGroupId,
            updatedAt: now(),
          })
          .where(
            and(
              eq(financeTransactions.userId, userId),
              inArray(financeTransactions.id, [debit.id, credit.id]),
            ),
          );
        const auditContext =
          context ??
          ({
            principal: {
              actorId: userId,
              actorType: "system",
              userId,
            },
            requestId: `finance-reconciliation:${userId}`,
          } as const);
        await tx.insert(auditEvents).values(
          [debit, credit].map((item) =>
            auditValues({
              action: "finance.transfer_reconciled",
              after: {
                direction: "transfer",
                ...(context ? maintenanceAuditAttribution(context, sourceFor(item)) : {}),
                reconciliationStatus: "matched",
                transferGroupId,
              },
              before: {
                direction: item.direction,
                reconciliationStatus: item.reconciliationStatus,
                transferGroupId: item.transferGroupId,
              },
              entityId: item.id,
              entityType: "finance_transaction",
              ...auditContext,
            }),
          ),
        );
      }
      if (pairedIds.size > 0) {
        await tx
          .update(financeReviewCases)
          .set({ resolvedAt: now(), status: "resolved", updatedAt: now() })
          .where(
            and(
              eq(financeReviewCases.userId, userId),
              inArray(financeReviewCases.transactionId, [...pairedIds]),
              inArray(financeReviewCases.status, ["deferred", "open"]),
            ),
          );
      }
      const transferCandidates = movementCandidates.filter((item) => !pairedIds.has(item.id));
      for (const item of transferCandidates) {
        const source = sourceFor(item);
        if (!item.needsReview || item.reconciliationStatus !== "candidate") {
          const [updated] = await tx
            .update(financeTransactions)
            .set({
              needsReview: true,
              reconciliationStatus: "candidate",
              updatedAt: now(),
            })
            .where(and(eq(financeTransactions.id, item.id), eq(financeTransactions.userId, userId)))
            .returning();
          if (updated && context?.maintenance) {
            await tx.insert(auditEvents).values(
              auditValues({
                action: "finance.transfer_candidate_queued",
                after: {
                  ...transactionAuditSnapshot(transaction(updated)),
                  ...maintenanceAuditAttribution(context, source),
                },
                before: transactionAuditSnapshot(transaction(item)),
                entityId: item.id,
                entityType: "finance_transaction",
                ...context,
              }),
            );
          }
        }
        await putInReview(
          item.id,
          userId,
          "possible_transfer",
          null,
          "Provider marked this movement as a transfer, but no internal counterpart is confirmed.",
          tx,
          context,
          source,
        );
      }
      if (rentTransactions.length > 0) {
        const updatedRent = await tx
          .update(financeTransactions)
          .set({
            category: rentCategory,
            categoryConfidence: 10_000,
            categoryId: rent.id,
            categoryRationale: "User rule: Lee Tachman/Tackman is rent.",
            categorySource: "rule",
            direction: "expense",
            needsReview: false,
            updatedAt: now(),
          })
          .where(
            and(
              eq(financeTransactions.userId, userId),
              inArray(
                financeTransactions.id,
                rentTransactions.map((item) => item.id),
              ),
            ),
          )
          .returning();
        if (context?.maintenance) {
          const beforeById = new Map(rentTransactions.map((item) => [item.id, item]));
          await tx.insert(auditEvents).values(
            updatedRent.map((updated) => {
              const before = beforeById.get(updated.id);
              if (!before) {
                throw new AppError("conflict", "The rent classification set changed.");
              }
              return auditValues({
                action: "finance.rent_rule_applied",
                after: {
                  ...transactionAuditSnapshot(transaction(updated)),
                  ...maintenanceAuditAttribution(context, sourceFor(before)),
                },
                before: transactionAuditSnapshot(transaction(before)),
                entityId: updated.id,
                entityType: "finance_transaction",
                ...context,
              });
            }),
          );
        }
      }
      return { paired: pairedIds.size / 2, transfers: pairedIds.size };
    });
  }
  async function repairHeuristicTransfers(
    userId: string,
    scope: MaintenanceScope,
    cursor: string | undefined,
    context: MutationContext,
    onProgress?: FinanceSyncProgress,
  ) {
    const sliceLimit = 100;
    await onProgress?.();
    await assertMaintenanceScopeOwned(userId, scope);
    const targetReviewTransactionId =
      scope.type === "target" && scope.entityType === "finance_review_case"
        ? (
            await db
              .select({ transactionId: financeReviewCases.transactionId })
              .from(financeReviewCases)
              .where(
                and(eq(financeReviewCases.id, scope.id), eq(financeReviewCases.userId, userId)),
              )
              .limit(1)
          )[0]?.transactionId
        : undefined;
    return db.transaction(async (tx) => {
      await assertMaintenanceClaim(tx, context);
      const lockedAccounts = await tx
        .select()
        .from(financeAccounts)
        .where(eq(financeAccounts.userId, userId))
        .orderBy(financeAccounts.id)
        .for("update");
      const accountById = new Map(lockedAccounts.map((account) => [account.id, account]));
      const plaidAccountIds = lockedAccounts
        .filter((account) => account.provider === "plaid")
        .map((account) => account.id);
      if (plaidAccountIds.length === 0) {
        return { complete: true, inspected: 0, nextCursor: null, repaired: 0 };
      }
      const scopeCondition =
        scope.type === "window"
          ? and(
              gte(financeTransactions.transactionDate, scope.start),
              lte(financeTransactions.transactionDate, scope.end),
            )
          : scope.type === "target" && scope.entityType === "finance_account"
            ? eq(financeTransactions.accountId, scope.id)
            : scope.type === "target" && scope.entityType === "finance_transaction"
              ? eq(financeTransactions.id, scope.id)
              : scope.type === "target" && scope.entityType === "finance_review_case"
                ? eq(financeTransactions.id, targetReviewTransactionId as string)
                : undefined;
      const rows = await tx
        .select()
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.userId, userId),
            inArray(financeTransactions.accountId, plaidAccountIds),
            cursor ? gt(financeTransactions.id, cursor) : undefined,
            scopeCondition,
            sql`${financeTransactions.providerDirection} IS NOT NULL`,
            isNull(financeTransactions.transferGroupId),
            or(
              eq(financeTransactions.direction, "transfer"),
              eq(financeTransactions.reconciliationStatus, "confirmed"),
            ),
            or(
              eq(financeTransactions.providerCategory, "TRANSFER_IN"),
              eq(financeTransactions.providerCategory, "TRANSFER_OUT"),
              eq(financeTransactions.providerCategoryDetailed, "TRANSFER_IN"),
              eq(financeTransactions.providerCategoryDetailed, "TRANSFER_OUT"),
              sql`${financeTransactions.merchant} ~* ${String.raw`\y(?:to|from|2x)\y.*\yvault\y`}`,
            ),
            sql`(${financeTransactions.categoryDecidedAt} IS NULL OR ${financeTransactions.categorySource} IS NULL OR ${financeTransactions.categorySource} NOT IN ('user', 'agent'))`,
          ),
        )
        .orderBy(financeTransactions.id)
        .for("update")
        .limit(sliceLimit);
      let repaired = 0;
      for (const [index, item] of rows.entries()) {
        if (index > 0 && index % 25 === 0) await assertMaintenanceClaim(tx, context);
        // The fenced query above selects only rows from the locked Plaid
        // account set with a non-null provider direction and the exact legacy
        // heuristic signature. Do not maintain a second eligibility predicate
        // that can drift from the authoritative SQL selection.
        const account = accountById.get(item.accountId) as typeof financeAccounts.$inferSelect;
        const updated = requireDatabaseRecord(
          (
            await tx
              .update(financeTransactions)
              .set({
                direction: item.providerDirection as "expense" | "income",
                needsReview: true,
                reconciliationStatus: "candidate",
                transferGroupId: null,
                updatedAt: now(),
              })
              .where(
                and(eq(financeTransactions.id, item.id), eq(financeTransactions.userId, userId)),
              )
              .returning()
          )[0],
          "The legacy transfer changed before it could be repaired.",
        );
        const source = financeTransactionSourceValue(account, item);
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.transfer_heuristic_repaired",
            after: {
              ...transactionAuditSnapshot(transaction(updated)),
              ...maintenanceAuditAttribution(context, source),
            },
            before: transactionAuditSnapshot(transaction(item)),
            entityId: item.id,
            entityType: "finance_transaction",
            ...context,
          }),
        );
        if (!item.pending) {
          await putInReview(
            item.id,
            userId,
            "possible_transfer",
            null,
            "A previous provider or merchant heuristic marked this as a transfer without authoritative matching evidence.",
            tx,
            context,
            source,
          );
        }
        repaired += 1;
      }
      const complete = rows.length < sliceLimit;
      return {
        complete,
        inspected: rows.length,
        nextCursor: complete
          ? null
          : (rows[sliceLimit - 1] as typeof financeTransactions.$inferSelect).id,
        repaired,
      };
    });
  }
  function getPlaid() {
    if (!plaid) {
      throw new AppError("invalid_request", "Plaid is not configured for this ilo instance.");
    }
    return plaid;
  }
  async function ownedAccount(userId: string, id: string) {
    const [row] = await db
      .select()
      .from(financeAccounts)
      .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)))
      .limit(1);
    if (!row) throw new AppError("not_found", "The financial account was not found.");
    return row;
  }
  async function ownedTransaction(userId: string, id: string) {
    const [row] = await db
      .select()
      .from(financeTransactions)
      .where(and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId)))
      .limit(1);
    if (!row) throw new AppError("not_found", "The transaction was not found.");
    return row;
  }
  async function assertMaintenanceScopeOwned(userId: string, scope: MaintenanceScope) {
    if (scope.type !== "target") return;
    if (scope.entityType === "finance_account") {
      await ownedAccount(userId, scope.id);
      return;
    }
    if (scope.entityType === "finance_transaction") {
      await ownedTransaction(userId, scope.id);
      return;
    }
    if (scope.entityType === "finance_review_case") {
      const [review] = await db
        .select({ id: financeReviewCases.id })
        .from(financeReviewCases)
        .where(and(eq(financeReviewCases.id, scope.id), eq(financeReviewCases.userId, userId)))
        .limit(1);
      if (!review) throw new AppError("not_found", "The finance review case was not found.");
      return;
    }
    throw new AppError("invalid_request", "The Finance target type is not supported.");
  }
  async function maintenanceScopeAccountId(
    userId: string,
    scope: MaintenanceScope,
  ): Promise<string | undefined> {
    if (scope.type !== "target") return undefined;
    if (scope.entityType === "finance_account") return (await ownedAccount(userId, scope.id)).id;
    if (scope.entityType === "finance_transaction") {
      return (await ownedTransaction(userId, scope.id)).accountId;
    }
    if (scope.entityType === "finance_review_case") {
      const [row] = await db
        .select({ accountId: financeTransactions.accountId })
        .from(financeReviewCases)
        .innerJoin(
          financeTransactions,
          eq(financeTransactions.id, financeReviewCases.transactionId),
        )
        .where(and(eq(financeReviewCases.id, scope.id), eq(financeReviewCases.userId, userId)))
        .limit(1);
      if (!row) throw new AppError("not_found", "The finance review case was not found.");
      return row.accountId;
    }
    throw new AppError("invalid_request", "The Finance target type is not supported.");
  }
  async function financeTransactionSource(
    userId: string,
    item: typeof financeTransactions.$inferSelect,
    executor: Pick<Database, "select"> = db,
  ): Promise<MaterialSourceReference> {
    const [account] = await executor
      .select()
      .from(financeAccounts)
      .where(and(eq(financeAccounts.id, item.accountId), eq(financeAccounts.userId, userId)))
      .limit(1);
    if (!account) throw new AppError("not_found", "The financial account was not found.");
    return financeTransactionSourceValue(account, item);
  }
  function financeTransactionSourceValue(
    account: typeof financeAccounts.$inferSelect,
    item: typeof financeTransactions.$inferSelect,
  ): MaterialSourceReference {
    const provider = account.provider === "manual" ? ("local" as const) : account.provider;
    return {
      accountId: account.id,
      provider,
      remoteId: provider === "local" ? item.id : item.providerTransactionId,
      revision: item.updatedAt.toISOString(),
      sourceType: "finance_transaction",
    };
  }
  function financeIncomeStreamSourceValue(
    stream: typeof financeIncomeStreams.$inferSelect,
  ): MaterialSourceReference {
    return {
      accountId: stream.accountId,
      provider: "local",
      remoteId: stream.id,
      revision: stream.updatedAt.toISOString(),
      sourceType: "finance_income_stream",
    };
  }
  function financeAccountSourceValue(
    financeAccount: typeof financeAccounts.$inferSelect,
  ): MaterialSourceReference {
    const provider = financeAccount.provider === "manual" ? "local" : financeAccount.provider;
    return {
      accountId: financeAccount.id,
      provider,
      remoteId: provider === "local" ? financeAccount.id : financeAccount.providerAccountId,
      revision: financeAccount.updatedAt.toISOString(),
      sourceType: "finance_account",
    };
  }
  function financeRecurringObligationSourceValue(
    obligation: typeof financeRecurringObligations.$inferSelect,
  ): MaterialSourceReference {
    return {
      accountId: obligation.accountId,
      provider: "local",
      remoteId: obligation.id,
      revision: obligation.updatedAt.toISOString(),
      sourceType: "finance_recurring_obligation",
    };
  }
  async function ownedMerchant(userId: string, id: string) {
    const [row] = await db
      .select()
      .from(financeMerchants)
      .where(and(eq(financeMerchants.id, id), eq(financeMerchants.userId, userId)))
      .limit(1);
    if (!row) throw new AppError("not_found", "The finance merchant was not found.");
    return row;
  }
  async function enrichTransaction(
    row: typeof financeTransactions.$inferSelect,
    executor: FinanceReadExecutor = db,
  ) {
    const merchant = row.merchantId
      ? (
          await executor
            .select()
            .from(financeMerchants)
            .where(eq(financeMerchants.id, row.merchantId))
            .limit(1)
        )[0]
      : null;
    const normalizedDisplayName = normalizedMerchant(row.merchant).replaceAll("-", " ");
    return transaction(
      row,
      merchant?.displayName ?? titleCaseMerchant(normalizedDisplayName || row.merchant),
    );
  }

  async function enrichTransactions(
    rows: Array<typeof financeTransactions.$inferSelect>,
    executor: FinanceReadExecutor = db,
  ): Promise<FinanceTransaction[]> {
    const merchantIds = [
      ...new Set(rows.map((item) => item.merchantId).filter(Boolean)),
    ] as string[];
    const merchants: Array<typeof financeMerchants.$inferSelect> = [];
    for (let offset = 0; offset < merchantIds.length; offset += 1_000) {
      merchants.push(
        ...(await executor
          .select()
          .from(financeMerchants)
          .where(inArray(financeMerchants.id, merchantIds.slice(offset, offset + 1_000)))),
      );
    }
    const merchantNames = new Map(merchants.map((item) => [item.id, item.displayName]));
    return rows.map((item) => {
      const normalizedDisplayName = normalizedMerchant(item.merchant).replaceAll("-", " ");
      return transaction(
        item,
        (item.merchantId ? merchantNames.get(item.merchantId) : null) ??
          titleCaseMerchant(normalizedDisplayName || item.merchant),
      );
    });
  }

  async function listTransactionsPage(
    userId: string,
    query: TransactionListQuery,
    executor: FinanceReadExecutor = db,
  ) {
    const conditions = [eq(financeTransactions.userId, userId)];
    const sortBy = query.sortBy ?? "date";
    const sortDirection = query.sortDirection ?? "desc";
    if (query.accountId) conditions.push(eq(financeTransactions.accountId, query.accountId));
    if (query.categoryId) conditions.push(eq(financeTransactions.categoryId, query.categoryId));
    if (query.from) conditions.push(gte(financeTransactions.transactionDate, query.from));
    if (query.to) conditions.push(lte(financeTransactions.transactionDate, query.to));
    if (query.pending !== undefined)
      conditions.push(eq(financeTransactions.pending, query.pending));
    if (query.review === "needs_review") conditions.push(eq(financeTransactions.needsReview, true));
    if (query.review === "resolved") conditions.push(eq(financeTransactions.needsReview, false));
    const sortColumn =
      sortBy === "amount"
        ? financeTransactions.amount
        : sortBy === "merchant"
          ? financeTransactions.merchant
          : financeTransactions.transactionDate;
    if (query.cursor) {
      const cursor = decodeTransactionCursor(query.cursor);
      if (cursor.sortBy !== sortBy || cursor.direction !== sortDirection) {
        throw new AppError("invalid_request", "The transaction cursor does not match this sort.");
      }
      const isAscending = sortDirection === "asc";
      const paginationCondition = or(
        isAscending ? gt(sortColumn, cursor.value) : lt(sortColumn, cursor.value),
        and(
          eq(sortColumn, cursor.value),
          isAscending
            ? gt(financeTransactions.id, cursor.id)
            : lt(financeTransactions.id, cursor.id),
        ),
      );
      if (paginationCondition) conditions.push(paginationCondition);
    }
    const rows = await executor
      .select()
      .from(financeTransactions)
      .where(and(...conditions))
      .orderBy(
        sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn),
        sortDirection === "asc" ? asc(financeTransactions.id) : desc(financeTransactions.id),
      )
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const items = await enrichTransactions(page, executor);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeTransactionCursor(last, sortBy, sortDirection)
          : null,
    };
  }

  async function persistTransactionEnrichment(row: typeof financeTransactions.$inferSelect) {
    const merchant = row.merchantId
      ? (
          await db
            .select()
            .from(financeMerchants)
            .where(eq(financeMerchants.id, row.merchantId))
            .limit(1)
        )[0]
      : await merchantFor(row.userId, row.merchant, "provider");
    const category =
      row.categoryId === null && row.category
        ? await categoryForName(row.userId, row.category)
        : null;
    const next =
      row.merchantId === merchant?.id && (row.categoryId !== null || !category)
        ? row
        : requireDatabaseRecord(
            (
              await db
                .update(financeTransactions)
                .set({
                  categoryId: row.categoryId ?? category?.id ?? null,
                  merchantId: merchant?.id ?? null,
                  updatedAt: now(),
                })
                .where(eq(financeTransactions.id, row.id))
                .returning()
            )[0],
            "The transaction could not be enriched.",
          );
    return next;
  }

  async function putInReview(
    transactionId: string,
    userId: string,
    reason:
      | "ambiguous_merchant"
      | "low_confidence"
      | "one_time"
      | "possible_duplicate"
      | "possible_transfer"
      | "unknown_merchant",
    suggestedCategoryId: string | null,
    rationale: string | null,
    executor: FinanceReviewExecutor = db,
    context?: MutationContext,
    source?: MaterialSourceReference,
  ) {
    const [existing] = await executor
      .select()
      .from(financeReviewCases)
      .where(
        and(
          eq(financeReviewCases.transactionId, transactionId),
          eq(financeReviewCases.userId, userId),
          inArray(financeReviewCases.status, ["deferred", "open"]),
        ),
      )
      .orderBy(desc(financeReviewCases.updatedAt))
      .limit(1);
    if (existing) {
      if (
        existing.reason === reason &&
        existing.suggestedCategoryId === suggestedCategoryId &&
        existing.rationale === rationale
      ) {
        return existing;
      }
      const [updated] = await executor
        .update(financeReviewCases)
        .set({ rationale, reason, suggestedCategoryId, updatedAt: now() })
        .where(eq(financeReviewCases.id, existing.id))
        .returning();
      const saved = requireDatabaseRecord(updated, "The finance review case could not be saved.");
      if (context?.maintenance && source) {
        await executor.insert(auditEvents).values(
          auditValues({
            action: "finance.review_queued",
            after: {
              ...reviewAuditSnapshot(saved),
              ...maintenanceAuditAttribution(context, source),
            },
            before: reviewAuditSnapshot(existing),
            entityId: saved.id,
            entityType: "finance_review_case",
            ...context,
          }),
        );
      }
      return saved;
    }
    const [review] = await executor
      .insert(financeReviewCases)
      .values({
        rationale,
        reason,
        status: "open",
        suggestedCategoryId,
        transactionId,
        userId,
      })
      .returning();
    const saved = requireDatabaseRecord(review, "The finance review case could not be saved.");
    if (context?.maintenance && source) {
      await executor.insert(auditEvents).values(
        auditValues({
          action: "finance.review_queued",
          after: {
            ...reviewAuditSnapshot(saved),
            ...maintenanceAuditAttribution(context, source),
          },
          before: null,
          entityId: saved.id,
          entityType: "finance_review_case",
          ...context,
        }),
      );
    }
    return saved;
  }

  async function applyCategorization(
    decision: ApplyFinanceCategorizationsInput["decisions"][number],
    context: MutationContext,
    source: DecisionSource,
    userOutcome: "confirmed" | "corrected" = "confirmed",
    options: {
      auditAction?: "finance.transaction_categorized" | "finance.transfer_confirmed";
      direction?: "expense" | "income" | "transfer";
      reconciliationStatus?: "confirmed" | "not_applicable";
      requiredReviewId?: string;
    } = {},
  ) {
    const before = await ownedTransaction(context.principal.userId, decision.transactionId);
    const maintenanceSource = context.maintenance
      ? await financeTransactionSource(context.principal.userId, before)
      : null;
    const category = await categoryForId(context.principal.userId, decision.categoryId, context);
    const beforeValue = transaction(before);
    if (beforeValue.updatedAt !== decision.expectedTransactionUpdatedAt) {
      throw new AppError("conflict", "The transaction changed after the proposal was prepared.", {
        currentUpdatedAt: beforeValue.updatedAt,
      });
    }
    let threshold = await merchantConfidenceThreshold(
      context.principal.userId,
      before.merchantId,
      category.id,
    );
    let confidence = decision.confidence;
    if (source === "agent" || source === "rule") {
      const proposal = await categorizationProposal(context.principal.userId, beforeValue);
      const requiredBasis = source === "rule" ? "merchant_rule" : "transaction_evidence";
      if (
        proposal.suggestedCategory?.id !== category.id ||
        proposal.confidence !== decision.confidence ||
        proposal.suggestionBasis !== requiredBasis
      ) {
        throw new AppError(
          "conflict",
          "The accepted categorization no longer matches the server proposal.",
        );
      }
      confidence = proposal.confidence;
      threshold = proposal.threshold;
    }
    const canApply = source !== "agent" || confidence >= threshold;
    if (!canApply) {
      const replayed = await db.transaction(async (tx) => {
        await assertMaintenanceClaim(tx, context);
        const [current] = await tx
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.id, before.id),
              eq(financeTransactions.userId, context.principal.userId),
            ),
          )
          .for("update")
          .limit(1);
        if (!current || current.updatedAt.toISOString() !== decision.expectedTransactionUpdatedAt) {
          throw new AppError("conflict", "The transaction changed while it was being reviewed.");
        }
        if (options.requiredReviewId) {
          const [requiredReview] = await tx
            .select({ status: financeReviewCases.status })
            .from(financeReviewCases)
            .where(
              and(
                eq(financeReviewCases.id, options.requiredReviewId),
                eq(financeReviewCases.userId, context.principal.userId),
              ),
            )
            .for("update")
            .limit(1);
          if (!requiredReview || !["deferred", "open"].includes(requiredReview.status)) {
            throw new AppError(
              "conflict",
              "The finance review case changed before the decision was applied.",
            );
          }
        }
        await tx
          .select({ id: financeCategories.id })
          .from(financeCategories)
          .where(eq(financeCategories.userId, context.principal.userId))
          .orderBy(financeCategories.id)
          .for("update");
        if (source === "agent") {
          const currentProposal = await categorizationProposal(
            context.principal.userId,
            transaction(current),
          );
          if (
            currentProposal.suggestedCategory?.id !== category.id ||
            currentProposal.confidence !== decision.confidence ||
            currentProposal.meetsPolicyThreshold !== canApply
          ) {
            throw new AppError(
              "conflict",
              "The categorization policy changed after the proposal was prepared.",
            );
          }
          confidence = currentProposal.confidence;
          threshold = currentProposal.threshold;
        }
        const [protectedReview] =
          source === "agent"
            ? await tx
                .select({ id: financeReviewCases.id })
                .from(financeReviewCases)
                .where(
                  and(
                    eq(financeReviewCases.transactionId, before.id),
                    eq(financeReviewCases.userId, context.principal.userId),
                    eq(financeReviewCases.reason, "possible_transfer"),
                    inArray(financeReviewCases.status, ["deferred", "open"]),
                  ),
                )
                .limit(1)
            : [];
        if (
          source === "agent" &&
          (current.reconciliationStatus === "candidate" || protectedReview)
        ) {
          throw new AppError(
            "forbidden",
            "Confirming an ambiguous transfer requires an interactive user session.",
          );
        }
        const [existingReview] = await tx
          .select()
          .from(financeReviewCases)
          .where(
            and(
              eq(financeReviewCases.transactionId, before.id),
              eq(financeReviewCases.userId, context.principal.userId),
              inArray(financeReviewCases.status, ["deferred", "open"]),
            ),
          )
          .orderBy(desc(financeReviewCases.updatedAt))
          .limit(1);
        const [existingDecision] = await tx
          .select({ id: financeClassificationDecisions.id })
          .from(financeClassificationDecisions)
          .where(
            and(
              eq(financeClassificationDecisions.transactionId, before.id),
              eq(financeClassificationDecisions.userId, context.principal.userId),
              eq(financeClassificationDecisions.categoryId, category.id),
              eq(financeClassificationDecisions.confidence, Math.round(confidence * 10_000)),
              eq(financeClassificationDecisions.outcome, "deferred"),
              eq(financeClassificationDecisions.rationale, decision.rationale),
              eq(financeClassificationDecisions.source, source),
            ),
          )
          .limit(1);
        if (
          existingReview?.status === "open" &&
          existingReview.reason === "low_confidence" &&
          existingReview.suggestedCategoryId === category.id &&
          existingReview.rationale === decision.rationale &&
          existingDecision
        ) {
          return true;
        }
        const review = existingReview
          ? requireDatabaseRecord(
              (
                await tx
                  .update(financeReviewCases)
                  .set({
                    rationale: decision.rationale,
                    reason: "low_confidence",
                    resolvedAt: null,
                    status: "open",
                    suggestedCategoryId: category.id,
                    updatedAt: now(),
                  })
                  .where(eq(financeReviewCases.id, existingReview.id))
                  .returning()
              )[0],
              "The finance review case could not be updated.",
            )
          : requireDatabaseRecord(
              (
                await tx
                  .insert(financeReviewCases)
                  .values({
                    rationale: decision.rationale,
                    reason: "low_confidence",
                    status: "open",
                    suggestedCategoryId: category.id,
                    transactionId: before.id,
                    userId: context.principal.userId,
                  })
                  .returning()
              )[0],
              "The finance review case could not be created.",
            );
        await tx.insert(financeClassificationDecisions).values({
          categoryId: category.id,
          categoryName: category.name,
          confidence: Math.round(confidence * 10_000),
          merchantId: before.merchantId,
          outcome: "deferred",
          rationale: decision.rationale,
          source,
          transactionId: before.id,
          userId: context.principal.userId,
        });
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.categorization_deferred",
            after: {
              categoryId: category.id,
              confidence,
              reviewId: review.id,
              status: "review_required",
              threshold,
            },
            before: {
              categoryId: beforeValue.categoryId ?? null,
              needsReview: beforeValue.needsReview,
              updatedAt: beforeValue.updatedAt,
            },
            entityId: before.id,
            entityType: "finance_transaction",
            ...context,
          }),
        );
        return false;
      });
      return { applied: false, replayed, threshold, transaction: beforeValue };
    }
    const value = await db.transaction(async (tx) => {
      await assertMaintenanceClaim(tx, context);
      const [current] = await tx
        .select()
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.id, before.id),
            eq(financeTransactions.userId, context.principal.userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current || current.updatedAt.toISOString() !== decision.expectedTransactionUpdatedAt) {
        throw new AppError("conflict", "The transaction changed while it was being categorized.");
      }
      if (options.requiredReviewId) {
        const [requiredReview] = await tx
          .select({ status: financeReviewCases.status })
          .from(financeReviewCases)
          .where(
            and(
              eq(financeReviewCases.id, options.requiredReviewId),
              eq(financeReviewCases.userId, context.principal.userId),
            ),
          )
          .for("update")
          .limit(1);
        if (!requiredReview || !["deferred", "open"].includes(requiredReview.status)) {
          throw new AppError(
            "conflict",
            "The finance review case changed before the decision was applied.",
          );
        }
      }
      await tx
        .select({ id: financeCategories.id })
        .from(financeCategories)
        .where(eq(financeCategories.userId, context.principal.userId))
        .orderBy(financeCategories.id)
        .for("update");
      if (source === "agent" || source === "rule") {
        const currentProposal = await categorizationProposal(
          context.principal.userId,
          transaction(current),
        );
        const requiredBasis = source === "rule" ? "merchant_rule" : "transaction_evidence";
        if (
          currentProposal.suggestedCategory?.id !== category.id ||
          currentProposal.confidence !== decision.confidence ||
          currentProposal.meetsPolicyThreshold !== canApply ||
          currentProposal.suggestionBasis !== requiredBasis
        ) {
          throw new AppError(
            "conflict",
            "The categorization policy changed after the proposal was prepared.",
          );
        }
        confidence = currentProposal.confidence;
        threshold = currentProposal.threshold;
      }
      const [protectedReview] =
        source === "agent" || source === "rule"
          ? await tx
              .select({ id: financeReviewCases.id })
              .from(financeReviewCases)
              .where(
                and(
                  eq(financeReviewCases.transactionId, before.id),
                  eq(financeReviewCases.userId, context.principal.userId),
                  eq(financeReviewCases.reason, "possible_transfer"),
                  inArray(financeReviewCases.status, ["deferred", "open"]),
                ),
              )
              .limit(1)
          : [];
      if (
        (source === "agent" || source === "rule") &&
        (current.reconciliationStatus === "candidate" || protectedReview)
      ) {
        throw new AppError(
          "forbidden",
          "Confirming an ambiguous transfer requires an interactive user session.",
        );
      }
      if (current.pending && decision.learnMerchant === "always") {
        throw new AppError(
          "invalid_request",
          "Pending transactions cannot create permanent categorization evidence.",
        );
      }
      const [updated] = await tx
        .update(financeTransactions)
        .set({
          category: category.name,
          categoryConfidence: Math.round(confidence * 10_000),
          categoryDecidedAt: now(),
          categoryId: category.id,
          categoryRationale: decision.rationale,
          categorySource: source,
          direction: options.direction,
          needsReview: false,
          reconciliationStatus: options.reconciliationStatus,
          transferGroupId: options.reconciliationStatus === "not_applicable" ? null : undefined,
          updatedAt: now(),
        })
        .where(
          and(
            eq(financeTransactions.id, before.id),
            eq(financeTransactions.userId, context.principal.userId),
          ),
        )
        .returning();
      if (!updated) {
        throw new AppError("conflict", "The transaction changed while it was being categorized.");
      }
      if (!current.pending) {
        await tx.insert(financeClassificationDecisions).values({
          categoryId: category.id,
          categoryName: category.name,
          confidence: Math.round(confidence * 10_000),
          merchantId: before.merchantId,
          outcome: source === "user" ? userOutcome : "applied",
          rationale: decision.rationale,
          source,
          transactionId: before.id,
          userId: context.principal.userId,
        });
      }
      await tx
        .update(financeReviewCases)
        .set({ resolvedAt: now(), status: "resolved", updatedAt: now() })
        .where(
          and(
            eq(financeReviewCases.transactionId, before.id),
            inArray(financeReviewCases.status, ["deferred", "open"]),
          ),
        );
      if (!current.pending && decision.learnMerchant === "always") {
        await tx
          .insert(financeCategoryRules)
          .values({
            category: category.name,
            merchantNormalized: normalizedMerchant(before.merchant),
            userId: context.principal.userId,
          })
          .onConflictDoUpdate({
            set: { category: category.name, updatedAt: now() },
            target: [financeCategoryRules.userId, financeCategoryRules.merchantNormalized],
          });
      }
      const after = transaction(updated);
      await tx.insert(auditEvents).values(
        auditValues({
          action: options.auditAction ?? "finance.transaction_categorized",
          after: {
            ...transactionAuditSnapshot(after),
            ...(maintenanceSource ? maintenanceAuditAttribution(context, maintenanceSource) : {}),
          },
          before: transactionAuditSnapshot(beforeValue),
          entityId: updated.id,
          entityType: "finance_transaction",
          ...context,
        }),
      );
      return after;
    });
    return { applied: true, replayed: false, threshold, transaction: value };
  }

  const profileValue = (row: typeof financeProfiles.$inferSelect): FinanceProfile => ({
    effectiveDate: row.effectiveDate,
    employer: row.employer,
    employmentType: row.employmentType,
    expectedNetPay: row.expectedNetPay === null ? null : row.expectedNetPay / 100,
    grossAnnualIncome: row.grossAnnualIncome === null ? null : row.grossAnnualIncome / 100,
    nextPayday: row.nextPayday,
    payAccountId: row.payAccountId,
    payFrequency: row.payFrequency,
    role: row.role,
    updatedAt: row.updatedAt.toISOString(),
  });
  const incomeStreamValue = (
    row: typeof financeIncomeStreams.$inferSelect,
  ): FinanceIncomeStream => ({
    accountId: row.accountId,
    cadence: row.cadence,
    confidence: row.confidence / 10_000,
    displayName: row.displayName,
    expectedAmount: row.expectedAmount / 100,
    id: row.id,
    lastObservedDate: row.lastObservedDate,
    nextExpectedDate: row.nextExpectedDate,
    payer: row.payer,
    source: row.source,
    status: row.status,
  });
  const recurringValue = (
    row: typeof financeRecurringObligations.$inferSelect,
  ): FinanceRecurringObligation => ({
    accountId: row.accountId,
    cadence: row.cadence,
    confidence: row.confidence / 10_000,
    displayName: row.displayName,
    expectedAmount: row.expectedAmount / 100,
    id: row.id,
    kind: row.kind,
    lastObservedDate: row.lastObservedDate,
    merchant: row.merchant,
    nextExpectedDate: row.nextExpectedDate,
    source: row.source,
    status: row.status,
  });
  const alertValue = (row: typeof financeAlerts.$inferSelect): FinanceAlert => ({
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    evidence: row.evidence,
    id: row.id,
    recurringObligationId: row.recurringObligationId,
    severity: row.severity,
    status: row.status,
    title: row.title,
    type: row.type,
  });
  function isSubscription(row: typeof financeTransactions.$inferSelect) {
    return (
      row.category?.toLowerCase() === "subscriptions" ||
      /netflix|spotify|adobe|apple\.com\/bill|icloud|youtube|hulu|disney|amazon prime|dropbox|notion|chatgpt|github/i.test(
        row.merchant,
      )
    );
  }
  async function openAlert(
    input: {
      body: string;
      evidence: Record<string, unknown>;
      incomeStreamId?: string | null;
      recurringObligationId?: string | null;
      severity: "info" | "warning";
      title: string;
      transactionId?: string | null;
      type:
        | "income_changed"
        | "income_missing"
        | "recurring_amount_changed"
        | "recurring_missing"
        | "subscription_price_changed";
      userId: string;
    },
    executor: FinanceWriteExecutor = db,
    context?: MutationContext,
    source?: MaterialSourceReference,
  ) {
    if (context?.maintenance && !source) {
      throw new AppError("conflict", "The Finance alert source evidence is unavailable.");
    }
    const existing = await executor
      .select({ id: financeAlerts.id })
      .from(financeAlerts)
      .where(
        and(
          eq(financeAlerts.userId, input.userId),
          eq(financeAlerts.type, input.type),
          eq(financeAlerts.status, "open"),
          input.incomeStreamId
            ? eq(financeAlerts.incomeStreamId, input.incomeStreamId)
            : isNull(financeAlerts.incomeStreamId),
          input.recurringObligationId
            ? eq(financeAlerts.recurringObligationId, input.recurringObligationId)
            : isNull(financeAlerts.recurringObligationId),
        ),
      )
      .limit(1);
    if (existing.length) return;
    const [saved] = await executor
      .insert(financeAlerts)
      .values({
        ...input,
        incomeStreamId: input.incomeStreamId ?? null,
        recurringObligationId: input.recurringObligationId ?? null,
        transactionId: input.transactionId ?? null,
      })
      .returning();
    if (saved && context?.maintenance && source) {
      await executor.insert(auditEvents).values(
        auditValues({
          action: "finance.alert_queued",
          after: {
            severity: saved.severity,
            status: saved.status,
            type: saved.type,
            ...maintenanceAuditAttribution(context, source),
          },
          before: null,
          entityId: saved.id,
          entityType: "finance_alert",
          ...context,
        }),
      );
    }
  }
  async function refreshCashflowIntelligence(
    userId: string,
    executor: FinanceWriteExecutor = db,
    context?: MutationContext,
  ) {
    const transactions = await executor
      .select()
      .from(financeTransactions)
      .where(and(eq(financeTransactions.userId, userId), eq(financeTransactions.pending, false)))
      .orderBy(asc(financeTransactions.transactionDate));
    const today = now().toISOString().slice(0, 10);
    const incomeByPayer = new Map<string, Array<typeof financeTransactions.$inferSelect>>();
    const expensesByMerchant = new Map<string, Array<typeof financeTransactions.$inferSelect>>();
    for (const item of transactions) {
      if (item.direction === "income" && item.category !== "OTHER") {
        const key = normalizedMerchant(item.merchant);
        incomeByPayer.set(key, [...(incomeByPayer.get(key) ?? []), item]);
      }
      if (item.direction === "expense") {
        const key = normalizedMerchant(item.merchant);
        expensesByMerchant.set(key, [...(expensesByMerchant.get(key) ?? []), item]);
      }
    }
    for (const [payer, rows] of incomeByPayer) {
      const cadence = cadenceFromDates(rows.map((row) => row.transactionDate));
      if (!cadence || !["weekly", "biweekly", "monthly"].includes(cadence.cadence)) continue;
      const amounts = rows.map((row) => row.amount);
      const expectedAmount = Math.round(
        amounts.reduce((total, amount) => total + amount, 0) / amounts.length,
      );
      const tolerance = Math.max(500, Math.round(expectedAmount * 0.08));
      const last = rows.at(-1);
      if (!last) continue;
      const confidence = cadence.regular && rows.length >= 4 ? 9700 : 8200;
      const existing = await executor
        .select()
        .from(financeIncomeStreams)
        .where(and(eq(financeIncomeStreams.userId, userId), eq(financeIncomeStreams.payer, payer)))
        .limit(1);
      if (!existing[0] || existing[0].source === "inferred") {
        const values = {
          accountId: last.accountId,
          amountTolerance: tolerance,
          cadence: cadence.cadence as "weekly" | "biweekly" | "monthly",
          confidence,
          displayName: titleCaseMerchant(last.merchant),
          expectedAmount,
          lastObservedDate: last.transactionDate,
          nextExpectedDate: dateAfter(last.transactionDate, cadence.average),
          payer,
          source: "inferred" as const,
          status: confidence >= 9500 ? ("active" as const) : ("needs_review" as const),
        };
        const unchanged =
          existing[0] &&
          Object.entries(values).every(
            ([key, value]) => existing[0]?.[key as keyof typeof values] === value,
          );
        const [saved] = existing[0]
          ? unchanged
            ? [existing[0]]
            : await executor
                .update(financeIncomeStreams)
                .set({ ...values, updatedAt: now() })
                .where(eq(financeIncomeStreams.id, existing[0].id))
                .returning()
          : await executor
              .insert(financeIncomeStreams)
              .values({ ...values, userId })
              .returning();
        if (saved && !unchanged && context?.maintenance) {
          const source = await financeTransactionSource(userId, last, executor);
          await executor.insert(auditEvents).values(
            auditValues({
              action: "finance.income_stream_refreshed",
              after: {
                accountId: saved.accountId,
                cadence: saved.cadence,
                expectedAmount: saved.expectedAmount,
                source: saved.source,
                status: saved.status,
                ...maintenanceAuditAttribution(context, source),
              },
              before: existing[0]
                ? {
                    accountId: existing[0].accountId,
                    cadence: existing[0].cadence,
                    expectedAmount: existing[0].expectedAmount,
                    source: existing[0].source,
                    status: existing[0].status,
                  }
                : null,
              entityId: saved.id,
              entityType: "finance_income_stream",
              ...context,
            }),
          );
        }
      }
      if (
        existing[0]?.status === "active" &&
        Math.abs(last.amount - existing[0].expectedAmount) > existing[0].amountTolerance
      )
        await openAlert(
          {
            body: `${titleCaseMerchant(last.merchant)} was ${formatCurrency(Math.abs(last.amount - existing[0].expectedAmount))} ${last.amount < existing[0].expectedAmount ? "lower" : "higher"} than its expected deposit. Confirm whether your pay changed or this was one-time.`,
            evidence: {
              expectedAmount: existing[0].expectedAmount / 100,
              observedAmount: last.amount / 100,
              observedDate: last.transactionDate,
            },
            incomeStreamId: existing[0].id,
            severity: "warning",
            title: "Expected income changed",
            transactionId: last.id,
            type: "income_changed",
            userId,
          },
          executor,
          context,
          await financeTransactionSource(userId, last, executor),
        );
    }
    for (const [merchant, rows] of expensesByMerchant) {
      const cadence = cadenceFromDates(rows.map((row) => row.transactionDate));
      if (!cadence || cadence.cadence === "irregular") continue;
      const amounts = rows.map((row) => row.amount);
      const expectedAmount = Math.round(
        amounts.reduce((total, amount) => total + amount, 0) / amounts.length,
      );
      const tolerance = Math.max(300, Math.round(expectedAmount * 0.08));
      const last = rows.at(-1);
      if (!last) continue;
      const highConfidence =
        cadence.regular &&
        rows.length >= 4 &&
        Math.max(...amounts) - Math.min(...amounts) <= tolerance * 2;
      const confidence = highConfidence ? 9700 : 8200;
      const existing = await executor
        .select()
        .from(financeRecurringObligations)
        .where(
          and(
            eq(financeRecurringObligations.userId, userId),
            eq(financeRecurringObligations.merchant, merchant),
          ),
        )
        .limit(1);
      const kind = isSubscription(last)
        ? ("subscription" as const)
        : /rent|mortgage|insurance|utility|electric|water|internet|loan/i.test(last.merchant)
          ? ("bill" as const)
          : ("bill" as const);
      if (!existing[0] || existing[0].source === "inferred") {
        const values = {
          accountId: last.accountId,
          amountTolerance: tolerance,
          cadence: cadence.cadence,
          confidence,
          displayName: titleCaseMerchant(last.merchant),
          expectedAmount,
          kind,
          lastObservedDate: last.transactionDate,
          merchant,
          merchantId: last.merchantId,
          nextExpectedDate: dateAfter(last.transactionDate, cadence.average),
          source: "inferred" as const,
          status:
            kind === "subscription" && highConfidence
              ? ("active" as const)
              : ("needs_review" as const),
        };
        const unchanged =
          existing[0] &&
          Object.entries(values).every(
            ([key, value]) => existing[0]?.[key as keyof typeof values] === value,
          );
        const [saved] = existing[0]
          ? unchanged
            ? [existing[0]]
            : await executor
                .update(financeRecurringObligations)
                .set({ ...values, updatedAt: now() })
                .where(eq(financeRecurringObligations.id, existing[0].id))
                .returning()
          : await executor
              .insert(financeRecurringObligations)
              .values({ ...values, userId })
              .returning();
        if (saved && !unchanged && context?.maintenance) {
          const source = await financeTransactionSource(userId, last, executor);
          await executor.insert(auditEvents).values(
            auditValues({
              action: "finance.recurring_refreshed",
              after: {
                accountId: saved.accountId,
                cadence: saved.cadence,
                expectedAmount: saved.expectedAmount,
                source: saved.source,
                status: saved.status,
                ...maintenanceAuditAttribution(context, source),
              },
              before: existing[0]
                ? {
                    accountId: existing[0].accountId,
                    cadence: existing[0].cadence,
                    expectedAmount: existing[0].expectedAmount,
                    source: existing[0].source,
                    status: existing[0].status,
                  }
                : null,
              entityId: saved.id,
              entityType: "finance_recurring_obligation",
              ...context,
            }),
          );
        }
      }
      if (
        existing[0]?.status === "active" &&
        Math.abs(last.amount - existing[0].expectedAmount) > existing[0].amountTolerance
      )
        await openAlert(
          {
            body: `${titleCaseMerchant(last.merchant)} was ${formatCurrency(Math.abs(last.amount - existing[0].expectedAmount))} ${last.amount < existing[0].expectedAmount ? "lower" : "higher"} than its expected recurring charge.`,
            evidence: {
              expectedAmount: existing[0].expectedAmount / 100,
              observedAmount: last.amount / 100,
              observedDate: last.transactionDate,
            },
            recurringObligationId: existing[0].id,
            severity: "info",
            title:
              kind === "subscription" ? "Subscription price changed" : "Recurring payment changed",
            transactionId: last.id,
            type:
              kind === "subscription" ? "subscription_price_changed" : "recurring_amount_changed",
            userId,
          },
          executor,
          context,
          await financeTransactionSource(userId, last, executor),
        );
    }
    // Maintenance refreshes run inside one fenced transaction client. Keep
    // these reads sequential: pg does not support concurrent queries on one
    // client, and pg@9 removes the legacy implicit serialization behavior.
    const streams = await executor
      .select()
      .from(financeIncomeStreams)
      .where(eq(financeIncomeStreams.userId, userId));
    const obligations = await executor
      .select()
      .from(financeRecurringObligations)
      .where(eq(financeRecurringObligations.userId, userId));
    const openAlerts = await executor
      .select({
        id: financeAlerts.id,
        incomeStreamId: financeAlerts.incomeStreamId,
        recurringObligationId: financeAlerts.recurringObligationId,
        type: financeAlerts.type,
      })
      .from(financeAlerts)
      .where(
        and(
          eq(financeAlerts.userId, userId),
          eq(financeAlerts.status, "open"),
          or(eq(financeAlerts.type, "income_missing"), eq(financeAlerts.type, "recurring_missing")),
        ),
      );
    const obsoleteAlerts = obsoleteMissingAlertIds({
      alerts: openAlerts,
      incomeStreams: streams,
      obligations,
      today,
    });
    if (obsoleteAlerts.length) {
      if (context?.maintenance) {
        for (const alertId of obsoleteAlerts) {
          const [beforeAlert] = await executor
            .select()
            .from(financeAlerts)
            .where(eq(financeAlerts.id, alertId))
            .limit(1);
          if (!beforeAlert) continue;
          const stream = streams.find((item) => item.id === beforeAlert.incomeStreamId);
          const obligation = obligations.find(
            (item) => item.id === beforeAlert.recurringObligationId,
          );
          const sourceTransaction = stream
            ? incomeByPayer.get(stream.payer)?.at(-1)
            : obligation
              ? expensesByMerchant.get(obligation.merchant)?.at(-1)
              : undefined;
          const source = sourceTransaction
            ? await financeTransactionSource(userId, sourceTransaction, executor)
            : stream
              ? financeIncomeStreamSourceValue(stream)
              : obligation
                ? financeRecurringObligationSourceValue(obligation)
                : null;
          if (!source) {
            throw new AppError("conflict", "The Finance alert source evidence is unavailable.");
          }
          const [saved] = await executor
            .update(financeAlerts)
            .set({ resolvedAt: now(), status: "resolved", updatedAt: now() })
            .where(and(eq(financeAlerts.id, alertId), eq(financeAlerts.status, "open")))
            .returning();
          if (!saved) continue;
          await executor.insert(auditEvents).values(
            auditValues({
              action: "finance.alert_resolved",
              after: {
                status: saved.status,
                type: saved.type,
                ...maintenanceAuditAttribution(context, source),
              },
              before: { status: beforeAlert.status, type: beforeAlert.type },
              entityId: saved.id,
              entityType: "finance_alert",
              ...context,
            }),
          );
        }
      } else {
        await executor
          .update(financeAlerts)
          .set({ resolvedAt: now(), status: "resolved", updatedAt: now() })
          .where(inArray(financeAlerts.id, obsoleteAlerts));
      }
    }
    for (const stream of streams.filter((row) => row.status === "active" && row.nextExpectedDate)) {
      if ((stream.nextExpectedDate ?? today) < today)
        await openAlert(
          {
            body: `${stream.displayName} has not arrived by its expected window. Confirm whether it is delayed, one-time, or a schedule change.`,
            evidence: {
              expectedAmount: stream.expectedAmount / 100,
              expectedDate: stream.nextExpectedDate,
            },
            incomeStreamId: stream.id,
            severity: "warning",
            title: "Expected income has not arrived",
            type: "income_missing",
            userId,
          },
          executor,
          context,
          incomeByPayer.get(stream.payer)?.at(-1)
            ? await financeTransactionSource(
                userId,
                incomeByPayer.get(stream.payer)?.at(-1) as typeof financeTransactions.$inferSelect,
                executor,
              )
            : financeIncomeStreamSourceValue(stream),
        );
    }
    for (const obligation of obligations.filter(
      (row) => row.status === "active" && row.nextExpectedDate,
    )) {
      if ((obligation.nextExpectedDate ?? today) < today)
        await openAlert(
          {
            body: `${obligation.displayName} has not appeared by its expected window. Check whether it was paid elsewhere, paused, or changed.`,
            evidence: {
              expectedAmount: obligation.expectedAmount / 100,
              expectedDate: obligation.nextExpectedDate,
            },
            recurringObligationId: obligation.id,
            severity: "info",
            title: "Expected recurring payment is missing",
            type: "recurring_missing",
            userId,
          },
          executor,
          context,
          expensesByMerchant.get(obligation.merchant)?.at(-1)
            ? await financeTransactionSource(
                userId,
                expensesByMerchant
                  .get(obligation.merchant)
                  ?.at(-1) as typeof financeTransactions.$inferSelect,
                executor,
              )
            : financeRecurringObligationSourceValue(obligation),
        );
    }
  }
  const providerItemSync = createFinanceProviderItemSyncService({
    assertMaintenanceClaim,
    db,
    ...(encryptionKey ? { encryptionKey } : {}),
    ...(log ? { log } : {}),
    now,
    ...(plaid ? { plaid } : {}),
    async prepareTransaction(remote, userId) {
      const merchant = remote.merchantName ?? remote.name;
      const learned = await learnedCategory(userId, merchant);
      const automatic = learned ? categorization(merchant, learned) : null;
      const providerCategory = remote.personalFinanceCategory;
      const inferred = isRentMerchant(merchant)
        ? categorization(merchant)
        : (automatic ??
          (providerCategory?.primary
            ? {
                category: providerCategory.primary,
                confidence: (() => {
                  const confidence = providerConfidence(providerCategory.confidenceLevel);
                  return confidence === null ? null : Math.round(confidence * 10_000);
                })(),
                needsReview: providerNeedsReview(providerCategory.confidenceLevel),
              }
            : categorization(merchant)));
      const isTransfer =
        !isRentMerchant(merchant) &&
        (isSoFiVaultTransfer(merchant) || isProviderTransfer(inferred.category));
      return {
        category: isTransfer ? transferCategory : inferred.category,
        categoryConfidence: inferred.confidence,
        categorySource: automatic ? "rule" : providerCategory?.primary ? "provider" : null,
        isTransfer,
        merchant,
        needsReview: inferred.needsReview,
        remote,
      };
    },
    async resolveProjectionLookups(executor, userId, prepared) {
      const merchant = await merchantFor(userId, prepared.merchant, "provider", executor);
      const category = prepared.category
        ? await categoryForName(userId, prepared.category, executor)
        : null;
      return { categoryId: category?.id ?? null, merchantId: merchant.id };
    },
    resolveScopeAccountId: maintenanceScopeAccountId,
  });
  return {
    async upsertAttentionItem(
      transactionId: string,
      input: UpsertFinanceAttentionItemInput,
      context: MutationContext,
    ): Promise<AttentionItem> {
      const saved = await db.transaction(async (tx) => {
        const [financeTransaction] = await tx
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.id, transactionId),
              eq(financeTransactions.userId, context.principal.userId),
            ),
          )
          .for("update")
          .limit(1);
        if (!financeTransaction) {
          throw new AppError("not_found", "The transaction was not found.");
        }
        const source = await financeTransactionSource(
          context.principal.userId,
          financeTransaction,
          tx,
        );
        const [existing] = await tx
          .select()
          .from(attentionItems)
          .where(
            and(
              eq(attentionItems.userId, context.principal.userId),
              eq(attentionItems.domain, "finances"),
              eq(attentionItems.relatedEntityId, financeTransaction.id),
              eq(attentionItems.relatedEntityType, "finance_transaction"),
              eq(attentionItems.kind, input.kind),
              eq(attentionItems.status, "open"),
            ),
          )
          .for("update")
          .limit(1);
        const values = {
          domain: "finances" as const,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          importance: input.importance,
          kind: input.kind,
          occursAt: input.occursAt ? new Date(input.occursAt) : null,
          relatedEntityId: financeTransaction.id,
          relatedEntityType: "finance_transaction",
          source,
          status: "open" as const,
          summary: input.summary,
          title: input.title,
          userId: context.principal.userId,
        };
        const [item] = existing
          ? await tx
              .update(attentionItems)
              .set({ ...values, updatedAt: now(), version: existing.version + 1 })
              .where(
                and(
                  eq(attentionItems.id, existing.id),
                  eq(attentionItems.version, existing.version),
                ),
              )
              .returning()
          : await tx.insert(attentionItems).values(values).returning();
        if (!item) {
          throw new AppError(
            "conflict",
            "The Finance attention item changed while it was being saved.",
          );
        }
        await tx.insert(auditEvents).values(
          auditValues({
            action: existing ? "assistant.attention.updated" : "assistant.attention.created",
            after: {
              ...auditAttentionItemMetadata(item),
              policy: "approved_rule",
              source,
            },
            before: auditAttentionItemMetadata(existing ?? null),
            entityId: item.id,
            entityType: "attention_item",
            ...context,
          }),
        );
        return item;
      });
      return serializeAttentionItem(saved);
    },

    plaidAvailable() {
      return Boolean(plaid);
    },
    async validateProfileSources(
      transaction: FinanceProfileSourceExecutor,
      userId: string,
      sourceIds: string[],
      status: "active" | "draft",
      actorType: Principal["actorType"],
    ) {
      if (status === "active" && actorType !== "user") {
        throw new AppError(
          "forbidden",
          "Activating a Finance profile requires an interactive user session.",
        );
      }
      const uniqueSourceIds = [...new Set(sourceIds)];
      if (uniqueSourceIds.length !== sourceIds.length) {
        throw new AppError(
          "invalid_request",
          "Include each Finance account once in source contexts.",
        );
      }
      if (sourceIds.some((sourceId) => !idSchema.safeParse(sourceId).success)) {
        throw new AppError(
          "invalid_request",
          "Finance source contexts must use canonical Finance account IDs.",
        );
      }
      if (status === "active" && sourceIds.length === 0) {
        throw new AppError(
          "invalid_request",
          "Active Finance setup requires at least one owned account source.",
        );
      }
      if (sourceIds.length === 0) return;
      const ownedSources = await transaction
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(
          and(eq(financeAccounts.userId, userId), inArray(financeAccounts.id, uniqueSourceIds)),
        )
        .orderBy(financeAccounts.id)
        .for("update");
      if (ownedSources.length !== uniqueSourceIds.length) {
        throw new AppError(
          "invalid_request",
          "Finance source contexts must reference current accounts owned by this user.",
        );
      }
    },
    async getGuidedSetupContext(userId: string): Promise<FinanceGuidedSetupContext> {
      const snapshotTime = now();
      const [user] = await db
        .select({ planningTimezone: users.planningTimezone })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) throw new AppError("not_found", "The user was not found.");
      const localDate = localDateAt(snapshotTime, user.planningTimezone);
      const month = `${localDate.year}-${String(localDate.month).padStart(2, "0")}`;
      const [
        accountRows,
        profile,
        incomeStreams,
        recurring,
        alerts,
        ledgerHealth,
        budgets,
        reviews,
        [guidance],
      ] = await Promise.all([
        db
          .select()
          .from(financeAccounts)
          .where(eq(financeAccounts.userId, userId))
          .orderBy(financeAccounts.institution, financeAccounts.name),
        this.getProfile(userId),
        this.listIncomeStreams(userId),
        this.listRecurringObligations(userId),
        this.listAlerts(userId),
        this.getLedgerHealth(userId),
        this.getBudgetStatus(userId, month),
        db
          .select({ reason: financeReviewCases.reason })
          .from(financeReviewCases)
          .where(
            and(
              eq(financeReviewCases.userId, userId),
              inArray(financeReviewCases.status, ["deferred", "open"]),
            ),
          ),
        db
          .select({
            approvedGuidance: domainProfileApprovals,
            guidanceProfile: domainProfiles,
          })
          .from(domainProfiles)
          .leftJoin(
            domainProfileApprovals,
            and(
              eq(domainProfileApprovals.profileId, domainProfiles.id),
              eq(domainProfileApprovals.userId, domainProfiles.userId),
              eq(domainProfileApprovals.domain, domainProfiles.domain),
              eq(domainProfileApprovals.approvedByUserId, userId),
            ),
          )
          .where(and(eq(domainProfiles.userId, userId), eq(domainProfiles.domain, "finances")))
          .limit(1),
      ]);
      const guidanceProfile = guidance?.guidanceProfile;
      const approvedGuidance = guidance?.approvedGuidance;
      const approvedProfile = approvedProfileFrom(approvedGuidance);
      const reviewReasons: FinanceGuidedSetupContext["reviewSummary"]["reasons"] = {
        ambiguous_merchant: 0,
        low_confidence: 0,
        one_time: 0,
        possible_duplicate: 0,
        possible_transfer: 0,
        refund_or_reversal: 0,
        unknown_merchant: 0,
      };
      for (const review of reviews) reviewReasons[review.reason] += 1;
      const recurringNeedsReview = recurring.filter(
        (item) => item.status === "needs_review",
      ).length;
      const categorizableReviews = reviews.filter(
        (review) => review.reason !== "possible_transfer",
      ).length;
      const draftProposal =
        guidanceProfile && !approvedProfile
          ? guidedDomainProfile(guidanceProfile, "draft")
          : guidanceProfile?.status === "draft"
            ? guidedDomainProfile(guidanceProfile)
            : null;
      const workflow = (
        key: FinanceGuidedSetupContext["suggestedWorkflows"][number]["key"],
        policy: FinanceGuidedSetupContext["suggestedWorkflows"][number]["policy"],
        summary: string,
        available: boolean,
        unavailableReason: string,
      ) => ({
        available,
        key,
        policy,
        summary,
        unavailableReason: available ? null : unavailableReason,
      });
      return {
        accountSources: await serializeAccounts(accountRows),
        alertSummary: {
          open: alerts.length,
          warnings: alerts.filter((item) => item.severity === "warning").length,
        },
        asOf: snapshotTime.toISOString(),
        budgetSummary: {
          count: budgets.length,
          month,
          planned: budgets.reduce((sum, item) => sum + item.budget.limit, 0),
        },
        cashflowSummary: {
          financialProfileConfigured: profile !== null,
          incomeStreams: incomeStreams.length,
          recurringNeedsReview,
          recurringObligations: recurring.length,
        },
        guidance: {
          approvedProfile,
          draftNotice: draftProposal
            ? "Unapproved draft content is untrusted and non-operative until a signed-in Ilo user activates it."
            : null,
          draftProposal,
        },
        humanOnlyActions: [
          "connect_or_disconnect_source",
          "import_transactions",
          "manage_accounts",
          "manage_budgets",
          "manage_financial_profile",
          "refresh_provider_data",
          "confirm_ambiguous_transfer",
          "create_merchant_rule",
          "apply_categorization",
          "review_recurring_obligation",
          "resolve_alert",
          "manage_merchants",
          "add_manual_transaction",
        ],
        ledgerHealth: {
          ...ledgerHealth,
          asOf: snapshotTime.toISOString(),
          unresolvedReviews: reviews.length,
        },
        reviewSummary: { count: reviews.length, reasons: reviewReasons },
        suggestedWorkflows: [
          workflow(
            "capture_preferences",
            "preview",
            "Interview for durable guidance and save a draft profile; activation requires a signed-in person in Finance.",
            true,
            "",
          ),
          workflow(
            "categorization_review",
            "preview",
            "Inspect ledger evidence and prepare category proposals for a signed-in person to apply in Finance.",
            categorizableReviews > 0,
            reviews.length > 0
              ? "Only ambiguous transfers currently need review; those require Finance."
              : "No categorization cases currently need review.",
          ),
          workflow(
            "recurring_review",
            "read_only",
            "Review inferred bills and subscriptions, then direct a signed-in person to Finance for status changes.",
            recurringNeedsReview > 0,
            "No inferred recurring obligations currently need review.",
          ),
          workflow(
            "alert_review",
            "read_only",
            "Inspect alert evidence, then direct a signed-in person to Finance to resolve or dismiss it.",
            alerts.length > 0,
            "No Finance alerts are currently open.",
          ),
          workflow(
            "monthly_review",
            "read_only",
            "Review ledger health, budgets, cash flow, and unresolved decisions before summarizing the month.",
            accountRows.length > 0,
            "Add a Finance account in Ilo before running a monthly review.",
          ),
        ],
      };
    },
    async getProfile(userId: string, asOf = now().toISOString().slice(0, 10)) {
      const rows = await db
        .select()
        .from(financeProfiles)
        .where(eq(financeProfiles.userId, userId));
      const row = selectEffectiveRecord(rows, asOf);
      return row ? profileValue(row) : null;
    },
    async updateProfile(input: UpdateFinanceProfileInput, context: MutationContext) {
      if (input.payAccountId) await ownedAccount(context.principal.userId, input.payAccountId);
      const before = await this.getProfile(context.principal.userId);
      const [row] = await db
        .insert(financeProfiles)
        .values({
          effectiveDate: input.effectiveDate,
          employer: input.employer,
          employmentType: input.employmentType,
          expectedNetPay:
            input.expectedNetPay === null ? null : Math.round(input.expectedNetPay * 100),
          grossAnnualIncome:
            input.grossAnnualIncome === null ? null : Math.round(input.grossAnnualIncome * 100),
          nextPayday: input.nextPayday,
          payAccountId: input.payAccountId,
          payFrequency: input.payFrequency,
          role: input.role,
          userId: context.principal.userId,
        })
        .onConflictDoUpdate({
          set: {
            employer: input.employer,
            employmentType: input.employmentType,
            expectedNetPay:
              input.expectedNetPay === null ? null : Math.round(input.expectedNetPay * 100),
            grossAnnualIncome:
              input.grossAnnualIncome === null ? null : Math.round(input.grossAnnualIncome * 100),
            nextPayday: input.nextPayday,
            payAccountId: input.payAccountId,
            payFrequency: input.payFrequency,
            role: input.role,
            updatedAt: now(),
          },
          target: [financeProfiles.userId, financeProfiles.effectiveDate],
        })
        .returning();
      const saved = requireDatabaseRecord(row, "The financial profile could not be saved.");
      const value = profileValue(saved);
      await db.insert(auditEvents).values(
        auditValues({
          action: "finance.profile_updated",
          after: {
            changedFields: Object.keys(input).sort(),
            updatedAt: value.updatedAt,
          },
          before: before ? { updatedAt: before.updatedAt } : null,
          entityId: saved.id,
          entityType: "finance_profile",
          ...context,
        }),
      );
      return value;
    },
    async listIncomeStreams(userId: string) {
      return (
        await db
          .select()
          .from(financeIncomeStreams)
          .where(eq(financeIncomeStreams.userId, userId))
          .orderBy(desc(financeIncomeStreams.confidence), financeIncomeStreams.displayName)
      ).map(incomeStreamValue);
    },
    async updateIncomeStream(
      id: string,
      input: UpdateFinanceIncomeStreamInput,
      context: MutationContext,
    ) {
      const [before] = await db
        .select()
        .from(financeIncomeStreams)
        .where(
          and(
            eq(financeIncomeStreams.id, id),
            eq(financeIncomeStreams.userId, context.principal.userId),
          ),
        )
        .limit(1);
      if (!before) throw new AppError("not_found", "The income stream was not found.");
      const [row] = await db
        .update(financeIncomeStreams)
        .set({ source: "user", status: input.status, updatedAt: now() })
        .where(eq(financeIncomeStreams.id, id))
        .returning();
      const value = incomeStreamValue(
        requireDatabaseRecord(row, "The income stream could not be updated."),
      );
      await db.insert(auditEvents).values(
        auditValues({
          action: "finance.income_stream_updated",
          after: { id: value.id, source: value.source, status: value.status },
          before: {
            id: before.id,
            source: before.source,
            status: before.status,
          },
          entityId: id,
          entityType: "finance_income_stream",
          ...context,
        }),
      );
      return value;
    },
    async listRecurringObligations(userId: string) {
      return (
        await db
          .select()
          .from(financeRecurringObligations)
          .where(eq(financeRecurringObligations.userId, userId))
          .orderBy(
            desc(financeRecurringObligations.confidence),
            financeRecurringObligations.displayName,
          )
      ).map(recurringValue);
    },
    async updateRecurringObligation(
      id: string,
      input: UpdateFinanceRecurringObligationInput,
      context: MutationContext,
    ) {
      const [before] = await db
        .select()
        .from(financeRecurringObligations)
        .where(
          and(
            eq(financeRecurringObligations.id, id),
            eq(financeRecurringObligations.userId, context.principal.userId),
          ),
        )
        .limit(1);
      if (!before) throw new AppError("not_found", "The recurring payment was not found.");
      if (before.status === input.status) return recurringValue(before);
      const [row] = await db
        .update(financeRecurringObligations)
        .set({
          source: context.principal.actorType === "user" ? "user" : before.source,
          status: input.status,
          updatedAt: now(),
        })
        .where(eq(financeRecurringObligations.id, id))
        .returning();
      const value = recurringValue(
        requireDatabaseRecord(row, "The recurring payment could not be updated."),
      );
      await db.insert(auditEvents).values(
        auditValues({
          action: "finance.recurring_updated",
          after: { id: value.id, source: value.source, status: value.status },
          before: {
            id: before.id,
            source: before.source,
            status: before.status,
          },
          entityId: id,
          entityType: "finance_recurring_obligation",
          ...context,
        }),
      );
      return value;
    },
    async listAlerts(userId: string) {
      return (
        await db
          .select()
          .from(financeAlerts)
          .where(and(eq(financeAlerts.userId, userId), eq(financeAlerts.status, "open")))
          .orderBy(desc(financeAlerts.createdAt))
      ).map(alertValue);
    },
    async resolveAlert(id: string, input: ResolveFinanceAlertInput, context: MutationContext) {
      const [before] = await db
        .select()
        .from(financeAlerts)
        .where(and(eq(financeAlerts.id, id), eq(financeAlerts.userId, context.principal.userId)))
        .limit(1);
      if (!before) throw new AppError("not_found", "The financial alert was not found.");
      const [row] = await db
        .update(financeAlerts)
        .set({
          status: input.action === "dismiss" ? "dismissed" : "resolved",
          resolvedAt: now(),
          updatedAt: now(),
        })
        .where(eq(financeAlerts.id, id))
        .returning();
      const value = alertValue(
        requireDatabaseRecord(row, "The financial alert could not be resolved."),
      );
      await db.insert(auditEvents).values(
        auditValues({
          action: "finance.alert_resolved",
          after: {
            id: value.id,
            severity: value.severity,
            status: value.status,
            type: value.type,
          },
          before: {
            id: before.id,
            severity: before.severity,
            status: before.status,
            type: before.type,
          },
          entityId: id,
          entityType: "finance_alert",
          ...context,
        }),
      );
      return value;
    },
    async getForecast(userId: string): Promise<FinanceForecast> {
      const asOf = now();
      const [profile, accounts, streams, obligations] = await Promise.all([
        this.getProfile(userId, asOf.toISOString().slice(0, 10)),
        db.select().from(financeAccounts).where(eq(financeAccounts.userId, userId)),
        db
          .select()
          .from(financeIncomeStreams)
          .where(
            and(eq(financeIncomeStreams.userId, userId), eq(financeIncomeStreams.status, "active")),
          ),
        db
          .select()
          .from(financeRecurringObligations)
          .where(
            and(
              eq(financeRecurringObligations.userId, userId),
              eq(financeRecurringObligations.status, "active"),
            ),
          ),
      ]);
      const cash = accounts
        .filter((account) => account.kind === "cash")
        .reduce((total, account) => total + (account.balance ?? 0), 0);
      const horizon =
        profile?.nextPayday ??
        streams
          .map((stream) => stream.nextExpectedDate)
          .filter((date): date is string => Boolean(date))
          .sort()[0] ??
        null;
      const forecast = forecastCashflow({
        asOf: asOf.toISOString(),
        cash,
        horizon,
        income: streams.map((stream) => ({
          amount: stream.expectedAmount,
          date: stream.nextExpectedDate,
          kind: "income" as const,
        })),
        obligations: obligations.map((obligation) => ({
          amount: obligation.expectedAmount,
          date: obligation.nextExpectedDate,
          kind: "obligation" as const,
        })),
      });
      return {
        asOf: asOf.toISOString(),
        lowestProjectedBalance: forecast.lowestBalance / 100,
        lowestProjectedDate: forecast.lowestDate,
        projectedBalanceAtNextPayday:
          forecast.projectedBalance === null ? null : forecast.projectedBalance / 100,
        safeToSpend: Math.max(0, forecast.lowestBalance) / 100,
        upcomingIncome: forecast.upcomingIncome / 100,
        upcomingObligations: forecast.upcomingObligations / 100,
      };
    },
    async refreshCashflowInsights(userId: string) {
      await refreshCashflowIntelligence(userId);
      return { refreshed: true };
    },
    async backfillCashflowInsights() {
      const rows = await db
        .select({ userId: financeTransactions.userId })
        .from(financeTransactions);
      const userIds = [...new Set(rows.map((row) => row.userId))];
      for (const userId of userIds) await refreshCashflowIntelligence(userId);
      return { processed: userIds.length };
    },
    async createPlaidLinkToken(userId: string) {
      return getPlaid().createLinkToken({
        clientName: "ilo",
        countryCodes: ["US"],
        language: "en",
        linkCustomizationName: "default",
        products: ["transactions"],
        transactions: { daysRequested: 730 },
        userId,
      });
    },
    async exchangePlaidToken(
      input: ExchangePlaidTokenInput,
      context: MutationContext,
    ): Promise<FinanceAccount[]> {
      const plaid = getPlaid();
      const { accessToken, itemId } = await plaid.exchangePublicToken(input.publicToken);
      const accounts = await plaid.getAccounts(accessToken);
      return providerItems.upsertConnection({
        accessToken,
        accounts,
        context,
        institution: input.institution ?? "Plaid",
        itemId,
        prepareTransaction: async (transaction) => {
          await ensureCategories(context.principal.userId, transaction);
        },
      });
    },
    async syncPlaidAccount(
      id: string,
      context: MutationContext,
      onProgress?: FinanceSyncProgress,
      scope: MaintenanceScope = { type: "all_outstanding" },
    ) {
      const synchronized = await providerItemSync.syncAccount(id, context, onProgress, scope);
      if (!context.maintenance) {
        await reconcileBudgetTransfers(context.principal.userId, scope, context, onProgress);
        await refreshCashflowIntelligence(context.principal.userId);
      }
      return synchronized;
    },
    async initializeSyncHealth(
      limit = financeSyncBatchLimit,
    ): Promise<FinanceSyncHealthInitializationResult> {
      const startedAt = Date.now();
      const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : financeSyncBatchLimit;
      const scanLimit = Math.max(1, Math.min(financeSyncBatchLimit, requestedLimit));
      const uninitializedSyncHealth = and(
        eq(financeAccounts.provider, "manual"),
        eq(financeAccounts.syncState, "stale"),
        isNull(financeAccounts.nextSyncAt),
      );
      const initialized = await db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: financeAccounts.id,
            provider: financeAccounts.provider,
          })
          .from(financeAccounts)
          .where(uninitializedSyncHealth)
          .orderBy(financeAccounts.id)
          .limit(scanLimit)
          .for("update", { skipLocked: true });
        const result = { manual: 0, plaidCurrent: 0, plaidDue: 0 };
        for (const row of rows) {
          await tx
            .update(financeAccounts)
            .set({ syncState: "current", updatedAt: sql`NOW()` })
            .where(eq(financeAccounts.id, row.id));
          result.manual += 1;
        }
        return { ...result, initialized: rows.length };
      });
      const [remaining] = await db
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(uninitializedSyncHealth)
        .limit(1);
      const result = {
        complete: remaining === undefined,
        ...initialized,
      };
      log?.({
        durationMs: Date.now() - startedAt,
        event: "finance_sync_health_initialized",
        initializationComplete: result.complete,
        initializedAccountCount: result.initialized,
        initializedManualAccountCount: result.manual,
        initializedPlaidCurrentAccountCount: result.plaidCurrent,
        initializedPlaidDueAccountCount: result.plaidDue,
        method: "SCHEDULER",
        path: "/internal/finances/sync-health/initialize",
        requestId: randomUUID(),
        status: 200,
      });
      return result;
    },
    async syncDueAccountsForUser(
      userId: string,
      scope: MaintenanceScope,
      context?: MutationContext,
      onProgress?: FinanceSyncProgress,
    ): Promise<FinanceSyncBatchResult> {
      await onProgress?.();
      await assertMaintenanceScopeOwned(userId, scope);
      const targetAccountId = await maintenanceScopeAccountId(userId, scope);
      if (scope.type !== "window") {
        const initializationAt = now();
        await db.transaction(async (tx) => {
          await assertMaintenanceClaim(tx, context);
          const rows = await tx
            .select()
            .from(financeAccounts)
            .where(
              and(
                eq(financeAccounts.userId, userId),
                targetAccountId ? eq(financeAccounts.id, targetAccountId) : undefined,
                eq(financeAccounts.provider, "manual"),
                eq(financeAccounts.syncState, "stale"),
                isNull(financeAccounts.nextSyncAt),
              ),
            )
            .orderBy(financeAccounts.id)
            .limit(financeSyncBatchLimit)
            .for("update", { skipLocked: true });
          for (const row of rows) {
            if (!context?.maintenance) {
              throw new AppError(
                "invalid_request",
                "Finance maintenance attribution is required to initialize synchronization health.",
              );
            }
            const [updated] = await tx
              .update(financeAccounts)
              .set({ syncState: "current", updatedAt: initializationAt })
              .where(eq(financeAccounts.id, row.id))
              .returning();
            if (!updated) continue;
            await tx.insert(auditEvents).values(
              auditValues({
                action: "finance.sync_health_initialized",
                after: {
                  nextSyncAt: null,
                  syncState: updated.syncState,
                  ...maintenanceAuditAttribution(context, financeAccountSourceValue(row)),
                },
                before: {
                  nextSyncAt: null,
                  syncState: row.syncState,
                  updatedAt: row.updatedAt.toISOString(),
                },
                entityId: row.id,
                entityType: "finance_account",
                ...context,
              }),
            );
          }
        });
      }
      await onProgress?.();
      return providerItemSync.syncDueItemsForUser(userId, scope, context, onProgress);
    },
    async syncDuePlaidAccounts(): Promise<FinanceSyncBatchResult> {
      await this.initializeSyncHealth();
      return providerItemSync.syncDueItems();
    },
    async reconcileTransfers(userId: string) {
      return reconcileBudgetTransfers(userId);
    },
    async reconcileTransfersForUser(
      userId: string,
      scope: MaintenanceScope,
      context?: MutationContext,
      onProgress?: FinanceSyncProgress,
    ) {
      return reconcileBudgetTransfers(userId, scope, context, onProgress);
    },
    async repairHeuristicTransfersForUser(
      userId: string,
      scope: MaintenanceScope,
      cursor: string | undefined,
      context: MutationContext,
      onProgress?: FinanceSyncProgress,
    ) {
      return repairHeuristicTransfers(userId, scope, cursor, context, onProgress);
    },
    async refreshCashflowForUser(
      userId: string,
      scope: MaintenanceScope,
      context?: MutationContext,
      onProgress?: FinanceSyncProgress,
    ) {
      await onProgress?.();
      await assertMaintenanceScopeOwned(userId, scope);
      if (scope.type !== "all_outstanding") return { refreshed: false };
      if (context?.maintenanceClaim) {
        await db.transaction(async (tx) => {
          await assertMaintenanceClaim(tx, context);
          await refreshCashflowIntelligence(userId, tx, context);
        });
      } else {
        await refreshCashflowIntelligence(userId);
      }
      return { refreshed: true };
    },
    async summarizeMaintenanceEffectsForRun(userId: string, runId: string) {
      const rows = await db
        .select({
          action: auditEvents.action,
          before: auditEvents.before,
          entityId: auditEvents.entityId,
          requestId: auditEvents.requestId,
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.userId, userId),
            like(auditEvents.requestId, `maintenance:${runId}:%`),
          ),
        );
      const distinct = new Set(rows.map((row) => `${row.action}:${row.entityId}`));
      const distinctRows = rows.filter(
        (row, index) =>
          rows.findIndex(
            (candidate) => candidate.action === row.action && candidate.entityId === row.entityId,
          ) === index,
      );
      return {
        categorizations: distinctRows.filter((row) =>
          ["finance.rent_rule_applied", "finance.transaction_categorized"].includes(row.action),
        ).length,
        duplicateActions: rows.length - distinct.size,
        heuristicTransfersRepaired: distinctRows.filter(
          (row) => row.action === "finance.transfer_heuristic_repaired",
        ).length,
        questionStepCreations: new Set(
          rows
            .filter(
              (row) =>
                row.action === "finance.review_queued" &&
                row.before === null &&
                row.requestId === `maintenance:${runId}:questions`,
            )
            .map((row) => row.entityId),
        ).size,
        questions: distinctRows.filter(
          (row) => row.action === "finance.review_queued" && row.before === null,
        ).length,
        transfers: distinctRows.filter((row) => row.action === "finance.transfer_reconciled")
          .length,
      };
    },
    async backfillLedgerIntegrity() {
      const accounts = await db.select({ userId: financeAccounts.userId }).from(financeAccounts);
      const userIds = [...new Set(accounts.map((account) => account.userId))];
      let paired = 0;
      let confirmedMovements = 0;
      for (const userId of userIds) {
        const result = await reconcileBudgetTransfers(userId);
        paired += result.paired;
        confirmedMovements += result.transfers;
      }
      return { confirmedMovements, paired, processed: userIds.length };
    },
    async backfillSetupIntegrity(limit = 100) {
      const stateKey = "finance_setup_integrity_v1";
      const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 100;
      const scanLimit = Math.max(1, Math.min(100, requestedLimit));
      const [existingState] = await db
        .select({ key: financeSetupBackfillState.key })
        .from(financeSetupBackfillState)
        .where(eq(financeSetupBackfillState.key, stateKey))
        .limit(1);
      if (!existingState) {
        await db
          .insert(financeSetupBackfillState)
          .values({ key: stateKey })
          .onConflictDoNothing({ target: financeSetupBackfillState.key });
      }
      return db.transaction(async (tx) => {
        const [state] = await tx
          .select()
          .from(financeSetupBackfillState)
          .where(eq(financeSetupBackfillState.key, stateKey))
          .for("update", { skipLocked: true })
          .limit(1);
        if (!state) {
          return {
            categoriesComplete: false,
            categoriesInserted: 0,
            claimed: false,
            processed: 0,
            profileRowsScanned: 0,
            profilesComplete: false,
            profilesDemoted: 0,
            userRowsScanned: 0,
          };
        }
        if (state.profilesComplete && state.categoriesComplete) {
          return {
            categoriesComplete: true,
            categoriesInserted: 0,
            claimed: true,
            processed: 0,
            profileRowsScanned: 0,
            profilesComplete: true,
            profilesDemoted: 0,
            userRowsScanned: 0,
          };
        }
        const profileRows = state.profilesComplete
          ? []
          : await tx
              .select()
              .from(domainProfiles)
              .where(state.profileCursor ? gt(domainProfiles.id, state.profileCursor) : undefined)
              .orderBy(domainProfiles.id)
              .limit(scanLimit);
        // The claimed checkpoint serializes repair workers. Profile rows stay
        // unlocked so unrelated domains can save normally; the version guard
        // below prevents a concurrent profile save from being overwritten.
        let profilesDemoted = 0;
        for (const profile of profileRows) {
          if (profile.domain !== "finances" || profile.status !== "active") continue;
          const [approval] = await tx
            .select({ id: domainProfileApprovals.id })
            .from(domainProfileApprovals)
            .where(
              and(
                eq(domainProfileApprovals.profileId, profile.id),
                eq(domainProfileApprovals.userId, profile.userId),
                eq(domainProfileApprovals.domain, "finances"),
                eq(domainProfileApprovals.profileVersion, profile.version),
              ),
            )
            .limit(1);
          if (approval) continue;
          const [demoted] = await tx
            .update(domainProfiles)
            .set({ status: "draft", updatedAt: now(), version: profile.version + 1 })
            .where(
              and(eq(domainProfiles.id, profile.id), eq(domainProfiles.version, profile.version)),
            )
            .returning({ version: domainProfiles.version });
          if (!demoted) continue;
          await tx.insert(auditEvents).values(
            auditValues({
              action: "assistant.profile.demoted_unapproved",
              after: { domain: "finances", profileVersion: demoted.version },
              before: { domain: "finances", profileVersion: profile.version },
              entityId: profile.id,
              entityType: "domain_profile",
              principal: {
                actorId: profile.userId,
                actorType: "system",
                userId: profile.userId,
              },
              requestId: "finance-setup-integrity-backfill",
            }),
          );
          profilesDemoted += 1;
        }
        const userRows = state.categoriesComplete
          ? []
          : await tx
              .select({ id: users.id })
              .from(users)
              .where(state.userCursor ? gt(users.id, state.userCursor) : undefined)
              .orderBy(users.id)
              .limit(scanLimit);
        let categoriesInserted = 0;
        for (const user of userRows) {
          const [account] = await tx
            .select({ id: financeAccounts.id })
            .from(financeAccounts)
            .where(eq(financeAccounts.userId, user.id))
            .limit(1);
          if (!account) continue;
          categoriesInserted += (await seedCategories(user.id, tx)).inserted;
        }
        const profilesComplete = state.profilesComplete || profileRows.length < scanLimit;
        const categoriesComplete = state.categoriesComplete || userRows.length < scanLimit;
        await tx
          .update(financeSetupBackfillState)
          .set({
            categoriesComplete,
            profileCursor: profileRows.at(-1)?.id ?? state.profileCursor,
            profilesComplete,
            updatedAt: now(),
            userCursor: userRows.at(-1)?.id ?? state.userCursor,
          })
          .where(eq(financeSetupBackfillState.key, stateKey));
        return {
          categoriesComplete,
          categoriesInserted,
          claimed: true,
          processed: profileRows.length + userRows.length,
          profileRowsScanned: profileRows.length,
          profilesComplete,
          profilesDemoted,
          userRowsScanned: userRows.length,
        };
      });
    },
    async listCategories(userId: string) {
      const existing = await existingCategories(userId);
      const bySlug = new Map(existing.map((item) => [item.slug, item]));
      const defaults = defaultCategories.map(([name, slug]) => {
        const persisted = bySlug.get(slug);
        return persisted
          ? categoryValue(persisted)
          : {
              color: null,
              group: categoryGroup(name),
              id: defaultCategoryId(userId, slug),
              isSystem: true,
              name,
              slug,
            };
      });
      const defaultSlugs = new Set<string>(defaultCategories.map(([, slug]) => slug));
      return [
        ...defaults,
        ...existing.filter((item) => !defaultSlugs.has(item.slug)).map(categoryValue),
      ].sort(
        (left, right) =>
          left.group.localeCompare(right.group) || left.name.localeCompare(right.name),
      );
    },
    async listMerchants(userId: string, limit = 50) {
      const merchants = await db
        .select()
        .from(financeMerchants)
        .where(eq(financeMerchants.userId, userId))
        .orderBy(desc(financeMerchants.updatedAt), financeMerchants.displayName)
        .limit(limit);
      if (merchants.length === 0) return [];
      const aliases = await db
        .select()
        .from(financeMerchantAliases)
        .where(
          inArray(
            financeMerchantAliases.merchantId,
            merchants.map((item) => item.id),
          ),
        )
        .orderBy(financeMerchantAliases.rawName);
      return merchants.map((item) =>
        merchant(
          item,
          aliases.filter((alias) => alias.merchantId === item.id).map((alias) => alias.rawName),
        ),
      );
    },
    async updateMerchant(id: string, input: UpdateFinanceMerchantInput, context: MutationContext) {
      const before = await ownedMerchant(context.principal.userId, id);
      const updated = requireDatabaseRecord(
        (
          await db
            .update(financeMerchants)
            .set({
              displayName: input.displayName,
              isUserConfirmed:
                context.principal.actorType === "user" ? true : before.isUserConfirmed,
              updatedAt: now(),
            })
            .where(eq(financeMerchants.id, before.id))
            .returning()
        )[0],
        "The finance merchant could not be updated.",
      );
      await db.insert(auditEvents).values(
        auditValues({
          action: "finance.merchant_renamed",
          after: {
            ...merchantAuditSnapshot(merchant(updated)),
            changedFields: ["displayName"],
          },
          before: merchantAuditSnapshot(merchant(before)),
          entityId: updated.id,
          entityType: "finance_merchant",
          ...context,
        }),
      );
      return merchant(updated);
    },
    async mergeMerchants(input: MergeFinanceMerchantsInput, context: MutationContext) {
      return db.transaction(async (tx) => {
        const locked = await tx
          .select()
          .from(financeMerchants)
          .where(
            and(
              eq(financeMerchants.userId, context.principal.userId),
              inArray(financeMerchants.id, [input.sourceMerchantId, input.targetMerchantId]),
            ),
          )
          .orderBy(financeMerchants.id)
          .for("update");
        const source = locked.find((item) => item.id === input.sourceMerchantId);
        const target = locked.find((item) => item.id === input.targetMerchantId);
        if (!source || !target) {
          throw new AppError("not_found", "One of the finance merchants was not found.");
        }
        await tx
          .update(financeMerchantAliases)
          .set({ merchantId: target.id, updatedAt: now() })
          .where(eq(financeMerchantAliases.merchantId, source.id));
        await tx
          .update(financeTransactions)
          .set({ merchantId: target.id, updatedAt: now() })
          .where(eq(financeTransactions.merchantId, source.id));
        await tx
          .update(financeClassificationDecisions)
          .set({ merchantId: target.id })
          .where(eq(financeClassificationDecisions.merchantId, source.id));
        await tx.delete(financeMerchants).where(eq(financeMerchants.id, source.id));
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.merchants_merged",
            after: {
              rationaleProvided: true,
              sourceMerchantId: source.id,
              targetMerchantId: target.id,
            },
            before: merchantAuditSnapshot(merchant(source)),
            entityId: target.id,
            entityType: "finance_merchant",
            ...context,
          }),
        );
        return merchant(target);
      });
    },
    async getBudgetStatus(userId: string, month = now().toISOString().slice(0, 7)) {
      const [budgets, transactions] = await Promise.all([
        db
          .select()
          .from(financeBudgets)
          .where(and(eq(financeBudgets.userId, userId), eq(financeBudgets.month, month)))
          .orderBy(financeBudgets.category),
        db
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              gte(financeTransactions.transactionDate, `${month}-01`),
              lt(financeTransactions.transactionDate, `${nextMonth(month)}-01`),
            ),
          ),
      ]);
      return budgets.map((item) => {
        const spent = transactions
          .filter((transaction) => transaction.category === item.category)
          .reduce((sum, transaction) => sum + budgetImpact(transaction), 0);
        return {
          budget: budget(item),
          remaining: (item.limit - spent) / 100,
          spent: spent / 100,
        };
      });
    },
    async listTransactions(userId: string, query: TransactionListQuery) {
      return listTransactionsPage(userId, query);
    },
    async listReviewQueue(userId: string, limit = 50): Promise<FinanceReviewCase[]> {
      const categories = new Map((await existingCategories(userId)).map((item) => [item.id, item]));
      const reviews = await db
        .select()
        .from(financeReviewCases)
        .where(
          and(
            eq(financeReviewCases.userId, userId),
            inArray(financeReviewCases.status, ["deferred", "open"]),
          ),
        )
        .orderBy(desc(financeReviewCases.updatedAt))
        .limit(limit);
      return Promise.all(
        reviews.map(async (review) => {
          const current = await ownedTransaction(userId, review.transactionId);
          const suggestedCategory = review.suggestedCategoryId
            ? categories.get(review.suggestedCategoryId)
            : undefined;
          return {
            createdAt: review.createdAt.toISOString(),
            id: review.id,
            rationale: review.rationale,
            reason: review.reason,
            status: review.status,
            suggestedCategory: suggestedCategory ? categoryValue(suggestedCategory) : null,
            transaction: await enrichTransaction(current),
          };
        }),
      );
    },
    async proposeCategorizations(
      userId: string,
      query: TransactionListQuery,
    ): Promise<FinanceCategorizationProposalPage> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
        const transactions = await listTransactionsPage(
          userId,
          { ...query, review: "needs_review" },
          tx,
        );
        await onProposalSnapshotRead?.();
        const sourceByTransaction = new Map<string, MaterialSourceReference>();
        if (transactions.items.length > 0) {
          const sourceRows = await tx
            .select({ account: financeAccounts, item: financeTransactions })
            .from(financeTransactions)
            .innerJoin(financeAccounts, eq(financeAccounts.id, financeTransactions.accountId))
            .where(
              and(
                eq(financeTransactions.userId, userId),
                eq(financeAccounts.userId, userId),
                inArray(
                  financeTransactions.id,
                  transactions.items.map((item) => item.id),
                ),
              ),
            );
          for (const row of sourceRows) {
            sourceByTransaction.set(
              row.item.id,
              financeTransactionSourceValue(row.account, row.item),
            );
          }
        }
        return {
          items: await Promise.all(
            transactions.items.map((item) => {
              const source = sourceByTransaction.get(item.id);
              if (!source) {
                throw new AppError(
                  "conflict",
                  "The transaction source changed while proposals were being prepared.",
                );
              }
              return categorizationProposal(userId, item, source);
            }),
          ),
          nextCursor: transactions.nextCursor,
        };
      });
    },
    async proposeOutstandingCategorizations(
      userId: string,
      scope: MaintenanceScope,
      cursor?: string,
      onProgress?: FinanceSyncProgress,
    ): Promise<FinanceCategorizationProposalPage> {
      await onProgress?.();
      if (scope.type === "target" && scope.entityType === "finance_transaction") {
        const row = await ownedTransaction(userId, scope.id);
        if (!row.needsReview) return { items: [], nextCursor: null };
        const value = await enrichTransaction(row);
        return {
          items: [await categorizationProposal(userId, value)],
          nextCursor: null,
        };
      }
      if (scope.type === "target" && scope.entityType === "finance_review_case") {
        const [review] = await db
          .select({ transactionId: financeReviewCases.transactionId })
          .from(financeReviewCases)
          .where(and(eq(financeReviewCases.id, scope.id), eq(financeReviewCases.userId, userId)))
          .limit(1);
        if (!review) throw new AppError("not_found", "The finance review case was not found.");
        const row = await ownedTransaction(userId, review.transactionId);
        if (!row.needsReview) return { items: [], nextCursor: null };
        return {
          items: [await categorizationProposal(userId, await enrichTransaction(row))],
          nextCursor: null,
        };
      }
      if (
        scope.type === "target" &&
        scope.entityType !== "finance_account" &&
        scope.entityType !== "finance_transaction" &&
        scope.entityType !== "finance_review_case"
      ) {
        throw new AppError("invalid_request", "The Finance target type is not supported.");
      }
      if (scope.type === "target" && scope.entityType === "finance_account") {
        await ownedAccount(userId, scope.id);
      }
      return this.proposeCategorizations(userId, {
        ...(scope.type === "window" ? { from: scope.start, to: scope.end } : {}),
        ...(scope.type === "target" && scope.entityType === "finance_account"
          ? { accountId: scope.id }
          : {}),
        ...(cursor ? { cursor } : {}),
        limit: 50,
        review: "needs_review",
      });
    },
    async applyCategorizations(
      input: ApplyFinanceCategorizationsInput,
      context: MutationContext,
    ): Promise<FinanceCategorizationApplyResult[]> {
      if (
        context.principal.actorType === "agent" &&
        input.decisions.some((decision) => decision.learnMerchant === "always")
      ) {
        throw new AppError(
          "forbidden",
          "Permanent merchant rules require review in an interactive user session.",
        );
      }
      return mapWithConcurrency(input.decisions, 4, async (decision) => {
        try {
          const result = await applyCategorization(
            decision,
            context,
            context.principal.actorType === "user" ? "user" : "agent",
          );
          return {
            ...result,
            error: null,
            status: result.applied ? ("applied" as const) : ("review_required" as const),
            transactionId: decision.transactionId,
          };
        } catch (error) {
          return {
            applied: false,
            error: categorizationApplyError(error, context.requestId),
            replayed: false,
            status: "failed" as const,
            threshold: null,
            transaction: null,
            transactionId: decision.transactionId,
          };
        }
      });
    },
    async applyApprovedRules(
      input: ApplyFinanceCategorizationsInput,
      context: MutationContext,
    ): Promise<FinanceCategorizationApplyResult[]> {
      if (context.principal.actorType !== "agent") {
        throw new AppError("forbidden", "Finance maintenance rules require an agent principal.");
      }
      if (input.decisions.some((decision) => decision.learnMerchant !== "never")) {
        throw new AppError(
          "invalid_request",
          "Applying an approved Finance rule does not create or alter merchant rules.",
        );
      }
      for (const decision of input.decisions) {
        const row = await ownedTransaction(context.principal.userId, decision.transactionId);
        if (row.pending) {
          throw new AppError(
            "invalid_request",
            "Pending transactions cannot be categorized by maintenance.",
          );
        }
        const [protectedReview] = await db
          .select({ id: financeReviewCases.id })
          .from(financeReviewCases)
          .where(
            and(
              eq(financeReviewCases.transactionId, row.id),
              eq(financeReviewCases.userId, context.principal.userId),
              eq(financeReviewCases.reason, "possible_transfer"),
              inArray(financeReviewCases.status, ["deferred", "open"]),
            ),
          )
          .limit(1);
        if (row.reconciliationStatus === "candidate" || protectedReview) {
          throw new AppError(
            "forbidden",
            "Confirming an ambiguous transfer requires an interactive user session.",
          );
        }
      }
      return mapWithConcurrency(input.decisions, 4, async (decision) => {
        try {
          const result = await applyCategorization(decision, context, "rule");
          return {
            ...result,
            error: null,
            status: "applied" as const,
            transactionId: decision.transactionId,
          };
        } catch (error) {
          return {
            applied: false,
            error: categorizationApplyError(error, context.requestId),
            replayed: false,
            status: "failed" as const,
            threshold: null,
            transaction: null,
            transactionId: decision.transactionId,
          };
        }
      });
    },
    async applyApprovedOneOffs(
      input: ApplyFinanceCategorizationsInput,
      context: MutationContext,
    ): Promise<FinanceCategorizationApplyResult[]> {
      if (context.principal.actorType !== "agent") {
        throw new AppError("forbidden", "Finance maintenance one-offs require an agent principal.");
      }
      if (input.decisions.some((decision) => decision.learnMerchant !== "never")) {
        throw new AppError(
          "invalid_request",
          "Finance maintenance never creates reusable merchant rules from one-off decisions.",
        );
      }
      for (const decision of input.decisions) {
        const row = await ownedTransaction(context.principal.userId, decision.transactionId);
        if (row.pending) {
          throw new AppError(
            "invalid_request",
            "Pending transactions cannot be categorized by maintenance.",
          );
        }
        const [protectedReview] = await db
          .select({ id: financeReviewCases.id })
          .from(financeReviewCases)
          .where(
            and(
              eq(financeReviewCases.transactionId, row.id),
              eq(financeReviewCases.userId, context.principal.userId),
              eq(financeReviewCases.reason, "possible_transfer"),
              inArray(financeReviewCases.status, ["deferred", "open"]),
            ),
          )
          .limit(1);
        if (row.reconciliationStatus === "candidate" || protectedReview) {
          throw new AppError(
            "forbidden",
            "Confirming an ambiguous transfer requires an interactive user session.",
          );
        }
      }
      return this.applyCategorizations(input, context);
    },
    async refreshMaintenanceQuestionsForUser(
      userId: string,
      scope: MaintenanceScope,
      context?: MutationContext,
      onProgress?: FinanceSyncProgress,
    ) {
      await onProgress?.();
      await assertMaintenanceScopeOwned(userId, scope);
      const reviewsBefore = await db
        .select()
        .from(financeReviewCases)
        .where(
          and(
            eq(financeReviewCases.userId, userId),
            inArray(financeReviewCases.status, ["deferred", "open"]),
          ),
        );
      const targetReviewTransactionId =
        scope.type === "target" && scope.entityType === "finance_review_case"
          ? (reviewsBefore.find((review) => review.id === scope.id)?.transactionId ?? null)
          : null;
      const inScope = (row: typeof financeTransactions.$inferSelect) => {
        if (scope.type === "window") {
          return row.transactionDate >= scope.start && row.transactionDate <= scope.end;
        }
        if (scope.type !== "target") return true;
        if (scope.entityType === "finance_transaction") return row.id === scope.id;
        if (scope.entityType === "finance_account") return row.accountId === scope.id;
        if (scope.entityType === "finance_review_case") return row.id === targetReviewTransactionId;
        return false;
      };
      const rows = (
        await db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.userId, userId))
          .orderBy(financeTransactions.id)
      ).filter(inScope);
      const openByTransaction = new Map(
        reviewsBefore.map((review) => [review.transactionId, review]),
      );
      const duplicateGroups = new Map<string, Array<typeof financeTransactions.$inferSelect>>();
      for (const row of rows.filter((item) => !item.pending && item.direction !== "transfer")) {
        const key = [
          row.accountId,
          row.transactionDate,
          normalizedMerchant(row.merchant),
          row.amount,
          row.direction,
        ].join(":");
        const group = duplicateGroups.get(key) ?? [];
        group.push(row);
        duplicateGroups.set(key, group);
      }
      const duplicateTransactionIds = new Set<string>();
      for (const group of duplicateGroups.values()) {
        if (group.length < 2) continue;
        for (const row of group) duplicateTransactionIds.add(row.id);
        const existingDuplicate = group
          .map((row) => openByTransaction.get(row.id))
          .find((review) => review?.reason === "possible_duplicate");
        if (existingDuplicate) continue;
        const candidate = group.find((row) => !openByTransaction.has(row.id)) ?? group[0];
        if (!candidate) continue;
        const source = await financeTransactionSource(userId, candidate);
        await onProgress?.();
        const review = context?.maintenance
          ? await db.transaction(async (tx) => {
              await assertMaintenanceClaim(tx, context);
              return putInReview(
                candidate.id,
                userId,
                "possible_duplicate",
                null,
                "Another posted transaction has the same account, date, merchant, amount, and direction.",
                tx,
                context,
                source,
              );
            })
          : await putInReview(
              candidate.id,
              userId,
              "possible_duplicate",
              null,
              "Another posted transaction has the same account, date, merchant, amount, and direction.",
            );
        openByTransaction.set(candidate.id, review);
      }
      for (const row of rows.filter(
        (item) => item.needsReview && !item.pending && !duplicateTransactionIds.has(item.id),
      )) {
        const existing = openByTransaction.get(row.id);
        if (existing?.reason === "possible_transfer" || existing?.reason === "possible_duplicate") {
          continue;
        }
        const proposal = await categorizationProposal(userId, await enrichTransaction(row));
        const reason = proposal.suggestedCategory ? "low_confidence" : "unknown_merchant";
        const source = await financeTransactionSource(userId, row);
        await onProgress?.();
        const review = context?.maintenance
          ? await db.transaction(async (tx) => {
              await assertMaintenanceClaim(tx, context);
              return putInReview(
                row.id,
                userId,
                reason,
                proposal.suggestedCategory?.id ?? null,
                proposal.rationale,
                tx,
                context,
                source,
              );
            })
          : await putInReview(
              row.id,
              userId,
              reason,
              proposal.suggestedCategory?.id ?? null,
              proposal.rationale,
            );
        openByTransaction.set(row.id, review);
      }
      const scopedReviews = [...openByTransaction.values()].filter((review) => {
        const row = rows.find((item) => item.id === review.transactionId);
        return row !== undefined;
      });
      const beforeIds = new Set(reviewsBefore.map((review) => review.id));
      return {
        created: scopedReviews.filter((review) => !beforeIds.has(review.id)).length,
        total: scopedReviews.length,
      };
    },
    async resolveReview(id: string, input: FinanceReviewDecisionInput, context: MutationContext) {
      const [review] = await db
        .select()
        .from(financeReviewCases)
        .where(
          and(
            eq(financeReviewCases.id, id),
            eq(financeReviewCases.userId, context.principal.userId),
            inArray(financeReviewCases.status, ["deferred", "open"]),
          ),
        )
        .limit(1);
      if (!review) throw new AppError("not_found", "The finance review case was not found.");
      if (context.principal.actorType === "agent" && input.learnMerchant === "always") {
        throw new AppError(
          "forbidden",
          "Permanent merchant rules require review in an interactive user session.",
        );
      }
      if (context.principal.actorType === "agent" && input.action === "confirm_transfer") {
        throw new AppError(
          "forbidden",
          "Confirming an ambiguous transfer requires an interactive user session.",
        );
      }
      if (input.action === "confirm_transfer" && review.reason !== "possible_transfer") {
        throw new AppError(
          "invalid_request",
          "Only a possible-transfer review can be confirmed as a transfer.",
        );
      }
      if (review.reason === "possible_transfer" && input.action === "approve") {
        throw new AppError(
          "invalid_request",
          "Confirm or recategorize an ambiguous transfer explicitly.",
        );
      }
      if (
        context.principal.actorType === "agent" &&
        input.action !== "defer" &&
        (input.confidence === undefined || input.expectedTransactionUpdatedAt === undefined)
      ) {
        throw new AppError(
          "invalid_request",
          "Agent review decisions require the accepted proposal confidence and transaction revision.",
        );
      }
      if (input.action === "defer") {
        if (review.status === "deferred") return { deferred: true };
        await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(financeReviewCases)
            .set({ status: "deferred", updatedAt: now() })
            .where(and(eq(financeReviewCases.id, review.id), eq(financeReviewCases.status, "open")))
            .returning();
          if (!updated) {
            const [current] = await tx
              .select({ status: financeReviewCases.status })
              .from(financeReviewCases)
              .where(eq(financeReviewCases.id, review.id))
              .limit(1);
            if (current?.status === "deferred") return;
            throw new AppError(
              "conflict",
              "The finance review case changed before it was deferred.",
            );
          }
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.review_deferred",
              after: { id: updated.id, status: updated.status },
              before: { id: review.id, status: review.status },
              entityId: review.id,
              entityType: "finance_review_case",
              ...context,
            }),
          );
        });
        return { deferred: true };
      }
      if (input.expectedTransactionUpdatedAt === undefined) {
        throw new AppError(
          "invalid_request",
          "Resolving a Finance review requires the displayed transaction revision.",
        );
      }
      const current = await ownedTransaction(context.principal.userId, review.transactionId);
      // Signed provider direction is authoritative when available; the user
      // choice is only the fallback for legacy/manual rows without provenance.
      const nonTransferDirection =
        review.reason === "possible_transfer" && input.action === "recategorize"
          ? (current.providerDirection ?? input.nonTransferDirection)
          : undefined;
      if (
        review.reason === "possible_transfer" &&
        input.action === "recategorize" &&
        nonTransferDirection === undefined
      ) {
        throw new AppError(
          "invalid_request",
          "Choose whether this non-transfer transaction is income or an expense.",
        );
      }
      const categoryId =
        input.action === "approve"
          ? (current.categoryId ?? review.suggestedCategoryId)
          : input.action === "confirm_transfer"
            ? (await categoryForName(context.principal.userId, "Transfers")).id
            : input.categoryId;
      if (!categoryId)
        throw new AppError("invalid_request", "Choose a category before resolving this review.");
      const result = await applyCategorization(
        {
          categoryId,
          confidence: context.principal.actorType === "agent" ? (input.confidence ?? 0) : 1,
          expectedTransactionUpdatedAt: input.expectedTransactionUpdatedAt,
          learnMerchant: input.learnMerchant,
          rationale:
            input.rationale ??
            (context.principal.actorType === "user"
              ? "Reviewed in an interactive user session."
              : "Reviewed through a scoped agent action."),
          transactionId: current.id,
        },
        context,
        context.principal.actorType === "user" ? "user" : "agent",
        input.action === "recategorize" && current.categoryId !== categoryId
          ? "corrected"
          : "confirmed",
        input.action === "confirm_transfer"
          ? {
              auditAction: "finance.transfer_confirmed",
              direction: "transfer",
              reconciliationStatus: "confirmed",
              requiredReviewId: review.id,
            }
          : review.reason === "possible_transfer"
            ? {
                direction: nonTransferDirection as "expense" | "income",
                reconciliationStatus: "not_applicable",
                requiredReviewId: review.id,
              }
            : { requiredReviewId: review.id },
      );
      return result;
    },
    async backfillLearning(limit = 100) {
      const rows = await db
        .select()
        .from(financeTransactions)
        .where(or(isNull(financeTransactions.merchantId), isNull(financeTransactions.categoryId)))
        .orderBy(desc(financeTransactions.createdAt))
        .limit(limit);
      for (const row of rows) {
        const enriched = await persistTransactionEnrichment(row);
        if (enriched.merchantId !== row.merchantId || enriched.categoryId !== row.categoryId) {
          await db.insert(auditEvents).values(
            auditValues({
              action: "finance.transaction_enriched",
              after: {
                categoryId: enriched.categoryId,
                merchantId: enriched.merchantId,
                updatedAt: enriched.updatedAt.toISOString(),
              },
              before: {
                categoryId: row.categoryId,
                merchantId: row.merchantId,
                updatedAt: row.updatedAt.toISOString(),
              },
              entityId: row.id,
              entityType: "finance_transaction",
              principal: { actorId: row.userId, actorType: "system", userId: row.userId },
              requestId: "finance-learning-backfill",
            }),
          );
        }
        if (enriched.categoryId === null)
          await putInReview(
            row.id,
            row.userId,
            "unknown_merchant",
            null,
            "Backfilled without a confident category.",
          );
      }
      return { processed: rows.length };
    },
    async createAccount(input: CreateFinanceAccountInput, context: MutationContext) {
      const row = await db.transaction(async (tx) => {
        await ensureCategories(context.principal.userId, tx);
        const created = requireDatabaseRecord(
          (
            await tx
              .insert(financeAccounts)
              .values({
                balance: input.balance === null ? null : Math.round(input.balance * 100),
                institution: input.institution,
                kind: input.kind ?? "cash",
                name: input.name,
                provider: input.provider,
                status: input.provider === "manual" ? "manual" : "needs_reauth",
                syncState: input.provider === "manual" ? "current" : "stale",
                userId: context.principal.userId,
              })
              .returning()
          )[0],
          "The financial account could not be created.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.account_created",
            after: accountAuditSnapshot(account(created)),
            before: null,
            entityId: created.id,
            entityType: "finance_account",
            ...context,
          }),
        );
        return created;
      });
      return account(row);
    },
    async createBudget(input: CreateFinanceBudgetInput, context: MutationContext) {
      const row = await db.transaction(async (tx) => {
        const created = requireDatabaseRecord(
          (
            await tx
              .insert(financeBudgets)
              .values({
                category: input.category,
                limit: Math.round(input.limit * 100),
                month: input.month,
                userId: context.principal.userId,
              })
              .returning()
          )[0],
          "The budget could not be created.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.budget_created",
            after: { id: created.id, updatedAt: created.updatedAt.toISOString() },
            before: null,
            entityId: created.id,
            entityType: "finance_budget",
            ...context,
          }),
        );
        return created;
      });
      return budget(row);
    },
    async createTransaction(input: CreateFinanceTransactionInput, context: MutationContext) {
      await ownedAccount(context.principal.userId, input.accountId);
      const automatic =
        input.category === null
          ? await automaticCategorization(context.principal.userId, input.merchant)
          : {
              category: input.category,
              confidence:
                input.categoryConfidence === null
                  ? 10_000
                  : Math.round(input.categoryConfidence * 10_000),
              needsReview: input.categoryConfidence !== null && input.categoryConfidence < 0.8,
            };
      const merchantRecord = await merchantFor(context.principal.userId, input.merchant, "user");
      const categoryRecord = automatic.category
        ? await categoryForName(context.principal.userId, automatic.category)
        : null;
      const row = await db.transaction(async (tx) => {
        if (input.category !== null && categoryRecord) {
          await tx
            .select({ id: financeCategories.id })
            .from(financeCategories)
            .where(eq(financeCategories.userId, context.principal.userId))
            .orderBy(financeCategories.id)
            .for("update");
        }
        const created = requireDatabaseRecord(
          (
            await tx
              .insert(financeTransactions)
              .values({
                accountId: input.accountId,
                amount: Math.round(input.amount * 100),
                category: automatic.category,
                categoryId: categoryRecord?.id ?? null,
                categoryConfidence: automatic.confidence,
                categorySource:
                  input.category === null ? (automatic.category ? "rule" : null) : "user",
                categoryDecidedAt: input.category === null ? null : now(),
                direction: input.direction,
                merchant: input.merchant,
                merchantId: merchantRecord.id,
                needsReview: automatic.needsReview,
                notes: input.notes,
                transactionDate: input.date,
                userId: context.principal.userId,
              })
              .returning()
          )[0],
          "The transaction could not be created.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.transaction_created",
            after: transactionAuditSnapshot(transaction(created)),
            before: null,
            entityId: created.id,
            entityType: "finance_transaction",
            ...context,
          }),
        );
        if (input.category !== null && categoryRecord) {
          await tx.insert(financeClassificationDecisions).values({
            categoryId: categoryRecord.id,
            categoryName: categoryRecord.name,
            confidence: 10_000,
            merchantId: merchantRecord.id,
            outcome: "confirmed",
            rationale: "Categorized directly by the user.",
            source: "user",
            transactionId: created.id,
            userId: context.principal.userId,
          });
        }
        return created;
      });
      await refreshCashflowIntelligence(context.principal.userId);
      return transaction(row);
    },
    async importCsv(input: FinanceCsvImportInput, context: MutationContext) {
      const destination = await ownedAccount(context.principal.userId, input.accountId);
      if (destination.provider !== input.provider) {
        throw new AppError(
          "invalid_request",
          `Choose a ${input.provider} account before importing that export.`,
        );
      }
      let records: ReturnType<typeof parseFinanceCsv>;
      try {
        records = parseFinanceCsv(input.provider, input.csv);
      } catch (error) {
        throw new AppError("invalid_request", financeCsvImportErrorMessage(error));
      }
      const result = await db.transaction(async (tx) => {
        let imported = 0;
        for (const record of records) {
          const automatic = await automaticCategorization(
            context.principal.userId,
            record.merchant,
          );
          const merchantRecord = await merchantFor(
            context.principal.userId,
            record.merchant,
            "provider",
          );
          const categoryRecord = automatic.category
            ? await categoryForName(context.principal.userId, automatic.category)
            : null;
          const providerTransactionId = createHash("sha256")
            .update(`${input.provider}:${record.externalId}`)
            .digest("hex");
          const [created] = await tx
            .insert(financeTransactions)
            .values({
              accountId: destination.id,
              amount: Math.round(record.amount * 100),
              category: automatic.category,
              categoryId: categoryRecord?.id ?? null,
              categoryConfidence: automatic.confidence,
              categorySource: automatic.category ? "rule" : null,
              direction: record.direction,
              merchant: record.merchant,
              merchantId: merchantRecord.id,
              needsReview: automatic.needsReview,
              notes: record.notes,
              providerTransactionId,
              transactionDate: record.date,
              userId: context.principal.userId,
            })
            .onConflictDoNothing({
              target: [financeTransactions.accountId, financeTransactions.providerTransactionId],
            })
            .returning({ id: financeTransactions.id });
          if (created) imported += 1;
        }
        return { imported, skipped: records.length - imported };
      });
      await db.insert(auditEvents).values(
        auditValues({
          action: "finance.csv_imported",
          after: { ...result, provider: input.provider },
          before: null,
          entityId: destination.id,
          entityType: "finance_account",
          ...context,
        }),
      );
      await refreshCashflowIntelligence(context.principal.userId);
      return result;
    },
    async deleteAccount(id: string, context: MutationContext) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`finance-provider-topology:${context.principal.userId}`}, 0))`,
        );
        const [candidate] = await tx
          .select()
          .from(financeAccounts)
          .where(
            and(eq(financeAccounts.id, id), eq(financeAccounts.userId, context.principal.userId)),
          )
          .limit(1);
        if (!candidate) throw new AppError("not_found", "The financial account was not found.");
        let providerItem: typeof financeProviderItems.$inferSelect | undefined;
        let linkedAccounts: Array<typeof financeAccounts.$inferSelect> = [];
        let before: typeof financeAccounts.$inferSelect | undefined;
        if (candidate.providerItemRecordId) {
          [providerItem] = await tx
            .select()
            .from(financeProviderItems)
            .where(
              and(
                eq(financeProviderItems.id, candidate.providerItemRecordId),
                eq(financeProviderItems.userId, context.principal.userId),
                eq(financeProviderItems.provider, "plaid"),
              ),
            )
            .for("update")
            .limit(1);
          if (!providerItem) {
            throw new AppError("conflict", "The Plaid connection topology changed. Try again.");
          }
          const [activeClaim] = await tx
            .select({ id: financeProviderItems.id })
            .from(financeProviderItems)
            .where(
              and(
                eq(financeProviderItems.id, providerItem.id),
                sql`${financeProviderItems.syncClaimId} IS NOT NULL`,
                sql`${financeProviderItems.syncClaimExpiresAt} > NOW()`,
              ),
            )
            .limit(1);
          if (activeClaim) {
            throw new AppError(
              "conflict",
              "The Plaid connection is synchronizing. Retry account deletion after it finishes.",
            );
          }
          linkedAccounts = await tx
            .select()
            .from(financeAccounts)
            .where(eq(financeAccounts.providerItemRecordId, providerItem.id))
            .orderBy(financeAccounts.id)
            .for("update");
          if (
            linkedAccounts.some(
              (account) =>
                account.userId !== context.principal.userId || account.provider !== "plaid",
            )
          ) {
            throw new AppError("conflict", "The Plaid connection topology is inconsistent.");
          }
          before = linkedAccounts.find((account) => account.id === id);
          if (!before || before.providerItemRecordId !== candidate.providerItemRecordId) {
            throw new AppError("conflict", "The Plaid connection topology changed. Try again.");
          }
        } else {
          [before] = await tx
            .select()
            .from(financeAccounts)
            .where(
              and(eq(financeAccounts.id, id), eq(financeAccounts.userId, context.principal.userId)),
            )
            .for("update")
            .limit(1);
          if (before?.providerItemRecordId) {
            throw new AppError("conflict", "The Plaid connection topology changed. Try again.");
          }
        }
        if (!before) throw new AppError("not_found", "The financial account was not found.");
        const [profile] = await tx
          .select()
          .from(domainProfiles)
          .where(
            and(
              eq(domainProfiles.userId, context.principal.userId),
              eq(domainProfiles.domain, "finances"),
            ),
          )
          .for("update")
          .limit(1);
        const [approval] = await tx
          .select()
          .from(domainProfileApprovals)
          .where(
            and(
              eq(domainProfileApprovals.userId, context.principal.userId),
              eq(domainProfileApprovals.domain, "finances"),
            ),
          )
          .for("update")
          .limit(1);
        const approvedProfile = approvedProfileFrom(approval);
        if (approval && !approvedProfile) {
          throw new AppError(
            "conflict",
            "Finance guidance approval integrity must be restored before deleting this account.",
          );
        }
        if (
          approvedProfile?.sourceContexts.some((source) => source.sourceId === before.id) ||
          (!approval &&
            profile?.status === "active" &&
            profile.sourceContexts.some((source) => source.sourceId === before.id))
        ) {
          throw new AppError(
            "conflict",
            "Remove this account from active approved Finance guidance before deleting it.",
          );
        }
        if (
          profile?.status === "draft" &&
          profile.sourceContexts.some((source) => source.sourceId === before.id)
        ) {
          const nextSources = profile.sourceContexts.filter(
            (source) => source.sourceId !== before.id,
          );
          await tx
            .update(domainProfiles)
            .set({
              sourceContexts: nextSources,
              updatedAt: now(),
              version: profile.version + 1,
            })
            .where(eq(domainProfiles.id, profile.id));
          await tx.insert(auditEvents).values(
            auditValues({
              action: "assistant.profile.updated",
              after: {
                changedFields: ["sourceContexts"],
                domain: "finances",
                status: "draft",
                version: profile.version + 1,
              },
              before: {
                changedFields: ["sourceContexts"],
                domain: "finances",
                status: "draft",
                version: profile.version,
              },
              entityId: profile.id,
              entityType: "domain_profile",
              ...context,
            }),
          );
        }
        const ownedTransactions = await tx
          .select({ id: financeTransactions.id })
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.accountId, before.id),
              eq(financeTransactions.userId, context.principal.userId),
            ),
          )
          .orderBy(financeTransactions.id)
          .for("update");
        for (let offset = 0; offset < ownedTransactions.length; offset += 1_000) {
          const transactionIds = ownedTransactions
            .slice(offset, offset + 1_000)
            .map((item) => item.id);
          const linkedAttention = await tx
            .select()
            .from(attentionItems)
            .where(
              and(
                eq(attentionItems.userId, context.principal.userId),
                eq(attentionItems.domain, "finances"),
                eq(attentionItems.relatedEntityType, "finance_transaction"),
                inArray(attentionItems.relatedEntityId, transactionIds),
              ),
            )
            .orderBy(attentionItems.id)
            .for("update");
          for (const linked of linkedAttention) {
            const [resolved] = await tx
              .update(attentionItems)
              .set({
                relatedEntityId: null,
                relatedEntityType: null,
                source: null,
                status: "resolved",
                updatedAt: now(),
                version: linked.version + 1,
              })
              .where(
                and(eq(attentionItems.id, linked.id), eq(attentionItems.version, linked.version)),
              )
              .returning();
            if (!resolved) {
              throw new AppError(
                "conflict",
                "Finance attention changed while its account was being deleted.",
              );
            }
            await tx.insert(auditEvents).values(
              auditValues({
                action: "assistant.attention.resolved",
                after: {
                  ...auditAttentionItemMetadata(resolved),
                  policy: "approve_each",
                  source: null,
                },
                before: {
                  ...auditAttentionItemMetadata(linked),
                  source: linked.source,
                },
                entityId: resolved.id,
                entityType: "attention_item",
                ...context,
              }),
            );
          }
        }
        await tx.delete(financeAccounts).where(eq(financeAccounts.id, before.id));
        if (providerItem && linkedAccounts.length === 1) {
          await tx.delete(financeProviderItems).where(eq(financeProviderItems.id, providerItem.id));
        }
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.account_deleted",
            after: null,
            before: accountAuditSnapshot(account(before)),
            entityId: before.id,
            entityType: "finance_account",
            ...context,
          }),
        );
      });
    },
    async getBudgetPace(
      userId: string,
      period: FinanceBudgetPacePeriod,
    ): Promise<FinanceBudgetPace> {
      const today = now().toISOString().slice(0, 10);
      const dates = budgetPaceDates(period, today);
      const months = new Set(dates.map((date) => date.slice(0, 7)));
      const startDate = `${[...months].toSorted()[0] ?? today.slice(0, 7)}-01`;
      const [budgets, transactions] = await Promise.all([
        db.select().from(financeBudgets).where(eq(financeBudgets.userId, userId)),
        db
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              gte(financeTransactions.transactionDate, startDate),
              lte(financeTransactions.transactionDate, today),
            ),
          ),
      ]);
      const budgetByMonth = new Map<string, number>();
      for (const item of budgets) {
        if (!months.has(item.month)) continue;
        budgetByMonth.set(item.month, (budgetByMonth.get(item.month) ?? 0) + item.limit);
      }
      const spendingByDate = new Map<string, number>();
      for (const item of transactions) {
        const impact = budgetImpact(item);
        if (impact === 0) continue;
        spendingByDate.set(
          item.transactionDate,
          (spendingByDate.get(item.transactionDate) ?? 0) + impact,
        );
      }
      const visibleDates = new Set(dates);
      const cumulativeSpendingByMonth = new Map<string, number>();
      const cellsByDate = new Map<string, FinanceBudgetPace["cells"][number]>();
      for (let date = startDate; date <= today; date = dateAfter(date, 1)) {
        const month = date.slice(0, 7);
        const budget = budgetByMonth.get(month) ?? 0;
        const spent = (cumulativeSpendingByMonth.get(month) ?? 0) + (spendingByDate.get(date) ?? 0);
        cumulativeSpendingByMonth.set(month, spent);
        if (!visibleDates.has(date)) continue;
        const dayOfMonth = Number(date.slice(-2));
        const planned = Math.round((budget * dayOfMonth) / daysInCalendarMonth(month));
        const variance = spent - planned;
        const tolerance = Math.max(100, Math.round(planned * 0.05));
        cellsByDate.set(date, {
          date,
          planned: planned / 100,
          spent: Math.max(0, spent) / 100,
          status:
            budget === 0 || !spendingByDate.has(date)
              ? ("blank" as const)
              : variance > tolerance
                ? ("behind" as const)
                : variance < -tolerance
                  ? ("ahead" as const)
                  : ("neutral" as const),
        });
      }
      return {
        asOf: today,
        cells: dates.map(
          (date) =>
            cellsByDate.get(date) ?? {
              date,
              planned: 0,
              spent: 0,
              status: "blank" as const,
            },
        ),
        period,
      };
    },
    async listOverview(
      userId: string,
      requestedMonth?: string,
      accountIds?: string[],
    ): Promise<FinanceOverview> {
      const month = requestedMonth ?? now().toISOString().slice(0, 7);
      const [accounts, budgets, transactions, monthlyTransactions] = await Promise.all([
        db
          .select()
          .from(financeAccounts)
          .where(eq(financeAccounts.userId, userId))
          .orderBy(desc(financeAccounts.createdAt)),
        db
          .select()
          .from(financeBudgets)
          .where(and(eq(financeBudgets.userId, userId), eq(financeBudgets.month, month)))
          .orderBy(financeBudgets.category),
        db
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              gte(financeTransactions.transactionDate, `${month}-01`),
              lt(financeTransactions.transactionDate, `${nextMonth(month)}-01`),
            ),
          )
          .orderBy(desc(financeTransactions.transactionDate), desc(financeTransactions.createdAt))
          .limit(200),
        db
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              gte(financeTransactions.transactionDate, `${month}-01`),
              lt(financeTransactions.transactionDate, `${nextMonth(month)}-01`),
            ),
          ),
      ]);
      const scopedTransactions = accountIds
        ? monthlyTransactions.filter((item) => accountIds.includes(item.accountId))
        : monthlyTransactions;
      const spending = scopedTransactions.reduce((sum, item) => sum + budgetImpact(item), 0);
      const pendingSpend = scopedTransactions.reduce(
        (sum, item) => (item.pending ? sum + Math.max(0, budgetImpact(item, true)) : sum),
        0,
      );
      const refunds = scopedTransactions.reduce(
        (sum, item) => (isRefundOrReversal(item) ? sum + item.amount : sum),
        0,
      );
      return {
        accounts: await serializeAccounts(accounts),
        budgets: budgets.map(budget),
        reviewCount: scopedTransactions.filter((item) => item.needsReview).length,
        pendingSpendThisMonth: pendingSpend / 100,
        refundCreditsThisMonth: refunds / 100,
        spendingThisMonth: spending / 100,
        transactions: await enrichTransactions(transactions),
      };
    },
    async getWealthSummary(userId: string): Promise<FinanceWealthSummary> {
      const nowDate = now();
      const trailingStart = new Date(nowDate);
      trailingStart.setUTCFullYear(trailingStart.getUTCFullYear() - 1);
      const [accounts, budgets, income, profile] = await Promise.all([
        db.select().from(financeAccounts).where(eq(financeAccounts.userId, userId)),
        db
          .select()
          .from(financeBudgets)
          .where(
            and(
              eq(financeBudgets.userId, userId),
              eq(financeBudgets.month, nowDate.toISOString().slice(0, 7)),
            ),
          ),
        db
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              gte(financeTransactions.transactionDate, trailingStart.toISOString().slice(0, 10)),
            ),
          ),
        this.getProfile(userId, nowDate.toISOString().slice(0, 10)),
      ]);
      const totals = { cash: 0, debt: 0, investments: 0, otherAssets: 0 };
      for (const item of accounts) {
        const value = Math.abs(item.balance ?? 0) / 100;
        if (item.kind === "debt") totals.debt += value;
        else if (item.kind === "investment") totals.investments += value;
        else if (item.kind === "other") totals.otherAssets += value;
        else totals.cash += (item.balance ?? 0) / 100;
      }
      const observedAnnualIncome =
        income
          .filter((item) => item.direction === "income" && item.category === "INCOME")
          .reduce((sum, item) => sum + item.amount, 0) / 100;
      const statedAnnualIncome = profile?.grossAnnualIncome ?? null;
      const annualIncome = statedAnnualIncome ?? observedAnnualIncome;
      const incomeBasis =
        statedAnnualIncome !== null ? "stated" : annualIncome > 0 ? "observed" : "none";
      const plannedThisMonth = budgets.reduce((sum, item) => sum + item.limit, 0) / 100;
      const monthlyIncome = annualIncome / 12;
      return {
        ...totals,
        annualIncome,
        incomeBasis,
        monthlyIncome,
        plannedThisMonth,
        monthlyPlanRemaining: annualIncome > 0 ? monthlyIncome - plannedThisMonth : null,
        netWorth: totals.cash + totals.investments + totals.otherAssets - totals.debt,
        observedAnnualIncome,
        statedAnnualIncome,
      };
    },
    async getLedgerHealth(userId: string): Promise<FinanceLedgerHealth> {
      const [accounts, transactions, reviews] = await Promise.all([
        db.select().from(financeAccounts).where(eq(financeAccounts.userId, userId)),
        db.select().from(financeTransactions).where(eq(financeTransactions.userId, userId)),
        db
          .select()
          .from(financeReviewCases)
          .where(
            and(
              eq(financeReviewCases.userId, userId),
              inArray(financeReviewCases.status, ["deferred", "open"]),
            ),
          ),
      ]);
      const synchronizedAccounts = await serializeAccounts(accounts);
      const cutoff = now().getTime() - 24 * 60 * 60 * 1000;
      const duplicateKeys = new Map<string, number>();
      for (const item of transactions) {
        if (item.direction === "transfer" || /^(mta|venmo)$/i.test(item.merchant)) continue;
        const key = [
          item.accountId,
          item.transactionDate,
          normalizedMerchant(item.merchant),
          item.amount,
          item.direction,
        ].join(":");
        duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
      }
      return {
        asOf: now().toISOString(),
        balanceOnlyAccounts: accounts.filter(
          (account) => !transactions.some((item) => item.accountId === account.id),
        ).length,
        candidateTransfers: transactions.filter((item) => item.reconciliationStatus === "candidate")
          .length,
        missingProvenance: transactions.filter(
          (item) => item.category !== null && item.categorySource === null,
        ).length,
        pendingTransactions: transactions.filter((item) => item.pending).length,
        possibleDuplicates: [...duplicateKeys.values()].filter((count) => count > 1).length,
        staleAccounts: synchronizedAccounts.filter(
          (account) =>
            account.status === "connected" &&
            (!account.lastSyncedAt || new Date(account.lastSyncedAt).getTime() < cutoff),
        ).length,
        unresolvedReviews: reviews.length,
      };
    },
    async exportData(userId: string): Promise<FinanceExport> {
      const [
        accounts,
        budgets,
        categories,
        transactions,
        profile,
        incomeStreams,
        recurringObligations,
        alerts,
      ] = await Promise.all([
        db
          .select()
          .from(financeAccounts)
          .where(eq(financeAccounts.userId, userId))
          .orderBy(financeAccounts.institution, financeAccounts.name),
        db
          .select()
          .from(financeBudgets)
          .where(eq(financeBudgets.userId, userId))
          .orderBy(desc(financeBudgets.month), financeBudgets.category),
        this.listCategories(userId),
        db
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.userId, userId))
          .orderBy(desc(financeTransactions.transactionDate), desc(financeTransactions.createdAt)),
        this.getProfile(userId),
        this.listIncomeStreams(userId),
        this.listRecurringObligations(userId),
        this.listAlerts(userId),
      ]);
      return {
        accounts: await serializeAccounts(accounts),
        alerts,
        asOf: now().toISOString(),
        budgets: budgets.map(budget),
        categories,
        incomeStreams,
        profile,
        recurringObligations,
        transactions: await enrichTransactions(transactions),
      };
    },
    async updateTransaction(
      id: string,
      input: UpdateFinanceTransactionInput,
      context: MutationContext,
    ) {
      const before = await ownedTransaction(context.principal.userId, id);
      if (context.principal.actorType === "agent") {
        throw new AppError(
          "forbidden",
          "Finance transaction edits require an interactive user session.",
        );
      }
      const categoryRecord =
        input.category === undefined || input.category === null
          ? null
          : await categoryForName(context.principal.userId, input.category);
      const row = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.id, before.id),
              eq(financeTransactions.userId, context.principal.userId),
            ),
          )
          .for("update")
          .limit(1);
        if (!current) throw new AppError("not_found", "The transaction was not found.");
        if (current.pending && input.category !== undefined && input.learnMerchant === true) {
          throw new AppError(
            "invalid_request",
            "Pending transactions cannot create permanent categorization evidence.",
          );
        }
        if (input.category !== undefined) {
          await tx
            .select({ id: financeCategories.id })
            .from(financeCategories)
            .where(eq(financeCategories.userId, context.principal.userId))
            .orderBy(financeCategories.id)
            .for("update");
        }
        const updated = requireDatabaseRecord(
          (
            await tx
              .update(financeTransactions)
              .set({
                ...input,
                categoryConfidence:
                  input.category === undefined
                    ? undefined
                    : input.category === null
                      ? null
                      : 10_000,
                categoryDecidedAt: input.category === undefined ? undefined : now(),
                categoryId:
                  input.category === undefined
                    ? undefined
                    : input.category === null
                      ? null
                      : categoryRecord?.id,
                categoryRationale:
                  input.category === undefined
                    ? undefined
                    : input.category === null
                      ? null
                      : "Categorized directly by the user.",
                categorySource: input.category === undefined ? undefined : "user",
                needsReview: input.category === undefined ? undefined : input.category === null,
                updatedAt: now(),
              })
              .where(eq(financeTransactions.id, before.id))
              .returning()
          )[0],
          "The transaction could not be updated.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action:
              input.category === undefined
                ? "finance.transaction_updated"
                : "finance.transaction_categorized",
            after:
              input.category === undefined
                ? { changedFields: ["notes"] }
                : transactionAuditSnapshot(transaction(updated)),
            before:
              input.category === undefined ? null : transactionAuditSnapshot(transaction(current)),
            entityId: updated.id,
            entityType: "finance_transaction",
            ...context,
          }),
        );
        if (input.category !== undefined) {
          if (input.category === null && !current.pending) {
            await tx
              .delete(financeCategoryRules)
              .where(
                and(
                  eq(financeCategoryRules.userId, context.principal.userId),
                  eq(financeCategoryRules.merchantNormalized, normalizedMerchant(current.merchant)),
                ),
              );
          } else if (input.category !== null && !current.pending) {
            await tx.insert(financeClassificationDecisions).values({
              categoryId: categoryRecord?.id ?? null,
              categoryName: input.category,
              confidence: 10_000,
              merchantId: current.merchantId,
              outcome:
                current.categoryId !== null && current.categoryId !== categoryRecord?.id
                  ? "corrected"
                  : "confirmed",
              rationale: "Categorized directly by the user.",
              source: "user",
              transactionId: current.id,
              userId: context.principal.userId,
            });
            await tx
              .update(financeReviewCases)
              .set({ resolvedAt: now(), status: "resolved", updatedAt: now() })
              .where(
                and(
                  eq(financeReviewCases.transactionId, current.id),
                  inArray(financeReviewCases.status, ["deferred", "open"]),
                ),
              );
          }
          if (!current.pending && input.category !== null && input.learnMerchant === true) {
            await tx
              .insert(financeCategoryRules)
              .values({
                category: input.category,
                merchantNormalized: normalizedMerchant(current.merchant),
                userId: context.principal.userId,
              })
              .onConflictDoUpdate({
                set: { category: input.category, updatedAt: now() },
                target: [financeCategoryRules.userId, financeCategoryRules.merchantNormalized],
              });
          }
        }
        return updated;
      });
      return transaction(row);
    },
  };
}
