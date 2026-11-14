import type {
  FinanceConversationAcknowledgmentInput,
  FinanceConversationAgentCardInput,
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
  FinanceConversationTurnPage,
} from "@personal-os/domain";
import type { FinanceRequest } from "./finances.js";

/** Shared authenticated transport; agent access uses bounded immutable batches/turns. */
export function createFinanceConversationApi(request: FinanceRequest) {
  const root = "/v1/finances/conversation";
  const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
  return {
    getFinanceAgentChat(
      query: {
        after?: string | undefined;
        before?: string | undefined;
        latest?: "true" | undefined;
        limit?: number | undefined;
      } = {},
    ) {
      const params = new URLSearchParams();
      for (const key of ["after", "before", "latest", "limit"] as const)
        if (query[key] !== undefined) params.set(key, String(query[key]));
      return request<FinanceConversationHistoryPage>(
        `${root}/agent/messages${params.size ? `?${params}` : ""}`,
      );
    },
    async publishFinanceAgentCard(input: FinanceConversationAgentCardInput) {
      return (
        await request<{ message: FinanceConversationMessage }>(`${root}/agent/cards`, post(input))
      ).message;
    },
    beginFinanceConversationTurn(scheduleId: string) {
      return request<FinanceConversationTurnPage>(
        `${root}/hosts/${encodeURIComponent(scheduleId)}/turns`,
        post({}),
      );
    },
    acknowledgeFinanceConversationTurn(
      turnId: string,
      input: FinanceConversationAcknowledgmentInput,
    ) {
      return request<{ acknowledgedMessageIds: string[] }>(
        `${root}/turns/${encodeURIComponent(turnId)}/acknowledgments`,
        post(input),
      );
    },
    async replyToFinanceConversationTurn(turnId: string, input: FinanceConversationReplyInput) {
      return (
        await request<{ message: FinanceConversationMessage }>(
          `${root}/turns/${encodeURIComponent(turnId)}/replies`,
          post(input),
        )
      ).message;
    },
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
    getFinanceConversationHistory(
      query: { after?: string; before?: string; latest?: true; limit?: number } = {},
    ) {
      const params = new URLSearchParams();
      if (query.after !== undefined) params.set("after", query.after);
      if (query.before !== undefined) params.set("before", query.before);
      if (query.latest) params.set("latest", "true");
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
