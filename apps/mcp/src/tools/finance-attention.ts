import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  executeFinanceReviewBatchInputSchema,
  financeMonthSchema,
  idSchema,
  prepareFinanceEvidenceRefreshInputSchema,
  previewFinanceBudgetStartInputSchema,
  previewFinanceReviewBatchUndoInputSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";
export function registerFinanceAttentionTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_finance_review_batch_continuation",
    {
      title: "Read approved batch progress",
      description:
        "Read the exact owner's saved batch approval and durable continuation state. Does not approve, cancel or expand agent authority. Requires finances:read.",
      inputSchema: z.strictObject({ id: idSchema }),
    },
    async ({ id }) => apiResult(() => api.getFinanceBatchContinuation(id)),
  );
  server.registerTool(
    "get_finance_attention",
    {
      title: "Read active Finance attention",
      description:
        "Read the canonical active decisions, historical work, processing, blockers and budget readiness. Zero questions alone is not budget-ready. Requires finances:read.",
      inputSchema: z.strictObject({}),
    },
    async () => apiResult(() => api.getFinanceAttention()),
  );
  server.registerTool(
    "get_finance_budget_start",
    {
      title: "Read Finance starting month",
      description:
        "Read the approved first maintained month; historical work is retained, not resolved. Requires finances:read.",
      inputSchema: z.strictObject({}),
    },
    async () => apiResult(() => api.getFinanceBudgetStart()),
  );
  server.registerTool(
    "get_finance_budget_start_preview",
    {
      title: "Read starting-month preview",
      description:
        "Read an exact preview available to this authorization. The owner can approve it in Finance Chat; agent write access is not human approval. Requires finances:read.",
      inputSchema: z.strictObject({ id: idSchema }),
    },
    async ({ id }) => apiResult(() => api.getFinanceBudgetStartPreview(id)),
  );
  server.registerTool(
    "preview_finance_budget_start",
    {
      title: "Preview Finance starting month",
      description:
        "Prepare an exact current and proposed attention breakdown for an owner approval card. Does not change policy or clear records. Requires finances:read and finances:write.",
      inputSchema: previewFinanceBudgetStartInputSchema,
    },
    async (input) => apiResult(() => api.previewFinanceBudgetStart(input)),
  );
  server.registerTool(
    "get_finance_opening_position",
    {
      title: "Read qualified opening position",
      description:
        "Read exact opening balances or missing evidence for the selected month. Current balances and provider sync are not proof of historical completeness. Requires finances:read.",
      inputSchema: z.strictObject({ month: financeMonthSchema }),
    },
    async ({ month }) => apiResult(() => api.getFinanceOpeningPosition(month)),
  );
  server.registerTool(
    "prepare_finance_evidence_refresh",
    {
      title: "Prepare Finance evidence refresh",
      description:
        "Persist an exact-source refresh request using the existing provider scheduler. Read its saved outcome before retrying. Freshness and historical coverage are separate; this does not classify transactions. Requires finances:read, finances:write and finances:maintain.",
      inputSchema: prepareFinanceEvidenceRefreshInputSchema,
    },
    async (input) => apiResult(() => api.prepareFinanceEvidenceRefresh(input)),
  );
  server.registerTool(
    "get_finance_evidence_refresh",
    {
      title: "Read evidence refresh outcome",
      description:
        "Read the timestamped refresh receipt, pending work or exact recovery reason. A completed observation is not perpetual freshness. Requires finances:read.",
      inputSchema: z.strictObject({ id: idSchema }),
    },
    async ({ id }) => apiResult(() => api.getFinanceEvidenceRefresh(id)),
  );
  server.registerTool(
    "preview_finance_review_batch_undo",
    {
      title: "Preview Finance batch correction",
      description:
        "Prepare revision-safe compensating changes for exact completed batch outcomes. Refuses later edits and retains original audit evidence. Requires finances:read and finances:write.",
      inputSchema: previewFinanceReviewBatchUndoInputSchema,
    },
    async (input) => apiResult(() => api.previewFinanceReviewBatchUndo(input)),
  );
  server.registerTool(
    "get_finance_review_batch_undo",
    {
      title: "Read Finance batch correction",
      description:
        "Read a saved correction and its actual outcomes before retrying. Requires finances:read.",
      inputSchema: z.strictObject({ id: idSchema }),
    },
    async ({ id }) => apiResult(() => api.getFinanceReviewBatchUndo(id)),
  );
  server.registerTool(
    "execute_finance_review_batch_undo",
    {
      title: "Apply Finance batch correction",
      description:
        "Apply at most ten pending corrections from the exact preview fingerprint. Authorization, policy and later edits are checked again per effect. Only changes this agent applied under its own authority can be undone here; changes the owner executed or approved, including confirmed transfer pairs, are forbidden and need the owner to apply the published preview. Requires finances:read, finances:write and finances:execute.",
      inputSchema: executeFinanceReviewBatchInputSchema.extend({ id: idSchema }),
    },
    async ({ id, ...input }) => apiResult(() => api.executeFinanceReviewBatchUndo(id, input)),
  );
}
