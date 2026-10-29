import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ApiClientError, type PersonalOsApiClient } from "@personal-os/api-client";
import type { AccessScope } from "@personal-os/domain";
import { createPersonalOsMcpServer } from "../server.js";
import { availableToolNames } from "../tool-catalog.js";

const id = "11111111-1111-4111-8111-111111111111";
const fingerprint = `sha256:${"a".repeat(64)}`;
const decision = {
  kind: "categorization",
  transactionId: id,
  categoryId: id,
  expectedTransactionUpdatedAt: "2026-10-24T12:00:00.000Z",
  expectedTransactionRevision: "9007199254740993",
  evidence: "Receipt",
  rationale: "Confirmed purpose",
  confidence: 0.9,
  learnMerchant: "never",
};
const reviewDecision = {
  kind: "review",
  transactionId: id,
  reviewId: id,
  expectedTransactionUpdatedAt: decision.expectedTransactionUpdatedAt,
  expectedTransactionRevision: decision.expectedTransactionRevision,
  expectedReviewUpdatedAt: decision.expectedTransactionUpdatedAt,
  expectedReviewRevision: "9007199254740995",
  expectedActionRevision: "0",
  action: "approve",
  evidence: decision.evidence,
  rationale: decision.rationale,
  confidence: decision.confidence,
  learnMerchant: "never",
};
const preview = { idempotencyKey: "preview-1", decisions: [decision] };
const readNames = [
  "get_finance_review_backlog",
  "list_finance_review_backlog_items",
  "get_finance_review_batch",
  "list_finance_review_batches",
];
const allScopes: AccessScope[] = ["finances:read", "finances:write", "finances:execute"];

async function connect(scopes: AccessScope[] = allScopes, readOnly = false) {
  const result = {
    status: "in_progress",
    pendingCount: 2,
    outcomes: [{ status: "review_required", recovery: "new_preview" }],
  };
  const api = {
    getFinanceReviewBacklog: vi.fn(async () => result),
    listFinanceReviewBacklogItems: vi.fn(async () => result),
    previewFinanceReviewBatch: vi.fn(async () => result),
    listFinanceReviewBatches: vi.fn(async () => [result]),
    getFinanceReviewBatch: vi.fn(async () => result),
    executeFinanceReviewBatch: vi.fn(async () => result),
  };
  const server = createPersonalOsMcpServer({
    api: api as unknown as PersonalOsApiClient,
    scopes: new Set(scopes),
    readOnly,
    timeZone: "UTC",
  });
  const client = new Client({ name: "review-backlog-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return {
    api,
    client,
    result,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("Finance review backlog MCP tools", () => {
  it.each([
    { scopes: [], readOnly: false, preview: false, execute: false },
    { scopes: ["finances:read"], readOnly: false, preview: false, execute: false },
    { scopes: ["finances:read", "finances:write"], readOnly: false, preview: true, execute: false },
    {
      scopes: ["finances:read", "finances:execute"],
      readOnly: false,
      preview: false,
      execute: false,
    },
    {
      scopes: ["finances:write", "finances:execute"],
      readOnly: false,
      preview: false,
      execute: false,
    },
    { scopes: allScopes, readOnly: false, preview: true, execute: true },
    { scopes: allScopes, readOnly: true, preview: false, execute: false },
  ])("enforces catalog scopes and persisted-preview posture: %j", async (options) => {
    const scopes = options.scopes as AccessScope[];
    const { client, api, close } = await connect(scopes, options.readOnly);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names.toSorted()).toEqual(
        availableToolNames(new Set(scopes), options.readOnly).toSorted(),
      );
      for (const name of readNames)
        expect(names.includes(name)).toBe(scopes.includes("finances:read"));
      expect(names.includes("preview_finance_review_batch")).toBe(options.preview);
      expect(names.includes("execute_finance_review_batch")).toBe(options.execute);
      for (const name of ["preview_finance_review_batch", "execute_finance_review_batch"]) {
        const tool = tools.find((entry) => entry.name === name);
        if (tool)
          expect(tool).toMatchObject({
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              openWorldHint: false,
              idempotentHint: name.startsWith("preview"),
            },
            outputSchema: { type: "object" },
            _meta: { "ilo/domain": "finances" },
          });
        else
          await expect(
            client.callTool({
              name,
              arguments: name.startsWith("preview") ? preview : { id, fingerprint },
            }),
          ).rejects.toThrow("not found");
      }
      expect(api.previewFinanceReviewBatch).not.toHaveBeenCalled();
      expect(api.executeFinanceReviewBatch).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("forwards validated inputs and preserves partial outcomes without automatically executing more work", async () => {
    const { client, api, result, close } = await connect();
    try {
      const calls = [
        ["get_finance_review_backlog", {}],
        ["list_finance_review_backlog_items", { group: "roundups", cursor: "snapshot", limit: 8 }],
        ["list_finance_review_batches", { limit: 4 }],
        ["get_finance_review_batch", { id }],
        ["preview_finance_review_batch", preview],
        ["execute_finance_review_batch", { id, fingerprint, limit: 2 }],
      ] as const;
      for (const [name, args] of calls) {
        const output = await client.callTool({ name, arguments: args });
        expect(output.isError).not.toBe(true);
        expect(output.structuredContent).toMatchObject({
          result: name === "list_finance_review_batches" ? [result] : result,
          _ilo: { domain: "finances" },
        });
        expect(output.content).toEqual([
          {
            type: "text",
            text: JSON.stringify(
              name === "list_finance_review_batches" ? [result] : result,
              null,
              2,
            ),
          },
        ]);
      }
      expect(api.getFinanceReviewBacklog).toHaveBeenCalledWith();
      expect(api.listFinanceReviewBacklogItems).toHaveBeenCalledWith({
        group: "roundups",
        cursor: "snapshot",
        limit: 8,
      });
      expect(api.listFinanceReviewBatches).toHaveBeenCalledWith({ limit: 4 });
      expect(api.getFinanceReviewBatch).toHaveBeenCalledWith(id);
      expect(api.previewFinanceReviewBatch).toHaveBeenCalledWith(preview);
      expect(api.executeFinanceReviewBatch).toHaveBeenCalledExactlyOnceWith(id, {
        fingerprint,
        limit: 2,
      });
    } finally {
      await close();
    }
  });

  it("rejects malformed, overlarge and authority-injecting inputs before API dispatch", async () => {
    const { client, api, close } = await connect();
    try {
      for (const input of [
        { id, fingerprint, limit: 11 },
        { id, fingerprint: "stale" },
        { id, fingerprint, bypassEnabled: true },
      ])
        expect(
          (await client.callTool({ name: "execute_finance_review_batch", arguments: input }))
            .isError,
        ).toBe(true);
      for (const input of [
        { ...preview, decisions: [] },
        { ...preview, decisions: Array(101).fill(decision) },
        { ...preview, decisions: [decision, decision] },
        { ...preview, decisions: [{ ...decision, learnMerchant: "always" }] },
        { ...preview, canSelfApprove: true },
      ])
        expect(
          (await client.callTool({ name: "preview_finance_review_batch", arguments: input }))
            .isError,
        ).toBe(true);
      expect(api.executeFinanceReviewBatch).not.toHaveBeenCalled();
      expect(api.previewFinanceReviewBatch).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("forwards authoritative revisions as exact decimal strings for both decision kinds", async () => {
    const { client, api, close } = await connect();
    try {
      for (const item of [
        decision,
        reviewDecision,
        { ...reviewDecision, expectedActionRevision: "9007199254740997" },
      ]) {
        const input = { idempotencyKey: "revision-preview", decisions: [item] };
        const output = await client.callTool({
          name: "preview_finance_review_batch",
          arguments: input,
        });
        expect(output.isError).not.toBe(true);
        expect(api.previewFinanceReviewBatch).toHaveBeenLastCalledWith(input);
      }
    } finally {
      await close();
    }
  });

  it("rejects timestamp-only manifests and missing or noncanonical authoritative revisions", async () => {
    const { client, api, close } = await connect();
    try {
      const { expectedTransactionRevision: _transactionRevision, ...timestampOnly } = decision;
      const { expectedReviewRevision: _reviewRevision, ...missingReviewRevision } = reviewDecision;
      const { expectedActionRevision: _actionRevision, ...missingActionRevision } = reviewDecision;
      const invalid: Record<string, unknown>[] = [
        timestampOnly,
        missingReviewRevision,
        missingActionRevision,
      ];
      for (const value of [undefined, null, 1, "", "-1", "1.5", "01", " 1", "1e3"]) {
        invalid.push({ ...decision, expectedTransactionRevision: value });
        invalid.push({ ...reviewDecision, expectedReviewRevision: value });
        invalid.push({ ...reviewDecision, expectedActionRevision: value });
      }
      invalid.push({ ...decision, expectedTransactionRevision: "0" });
      invalid.push({ ...reviewDecision, expectedReviewRevision: "0" });
      for (const item of invalid) {
        const output = await client.callTool({
          name: "preview_finance_review_batch",
          arguments: { idempotencyKey: "invalid-revision", decisions: [item] },
        });
        expect(output.isError).toBe(true);
      }
      expect(api.previewFinanceReviewBatch).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("preserves API policy denials and revision conflict recovery", async () => {
    const { client, api, close } = await connect();
    try {
      for (const code of ["forbidden", "conflict"]) {
        const error = {
          status: code === "forbidden" ? 403 : 409,
          code,
          message: "Current policy or revision rejected execution",
          details: { recovery: "new_preview" },
          requestId: "request",
        };
        api.executeFinanceReviewBatch.mockRejectedValueOnce(new ApiClientError(error));
        const output = await client.callTool({
          name: "execute_finance_review_batch",
          arguments: { id, fingerprint },
        });
        expect(output.isError).toBe(true);
        expect(output.structuredContent).toMatchObject({ error });
      }
    } finally {
      await close();
    }
  });
});
