import type {
  FinanceConversationAcknowledgmentInput,
  FinanceConversationBatchPage,
  FinanceConversationChallenge,
  FinanceConversationHistoryPage,
  FinanceConversationMessage,
  FinanceConversationMessageContext,
  FinanceConversationProofOperation,
  FinanceConversationProofResult,
  FinanceConversationReadiness,
  FinanceConversationReplyInput,
  FinanceConversationSendInput,
} from "@personal-os/domain";
import type { FinanceRequest } from "./finances.js";

/** Uses the shared authenticated transport; agents have no live history/queue operation. */
export function createFinanceConversationApi(request: FinanceRequest) {
  const root = "/v1/finances/conversation";
  const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
  return {
    async getFinanceConversationReadiness() {
      return (await request<{ readiness: FinanceConversationReadiness }>(`${root}/readiness`))
        .readiness;
    },
    async getFinanceConversationHostReadiness(scheduleId: string) {
      return (
        await request<{ readiness: FinanceConversationReadiness }>(
          `${root}/hosts/${encodeURIComponent(scheduleId)}/readiness`,
        )
      ).readiness;
    },
    getFinanceConversationHistory(query: { after?: string; limit?: number } = {}) {
      const params = new URLSearchParams();
      if (query.after !== undefined) params.set("after", query.after);
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      return request<FinanceConversationHistoryPage>(
        `${root}/messages${params.size ? `?${params}` : ""}`,
      );
    },
    getFinanceConversationMessageContext(messageId: string) {
      return request<FinanceConversationMessageContext>(
        `${root}/messages/${encodeURIComponent(messageId)}/context`,
      );
    },
    async sendFinanceConversationMessage(input: FinanceConversationSendInput) {
      return (
        await request<{ message: FinanceConversationMessage }>(`${root}/messages`, post(input))
      ).message;
    },
    markFinanceConversationRendered(throughSequence: string) {
      return request<{ readThroughSequence: string }>(
        `${root}/rendered`,
        post({ throughSequence }),
      );
    },
    getFinanceConversationBatch(runId: string, query: { cursor?: string; limit?: number } = {}) {
      const params = new URLSearchParams();
      if (query.cursor !== undefined) params.set("cursor", query.cursor);
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      return request<FinanceConversationBatchPage>(
        `${root}/batches/${encodeURIComponent(runId)}${params.size ? `?${params}` : ""}`,
      );
    },
    acknowledgeFinanceConversationBatch(
      runId: string,
      input: FinanceConversationAcknowledgmentInput,
    ) {
      return request<{ acknowledgedMessageIds: string[] }>(
        `${root}/batches/${encodeURIComponent(runId)}/acknowledgments`,
        post(input),
      );
    },
    async replyToFinanceConversationBatch(runId: string, input: FinanceConversationReplyInput) {
      return (
        await request<{ message: FinanceConversationMessage }>(
          `${root}/batches/${encodeURIComponent(runId)}/replies`,
          post(input),
        )
      ).message;
    },
    async issueFinanceConversationChallenge(scheduleId: string) {
      return (
        await request<{ challenge: FinanceConversationChallenge }>(
          `${root}/hosts/${encodeURIComponent(scheduleId)}/challenges`,
          post({}),
        )
      ).challenge;
    },
    exchangeFinanceConversationChallenge(
      challengeId: string,
      input: FinanceConversationProofOperation,
    ) {
      return request<FinanceConversationProofResult>(
        `${root}/challenges/${encodeURIComponent(challengeId)}/exchange`,
        post(input),
      );
    },
  };
}
