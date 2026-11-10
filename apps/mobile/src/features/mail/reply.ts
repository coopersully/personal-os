import type { MailAddress, MailMessage, MailThread } from "@personal-os/domain";
import type { ComposeFields } from "./compose-state";
export type ReplyMode = "reply" | "replyAll" | "forward";
export function messageIntent(
  thread: MailThread,
  message: MailMessage,
  ownAddress: string | null,
  mode: ReplyMode,
): ComposeFields {
  if (message.threadId !== thread.id)
    throw new Error("This message no longer belongs to the conversation.");
  const own = ownAddress?.trim().toLowerCase();
  if (mode !== "forward" && !own) throw new Error("Reload your account details before replying.");
  const seen = new Set<string>(own ? [own] : []);
  const unique = (items: MailAddress[]) =>
    items.filter((item) => {
      const key = item.address.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const selfSent = message.from.address.trim().toLowerCase() === own;
  const replyRecipients = selfSent
    ? [...message.to, ...message.cc].filter((r) => r.address.toLowerCase() !== own).slice(0, 1)
    : message.replyTo.length
      ? message.replyTo
      : [message.from];
  const to =
    mode === "forward"
      ? []
      : unique(
          mode === "replyAll"
            ? [...(selfSent ? [] : replyRecipients), ...message.to]
            : replyRecipients,
        );
  const cc = mode === "replyAll" ? unique(message.cc) : [];
  if (!to.length) {
    const firstCc = cc.shift();
    if (firstCc) to.push(firstCc);
  }
  const prefix = mode === "forward" ? "Fwd" : "Re";
  const subject = new RegExp(`^${prefix}:`, "i").test(thread.subject)
    ? thread.subject
    : `${prefix}: ${thread.subject}`;
  const sender = message.from.name
    ? `${message.from.name} <${message.from.address}>`
    : message.from.address;
  const quoted =
    mode === "forward"
      ? `\n\n---------- Forwarded message ----------\nFrom: ${sender}\nDate: ${new Date(message.receivedAt).toLocaleString()}\nSubject: ${thread.subject}\nTo: ${message.to.map((r) => r.address).join(", ")}${message.cc.length ? `\nCc: ${message.cc.map((r) => r.address).join(", ")}` : ""}\n\n${message.bodyText}`
      : `\n\nOn ${new Date(message.receivedAt).toLocaleString()}, ${sender} wrote:\n${message.bodyText
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}`;
  return {
    accountId: thread.accountId,
    attachments:
      mode === "forward"
        ? message.attachments.map((file) => ({
            id: file.id,
            filename: (file.filename || "attachment")
              .replace(/[\\/\p{Cc}]/gu, "_")
              .slice(0, 255)
              .replace(/^\.+$/, "attachment"),
            contentType: file.contentType.split(";")[0]?.trim() || "application/octet-stream",
            size: file.size,
            source: { messageId: message.id, attachmentId: file.id },
          }))
        : [],
    threadId: mode === "forward" ? null : thread.id,
    to: to.map((r) => r.address).join(", "),
    cc: cc.map((r) => r.address).join(", "),
    subject,
    body: quoted,
  };
}

/** Presentation only: saved/provider payloads retain the original quote byte-for-byte. */
export function splitQuotedBody(body: string) {
  const boundary = body.search(
    /\n\n(?:---------- Forwarded message ----------\n|On [^\n]+ wrote:\n>)/,
  );
  return boundary < 0
    ? { message: body, quote: "" }
    : { message: body.slice(0, boundary), quote: body.slice(boundary) };
}
