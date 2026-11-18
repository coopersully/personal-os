import type { FinanceReviewBatchRun } from "@personal-os/domain";
import { applyReviewedFinanceBatch, createApiClient } from "../client.js";
import { financeReviewBatchApprovalBlocker } from "./finance-review-backlog.js";

function fixture() {
  const response = { status: "in_progress", pendingCount: 2, outcomes: [] };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json(response));
  const api = createApiClient({ baseUrl: "https://example.test", token: "agent-token", fetch });
  return { api, fetch, response };
}

describe("Finance review batch approval blocker", () => {
  const stamp = "2026-11-12T12:00:00.000Z";
  const id = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const pair = {
    kind: "transfer_pair" as const,
    transactionId: id,
    counterpartTransactionId: other,
    expectedTransactionUpdatedAt: stamp,
    expectedTransactionRevision: "1",
    expectedCounterpartUpdatedAt: stamp,
    expectedCounterpartRevision: "1",
    rationale: "Synthetic pair",
    evidence: "Synthetic statements",
    confidence: 0.9,
    learnMerchant: "never" as const,
  };
  const batch = (overrides: Partial<FinanceReviewBatchRun>): FinanceReviewBatchRun => ({
    id,
    fingerprint: `sha256:${"a".repeat(64)}`,
    idempotencyKey: "synthetic",
    decisions: [pair],
    transferCounterparts: [],
    outcomes: [],
    status: "previewed",
    pendingCount: 1,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  });
  const summary = {
    merchant: "Synthetic transfer",
    amountCents: 1000,
    currencyCode: "USD",
    date: "2026-11-01",
  };
  it("asks for both transfer records, then for their displayed details, before approval", () => {
    expect(financeReviewBatchApprovalBlocker(batch({}))).toBe(
      "Ask for a fresh batch with both transfer records attached.",
    );
    expect(
      financeReviewBatchApprovalBlocker(
        batch({ transferCounterparts: [{ index: 0, transactionId: other, revision: "1" }] }),
      ),
    ).toBe(
      "Ask for a fresh batch showing the merchant, amount and date for both transfer records.",
    );
    expect(
      financeReviewBatchApprovalBlocker(
        batch({
          transferCounterparts: [{ index: 0, transactionId: other, revision: "1", summary }],
        }),
      ),
    ).toBeNull();
  });
  it("does not block on a pair that already has a recorded outcome", () => {
    expect(
      financeReviewBatchApprovalBlocker(
        batch({
          pendingCount: 0,
          status: "completed",
          outcomes: [
            {
              index: 0,
              transactionId: id,
              status: "applied",
              error: null,
              recovery: "none",
              completedAt: stamp,
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("reviewed Finance batch loop", () => {
  const stamp = "2026-11-12T12:00:00.000Z";
  const id = "11111111-1111-4111-8111-111111111111";
  const decision = {
    kind: "categorization" as const,
    transactionId: id,
    categoryId: id,
    expectedTransactionUpdatedAt: stamp,
    expectedTransactionRevision: "1",
    rationale: "Synthetic",
    evidence: "Synthetic receipt",
    confidence: 1,
    learnMerchant: "never" as const,
  };
  const outcome = (index: number, status: "applied" | "failed") => ({
    index,
    transactionId: id,
    status,
    error: status === "failed" ? { code: "conflict", message: "Changed" } : null,
    recovery: status === "failed" ? ("new_preview" as const) : ("none" as const),
    completedAt: stamp,
  });
  const run = (pendingCount: number, outcomes = [] as ReturnType<typeof outcome>[]) =>
    ({
      id,
      fingerprint: `sha256:${"a".repeat(64)}`,
      idempotencyKey: "synthetic",
      decisions: [decision, decision],
      transferCounterparts: [],
      outcomes,
      status: pendingCount ? "in_progress" : "completed",
      pendingCount,
      createdAt: stamp,
      updatedAt: stamp,
    }) as FinanceReviewBatchRun;
  const loop = (
    steps: {
      receipt?: FinanceReviewBatchRun;
      saved?: FinanceReviewBatchRun;
      duringExecute?: () => void;
      duringRead?: () => void;
    },
    options: {
      signal?: AbortSignal;
      isCurrent?: () => boolean;
      initial?: FinanceReviewBatchRun;
    } = {},
  ) => {
    const api = {
      executeFinanceReviewBatch: vi.fn(async () => {
        steps.duringExecute?.();
        return steps.receipt ?? run(1, [outcome(0, "applied")]);
      }),
      getFinanceReviewBatch: vi.fn(async () => {
        steps.duringRead?.();
        return steps.saved ?? run(1, [outcome(0, "applied")]);
      }),
    };
    const confirmed = vi.fn();
    const result = applyReviewedFinanceBatch(
      api,
      options.initial ?? run(2),
      options.signal ?? new AbortController().signal,
      options.isCurrent ?? (() => true),
      confirmed,
    );
    return { api, confirmed, result };
  };
  it("does nothing once cancelled or when the batch still needs a human look", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const cancelled = loop({}, { signal: aborted.signal });
    expect(await cancelled.result).toMatchObject({
      state: "cancelled",
      batch: { pendingCount: 2 },
    });
    expect(cancelled.api.executeFinanceReviewBatch).not.toHaveBeenCalled();
    const superseded = loop({}, { isCurrent: () => false });
    expect(await superseded.result).toMatchObject({ state: "cancelled" });
    expect(superseded.api.executeFinanceReviewBatch).not.toHaveBeenCalled();
    const deferring = {
      ...run(2),
      decisions: [
        {
          ...decision,
          kind: "review" as const,
          reviewId: id,
          expectedReviewUpdatedAt: stamp,
          expectedReviewRevision: "1",
          expectedActionRevision: "0",
          action: "defer" as const,
        },
      ],
    } as FinanceReviewBatchRun;
    const blocked = loop({}, { initial: deferring });
    expect(await blocked.result).toMatchObject({ state: "needs_review" });
    expect(blocked.api.executeFinanceReviewBatch).not.toHaveBeenCalled();
  });
  it("keeps a confirmed receipt when the view goes away or the request is cancelled mid-loop", async () => {
    let current = true;
    const left = loop(
      {
        duringExecute: () => {
          current = false;
        },
      },
      { isCurrent: () => current },
    );
    expect(await left.result).toMatchObject({ state: "cancelled", batch: { pendingCount: 2 } });
    expect(left.confirmed).not.toHaveBeenCalled();
    const controller = new AbortController();
    const cancelled = loop(
      { duringExecute: () => controller.abort() },
      { signal: controller.signal },
    );
    // The server confirmed one effect before the cancel; that progress is reported, not lost.
    expect(await cancelled.result).toMatchObject({
      state: "cancelled",
      batch: { pendingCount: 1 },
    });
    expect(cancelled.confirmed).toHaveBeenCalledTimes(1);
    expect(cancelled.api.getFinanceReviewBatch).not.toHaveBeenCalled();
    const late = new AbortController();
    const afterRead = loop({ duringRead: () => late.abort() }, { signal: late.signal });
    expect(await afterRead.result).toMatchObject({
      state: "cancelled",
      batch: { pendingCount: 1 },
    });
  });
  it("stops for review on a new exception and refuses progress it cannot confirm", async () => {
    const failed = run(1, [outcome(0, "failed")]);
    const exception = loop({ receipt: failed, saved: failed });
    expect(await exception.result).toMatchObject({
      state: "needs_review",
      batch: { pendingCount: 1, outcomes: [{ status: "failed" }] },
    });
    expect(exception.api.executeFinanceReviewBatch).toHaveBeenCalledTimes(1);
    const stalled = loop({ receipt: run(2), saved: run(2) });
    await expect(stalled.result).rejects.toThrow("Batch progress could not be confirmed.");
    const otherBatch = loop({
      saved: { ...run(1, [outcome(0, "applied")]), fingerprint: "sha256:other" },
    });
    await expect(otherBatch.result).rejects.toThrow("Batch progress could not be confirmed.");
  });
});

describe("Finance review backlog API client", () => {
  it("declines a batch or a correction by encoded identity", async () => {
    const { api, fetch } = fixture();
    await api.declineFinanceReviewBatch("batch/ ?");
    await api.declineFinanceReviewBatchUndo("undo/ ?");
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ["https://example.test/v1/finances/review-batches/batch%2F%20%3F/decline", "POST", "{}"],
      [
        "https://example.test/v1/finances/review-batch-corrections/undo%2F%20%3F/decline",
        "POST",
        "{}",
      ],
    ]);
  });
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
