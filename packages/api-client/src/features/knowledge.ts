import type {
  KnowledgeMutationInput,
  KnowledgeReadInput,
  KnowledgeReceipt,
  KnowledgeRecord,
} from "@personal-os/domain";

/** Thin authenticated transport for purpose-bound account knowledge. */
export function createKnowledgeApiClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  return {
    saveKnowledge(input: KnowledgeMutationInput): Promise<KnowledgeReceipt> {
      return request("/v1/knowledge", { method: "POST", body: JSON.stringify(input) });
    },
    async getKnowledge(input: KnowledgeReadInput): Promise<KnowledgeRecord> {
      const response = await request<{ record: KnowledgeRecord }>(
        `/v1/knowledge/${encodeURIComponent(input.id)}?purpose=${encodeURIComponent(input.purpose)}`,
      );
      return response.record;
    },
  };
}
