import { createPlaidConnector } from "./plaid.js";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9ZkAAAAASUVORK5CYII=";
function connector(body: unknown, inspect?: (url: string, init?: RequestInit) => void) {
  return createPlaidConnector({
    clientId: "client",
    secret: "secret",
    environment: "sandbox",
    fetch: async (url, init) => {
      inspect?.(String(url), init);
      return Response.json(body);
    },
  });
}
it("requests optional institution metadata by verified identity with bounded HTTPS transport", async () => {
  const inspect = vi.fn();
  const plaid = connector(
    {
      institution: {
        institution_id: "ins_1",
        logo: png,
        primary_color: "#004466",
        url: "https://bank.example",
      },
    },
    inspect,
  );
  expect(await plaid.getInstitutionBranding?.("ins_1")).toEqual({
    institutionId: "ins_1",
    logo: `data:image/png;base64,${png}`,
    primaryColor: "#004466",
    url: "https://bank.example",
  });
  const call = inspect.mock.calls[0];
  expect(call?.[0]).toBe("https://sandbox.plaid.com/institutions/get_by_id");
  expect(JSON.parse(call?.[1]?.body)).toMatchObject({
    institution_id: "ins_1",
    country_codes: ["US"],
    options: { include_optional_metadata: true },
  });
  expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
});
it("drops invalid optional decoration independently", async () => {
  const plaid = connector({
    institution: {
      institution_id: "ins_1",
      logo: "PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+",
      primary_color: "url(secret)",
      url: "javascript:alert(1)",
    },
  });
  expect(await plaid.getInstitutionBranding?.("ins_1")).toEqual({
    institutionId: "ins_1",
    logo: null,
    primaryColor: null,
    url: null,
  });
});
it("allows missing branding", async () => {
  expect(
    await connector({ institution: { institution_id: "ins_1" } }).getInstitutionBranding?.("ins_1"),
  ).toEqual({ institutionId: "ins_1", logo: null, primaryColor: null, url: null });
});
it("rejects mismatched identity without retaining raw payloads", async () => {
  await expect(
    connector({ institution: { institution_id: "other" } }).getInstitutionBranding?.("ins_1"),
  ).rejects.toMatchObject({ category: "invalid_response" });
});
it("bounds institution responses before JSON parsing", async () => {
  await expect(
    connector({
      institution: { institution_id: "ins_1", logo: "x".repeat(100_000) },
    }).getInstitutionBranding?.("ins_1"),
  ).rejects.toMatchObject({ category: "invalid_response" });
});
it("preserves the shared provider mask contract and authoritative institution identity from accounts", async () => {
  const account = {
    account_id: "a",
    balances: { current: 12, iso_currency_code: "USD" },
    name: "Card",
    official_name: null,
    type: "credit",
    subtype: "credit card",
    mask: "1234",
  };
  expect(
    await connector({ accounts: [account], item: { institution_id: "ins_1" } }).getAccounts(
      "access",
    ),
  ).toEqual([expect.objectContaining({ mask: "1234", institutionId: "ins_1" })]);
  expect(
    await connector({ accounts: [{ ...account, mask: "legacy-mask" }] }).getAccounts("access"),
  ).toEqual([expect.objectContaining({ mask: "legacy-mask", institutionId: null })]);
});

it("rejects oversized decoded PNG dimensions independently of other metadata", async () => {
  const bytes = Buffer.from(png, "base64");
  bytes.writeUInt32BE(100_000, 16);
  const result = await connector({
    institution: {
      institution_id: "ins_1",
      logo: bytes.toString("base64"),
      primary_color: "#004466",
    },
  }).getInstitutionBranding?.("ins_1");
  expect(result).toMatchObject({ logo: null, primaryColor: "#004466" });
});

it.each([
  null,
  {},
  undefined,
])("keeps financial snapshots when optional institution metadata is absent: %j", async (item) => {
  const account = {
    account_id: "a",
    balances: { current: 12, iso_currency_code: "USD" },
    name: "Card",
    official_name: null,
    type: "credit",
    subtype: "credit card",
    mask: "1234",
  };
  expect(await connector({ accounts: [account], item }).getAccounts("access")).toEqual([
    expect.objectContaining({ accountId: "a", balanceCurrent: 12, institutionId: null }),
  ]);
});
