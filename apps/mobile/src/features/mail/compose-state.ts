import { ApiClientError, type PersonalOsApiClient } from "@personal-os/api-client";
import {
  createMailDraftInputSchema,
  type MailDraft,
  type MailDraftAttachmentInput,
} from "@personal-os/domain";

export type ComposeFields = {
  accountId: string;
  attachments?: MailDraftAttachmentInput[];
  threadId?: string | null;
  to: string;
  cc: string;
  subject: string;
  body: string;
};
export const draftFields = (draft?: MailDraft, accountId = ""): ComposeFields => ({
  accountId: draft?.accountId ?? accountId,
  attachments: draft?.attachments ?? [],
  threadId: draft?.threadId ?? null,
  to: draft?.to.map((r) => r.address).join(", ") ?? "",
  cc: draft?.cc.map((r) => r.address).join(", ") ?? "",
  subject: draft?.subject ?? "",
  body: draft?.body ?? "",
});
export function composePayload(fields: ComposeFields, draft?: MailDraft) {
  const recipients = (value: string) =>
    value
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((address) => ({ address, name: null }));
  return createMailDraftInputSchema.safeParse({
    ...fields,
    to: recipients(fields.to),
    cc: recipients(fields.cc),
    threadId: draft?.threadId ?? fields.threadId ?? null,
  });
}
/** One serialized writer per editor. Never replay an uncertain create or send. */
export class DraftWriter {
  draft?: MailDraft;
  blocked = "";
  private saved: string;
  private queue: Promise<unknown> = Promise.resolve();
  private sending = false;
  constructor(
    private api: PersonalOsApiClient,
    initial?: MailDraft,
  ) {
    this.draft = initial;
    this.saved = initial ? JSON.stringify(draftFields(initial)) : "";
    if (initial && initial.sendStatus !== "draft")
      this.blocked = "Check Sent mail and review this draft on the web before sending again.";
  }
  async save(fields: ComposeFields) {
    const snapshot = { ...fields };
    const run = async () => {
      if (this.blocked) throw new Error(this.blocked);
      if (this.sending) throw new Error("Wait for sending to finish.");
      if (this.draft && this.saved === JSON.stringify(snapshot)) return this.draft;
      const payload = composePayload(
        {
          ...snapshot,
          attachments: snapshot.attachments?.map(
            (file) => this.draft?.attachments?.find((saved) => saved.id === file.id) ?? file,
          ),
        },
        this.draft,
      );
      if (!payload.success) {
        const attachmentIssue = payload.error.issues.find(
          (issue) => issue.path[0] === "attachments",
        );
        throw new Error(
          attachmentIssue
            ? `Check your attachments: ${attachmentIssue.message}`
            : "Choose an account and check the recipient addresses before saving.",
        );
      }
      try {
        this.draft = this.draft
          ? await this.api.updateMailDraft(this.draft.id, {
              ...payload.data,
              expectedUpdatedAt: this.draft.updatedAt,
            })
          : await this.api.createMailDraft(payload.data);
        this.saved = JSON.stringify(snapshot);
        return this.draft;
      } catch (error) {
        if (
          !(error instanceof ApiClientError) ||
          error.status >= 500 ||
          error.status === 408 ||
          error.status === 409
        ) {
          this.blocked =
            "Couldn’t confirm the save. Your text is still here. Check Drafts before trying again.";
        }
        throw new Error(this.blocked || "Couldn’t save your draft. Your text is still here.");
      }
    };
    const operation = this.queue.then(run, run);
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async send(confirmed: MailDraft) {
    await this.queue;
    if (this.blocked || this.sending || this.draft?.updatedAt !== confirmed.updatedAt)
      throw new Error(this.blocked || "Review the latest draft before sending.");
    this.sending = true;
    try {
      await this.api.sendMailDraft({
        draftId: confirmed.id,
        confirmedUpdatedAt: confirmed.updatedAt,
      });
      this.blocked = "This message has already been sent.";
    } catch (error) {
      this.blocked =
        "Couldn’t confirm sending. Check Sent mail and review this draft on the web before sending again.";
      if (
        error instanceof ApiClientError &&
        typeof error.details === "object" &&
        error.details !== null &&
        "retrySafe" in error.details &&
        error.details.retrySafe === true
      ) {
        try {
          const fresh = (await this.api.listMailDrafts()).find((d) => d.id === confirmed.id);
          if (fresh?.sendStatus === "draft") {
            this.draft = fresh;
            this.blocked = "";
          }
        } catch {
          /* Keep sending blocked until durable authority is known. */
        }
      }
      throw new Error(
        this.blocked || "Message wasn’t sent. Your draft is saved; you can try again.",
      );
    } finally {
      this.sending = false;
    }
  }
}
