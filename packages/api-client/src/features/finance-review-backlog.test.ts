import { createApiClient } from "../client.js";

function fixture() {
  const response = { status: "in_progress", pendingCount: 2, outcomes: [] };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json(response));
  const api = createApiClient({ baseUrl: "https://example.test", token: "agent-token", fetch });
  return { api, fetch, response };
}

describe("Finance review backlog API client", () => {
  it("composes authenticated assessment, page, and batch reads without losing cursors or IDs", async () => {
    const { api, fetch, response } = fixture();
    expect(await api.getFinanceReviewBacklog()).toEqual(response);
    await api.listFinanceReviewBacklogItems();
    await api.listFinanceReviewBacklogItems({ group: "roundups", cursor: "a+/=?&", limit: 25 });
    await api.listFinanceReviewBatches();
    await api.listFinanceReviewBatches({ limit: 7 });
    await api.getFinanceReviewBatch("batch/ ?#");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://example.test/v1/finances/review-backlog",
      "https://example.test/v1/finances/review-backlog/items",
      "https://example.test/v1/finances/review-backlog/items?group=roundups&cursor=a%2B%2F%3D%3F%26&limit=25",
      "https://example.test/v1/finances/review-batches",
      "https://example.test/v1/finances/review-batches?limit=7",
      "https://example.test/v1/finances/review-batches/batch%2F%20%3F%23",
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer agent-token");
    }
  });

  it("POSTs the exact preview and execution acceptance without local resolution or automatic looping", async () => {
    const { api, fetch, response } = fixture();
    const preview = {
      idempotencyKey: "request-1",
      decisions: [
        {
          kind: "categorization" as const,
          transactionId: "transaction",
          categoryId: "category",
          expectedTransactionUpdatedAt: "2026-10-24T12:00:00.000Z",
          expectedTransactionRevision: "9007199254740993",
          evidence: "Receipt",
          rationale: "Personal food",
          confidence: 0.9,
          learnMerchant: "never" as const,
        },
      ],
    };
    expect(await api.previewFinanceReviewBatch(preview)).toEqual(response);
    const execute = { fingerprint: `sha256:${"a".repeat(64)}`, limit: 10 };
    expect(await api.executeFinanceReviewBatch("batch/id", execute)).toEqual(response);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/v1/finances/review-batches");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(preview),
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://example.test/v1/finances/review-batches/batch%2Fid/execute",
    );
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(execute),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves review contextual and action revisions above the safe integer range", async () => {
    const { api, fetch } = fixture();
    const input = {
      idempotencyKey: "review-revisions",
      decisions: [
        {
          kind: "review" as const,
          transactionId: "transaction",
          reviewId: "review",
          expectedTransactionUpdatedAt: "2026-10-24T12:00:00.000Z",
          expectedReviewUpdatedAt: "2026-10-24T12:00:00.000Z",
          expectedTransactionRevision: "9007199254740993",
          expectedReviewRevision: "9007199254740995",
          expectedActionRevision: "9007199254740997",
          action: "approve" as const,
          rationale: "Confirmed purpose",
          evidence: "Receipt",
          confidence: 0.9,
          learnMerchant: "never" as const,
        },
      ],
    };
    await api.previewFinanceReviewBatch(input);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify(input) });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(input);
  });

  it("preserves policy denials and stale-snapshot errors", async () => {
    const { api, fetch } = fixture();
    for (const status of [403, 409]) {
      fetch.mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: status === 403 ? "forbidden" : "conflict",
              message: "Reload or obtain required authority",
              details: { recovery: "new_preview" },
            },
          },
          { status },
        ),
      );
      await expect(
        api.executeFinanceReviewBatch("batch", {
          fingerprint: `sha256:${"a".repeat(64)}`,
          limit: 1,
        }),
      ).rejects.toMatchObject({ status, details: { recovery: "new_preview" } });
    }
  });
});
