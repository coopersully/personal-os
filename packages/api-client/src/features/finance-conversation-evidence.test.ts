import { describe, expect, it, vi } from "vitest";
import { createFinanceConversationEvidenceApi } from "./finance-conversation-evidence.js";
import type { FinanceRequest } from "./finances.js";

describe("Finance run evidence client", () => {
  it("keeps exact candidate/revision/cursor scope and preserves unavailable historical evidence", async () => {
    const result = { state: "unavailable", reason: "no_committed_effect_receipt" };
    const request = vi.fn(async () => result) as unknown as FinanceRequest;
    const api = createFinanceConversationEvidenceApi(request);
    const revision = `sha256:${"a".repeat(64)}`;
    await expect(
      api.getFinanceConversationEvidence("run/id", {
        candidateId: "candidate/id",
        candidateRevision: revision,
        cursor: "signed+/=",
      }),
    ).resolves.toEqual(result);
    expect(vi.mocked(request).mock.calls[0]?.[0]).toBe(
      `/v1/finances/conversation/batches/run%2Fid/evidence?candidateId=candidate%2Fid&candidateRevision=sha256%3A${"a".repeat(64)}&cursor=signed%2B%2F%3D`,
    );
  });
});
