import type { ApiClientError } from "@personal-os/api-client";
import type { MailThread, MailThreadSummary } from "@personal-os/domain";
import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner-native";
import type { RowAction } from "../../components/row-action-button";
import { useAuth } from "../auth/context";
import { useMail, useMailAccounts } from "./data";
import {
  archivedMailboxIds,
  conversations,
  endedSnooze,
  leftMailTarget,
  type MailChange,
  mailWriteRejected,
  snoozeTime,
  withMailRow,
} from "./logic";

type Action = "read" | "unread" | "archive" | "restore" | "snooze" | "unsnooze";

/** What a person can do to a selection; `restore` only ever happens as an Undo. */
export type BulkAction = Exclude<Action, "restore">;

/** One conversation and the change asked of it. */
type Step = { thread: MailThreadSummary; change: MailChange };

const copy: Record<
  Action,
  { loading: string; done: string; verb: string; state: string; many: string }
> = {
  read: {
    loading: "Marking as read…",
    done: "Marked as read",
    verb: "mark the conversation as read",
    state: "marked as read",
    many: "Marking {n} as read…",
  },
  unread: {
    loading: "Marking as unread…",
    done: "Marked as unread",
    verb: "mark the conversation as unread",
    state: "marked as unread",
    many: "Marking {n} as unread…",
  },
  archive: {
    loading: "Archiving conversation…",
    done: "Conversation archived",
    verb: "archive the conversation",
    state: "archived",
    many: "Archiving {n}…",
  },
  restore: {
    loading: "Moving back to Inbox…",
    done: "Conversation moved back to Inbox",
    verb: "move the conversation back to Inbox",
    state: "moved back to Inbox",
    many: "Moving {n} back to Inbox…",
  },
  snooze: {
    loading: "Snoozing conversation…",
    done: "Conversation snoozed",
    verb: "snooze the conversation",
    state: "snoozed",
    many: "Snoozing {n}…",
  },
  unsnooze: {
    loading: "Ending snooze…",
    done: "Snooze ended",
    verb: "end the snooze",
    state: "unsnoozed",
    many: "Ending the snooze on {n}…",
  },
};

/** Snooze is nohmi's own record; every other action changes the mailbox at the provider. */
const local = (action: Action) => action === "snooze" || action === "unsnooze";

/** How long after an unconfirmed write Mail is read a second time. */
export const UNCONFIRMED_RECHECK_MS = 5_000;

function failure(action: Action, error: unknown) {
  const { verb, state } = copy[action];
  if (!mailWriteRejected(error))
    return local(action)
      ? `Couldn’t confirm the conversation was ${state}. Check it once Mail refreshes before trying again.`
      : // The provider may hold the change even though nohmi could not confirm it.
        `Couldn’t confirm the conversation was ${state}. It may have changed in your mailbox; check it once Mail refreshes before trying again.`;
  const status = (error as ApiClientError).status;
  if (status === 404) return "This conversation is no longer available.";
  if (status === 409) return `Couldn’t ${verb} because it changed. Review it and try again.`;
  return `Couldn’t ${verb}. It was not changed.`;
}

/** The steps that put confirmed changes back, for the changes that can be put back. */
function inverse(
  action: Action,
  confirmed: readonly { before: MailThreadSummary; after: MailThreadSummary }[],
): { action: Action; steps: Step[] } | null {
  const steps = (to: Action, change: (before: MailThreadSummary) => MailChange | null) => ({
    action: to,
    steps: confirmed.flatMap(({ before, after }) => {
      const back = change(before);
      return back ? [{ thread: after, change: back }] : [];
    }),
  });
  if (action === "read") return steps("unread", () => ({ unread: true }));
  if (action === "unread") return steps("read", () => ({ unread: false }));
  // Gmail restores a conversation by label. An iCloud archive moves the message to another
  // mailbox, and the API cannot yet move it back, so no inverse is offered there.
  if (action === "archive")
    return steps("restore", (before) =>
      before.provider === "google" ? { mailboxIds: before.mailboxIds } : null,
    );
  if (action === "snooze") return steps("unsnooze", () => ({ snoozed: false }));
  // An ended snooze cannot be put back: the list never carried when it was due to end.
  return null;
}

type Written =
  | { state: "done"; after: MailThreadSummary }
  | { state: "failed"; error: unknown }
  /** Nothing was reported: the conversation already had a change in flight, or the session ended. */
  | { state: "skipped" };

/**
 * Read, unread, archive and snooze for one mailbox list, one conversation or several at a time.
 * Read, unread and archive change the person's real mailbox, so a change is recorded only once
 * the API confirms it: until then it is an overlay on the cached list, and dropping the overlay
 * is all a failed or unconfirmed write needs to put the conversation back. Every failure
 * re-reads Mail rather than assuming either outcome.
 */
export function useMailTriage() {
  const { api, owner } = useMail();
  const { session } = useAuth();
  const client = useQueryClient();
  const mailboxes = useMailAccounts().data?.flatMap((account) => account.mailboxes);
  const [changes, setChanges] = useState<ReadonlyMap<string, MailChange>>(new Map());
  const busy = useRef(new Set<string>());
  const bulking = useRef(false);
  const [pending, setPending] = useState(false);
  const summaries = ["mail", owner, "summaries"];
  const refresh = () => {
    void client.invalidateQueries({ queryKey: summaries });
    void client.invalidateQueries({ queryKey: ["mail", owner, "accounts"] });
  };
  /** nohmi's record can trail the provider after an unknown outcome; look once more. */
  const recheck = (current: () => boolean) =>
    setTimeout(() => {
      if (current()) refresh();
    }, UNCONFIRMED_RECHECK_MS);

  /**
   * Sends one change and, once confirmed, writes it to the cached lists. It reports nothing
   * itself, so one conversation and a selection share the same guarantees.
   */
  async function write(
    action: Action,
    { thread, change }: Step,
    until: string | undefined,
    current: () => boolean,
  ): Promise<Written> {
    if (busy.current.has(thread.id)) return { state: "skipped" };
    busy.current.add(thread.id);
    setChanges((current) => new Map(current).set(thread.id, change));
    const settle = () => {
      busy.current.delete(thread.id);
      setChanges((current) => {
        const next = new Map(current);
        next.delete(thread.id);
        return next;
      });
    };
    let confirmed: MailThread | undefined;
    try {
      if (local(action)) await api.snoozeMailThread(thread.id, until ?? endedSnooze());
      else
        confirmed = await api.updateMailThread(thread.id, {
          ...change,
          expectedUpdatedAt: thread.updatedAt,
        });
    } catch (error) {
      settle();
      return { state: "failed", error };
    }
    if (!current()) {
      settle();
      return { state: "skipped" };
    }
    // From here the write is confirmed, and nothing below may report it as failed.
    // A read that began before the write must not land over the confirmed state.
    await client.cancelQueries({ queryKey: summaries }).catch(() => undefined);
    // The session can change while that waits; the next person gets neither caches nor a toast.
    if (!current()) {
      settle();
      return { state: "skipped" };
    }
    // Summaries stay body-free: copy only the fields a summary carries.
    const fields = confirmed
      ? {
          mailboxIds: confirmed.mailboxIds,
          starred: confirmed.starred,
          unread: confirmed.unread,
          updatedAt: confirmed.updatedAt,
        }
      : {};
    const after = { ...thread, ...fields };
    for (const query of client.getQueryCache().findAll({ queryKey: summaries })) {
      const target = String(query.queryKey[3]);
      // A snoozed conversation is listed only under Snoozed; one whose snooze ended leaves it.
      const left = confirmed
        ? leftMailTarget(target, thread.mailboxIds, confirmed.mailboxIds)
        : (action === "snooze") === (target !== "snoozed");
      // The archive took the row out of these lists, so a confirmed restore puts it back
      // without waiting on the read below. A search is left to that read: it may not match.
      const back =
        action === "restore" &&
        !query.queryKey[4] &&
        (target === "inbox" ||
          (after.mailboxIds.includes(target) && !thread.mailboxIds.includes(target)));
      client.setQueryData<InfiniteData<MailThreadSummary[]>>(query.queryKey, (data) => {
        if (!data) return data;
        const pages = data.pages.map((page) =>
          page.flatMap((row) =>
            row.id !== thread.id ? [row] : left ? [] : [{ ...row, ...fields }],
          ),
        );
        return { ...data, pages: back ? withMailRow(pages, after) : pages };
      });
    }
    settle();
    return { state: "done", after };
  }

  /** The session that asked, read when a write settles: it outlives this list. */
  function asked() {
    // A change that settles after the list closed still reports its outcome, and one that
    // settles after a sign-out reports nothing to whoever is signed in next.
    const epoch = session.epoch();
    return () => session.epoch() === epoch;
  }
  const snoozedUntil = (until: string | undefined) =>
    until ? ` until ${snoozeTime(new Date(until))}` : "";

  async function send(action: Action, step: Step, until?: string) {
    if (!owner || busy.current.has(step.thread.id)) return;
    const current = asked();
    const id = toast.loading(copy[action].loading);
    const result = await write(action, step, until, current);
    if (result.state === "skipped" || !current()) return void toast.dismiss(id);
    if (result.state === "failed") {
      toast.error(failure(action, result.error), { id });
      refresh();
      if (!mailWriteRejected(result.error)) recheck(current);
      return;
    }
    const undo = inverse(action, [{ before: step.thread, after: result.after }]);
    const back = undo?.steps[0];
    let undone = false;
    toast.success(
      action === "snooze" ? `Snoozed${snoozedUntil(until)}` : copy[action].done,
      // A single read or unread change is one tap to reverse from the row, so only the changes
      // that take the conversation out of sight offer Undo.
      undo && back && (action === "archive" || action === "snooze")
        ? {
            id,
            duration: 10_000,
            action: {
              label: "Undo",
              onClick: () => {
                if (undone || !current()) return;
                undone = true;
                void send(undo.action, back);
              },
            },
          }
        : { id },
    );
    // Unread counts, other mailboxes and anything unconfirmed come from a fresh read.
    refresh();
  }

  /**
   * Applies one action to several conversations, one write at a time, and reports once. Each
   * conversation is confirmed on its own, so a partial failure names how many changed, hands the
   * rest back through `settled` to stay selected, and offers Undo only for the confirmed ones.
   */
  async function sendMany(
    action: Action,
    steps: readonly Step[],
    until: string | undefined,
    settled: (failed: string[]) => void,
    undoable = true,
  ) {
    if (!owner || bulking.current || !steps.length) return;
    const current = asked();
    bulking.current = true;
    setPending(true);
    const id = toast.loading(copy[action].many.replace("{n}", conversations(steps.length)));
    const confirmed: { before: MailThreadSummary; after: MailThreadSummary }[] = [];
    const failed: string[] = [];
    let rejected = true;
    try {
      for (const step of steps) {
        const result = await write(action, step, until, current);
        if (!current()) return void toast.dismiss(id);
        if (result.state === "done") confirmed.push({ before: step.thread, after: result.after });
        else {
          failed.push(step.thread.id);
          if (result.state === "failed" && !mailWriteRejected(result.error)) rejected = false;
        }
      }
    } finally {
      bulking.current = false;
      setPending(false);
    }
    settled(failed);
    const state = `${copy[action].state}${action === "snooze" ? snoozedUntil(until) : ""}`;
    const undo = undoable ? inverse(action, confirmed) : null;
    let undone = false;
    const options = undo?.steps.length
      ? {
          id,
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: () => {
              // While another selection's action is in flight this Undo waits, unspent.
              if (undone || bulking.current || !current()) return;
              undone = true;
              void sendMany(undo.action, undo.steps, undefined, () => {}, false);
            },
          },
        }
      : { id };
    if (!failed.length) toast.success(`${conversations(confirmed.length)} ${state}`, options);
    else if (confirmed.length)
      toast.error(
        `${conversations(confirmed.length)} ${state}; ${failed.length} not confirmed. Check Mail before trying again.`,
        options,
      );
    else
      toast.error(
        rejected
          ? `Couldn’t change ${steps.length === 1 ? "this conversation. It was" : "these conversations. They were"} not ${state}.`
          : `Couldn’t confirm ${steps.length === 1 ? "this conversation was" : "these conversations were"} ${state}. Check Mail before trying again.`,
        { id },
      );
    refresh();
    if (!rejected) recheck(current);
  }

  /** The change an action asks of a conversation, or `null` when it would change nothing. */
  function step(action: BulkAction, thread: MailThreadSummary): Step | null {
    if (action === "read") return thread.unread ? { thread, change: { unread: false } } : null;
    if (action === "unread") return thread.unread ? null : { thread, change: { unread: true } };
    if (action === "archive") {
      const kept = archivedMailboxIds(thread, mailboxes);
      return kept ? { thread, change: { mailboxIds: kept } } : null;
    }
    return { thread, change: { snoozed: action === "snooze" } };
  }

  return {
    changes,
    /** A selection's action is in flight; the selection takes no second one until it reports. */
    pending,
    /** Whether an action would change this conversation. */
    allows: (action: BulkAction, thread: MailThreadSummary) => !!step(action, thread),
    /** Snoozes one conversation until `until`; `onLeave` runs as it leaves the list. */
    snooze(thread: MailThreadSummary, until: Date, onLeave?: () => void) {
      onLeave?.();
      void send("snooze", { thread, change: { snoozed: true } }, until.toISOString());
    },
    /**
     * Applies an action to the selected conversations it would change. `settled` receives the
     * conversations that were not confirmed, so they can stay selected.
     */
    bulk(
      action: BulkAction,
      threads: readonly MailThreadSummary[],
      settled: (failed: string[]) => void,
      until?: Date,
    ) {
      void sendMany(
        action,
        threads.flatMap((thread) => step(action, thread) ?? []),
        action === "snooze" ? until?.toISOString() : undefined,
        settled,
      );
    },
    /**
     * The actions a conversation offers. Archive appears only for a conversation in an inbox.
     * `onLeave` runs as the conversation leaves the list, before the API answers. Snooze asks
     * `onSnooze` for a time; a conversation listed under Snoozed offers to end its snooze.
     */
    actions(
      thread: MailThreadSummary,
      {
        onLeave,
        onSnooze,
        snoozed = false,
      }: { onLeave?: () => void; onSnooze?: () => void; snoozed?: boolean } = {},
    ): RowAction[] {
      // A conversation with a change in flight takes no second one.
      const disabled = changes.has(thread.id) || pending;
      const kept = archivedMailboxIds(thread, mailboxes);
      return [
        {
          id: "unread",
          label: thread.unread ? "Mark as read" : "Mark as unread",
          icon: thread.unread ? "check" : "mail",
          disabled,
          onPress: () =>
            void send(thread.unread ? "read" : "unread", {
              thread,
              change: { unread: !thread.unread },
            }),
        },
        ...(kept
          ? [
              {
                id: "archive",
                label: "Archive",
                icon: "archive" as const,
                disabled,
                onPress: () => {
                  onLeave?.();
                  void send("archive", { thread, change: { mailboxIds: kept } });
                },
              },
            ]
          : []),
        ...(snoozed
          ? [
              {
                id: "unsnooze",
                label: "End snooze",
                icon: "clock" as const,
                disabled,
                onPress: () => {
                  onLeave?.();
                  void send("unsnooze", { thread, change: { snoozed: false } });
                },
              },
            ]
          : onSnooze
            ? [
                {
                  id: "snooze",
                  label: "Snooze",
                  icon: "clock" as const,
                  disabled,
                  onPress: onSnooze,
                },
              ]
            : []),
      ];
    },
  };
}
