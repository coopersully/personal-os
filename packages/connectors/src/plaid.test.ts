import { describe, expect, it, vi } from "vitest";
import { ConnectorError, createPlaidConnector } from "./index.js";

const historyInput = {
  accessToken: "sensitive-history-token",
  itemId: "item-1",
  startDate: "2023-01-01",
  endDate: "2023-01-31",
  targets: [{ accountId: "account-1", transactionId: "target-1" }],
};
const initializedHistoryItem = {
  item: { item_id: "item-1", billed_products: ["transactions"] },
  status: { transactions: { last_successful_update: "2026-11-01T12:00:00Z" } },
};
function historyTransaction(id = "target-1", amount = -12.5) {
  return {
    transaction_id: id,
    account_id: "account-1",
    amount,
    iso_currency_code: "USD" as unknown,
    date: "2023-01-10",
  };
}
function historyPage(transactions = [historyTransaction()], total = transactions.length) {
  return {
    item: { item_id: "item-1" },
    accounts: [{ account_id: "account-1" }],
    transactions,
    total_transactions: total,
  };
}
function historyConnector(pages: unknown[], item: unknown = initializedHistoryItem) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const connector = createPlaidConnector({
    clientId: "client",
    secret: "secret",
    environment: "sandbox",
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      requests.push({ path, body: JSON.parse(String(init?.body)) });
      return Response.json(path === "/item/get" ? item : pages.shift());
    },
  });
  return { connector, requests };
}

function historyRead(connector: ReturnType<typeof createPlaidConnector>) {
  const read = connector.readTransactionHistory;
  if (!read) throw new Error("Historical evidence reader is unavailable.");
  return read;
}

describe("bounded Plaid historical evidence", () => {
  it("reads exact linked identities with count/offset, signed evidence and separate provider freshness", async () => {
    const first = [
      historyTransaction(),
      ...Array.from({ length: 99 }, (_, i) => historyTransaction(`other-${i}`)),
    ];
    const { connector, requests } = historyConnector([
      historyPage(first, 101),
      historyPage([historyTransaction("target-2", 3)], 101),
    ]);
    const result = await historyRead(connector)({
      ...historyInput,
      targets: [
        ...historyInput.targets,
        { accountId: "account-1", transactionId: "target-2" },
        { accountId: "account-1", transactionId: "missing" },
      ],
    });
    expect(requests.map((r) => r.path)).toEqual([
      "/item/get",
      "/transactions/get",
      "/transactions/get",
    ]);
    expect(requests[1]?.body).toMatchObject({
      start_date: "2023-01-01",
      end_date: "2023-01-31",
      options: { account_ids: ["account-1"], count: 100, offset: 0 },
    });
    expect(requests[2]?.body.options).toEqual({
      account_ids: ["account-1"],
      count: 100,
      offset: 100,
    });
    expect(result.coverage).toMatchObject({
      state: "complete",
      scope: "provider_available_window",
      pages: 2,
      returnedTransactions: 101,
    });
    expect(result.providerUpdatedAt).toBe("2026-11-01T12:00:00Z");
    expect(result.entries).toMatchObject([
      {
        transactionId: "target-1",
        accountId: "account-1",
        status: "found",
        sourceAmount: -12.5,
        normalizedAmount: 12.5,
        economicDirection: "inflow",
        currencyCode: "USD",
      },
      {
        transactionId: "target-2",
        status: "found",
        sourceAmount: 3,
        normalizedAmount: 3,
        economicDirection: "outflow",
      },
      { transactionId: "missing", status: "missing", sourceAmount: null },
    ]);
    expect(result).not.toHaveProperty("accessToken");
  });

  it.each([
    { item: { item_id: "foreign", billed_products: ["transactions"] } },
    { item: { item_id: "item-1", billed_products: [] } },
    { item: { item_id: "item-1", products: ["transactions"] } },
    { ...initializedHistoryItem, status: { transactions: { last_successful_update: null } } },
  ])("does not initialize Transactions when prior Item/initialization evidence is unavailable", async (item) => {
    const { connector, requests } = historyConnector([], item);
    const result = await historyRead(connector)(historyInput);
    expect(requests.map((r) => r.path)).toEqual(["/item/get"]);
    expect(result.coverage.state).toBe("unavailable");
    expect(result.entries[0]?.status).toBe("unobserved");
  });

  it.each([
    undefined,
    null,
    "usd",
    "ZZZ",
    "XXX",
  ])("holds missing or invalid explicit currency %s without account defaults", async (currency) => {
    const { connector } = historyConnector([
      historyPage([{ ...historyTransaction(), iso_currency_code: currency }]),
    ]);
    const result = await historyRead(connector)(historyInput);
    expect(result.entries[0]).toMatchObject({
      status: "invalid_currency",
      sourceAmount: -12.5,
      currencyCode: null,
      normalizedAmount: null,
    });
  });

  it("does not echo unknown target fields into evidence", async () => {
    const { connector } = historyConnector([historyPage()]);
    const targets = [
      { accountId: "account-1", transactionId: "target-1", accessToken: "target-secret-canary" },
    ];
    const result = await historyRead(connector)({ ...historyInput, targets });
    expect(result.entries[0]?.status).toBe("found");
    expect(JSON.stringify(result)).not.toContain("target-secret-canary");
    expect(result.entries[0]).not.toHaveProperty("accessToken");
  });

  it("does not infer direction for a zero source amount", async () => {
    const { connector } = historyConnector([historyPage([historyTransaction("target-1", 0)])]);
    expect((await historyRead(connector)(historyInput)).entries[0]).toMatchObject({
      sourceAmount: 0,
      economicDirection: "unknown",
    });
  });

  it.each([
    { ...historyPage(), item: { item_id: "foreign" } },
    { ...historyPage(), accounts: [{ account_id: "foreign" }] },
    historyPage([{ ...historyTransaction(), account_id: "foreign" }]),
    historyPage([{ ...historyTransaction(), date: "2022-12-31" }]),
  ])("rejects a changed Item/account/window without accepting foreign evidence", async (page) => {
    const { connector } = historyConnector([page]);
    const result = await historyRead(connector)(historyInput);
    expect(result.coverage.state).toBe("unavailable");
    expect(result.entries[0]).toMatchObject({ status: "unobserved", sourceAmount: null });
  });

  it("holds conflicting duplicate exact IDs rather than choosing a value", async () => {
    const { connector } = historyConnector([
      historyPage([historyTransaction(), historyTransaction("target-1", 99)]),
    ]);
    const result = await historyRead(connector)(historyInput);
    expect(result.coverage.state).toBe("conflict");
    expect(result.entries[0]).toMatchObject({ status: "conflict", sourceAmount: null });
  });

  it("labels capped history partial and absent targets unobserved, never missing", async () => {
    const pages = Array.from({ length: 5 }, (_, page) =>
      historyPage(
        Array.from({ length: 100 }, (_, i) => historyTransaction(`other-${page}-${i}`)),
        501,
      ),
    );
    const { connector, requests } = historyConnector(pages);
    const result = await historyRead(connector)(historyInput);
    expect(result.coverage).toMatchObject({
      state: "partial",
      reason: "page_limit",
      pages: 5,
      returnedTransactions: 500,
    });
    expect(result.entries[0]?.status).toBe("unobserved");
    expect(requests).toHaveLength(6);
  });

  it("reports a changing total as conflicting coverage", async () => {
    const { connector } = historyConnector([
      historyPage(
        Array.from({ length: 100 }, (_, i) => historyTransaction(`other-${i}`)),
        101,
      ),
      historyPage([historyTransaction()], 102),
    ]);
    expect((await historyRead(connector)(historyInput)).coverage).toMatchObject({
      state: "conflict",
      reason: "changed_total",
    });
  });

  it("does not call an empty short page proof of missing historical transactions", async () => {
    const { connector } = historyConnector([historyPage([], 2)]);
    const result = await historyRead(connector)(historyInput);
    expect(result.coverage).toMatchObject({ state: "conflict", reason: "inconsistent_page" });
    expect(result.entries[0]?.status).toBe("unobserved");
  });

  it("does not accept an exact transaction ID returned for a different requested account", async () => {
    const page = historyPage([{ ...historyTransaction(), account_id: "account-2" }]);
    page.accounts.push({ account_id: "account-2" });
    const { connector } = historyConnector([page]);
    const result = await historyRead(connector)({
      ...historyInput,
      targets: [...historyInput.targets, { accountId: "account-2", transactionId: "other" }],
    });
    expect(result.coverage.state).toBe("conflict");
    expect(result.entries[0]).toMatchObject({ status: "conflict", sourceAmount: null });
  });

  it.each([
    { ...historyInput, startDate: "2023-02-30" },
    { ...historyInput, endDate: "2025-01-01" },
    { ...historyInput, targets: [] },
    { ...historyInput, endDate: "2022-12-31" },
    {
      ...historyInput,
      targets: Array.from({ length: 6 }, (_, i) => ({
        accountId: `account-${i}`,
        transactionId: `tx-${i}`,
      })),
    },
    {
      ...historyInput,
      targets: [
        { accountId: "a", transactionId: "same" },
        { accountId: "b", transactionId: "same" },
      ],
    },
  ])("rejects an invalid or excessive request before any provider call", async (input) => {
    const { connector, requests } = historyConnector([]);
    await expect(historyRead(connector)(input)).rejects.toMatchObject({
      code: "plaid_invalid_history_request",
    });
    expect(requests).toEqual([]);
  });

  it("bounds an oversized response without publishing partial body or secrets", async () => {
    const connector = createPlaidConnector({
      clientId: "client",
      secret: "secret",
      environment: "sandbox",
      fetch: async () => new Response("sensitive-canary".repeat(100_000)),
    });
    const result = await historyRead(connector)(historyInput);
    expect(result.coverage).toMatchObject({ state: "unavailable", reason: "byte_limit" });
    expect(JSON.stringify(result)).not.toContain("sensitive-canary");
  });

  it("retains observed evidence as partial when a later provider request fails", async () => {
    let calls = 0;
    const connector = createPlaidConnector({
      clientId: "client",
      secret: "secret",
      environment: "sandbox",
      fetch: async () => {
        calls++;
        if (calls === 1) return Response.json(initializedHistoryItem);
        if (calls === 2)
          return Response.json(
            historyPage(
              [
                historyTransaction(),
                ...Array.from({ length: 99 }, (_, i) => historyTransaction(`other-${i}`)),
              ],
              101,
            ),
          );
        throw new Error("sensitive-provider-canary");
      },
    });
    const result = await historyRead(connector)({
      ...historyInput,
      targets: [...historyInput.targets, { accountId: "account-1", transactionId: "missing" }],
    });
    expect(result.coverage).toMatchObject({ state: "partial", reason: "provider_error", pages: 1 });
    expect(result.entries.map((entry) => entry.status)).toEqual(["found", "unobserved"]);
    expect(JSON.stringify(result)).not.toContain("sensitive-provider-canary");
  });

  it("discards earlier evidence when a later page changes Item identity", async () => {
    const { connector } = historyConnector([
      historyPage(
        [
          historyTransaction(),
          ...Array.from({ length: 99 }, (_, i) => historyTransaction(`other-${i}`)),
        ],
        101,
      ),
      { ...historyPage([historyTransaction("last")], 101), item: { item_id: "foreign" } },
    ]);
    const result = await historyRead(connector)(historyInput);
    expect(result.coverage).toMatchObject({ state: "unavailable", reason: "identity_mismatch" });
    expect(result.entries[0]).toMatchObject({ status: "unobserved", sourceAmount: null });
  });

  it("caps aggregate response bytes across individually bounded pages", async () => {
    const pages = Array.from({ length: 5 }, (_, page) => ({
      ...historyPage(
        Array.from({ length: 100 }, (_, i) => historyTransaction(`other-${page}-${i}`)),
        501,
      ),
      padding: "x".repeat(110_000),
    }));
    const { connector, requests } = historyConnector(pages);
    const result = await historyRead(connector)(historyInput);
    expect(result.coverage).toMatchObject({ state: "partial", reason: "byte_limit", pages: 4 });
    expect(result.entries[0]?.status).toBe("unobserved");
    expect(requests).toHaveLength(6);
  });

  it("does not reset the aggregate deadline between metadata and history", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const connector = createPlaidConnector({
        clientId: "client",
        secret: "secret",
        environment: "sandbox",
        fetch: async () => {
          calls++;
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          return Response.json(calls === 1 ? initializedHistoryItem : historyPage());
        },
      });
      const pending = historyRead(connector)(historyInput);
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await pending).coverage).toMatchObject({ state: "unavailable", reason: "deadline" });
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start a provider read when already aborted", async () => {
    const { connector, requests } = historyConnector([]);
    const abort = new AbortController();
    abort.abort();
    const result = await historyRead(connector)({ ...historyInput, signal: abort.signal });
    expect(result.coverage.reason).toBe("aborted");
    expect(requests).toEqual([]);
  });

  it("enforces the aggregate deadline even when an injected fetch ignores its abort signal", async () => {
    vi.useFakeTimers();
    try {
      const connector = createPlaidConnector({
        clientId: "client",
        secret: "secret",
        environment: "sandbox",
        fetch: () => new Promise<Response>(() => undefined),
      });
      const pending = historyRead(connector)(historyInput);
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await pending).coverage).toMatchObject({ state: "unavailable", reason: "deadline" });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "caller",
    "deadline",
  ] as const)("aborts a hanging response body within the aggregate budget (%s)", async (cause) => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const abort = new AbortController();
      const connector = createPlaidConnector({
        clientId: "client",
        secret: "secret",
        environment: "sandbox",
        fetch: async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
          ),
      });
      const pending = historyRead(connector)({ ...historyInput, signal: abort.signal });
      await vi.advanceTimersByTimeAsync(0);
      if (cause === "caller") abort.abort();
      else await vi.advanceTimersByTimeAsync(15_000);
      expect((await pending).coverage).toMatchObject({
        state: "unavailable",
        reason: cause === "caller" ? "aborted" : "deadline",
      });
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

const linkInput = {
  clientName: "ilo",
  countryCodes: ["US"],
  language: "en",
  linkCustomizationName: "default",
  products: ["transactions"],
  transactions: { daysRequested: 730 },
  userId: "user-1",
} as const;

async function connectorErrorFrom(operation: () => Promise<unknown>): Promise<ConnectorError> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof ConnectorError) return error;
  }
  throw new Error("Expected a ConnectorError.");
}

function assertRedactedMessage(message: string, sensitiveValues: readonly string[]): void {
  if (sensitiveValues.some((value) => message.includes(value))) {
    throw new Error("Redaction regression: connector error contains sensitive material.");
  }
}

describe("Plaid connector", () => {
  it("sends a Link token request to the configured Plaid environment and parses its token", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    const plaid = createPlaidConnector({
      clientId: "client-id",
      environment: "production",
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        return Response.json({ link_token: "link-token" });
      },
      secret: "connector-secret",
    });

    await expect(plaid.createLinkToken(linkInput)).resolves.toBe("link-token");
    expect(requestUrl).toBe("https://production.plaid.com/link/token/create");
    expect(requestBody).toEqual({
      client_id: "client-id",
      client_name: "ilo",
      country_codes: ["US"],
      language: "en",
      link_customization_name: "default",
      products: ["transactions"],
      secret: "connector-secret",
      transactions: { days_requested: 730 },
      user: { client_user_id: "user-1" },
    });
  });

  it("parses exchange, account, and incremental transaction responses", async () => {
    const plaid = createPlaidConnector({
      clientId: "client-id",
      environment: "sandbox",
      fetch: async (input, init) => {
        switch (new URL(String(input)).pathname) {
          case "/item/public_token/exchange": {
            expect(JSON.parse(String(init?.body))).toEqual({
              client_id: "client-id",
              public_token: "public-token",
              secret: "connector-secret",
            });
            return Response.json({ access_token: "access-token", item_id: "item-1" });
          }
          case "/item/get": {
            expect(JSON.parse(String(init?.body))).toEqual({
              access_token: "access-token",
              client_id: "client-id",
              secret: "connector-secret",
            });
            return Response.json({ item: { item_id: "item-1" } });
          }
          case "/accounts/get":
            return Response.json({
              accounts: [
                {
                  account_id: "account-1",
                  balances: { current: 12.5, iso_currency_code: "USD" },
                  name: "Checking",
                  official_name: null,
                  subtype: "checking",
                  type: "depository",
                },
                {
                  account_id: "account-unknown-currency",
                  balances: { current: 7.5 },
                  name: "Legacy account",
                  official_name: null,
                  subtype: null,
                  type: "investment",
                },
              ],
            });
          case "/transactions/sync":
            return Response.json({
              added: [
                {
                  account_id: "account-1",
                  amount: 4.25,
                  date: "2026-08-15",
                  iso_currency_code: "USD",
                  merchant_name: "Coffee",
                  name: "Coffee",
                  pending: false,
                  pending_transaction_id: "pending-transaction-1",
                  personal_finance_category: {
                    confidence_level: "VERY_HIGH",
                    detailed: "FOOD_AND_DRINK_COFFEE",
                    primary: "FOOD_AND_DRINK",
                  },
                  transaction_id: "transaction-1",
                },
                {
                  account_id: "account-unknown-currency",
                  amount: 1.5,
                  date: "2026-08-15",
                  merchant_name: null,
                  name: "Unknown currency",
                  pending: false,
                  personal_finance_category: { primary: "TRANSFER_IN" },
                  transaction_id: "transaction-unknown-currency",
                },
              ],
              has_more: false,
              modified: [],
              next_cursor: "cursor-1",
              removed: [],
            });
          default:
            return Response.json({}, { status: 404 });
        }
      },
      secret: "connector-secret",
    });

    await expect(plaid.exchangePublicToken("public-token")).resolves.toEqual({
      accessToken: "access-token",
      itemId: "item-1",
    });
    await expect(plaid.getItem("access-token")).resolves.toEqual({
      itemId: "item-1",
      institutionId: null,
    });
    await expect(plaid.getAccounts("access-token")).resolves.toEqual([
      {
        accountId: "account-1",
        balanceCurrent: 12.5,
        currencyCode: "USD",
        mask: null,
        institutionId: null,
        name: "Checking",
        persistentAccountId: null,
        officialName: null,
        subtype: "checking",
        type: "depository",
      },
      {
        accountId: "account-unknown-currency",
        balanceCurrent: 7.5,
        currencyCode: null,
        mask: null,
        institutionId: null,
        name: "Legacy account",
        persistentAccountId: null,
        officialName: null,
        subtype: null,
        type: "investment",
      },
    ]);
    await expect(
      plaid.syncTransactions({ accessToken: "access-token", cursor: null }),
    ).resolves.toMatchObject({
      added: expect.arrayContaining([
        expect.objectContaining({
          accountId: "account-1",
          currencyCode: "USD",
          pendingTransactionId: "pending-transaction-1",
          personalFinanceCategory: {
            confidenceLevel: "VERY_HIGH",
            detailed: "FOOD_AND_DRINK_COFFEE",
            primary: "FOOD_AND_DRINK",
          },
          transactionId: "transaction-1",
        }),
        expect.objectContaining({
          accountId: "account-unknown-currency",
          currencyCode: null,
          personalFinanceCategory: {
            confidenceLevel: null,
            detailed: null,
            primary: "TRANSFER_IN",
          },
          transactionId: "transaction-unknown-currency",
        }),
      ]),
      hasMore: false,
      nextCursor: "cursor-1",
    });
  });

  it("maps authoritative institution and account identity metadata without extra requests", async () => {
    const requests: string[] = [];
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        requests.push(path);
        const item = { item_id: "item-1", institution_id: "ins-1" };
        return Response.json(
          path === "/item/get"
            ? { item }
            : {
                item,
                accounts: [
                  {
                    account_id: "account-1",
                    balances: { current: 12.5, iso_currency_code: "USD" },
                    mask: "0042",
                    name: "Checking",
                    official_name: null,
                    persistent_account_id: "persistent-1",
                    subtype: "checking",
                    type: "depository",
                  },
                ],
              },
        );
      },
      secret: "secret",
    });

    await expect(plaid.getItem("access-token")).resolves.toEqual({
      itemId: "item-1",
      institutionId: "ins-1",
    });
    await expect(plaid.getAccounts("access-token")).resolves.toMatchObject([
      {
        accountId: "account-1",
        institutionId: "ins-1",
        mask: "0042",
        persistentAccountId: "persistent-1",
      },
    ]);
    expect(requests).toEqual(["/item/get", "/accounts/get"]);
  });

  it.each([
    undefined,
    null,
  ])("normalizes absent identity metadata (%s) to null", async (metadata) => {
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () =>
        Response.json({
          item: { item_id: "item-1", institution_id: metadata },
          accounts: [
            {
              account_id: "account-1",
              balances: { current: null },
              mask: metadata,
              name: "Checking",
              official_name: null,
              persistent_account_id: metadata,
              subtype: null,
              type: "depository",
            },
          ],
        }),
      secret: "secret",
    });

    await expect(plaid.getItem("access-token")).resolves.toMatchObject({ institutionId: null });
    await expect(plaid.getAccounts("access-token")).resolves.toMatchObject([
      {
        institutionId: null,
        mask: null,
        persistentAccountId: null,
      },
    ]);
  });

  it.each([
    ["mask", 42],
    ["mask", " "],
    ["mask", "x".repeat(33)],
    ["persistent_account_id", {}],
    ["persistent_account_id", ""],
    ["persistent_account_id", "x".repeat(257)],
    ["institution_id", []],
    ["institution_id", " "],
    ["institution_id", "x".repeat(257)],
  ])("rejects malformed or unbounded %s metadata", async (field, metadata) => {
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () =>
        Response.json({
          item: {
            item_id: "item-1",
            ...(field === "institution_id" ? { institution_id: metadata } : {}),
          },
          accounts: [
            {
              account_id: "account-1",
              balances: { current: 10 },
              name: "Checking",
              official_name: null,
              subtype: null,
              type: "depository",
              ...(field === "institution_id" ? {} : { [field]: metadata }),
            },
          ],
        }),
      secret: "secret",
    });

    const error = await connectorErrorFrom(() => plaid.getAccounts("sensitive-access-token"));
    expect(error).toMatchObject({
      category: "invalid_response",
      code: "plaid_invalid_response",
      message: "Plaid returned an invalid response.",
    });
    assertRedactedMessage(error.message, ["sensitive-access-token"]);
    if (field === "institution_id") {
      await expect(plaid.getItem("access-token")).rejects.toMatchObject({
        code: "plaid_invalid_response",
      });
    }
  });

  it("rejects an empty Plaid account snapshot with a sanitized invalid response", async () => {
    const plaid = createPlaidConnector({
      clientId: "client-id",
      environment: "sandbox",
      fetch: async () => Response.json({ accounts: [] }),
      secret: "connector-secret",
    });

    const error = await connectorErrorFrom(() => plaid.getAccounts("sensitive-access-token"));
    expect(error).toMatchObject({
      category: "invalid_response",
      code: "plaid_invalid_response",
      message: "Plaid returned an invalid response.",
    });
    assertRedactedMessage(error.message, ["sensitive-access-token"]);
  });

  it("rejects an unsupported Plaid account type", async () => {
    const plaid = createPlaidConnector({
      clientId: "client-id",
      environment: "sandbox",
      fetch: async () =>
        Response.json({
          accounts: [
            {
              account_id: "account-1",
              balances: { current: 10, iso_currency_code: "USD" },
              name: "Wallet",
              official_name: null,
              subtype: null,
              type: "wallet",
            },
          ],
        }),
      secret: "connector-secret",
    });

    await expect(plaid.getAccounts("access-token")).rejects.toMatchObject({
      category: "invalid_response",
      code: "plaid_invalid_response",
    });
  });

  it("rejects a provider transaction whose pending identity self-references its transaction ID", async () => {
    const plaid = createPlaidConnector({
      clientId: "client-id",
      environment: "sandbox",
      fetch: async () =>
        Response.json({
          added: [
            {
              account_id: "account-1",
              amount: 4.25,
              date: "2026-08-16",
              merchant_name: "Malformed pending",
              name: "MALFORMED PENDING",
              pending: true,
              pending_transaction_id: "self-referential-transaction",
              personal_finance_category: null,
              transaction_id: "self-referential-transaction",
            },
          ],
          has_more: false,
          modified: [],
          next_cursor: "must-not-commit",
          removed: [],
        }),
      secret: "connector-secret",
    });

    await expect(
      plaid.syncTransactions({ accessToken: "access-token", cursor: null }),
    ).rejects.toMatchObject({
      category: "invalid_response",
      code: "plaid_invalid_response",
    });
  });

  it("classifies missing or malformed Plaid Item identities as invalid responses", async () => {
    const exchangeMissing = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () => Response.json({ access_token: "access-token" }),
      secret: "secret",
    });
    const exchangeMalformed = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () => Response.json({ access_token: "access-token", item_id: "" }),
      secret: "secret",
    });
    const itemMissing = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () => Response.json({}),
      secret: "secret",
    });
    const itemMalformed = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () => Response.json({ item: { item_id: "" } }),
      secret: "secret",
    });

    for (const operation of [
      () => exchangeMissing.exchangePublicToken("public-token"),
      () => exchangeMalformed.exchangePublicToken("public-token"),
      () => itemMissing.getItem("access-token"),
      () => itemMalformed.getItem("access-token"),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        category: "invalid_response",
        code: "plaid_invalid_response",
      });
    }
  });

  it("rejects non-JSON and malformed successful Plaid responses", async () => {
    const nonJson = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () => new Response("not-json"),
      secret: "secret",
    });
    const malformed = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () => Response.json({ unexpected: true }),
      secret: "secret",
    });

    await expect(nonJson.validateCredentials()).rejects.toMatchObject({
      category: "invalid_response",
      code: "plaid_invalid_response",
    });
    await expect(malformed.createLinkToken(linkInput)).rejects.toMatchObject({
      category: "invalid_response",
      code: "plaid_invalid_response",
    });
  });

  it("classifies invalid Plaid credentials as operator configuration", async () => {
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "production",
      fetch: async () =>
        Response.json(
          { error_code: "INVALID_API_KEYS", error_message: "bad secret" },
          { status: 400 },
        ),
      secret: "secret",
    });

    await expect(plaid.validateCredentials()).rejects.toMatchObject({
      category: "configuration",
      code: "plaid_configuration_invalid",
      disposition: "operator",
      message: "Plaid is not configured correctly.",
    });
  });

  it("classifies an invalid transaction cursor for one safe controlled replay", async () => {
    const rawCanary = "raw-invalid-cursor-provider-message";
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "production",
      fetch: async () =>
        Response.json({ error_code: "INVALID_CURSOR", error_message: rawCanary }, { status: 400 }),
      secret: "secret",
    });

    const error = await connectorErrorFrom(() =>
      plaid.syncTransactions({ accessToken: "access-token", cursor: "opaque-cursor" }),
    );
    expect(error).toMatchObject({
      category: "rejected",
      code: "plaid_invalid_cursor",
      disposition: "retry",
      status: 400,
    });
    assertRedactedMessage(error.message, [rawCanary, "opaque-cursor", "access-token"]);
  });

  it.each([
    ["oversized", JSON.stringify({ error_code: "INVALID_CURSOR", padding: "x".repeat(4_096) })],
    ["malformed", '{"error_code":"INVALID_CURSOR"'],
  ])("bounds %s invalid-cursor evidence before classifying it", async (_case, body) => {
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "production",
      fetch: async () =>
        new Response(body, {
          headers: { "content-type": "application/json" },
          status: 400,
        }),
      secret: "secret",
    });

    await expect(
      plaid.syncTransactions({ accessToken: "access-token", cursor: "opaque-cursor" }),
    ).rejects.toMatchObject({
      category: "rejected",
      code: "plaid_request_rejected",
      disposition: "operator",
      status: 400,
    });
  });

  it("classifies an item that needs reauthentication as reconnect", async () => {
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () =>
        Response.json(
          { error_code: "ITEM_LOGIN_REQUIRED", error_message: "reconnect account" },
          { status: 400 },
        ),
      secret: "secret",
    });

    await expect(plaid.getAccounts("access-token")).rejects.toMatchObject({
      category: "authorization",
      code: "plaid_authorization_failed",
      disposition: "reconnect",
    });
  });

  it("preserves bounded Retry-After for automatic rate-limit recovery", async () => {
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () =>
        Response.json(
          { error_code: "RATE_LIMIT_EXCEEDED", error_message: "slow down" },
          { headers: { "retry-after": "120" }, status: 429 },
        ),
      secret: "secret",
    });

    await expect(plaid.validateCredentials()).rejects.toMatchObject({
      category: "rate_limited",
      code: "plaid_rate_limited",
      disposition: "retry",
      retryAfterMs: 120_000,
    });
  });

  it("normalizes 5xx and transport failures without leaking Plaid secrets", async () => {
    const rawProviderMessage = "provider saw connector-secret and access-token";
    const temporary = createPlaidConnector({
      clientId: "client-id",
      environment: "sandbox",
      fetch: async () => Response.json({ error_message: rawProviderMessage }, { status: 503 }),
      secret: "connector-secret",
    });
    const transport = createPlaidConnector({
      clientId: "client-id",
      environment: "sandbox",
      fetch: async () => {
        throw new Error(rawProviderMessage);
      },
      secret: "connector-secret",
    });

    for (const plaid of [temporary, transport]) {
      const error = await connectorErrorFrom(() => plaid.validateCredentials());
      expect(error.disposition).toBe("retry");
      assertRedactedMessage(error.message, [
        rawProviderMessage,
        "connector-secret",
        "access-token",
      ]);
    }
  });

  it("fails closed for malformed invalid-cursor evidence", async () => {
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () =>
        new Response("{", {
          headers: { "content-type": "application/json" },
          status: 400,
        }),
      secret: "secret",
    });
    await expect(
      plaid.syncTransactions({ accessToken: "access-token", cursor: "cursor" }),
    ).rejects.toMatchObject({ code: "plaid_request_rejected" });
  });

  it("normalizes sparse Plaid category detail", async () => {
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async () =>
        Response.json({
          added: [
            {
              account_id: "account-1",
              amount: 10,
              date: "2026-08-15",
              merchant_name: "Store",
              name: "STORE",
              pending: false,
              personal_finance_category: { primary: "GENERAL_MERCHANDISE" },
              transaction_id: "transaction-1",
            },
          ],
          has_more: false,
          modified: [],
          next_cursor: "cursor",
          removed: [],
        }),
      secret: "secret",
    });

    await expect(
      plaid.syncTransactions({ accessToken: "access-token", cursor: null }),
    ).resolves.toMatchObject({
      added: [
        expect.objectContaining({
          personalFinanceCategory: {
            confidenceLevel: null,
            detailed: null,
            primary: "GENERAL_MERCHANDISE",
          },
        }),
      ],
    });
  });
});
