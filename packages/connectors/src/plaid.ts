import {
  type FinanceInstitutionBranding,
  financeInstitutionBrandingSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { ConnectorError, connectorHttpError } from "./failures.js";
import { providerFetch } from "./http.js";

export type PlaidLinkTokenInput = {
  clientName: string;
  countryCodes: readonly string[];
  language: string;
  linkCustomizationName: string;
  products: readonly string[];
  transactions: { daysRequested: number };
  userId: string;
  accessToken?: string;
};

export type PlaidItemToken = { accessToken: string; itemId: string };
export type PlaidItemSnapshot = { itemId: string; institutionId?: string | null };

export type PlaidAccountSnapshot = {
  accountId: string;
  balanceCurrent: number | null;
  currencyCode: string | null;
  name: string;
  mask?: string | null;
  institutionId?: string | null;
  officialName: string | null;
  persistentAccountId?: string | null;
  /** Always populated by the real connector; optional only for injected test connectors. */
  subtype?: string | null;
  /** Always populated by the real connector; optional only for injected test connectors. */
  type?: "depository" | "investment" | "brokerage" | "credit" | "loan" | "other";
};

export type PlaidTransactionSnapshot = {
  accountId: string;
  amount: number;
  currencyCode: string | null;
  date: string;
  merchantName: string | null;
  name: string;
  pending: boolean;
  pendingTransactionId: string | null;
  personalFinanceCategory: {
    confidenceLevel: "HIGH" | "LOW" | "MEDIUM" | "UNKNOWN" | "VERY_HIGH" | null;
    detailed: string | null;
    primary: string;
  } | null;
  transactionId: string;
};

export type PlaidTransactionPage = {
  added: PlaidTransactionSnapshot[];
  hasMore: boolean;
  modified: PlaidTransactionSnapshot[];
  nextCursor: string;
  removed: Array<{ transactionId: string }>;
  transactionsUpdateStatus:
    | "NOT_READY"
    | "INITIAL_UPDATE_COMPLETE"
    | "HISTORICAL_UPDATE_COMPLETE"
    | null;
};

/** Read-only evidence for exact IDs in a bounded provider-available window, not an atomic snapshot. */
export type PlaidTransactionHistoryInput = {
  accessToken: string;
  itemId: string;
  startDate: string;
  endDate: string;
  targets: readonly { accountId: string; transactionId: string }[];
  signal?: AbortSignal;
};
export type PlaidTransactionHistoryEntry = {
  accountId: string;
  transactionId: string;
  status: "found" | "missing" | "unobserved" | "conflict" | "invalid_currency";
  sourceAmount: number | null;
  normalizedAmount: number | null;
  economicDirection: "inflow" | "outflow" | "unknown" | null;
  currencyCode: string | null;
  date: string | null;
};
type HistoryReason =
  | "exhausted"
  | "page_limit"
  | "changed_total"
  | "inconsistent_page"
  | "duplicate_identity"
  | "identity_mismatch"
  | "not_initialized"
  | "byte_limit"
  | "aborted"
  | "deadline"
  | "provider_error"
  | "invalid_response";
export type PlaidTransactionHistoryEvidence = {
  observedAt: string;
  providerUpdatedAt: string | null;
  snapshotConsistency: "not_atomic";
  entries: PlaidTransactionHistoryEntry[];
  coverage: {
    state: "complete" | "partial" | "conflict" | "unavailable";
    scope: "provider_available_window";
    reason: HistoryReason;
    pages: number;
    returnedTransactions: number;
  };
};

export type PlaidConnector = {
  readTransactionHistory?(
    input: PlaidTransactionHistoryInput,
  ): Promise<PlaidTransactionHistoryEvidence>;
  validateCredentials(): Promise<void>;
  createLinkToken(input: PlaidLinkTokenInput): Promise<string>;
  createHostedLink?(
    input: PlaidLinkTokenInput,
  ): Promise<{ linkToken: string; url: string; expiresAt: string }>;
  getHostedLinkResult?(linkToken: string): Promise<{
    publicTokens: string[];
    institutions?: Record<string, string>;
    accountMetadata?: Record<
      string,
      {
        institutionId?: string | null;
        accounts: Array<{ name: string; mask?: string | null }>;
      }
    >;
  }>;
  exchangePublicToken(publicToken: string): Promise<PlaidItemToken>;
  getItem(accessToken: string): Promise<PlaidItemSnapshot>;
  getInstitutionBranding?(institutionId: string): Promise<FinanceInstitutionBranding>;
  getAccounts(accessToken: string): Promise<PlaidAccountSnapshot[]>;
  syncTransactions(input: {
    accessToken: string;
    cursor: string | null;
  }): Promise<PlaidTransactionPage>;
};

type PlaidConnectorOptions = {
  clientId: string;
  countryCodes?: readonly string[];
  environment: "sandbox" | "development" | "production";
  fetch?: typeof globalThis.fetch;
  secret: string;
};

const institutionIdSchema = z.string().max(256).trim().min(1).nullish();
const accountSchema = z.object({
  account_id: z.string().min(1),
  balances: z.object({
    current: z.number().nullable(),
    iso_currency_code: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .nullable()
      .optional(),
  }),
  name: z.string(),
  mask: z.string().max(32).trim().min(1).nullish(),
  official_name: z.string().nullable(),
  persistent_account_id: z.string().max(256).trim().min(1).nullish(),
  subtype: z.string().nullable(),
  type: z.enum(["depository", "investment", "brokerage", "credit", "loan", "other"]),
});
const transactionSchema = z
  .object({
    account_id: z.string().min(1),
    amount: z.number(),
    iso_currency_code: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .nullable()
      .optional(),
    date: z.string().min(1),
    merchant_name: z.string().nullable(),
    name: z.string(),
    pending: z.boolean().default(false),
    pending_transaction_id: z.string().nullable().optional(),
    personal_finance_category: z
      .object({
        confidence_level: z
          .enum(["HIGH", "LOW", "MEDIUM", "UNKNOWN", "VERY_HIGH"])
          .nullable()
          .optional(),
        detailed: z.string().nullable().optional(),
        primary: z.string(),
      })
      .nullable(),
    transaction_id: z.string().min(1),
  })
  .refine((transaction) => transaction.pending_transaction_id !== transaction.transaction_id, {
    path: ["pending_transaction_id"],
  });
const transactionPageSchema = z.object({
  added: z.array(transactionSchema),
  has_more: z.boolean(),
  modified: z.array(transactionSchema),
  next_cursor: z.string(),
  removed: z.array(z.object({ transaction_id: z.string().min(1) })),
  transactions_update_status: z
    .enum(["NOT_READY", "INITIAL_UPDATE_COMPLETE", "HISTORICAL_UPDATE_COMPLETE"])
    .optional(),
});

function transportFailure(transportCause: unknown): ConnectorError {
  return new ConnectorError({
    category: "transport",
    code: "plaid_transport_failure",
    disposition: "retry",
    message: "Plaid is temporarily unavailable.",
    transportCause,
  });
}

function invalidResponse(): ConnectorError {
  return new ConnectorError({
    category: "invalid_response",
    code: "plaid_invalid_response",
    disposition: "retry",
    message: "Plaid returned an invalid response.",
  });
}

async function isInvalidCursorResponse(response: Response): Promise<boolean> {
  if (
    response.status !== 400 ||
    !response.headers.get("content-type")?.toLowerCase().includes("application/json") ||
    !response.body
  ) {
    void response.body?.cancel().catch(() => undefined);
    return false;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let serialized = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4_096) {
        void reader.cancel().catch(() => undefined);
        return false;
      }
      serialized += decoder.decode(chunk.value, { stream: true });
    }
    serialized += decoder.decode();
    const parsed = JSON.parse(serialized) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "error_code" in parsed &&
      parsed.error_code === "INVALID_CURSOR"
    );
  } catch {
    void reader.cancel().catch(() => undefined);
    return false;
  }
}

const historyId = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value);
function historyDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
const historyRequestSchema = z
  .object({
    accessToken: z.string().min(1).max(4096),
    itemId: historyId,
    startDate: z.string().refine(historyDate),
    endDate: z.string().refine(historyDate),
    targets: z
      .array(z.object({ accountId: historyId, transactionId: historyId }))
      .min(1)
      .max(100),
  })
  .refine(
    (value) =>
      value.startDate <= value.endDate &&
      Date.parse(value.endDate) - Date.parse(value.startDate) < 366 * 86_400_000 &&
      new Set(value.targets.map((target) => target.accountId)).size <= 5 &&
      new Set(value.targets.map((target) => target.transactionId)).size === value.targets.length,
  );
const historyItemSchema = z.object({
  item: z.object({
    item_id: historyId,
    billed_products: z.array(z.string()),
    error: z.unknown().optional(),
  }),
  status: z.object({
    transactions: z.object({ last_successful_update: z.string().datetime({ offset: true }) }),
  }),
});
const historyPageSchema = z.object({
  item: z.object({ item_id: historyId }),
  accounts: z.array(z.object({ account_id: historyId })).max(5),
  transactions: z
    .array(
      z.object({
        transaction_id: historyId,
        account_id: historyId,
        amount: z.number().finite(),
        date: z.string().refine(historyDate),
        iso_currency_code: z.unknown().optional(),
      }),
    )
    .max(100),
  total_transactions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
class HistoryReadFailure extends Error {
  constructor(readonly reason: HistoryReason) {
    super(reason);
  }
}
const historyCurrencies = new Set(Intl.supportedValuesOf("currency"));

async function readHistory(
  options: PlaidConnectorOptions,
  baseUrl: string,
  rawInput: PlaidTransactionHistoryInput,
): Promise<PlaidTransactionHistoryEvidence> {
  const parsedInput = historyRequestSchema.safeParse(rawInput);
  if (!parsedInput.success)
    throw new ConnectorError({
      category: "configuration",
      code: "plaid_invalid_history_request",
      disposition: "operator",
      message: "Invalid bounded historical evidence request.",
    });
  const input = { ...parsedInput.data, signal: rawInput.signal };
  const entries: PlaidTransactionHistoryEntry[] = input.targets.map((target) => ({
    accountId: target.accountId,
    transactionId: target.transactionId,
    status: "unobserved",
    sourceAmount: null,
    normalizedAmount: null,
    economicDirection: null,
    currencyCode: null,
    date: null,
  }));
  const result: PlaidTransactionHistoryEvidence = {
    observedAt: new Date().toISOString(),
    providerUpdatedAt: null,
    snapshotConsistency: "not_atomic",
    entries,
    coverage: {
      state: "unavailable",
      scope: "provider_available_window",
      reason: "provider_error",
      pages: 0,
      returnedTransactions: 0,
    },
  };
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 15_000);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline.signal]) : deadline.signal;
  const abortFailure = () => new HistoryReadFailure(input.signal?.aborted ? "aborted" : "deadline");
  // Race both fetch and body reads: injected transports need not honor AbortSignal.
  async function bounded<T>(operation: () => Promise<T>): Promise<T> {
    if (signal.aborted) throw abortFailure();
    let onAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortFailure());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([operation(), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  let aggregateBytes = 0;
  async function request(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await bounded(async () => {
      const value = await (options.fetch ?? globalThis.fetch)(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({ client_id: options.clientId, secret: options.secret, ...body }),
      });
      if (signal.aborted) {
        void value.body?.cancel().catch(() => undefined);
        throw abortFailure();
      }
      return value;
    });
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      throw new HistoryReadFailure("provider_error");
    }
    const reader = response.body.getReader();
    let bytes = 0;
    let serialized = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await bounded(() => reader.read());
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        aggregateBytes += chunk.value.byteLength;
        if (bytes > 131_072 || aggregateBytes > 524_288) throw new HistoryReadFailure("byte_limit");
        serialized += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(serialized + decoder.decode()) as unknown;
    } catch (error) {
      if (error instanceof HistoryReadFailure) throw error;
      throw new HistoryReadFailure("invalid_response");
    } finally {
      void reader.cancel().catch(() => undefined);
    }
  }
  const accountIds = [...new Set(input.targets.map((target) => target.accountId))];
  const targets = new Map(entries.map((entry) => [entry.transactionId, entry]));
  const seen = new Set<string>();
  let conflict = false;
  try {
    const metadata = historyItemSchema.safeParse(
      await request("/item/get", { access_token: input.accessToken }),
    );
    if (
      !metadata.success ||
      metadata.data.item.item_id !== input.itemId ||
      metadata.data.item.error != null ||
      !metadata.data.item.billed_products.includes("transactions")
    ) {
      throw new HistoryReadFailure("not_initialized");
    }
    result.providerUpdatedAt = metadata.data.status.transactions.last_successful_update;
    let total: number | undefined;
    for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
      const parsed = historyPageSchema.safeParse(
        await request("/transactions/get", {
          access_token: input.accessToken,
          start_date: input.startDate,
          end_date: input.endDate,
          options: {
            account_ids: accountIds,
            count: 100,
            offset: result.coverage.returnedTransactions,
          },
        }),
      );
      if (!parsed.success) throw new HistoryReadFailure("invalid_response");
      const page = parsed.data;
      if (
        page.item.item_id !== input.itemId ||
        accountIds.some((id) => !page.accounts.some((account) => account.account_id === id)) ||
        page.accounts.some((account) => !accountIds.includes(account.account_id)) ||
        page.transactions.some(
          (tx) =>
            !accountIds.includes(tx.account_id) ||
            tx.date < input.startDate ||
            tx.date > input.endDate,
        )
      ) {
        throw new HistoryReadFailure("identity_mismatch");
      }
      result.coverage.pages++;
      if (total !== undefined && total !== page.total_transactions) {
        result.coverage.state = "conflict";
        result.coverage.reason = "changed_total";
        return result;
      }
      total = page.total_transactions;
      const offset = result.coverage.returnedTransactions;
      if (
        offset + page.transactions.length > total ||
        (page.transactions.length < 100 && offset + page.transactions.length < total)
      ) {
        result.coverage.state = "conflict";
        result.coverage.reason = "inconsistent_page";
        return result;
      }
      result.coverage.returnedTransactions += page.transactions.length;
      for (const tx of page.transactions) {
        const entry = targets.get(tx.transaction_id);
        const duplicate = seen.has(tx.transaction_id);
        seen.add(tx.transaction_id);
        if (duplicate || (entry && entry.accountId !== tx.account_id)) {
          conflict = true;
          if (entry)
            Object.assign(entry, {
              status: "conflict",
              sourceAmount: null,
              normalizedAmount: null,
              economicDirection: null,
              currencyCode: null,
              date: null,
            });
          continue;
        }
        if (!entry) continue;
        const currency =
          typeof tx.iso_currency_code === "string" && historyCurrencies.has(tx.iso_currency_code)
            ? tx.iso_currency_code
            : null;
        Object.assign(entry, {
          status: currency ? "found" : "invalid_currency",
          sourceAmount: tx.amount,
          normalizedAmount: currency ? Math.abs(tx.amount) : null,
          economicDirection: tx.amount === 0 ? "unknown" : tx.amount < 0 ? "inflow" : "outflow",
          currencyCode: currency,
          date: tx.date,
        });
      }
      if (conflict) {
        result.coverage.state = "conflict";
        result.coverage.reason = "duplicate_identity";
        return result;
      }
      if (result.coverage.returnedTransactions === total) {
        result.coverage.state = "complete";
        result.coverage.reason = "exhausted";
        for (const entry of entries) if (entry.status === "unobserved") entry.status = "missing";
        return result;
      }
    }
    result.coverage.state = "partial";
    result.coverage.reason = "page_limit";
  } catch (error) {
    const reason = signal.aborted
      ? abortFailure().reason
      : error instanceof HistoryReadFailure
        ? error.reason
        : "provider_error";
    result.coverage.reason = reason;
    result.coverage.state = result.coverage.returnedTransactions ? "partial" : "unavailable";
    if (reason === "identity_mismatch") {
      result.coverage.state = "unavailable";
      for (const entry of entries)
        Object.assign(entry, {
          status: "unobserved",
          sourceAmount: null,
          normalizedAmount: null,
          economicDirection: null,
          currencyCode: null,
          date: null,
        });
    }
  } finally {
    clearTimeout(timer);
  }
  return result;
}

export function createPlaidConnector(options: PlaidConnectorOptions): PlaidConnector {
  const baseUrl = `https://${options.environment}.plaid.com`;

  async function plaidRequest(
    path: string,
    body: Record<string, unknown>,
    maxBytes?: number,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await providerFetch(options.fetch ?? globalThis.fetch, `${baseUrl}${path}`, {
        body: JSON.stringify({ client_id: options.clientId, secret: options.secret, ...body }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } catch (error) {
      throw transportFailure(error);
    }
    if (!response.ok) {
      if (await isInvalidCursorResponse(response.clone())) {
        await response.body?.cancel().catch(() => undefined);
        throw new ConnectorError({
          category: "rejected",
          code: "plaid_invalid_cursor",
          disposition: "retry",
          message: "Plaid requires a controlled transaction replay.",
          status: response.status,
        });
      }
      throw await connectorHttpError(response, "plaid");
    }
    try {
      if (!maxBytes) return await response.json();
      const reader = response.body?.getReader();
      if (!reader) throw invalidResponse();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > maxBytes) throw invalidResponse();
          chunks.push(part.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch {
      throw invalidResponse();
    }
  }

  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw invalidResponse();
    return parsed.data;
  }

  function transaction(value: z.infer<typeof transactionSchema>): PlaidTransactionSnapshot {
    return {
      accountId: value.account_id,
      amount: value.amount,
      currencyCode: value.iso_currency_code ?? null,
      date: value.date,
      merchantName: value.merchant_name,
      name: value.name,
      pending: value.pending,
      pendingTransactionId: value.pending_transaction_id ?? null,
      personalFinanceCategory: value.personal_finance_category
        ? {
            confidenceLevel: value.personal_finance_category.confidence_level ?? null,
            detailed: value.personal_finance_category.detailed ?? null,
            primary: value.personal_finance_category.primary,
          }
        : null,
      transactionId: value.transaction_id,
    };
  }

  return {
    readTransactionHistory: (input) => readHistory(options, baseUrl, input),
    async validateCredentials() {
      await plaidRequest("/institutions/get", {
        count: 1,
        country_codes: options.countryCodes ?? ["US"],
        offset: 0,
      });
    },
    async createLinkToken(input) {
      const value = parse(
        z.object({ link_token: z.string().min(1) }),
        await plaidRequest("/link/token/create", {
          client_name: input.clientName,
          country_codes: input.countryCodes,
          language: input.language,
          link_customization_name: input.linkCustomizationName,
          ...(input.accessToken
            ? { access_token: input.accessToken }
            : { products: input.products }),
          ...(input.accessToken
            ? {}
            : { transactions: { days_requested: input.transactions.daysRequested } }),
          user: { client_user_id: input.userId },
        }),
      );
      return value.link_token;
    },
    async createHostedLink(input) {
      const value = parse(
        z.object({
          link_token: z.string().min(1),
          hosted_link_url: z.url(),
          expiration: z.iso.datetime(),
        }),
        await plaidRequest("/link/token/create", {
          client_name: input.clientName,
          country_codes: input.countryCodes,
          language: input.language,
          link_customization_name: input.linkCustomizationName,
          ...(input.accessToken
            ? { access_token: input.accessToken }
            : { products: input.products }),
          ...(input.accessToken
            ? {}
            : { transactions: { days_requested: input.transactions.daysRequested } }),
          user: { client_user_id: input.userId },
          hosted_link: { url_lifetime_seconds: 1800 },
        }),
      );
      const url = new URL(value.hosted_link_url);
      if (
        url.origin !== "https://secure.plaid.com" ||
        url.username ||
        url.password ||
        !url.pathname.startsWith("/hl/")
      )
        throw new ConnectorError({
          message: "Plaid returned an invalid hosted authorization URL.",
          category: "invalid_response",
          code: "invalid_hosted_link",
          disposition: "operator",
        });
      return {
        linkToken: value.link_token,
        url: value.hosted_link_url,
        expiresAt: value.expiration,
      };
    },
    async getHostedLinkResult(linkToken) {
      const value = parse(
        z.object({
          link_token: z.string(),
          link_sessions: z
            .array(
              z.object({
                results: z
                  .object({
                    item_add_results: z
                      .array(
                        z.object({
                          public_token: z.string().min(1),
                          accounts: z
                            .array(
                              z.object({
                                name: z.string().max(240).trim().min(1),
                                mask: z.string().max(32).trim().min(1).nullish(),
                              }),
                            )
                            .max(100)
                            .optional(),
                          institution: z
                            .object({
                              name: z.string().trim().min(1).max(240),
                              institution_id: institutionIdSchema,
                            })
                            .nullish(),
                        }),
                      )
                      .max(100)
                      .optional(),
                  })
                  .nullable()
                  .optional(),
              }),
            )
            .max(100),
        }),
        await plaidRequest("/link/token/get", { link_token: linkToken }),
      );
      if (value.link_token !== linkToken)
        throw new ConnectorError({
          message: "Plaid returned a mismatched hosted session.",
          category: "invalid_response",
          code: "invalid_hosted_session",
          disposition: "operator",
        });
      return {
        accountMetadata: Object.fromEntries(
          value.link_sessions.flatMap((session) =>
            (session.results?.item_add_results ?? []).map((item) => [
              item.public_token,
              {
                institutionId: item.institution?.institution_id ?? null,
                accounts: (item.accounts ?? []).map((account) => ({
                  name: account.name,
                  mask: account.mask ?? null,
                })),
              },
            ]),
          ),
        ),
        institutions: Object.fromEntries(
          value.link_sessions.flatMap((session) =>
            (session.results?.item_add_results ?? []).flatMap((item) =>
              item.institution ? [[item.public_token, item.institution.name]] : [],
            ),
          ),
        ),
        publicTokens: [
          ...new Set(
            value.link_sessions.flatMap(
              (session) =>
                session.results?.item_add_results?.map((item) => item.public_token) ?? [],
            ),
          ),
        ],
      };
    },
    async exchangePublicToken(publicToken) {
      const value = parse(
        z.object({ access_token: z.string().min(1), item_id: z.string().min(1) }),
        await plaidRequest("/item/public_token/exchange", { public_token: publicToken }),
      );
      return { accessToken: value.access_token, itemId: value.item_id };
    },
    async getItem(accessToken) {
      const value = parse(
        z.object({
          item: z.object({
            item_id: z.string().min(1),
            institution_id: institutionIdSchema,
          }),
        }),
        await plaidRequest("/item/get", { access_token: accessToken }),
      );
      return { itemId: value.item.item_id, institutionId: value.item.institution_id ?? null };
    },
    async getInstitutionBranding(institutionId) {
      const value = parse(
        z.object({
          institution: z.object({
            institution_id: z.string().min(1).max(160),
            logo: z.string().max(43_950).nullable().catch(null),
            primary_color: z.string().nullable().catch(null),
            url: z.string().nullable().catch(null),
          }),
        }),
        await plaidRequest(
          "/institutions/get_by_id",
          {
            institution_id: institutionId,
            country_codes: options.countryCodes ?? ["US"],
            options: { include_optional_metadata: true },
          },
          96_000,
        ),
      );
      if (value.institution.institution_id !== institutionId) throw invalidResponse();
      const field = <T>(schema: z.ZodType<T>, value: unknown): T | null => {
        const result = schema.safeParse(value);
        return result.success ? result.data : null;
      };
      let logo = field(
        financeInstitutionBrandingSchema.shape.logo,
        value.institution.logo ? `data:image/png;base64,${value.institution.logo}` : null,
      );
      if (logo) {
        const png = Buffer.from(logo.slice("data:image/png;base64,".length), "base64");
        // Bound decoded dimensions as well as transfer size; tiny compressed input can claim huge images.
        if (
          png.length < 33 ||
          png.toString("ascii", 12, 16) !== "IHDR" ||
          png.readUInt32BE(16) < 1 ||
          png.readUInt32BE(16) > 512 ||
          png.readUInt32BE(20) < 1 ||
          png.readUInt32BE(20) > 512
        )
          logo = null;
      }
      return {
        institutionId,
        logo,
        primaryColor: field(
          financeInstitutionBrandingSchema.shape.primaryColor,
          value.institution.primary_color,
        ),
        url: field(financeInstitutionBrandingSchema.shape.url, value.institution.url),
      };
    },
    async getAccounts(accessToken) {
      const value = parse(
        z.object({
          accounts: z.array(accountSchema).min(1),
          item: z.object({ institution_id: institutionIdSchema }).nullish(),
        }),
        await plaidRequest("/accounts/get", { access_token: accessToken }),
      );
      return value.accounts.map((account) => ({
        accountId: account.account_id,
        balanceCurrent: account.balances.current,
        currencyCode: account.balances.iso_currency_code ?? null,
        mask: account.mask ?? null,
        name: account.name,
        institutionId: value.item?.institution_id ?? null,
        officialName: account.official_name,
        persistentAccountId: account.persistent_account_id ?? null,
        subtype: account.subtype,
        type: account.type,
      }));
    },
    async syncTransactions(input) {
      const value = parse(
        transactionPageSchema,
        await plaidRequest("/transactions/sync", {
          access_token: input.accessToken,
          count: 500,
          cursor: input.cursor,
        }),
      );
      return {
        added: value.added.map(transaction),
        hasMore: value.has_more,
        modified: value.modified.map(transaction),
        nextCursor: value.next_cursor,
        removed: value.removed.map((removed) => ({ transactionId: removed.transaction_id })),
        transactionsUpdateStatus: value.transactions_update_status ?? null,
      };
    },
  };
}
