import type { Mailbox, MailThreadSummary, UpdateMailThreadInput } from "@personal-os/domain";

export type MailAction = "archive" | "read";
/** Gesture Handler 3 reports the physical drag direction (not the action-panel edge). */
export function swipeAction(direction: "left" | "right"): MailAction {
  return direction === "left" ? "archive" : "read";
}
export function threadChange(
  thread: MailThreadSummary,
  action: MailAction,
  mailboxes: Mailbox[],
): UpdateMailThreadInput {
  if (action === "read") return { expectedUpdatedAt: thread.updatedAt, unread: !thread.unread };
  const inboxes = new Set(
    mailboxes
      .filter((box) => box.accountId === thread.accountId && box.role === "inbox")
      .map((box) => box.id),
  );
  if (!thread.mailboxIds.some((id) => inboxes.has(id)))
    throw new Error("Refresh your inbox before archiving this message.");
  return {
    expectedUpdatedAt: thread.updatedAt,
    mailboxIds: thread.mailboxIds.filter((id) => !inboxes.has(id)),
  };
}
export function messageTime(value: string, now = new Date()) {
  const date = new Date(value);
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
export function nextMailPage(page: MailThreadSummary[]) {
  const last = page.at(-1);
  return page.length === 50 && last
    ? { beforeReceivedAt: last.receivedAt, beforeId: last.id }
    : undefined;
}
