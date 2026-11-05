import { createPlaidConnector } from "./plaid.js";

const input = {
  clientName: "nohmi",
  countryCodes: ["US"],
  language: "en",
  linkCustomizationName: "default",
  products: ["transactions"],
  transactions: { daysRequested: 730 },
  userId: "fixture",
} as const;
function connector(response: unknown) {
  const fetch = vi.fn(async () => Response.json(response));
  return {
    fetch,
    plaid: createPlaidConnector({
      clientId: "fixture",
      secret: "private-secret",
      environment: "sandbox",
      fetch,
    }),
  };
}
it("requests hosted consent without delivering unsolicited messages and parses completed consent", async () => {
  const { plaid, fetch } = connector({
    link_token: "private-link",
    hosted_link_url: "https://secure.plaid.com/hl/session",
    expiration: "2026-10-11T15:30:00Z",
  });
  expect(plaid.createHostedLink).toBeDefined();
  await expect(plaid.createHostedLink?.(input)).resolves.toEqual({
    linkToken: "private-link",
    url: "https://secure.plaid.com/hl/session",
    expiresAt: "2026-10-11T15:30:00Z",
  });
  const call = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(call[0]).toBe("https://sandbox.plaid.com/link/token/create");
  expect(JSON.parse(String(call[1].body))).toMatchObject({
    hosted_link: { url_lifetime_seconds: 1800 },
  });
  expect(JSON.parse(String(call[1].body))).not.toHaveProperty("user.phone_number");
  const completed = connector({
    link_token: "private-link",
    link_sessions: [
      {
        results: {
          item_add_results: [
            {
              public_token: "consent-token",
              institution: { name: "Fixture Credit Union", institution_id: "ins_fixture" },
              accounts: [{ name: "Checking", mask: "0042" }],
            },
          ],
        },
      },
    ],
  });
  await expect(completed.plaid.getHostedLinkResult?.("private-link")).resolves.toEqual({
    accountMetadata: {
      "consent-token": {
        institutionId: "ins_fixture",
        accounts: [{ name: "Checking", mask: "0042" }],
      },
    },
    publicTokens: ["consent-token"],
    institutions: { "consent-token": "Fixture Credit Union" },
  });
  await expect(
    connector({ link_token: "private-link", link_sessions: [] }).plaid.getHostedLinkResult?.(
      "private-link",
    ),
  ).resolves.toEqual({ publicTokens: [], institutions: {}, accountMetadata: {} });
});
it.each([
  "https://attacker.example/hl/session",
  "http://secure.plaid.com/hl/session",
  "https://user:pass@secure.plaid.com/hl/session",
  "https://secure.plaid.com/other",
])("rejects an invalid provider destination %s", async (url) => {
  await expect(
    connector({
      link_token: "private-link",
      hosted_link_url: url,
      expiration: "2026-10-11T15:30:00Z",
    }).plaid.createHostedLink?.(input),
  ).rejects.toMatchObject({ code: "invalid_hosted_link" });
});
it("rejects unrelated sessions and malformed consent receipts", async () => {
  await expect(
    connector({ link_token: "other", link_sessions: [] }).plaid.getHostedLinkResult?.(
      "private-link",
    ),
  ).rejects.toMatchObject({ code: "invalid_hosted_session" });
  await expect(
    connector({
      link_token: "private-link",
      link_sessions: [{ results: { item_add_results: [{ public_token: "" }] } }],
    }).plaid.getHostedLinkResult?.("private-link"),
  ).rejects.toMatchObject({ code: "plaid_invalid_response" });
});

it("initializes update mode with existing credentials without requesting new products", async () => {
  const { plaid, fetch } = connector({ link_token: "update-link" });
  await plaid.createLinkToken({ ...input, accessToken: "existing-item-token" });
  const call = fetch.mock.calls[0] as unknown as [string, RequestInit];
  const body = JSON.parse(String(call[1].body));
  expect(body.access_token).toBe("existing-item-token");
  expect(body).not.toHaveProperty("products");
  expect(body).not.toHaveProperty("transactions");
});
