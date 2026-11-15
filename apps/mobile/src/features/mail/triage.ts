import type { ApiClientError } from "@personal-os/api-client";
import type { MailThread, MailThreadSummary } from "@personal-os/domain";
import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner-native";
import type { RowAction } from "../../components/row-action-button";
import { useAuth } from "../auth/context";
import { useMail, useMailAccounts } from "./data";
import { archivedMailboxIds, leftMailTarget, type MailChange, mailWriteRejected } from "./logic";

type Action = "read" | "unread" | "archive" | "restore";

const copy: Record<Action, { loading: string; done: string; verb: string; state: string }> = {
  read: {
    loading: "Marking as read…",
    done: "Marked as read",
    verb: "mark the conversation as read",
    state: "marked as read",
  },
  unread: {
    loading: "Marking as unread…",
    done: "Marked as unread",
    verb: "mark the conversation as unread",
    state: "marked as unread",
  },
  archive: {
    loading: "Archiving conversation…",
    done: "Conversation archived",
    verb: "archive the conversation",
    state: "archived",
  },
  restore: {
    loading: "Moving back to Inbox…",
    done: "Conversation moved back to Inbox",
    verb: "move the conversation back to Inbox",
    state: "moved back to Inbox",
  },
};

/** How long after an unconfirmed write Mail is read a second time. */
export const UNCONFIRMED_RECHECK_MS = 5_000;

function failure(action: Action, error: unknown) {
  const { verb, state } = copy[action];
  if (!mailWriteRejected(error))
    // The provider may hold the change even though nohmi could not confirm it.
    return `Couldn’t confirm the conversation was ${state}. It may have changed in your mailbox; check it once Mail refreshes before trying again.`;
  const status = (error as ApiClientError).status;
  if (status === 404) return "This conversation is no longer available.";
  if (status === 409) return `Couldn’t ${verb} because it changed. Review it and try again.`;
  return `Couldn’t ${verb}. It was not changed.`;
}

/**
 * Read, unread and archive for one mailbox list. These change the person's real mailbox, so a
 * change is recorded only once the API confirms it: until then it is an overlay on the cached
 * list, and dropping the overlay is all a failed or unconfirmed write needs to put the
 * conversation back. Every failure re-reads Mail rather than assuming either outcome.
 */
export function useMailTriage() {
  const { api, owner } = useMail();
  const { session } = useAuth();
  const client = useQueryClient();
  const mailboxes = useMailAccounts().data?.flatMap((account) => account.mailboxes);
  const [changes, setChanges] = useState<ReadonlyMap<string, MailChange>>(new Map());
  const busy = useRef(new Set<string>());
  async function send(action: Action, thread: MailThreadSummary, change: MailChange) {
    if (!owner || busy.current.has(thread.id)) return;
    // The session itself, read when the write settles: it outlives this list, so a change that
    // settles after the list closed still reports its outcome, and one that settles after a
    // sign-out reports nothing to whoever is signed in next.
    const epoch = session.epoch();
    const current = () => session.epoch() === epoch;
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
    const summaries = ["mail", owner, "summaries"];
    const refresh = () => {
      void client.invalidateQueries({ queryKey: summaries });
      void client.invalidateQueries({ queryKey: ["mail", owner, "accounts"] });
    };
    const id = toast.loading(copy[action].loading);
    let confirmed: MailThread;
    try {
      confirmed = await api.updateMailThread(thread.id, {
        ...change,
        expectedUpdatedAt: thread.updatedAt,
      });
    } catch (error) {
      settle();
      if (!current()) return void toast.dismiss(id);
      toast.error(failure(action, error), { id });
      refresh();
      // nohmi's record can trail the provider after an unknown outcome; look once more.
      if (!mailWriteRejected(error))
        setTimeout(() => {
          if (current()) refresh();
        }, UNCONFIRMED_RECHECK_MS);
      return;
    }
    if (!current()) {
      settle();
      return void toast.dismiss(id);
    }
    // From here the write is confirmed, and nothing below may report it as failed.
    // A read that began before the write must not land over the confirmed state.
    await client.cancelQueries({ queryKey: summaries }).catch(() => undefined);
    for (const query of client.getQueryCache().findAll({ queryKey: summaries })) {
      const left = leftMailTarget(
        String(query.queryKey[3]),
        thread.mailboxIds,
        confirmed.mailboxIds,
      );
      client.setQueryData<InfiniteData<MailThreadSummary[]>>(
        query.queryKey,
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) =>
              page.flatMap((row) =>
                row.id !== thread.id
                  ? [row]
                  : left
                    ? []
                    : // Summaries stay body-free: copy only the fields a summary carries.
                      [
                        {
                          ...row,
                          mailboxIds: confirmed.mailboxIds,
                          starred: confirmed.starred,
                          unread: confirmed.unread,
                          updatedAt: confirmed.updatedAt,
                        },
                      ],
              ),
            ),
          },
      );
    }
    settle();
    let undone = false;
    toast.success(
      copy[action].done,
      // Gmail restores a conversation by label. An iCloud archive moves the message to another
      // mailbox, and the API cannot yet move it back, so no inverse is offered there.
      action === "archive" && thread.provider === "google"
        ? {
            id,
            duration: 10_000,
            action: {
              label: "Undo",
              onClick: () => {
                if (undone || !current()) return;
                undone = true;
                void send(
                  "restore",
                  { ...thread, mailboxIds: confirmed.mailboxIds, updatedAt: confirmed.updatedAt },
                  { mailboxIds: thread.mailboxIds },
                );
              },
            },
          }
        : { id },
    );
    // Unread counts, other mailboxes and anything unconfirmed come from a fresh read.
    refresh();
  }

  return {
    changes,
    /**
     * The actions a conversation offers. Archive appears only for a conversation in an inbox;
     * `onArchive` runs as the conversation leaves, before the provider answers.
     */
    actions(thread: MailThreadSummary, onArchive?: () => void): RowAction[] {
      // A conversation with a change in flight takes no second one.
      const disabled = changes.has(thread.id);
      const kept = archivedMailboxIds(thread, mailboxes);
      return [
        {
          id: "unread",
          label: thread.unread ? "Mark as read" : "Mark as unread",
          icon: thread.unread ? "check" : "mail",
          disabled,
          onPress: () =>
            void send(thread.unread ? "read" : "unread", thread, { unread: !thread.unread }),
        },
        ...(kept
          ? [
              {
                id: "archive",
                label: "Archive",
                icon: "archive" as const,
                disabled,
                onPress: () => {
                  onArchive?.();
                  void send("archive", thread, { mailboxIds: kept });
                },
              },
            ]
          : []),
      ];
    },
  };
}
