import { ApiClientError } from "@personal-os/api-client";
import type {
  CreateMailDraftInput,
  MailAddress,
  MailDraft,
  MailMessage,
  MailRecipientInput,
  MailThreadSummary,
} from "@personal-os/domain";
import { senderName } from "./logic";

/** What the composer holds while a person types: recipients stay text until they are saved. */
export type DraftForm = {
  accountId: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  threadId: string | null;
};

/** Where a composer starts: a saved draft, or a form nothing has saved yet. */
export type ComposeStart = { title: string; form: DraftForm; draft?: MailDraft };

export const MAIL_BODY_LIMIT = 100_000;
export const MAIL_SUBJECT_LIMIT = 998;
export const MAIL_RECIPIENT_LIMIT = 100;

const address = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** Splits on commas, semicolons and lines, except inside a quoted name or an `<address>`. */
function entries(text: string) {
  const parts: string[] = [];
  let part = "";
  let quoted = false;
  let angled = false;
  for (const char of text) {
    if (char === '"' && !angled) quoted = !quoted;
    else if (char === "<" && !quoted) angled = true;
    else if (char === ">" && !quoted) angled = false;
    if (!quoted && !angled && /[,;\n]/.test(char)) {
      parts.push(part);
      part = "";
    } else part += char;
  }
  return [...parts, part];
}

/** Addresses separated by commas, semicolons or lines, each optionally as `Name <address>`. */
export function parseRecipients(text: string) {
  const recipients: MailRecipientInput[] = [];
  const invalid: string[] = [];
  for (const part of entries(text)) {
    const entry = part.trim();
    if (!entry) continue;
    const named = /^(.*)<([^<>]*)>$/s.exec(entry);
    const value = (named?.[2] ?? entry).trim();
    const name =
      named?.[1]
        ?.trim()
        .replace(/^"(.*)"$/s, "$1")
        .trim() || null;
    if (!address.test(value)) invalid.push(entry);
    else if (!recipients.some((known) => known.address.toLowerCase() === value.toLowerCase()))
      recipients.push({ address: value, name });
  }
  return { recipients, invalid };
}

/** A name that holds a separator is quoted, so it reads back as one recipient. */
export function recipientText(recipients: readonly MailAddress[]) {
  return recipients
    .map((recipient) => {
      if (!recipient.name) return recipient.address;
      const name = recipient.name.replace(/"/g, "'");
      return `${/[,;<>\n]/.test(name) ? `"${name}"` : name} <${recipient.address}>`;
    })
    .join(", ");
}

export function formFromDraft(draft: MailDraft): DraftForm {
  return {
    accountId: draft.accountId,
    to: recipientText(draft.to),
    cc: recipientText(draft.cc),
    subject: draft.subject,
    body: draft.body,
    threadId: draft.threadId,
  };
}

export function draftInput(form: DraftForm): CreateMailDraftInput {
  return {
    accountId: form.accountId,
    to: parseRecipients(form.to).recipients,
    cc: parseRecipients(form.cc).recipients,
    subject: form.subject.trim(),
    body: form.body,
    threadId: form.threadId,
  };
}

const people = (recipients: readonly MailAddress[]) =>
  recipients.map((recipient) => `${recipient.name ?? ""}<${recipient.address.toLowerCase()}>`);

/** Whether a stored draft holds exactly what this device asked the API to save. */
export function sameDraft(draft: MailDraft, input: CreateMailDraftInput) {
  return (
    draft.accountId === input.accountId &&
    draft.subject === input.subject &&
    draft.body === input.body &&
    (draft.threadId ?? null) === (input.threadId ?? null) &&
    people(draft.to).join() === people(input.to).join() &&
    people(draft.cc).join() === people(input.cc).join()
  );
}

/** Why this form cannot be saved as it stands, in words the person can act on. */
export function saveProblem(form: DraftForm) {
  if (!form.accountId) return "Choose the account to send from.";
  const to = parseRecipients(form.to);
  const cc = parseRecipients(form.cc);
  const invalid = [...to.invalid, ...cc.invalid];
  if (invalid.length) return `“${invalid[0]}” is not an email address.`;
  if (to.recipients.length > MAIL_RECIPIENT_LIMIT || cc.recipients.length > MAIL_RECIPIENT_LIMIT)
    return `A message can have up to ${MAIL_RECIPIENT_LIMIT} recipients on each line.`;
  if (form.subject.trim().length > MAIL_SUBJECT_LIMIT) return "The subject is too long.";
  if (/[\r\n]/.test(form.subject.trim())) return "The subject must be a single line.";
  if (form.body.length > MAIL_BODY_LIMIT) return "The message is too long to save.";
  return null;
}

/** A message needs someone to go to and something to say before it can be reviewed. */
export function sendProblem(form: DraftForm) {
  const problem = saveProblem(form);
  if (problem) return problem;
  if (!parseRecipients(form.to).recipients.length) return "Add at least one recipient.";
  if (!form.subject.trim() && !form.body.trim()) return "Add a subject or a message.";
  return null;
}

/**
 * Where a draft stands. `review` is a send the API could not confirm either way: only the
 * person, after looking at Sent mail, can say which it was.
 */
export function draftStage(
  draft: Pick<MailDraft, "sendStatus" | "reconciliationState" | "sentAt">,
) {
  if (draft.sendStatus === "sent" || draft.sentAt) return "sent" as const;
  if (draft.sendStatus === "reconcile" || draft.reconciliationState === "sent_mail_review_required")
    return "review" as const;
  if (draft.sendStatus === "sending") return "sending" as const;
  return "editable" as const;
}

/** The API says outright that the provider refused the message before accepting it. */
export function sendNotAccepted(error: unknown) {
  if (!(error instanceof ApiClientError)) return false;
  const details = error.details as { retrySafe?: unknown } | null | undefined;
  return typeof details === "object" && details?.retrySafe === true;
}

const prefixed = (prefix: string, subject: string) =>
  subject.toLowerCase().startsWith(prefix.toLowerCase()) ? subject : `${prefix} ${subject}`.trim();

/** Who a reply goes to: the sender, or the other party when the latest message is the person's. */
export function replyRecipient(
  message: MailMessage | undefined,
  own: string | null | undefined,
  fallback: MailAddress,
): MailAddress | null {
  if (!message) return fallback;
  const mine = own?.toLowerCase();
  if (message.from.address.toLowerCase() !== mine) return message.replyTo[0] ?? message.from;
  return (
    [...message.to, ...message.cc].find((other) => other.address.toLowerCase() !== mine) ?? null
  );
}

export function replyStart(
  thread: MailThreadSummary,
  messages: readonly MailMessage[],
  own: string | null | undefined,
): ComposeStart {
  const to = replyRecipient(messages.at(-1), own, thread.from);
  return {
    title: "Reply",
    form: {
      accountId: thread.accountId,
      to: to ? recipientText([to]) : "",
      cc: "",
      subject: prefixed("Re:", thread.subject),
      body: "",
      threadId: thread.id,
    },
  };
}

/** A forward is a new message carrying the latest message's text; attachments do not travel. */
export function forwardStart(
  thread: MailThreadSummary,
  messages: readonly MailMessage[],
): ComposeStart {
  const latest = messages.at(-1);
  const from = latest?.from ?? thread.from;
  const quoted = [
    "",
    "",
    "---------- Forwarded message ----------",
    `From: ${senderName(from)} <${from.address}>`,
    `Subject: ${thread.subject}`,
    "",
    latest?.bodyText ?? "",
  ].join("\n");
  return {
    title: "Forward",
    form: {
      accountId: thread.accountId,
      to: "",
      cc: "",
      subject: prefixed("Fwd:", thread.subject),
      body: quoted.slice(0, MAIL_BODY_LIMIT),
      threadId: null,
    },
  };
}

export function newStart(accountId: string): ComposeStart {
  return {
    title: "New message",
    form: { accountId, to: "", cc: "", subject: "", body: "", threadId: null },
  };
}

export function draftStart(draft: MailDraft): ComposeStart {
  return { title: "Draft", form: formFromDraft(draft), draft };
}

/** One line for a draft in a list: who it is going to. */
export function draftRecipients(draft: MailDraft) {
  return recipientText(draft.to) || "No recipients";
}
