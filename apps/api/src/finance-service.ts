import { createHash, randomUUID } from "node:crypto";
import { providerFetch } from "@personal-os/connectors";
import {
  auditEvents,
  type Database,
  domainProfiles,
  type EncryptedCredentials,
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
  financeRecurringObligations,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import type {
  ApplyFinanceCategorizationsInput,
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
  MergeFinanceMerchantsInput,
  ResolveFinanceAlertInput,
  UpdateFinanceIncomeStreamInput,
  UpdateFinanceMerchantInput,
  UpdateFinanceProfileInput,
  UpdateFinanceRecurringObligationInput,
  UpdateFinanceTransactionInput,
} from "@personal-os/domain";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
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
import { decryptJson, encryptJson } from "./security.js";
import type { Principal } from "./types.js";

type MutationContext = { principal: Principal; requestId: string };
type PlaidOptions = {
  clientId: string;
  encryptionKey: string;
  environment: "sandbox" | "development" | "production";
  fetch?: typeof globalThis.fetch;
  secret: string;
};
type Options = { db: Database; now: () => Date; plaid?: PlaidOptions };
type PlaidCredentials = { accessToken: string };
type PlaidAccount = {
  account_id: string;
  balances: { current: number | null };
  name: string;
  official_name: string | null;
};
type PlaidTransaction = {
  account_id: string;
  amount: number;
  date: string;
  merchant_name: string | null;
  name: string;
  pending: boolean;
  pending_transaction_id: string | null;
  personal_finance_category: {
    confidence_level?: "HIGH" | "LOW" | "MEDIUM" | "UNKNOWN" | "VERY_HIGH" | null;
    detailed?: string | null;
    primary: string;
  } | null;
  transaction_id: string;
};
type PlaidCategoryConfidence = NonNullable<
  PlaidTransaction["personal_finance_category"]
>["confidence_level"];

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
function account(row: typeof financeAccounts.$inferSelect): FinanceAccount {
  return {
    balance: currency(row.balance),
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    institution: row.institution,
    kind: row.kind,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    name: row.name,
    provider: row.provider,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
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
function merchantAuditSnapshot(value: FinanceMerchant) {
  return {
    id: value.id,
    isUserConfirmed: value.isUserConfirmed,
  };
}

export function createFinanceService({ db, now, plaid }: Options) {
  async function ensureCategories(userId: string) {
    await db
      .insert(financeCategories)
      .values(
        defaultCategories.map(([name, slug]) => ({
          group: categoryGroup(name),
          isSystem: true,
          name,
          slug,
          userId,
        })),
      )
      .onConflictDoNothing({ target: [financeCategories.userId, financeCategories.slug] });
    return db
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.userId, userId))
      .orderBy(financeCategories.group, financeCategories.name);
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

  async function categoryForId(userId: string, categoryId: string) {
    const [row] = await db
      .select()
      .from(financeCategories)
      .where(and(eq(financeCategories.id, categoryId), eq(financeCategories.userId, userId)))
      .limit(1);
    if (!row) throw new AppError("not_found", "The finance category was not found.");
    return row;
  }

  async function categoryForName(userId: string, name: string) {
    const categories = await ensureCategories(userId);
    const existing = categories.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const slug = categorySlug(name);
    const [created] = await db
      .insert(financeCategories)
      .values({ group: "Custom", isSystem: false, name, slug, userId })
      .onConflictDoUpdate({
        set: { name, updatedAt: now() },
        target: [financeCategories.userId, financeCategories.slug],
      })
      .returning();
    return requireDatabaseRecord(created, "The finance category could not be saved.");
  }

  async function merchantFor(
    userId: string,
    rawMerchant: string,
    source: "agent" | "provider" | "user",
  ) {
    const normalizedName = normalizedMerchant(rawMerchant);
    const [alias] = await db
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
    const [merchant] = await db
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
    await db
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
    const strongest = [...counts.values()].sort((a, b) => b.confirmations - a.confirmations)[0];
    if (!strongest) return null;
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
  ): Promise<FinanceCategorizationProposal> {
    const automatic = await automaticCategorization(userId, item.rawMerchant ?? item.merchant);
    const evidence = automatic.category
      ? null
      : await merchantCategoryEvidence(userId, item.merchantId ?? null);
    const categoryName = automatic.category ?? evidence?.category ?? null;
    const suggestedCategory = categoryName
      ? (
          await db
            .select()
            .from(financeCategories)
            .where(
              and(eq(financeCategories.userId, userId), eq(financeCategories.name, categoryName)),
            )
            .limit(1)
        )[0]
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
        ? `Matched ${item.merchant} using a confirmed merchant rule.`
        : evidence
          ? `Matched ${item.merchant} to ${evidence.confirmations} user confirmation${evidence.confirmations === 1 ? "" : "s"}.`
          : "No durable merchant or category evidence is available yet.",
      suggestedCategory: suggestedCategory ? categoryValue(suggestedCategory) : null,
      threshold,
      transaction: item,
    };
  }
  async function reconcileBudgetTransfers(userId: string) {
    const [accounts, transactions, transfers] = await Promise.all([
      db.select().from(financeAccounts).where(eq(financeAccounts.userId, userId)),
      db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.userId, userId))
        .orderBy(desc(financeTransactions.transactionDate), desc(financeTransactions.createdAt)),
      categoryForName(userId, transferCategory),
    ]);
    const accountKinds = new Map(accounts.map((item) => [item.id, item.kind]));
    const rent = await categoryForName(userId, rentCategory);
    const rentTransactions = transactions.filter((item) => isRentMerchant(item.merchant));
    const vaultTransfers = transactions.filter(
      (item) => !isRentMerchant(item.merchant) && isSoFiVaultTransfer(item.merchant),
    );
    const vaultIds = new Set(vaultTransfers.map((item) => item.id));
    const unmatched = transactions.filter((item) => !item.pending && !vaultIds.has(item.id));
    const pairedIds = new Set<string>();
    for (const debit of unmatched) {
      if (debit.direction !== "expense" || pairedIds.has(debit.id)) continue;
      const credit = unmatched.find(
        (candidate) =>
          candidate.direction === "income" &&
          !pairedIds.has(candidate.id) &&
          candidate.accountId !== debit.accountId &&
          candidate.amount === debit.amount &&
          isCardPayment(debit.merchant) &&
          isCardPayment(candidate.merchant) &&
          Math.abs(
            Date.parse(`${candidate.transactionDate}T12:00:00Z`) -
              Date.parse(`${debit.transactionDate}T12:00:00Z`),
          ) <=
            14 * 24 * 60 * 60 * 1000 &&
          (accountKinds.get(debit.accountId) === "debt" ||
            accountKinds.get(candidate.accountId) === "debt"),
      );
      if (!credit) continue;
      pairedIds.add(debit.id);
      pairedIds.add(credit.id);
      const transferGroupId = randomUUID();
      for (const item of [debit, credit]) {
        await db
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
          .where(eq(financeTransactions.id, item.id));
      }
    }
    for (const id of vaultIds) {
      await db
        .update(financeTransactions)
        .set({
          category: transferCategory,
          categoryConfidence: 10_000,
          categoryId: transfers.id,
          categoryRationale: "Matched as movement between accounts, not new spending.",
          categorySource: "rule",
          direction: "transfer",
          needsReview: false,
          reconciliationStatus: "confirmed",
          updatedAt: now(),
        })
        .where(eq(financeTransactions.id, id));
    }
    const transferCandidates = transactions.filter(
      (item) =>
        item.direction === "transfer" &&
        !vaultIds.has(item.id) &&
        !pairedIds.has(item.id) &&
        item.reconciliationStatus !== "matched" &&
        item.reconciliationStatus !== "confirmed",
    );
    for (const item of transferCandidates) {
      await db
        .update(financeTransactions)
        .set({
          needsReview: true,
          reconciliationStatus: "candidate",
          updatedAt: now(),
        })
        .where(eq(financeTransactions.id, item.id));
      await putInReview(
        item.id,
        userId,
        "possible_transfer",
        null,
        "Provider marked this movement as a transfer, but no internal counterpart is confirmed.",
      );
    }
    for (const item of rentTransactions) {
      await db
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
        .where(eq(financeTransactions.id, item.id));
    }
    return { paired: pairedIds.size / 2, transfers: vaultIds.size + pairedIds.size };
  }
  function getPlaid() {
    if (!plaid?.clientId || !plaid.secret) {
      throw new AppError("invalid_request", "Plaid is not configured for this ilo instance.");
    }
    return plaid;
  }
  async function plaidRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const config = getPlaid();
    const response = await providerFetch(
      config.fetch ?? globalThis.fetch,
      `https://${config.environment}.plaid.com${path}`,
      {
        body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...body }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const value = (await response.json().catch(() => null)) as
      | T
      | { error_message?: string }
      | null;
    if (!response.ok) {
      throw new AppError(
        "invalid_request",
        value && typeof value === "object" && "error_message" in value && value.error_message
          ? `Plaid: ${value.error_message}`
          : "Plaid could not complete that request.",
      );
    }
    return value as T;
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
  async function ownedMerchant(userId: string, id: string) {
    const [row] = await db
      .select()
      .from(financeMerchants)
      .where(and(eq(financeMerchants.id, id), eq(financeMerchants.userId, userId)))
      .limit(1);
    if (!row) throw new AppError("not_found", "The finance merchant was not found.");
    return row;
  }
  async function enrichTransaction(row: typeof financeTransactions.$inferSelect) {
    const merchant = row.merchantId
      ? (
          await db
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
      | "possible_transfer"
      | "unknown_merchant",
    suggestedCategoryId: string | null,
    rationale: string | null,
  ) {
    const [existing] = await db
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
      const [updated] = await db
        .update(financeReviewCases)
        .set({ rationale, reason, suggestedCategoryId, updatedAt: now() })
        .where(eq(financeReviewCases.id, existing.id))
        .returning();
      return requireDatabaseRecord(updated, "The finance review case could not be saved.");
    }
    const [review] = await db
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
    return requireDatabaseRecord(review, "The finance review case could not be saved.");
  }

  async function applyCategorization(
    decision: ApplyFinanceCategorizationsInput["decisions"][number],
    context: MutationContext,
    source: DecisionSource,
    userOutcome: "confirmed" | "corrected" = "confirmed",
    options: {
      auditAction?: "finance.transaction_categorized" | "finance.transfer_confirmed";
      direction?: "transfer";
    } = {},
  ) {
    const before = await ownedTransaction(context.principal.userId, decision.transactionId);
    const category = await categoryForId(context.principal.userId, decision.categoryId);
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
    if (source === "agent") {
      const proposal = await categorizationProposal(context.principal.userId, beforeValue);
      if (
        proposal.suggestedCategory?.id !== category.id ||
        proposal.confidence !== decision.confidence
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
      if (source === "agent" && (current.reconciliationStatus === "candidate" || protectedReview)) {
        throw new AppError(
          "forbidden",
          "Confirming an ambiguous transfer requires an interactive user session.",
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
      await tx
        .update(financeReviewCases)
        .set({ resolvedAt: now(), status: "resolved", updatedAt: now() })
        .where(
          and(
            eq(financeReviewCases.transactionId, before.id),
            inArray(financeReviewCases.status, ["deferred", "open"]),
          ),
        );
      if (decision.learnMerchant === "always") {
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
          after: transactionAuditSnapshot(after),
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
  async function openAlert(input: {
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
  }) {
    const existing = await db
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
    await db.insert(financeAlerts).values({
      ...input,
      incomeStreamId: input.incomeStreamId ?? null,
      recurringObligationId: input.recurringObligationId ?? null,
      transactionId: input.transactionId ?? null,
    });
  }
  async function refreshCashflowIntelligence(userId: string) {
    const transactions = await db
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
      const existing = await db
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
          updatedAt: now(),
        };
        if (existing[0])
          await db
            .update(financeIncomeStreams)
            .set(values)
            .where(eq(financeIncomeStreams.id, existing[0].id));
        else await db.insert(financeIncomeStreams).values({ ...values, userId });
      }
      if (
        existing[0]?.status === "active" &&
        Math.abs(last.amount - existing[0].expectedAmount) > existing[0].amountTolerance
      )
        await openAlert({
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
        });
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
      const existing = await db
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
          updatedAt: now(),
        };
        if (existing[0])
          await db
            .update(financeRecurringObligations)
            .set(values)
            .where(eq(financeRecurringObligations.id, existing[0].id));
        else await db.insert(financeRecurringObligations).values({ ...values, userId });
      }
      if (
        existing[0]?.status === "active" &&
        Math.abs(last.amount - existing[0].expectedAmount) > existing[0].amountTolerance
      )
        await openAlert({
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
          type: kind === "subscription" ? "subscription_price_changed" : "recurring_amount_changed",
          userId,
        });
    }
    const [streams, obligations, openAlerts] = await Promise.all([
      db.select().from(financeIncomeStreams).where(eq(financeIncomeStreams.userId, userId)),
      db
        .select()
        .from(financeRecurringObligations)
        .where(eq(financeRecurringObligations.userId, userId)),
      db
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
            or(
              eq(financeAlerts.type, "income_missing"),
              eq(financeAlerts.type, "recurring_missing"),
            ),
          ),
        ),
    ]);
    const obsoleteAlerts = obsoleteMissingAlertIds({
      alerts: openAlerts,
      incomeStreams: streams,
      obligations,
      today,
    });
    if (obsoleteAlerts.length)
      await db
        .update(financeAlerts)
        .set({ resolvedAt: now(), status: "resolved", updatedAt: now() })
        .where(inArray(financeAlerts.id, obsoleteAlerts));
    for (const stream of streams.filter((row) => row.status === "active" && row.nextExpectedDate)) {
      if ((stream.nextExpectedDate ?? today) < today)
        await openAlert({
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
        });
    }
    for (const obligation of obligations.filter(
      (row) => row.status === "active" && row.nextExpectedDate,
    )) {
      if ((obligation.nextExpectedDate ?? today) < today)
        await openAlert({
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
        });
    }
  }
  return {
    plaidAvailable() {
      return Boolean(plaid?.clientId && plaid.secret);
    },
    async getGuidedSetupContext(userId: string): Promise<FinanceGuidedSetupContext> {
      const month = now().toISOString().slice(0, 7);
      const [
        accountRows,
        profile,
        incomeStreams,
        recurring,
        alerts,
        ledgerHealth,
        budgets,
        reviews,
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
      ]);
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
        accountSources: accountRows.map(account),
        alertSummary: {
          open: alerts.length,
          warnings: alerts.filter((item) => item.severity === "warning").length,
        },
        asOf: now().toISOString(),
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
        humanOnlyActions: [
          "connect_or_disconnect_source",
          "import_transactions",
          "manage_accounts",
          "manage_budgets",
          "manage_financial_profile",
          "refresh_provider_data",
          "confirm_ambiguous_transfer",
          "create_merchant_rule",
        ],
        ledgerHealth,
        reviewSummary: { count: reviews.length, reasons: reviewReasons },
        suggestedWorkflows: [
          workflow(
            "capture_preferences",
            "approve_each",
            "Interview for durable source meanings, thresholds, review preferences, terminology, and safety constraints.",
            true,
            "",
          ),
          workflow(
            "categorization_review",
            "approve_each",
            "Inspect ledger evidence, prepare category proposals, and apply only accepted transaction decisions.",
            categorizableReviews > 0,
            reviews.length > 0
              ? "Only ambiguous transfers currently need review; those require Finance."
              : "No categorization cases currently need review.",
          ),
          workflow(
            "recurring_review",
            "approve_each",
            "Review inferred bills and subscriptions without implying that Ilo cancelled a provider payment.",
            recurringNeedsReview > 0,
            "No inferred recurring obligations currently need review.",
          ),
          workflow(
            "alert_review",
            "approve_each",
            "Inspect alert evidence before resolving or dismissing an Ilo alert.",
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
      const response = await plaidRequest<{ link_token: string }>("/link/token/create", {
        client_name: "ilo",
        country_codes: ["US"],
        language: "en",
        link_customization_name: "default",
        products: ["transactions"],
        transactions: { days_requested: 730 },
        user: { client_user_id: userId },
      });
      return response.link_token;
    },
    async exchangePlaidToken(
      input: ExchangePlaidTokenInput,
      context: MutationContext,
    ): Promise<FinanceAccount[]> {
      const exchange = await plaidRequest<{ access_token: string; item_id: string }>(
        "/item/public_token/exchange",
        { public_token: input.publicToken },
      );
      const accountsResponse = await plaidRequest<{ accounts: PlaidAccount[] }>("/accounts/get", {
        access_token: exchange.access_token,
      });
      const config = getPlaid();
      const rows = await db.transaction(async (tx) => {
        const created: Array<typeof financeAccounts.$inferSelect> = [];
        for (const remote of accountsResponse.accounts) {
          const record = requireDatabaseRecord(
            (
              await tx
                .insert(financeAccounts)
                .values({
                  balance:
                    remote.balances.current === null
                      ? null
                      : Math.round(remote.balances.current * 100),
                  encryptedCredentials: encryptJson(
                    { accessToken: exchange.access_token },
                    config.encryptionKey,
                  ),
                  institution: input.institution ?? "Plaid",
                  lastSyncedAt: null,
                  name: remote.official_name ?? remote.name,
                  provider: "plaid",
                  providerAccountId: remote.account_id,
                  providerItemId: exchange.item_id,
                  status: "connected",
                  userId: context.principal.userId,
                })
                .onConflictDoUpdate({
                  set: {
                    balance:
                      remote.balances.current === null
                        ? null
                        : Math.round(remote.balances.current * 100),
                    encryptedCredentials: encryptJson(
                      { accessToken: exchange.access_token },
                      config.encryptionKey,
                    ),
                    name: remote.official_name ?? remote.name,
                    providerItemId: exchange.item_id,
                    status: "connected",
                    syncCursor: null,
                    updatedAt: now(),
                  },
                  target: [
                    financeAccounts.userId,
                    financeAccounts.provider,
                    financeAccounts.providerAccountId,
                  ],
                })
                .returning()
            )[0],
            "Plaid account could not be saved.",
          );
          created.push(record);
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.plaid_connected",
              after: accountAuditSnapshot(account(record)),
              before: null,
              entityId: record.id,
              entityType: "finance_account",
              ...context,
            }),
          );
        }
        return created;
      });
      return rows.map(account);
    },
    async syncPlaidAccount(id: string, context: MutationContext) {
      const before = await ownedAccount(context.principal.userId, id);
      if (
        before.provider !== "plaid" ||
        !before.providerAccountId ||
        !before.encryptedCredentials
      ) {
        throw new AppError("invalid_request", "This is not a connected Plaid account.");
      }
      const itemAccounts = await db
        .select()
        .from(financeAccounts)
        .where(
          before.providerItemId
            ? and(
                eq(financeAccounts.userId, context.principal.userId),
                eq(financeAccounts.provider, "plaid"),
                eq(financeAccounts.providerItemId, before.providerItemId),
              )
            : eq(financeAccounts.id, before.id),
        );
      const syncAccount = itemAccounts.find((row) => row.encryptedCredentials) ?? before;
      const config = getPlaid();
      const credentials = decryptJson<PlaidCredentials>(
        syncAccount.encryptedCredentials as EncryptedCredentials,
        config.encryptionKey,
      );
      const accountsByProviderId = new Map(
        itemAccounts.flatMap((row) =>
          row.providerAccountId ? [[row.providerAccountId, row]] : [],
        ),
      );
      const itemAccountIds = itemAccounts.map((row) => row.id);
      let cursor = syncAccount.syncCursor;
      let hasMore = true;
      let changed = 0;
      while (hasMore) {
        const page = await plaidRequest<{
          added: PlaidTransaction[];
          has_more: boolean;
          modified: PlaidTransaction[];
          next_cursor: string;
          removed: Array<{ transaction_id: string }>;
          transactions_update_status?:
            | "NOT_READY"
            | "INITIAL_UPDATE_COMPLETE"
            | "HISTORICAL_UPDATE_COMPLETE";
        }>("/transactions/sync", {
          access_token: credentials.accessToken,
          cursor,
          count: 500,
        });
        const classified = await Promise.all(
          [...page.added, ...page.modified].map(async (remote) => {
            const merchant = remote.merchant_name ?? remote.name;
            const learned = await learnedCategory(context.principal.userId, merchant);
            return {
              automatic: learned ? categorization(merchant, learned) : null,
              merchant,
              remote,
            };
          }),
        );
        await db.transaction(async (tx) => {
          for (const { automatic, merchant, remote } of classified) {
            const localAccount = accountsByProviderId.get(remote.account_id);
            if (!localAccount) continue;
            const providerCategory = remote.personal_finance_category;
            const inferred = isRentMerchant(merchant)
              ? categorization(merchant)
              : (automatic ??
                (providerCategory?.primary
                  ? {
                      category: providerCategory.primary,
                      confidence: (() => {
                        const confidence = providerConfidence(providerCategory.confidence_level);
                        return confidence === null ? null : Math.round(confidence * 10_000);
                      })(),
                      needsReview: providerNeedsReview(providerCategory.confidence_level),
                    }
                  : categorization(merchant)));
            const isTransfer =
              !isRentMerchant(merchant) &&
              (isSoFiVaultTransfer(merchant) || isProviderTransfer(inferred.category));
            const merchantRecord = await merchantFor(
              context.principal.userId,
              merchant,
              "provider",
            );
            const categoryRecord = isTransfer
              ? await categoryForName(context.principal.userId, transferCategory)
              : inferred.category
                ? await categoryForName(context.principal.userId, inferred.category)
                : null;
            await tx
              .insert(financeTransactions)
              .values({
                accountId: localAccount.id,
                amount: Math.round(Math.abs(remote.amount) * 100),
                category: isTransfer ? transferCategory : inferred.category,
                categoryId: categoryRecord?.id ?? null,
                categoryConfidence: inferred.confidence,
                categorySource: automatic ? "rule" : providerCategory?.primary ? "provider" : null,
                direction: isTransfer ? "transfer" : remote.amount < 0 ? "income" : "expense",
                merchant,
                merchantId: merchantRecord.id,
                needsReview: isTransfer ? !isSoFiVaultTransfer(merchant) : inferred.needsReview,
                pending: remote.pending ?? false,
                pendingTransactionId: remote.pending_transaction_id ?? null,
                providerCategory: providerCategory?.primary ?? null,
                providerCategoryDetailed: providerCategory?.detailed ?? null,
                providerCategoryConfidence: providerCategory?.confidence_level ?? null,
                providerTransactionId: remote.transaction_id,
                reconciliationStatus: isSoFiVaultTransfer(merchant)
                  ? "confirmed"
                  : isTransfer
                    ? "candidate"
                    : "not_applicable",
                transactionDate: remote.date,
                userId: context.principal.userId,
              })
              .onConflictDoUpdate({
                set: {
                  amount: Math.round(Math.abs(remote.amount) * 100),
                  category: isTransfer ? transferCategory : inferred.category,
                  categoryId: categoryRecord?.id ?? null,
                  categoryConfidence: inferred.confidence,
                  categorySource: isTransfer
                    ? "rule"
                    : automatic
                      ? "rule"
                      : providerCategory?.primary
                        ? "provider"
                        : null,
                  direction: isTransfer ? "transfer" : remote.amount < 0 ? "income" : "expense",
                  merchant,
                  needsReview: isTransfer ? !isSoFiVaultTransfer(merchant) : inferred.needsReview,
                  pending: remote.pending ?? false,
                  pendingTransactionId: remote.pending_transaction_id ?? null,
                  providerCategory: providerCategory?.primary ?? null,
                  providerCategoryDetailed: providerCategory?.detailed ?? null,
                  providerCategoryConfidence: providerCategory?.confidence_level ?? null,
                  reconciliationStatus: isSoFiVaultTransfer(merchant)
                    ? "confirmed"
                    : isTransfer
                      ? "candidate"
                      : "not_applicable",
                  transactionDate: remote.date,
                  updatedAt: now(),
                },
                target: [financeTransactions.accountId, financeTransactions.providerTransactionId],
              });
            changed += 1;
          }
          for (const removed of page.removed) {
            await tx
              .delete(financeTransactions)
              .where(
                and(
                  inArray(financeTransactions.accountId, itemAccountIds),
                  eq(financeTransactions.providerTransactionId, removed.transaction_id),
                ),
              );
            changed += 1;
          }
          await tx
            .update(financeAccounts)
            .set({
              lastSyncedAt:
                page.transactions_update_status === "NOT_READY" ? before.lastSyncedAt : now(),
              syncCursor: page.next_cursor,
              updatedAt: now(),
            })
            .where(inArray(financeAccounts.id, itemAccountIds));
        });
        cursor = page.next_cursor;
        hasMore = page.has_more;
      }
      const reconciliation = await reconcileBudgetTransfers(context.principal.userId);
      await refreshCashflowIntelligence(context.principal.userId);
      await db.insert(auditEvents).values(
        auditValues({
          action: "finance.plaid_synced",
          after: { ...reconciliation, changed },
          before: null,
          entityId: before.id,
          entityType: "finance_account",
          ...context,
        }),
      );
      return { changed };
    },
    async syncDuePlaidAccounts(maxAgeMinutes = 360) {
      if (!plaid?.clientId || !plaid.secret) return { failed: 0, reasons: [], synced: 0 };
      const cutoff = new Date(now().getTime() - maxAgeMinutes * 60 * 1000);
      const dueAccounts = await db
        .select({
          id: financeAccounts.id,
          providerItemId: financeAccounts.providerItemId,
          userId: financeAccounts.userId,
        })
        .from(financeAccounts)
        .where(
          and(
            eq(financeAccounts.provider, "plaid"),
            or(isNull(financeAccounts.lastSyncedAt), lt(financeAccounts.lastSyncedAt, cutoff)),
          ),
        );
      let failed = 0;
      const reasons = new Set<string>();
      const syncedItems = new Set<string>();
      let synced = 0;
      for (const due of dueAccounts) {
        const itemKey = due.providerItemId ?? due.id;
        if (syncedItems.has(itemKey)) continue;
        syncedItems.add(itemKey);
        try {
          await this.syncPlaidAccount(due.id, {
            principal: {
              actorId: due.userId,
              actorType: "user",
              scopes: new Set(["finances:read", "finances:write"]),
              userId: due.userId,
            },
            requestId: `scheduler:finance:${due.id}:${now().toISOString()}`,
          });
          synced += 1;
        } catch (error) {
          failed += 1;
          reasons.add(error instanceof Error ? error.message : "Unknown sync error.");
        }
      }
      return { failed, reasons: [...reasons], synced };
    },
    async reconcileTransfers(userId: string) {
      return reconcileBudgetTransfers(userId);
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
    async listCategories(userId: string) {
      return (await existingCategories(userId)).map(categoryValue);
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
      const source = await ownedMerchant(context.principal.userId, input.sourceMerchantId);
      const target = await ownedMerchant(context.principal.userId, input.targetMerchantId);
      await db.transaction(async (tx) => {
        await tx
          .update(financeMerchantAliases)
          .set({ merchantId: target.id, updatedAt: now() })
          .where(eq(financeMerchantAliases.merchantId, source.id));
        await tx
          .update(financeTransactions)
          .set({ merchantId: target.id, updatedAt: now() })
          .where(eq(financeTransactions.merchantId, source.id));
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
      });
      return merchant(target);
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
      const conditions = [eq(financeTransactions.userId, userId)];
      const sortBy = query.sortBy ?? "date";
      const sortDirection = query.sortDirection ?? "desc";
      if (query.accountId) conditions.push(eq(financeTransactions.accountId, query.accountId));
      if (query.categoryId) conditions.push(eq(financeTransactions.categoryId, query.categoryId));
      if (query.from) conditions.push(gte(financeTransactions.transactionDate, query.from));
      if (query.to) conditions.push(lte(financeTransactions.transactionDate, query.to));
      if (query.pending !== undefined)
        conditions.push(eq(financeTransactions.pending, query.pending));
      if (query.review === "needs_review")
        conditions.push(eq(financeTransactions.needsReview, true));
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
      const rows = await db
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
      return {
        items: await Promise.all(page.map(enrichTransaction)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeTransactionCursor(last, sortBy, sortDirection)
            : null,
      };
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
      const transactions = await this.listTransactions(userId, {
        ...query,
        review: "needs_review",
      });
      return {
        items: await Promise.all(
          transactions.items.map((item) => categorizationProposal(userId, item)),
        ),
        nextCursor: transactions.nextCursor,
      };
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
      if (context.principal.actorType === "agent" && input.action === "not_purchase") {
        throw new AppError(
          "forbidden",
          "Confirming an ambiguous transfer requires an interactive user session.",
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
      const current = await ownedTransaction(context.principal.userId, review.transactionId);
      const categoryId =
        input.action === "approve"
          ? (current.categoryId ?? review.suggestedCategoryId)
          : input.action === "not_purchase"
            ? (await categoryForName(context.principal.userId, "Transfers")).id
            : input.categoryId;
      if (!categoryId)
        throw new AppError("invalid_request", "Choose a category before resolving this review.");
      const result = await applyCategorization(
        {
          categoryId,
          confidence: context.principal.actorType === "agent" ? (input.confidence ?? 0) : 1,
          expectedTransactionUpdatedAt:
            context.principal.actorType === "agent"
              ? (input.expectedTransactionUpdatedAt ?? "")
              : current.updatedAt.toISOString(),
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
        input.action === "not_purchase"
          ? { auditAction: "finance.transfer_confirmed", direction: "transfer" }
          : {},
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
      await ensureCategories(context.principal.userId);
      const row = await db.transaction(async (tx) => {
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
      const actorSource = context.principal.actorType;
      const merchantRecord = await merchantFor(
        context.principal.userId,
        input.merchant,
        actorSource,
      );
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
                  input.category === null ? (automatic.category ? "rule" : null) : actorSource,
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
            outcome: actorSource === "user" ? "confirmed" : "applied",
            rationale:
              actorSource === "user"
                ? "Categorized directly by the user."
                : "Categorized through a scoped agent action.",
            source: actorSource,
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
        const [before] = await tx
          .select()
          .from(financeAccounts)
          .where(
            and(eq(financeAccounts.id, id), eq(financeAccounts.userId, context.principal.userId)),
          )
          .for("update")
          .limit(1);
        if (!before) throw new AppError("not_found", "The financial account was not found.");
        const [profile] = await tx
          .select({ sourceContexts: domainProfiles.sourceContexts })
          .from(domainProfiles)
          .where(
            and(
              eq(domainProfiles.userId, context.principal.userId),
              eq(domainProfiles.domain, "finances"),
            ),
          )
          .for("update")
          .limit(1);
        if (profile?.sourceContexts.some((source) => source.sourceId === before.id)) {
          throw new AppError(
            "conflict",
            "Remove this account from the Finance agent profile before deleting it.",
          );
        }
        await tx.delete(financeAccounts).where(eq(financeAccounts.id, before.id));
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
        accounts: accounts.map(account),
        budgets: budgets.map(budget),
        reviewCount: scopedTransactions.filter((item) => item.needsReview).length,
        pendingSpendThisMonth: pendingSpend / 100,
        refundCreditsThisMonth: refunds / 100,
        spendingThisMonth: spending / 100,
        transactions: await Promise.all(transactions.map(enrichTransaction)),
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
        staleAccounts: accounts.filter(
          (account) =>
            account.status === "connected" &&
            (!account.lastSyncedAt || account.lastSyncedAt.getTime() < cutoff),
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
        existingCategories(userId),
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
        accounts: accounts.map(account),
        alerts,
        asOf: now().toISOString(),
        budgets: budgets.map(budget),
        categories: categories.map(categoryValue),
        incomeStreams,
        profile,
        recurringObligations,
        transactions: await Promise.all(transactions.map(enrichTransaction)),
      };
    },
    async updateTransaction(
      id: string,
      input: UpdateFinanceTransactionInput,
      context: MutationContext,
    ) {
      const before = await ownedTransaction(context.principal.userId, id);
      if (
        context.principal.actorType === "agent" &&
        (input.learnMerchant === true || input.category !== undefined)
      ) {
        throw new AppError(
          "forbidden",
          "Direct category edits and merchant rules require an interactive user session.",
        );
      }
      const actorSource = context.principal.actorType;
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
                      : actorSource === "user"
                        ? "Categorized directly by the user."
                        : "Categorized through a scoped agent action.",
                categorySource: input.category === undefined ? undefined : actorSource,
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
          if (input.category === null) {
            await tx
              .delete(financeCategoryRules)
              .where(
                and(
                  eq(financeCategoryRules.userId, context.principal.userId),
                  eq(financeCategoryRules.merchantNormalized, normalizedMerchant(current.merchant)),
                ),
              );
          } else {
            await tx.insert(financeClassificationDecisions).values({
              categoryId: categoryRecord?.id ?? null,
              categoryName: input.category,
              confidence: 10_000,
              merchantId: current.merchantId,
              outcome:
                actorSource === "agent"
                  ? "applied"
                  : current.categoryId !== null && current.categoryId !== categoryRecord?.id
                    ? "corrected"
                    : "confirmed",
              rationale:
                actorSource === "user"
                  ? "Categorized directly by the user."
                  : "Categorized through a scoped agent action.",
              source: actorSource,
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
          if (input.category !== null && input.learnMerchant === true) {
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
