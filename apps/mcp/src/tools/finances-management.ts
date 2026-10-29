import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  createFinanceAccountInputSchema,
  createFinanceCategoryInputSchema,
  disconnectFinanceAccountInputSchema,
  financeBudgetPacePeriodSchema,
  financeBudgetPolicyListSchema,
  financePositionReadScopeSchema,
  financeReviewDecisionInputSchema,
  financeReviewHistoryQuerySchema,
  idSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

export function registerFinanceManagementTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_finance_profile",
    {
      title: "Get Finance planning profile",
      description:
        "Read current income, employment, household and reserve assumptions, including updatedAt for update_finance_profile. Returns null until configured. Distinct from get_financial_profile, which reads the versioned complete-budget profile. Requires finances:read.",
      inputSchema: {},
    },
    async () => apiResult(() => api.getFinanceProfile()),
  );

  server.registerTool(
    "resolve_finance_transaction_review",
    {
      title: "Resolve Finance transaction review",
      description:
        "Resolve an owned transaction review: approve, recategorize, explicitly confirm a transfer, or defer. Read list_finance_reviews for reviewId, then get_finance_transaction for the exact expectedTransactionUpdatedAt. Non-deferred agent decisions must match the current server proposal from propose_finance_categorizations, including its confidence and evidence threshold. Bypass does not let an agent confirm an unresolved ambiguous transfer; defer it for owner evidence. learnMerchant always creates a reusable rule and requires explicit intent. Requires finances:write, finances:execute and enabled review bypass. This does not answer contextual questions or approve queued action reviews.",
      inputSchema: financeReviewDecisionInputSchema.safeExtend({ reviewId: idSchema }),
    },
    async ({ reviewId, ...input }) => apiResult(() => api.resolveFinanceReview(reviewId, input)),
  );
  server.registerTool(
    "get_finance_category_budget_status",
    {
      title: "Get Finance category budget status",
      description:
        "Read monthly category budget limits, actual spending and remaining amounts. This is the category budget view; get_finance_budget_status reads the active versioned allocation plan. Omit month for the current planning month. Requires finances:read.",
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
      },
    },
    async ({ month }) => apiResult(() => api.getFinanceBudgetStatus(month)),
  );
  server.registerTool(
    "get_finance_connection_capabilities",
    {
      title: "Get Finance connection capabilities",
      description:
        "Check whether bank connectivity is configured before starting provider consent. Configuration availability alone does not prove provider authentication or a working bank connection. Requires finances:read.",
      inputSchema: {},
    },
    async () => apiResult(() => api.getPlaidStatus()),
  );

  server.registerTool(
    "get_finance_configuration",
    {
      title: "Get finance configuration",
      description:
        "Read financial configuration, readiness, saved preferences and section availability. Missing sections remain unavailable, not empty. Requires finances:read.",
      inputSchema: {},
    },
    async () => apiResult(() => api.getFinanceConfiguration()),
  );
  server.registerTool(
    "get_finance_budget_pace",
    {
      title: "Get finance budget pace",
      description:
        "Read budget pace for week, month, or year with actual spending and period boundaries. Requires finances:read.",
      inputSchema: { period: financeBudgetPacePeriodSchema },
    },
    async ({ period }) => apiResult(() => api.getFinanceBudgetPace(period)),
  );
  server.registerTool(
    "get_finance_position",
    {
      title: "Get finance position",
      description:
        "Read ownership-qualified financial position for the inclusive date range and optional canonical account IDs. Requires finances:read.",
      inputSchema: financePositionReadScopeSchema,
    },
    async (input) => apiResult(() => api.getFinancePosition(input)),
  );
  server.registerTool(
    "list_finance_review_history",
    {
      title: "List finance review history",
      description:
        "Read a bounded cursor page of resolved Finance reviews and retained evidence. Keep the same filters when following nextCursor. Requires finances:read.",
      inputSchema: financeReviewHistoryQuerySchema,
    },
    async (input) => apiResult(() => api.listFinanceReviewHistory(input)),
  );
  server.registerTool(
    "get_finance_review_history_item",
    {
      title: "Get finance review history item",
      description:
        "Read a retained Finance review, provenance, and availability of its related transaction. Requires finances:read.",
      inputSchema: { reviewId: idSchema },
    },
    async ({ reviewId }) => apiResult(() => api.getFinanceReviewHistoryItem(reviewId)),
  );
  server.registerTool(
    "get_finance_maintenance_run",
    {
      title: "Get finance maintenance run",
      description:
        "Inspect a durable Finance maintenance run by its returned run ID; do not infer completion from acceptance. Requires finances:read.",
      inputSchema: { runId: idSchema },
    },
    async ({ runId }) => apiResult(() => api.getFinanceMaintenanceRun(runId)),
  );
  server.registerTool(
    "list_finance_questions",
    {
      title: "List finance questions",
      description:
        "Read bounded outstanding Finance questions, including the evidence required to answer each. Requires finances:read.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(50),
        questionId: idSchema.optional(),
      },
    },
    async ({ limit, questionId }) => apiResult(() => api.listFinanceQuestions(limit, questionId)),
  );
  server.registerTool(
    "list_finance_action_reviews",
    {
      title: "List finance action reviews",
      description:
        "Inspect pending Finance action approvals and their exact proposed effects. Requires finances:read.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(50),
        reviewId: idSchema.optional(),
      },
    },
    async ({ limit, reviewId }) => apiResult(() => api.listFinanceActionReviews(limit, reviewId)),
  );
  server.registerTool(
    "list_finance_budget_policies",
    {
      title: "List finance budget policies",
      description:
        "Read a bounded page of budget policy definitions. Policy management is available; automatic policy execution remains explicitly unavailable. Requires finances:read.",
      inputSchema: financeBudgetPolicyListSchema,
    },
    async (input) => apiResult(() => api.listFinanceBudgetPolicies(input)),
  );
  server.registerTool(
    "create_finance_account",
    {
      title: "Create finance account",
      description:
        "Create a manually maintained financial account. Balance is a decimal currency amount, not integer cents. Bank authentication uses start_finance_account_connection. Requires finances:write, finances:execute and enabled review bypass for agents.",
      inputSchema: createFinanceAccountInputSchema,
    },
    async (input) => apiResult(() => api.createFinanceAccount(input)),
  );
  server.registerTool(
    "create_finance_category",
    {
      title: "Create finance category",
      description:
        "Create a named financial category; inspect get_finance_categories first to avoid duplicates. Category icons are assigned automatically from meaning; do not ask about or narrate cosmetic icon choices unless the user requests them. Requires finances:write, finances:execute and enabled review bypass for agents.",
      inputSchema: createFinanceCategoryInputSchema,
    },
    async (input) => apiResult(() => api.createFinanceCategory(input)),
  );
  server.registerTool(
    "disconnect_finance_account",
    {
      title: "Disconnect finance account",
      description:
        "Disconnect an owned financial source while retaining ledger history. Use an idempotency key and verify its returned lifecycle state. Requires finances:write, finances:execute and enabled review bypass for agents.",
      inputSchema: disconnectFinanceAccountInputSchema.extend({ accountId: idSchema }),
    },
    async ({ accountId, ...input }) =>
      apiResult(() => api.disconnectFinanceAccount(accountId, input)),
  );
  server.registerTool(
    "delete_finance_account",
    {
      title: "Delete finance account",
      description:
        "Delete an owned financial account through its domain lifecycle. Inspect account and related ledger evidence first. Requires finances:write, finances:execute and enabled review bypass for agents.",
      inputSchema: { accountId: idSchema },
    },
    async ({ accountId }) =>
      apiResult(() =>
        (async () => {
          await api.deleteFinanceAccount(accountId);
          return { deleted: true, accountId };
        })(),
      ),
  );
}
