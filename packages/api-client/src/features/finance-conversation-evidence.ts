import type {
  FinanceConversationEvidenceReadInput,
  FinanceConversationEvidenceReadResult,
} from "@personal-os/domain";
import type { FinanceRequest } from "./finances.js";
export function createFinanceConversationEvidenceApi(request: FinanceRequest) {
  return {
    getFinanceConversationEvidence(
      runId: string,
      input: FinanceConversationEvidenceReadInput,
    ): Promise<FinanceConversationEvidenceReadResult> {
      const query = new URLSearchParams({
        candidateId: input.candidateId,
        candidateRevision: input.candidateRevision,
      });
      if (input.cursor !== undefined) query.set("cursor", input.cursor);
      return request(
        `/v1/finances/conversation/batches/${encodeURIComponent(runId)}/evidence?${query}`,
      );
    },
  };
}
