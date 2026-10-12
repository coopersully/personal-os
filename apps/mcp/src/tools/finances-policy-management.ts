import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  createFinanceBudgetPolicySchema,
  createFinanceBudgetRevisionProposalSchema,
  createFinanceContextualQuestionInputSchema,
  designateFinanceBudgetBaselineSchema,
  financeAnswerSchema,
  financeBudgetPolicyLifecycleSchema,
  idSchema,
  previewFinanceBudgetPolicySchema,
  reviseFinanceBudgetPolicySchema,
  saveFinanceBudgetPolicyPreviewSchema,
} from "@personal-os/domain";
import { apiResult } from "../tool-result.js";

export function registerFinancePolicyManagementTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_finance_budget_policy_preview",
    {
      title: "Get finance budget policy preview",
      description: "Read the persisted preview for an exact proposal. Requires finances:read.",
      inputSchema: { proposalId: idSchema, previewId: idSchema },
    },
    async ({ proposalId, previewId }) =>
      apiResult(() => api.getFinanceBudgetPolicyPreview(proposalId, previewId)),
  );

  server.registerTool(
    "get_finance_budget_policy",
    {
      title: "Get finance budget policy",
      description:
        "Read a policy definition and its explicit execution capability. Automatic policy execution is not implemented. Requires finances:read.",
      inputSchema: { policyId: idSchema },
    },
    async ({ policyId }) => apiResult(() => api.getFinanceBudgetPolicy(policyId)),
  );
  server.registerTool(
    "create_finance_budget_policy",
    {
      title: "Create finance budget policy",
      description:
        "Save a draft budget policy with an idempotency key. This does not enable automatic execution. Requires finances:write. Agents also require finances:execute and enabled review bypass.",
      inputSchema: createFinanceBudgetPolicySchema,
    },
    async (input) => apiResult(() => api.createFinanceBudgetPolicy(input)),
  );
  server.registerTool(
    "revise_finance_budget_policy",
    {
      title: "Revise finance budget policy",
      description:
        "Revise a policy against its exact expected revision. This does not enable execution. Requires finances:write. Agents also require finances:execute and enabled review bypass.",
      inputSchema: reviseFinanceBudgetPolicySchema.safeExtend({ policyId: idSchema }),
    },
    async ({ policyId, ...input }) =>
      apiResult(() => api.reviseFinanceBudgetPolicy(policyId, input)),
  );
  server.registerTool(
    "disable_finance_budget_policy",
    {
      title: "Disable finance budget policy",
      description:
        "Disable the exact observed policy revision. Requires finances:write. Agents also require finances:execute and enabled review bypass.",
      inputSchema: financeBudgetPolicyLifecycleSchema.safeExtend({ policyId: idSchema }),
    },
    async ({ policyId, ...input }) =>
      apiResult(() => api.disableFinanceBudgetPolicy(policyId, input)),
  );
  server.registerTool(
    "designate_finance_budget_baseline",
    {
      title: "Designate finance budget baseline",
      description:
        "Designate the exact approved budget version as a period baseline. Requires finances:write. Agents also require finances:execute and enabled review bypass.",
      inputSchema: designateFinanceBudgetBaselineSchema,
    },
    async (input) => apiResult(() => api.designateFinanceBudgetBaseline(input)),
  );
  server.registerTool(
    "preview_finance_budget_policy",
    {
      title: "Preview finance budget policy",
      description:
        "Evaluate a policy against qualified position evidence. This computes a read-only preview and never activates execution. Requires finances:read; review bypass is not required.",
      inputSchema: previewFinanceBudgetPolicySchema,
    },
    async (input) => apiResult(() => api.previewFinanceBudgetPolicy(input)),
  );
  server.registerTool(
    "create_finance_budget_revision_proposal",
    {
      title: "Create finance budget revision proposal",
      description:
        "Persist a bounded proposal with its policy, baseline, and position references. Requires finances:write. Agents also require finances:execute and enabled review bypass.",
      inputSchema: createFinanceBudgetRevisionProposalSchema,
    },
    async (input) => apiResult(() => api.createFinanceBudgetRevisionProposal(input)),
  );
  server.registerTool(
    "get_finance_budget_revision_proposal",
    {
      title: "Get finance budget revision proposal",
      description:
        "Read the stored proposal, revision and evidence binding. Requires finances:read.",
      inputSchema: { proposalId: idSchema },
    },
    async ({ proposalId }) => apiResult(() => api.getFinanceBudgetRevisionProposal(proposalId)),
  );
  server.registerTool(
    "withdraw_finance_budget_revision_proposal",
    {
      title: "Withdraw finance budget revision proposal",
      description:
        "Withdraw the exact observed proposal revision. Requires finances:write. Agents also require finances:execute and enabled review bypass.",
      inputSchema: financeBudgetPolicyLifecycleSchema.safeExtend({ proposalId: idSchema }),
    },
    async ({ proposalId, ...input }) =>
      apiResult(() => api.withdrawFinanceBudgetRevisionProposal(proposalId, input)),
  );
  server.registerTool(
    "save_finance_budget_policy_preview",
    {
      title: "Save finance budget policy preview",
      description:
        "Save the policy preview for the exact proposal revision. This does not activate a budget. Requires finances:write. Agents also require finances:execute and enabled review bypass.",
      inputSchema: saveFinanceBudgetPolicyPreviewSchema.safeExtend({ proposalId: idSchema }),
    },
    async ({ proposalId, ...input }) =>
      apiResult(() => api.saveFinanceBudgetPolicyPreview(proposalId, input)),
  );
  server.registerTool(
    "create_finance_contextual_question",
    {
      title: "Create finance contextual question",
      description:
        "Create an evidence-bound contextual question for an owned transaction. Requires finances:write. Agents also require finances:execute and enabled review bypass.",
      inputSchema: createFinanceContextualQuestionInputSchema.safeExtend({
        transactionId: idSchema,
      }),
    },
    async ({ transactionId, ...input }) =>
      apiResult(() => api.createFinanceContextualQuestion(transactionId, input)),
  );
  server.registerTool(
    "get_finance_contextual_question",
    {
      title: "Get finance contextual question",
      description:
        "Read a contextual question and its required answer contract. Requires finances:read.",
      inputSchema: { questionId: idSchema },
    },
    async ({ questionId }) => apiResult(() => api.getFinanceContextualQuestion(questionId)),
  );
  server.registerTool(
    "answer_finance_contextual_question",
    {
      title: "Answer finance contextual question",
      description:
        "Answer an exact contextual question with provenance and an idempotency key. Do not fabricate missing evidence. Requires finances:write.",
      inputSchema: financeAnswerSchema,
    },
    async (input) => apiResult(() => api.answerFinanceContextualQuestion(input)),
  );
  server.registerTool(
    "approve_finance_action_review",
    {
      title: "Approve finance action review",
      description:
        "Execute the exact pending action after inspecting its evidence. The API revalidates the proposal and records the agent identity. Requires finances:write. Agents also require finances:execute and enabled review bypass.",
      inputSchema: { reviewId: idSchema },
    },
    async ({ reviewId }) => apiResult(() => api.approveFinanceActionReview(reviewId)),
  );
  server.registerTool(
    "dismiss_finance_action_review",
    {
      title: "Dismiss finance action review",
      description:
        "Dismiss an owned pending action review while preserving its history. Requires finances:write. Agents also require finances:execute and enabled review bypass.",
      inputSchema: { reviewId: idSchema },
    },
    async ({ reviewId }) => apiResult(() => api.dismissFinanceActionReview(reviewId)),
  );
}
