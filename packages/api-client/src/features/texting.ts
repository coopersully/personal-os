import type {
  CheckTextingVerificationInput,
  FinanceTextReplyStatus,
  NotificationAttemptDetail,
  NotificationPreferences,
  NotificationStatus,
  SendTextMessageInput,
  StartTextingVerificationInput,
  TextConversationPage,
  TextConversationQuery,
  TextingAgentCheckpoint,
  TextingAgentClaim,
  TextingAgentClaimInput,
  TextingAgentRecovery,
  TextingAgentReply,
  TextingAgentRun,
  TextingAgentSettingsInput,
  TextingAgentStatus,
  TextingConnection,
  TextingVerificationChallenge,
  TextMessage,
} from "@personal-os/domain";

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export function createTextingApiClient(request: Request, toQuery: (query: object) => string) {
  return {
    recoverTextingAgentRun: (runId: string, input: TextingAgentRecovery) =>
      request<TextingAgentStatus>(`/v1/texting/agent/runs/${encodeURIComponent(runId)}/recover`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    getTextingAgentStatus: (input: { beforeRun?: string } = {}) =>
      request<TextingAgentStatus>(
        `/v1/texting/agent${input.beforeRun ? `?${toQuery(input)}` : ""}`,
        { cache: "no-store" },
      ),
    configureTextingAgent: (input: TextingAgentSettingsInput) =>
      request<TextingAgentStatus>("/v1/texting/agent", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    claimTextingAgentRun: (runId: string, input: TextingAgentClaimInput) =>
      request<TextingAgentClaim>(`/v1/texting/agent/runs/${encodeURIComponent(runId)}/claim`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    checkpointTextingAgentRun: (runId: string, input: TextingAgentCheckpoint) =>
      request<TextingAgentRun>(`/v1/texting/agent/runs/${encodeURIComponent(runId)}/checkpoint`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    replyToTextingAgentRun: (runId: string, input: TextingAgentReply) =>
      request<TextingAgentRun>(`/v1/texting/agent/runs/${encodeURIComponent(runId)}/reply`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    async getFinanceTextReplyStatus(inboundMessageId: string): Promise<FinanceTextReplyStatus> {
      return request(`/v1/texting/finance-replies/${encodeURIComponent(inboundMessageId)}/status`);
    },
    async getNotificationAttempt(attemptId: string): Promise<NotificationAttemptDetail> {
      return request(`/v1/texting/notifications/attempts/${encodeURIComponent(attemptId)}`, {
        cache: "no-store",
      });
    },
    async getNotificationStatus(): Promise<NotificationStatus> {
      return request("/v1/texting/notifications");
    },
    async resetFinanceNotificationPreferences(input: {
      expectedRevision: number;
    }): Promise<{ scope: "finances"; inherited: true }> {
      return request("/v1/texting/notifications/preferences/finances", {
        method: "DELETE",
        body: JSON.stringify(input),
      });
    },
    async saveNotificationPreferences(
      scope: "global" | "finances",
      input: {
        expectedRevision: number | null;
        preferences: NotificationPreferences;
      },
    ): Promise<{
      scope: "global" | "finances";
      revision: number;
      preferences: NotificationPreferences;
    }> {
      return request(`/v1/texting/notifications/preferences/${scope}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async checkTextingVerification(
      id: string,
      input: CheckTextingVerificationInput,
    ): Promise<TextingConnection> {
      const response = await request<{ connection: TextingConnection }>(
        `/v1/texting/verification/${id}/check`,
        { body: JSON.stringify(input), method: "POST" },
      );
      return response.connection;
    },
    async disconnectTexting(): Promise<void> {
      await request<void>("/v1/texting", { method: "DELETE" });
    },
    async getTextConversation(
      timeZone: string,
      query: Partial<TextConversationQuery> = {},
    ): Promise<TextConversationPage> {
      return request(`/v1/texting/conversation?${toQuery({ ...query, timeZone })}`);
    },
    async getTextingConnection(): Promise<TextingConnection> {
      return (await request<{ connection: TextingConnection }>("/v1/texting")).connection;
    },
    async sendTextMessage(timeZone: string, input: SendTextMessageInput): Promise<TextMessage> {
      return (
        await request<{ message: TextMessage }>(`/v1/texting/messages?${toQuery({ timeZone })}`, {
          body: JSON.stringify(input),
          method: "POST",
        })
      ).message;
    },
    async startTextingVerification(
      input: StartTextingVerificationInput,
    ): Promise<TextingVerificationChallenge> {
      return (
        await request<{ challenge: TextingVerificationChallenge }>("/v1/texting/verification", {
          body: JSON.stringify(input),
          method: "POST",
        })
      ).challenge;
    },
  };
}
