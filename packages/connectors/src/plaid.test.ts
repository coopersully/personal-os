import { describe, expect, it } from "vitest";
import { ConnectorError, createPlaidConnector } from "./index.js";

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
                },
                {
                  account_id: "account-unknown-currency",
                  balances: { current: 7.5 },
                  name: "Legacy account",
                  official_name: null,
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
                  personal_finance_category: null,
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
    await expect(plaid.getItem("access-token")).resolves.toEqual({ itemId: "item-1" });
    await expect(plaid.getAccounts("access-token")).resolves.toEqual([
      {
        accountId: "account-1",
        balanceCurrent: 12.5,
        currencyCode: "USD",
        name: "Checking",
        officialName: null,
      },
      {
        accountId: "account-unknown-currency",
        balanceCurrent: 7.5,
        currencyCode: null,
        name: "Legacy account",
        officialName: null,
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
          transactionId: "transaction-unknown-currency",
        }),
      ]),
      hasMore: false,
      nextCursor: "cursor-1",
    });
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
