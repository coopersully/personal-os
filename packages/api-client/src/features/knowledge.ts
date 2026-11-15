import {
  type KnowledgeExplainInput,
  type KnowledgeExportInput,
  type KnowledgeHistoryInput,
  type KnowledgeLifecycleInput,
  type KnowledgeMutationInput,
  type KnowledgeQuery,
  type KnowledgeReadInput,
  knowledgeContextExplanationSchema,
  knowledgeContextPackSchema,
  knowledgeMutationResultSchema,
  knowledgePageSchema,
  knowledgeReadResultSchema,
  knowledgeSaveResultSchema,
} from "@personal-os/domain";

const knowledgePath = "/v1/knowledge";
const recordPath = (id: string) => `${knowledgePath}/${encodeURIComponent(id)}`;
const json = (method: "POST", value: unknown): RequestInit => ({
  method,
  body: JSON.stringify(value),
});

/** Thin authenticated transport for account knowledge. */
export function createKnowledgeApiClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  return {
    async saveKnowledge(input: KnowledgeMutationInput) {
      return knowledgeSaveResultSchema.parse(await request(knowledgePath, json("POST", input)));
    },
    /** Returns the record, or a content-free tombstone when the owner reads a purged ID. */
    async getKnowledge({ id, purpose }: KnowledgeReadInput) {
      const query = purpose === undefined ? "" : `?${new URLSearchParams({ purpose })}`;
      const response = knowledgeReadResultSchema.parse(await request(`${recordPath(id)}${query}`));
      return "state" in response ? response : response.record;
    },
    async updateKnowledge({ recordId, ...action }: KnowledgeLifecycleInput) {
      return knowledgeMutationResultSchema.parse(
        await request(`${recordPath(recordId)}/actions`, json("POST", action)),
      );
    },
    async searchKnowledge(input: KnowledgeQuery) {
      return knowledgePageSchema.parse(
        await request(`${knowledgePath}/search`, json("POST", input)),
      );
    },
    async getKnowledgeHistory({ recordId, purpose, cursor }: KnowledgeHistoryInput) {
      const params = new URLSearchParams();
      if (purpose !== undefined) params.set("purpose", purpose);
      if (cursor !== undefined) params.set("cursor", cursor);
      const query = params.toString() ? `?${params}` : "";
      return knowledgePageSchema.parse(await request(`${recordPath(recordId)}/history${query}`));
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
  };
}
