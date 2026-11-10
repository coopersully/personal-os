import type { Mailbox, MailThreadSummary } from "@personal-os/domain";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { toast } from "sonner-native";
import { useAuth } from "../auth/context";
import { type MailAction, nextMailPage, threadChange } from "./logic";
import type { MailFolder } from "./scope";

export function useInbox(
  search: string,
  folder: MailFolder = "inbox",
  accountId = "",
  filters: { unread?: true; starred?: true } = {},
) {
  const { session, state } = useAuth();
  const api = session.api();
  const owner = state.user?.id;
  const client = useQueryClient();
  const [query, setQuery] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const inbox = useInfiniteQuery({
    queryKey: ["mail", owner, "inbox", query, folder, accountId, filters],
    enabled: !!owner,
    initialPageParam: undefined as { beforeReceivedAt: string; beforeId: string } | undefined,
    queryFn: ({ pageParam }) =>
      api.listMailThreadSummaries({
        mailboxRole: folder,
        ...filters,
        ...(accountId ? { accountIds: [accountId] } : {}),
        limit: 50,
        query: query || undefined,
        ...pageParam,
      }),
    getNextPageParam: nextMailPage,
  });
  const boxes = useQuery({
    queryKey: ["mail", owner, "mailboxes"],
    enabled: !!owner,
    queryFn: () => api.listMailboxes(),
  });
  useFocusEffect(
    useCallback(() => {
      const refresh = () => {
        void client.refetchQueries({ queryKey: ["mail", owner], type: "active", stale: true });
      };
      refresh();
      const listener = AppState.addEventListener("change", (status) => {
        if (status === "active") refresh();
      });
      return () => listener.remove();
    }, [client, owner]),
  );
  return { inbox, boxes, searching: search.trim() !== query };
}

export function useMailAction(mailboxes: Mailbox[]) {
  const { session, state } = useAuth();
  const client = useQueryClient();
  const owner = state.user?.id;
  const liveOwner = useRef(owner);
  liveOwner.current = owner;
  const mounted = useRef(true);
  const notices = useRef(new Set<string | number>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const id of notices.current) toast.dismiss(id);
      notices.current.clear();
    };
  }, []);
  const locks = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const run = async (thread: MailThreadSummary, action: MailAction) => {
    if (!owner || locks.current.has(thread.id)) return;
    const api = session.api();
    const active = () => mounted.current && owner === liveOwner.current;
    const refresh = () => client.invalidateQueries({ queryKey: ["mail", owner] });
    locks.current.add(thread.id);
    setPending(new Set(locks.current));
    const id = toast.loading(action === "archive" ? "Archiving…" : "Updating message…");
    notices.current.add(id);
    try {
      const updated = await api.updateMailThread(
        thread.id,
        threadChange(thread, action, mailboxes),
      );
      if (!active()) {
        toast.dismiss(id);
        return;
      }
      let used = false;
      toast.success(
        action === "archive"
          ? "Message archived"
          : thread.unread
            ? "Marked as read"
            : "Marked as unread",
        {
          id,
          action: {
            label: "Undo",
            onClick: async () => {
              if (used || !active() || locks.current.has(thread.id)) return;
              used = true;
              locks.current.add(thread.id);
              setPending(new Set(locks.current));
              toast.loading("Undoing…", { id });
              try {
                await api.updateMailThread(thread.id, {
                  expectedUpdatedAt: updated.updatedAt,
                  ...(action === "archive"
                    ? { mailboxIds: thread.mailboxIds }
                    : { unread: thread.unread }),
                });
                if (active()) toast.success("Action undone", { id });
              } catch {
                if (active())
                  toast.error("Couldn’t undo. Refresh to see the latest message state.", { id });
              } finally {
                locks.current.delete(thread.id);
                if (active()) setPending(new Set(locks.current));
                await refresh();
              }
            },
          },
        },
      );
    } catch {
      if (active())
        toast.error("Couldn’t confirm the change. Refresh before trying again.", { id });
      else toast.dismiss(id);
    } finally {
      locks.current.delete(thread.id);
      if (active()) setPending(new Set(locks.current));
      await refresh();
    }
  };
  return { run, pending };
}
