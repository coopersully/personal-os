import { ApiClientError } from "@personal-os/api-client";
import type {
  AttentionItem,
  MailAddress,
  Mailbox,
  MailboxRole,
  MailStewardshipQuestion,
  MailThreadSummary,
} from "@personal-os/domain";
import type { IconName } from "../../components/icons";

export const MAIL_PAGE_SIZE = 50;

/** How many conversations one selection can hold: one loaded page. */
export const MAIL_SELECTION_LIMIT = 50;

/**
 * The thread list a Mail screen is showing: the unified inbox, the conversations snoozed in
 * nohmi, or one provider mailbox.
 */
export type MailScope =
  | { kind: "inbox" }
  | { kind: "snoozed" }
  | { kind: "mailbox"; mailboxId: string; title: string; account: string };

export const inboxScope: MailScope = { kind: "inbox" };
export const snoozedScope: MailScope = { kind: "snoozed" };

export function scopeTitle(scope: MailScope) {
  return scope.kind === "inbox" ? "Inbox" : scope.kind === "snoozed" ? "Snoozed" : scope.title;
}

/** The name a scope's cached lists are kept under. */
export function scopeTarget(scope: MailScope) {
  return scope.kind === "mailbox" ? scope.mailboxId : scope.kind;
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

/**
 * A change to one conversation that has been sent but not yet confirmed by the API. `snoozed`
 * is nohmi's own state: a snoozed conversation is listed only under Snoozed until it returns.
 */
export type MailChange = { unread?: boolean; mailboxIds?: string[]; snoozed?: boolean };

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

/** The list as it reads while changes are in flight: new unread state, moved rows gone. */
export function withMailChanges(
  rows: MailThreadSummary[],
  changes: ReadonlyMap<string, MailChange>,
  target: string,
) {
  if (!changes.size) return rows;
  return rows.flatMap((thread) => {
    const change = changes.get(thread.id);
    if (!change) return [thread];
    const { snoozed, ...fields } = change;
    if (snoozed !== undefined && snoozed !== (target === "snoozed")) return [];
    if (fields.mailboxIds && leftMailTarget(target, thread.mailboxIds, fields.mailboxIds))
      return [];
    return [{ ...thread, ...fields }];
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

const HOUR = 3_600_000;
const SNOOZE_MORNING = 8;

/** The times a snooze offers without a picker, in the device's own time. */
export function snoozeChoices(now: Date) {
  const morning = (days: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, SNOOZE_MORNING);
  // Monday of next week; on a Monday that is seven days on, never today.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { id: "hours", label: "In 3 hours", until: new Date(now.getTime() + 3 * HOUR) },
    { id: "tomorrow", label: "Tomorrow morning", until: morning(1) },
    { id: "week", label: "Next week", until: morning(toMonday) },
  ];
}

const two = (value: number) => String(value).padStart(2, "0");

/** A local calendar day as the date picker holds it. */
export function pickerDay(date: Date) {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The moment a picked day and time name on this device, or `null` unless it is still ahead. */
export function pickedSnooze(day: string, time: string, now: Date) {
  const on = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const at = /^(\d{2}):(\d{2})$/.exec(time);
  if (!on || !at) return null;
  const [year, month, date, hour, minute] = [...on.slice(1), ...at.slice(1)].map(Number);
  const until = new Date(year, month - 1, date, hour, minute);
  // An impossible day or time rolls over into another one; that is not what was picked.
  if (pickerDay(until) !== day || until.getHours() !== hour || until.getMinutes() !== minute)
    return null;
  return until > now ? until : null;
}

/** When a snooze ends: the time alone for today, the day with it for anything later. */
export function snoozeTime(until: Date, now = new Date()) {
  const time = until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return until.toDateString() === now.toDateString()
    ? time
    : `${until.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

/** A snooze that has already ended is how a conversation is unsnoozed: the API has no other way. */
export function endedSnooze(now = new Date()) {
  return new Date(now.getTime() - 24 * HOUR).toISOString();
}

/**
 * Identifies a set of actions by what each one shows. The iOS menu reads its icons once when it
 * mounts, so a menu whose actions change is given a new key and mounts again with the right ones.
 */
export function actionsKey(actions: readonly { id: string; icon: string }[]) {
  return actions.map((action) => `${action.id}:${action.icon}`).join("|");
}

export function conversations(count: number) {
  return count === 1 ? "1 conversation" : `${count} conversations`;
}

const importanceRank = { critical: 0, high: 1, normal: 2, low: 3 } as const;

/** Open Mail attention that is still current, most important first, newest first within a level. */
export function mailAttention(items: AttentionItem[], now: Date) {
  return items
    .filter(
      (item) =>
        item.status === "open" &&
        item.kind !== "run_summary" &&
        (!item.expiresAt || Date.parse(item.expiresAt) > now.getTime()),
    )
    .sort(
      (a, b) =>
        importanceRank[a.importance] - importanceRank[b.importance] ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

/** The conversation an attention item is about, when it is about one. */
export function attentionThreadId(
  item: Pick<AttentionItem, "relatedEntityId" | "relatedEntityType">,
) {
  return item.relatedEntityType === "mail_thread" ? item.relatedEntityId : null;
}

/** A stored kind or state as a person reads it: `follow_up` is "Follow up". */
export function stewardLabel(value: string) {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a question rests on, named once each: "this conversation and a calendar event". */
export function evidenceSummary(evidence: MailStewardshipQuestion["evidence"]) {
  const names = [
    ...new Set(
      evidence.map(({ sourceType }) =>
        sourceType === "mail_thread"
          ? "this conversation"
          : `${/^[aeiou]/.test(sourceType) ? "an" : "a"} ${sourceType.replaceAll("_", " ")}`,
      ),
    ),
  ];
  return new Intl.ListFormat("en", { type: "conjunction" }).format(names);
}

/** What to say when an answer to a steward question was not confirmed as saved. */
export function answerFailure(error: unknown) {
  if (!mailWriteRejected(error))
    return "Couldn’t confirm the answer was sent. Check the question once it reloads before trying again.";
  const status = (error as ApiClientError).status;
  if (status === 409) return "This question changed elsewhere.";
  if (status === 404) return "This question is no longer available.";
  return "Couldn’t send the answer. It was not saved.";
}
