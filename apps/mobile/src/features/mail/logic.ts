import { ApiClientError } from "@personal-os/api-client";
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

/** A change to one conversation that has been sent but not yet confirmed by the API. */
export type MailChange = { unread?: boolean; mailboxIds?: string[] };

/**
 * The mailboxes a conversation keeps once archived (every one that is not an inbox), or `null`
 * when it is not in a known inbox and so has nothing to archive from.
 */
export function archivedMailboxIds(
  thread: Pick<MailThreadSummary, "mailboxIds">,
  mailboxes: Pick<Mailbox, "id" | "role">[] | undefined,
) {
  const inboxes = new Set(
    (mailboxes ?? []).filter((mailbox) => mailbox.role === "inbox").map((mailbox) => mailbox.id),
  );
  const kept = thread.mailboxIds.filter((id) => !inboxes.has(id));
  return kept.length === thread.mailboxIds.length ? null : kept;
}

/** Whether a conversation that held `before` and now holds `after` has left the listed target. */
export function leftMailTarget(target: string, before: string[], after: string[]) {
  if (target !== "inbox") return before.includes(target) && !after.includes(target);
  // The unified inbox has no mailbox of its own: archiving is the only change that leaves it.
  return after.length < before.length && after.every((id) => before.includes(id));
}

/**
 * Puts a conversation back into loaded pages at its place by date. A conversation already listed
 * is left alone, and one older than a full last page belongs to a page not read yet.
 */
export function withMailRow(pages: MailThreadSummary[][], row: MailThreadSummary) {
  if (pages.some((page) => page.some((thread) => thread.id === row.id))) return pages;
  const older = (thread: MailThreadSummary) =>
    thread.receivedAt < row.receivedAt ||
    (thread.receivedAt === row.receivedAt && thread.id < row.id);
  const found = pages.findIndex((page) => page.some(older));
  const last = pages.length - 1;
  if (found < 0 && (last < 0 || (pages[last] as MailThreadSummary[]).length >= MAIL_PAGE_SIZE))
    return pages;
  const at = found < 0 ? last : found;
  return pages.map((page, index) => {
    if (index !== at) return page;
    const before = found < 0 ? page.length : page.findIndex(older);
    return [...page.slice(0, before), row, ...page.slice(before)];
  });
}

/** The list as it reads while changes are in flight: new unread state, archived rows gone. */
export function withMailChanges(
  rows: MailThreadSummary[],
  changes: ReadonlyMap<string, MailChange>,
  target: string,
) {
  if (!changes.size) return rows;
  return rows.flatMap((thread) => {
    const change = changes.get(thread.id);
    if (!change) return [thread];
    if (change.mailboxIds && leftMailTarget(target, thread.mailboxIds, change.mailboxIds))
      return [];
    return [{ ...thread, ...change }];
  });
}

/**
 * Only a definitive rejection proves the provider mailbox was not changed. A timeout, lost
 * connection or server fault leaves the outcome unknown, and the API marks a provider change it
 * could not record with `partialEffect`.
 */
export function mailWriteRejected(error: unknown) {
  if (!(error instanceof ApiClientError)) return false;
  const details = error.details as { partialEffect?: unknown } | null | undefined;
  if (typeof details === "object" && details?.partialEffect === true) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408;
}
