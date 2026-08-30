import type {
  CheckTextingVerificationInput,
  SendTextMessageInput,
  StartTextingVerificationInput,
  TextConversationPage,
  TextConversationQuery,
  TextingConnection,
  TextingVerificationChallenge,
  TextMessage,
} from "@personal-os/domain";

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export function createTextingApiClient(request: Request, toQuery: (query: object) => string) {
  return {
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
