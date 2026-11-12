import type { FinanceReviewBatchRun } from "@personal-os/domain";
import { applyReviewedFinanceBatch, createApiClient } from "../client.js";

function fixture() {
  const response = { status: "in_progress", pendingCount: 2, outcomes: [] };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json(response));
  const api = createApiClient({ baseUrl: "https://example.test", token: "agent-token", fetch });
  return { api, fetch, response };
}

describe("Finance review backlog API client", () => {
  it("preserves correction identity, accepted fingerprint and cancellation without automatic retries", async () => {
    const { api, fetch } = fixture();
    const input = { batchId: "batch", outcomeIndexes: [0, 2], idempotencyKey: "undo" };
    await api.previewFinanceReviewBatchUndo(input);
    await api.getFinanceReviewBatchUndo("undo/ ?");
    const controller = new AbortController();
    const acceptance = { fingerprint: `sha256:${"a".repeat(64)}`, limit: 2 };
    await api.executeFinanceReviewBatchUndo("undo/ ?", acceptance, controller.signal);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://example.test/v1/finances/review-batch-corrections",
      "https://example.test/v1/finances/review-batch-corrections/undo%2F%20%3F",
      "https://example.test/v1/finances/review-batch-corrections/undo%2F%20%3F/execute",
    ]);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(input));
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify(acceptance),
      signal: controller.signal,
    });
  });
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

  it("qualifies a manifest without preview identity or automatic execution", async () => {
    const { api, fetch, response } = fixture();
    const input = {
      decisions: [
        {
          kind: "categorization" as const,
          transactionId: "transaction",
          categoryId: "category",
          expectedTransactionUpdatedAt: "2026-10-24T00:00:00.000Z",
          expectedTransactionRevision: "9007199254740993",
          rationale: "Inspect",
          evidence: "Requires qualification",
          confidence: 1,
          learnMerchant: "never" as const,
        },
      ],
    };
    expect(await api.qualifyFinanceMaintenanceWork(input)).toEqual(response);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://example.test/v1/finances/review-batches/qualification",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify(input) });
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

it.each([
  "offline",
  "stale",
] as const)("retains a validated execution receipt when the follow-up read is %s", async (readFailure) => {
  const before: FinanceReviewBatchRun = {
    id: "batch",
    fingerprint: `sha256:${"a".repeat(64)}`,
    idempotencyKey: "review",
    status: "previewed",
    pendingCount: 3,
    createdAt: "2026-11-11T00:00:00Z",
    updatedAt: "2026-11-11T00:00:00Z",
    decisions: [],
    transferCounterparts: [],
    outcomes: [],
  };
  const receipt: FinanceReviewBatchRun = {
    ...before,
    status: "in_progress",
    pendingCount: 1,
  };
  const getFinanceReviewBatch = vi.fn().mockResolvedValue({ ...receipt, pendingCount: 2 });
  if (readFailure === "offline") getFinanceReviewBatch.mockRejectedValue(new Error("Offline"));
  const executeFinanceReviewBatch = vi.fn().mockResolvedValue(receipt);
  const onConfirmed = vi.fn();
  await expect(
    applyReviewedFinanceBatch(
      { executeFinanceReviewBatch, getFinanceReviewBatch },
      before,
      new AbortController().signal,
      () => true,
      onConfirmed,
    ),
  ).rejects.toThrow(
    readFailure === "offline" ? "Offline" : "Batch progress could not be confirmed",
  );
  expect(executeFinanceReviewBatch).toHaveBeenCalledOnce();
  expect(onConfirmed.mock.calls).toEqual([[receipt]]);
});
