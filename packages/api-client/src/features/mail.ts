import type {
  Mailbox,
  MailDraftInput,
  MailListQuery,
  MailMessage,
  MailRuleInput,
  MailThread,
  SendMailInput,
  UpdateMailThreadInput,
} from "@personal-os/domain";

export type MailApiClient = {
  createMailDraft(input: MailDraftInput): Promise<{ id: string }>;
  createMailRule(input: MailRuleInput): Promise<{ id: string }>;
  getMailThread(id: string): Promise<MailThread>;
  listMailMessages(threadId: string): Promise<MailMessage[]>;
  listMailDrafts(): Promise<Array<{ body: string; id: string; subject: string }>>;
  listMailRules(): Promise<
    Array<{ action: string; enabled: boolean; id: string; name: string; query: string }>
  >;
  listMailboxes(): Promise<Mailbox[]>;
  listMailThreads(query?: Partial<MailListQuery>): Promise<MailThread[]>;
  snoozeMailThread(id: string, until: string): Promise<void>;
  sendMail(input: SendMailInput): Promise<void>;
  updateMailThread(id: string, input: UpdateMailThreadInput): Promise<MailThread>;
};

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Typed Mail API surface shared by the web app, MCP server, and consumers. */
export function createMailApiClient(
  request: Request,
  toQuery: (query: object) => string,
): MailApiClient {
  return {
    async createMailDraft(input) {
      const response = await request<{ draft: { id: string } }>("/v1/mail/drafts", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.draft;
    },
    async createMailRule(input) {
      const response = await request<{ rule: { id: string } }>("/v1/mail/rules", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.rule;
    },
    async getMailThread(id) {
      const response = await request<{ thread: MailThread }>(`/v1/mail/threads/${id}`);
      return response.thread;
    },
    async listMailMessages(threadId) {
      const response = await request<{ messages: MailMessage[] }>(
        `/v1/mail/threads/${threadId}/messages`,
      );
      return response.messages;
    },
    async listMailboxes() {
      const response = await request<{ mailboxes: Mailbox[] }>("/v1/mailboxes");
      return response.mailboxes;
    },
    async listMailDrafts() {
      const response = await request<{
        drafts: Array<{ body: string; id: string; subject: string }>;
      }>("/v1/mail/drafts");
      return response.drafts;
    },
    async listMailRules() {
      const response = await request<{
        rules: Array<{ action: string; enabled: boolean; id: string; name: string; query: string }>;
      }>("/v1/mail/rules");
      return response.rules;
    },
    async listMailThreads(query = {}) {
      const response = await request<{ threads: MailThread[] }>(
        `/v1/mail/threads?${toQuery(query)}`,
      );
      return response.threads;
    },
    async updateMailThread(id, input) {
      const response = await request<{ thread: MailThread }>(`/v1/mail/threads/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.thread;
    },
    async snoozeMailThread(id, until) {
      await request<void>(`/v1/mail/threads/${id}/snooze`, {
        body: JSON.stringify({ until }),
        method: "POST",
      });
    },
    async sendMail(input) {
      await request<void>("/v1/mail/send", { body: JSON.stringify(input), method: "POST" });
    },
  };
}
