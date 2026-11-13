import { createApiClient } from "../client.js";

const id = "11111111-1111-4111-8111-111111111111";
describe("Finance attention client", () => {
  it("carries exact policy and refresh references through authenticated requests", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => Response.json({ complete: true }));
    const api = createApiClient({ baseUrl: "https://example.test", token: "fixture", fetch });
    await api.getFinanceAttention();
    await api.getFinanceBudgetStart();
    await api.getFinanceOpeningPosition("2026-11");
    await api.getFinanceBudgetStartPreview("id/ ?");
    const preview = { firstMonth: "2026-11", expectedPolicyRevision: 0, idempotencyKey: "start" };
    await api.previewFinanceBudgetStart(preview);
    const refresh = {
      sourceRefs: [{ accountId: id, expectedAccountRevision: "1" }],
      period: "2026-11",
      idempotencyKey: "refresh",
    };
    await api.prepareFinanceEvidenceRefresh(refresh);
    await api.getFinanceEvidenceRefresh("id/ ?");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://example.test/v1/finances/attention",
      "https://example.test/v1/finances/budget-start",
      "https://example.test/v1/finances/opening-position?month=2026-11",
      "https://example.test/v1/finances/budget-start/previews/id%2F%20%3F",
      "https://example.test/v1/finances/budget-start/previews",
      "https://example.test/v1/finances/evidence-refresh",
      "https://example.test/v1/finances/evidence-refresh/id%2F%20%3F",
    ]);
    expect(JSON.parse(String(fetch.mock.calls[4]?.[1]?.body))).toEqual(preview);
    expect(JSON.parse(String(fetch.mock.calls[5]?.[1]?.body))).toEqual(refresh);
    for (const [, init] of fetch.mock.calls)
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture");
  });
});
