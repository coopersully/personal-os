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
      fetch: async (input) => {
        switch (new URL(String(input)).pathname) {
          case "/item/public_token/exchange":
            return Response.json({ access_token: "access-token", item_id: "item-1" });
          case "/accounts/get":
            return Response.json({
              accounts: [
                {
                  account_id: "account-1",
                  balances: { current: 12.5 },
                  name: "Checking",
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
                  merchant_name: "Coffee",
                  name: "Coffee",
                  pending: false,
                  personal_finance_category: { primary: "FOOD_AND_DRINK" },
                  transaction_id: "transaction-1",
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

    await expect(plaid.exchangePublicToken("public-token")).resolves.toBe("access-token");
    await expect(plaid.getAccounts("access-token")).resolves.toEqual([
      {
        accountId: "account-1",
        balanceCurrent: 12.5,
        name: "Checking",
        officialName: null,
      },
    ]);
    await expect(
      plaid.syncTransactions({ accessToken: "access-token", cursor: null }),
    ).resolves.toMatchObject({
      added: [{ accountId: "account-1", transactionId: "transaction-1" }],
      hasMore: false,
      nextCursor: "cursor-1",
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
});
