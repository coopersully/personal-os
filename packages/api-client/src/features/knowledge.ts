import {
  activeKnowledgeForgetOperationsSchema,
  type KnowledgeExplainInput,
  type KnowledgeExportInput,
  type KnowledgeForgetInput,
  type KnowledgeForgetOperationInput,
  type KnowledgeForgetPreviewInput,
  type KnowledgeHistoryInput,
  type KnowledgeLifecycleInput,
  type KnowledgeMutationInput,
  type KnowledgeQuery,
  type KnowledgeReadInput,
  type KnowledgeSelectionInput,
  type KnowledgeSettingsInput,
  type KnowledgeSuppressionResetInput,
  knowledgeContextExplanationSchema,
  knowledgeContextPackSchema,
  knowledgeForgetPreviewSchema,
  knowledgeForgetStatusSchema,
  knowledgeMutationResultSchema,
  knowledgePageSchema,
  knowledgeReadResultSchema,
  knowledgeSaveResultSchema,
  knowledgeSelectionInteractionSchema,
  knowledgeSelectionResultSchema,
  knowledgeSettingsSchema,
  knowledgeSuppressionResetResultSchema,
} from "@personal-os/domain";

const knowledgePath = "/v1/knowledge";
const recordPath = (id: string) => `${knowledgePath}/${encodeURIComponent(id)}`;
const operationPath = (id: string) => `${knowledgePath}/operations/${encodeURIComponent(id)}`;
const json = (method: "POST" | "PATCH", value: unknown): RequestInit => ({
  method,
  body: JSON.stringify(value),
});

/** Thin authenticated transport for purpose-bound account knowledge. */
export function createKnowledgeApiClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  return {
    async saveKnowledge(input: KnowledgeMutationInput) {
      return knowledgeSaveResultSchema.parse(await request(knowledgePath, json("POST", input)));
    },
    async getKnowledge({ id, purpose }: KnowledgeReadInput) {
      const response = await request(`${recordPath(id)}?${new URLSearchParams({ purpose })}`);
      return knowledgeReadResultSchema.parse(response).record;
    },
    async updateKnowledge({ recordId, ...action }: KnowledgeLifecycleInput) {
      return knowledgeMutationResultSchema.parse(
        await request(`${recordPath(recordId)}/actions`, json("POST", action)),
      );
    },
    async previewKnowledgeForget({ recordId, ...body }: KnowledgeForgetPreviewInput) {
      return knowledgeForgetPreviewSchema.parse(
        await request(`${recordPath(recordId)}/forget-preview`, json("POST", body)),
      );
    },
    async forgetKnowledge(input: KnowledgeForgetInput) {
      return knowledgeMutationResultSchema.parse(
        await request(`${knowledgePath}/forget`, json("POST", input)),
      );
    },
    async listActiveKnowledgeForgetOperations() {
      return activeKnowledgeForgetOperationsSchema.parse(
        await request(`${knowledgePath}/operations`),
      );
    },
    async getKnowledgeForgetStatus({ operationId }: KnowledgeForgetOperationInput) {
      return knowledgeForgetStatusSchema.parse(await request(operationPath(operationId)));
    },
    async retryKnowledgeForget({ operationId }: KnowledgeForgetOperationInput) {
      return knowledgeForgetStatusSchema.parse(
        await request(`${operationPath(operationId)}/retry`, { method: "POST" }),
      );
    },
    async searchKnowledge(input: KnowledgeQuery) {
      return knowledgePageSchema.parse(
        await request(`${knowledgePath}/search`, json("POST", input)),
      );
    },
    async getKnowledgeHistory({ recordId, purpose, cursor }: KnowledgeHistoryInput) {
      const params = new URLSearchParams({ purpose });
      if (cursor !== undefined) params.set("cursor", cursor);
      return knowledgePageSchema.parse(await request(`${recordPath(recordId)}/history?${params}`));
    },
    async getKnowledgeContext(input: KnowledgeQuery) {
      return knowledgeContextPackSchema.parse(
        await request(`${knowledgePath}/context`, json("POST", input)),
      );
    },
    async explainKnowledgeContext({ contextUseId }: KnowledgeExplainInput) {
      return knowledgeContextExplanationSchema.parse(
        await request(`${knowledgePath}/context/${encodeURIComponent(contextUseId)}`),
      );
    },
    async exportKnowledge({ cursor }: KnowledgeExportInput = {}) {
      const path = `${knowledgePath}/export`;
      return knowledgePageSchema.parse(
        await request(cursor === undefined ? path : `${path}?${new URLSearchParams({ cursor })}`),
      );
    },
    async getKnowledgeSettings() {
      return knowledgeSettingsSchema.parse(await request(`${knowledgePath}/settings`));
    },
    async updateKnowledgeSettings(input: KnowledgeSettingsInput) {
      return knowledgeSettingsSchema.parse(
        await request(`${knowledgePath}/settings`, json("PATCH", input)),
      );
    },
    async issueKnowledgeSelectionInteraction() {
      return knowledgeSelectionInteractionSchema.parse(
        await request(`${knowledgePath}/selection-interactions`, { method: "POST" }),
      );
    },
    async recordKnowledgeSelection(input: KnowledgeSelectionInput) {
      return knowledgeSelectionResultSchema.parse(
        await request(`${knowledgePath}/selections`, json("POST", input)),
      );
    },
    async resetKnowledgeLearning(input: KnowledgeSuppressionResetInput) {
      return knowledgeSuppressionResetResultSchema.parse(
        await request(`${knowledgePath}/learning-reset`, json("POST", input)),
      );
    },
  };
}
