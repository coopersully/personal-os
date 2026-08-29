import type {
  ActivateMailRuleInput,
  AttentionItem,
  BulkUpdateMailInput,
  BulkUpdateMailResult,
  CreateMailDraftInput,
  CreateMailRuleInput,
  LegacyMailDraft,
  MailDraft,
  Mailbox,
  MailListQuery,
  MailMessage,
  MailRule,
  MailRulePreview,
  MailSetupContext,
  MailThread,
  PreviewMailRuleInput,
  ReconcileMailDraftInput,
  SendMailDraftInput,
  UpdateMailDraftInput,
  UpdateMailRuleInput,
  UpdateMailThreadInput,
  UpsertMailAttentionItemInput,
} from "@personal-os/domain";

export type MailApiClient = {
  activateMailRule(
    id: string,
    input: ActivateMailRuleInput,
  ): Promise<{ preview: MailRulePreview; rule: MailRule }>;
  bulkUpdateMail(input: BulkUpdateMailInput): Promise<BulkUpdateMailResult>;
  createMailDraft(input: CreateMailDraftInput): Promise<MailDraft>;
  createMailRule(input: CreateMailRuleInput): Promise<MailRule>;
  deleteMailDraft(id: string): Promise<void>;
  deleteLegacyMailDraft(id: string): Promise<void>;
  getMailThread(id: string): Promise<MailThread>;
  listMailMessages(threadId: string): Promise<MailMessage[]>;
  listLegacyMailDrafts(): Promise<LegacyMailDraft[]>;
  listMailDrafts(): Promise<MailDraft[]>;
  listMailRules(): Promise<MailRule[]>;
  getMailSetupContext(): Promise<MailSetupContext>;
  listMailboxes(): Promise<Mailbox[]>;
  listMailThreads(query?: Partial<MailListQuery>): Promise<MailThread[]>;
  snoozeMailThread(id: string, until: string): Promise<void>;
  previewMailRule(input: PreviewMailRuleInput): Promise<MailRulePreview>;
  previewSavedMailRule(id: string): Promise<MailRulePreview>;
  reconcileMailDraft(id: string, input: ReconcileMailDraftInput): Promise<MailDraft>;
  sendMailDraft(input: SendMailDraftInput): Promise<void>;
  updateMailDraft(id: string, input: UpdateMailDraftInput): Promise<MailDraft>;
  updateMailRule(id: string, input: UpdateMailRuleInput): Promise<MailRule>;
  updateMailThread(id: string, input: UpdateMailThreadInput): Promise<MailThread>;
  upsertMailAttentionItem(
    threadId: string,
    input: UpsertMailAttentionItemInput,
  ): Promise<AttentionItem>;
};

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Typed Mail API surface shared by the web app, MCP server, and consumers. */
export function createMailApiClient(
  request: Request,
  toQuery: (query: object) => string,
): MailApiClient {
  return {
    async activateMailRule(id, input) {
      return request<{ preview: MailRulePreview; rule: MailRule }>(
        `/v1/mail/rules/${id}/activate`,
        { body: JSON.stringify(input), method: "POST" },
      );
    },
    async bulkUpdateMail(input) {
      const response = await request<{ result: BulkUpdateMailResult }>("/v1/mail/threads/bulk", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.result;
    },
    async createMailDraft(input) {
      const response = await request<{ draft: MailDraft }>("/v1/mail/drafts", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.draft;
    },
    async createMailRule(input) {
      const response = await request<{ rule: MailRule }>("/v1/mail/rules", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.rule;
    },
    async deleteLegacyMailDraft(id) {
      await request<void>(`/v1/mail/drafts/${id}`, { method: "DELETE" });
    },
    async deleteMailDraft(id) {
      await request<void>(`/v1/mail/drafts/${id}`, { method: "DELETE" });
    },
    async getMailThread(id) {
      const response = await request<{ thread: MailThread }>(`/v1/mail/threads/${id}`);
      return response.thread;
    },
    async getMailSetupContext() {
      const response = await request<{ setup: MailSetupContext }>("/v1/mail/setup-context");
      return response.setup;
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
    async listLegacyMailDrafts() {
      const response = await request<{ drafts: LegacyMailDraft[] }>("/v1/mail/drafts");
      return response.drafts;
    },
    async listMailDrafts() {
      const response = await request<{ drafts: MailDraft[] }>("/v1/mail/drafts");
      return response.drafts;
    },
    async listMailRules() {
      const response = await request<{ rules: MailRule[] }>("/v1/mail/rules");
      return response.rules;
    },
    async previewMailRule(input) {
      const response = await request<{ preview: MailRulePreview }>("/v1/mail/rules/preview", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.preview;
    },
    async previewSavedMailRule(id) {
      const response = await request<{ preview: MailRulePreview }>(`/v1/mail/rules/${id}/preview`);
      return response.preview;
    },
    async reconcileMailDraft(id, input) {
      const response = await request<{ draft: MailDraft }>(`/v1/mail/drafts/${id}/reconcile`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.draft;
    },
    async sendMailDraft(input) {
      await request<void>("/v1/mail/send", {
        body: JSON.stringify(input),
        method: "POST",
      });
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
    async updateMailDraft(id, input) {
      const response = await request<{ draft: MailDraft }>(`/v1/mail/drafts/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.draft;
    },
    async updateMailRule(id, input) {
      const response = await request<{ rule: MailRule }>(`/v1/mail/rules/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.rule;
    },
    async upsertMailAttentionItem(threadId, input) {
      const response = await request<{ item: AttentionItem }>(
        `/v1/mail/threads/${threadId}/attention`,
        { body: JSON.stringify(input), method: "PUT" },
      );
      return response.item;
    },
    async snoozeMailThread(id, until) {
      await request<void>(`/v1/mail/threads/${id}/snooze`, {
        body: JSON.stringify({ until }),
        method: "POST",
      });
    },
  };
}
