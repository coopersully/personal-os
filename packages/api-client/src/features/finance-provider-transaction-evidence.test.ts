import { describe, expect, it, vi } from "vitest";
import { createFinanceApi, type FinanceRequest } from "./finances.js";

const id = "11111111-1111-4111-8111-111111111111";
describe("historical evidence typed client", () => {
  it("sends only bounded native targets and validates a safe response", async () => {
    const response = {
      observedAt: "2026-11-05T12:00:00.000Z",
      providerUpdatedAt: null,
      snapshotConsistency: "not_atomic",
      coverage: "unavailable",
      reason: "not_initialized",
      entries: [],
    };
    const request = vi.fn(async () => response) as unknown as FinanceRequest;
    await expect(
      createFinanceApi(request).readFinanceProviderTransactionEvidence({ transactionIds: [id] }),
    ).resolves.toEqual(response);
    expect(request).toHaveBeenCalledWith("/v1/finances/provider-transaction-evidence", {
      method: "POST",
      body: JSON.stringify({ transactionIds: [id] }),
    });
  });
  it("rejects provider/caller authority before transport", async () => {
    const request = vi.fn() as unknown as FinanceRequest;
    await expect(
      createFinanceApi(request).readFinanceProviderTransactionEvidence({
        transactionIds: ["remote"],
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
