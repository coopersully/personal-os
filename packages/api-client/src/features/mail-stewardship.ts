import type {
  AnswerMailQuestionInput,
  CreateMailObligationInput,
  CreateMailStewardshipFeedbackInput,
  MailDisposition,
  MailMaintenanceDispatchResult,
  MailObligation,
  MailResponseBrief,
  MailReview,
  MailStatus,
  MailStewardshipFeedback,
  MailStewardshipQuestion,
  MailThreadStewardship,
  MaintenanceRun,
  MaintenanceScope,
  PreviewMailResponseBriefInput,
  SetMailDispositionInput,
  UpdateMailObligationInput,
} from "@personal-os/domain";

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Thin transport for Mail intents; sequencing and settlement remain server-owned. */
export function createMailStewardshipApiClient(request: Request) {
  return {
    async getMailStatus(): Promise<MailStatus> {
      const response = await request<{ status: MailStatus }>("/v1/mail/status");
      return response.status;
    },
    async maintainMail(input: { scope: MaintenanceScope }): Promise<MailMaintenanceDispatchResult> {
      return request<MailMaintenanceDispatchResult>("/v1/mail/maintenance", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async getMailMaintenanceRun(id: string): Promise<MaintenanceRun> {
      const response = await request<{ run: MaintenanceRun }>(`/v1/mail/maintenance/${id}`);
      return response.run;
    },
    async getMailReview(id: string): Promise<MailReview> {
      const response = await request<{ review: MailReview }>(`/v1/mail/reviews/${id}`);
      return response.review;
    },
    async getMailThreadStewardship(id: string): Promise<MailThreadStewardship> {
      const response = await request<{ stewardship: MailThreadStewardship }>(
        `/v1/mail/threads/${id}/stewardship`,
      );
      return response.stewardship;
    },
    async previewMailResponseBrief(
      threadId: string,
      input: PreviewMailResponseBriefInput,
    ): Promise<MailResponseBrief> {
      const response = await request<{ brief: MailResponseBrief }>(
        `/v1/mail/threads/${threadId}/response-brief/preview`,
        { body: JSON.stringify(input), method: "POST" },
      );
      return response.brief;
    },
    async setMailDisposition(
      threadId: string,
      input: SetMailDispositionInput,
    ): Promise<MailDisposition> {
      const response = await request<{ disposition: MailDisposition }>(
        `/v1/mail/threads/${threadId}/disposition`,
        { body: JSON.stringify(input), method: "PUT" },
      );
      return response.disposition;
    },
    async createMailObligation(
      threadId: string,
      input: CreateMailObligationInput,
    ): Promise<MailObligation> {
      const response = await request<{ obligation: MailObligation }>(
        `/v1/mail/threads/${threadId}/obligations`,
        { body: JSON.stringify(input), method: "POST" },
      );
      return response.obligation;
    },
    async updateMailObligation(
      id: string,
      input: UpdateMailObligationInput,
    ): Promise<MailObligation> {
      const response = await request<{ obligation: MailObligation }>(`/v1/mail/obligations/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.obligation;
    },
    async answerMailQuestion(
      id: string,
      input: AnswerMailQuestionInput,
    ): Promise<MailStewardshipQuestion> {
      const response = await request<{ question: MailStewardshipQuestion }>(
        `/v1/mail/questions/${id}/answer`,
        { body: JSON.stringify(input), method: "POST" },
      );
      return response.question;
    },
    async createMailStewardshipFeedback(
      input: CreateMailStewardshipFeedbackInput,
    ): Promise<MailStewardshipFeedback> {
      const response = await request<{ feedback: MailStewardshipFeedback }>("/v1/mail/feedback", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.feedback;
    },
  };
}
