import type { MailAddress, Mailbox, MailboxRole, MailThreadSummary } from "@personal-os/domain";
import type { IconName } from "../../components/icons";

export const MAIL_PAGE_SIZE = 50;

/** The thread list a Mail screen is showing: the unified inbox or one provider mailbox. */
export type MailScope =
  | { kind: "inbox" }
  | { kind: "mailbox"; mailboxId: string; title: string; account: string };

export const inboxScope: MailScope = { kind: "inbox" };

export function scopeTitle(scope: MailScope) {
  return scope.kind === "inbox" ? "Inbox" : scope.title;
}

export function senderName(from: MailAddress) {
  return from.name?.trim() || from.address;
}

/** Time for today's mail, a calendar date for anything older. */
export function messageTime(value: string, now = new Date()) {
  const date = new Date(value);
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A full page may have more behind it; continue after its last row. */
export function nextMailPage(page: MailThreadSummary[]) {
  const last = page.at(-1);
  return page.length === MAIL_PAGE_SIZE && last
    ? { beforeId: last.id, beforeReceivedAt: last.receivedAt }
    : undefined;
}

/** New mail arriving between page reads can repeat a row; keep the first copy of each thread. */
export function mergeMailPages(pages: MailThreadSummary[][] | undefined) {
  return [...new Map((pages ?? []).flat().map((thread) => [thread.id, thread])).values()];
}

const roles: Record<MailboxRole, { order: number; label: string | null; icon: IconName }> = {
  inbox: { order: 0, label: "Inbox", icon: "inbox" },
  drafts: { order: 1, label: "Drafts", icon: "edit" },
  sent: { order: 2, label: "Sent", icon: "send" },
  archive: { order: 3, label: "Archive", icon: "archive" },
  spam: { order: 4, label: "Spam", icon: "attention" },
  trash: { order: 5, label: "Trash", icon: "trash" },
  custom: { order: 6, label: null, icon: "mail" },
};

export function mailboxLabel(mailbox: Pick<Mailbox, "name" | "role">) {
  return roles[mailbox.role].label ?? mailbox.name;
}

export function mailboxIcon(role: MailboxRole) {
  return roles[role].icon;
}

/** Standard folders first in a familiar order, then the account's own folders by name. */
export function sortMailboxes(mailboxes: Mailbox[]) {
  return [...mailboxes].sort(
    (a, b) =>
      roles[a.role].order - roles[b.role].order ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
