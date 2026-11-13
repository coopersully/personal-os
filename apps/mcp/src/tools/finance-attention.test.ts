import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import type { AccessScope } from "@personal-os/domain";
import { createPersonalOsMcpServer } from "../server.js";
import { availableToolNames } from "../tool-catalog.js";

const id = "11111111-1111-4111-8111-111111111111";
const readTools = [
  "get_finance_attention",
  "get_finance_budget_start",
  "get_finance_budget_start_preview",
  "get_finance_opening_position",
  "get_finance_evidence_refresh",
  "get_finance_review_batch_undo",
];
describe("Finance attention MCP authority", () => {
  it("discovers read-only status without exposing approval or execution capabilities", () => {
    const names = availableToolNames(new Set<AccessScope>(["finances:read"]), true);
    for (const tool of readTools) expect(names).toContain(tool);
    for (const tool of [
      "preview_finance_budget_start",
      "prepare_finance_evidence_refresh",
      "preview_finance_review_batch_undo",
      "execute_finance_review_batch_undo",
    ])
      expect(names).not.toContain(tool);
    expect(names).not.toContain("apply_finance_budget_start");
  });
  it("requires all refresh grants and independent execution authority", () => {
    const writes = new Set<AccessScope>(["finances:read", "finances:write"]);
    expect(availableToolNames(writes, false)).toContain("preview_finance_budget_start");
    expect(availableToolNames(writes, false)).not.toContain("prepare_finance_evidence_refresh");
    writes.add("finances:maintain");
    expect(availableToolNames(writes, false)).toContain("prepare_finance_evidence_refresh");
    expect(availableToolNames(writes, false)).not.toContain("execute_finance_review_batch_undo");
    writes.add("finances:execute");
    expect(availableToolNames(writes, false)).toContain("execute_finance_review_batch_undo");
  });
  it("passes exact refresh inputs without inventing source evidence or approval", async () => {
    const api = { prepareFinanceEvidenceRefresh: vi.fn(async () => ({ id, status: "accepted" })) };
    const server = createPersonalOsMcpServer({
      api: api as unknown as PersonalOsApiClient,
      scopes: new Set<AccessScope>(["finances:read", "finances:write", "finances:maintain"]),
      readOnly: false,
      timeZone: "UTC",
    });
    const client = new Client({ name: "attention-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const input = {
        sourceRefs: [{ accountId: id, expectedAccountRevision: "1" }],
        period: "2026-11",
        idempotencyKey: "refresh",
      };
      const result = await client.callTool({
        name: "prepare_finance_evidence_refresh",
        arguments: input,
      });
      expect(result.isError).not.toBe(true);
      expect(api.prepareFinanceEvidenceRefresh).toHaveBeenCalledWith(input);
      await expect(
        client.callTool({
          name: "execute_finance_review_batch_undo",
          arguments: { id, fingerprint: `sha256:${"a".repeat(64)}` },
        }),
      ).rejects.toThrow("not found");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
