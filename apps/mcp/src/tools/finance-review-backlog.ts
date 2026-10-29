import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  executeFinanceReviewBatchInputSchema,
  financeReviewBacklogQuerySchema,
  idSchema,
  listFinanceReviewBatchesInputSchema,
  previewFinanceReviewBatchInputSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

export function registerFinanceReviewBacklogTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_finance_review_backlog",
    {
      title: "Assess Finance review backlog",
      description:
        "Read complete historical backlog counts, separating transaction flags from open and deferred review cases. Grouping is a routing hint, not permission to resolve items. Requires finances:read.",
      inputSchema: z.strictObject({}),
    },
    async () => apiResult(() => api.getFinanceReviewBacklog()),
  );
  server.registerTool(
    "list_finance_review_backlog_items",
    {
      title: "List Finance review backlog items",
      description:
        "Inspect a bounded page of backlog evidence. Preserve the snapshot cursor; restart on a snapshot conflict. Requires finances:read.",
      inputSchema: financeReviewBacklogQuerySchema,
    },
    async (input) => apiResult(() => api.listFinanceReviewBacklogItems(input)),
  );
  server.registerTool(
    "preview_finance_review_batch",
    {
      title: "Preview Finance review batch",
      description:
        "Persist up to 100 explicit evidence-backed decisions with required timestamps and authoritative decimal-string revisions from backlog provenance: expectedTransactionRevision for every decision, plus expectedReviewRevision and expectedActionRevision for review decisions. Include an idempotency key. This creates durable preview state; it does not execute decisions or learn merchant rules. Requires finances:read and finances:write.",
      inputSchema: previewFinanceReviewBatchInputSchema,
    },
    async (input) => apiResult(() => api.previewFinanceReviewBatch(input)),
  );
  server.registerTool(
    "list_finance_review_batches",
    {
      title: "List Finance review batches",
      description:
        "Read recent durable review batches available to this authenticated authorization, including progress and recovery outcomes. Requires finances:read.",
      inputSchema: listFinanceReviewBatchesInputSchema,
    },
    async (input) => apiResult(() => api.listFinanceReviewBatches(input)),
  );
  server.registerTool(
    "get_finance_review_batch",
    {
      title: "Get Finance review batch",
      description:
        "Read one durable review batch and its applied, deferred, review-required, or failed outcomes. Requires finances:read.",
      inputSchema: z.strictObject({ id: idSchema }),
    },
    async ({ id }) => apiResult(() => api.getFinanceReviewBatch(id)),
  );
  server.registerTool(
    "execute_finance_review_batch",
    {
      title: "Execute Finance review batch",
      description:
        "Resume at most 10 pending decisions from the exact persisted preview fingerprint. Inspect returned outcomes and pendingCount before continuing. Requires finances:read, finances:write, and finances:execute; the API rechecks current authorization, policy, and record revisions for each decision.",
      inputSchema: executeFinanceReviewBatchInputSchema.extend({ id: idSchema }),
    },
    async ({ id, ...input }) => apiResult(() => api.executeFinanceReviewBatch(id, input)),
  );
}
