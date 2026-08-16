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
};

export type PlaidAccountSnapshot = {
  accountId: string;
  balanceCurrent: number | null;
  currencyCode: string | null;
  name: string;
  officialName: string | null;
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

export type PlaidConnector = {
  validateCredentials(): Promise<void>;
  createLinkToken(input: PlaidLinkTokenInput): Promise<string>;
  exchangePublicToken(publicToken: string): Promise<string>;
  getAccounts(accessToken: string): Promise<PlaidAccountSnapshot[]>;
  syncTransactions(input: {
    accessToken: string;
    cursor: string | null;
  }): Promise<PlaidTransactionPage>;
};

type PlaidConnectorOptions = {
  clientId: string;
  environment: "sandbox" | "development" | "production";
  fetch?: typeof globalThis.fetch;
  secret: string;
};

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
  official_name: z.string().nullable(),
});
const transactionSchema = z.object({
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

function transportFailure(): ConnectorError {
  return new ConnectorError({
    category: "transport",
    code: "plaid_transport_failure",
    disposition: "retry",
    message: "Plaid is temporarily unavailable.",
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

export function createPlaidConnector(options: PlaidConnectorOptions): PlaidConnector {
  const baseUrl = `https://${options.environment}.plaid.com`;

  async function plaidRequest(path: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await providerFetch(options.fetch ?? globalThis.fetch, `${baseUrl}${path}`, {
        body: JSON.stringify({ client_id: options.clientId, secret: options.secret, ...body }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } catch {
      throw transportFailure();
    }
    if (!response.ok) throw await connectorHttpError(response, "plaid");
    try {
      return await response.json();
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
    async validateCredentials() {
      await plaidRequest("/institutions/get", {
        count: 1,
        country_codes: ["US"],
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
          products: input.products,
          transactions: { days_requested: input.transactions.daysRequested },
          user: { client_user_id: input.userId },
        }),
      );
      return value.link_token;
    },
    async exchangePublicToken(publicToken) {
      const value = parse(
        z.object({ access_token: z.string().min(1) }),
        await plaidRequest("/item/public_token/exchange", { public_token: publicToken }),
      );
      return value.access_token;
    },
    async getAccounts(accessToken) {
      const value = parse(
        z.object({ accounts: z.array(accountSchema) }),
        await plaidRequest("/accounts/get", { access_token: accessToken }),
      );
      return value.accounts.map((account) => ({
        accountId: account.account_id,
        balanceCurrent: account.balances.current,
        currencyCode: account.balances.iso_currency_code ?? null,
        name: account.name,
        officialName: account.official_name,
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
