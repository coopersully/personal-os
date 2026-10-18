import { describe, expect, it, vi } from "vitest";
import { createFinanceActivityApi } from "./finance-activity.js";
import type { FinanceRequest } from "./finances.js";

describe("Finance Activity client", () => {
  it("encodes exact activity evidence identity and continuation without owner overrides", async () => {
    const request = vi.fn(async () => ({})) as unknown as FinanceRequest;
    const api = createFinanceActivityApi(request);
    await api.getFinanceActivityEvidence("receipt/id");
    await api.getFinanceActivityEvidence("receipt/id", { cursor: "signed+cursor/==" });
    expect(vi.mocked(request).mock.calls).toEqual([
      ["/v1/finances/activity/receipt%2Fid/evidence"],
      ["/v1/finances/activity/receipt%2Fid/evidence?cursor=signed%2Bcursor%2F%3D%3D"],
    ]);
  });
  it("preserves bounded filter/cursor values and forwards honest capability state", async () => {
    const page = {
      entries: [],
      nextCursor: null,
      capabilities: {
        financialActions: { state: "unavailable", reason: "mutation_evidence_not_integrated" },
      },
    };
    const request = vi.fn(async () => page) as unknown as FinanceRequest;
    const activity = createFinanceActivityApi(request);
    await expect(activity.listFinanceActivity()).resolves.toEqual(page);
    await activity.listFinanceActivity({
      cursor: "signed+cursor/==",
      limit: 10,
      type: "human_answer_decision",
      actor: "user",
      recordId: "record/id",
      from: "2026-10-01T00:00:00Z",
      through: "2026-10-18T00:00:00Z",
    });
    expect(vi.mocked(request).mock.calls).toEqual([
      ["/v1/finances/activity"],
      [
        "/v1/finances/activity?cursor=signed%2Bcursor%2F%3D%3D&limit=10&type=human_answer_decision&actor=user&recordId=record%2Fid&from=2026-10-01T00%3A00%3A00Z&through=2026-10-18T00%3A00%3A00Z",
      ],
    ]);
  });
});
